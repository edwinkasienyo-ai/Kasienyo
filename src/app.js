const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const dayjs = require("dayjs");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const AdmZip = require("adm-zip");
const { query } = require("./config/db");
const {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  GRADES,
  FORMS,
  TERMS,
  GENDER_OPTIONS,
  ADMISSION_STATUS,
  ORPHAN_STATUS,
  RELATIONSHIP_OPTIONS,
  STAFF_CATEGORY,
  SUBJECTS,
  EXAM_TYPES,
  LEAVE_TYPES,
  TERMS_OF_SERVICE,
  DOCUMENT_CATEGORIES,
  EXPORT_FORMATS
} = require("./config/constants");
const { auth } = require("./middleware/auth");
const { hashPassword, verifyPassword } = require("./utils/password");
const { sendSimplePdf, sendSimpleExcel } = require("./services/exportService");
const { generateOtpCode, buildOtpExpiry, sendOtp } = require("./services/otpService");
const { buildSearchWhere } = require("./utils/sql");

const app = express();
app.disable("etag");

const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5000";
app.use(
  cors({
    origin: frontendOrigin,
    credentials: true
  })
);
app.use(helmet());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const uploadsPath = path.join(process.cwd(), "uploads");
const publicPath = path.join(process.cwd(), "public");
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use("/uploads", express.static(uploadsPath));
app.use((req, res, next) => {
  if (/\.(js|css|html)$/i.test(req.path) || req.path === "/") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});
app.use(
  express.static(publicPath, {
    etag: false,
    lastModified: false
  })
);
app.get("/", (_, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsPath),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  })
});

const ADMISSION_STATUS_ORDER_SQL = `
  CASE status
    WHEN 'In Session' THEN 1
    WHEN 'Not in Session' THEN 2
    WHEN 'Transferred' THEN 3
    WHEN 'Alumni' THEN 4
    WHEN 'Deceased' THEN 5
    ELSE 99
  END,
  first_name ASC,
  middle_name ASC,
  last_name ASC,
  id DESC
`;

const ADMISSION_STATUS_HEX = {
  "In Session": "#188038",
  "Not in Session": "#f6bf26",
  Transferred: "#1a73e8",
  Alumni: "#f57c00",
  Deceased: "#d93025"
};

const ADMISSION_IMPORT_HEADERS = [
  "first_name",
  "middle_name",
  "last_name",
  "other_names",
  "full_name",
  "admission_number",
  "date_of_admission",
  "grade",
  "form_name",
  "stream",
  "assessment_number",
  "upi_number",
  "birth_certificate_number",
  "date_of_birth",
  "gender",
  "religion",
  "nationality",
  "county",
  "sub_county",
  "location",
  "sub_location",
  "village",
  "year_joined",
  "term_joined",
  "orphan_condition",
  "status",
  "parent_full_name",
  "parent_relationship",
  "parent_id_number",
  "parent_phone",
  "parent_email"
];

const ADMISSION_IMPORT_REQUIRED_HEADERS = [
  "first_name",
  "last_name",
  "admission_number",
  "birth_certificate_number",
  "status"
];

const ADMISSION_TEMPLATE_EXAMPLE_ROW = [
  "Akinyi",
  "N",
  "Otieno",
  "",
  "Akinyi N Otieno",
  "ADM-001",
  "2026-01-10",
  "Grade 6",
  "",
  "North",
  "ASMT-1234",
  "UPI-2001",
  "BC-778899",
  "2015-05-01",
  "Female",
  "Christian",
  "Kenyan",
  "Nairobi",
  "Westlands",
  "Loresho",
  "Loresho",
  "Village A",
  2026,
  "Term One",
  "Both Parent Alive",
  "In Session",
  "Parent Name",
  "Mother",
  "12345678",
  "+254700000000",
  "parent@example.com"
];

const ALLOWED_ADMISSION_SEARCH_FIELDS = new Set([
  "full_name",
  "first_name",
  "admission_number",
  "upi_number",
  "assessment_number",
  "birth_certificate_number",
  "status",
  "grade",
  "form_name"
]);

const ATTENDANCE_TYPES = ["Teacher", "Learner", "Non-Teaching"];
const ATTENDANCE_STATUS_OPTIONS = [
  "Present",
  "Absent",
  "Late",
  "Official Duty",
  "Absent with Apology",
  "Absent with No Apology"
];
const MESSAGE_STATUS_OPTIONS = ["Queued", "Sent", "Failed"];
const PAYMENT_METHOD_OPTIONS = ["Cash", "Bank", "Mpesa", "Cheque", "Other"];

const ROLE_ALIASES = {
  ADMINISTRATOR: ROLES.ADMIN,
  HEADTEACHER: ROLES.HEAD_OF_INSTITUTION,
  HEAD_OF_SCHOOL: ROLES.HEAD_OF_INSTITUTION,
  HEADMASTER: ROLES.HEAD_OF_INSTITUTION,
  PRINCIPAL: ROLES.HEAD_OF_INSTITUTION,
  NONTEACHINGSTAFF: ROLES.NON_TEACHING_STAFF,
  BOARD_OF_MANAGEMENT: ROLES.BOM,
  STUDENT: ROLES.LEARNER,
  PUPIL: ROLES.LEARNER
};

function normalizeRoleValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (ROLE_PERMISSIONS[raw]) return raw;
  const shaped = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (ROLE_PERMISSIONS[shaped]) return shaped;
  const compact = shaped.replace(/_/g, "");
  return ROLE_ALIASES[shaped] || ROLE_ALIASES[compact] || raw;
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function issueToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d"
  });
}

async function auditLog(user, action, entity, entityId, details = null) {
  await query(
    `INSERT INTO activity_logs
      (institution_id, actor_user_id, actor_role, action, entity_name, entity_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      user?.institution_id || null,
      user?.id || null,
      user?.role || null,
      action,
      entity,
      entityId || null,
      details ? JSON.stringify(details) : null
    ]
  );
}

function hasPermission(role, permission) {
  const normalizedRole = normalizeRoleValue(role);
  return (ROLE_PERMISSIONS[normalizedRole] || []).includes(permission);
}

function enforcePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({ error: `Missing permission: ${permission}` });
    }
    return next();
  };
}

function enforceRole(roles = []) {
  return (req, res, next) => {
    const normalizedRole = normalizeRoleValue(req.user.role);
    if (!roles.includes(normalizedRole)) {
      return res.status(403).json({ error: "Role is not allowed for this action." });
    }
    return next();
  };
}

function toPortal(role) {
  switch (normalizeRoleValue(role)) {
    case ROLES.ADMIN:
      return "Administrator Dashboard";
    case ROLES.HEAD_OF_INSTITUTION:
      return "Head of Institution Portal";
    case ROLES.TEACHER:
      return "Teacher Portal";
    case ROLES.LEARNER:
      return "Learners Portal";
    default:
      return "General Portal";
  }
}

function pickFields(payload, allowedFields) {
  return allowedFields.reduce((acc, field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      acc[field] = payload[field];
    }
    return acc;
  }, {});
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const asText = String(value).trim();
  return asText.length ? asText : null;
}

function excelSerialToDate(serial) {
  const excelEpoch = dayjs("1899-12-30");
  return excelEpoch.add(Number(serial), "day").format("YYYY-MM-DD");
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return dayjs(value).format("YYYY-MM-DD");
  if (typeof value === "number") return excelSerialToDate(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return dayjs(parsed).format("YYYY-MM-DD");
}

function normalizeYear(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeImportHeader(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function extractSpreadsheetCellValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;
  if (Object.prototype.hasOwnProperty.call(value, "result")) return value.result;
  if (Object.prototype.hasOwnProperty.call(value, "text")) return value.text;
  if (Object.prototype.hasOwnProperty.call(value, "hyperlink")) return value.hyperlink;
  if (Object.prototype.hasOwnProperty.call(value, "richText")) {
    return value.richText.map((part) => part?.text || "").join("");
  }
  return String(value);
}

function parseCsvRecordLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsvText(csvText) {
  const cleaned = String(csvText || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = cleaned.split("\n").filter((line) => line.trim().length > 0);
  if (!lines.length) {
    return { headers: [], rows: [] };
  }
  const headers = parseCsvRecordLine(lines[0]).map(normalizeImportHeader);
  const rows = lines.slice(1).map((line, index) => ({
    rowNumber: index + 2,
    values: parseCsvRecordLine(line)
  }));
  return { headers, rows };
}

function csvEscape(value) {
  const raw = String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

function buildAdmissionTemplateCsvContent() {
  const headerLine = ADMISSION_IMPORT_HEADERS.map((header) => csvEscape(header)).join(",");
  const sampleLine = ADMISSION_TEMPLATE_EXAMPLE_ROW.map((value) => csvEscape(value)).join(",");
  return `${headerLine}\n${sampleLine}\n`;
}

function normalizeAdmissionStatusForSummary(value) {
  const normalized = normalizeText(value);
  if (!normalized) return "Uncategorized";
  return ADMISSION_STATUS.includes(normalized) ? normalized : "Uncategorized";
}

function buildAdmissionStatusSummary(rows = []) {
  const counts = new Map();
  ADMISSION_STATUS.forEach((status) => counts.set(status, 0));
  counts.set("Uncategorized", 0);

  rows.forEach((row) => {
    const status = normalizeAdmissionStatusForSummary(row.status);
    counts.set(status, (counts.get(status) || 0) + Number(row.total || 0));
  });

  const orderedStatuses = ADMISSION_STATUS.concat(["Uncategorized"]);
  const summaryRows = orderedStatuses.map((status) => ({
    status,
    count: counts.get(status) || 0,
    color: ADMISSION_STATUS_HEX[status] || "#5f7187",
    sort_order: admissionStatusSortOrder(status)
  }));

  return {
    total: summaryRows.reduce((sum, item) => sum + item.count, 0),
    byStatus: summaryRows
  };
}

function buildAdmissionHeaderIndex(headers = []) {
  const index = {};
  headers.forEach((header, idx) => {
    if (ADMISSION_IMPORT_HEADERS.includes(header)) {
      index[header] = idx + 1;
    }
  });
  return index;
}

async function upsertAdmissionRows({ records, institutionId, userId }) {
  let insertedOrUpdated = 0;
  const rejectedRows = [];

  for (const record of records) {
    const learner = normalizeLearnerPayload(record.values);
    const validationError = validateLearnerPayload(learner);
    if (validationError) {
      rejectedRows.push({ row: record.rowNumber, reason: validationError });
      continue;
    }

    learner.institution_id = institutionId;
    learner.created_by_user_id = userId;

    const insertColumns = [
      "institution_id",
      "created_by_user_id",
      ...ADMISSION_IMPORT_HEADERS,
      "passport_photo_path"
    ];
    const insertValues = insertColumns.map((column) => learner[column] ?? null);
    const placeholders = insertColumns.map(() => "?").join(", ");
    const updatableColumns = insertColumns
      .filter((column) => !["institution_id", "created_by_user_id"].includes(column))
      .map((column) => `${column} = VALUES(${column})`)
      .concat("updated_at = NOW()")
      .join(", ");

    await query(
      `INSERT INTO learners (${insertColumns.join(", ")})
       VALUES (${placeholders})
       ON DUPLICATE KEY UPDATE ${updatableColumns}`,
      insertValues
    );
    insertedOrUpdated += 1;
  }

  return { insertedOrUpdated, rejectedRows };
}

function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function learnerVersionSnapshot(row = {}) {
  const fields = [
    "id",
    "institution_id",
    "full_name",
    "first_name",
    "middle_name",
    "last_name",
    "other_names",
    "admission_number",
    "date_of_admission",
    "grade",
    "form_name",
    "stream",
    "assessment_number",
    "upi_number",
    "birth_certificate_number",
    "date_of_birth",
    "gender",
    "passport_photo_path",
    "religion",
    "nationality",
    "county",
    "sub_county",
    "location",
    "sub_location",
    "village",
    "year_joined",
    "term_joined",
    "orphan_condition",
    "status",
    "conduct_status",
    "parent_full_name",
    "parent_relationship",
    "parent_id_number",
    "parent_phone",
    "parent_email",
    "deleted_at",
    "deleted_by_user_id",
    "created_at",
    "updated_at"
  ];
  const snapshot = {};
  fields.forEach((field) => {
    snapshot[field] = row[field] ?? null;
  });
  return snapshot;
}

async function logAdmissionVersion({
  institutionId,
  learnerId,
  versionAction,
  changedByUserId,
  beforeData = null,
  afterData = null,
  notes = null
}) {
  await query(
    `INSERT INTO admission_record_versions
      (institution_id, learner_id, version_action, changed_by_user_id, before_json, after_json, notes, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      institutionId,
      learnerId,
      versionAction,
      changedByUserId || null,
      beforeData ? JSON.stringify(beforeData) : null,
      afterData ? JSON.stringify(afterData) : null,
      notes || null
    ]
  );
}

async function createAdmissionJob({
  institutionId,
  jobType,
  status = "Queued",
  progressPercent = 0,
  totalItems = 0,
  processedItems = 0,
  payload = null,
  result = null,
  errorMessage = null,
  createdByUserId = null,
  userId = null,
  startedAt = null,
  completedAt = null
}) {
  const actorUserId = createdByUserId ?? userId ?? null;
  const resultInsert = await query(
    `INSERT INTO admission_jobs
      (institution_id, job_type, status, progress_percent, total_items, processed_items, payload_json, result_json, error_message, created_by_user_id, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      institutionId,
      jobType,
      status,
      progressPercent,
      totalItems,
      processedItems,
      payload ? JSON.stringify(payload) : null,
      result ? JSON.stringify(result) : null,
      errorMessage || null,
      actorUserId,
      startedAt,
      completedAt
    ]
  );
  return resultInsert.insertId;
}

async function updateAdmissionJob(jobId, changes = {}) {
  const columnMap = {
    status: "status",
    progressPercent: "progress_percent",
    totalItems: "total_items",
    processedItems: "processed_items",
    payload: "payload_json",
    result: "result_json",
    errorMessage: "error_message",
    startedAt: "started_at",
    completedAt: "completed_at"
  };
  const setParts = [];
  const params = [];
  Object.entries(changes).forEach(([key, value]) => {
    const column = columnMap[key];
    if (!column) return;
    setParts.push(`${column} = ?`);
    if (key === "payload" || key === "result") {
      params.push(value ? JSON.stringify(value) : null);
    } else {
      params.push(value ?? null);
    }
  });
  if (!setParts.length) return;
  setParts.push("updated_at = NOW()");
  await query(`UPDATE admission_jobs SET ${setParts.join(", ")} WHERE id = ?`, [...params, jobId]);
}

function normalizePaginationLimit(value, defaultValue = 100, maxValue = 500) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.max(1, Math.min(Math.round(numeric), maxValue));
}

function normalizePaginationOffset(value, defaultValue = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  return Math.max(0, Math.round(numeric));
}

function admissionLearnerSnapshot(row = {}) {
  return {
    id: row.id,
    institution_id: row.institution_id,
    full_name: row.full_name,
    first_name: row.first_name,
    middle_name: row.middle_name,
    last_name: row.last_name,
    other_names: row.other_names,
    admission_number: row.admission_number,
    date_of_admission: row.date_of_admission,
    grade: row.grade,
    form_name: row.form_name,
    stream: row.stream,
    assessment_number: row.assessment_number,
    upi_number: row.upi_number,
    birth_certificate_number: row.birth_certificate_number,
    date_of_birth: row.date_of_birth,
    gender: row.gender,
    passport_photo_path: row.passport_photo_path,
    religion: row.religion,
    nationality: row.nationality,
    county: row.county,
    sub_county: row.sub_county,
    location: row.location,
    sub_location: row.sub_location,
    village: row.village,
    year_joined: row.year_joined,
    term_joined: row.term_joined,
    orphan_condition: row.orphan_condition,
    status: row.status,
    parent_full_name: row.parent_full_name,
    parent_relationship: row.parent_relationship,
    parent_id_number: row.parent_id_number,
    parent_phone: row.parent_phone,
    parent_email: row.parent_email,
    deleted_at: row.deleted_at || null,
    deleted_by_user_id: row.deleted_by_user_id || null,
    updated_at: row.updated_at || null
  };
}

async function recordAdmissionVersion({
  institutionId,
  learnerId,
  action,
  changedByUserId,
  before = null,
  after = null,
  notes = null
}) {
  await query(
    `INSERT INTO admission_record_versions
      (institution_id, learner_id, version_action, changed_by_user_id, before_json, after_json, notes, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      institutionId,
      learnerId,
      action,
      changedByUserId || null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      notes || null
    ]
  );
}

async function softDeleteAdmissionLearner({ institutionId, learnerId, actorUserId, reason = null }) {
  const rows = await query(
    "SELECT * FROM learners WHERE id = ? AND institution_id = ? LIMIT 1",
    [learnerId, institutionId]
  );
  if (!rows.length) {
    throw new Error("Learner not found.");
  }
  const learner = rows[0];
  if (learner.deleted_at) {
    throw new Error("Learner already archived.");
  }
  const beforeSnapshot = admissionLearnerSnapshot(learner);
  await query(
    `UPDATE learners
     SET deleted_at = NOW(), deleted_by_user_id = ?, updated_at = NOW()
     WHERE id = ? AND institution_id = ?`,
    [actorUserId || null, learnerId, institutionId]
  );
  const afterSnapshot = { ...beforeSnapshot, deleted_at: dayjs().format("YYYY-MM-DD HH:mm:ss"), deleted_by_user_id: actorUserId || null };
  await recordAdmissionVersion({
    institutionId,
    learnerId,
    action: "SOFT_DELETE",
    changedByUserId: actorUserId,
    before: beforeSnapshot,
    after: afterSnapshot,
    notes: reason || "Soft deleted"
  });
  return learner;
}

async function restoreAdmissionLearner({ institutionId, learnerId, actorUserId, reason = null }) {
  const rows = await query(
    "SELECT * FROM learners WHERE id = ? AND institution_id = ? LIMIT 1",
    [learnerId, institutionId]
  );
  if (!rows.length) {
    throw new Error("Learner not found.");
  }
  const learner = rows[0];
  if (!learner.deleted_at) {
    throw new Error("Learner is active already.");
  }
  const beforeSnapshot = admissionLearnerSnapshot(learner);
  await query(
    `UPDATE learners
     SET deleted_at = NULL, deleted_by_user_id = NULL, updated_at = NOW()
     WHERE id = ? AND institution_id = ?`,
    [learnerId, institutionId]
  );
  const afterSnapshot = { ...beforeSnapshot, deleted_at: null, deleted_by_user_id: null };
  await recordAdmissionVersion({
    institutionId,
    learnerId,
    action: "RESTORE",
    changedByUserId: actorUserId,
    before: beforeSnapshot,
    after: afterSnapshot,
    notes: reason || "Restored from recycle bin"
  });
  return learner;
}

async function parseAdmissionImportFile({ absolutePath, originalName }) {
  const extension = path.extname(originalName || "").toLowerCase();
  const requiredHeaders = ADMISSION_IMPORT_REQUIRED_HEADERS;
  let parsedRecords = [];

  if (extension === ".xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(absolutePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new Error("Excel worksheet was not found in uploaded file.");
    }
    const headerCells = sheet.getRow(1).values.slice(1).map(extractSpreadsheetCellValue);
    const headerIndex = buildAdmissionHeaderIndex(headerCells.map(normalizeImportHeader));
    const missingHeaders = requiredHeaders.filter((header) => !headerIndex[header]);
    if (missingHeaders.length) {
      throw new Error(`Missing required header columns: ${missingHeaders.join(", ")}`);
    }
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const rawRecord = {};
      ADMISSION_IMPORT_HEADERS.forEach((header) => {
        const cellIndex = headerIndex[header];
        if (cellIndex) {
          rawRecord[header] = extractSpreadsheetCellValue(row.getCell(cellIndex).value);
        }
      });
      const hasAnyValue = Object.values(rawRecord).some(
        (value) => value !== null && value !== undefined && String(value).trim() !== ""
      );
      if (!hasAnyValue) continue;
      parsedRecords.push({ rowNumber, values: rawRecord });
    }
    return { sourceFormat: extension, parsedRecords };
  }

  if (extension === ".csv") {
    const csvText = fs.readFileSync(absolutePath, "utf8");
    const parsed = parseCsvText(csvText);
    const headerIndex = buildAdmissionHeaderIndex(parsed.headers);
    const missingHeaders = requiredHeaders.filter((header) => !headerIndex[header]);
    if (missingHeaders.length) {
      throw new Error(`Missing required header columns: ${missingHeaders.join(", ")}`);
    }
    parsedRecords = parsed.rows
      .map((row) => {
        const rawRecord = {};
        ADMISSION_IMPORT_HEADERS.forEach((header) => {
          const idx = headerIndex[header];
          if (idx) rawRecord[header] = row.values[idx - 1] ?? null;
        });
        const hasAnyValue = Object.values(rawRecord).some(
          (value) => value !== null && value !== undefined && String(value).trim() !== ""
        );
        if (!hasAnyValue) return null;
        return { rowNumber: row.rowNumber, values: rawRecord };
      })
      .filter(Boolean);
    return { sourceFormat: extension, parsedRecords };
  }

  throw new Error("Admission upload supports only .xlsx and .csv formats.");
}

async function buildAdmissionDryRunSummary({ records = [], institutionId }) {
  const acceptedRecords = [];
  const rejectedRows = [];
  records.forEach((record) => {
    const learner = normalizeLearnerPayload(record.values);
    const validationError = validateLearnerPayload(learner);
    if (validationError) {
      rejectedRows.push({ row: record.rowNumber, reason: validationError });
      return;
    }
    acceptedRecords.push({
      rowNumber: record.rowNumber,
      values: learner
    });
  });

  const uniqueAdmissions = [
    ...new Set(
      acceptedRecords
        .map((record) => normalizeText(record.values.admission_number))
        .filter(Boolean)
    )
  ];
  let existingCount = 0;
  if (uniqueAdmissions.length) {
    const placeholders = uniqueAdmissions.map(() => "?").join(", ");
    const [row] = await query(
      `SELECT COUNT(*) total FROM learners
       WHERE institution_id = ? AND deleted_at IS NULL
         AND admission_number IN (${placeholders})`,
      [institutionId, ...uniqueAdmissions]
    );
    existingCount = Number(row?.total || 0);
  }

  return {
    acceptedRecords,
    rejectedRows,
    summary: {
      totalRows: records.length,
      acceptedRows: acceptedRecords.length,
      rejectedRows: rejectedRows.length,
      estimatedInserts: Math.max(0, acceptedRecords.length - existingCount),
      estimatedUpdates: Math.min(existingCount, acceptedRecords.length)
    }
  };
}

function normalizeAdmissionImportRecords(records) {
  if (Array.isArray(records)) return records;
  if (records && Array.isArray(records.parsedRecords)) return records.parsedRecords;
  return [];
}

async function evaluateAdmissionDryRun({ records = [], institutionId }) {
  const normalizedRecords = normalizeAdmissionImportRecords(records);
  const dryRun = await buildAdmissionDryRunSummary({
    records: normalizedRecords,
    institutionId
  });
  return {
    totalRows: dryRun.summary.totalRows,
    validRows: dryRun.summary.acceptedRows,
    invalidRows: dryRun.summary.rejectedRows,
    estimatedInserts: dryRun.summary.estimatedInserts,
    estimatedUpdates: dryRun.summary.estimatedUpdates,
    acceptedRecords: dryRun.acceptedRecords,
    rejectedRows: dryRun.rejectedRows
  };
}

async function applyAdmissionRecordsWithJob({ records = [], institutionId, userId, jobId = null }) {
  const normalizedRecords = normalizeAdmissionImportRecords(records);
  const { insertedOrUpdated, rejectedRows } = await upsertAdmissionRows({
    records: normalizedRecords,
    institutionId,
    userId
  });
  const rejectionReportPath = saveAdmissionRejectionReport(rejectedRows);
  const result = {
    totalRows: normalizedRecords.length,
    insertedOrUpdated,
    rejectedRows,
    rejectionReportPath
  };
  if (jobId) {
    await updateAdmissionJob(jobId, {
      processedItems: result.totalRows,
      result
    });
  }
  return result;
}

function normalizeAdmissionJobRow(row = {}) {
  return {
    id: row.id,
    institution_id: row.institution_id,
    job_type: row.job_type,
    status: row.status,
    progress_percent: Number(row.progress_percent || 0),
    total_items: Number(row.total_items || 0),
    processed_items: Number(row.processed_items || 0),
    payload_json: safeJsonParse(row.payload_json, null),
    result_json: safeJsonParse(row.result_json, null),
    error_message: row.error_message || null,
    created_by_user_id: row.created_by_user_id || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

const ADMISSION_SENSITIVE_STATUS = new Set(["Transferred", "Alumni", "Deceased"]);

function normalizeAdmissionKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function inferAdmissionNumberFromFilename(fileName) {
  const nameOnly = String(fileName || "").replace(/\.[^/.]+$/, "");
  return nameOnly.trim();
}

function buildAdmissionRejectionReportCsv(rejectedRows = []) {
  const escapeCsv = (value) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = ["row,reason"];
  rejectedRows.forEach((item) => {
    lines.push(`${escapeCsv(item.row)},${escapeCsv(item.reason)}`);
  });
  return lines.join("\n");
}

function saveAdmissionRejectionReport(rejectedRows = []) {
  if (!rejectedRows.length) return null;
  const reportFileName = `admission-rejected-${Date.now()}.csv`;
  const reportPath = path.join(uploadsPath, reportFileName);
  fs.writeFileSync(reportPath, buildAdmissionRejectionReportCsv(rejectedRows), "utf8");
  return `/uploads/${reportFileName}`;
}

function isSupportedImageFileName(fileName) {
  const extension = path.extname(String(fileName || "").toLowerCase());
  return [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".webp",
    ".tif",
    ".tiff",
    ".heic",
    ".heif",
    ".raw"
  ].includes(extension);
}

function mimeTypeFromFileName(fileName) {
  const extension = path.extname(String(fileName || "").toLowerCase());
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".webp":
      return "image/webp";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    default:
      return "application/octet-stream";
  }
}

function extractZipPhotosToUploads(zipAbsolutePath) {
  const zip = new AdmZip(zipAbsolutePath);
  const extractedFiles = [];

  zip.getEntries().forEach((entry) => {
    if (entry.isDirectory) return;
    const originalName = path.basename(entry.entryName || "");
    if (!originalName || !isSupportedImageFileName(originalName)) return;

    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storedName = `${Date.now()}-${Math.round(Math.random() * 100000)}-${safeName}`;
    const absolutePath = path.join(uploadsPath, storedName);
    fs.writeFileSync(absolutePath, entry.getData());

    extractedFiles.push({
      originalname: originalName,
      filename: storedName,
      path: absolutePath,
      mimetype: mimeTypeFromFileName(originalName)
    });
  });

  return extractedFiles;
}

async function mapAdmissionPhotosFromFiles({ files, institutionId, learnerIndex }) {
  let matchedCount = 0;
  const rejectedFiles = [];

  for (const file of files) {
    const isImage =
      String(file.mimetype || "").startsWith("image/") || isSupportedImageFileName(file.originalname);

    if (!isImage) {
      rejectedFiles.push({
        file: file.originalname,
        reason: "Only image files are accepted."
      });
      if (file.path) fs.unlink(file.path, () => {});
      continue;
    }

    const inferredAdmission = inferAdmissionNumberFromFilename(file.originalname);
    const normalizedAdmission = normalizeAdmissionKey(inferredAdmission);
    const learner = learnerIndex.get(normalizedAdmission);

    if (!learner) {
      rejectedFiles.push({
        file: file.originalname,
        reason: "No learner matches this filename. Use admission number as filename (example: ADM001.jpg)."
      });
      if (file.path) fs.unlink(file.path, () => {});
      continue;
    }

    const filePath = `/uploads/${file.filename}`;
    await query(
      "UPDATE learners SET passport_photo_path = ?, updated_at = NOW() WHERE id = ? AND institution_id = ?",
      [filePath, learner.id, institutionId]
    );
    matchedCount += 1;
  }

  return { matchedCount, rejectedFiles };
}

function normalizeLearnerPayload(input = {}) {
  const data = { ...input };
  const firstName = normalizeText(data.first_name);
  const middleName = normalizeText(data.middle_name);
  const lastName = normalizeText(data.last_name);
  const otherNames = normalizeText(data.other_names);
  const providedFullName = normalizeText(data.full_name);

  data.first_name = firstName;
  data.middle_name = middleName;
  data.last_name = lastName;
  data.other_names = otherNames;
  data.full_name = providedFullName || [firstName, middleName, lastName, otherNames].filter(Boolean).join(" ");

  const grade = normalizeText(data.grade);
  const formName = normalizeText(data.form_name);
  if (grade) {
    data.grade = grade;
    data.form_name = null;
  } else if (formName) {
    data.form_name = formName;
    data.grade = null;
  } else {
    data.grade = null;
    data.form_name = null;
  }

  data.admission_number = normalizeText(data.admission_number);
  data.stream = normalizeText(data.stream);
  data.assessment_number = normalizeText(data.assessment_number);
  data.upi_number = normalizeText(data.upi_number);
  data.birth_certificate_number = normalizeText(data.birth_certificate_number);
  data.gender = normalizeText(data.gender);
  data.passport_photo_path = normalizeText(data.passport_photo_path);
  data.religion = normalizeText(data.religion);
  data.nationality = normalizeText(data.nationality);
  data.county = normalizeText(data.county);
  data.sub_county = normalizeText(data.sub_county);
  data.location = normalizeText(data.location);
  data.sub_location = normalizeText(data.sub_location);
  data.village = normalizeText(data.village);
  data.term_joined = normalizeText(data.term_joined);
  data.orphan_condition = normalizeText(data.orphan_condition);
  data.status = normalizeText(data.status);
  data.parent_full_name = normalizeText(data.parent_full_name);
  data.parent_relationship = normalizeText(data.parent_relationship);
  data.parent_id_number = normalizeText(data.parent_id_number);
  data.parent_phone = normalizeText(data.parent_phone);
  data.parent_email = normalizeText(data.parent_email);

  data.year_joined = normalizeYear(data.year_joined);
  data.date_of_admission = normalizeDate(data.date_of_admission);
  data.date_of_birth = normalizeDate(data.date_of_birth);

  return data;
}

function admissionStatusSortOrder(status) {
  switch (status) {
    case "In Session":
      return 1;
    case "Not in Session":
      return 2;
    case "Transferred":
      return 3;
    case "Alumni":
      return 4;
    case "Deceased":
      return 5;
    default:
      return 99;
  }
}

function formatLearnerStatusRows(rows = []) {
  return rows.map((row) => ({
    ...row,
    status_color: ADMISSION_STATUS_HEX[row.status] || "#6d6d6d",
    status_sort_order: admissionStatusSortOrder(row.status)
  }));
}

function admissionCompletenessIndicators(learner = {}) {
  const indicators = [
    { key: "first_name", label: "First name" },
    { key: "last_name", label: "Last name" },
    { key: "admission_number", label: "Admission number" },
    { key: "birth_certificate_number", label: "Birth certificate number" },
    { key: "status", label: "Status" },
    { key: "date_of_admission", label: "Date of admission" },
    { key: "date_of_birth", label: "Date of birth" },
    { key: "gender", label: "Gender" },
    { key: "parent_full_name", label: "Parent name" },
    { key: "parent_phone", label: "Parent phone" },
    { key: "passport_photo_path", label: "Passport photo" }
  ];
  const classSectionAvailable = Boolean(normalizeText(learner.grade) || normalizeText(learner.form_name));
  const missing = indicators
    .filter((indicator) => !normalizeText(learner[indicator.key]))
    .map((indicator) => indicator.label);
  if (!classSectionAvailable) {
    missing.push("Class section (Grade or Form)");
  }
  const completed = indicators.length + 1 - missing.length;
  const total = indicators.length + 1;
  const percentage = total ? Math.round((completed / total) * 100) : 0;
  return { missing, completed, total, percentage };
}

function admissionGuideStepFlags(summary = {}) {
  const stats = {
    hasLearners: Number(summary.totalLearners || 0) > 0,
    hasMostlyCompleteRecords: Number(summary.averageCompleteness || 0) >= 70,
    hasPhotos: Number(summary.withPhotos || 0) > 0,
    hasParentsContacts: Number(summary.withParentContact || 0) > 0
  };
  return [
    {
      key: "step-1",
      title: "Create at least one learner record",
      done: stats.hasLearners
    },
    {
      key: "step-2",
      title: "Reach at least 70% average record completeness",
      done: stats.hasMostlyCompleteRecords
    },
    {
      key: "step-3",
      title: "Upload learner photos",
      done: stats.hasPhotos
    },
    {
      key: "step-4",
      title: "Capture parent/guardian contacts",
      done: stats.hasParentsContacts
    },
    {
      key: "step-5",
      title: "Run Admission Integrity Audit",
      done: Number(summary.invalidStatusCount || 0) === 0 && Number(summary.missingParentContactsCount || 0) === 0
    }
  ];
}

function admissionCompletenessSummary(profiles = []) {
  const totals = profiles.reduce(
    (acc, item) => {
      acc.totalLearners += 1;
      acc.completenessSum += Number(item.completeness_percentage || 0);
      if (Number(item.completeness_percentage || 0) >= 90) acc.highCompleteness += 1;
      if (Number(item.completeness_percentage || 0) >= 70) acc.mediumCompleteness += 1;
      if (normalizeText(item.passport_photo_path)) acc.withPhotos += 1;
      if (normalizeText(item.parent_phone) || normalizeText(item.parent_email)) acc.withParentContact += 1;
      if (!ADMISSION_STATUS.includes(normalizeText(item.status))) acc.invalidStatusCount += 1;
      if (!normalizeText(item.parent_phone) && !normalizeText(item.parent_email)) {
        acc.missingParentContactsCount += 1;
      }
      return acc;
    },
    {
      totalLearners: 0,
      completenessSum: 0,
      highCompleteness: 0,
      mediumCompleteness: 0,
      withPhotos: 0,
      withParentContact: 0,
      invalidStatusCount: 0,
      missingParentContactsCount: 0
    }
  );

  const averageCompleteness = totals.totalLearners
    ? Math.round(totals.completenessSum / totals.totalLearners)
    : 0;

  return {
    totalLearners: totals.totalLearners,
    averageCompleteness,
    highCompleteness: totals.highCompleteness,
    mediumCompleteness: totals.mediumCompleteness,
    withPhotos: totals.withPhotos,
    withParentContact: totals.withParentContact,
    invalidStatusCount: totals.invalidStatusCount,
    missingParentContactsCount: totals.missingParentContactsCount
  };
}

function buildAdmissionCompletenessCsv({ statusFilter = null, onlyIncomplete = false, summary = {}, learners = [] }) {
  const escapeCsv = (value) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [
    `Generated At,${escapeCsv(dayjs().format("YYYY-MM-DD HH:mm"))}`,
    `Status Filter,${escapeCsv(statusFilter || "All statuses")}`,
    `Only Incomplete,${escapeCsv(onlyIncomplete ? "Yes" : "No")}`,
    `Total Learners,${escapeCsv(summary.totalLearners || 0)}`,
    `Average Completeness,${escapeCsv(`${summary.averageCompleteness || 0}%`)}`,
    `90%+ Complete,${escapeCsv(summary.highCompleteness || 0)}`,
    `70%+ Complete,${escapeCsv(summary.mediumCompleteness || 0)}`,
    `With Photos,${escapeCsv(summary.withPhotos || 0)}`,
    `With Parent Contact,${escapeCsv(summary.withParentContact || 0)}`,
    `Invalid Status Count,${escapeCsv(summary.invalidStatusCount || 0)}`,
    `Missing Parent Contacts Count,${escapeCsv(summary.missingParentContactsCount || 0)}`,
    "",
    "Learner Name,Admission Number,Status,Class Section,Parent Contact,Completeness %,Missing Fields"
  ];

  learners.forEach((learner) => {
    const classSection = [learner.grade || learner.form_name || "", learner.stream || ""].join(" ").trim();
    const parentContact = learner.parent_phone || learner.parent_email || "";
    const missingFields = Array.isArray(learner.missing_fields) ? learner.missing_fields.join("; ") : "";
    lines.push(
      [
        learner.first_name || learner.full_name || "",
        learner.admission_number || "",
        learner.status || "",
        classSection,
        parentContact,
        `${Number(learner.completeness_percentage || 0)}%`,
        missingFields
      ]
        .map(escapeCsv)
        .join(",")
    );
  });

  return lines.join("\n");
}

function admissionReadinessLabel(score) {
  if (score >= 90) return "Ready";
  if (score >= 75) return "Near Ready";
  if (score >= 60) return "Needs Cleanup";
  return "Critical";
}

function topMissingAdmissionFields(learners = []) {
  const counts = new Map();
  learners.forEach((learner) => {
    (learner.missing_fields || []).forEach((fieldName) => {
      const key = String(fieldName || "").trim();
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12);
}

async function buildAdmissionCompletenessDataset({
  institutionId,
  statusFilter = null,
  onlyIncomplete = false
}) {
  const params = [institutionId];
  let where = "WHERE institution_id = ?";
  if (statusFilter) {
    where += " AND status = ?";
    params.push(statusFilter);
  }

  const rows = await query(
    `SELECT *
     FROM learners
     ${where}
     ORDER BY ${ADMISSION_STATUS_ORDER_SQL}`,
    params
  );

  let profiles = rows.map((row) => {
    const completeness = admissionCompletenessIndicators(row);
    return {
      id: row.id,
      full_name: row.full_name,
      first_name: row.first_name,
      admission_number: row.admission_number,
      status: row.status,
      grade: row.grade,
      form_name: row.form_name,
      stream: row.stream,
      upi_number: row.upi_number,
      assessment_number: row.assessment_number,
      birth_certificate_number: row.birth_certificate_number,
      passport_photo_path: row.passport_photo_path,
      parent_phone: row.parent_phone,
      parent_email: row.parent_email,
      parent_full_name: row.parent_full_name,
      completeness_percentage: completeness.percentage,
      missing_fields: completeness.missing
    };
  });

  if (onlyIncomplete) {
    profiles = profiles.filter(
      (item) => Array.isArray(item.missing_fields) && item.missing_fields.length > 0
    );
    profiles.sort(
      (a, b) =>
        Number(a.completeness_percentage || 0) - Number(b.completeness_percentage || 0) ||
        String(a.first_name || a.full_name || "").localeCompare(String(b.first_name || b.full_name || ""))
    );
  }

  const summary = admissionCompletenessSummary(profiles);
  return {
    statusFilter: statusFilter || null,
    onlyIncomplete: Boolean(onlyIncomplete),
    summary,
    learners: profiles
  };
}

function colorFromHex(hex) {
  const normalized = String(hex || "#6d6d6d").replace("#", "");
  const safe = normalized.length === 6 ? normalized : "6d6d6d";
  const value = parseInt(safe, 16);
  return [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255
  ];
}

function normalizeExcelCellValue(cellValue) {
  if (cellValue === undefined || cellValue === null) return null;
  if (typeof cellValue === "object") {
    if (cellValue instanceof Date) return dayjs(cellValue).format("YYYY-MM-DD");
    if (Object.prototype.hasOwnProperty.call(cellValue, "result")) return cellValue.result;
    if (Object.prototype.hasOwnProperty.call(cellValue, "text")) return cellValue.text;
    if (Array.isArray(cellValue.richText)) {
      return cellValue.richText.map((part) => part.text).join("");
    }
  }
  return cellValue;
}

function validateLearnerPayload(data) {
  if (!data.first_name) return "First name is required.";
  if (!data.last_name) return "Last name is required.";
  if (!data.admission_number) return "Admission number is required.";
  if (!data.birth_certificate_number) return "Birth certificate number is required.";
  if (!data.grade && !data.form_name) {
    return "Select either Grade or Form.";
  }
  if (!data.status) return "Status is required.";
  if (data.status && !ADMISSION_STATUS.includes(data.status)) {
    return `Status must be one of: ${ADMISSION_STATUS.join(", ")}`;
  }
  if (data.gender && !GENDER_OPTIONS.includes(data.gender)) {
    return `Gender must be one of: ${GENDER_OPTIONS.join(", ")}`;
  }
  if (data.parent_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.parent_email)) {
    return "Parent email is invalid.";
  }
  if (data.year_joined !== null && (data.year_joined < 1900 || data.year_joined > 2100)) {
    return "Year joined must be between 1900 and 2100.";
  }
  return null;
}

async function upsertLearnerRecord({ institutionId, userId, payload }) {
  const existing = await query(
    "SELECT id FROM learners WHERE institution_id = ? AND admission_number = ? LIMIT 1",
    [institutionId, payload.admission_number]
  );

  const fields = [
    "full_name",
    "first_name",
    "middle_name",
    "last_name",
    "other_names",
    "admission_number",
    "date_of_admission",
    "grade",
    "form_name",
    "stream",
    "assessment_number",
    "upi_number",
    "birth_certificate_number",
    "date_of_birth",
    "gender",
    "passport_photo_path",
    "religion",
    "nationality",
    "county",
    "sub_county",
    "location",
    "sub_location",
    "village",
    "year_joined",
    "term_joined",
    "orphan_condition",
    "status",
    "conduct_status",
    "parent_full_name",
    "parent_relationship",
    "parent_id_number",
    "parent_phone",
    "parent_email"
  ];

  if (existing.length) {
    const setClause = fields.map((column) => `${column} = ?`).join(", ");
    await query(
      `UPDATE learners
       SET ${setClause}, updated_at = NOW()
       WHERE id = ? AND institution_id = ?`,
      [...fields.map((field) => payload[field] ?? null), existing[0].id, institutionId]
    );
    return { mode: "updated", id: existing[0].id };
  }

  const insertData = {
    institution_id: institutionId,
    ...payload,
    created_by_user_id: userId
  };
  const columns = Object.keys(insertData);
  const placeholders = columns.map(() => "?").join(", ");
  const result = await query(
    `INSERT INTO learners (${columns.join(", ")}) VALUES (${placeholders})`,
    columns.map((column) => insertData[column] ?? null)
  );
  return { mode: "created", id: result.insertId };
}

async function createOtpSession({ identity, role, institutionId, payload, destination, channel }) {
  const code = generateOtpCode();
  const expiresAt = buildOtpExpiry();
  await query(
    `INSERT INTO otp_sessions
      (session_id, identity_value, role_name, institution_id, payload_json, otp_code, expires_at, otp_channel, destination)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      identity,
      role,
      institutionId,
      JSON.stringify(payload),
      code,
      expiresAt,
      channel,
      destination
    ]
  );
  await sendOtp({ channel, destination, code });
}

async function authenticateByUserTable(username, password) {
  const users = await query(
    "SELECT * FROM users WHERE username = ? AND is_active = 1 LIMIT 1",
    [username]
  );
  if (!users.length) {
    return null;
  }
  const user = users[0];
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return null;
  }
  const normalizedRole = normalizeRoleValue(user.role);

  return {
    identity: user.username,
    role: normalizedRole || user.role,
    institution_id: user.institution_id,
    destination: user.email || user.phone || user.username,
    payload: {
      id: user.id,
      role: normalizedRole || user.role,
      institution_id: user.institution_id,
      full_name: user.full_name,
      username: user.username
    }
  };
}

async function authenticateParentByLearner(username, password) {
  const learners = await query(
    `SELECT id, institution_id, full_name, parent_full_name, parent_phone, parent_email, parent_id_number
     FROM learners
     WHERE birth_certificate_number = ? AND parent_id_number = ? LIMIT 1`,
    [username, password]
  );

  if (!learners.length) {
    return null;
  }

  const learner = learners[0];
  return {
    identity: username,
    role: ROLES.PARENT,
    institution_id: learner.institution_id,
    destination: learner.parent_email || learner.parent_phone || username,
    payload: {
      id: `PARENT-${learner.id}`,
      role: ROLES.PARENT,
      institution_id: learner.institution_id,
      learner_id: learner.id,
      learner_name: learner.full_name,
      full_name: learner.parent_full_name || "Parent User",
      username
    }
  };
}

async function authenticateLearner(username, password) {
  const learners = await query(
    `SELECT id, institution_id, full_name, upi_number, assessment_number, birth_certificate_number,
            learner_password_hash, parent_phone, parent_email
     FROM learners
     WHERE upi_number = ? OR assessment_number = ? OR birth_certificate_number = ?
     LIMIT 1`,
    [username, username, username]
  );

  if (!learners.length) {
    return null;
  }

  const learner = learners[0];
  const valid = learner.learner_password_hash
    ? await verifyPassword(password, learner.learner_password_hash)
    : password === "1234";
  if (!valid) {
    return null;
  }

  return {
    identity: username,
    role: ROLES.LEARNER,
    institution_id: learner.institution_id,
    destination: learner.parent_email || learner.parent_phone || username,
    payload: {
      id: `LEARNER-${learner.id}`,
      role: ROLES.LEARNER,
      institution_id: learner.institution_id,
      learner_id: learner.id,
      full_name: learner.full_name,
      username
    }
  };
}

async function getPaginatedRows({
  table,
  institutionId,
  searchFields,
  q,
  extraWhere = "",
  extraParams = [],
  orderBy = "id DESC",
  limit = 50,
  offset = 0
}) {
  const search = buildSearchWhere({
    fields: searchFields,
    queryValue: q,
    params: [institutionId, ...extraParams]
  });
  const sql = `SELECT * FROM ${table}
               WHERE institution_id = ? ${extraWhere}${search.where}
               ORDER BY ${orderBy}
               LIMIT ? OFFSET ?`;
  return query(sql, [...search.params, Number(limit), Number(offset)]);
}

function normalizeDateTime(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = dayjs(value);
  if (!parsed.isValid()) return null;
  return parsed.format("YYYY-MM-DD HH:mm:ss");
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function computeCbcBand(mark) {
  const score = Number(mark);
  if (!Number.isFinite(score)) return null;
  if (score >= 75) return "EE";
  if (score >= 50) return "ME";
  if (score >= 25) return "AE";
  return "BE";
}

async function ensureEntityExists({ table, id, institutionId, label }) {
  if (id === undefined || id === null || id === "") return false;
  const rows = await query(
    `SELECT id FROM ${table} WHERE id = ? AND institution_id = ? LIMIT 1`,
    [id, institutionId]
  );
  if (!rows.length) {
    throw new Error(`${label} with id ${id} was not found for this institution.`);
  }
  return true;
}

function normalizeGenericModulePayload(config, input = {}, options = {}) {
  const isCreate = Boolean(options.isCreate);
  const data = { ...input };

  config.fields.forEach((fieldName) => {
    if (!Object.prototype.hasOwnProperty.call(data, fieldName)) return;
    if (typeof data[fieldName] === "string") {
      data[fieldName] = normalizeText(data[fieldName]);
    }
  });

  switch (config.table) {
    case "teacher_resources":
      data.teacher_profile_id = toNumberOrNull(data.teacher_profile_id);
      break;
    case "attendance_records":
      data.attendance_date = normalizeDateTime(data.attendance_date);
      data.time_in = normalizeDateTime(data.time_in);
      data.time_out = normalizeDateTime(data.time_out);
      break;
    case "academic_exams":
      data.year = normalizeYear(data.year);
      break;
    case "academic_marks":
      data.learner_id = toNumberOrNull(data.learner_id);
      data.marks = toNumberOrNull(data.marks);
      data.percentage = toNumberOrNull(data.percentage);
      data.year = normalizeYear(data.year);
      if (data.marks !== null) {
        if (data.percentage === null) {
          data.percentage = data.marks;
        }
        data.cbc_grade_band = computeCbcBand(data.marks);
      }
      break;
    case "hr_leave_requests":
      data.staff_profile_id = toNumberOrNull(data.staff_profile_id);
      data.applied_by_user_id = toNumberOrNull(data.applied_by_user_id);
      data.approved_by_user_id = toNumberOrNull(data.approved_by_user_id);
      data.start_date = normalizeDate(data.start_date);
      data.end_date = normalizeDate(data.end_date);
      break;
    case "finance_fee_structures":
      data.year = normalizeYear(data.year);
      data.amount_required = toNumberOrNull(data.amount_required);
      break;
    case "finance_fee_payments":
      data.learner_id = toNumberOrNull(data.learner_id);
      data.amount_paid = toNumberOrNull(data.amount_paid);
      data.balance_after_payment = toNumberOrNull(data.balance_after_payment);
      data.payment_date = normalizeDateTime(data.payment_date);
      if (isCreate && !data.receipt_number) {
        data.receipt_number = `RCPT-${Date.now()}`;
      }
      break;
    case "finance_procurement_records":
      data.quantity = toNumberOrNull(data.quantity);
      data.amount = toNumberOrNull(data.amount);
      data.document_date = normalizeDate(data.document_date);
      data.due_date = normalizeDate(data.due_date);
      if (isCreate && !data.document_number) {
        const prefix = (data.document_type || "DOC").replace(/\s+/g, "").toUpperCase();
        data.document_number = `${prefix}-${Date.now()}`;
      }
      break;
    case "communication_messages":
      data.sent_at = normalizeDateTime(data.sent_at);
      data.status = data.status || "Queued";
      if (data.status === "Sent" && !data.sent_at) {
        data.sent_at = dayjs().format("YYYY-MM-DD HH:mm:ss");
      }
      break;
    case "communication_announcements":
      data.start_date = normalizeDate(data.start_date);
      data.end_date = normalizeDate(data.end_date);
      break;
    case "learner_resources":
      data.uploaded_by_user_id = toNumberOrNull(data.uploaded_by_user_id);
      break;
    case "welfare_members":
      data.joined_date = normalizeDate(data.joined_date);
      break;
    case "welfare_contributions":
      data.member_id = toNumberOrNull(data.member_id);
      data.amount = toNumberOrNull(data.amount);
      data.payment_date = normalizeDate(data.payment_date);
      break;
    case "welfare_loans":
      data.member_id = toNumberOrNull(data.member_id);
      data.amount = toNumberOrNull(data.amount);
      data.application_date = normalizeDate(data.application_date);
      data.return_date = normalizeDate(data.return_date);
      break;
    case "laws_regulations_policies":
      data.effective_date = normalizeDate(data.effective_date);
      break;
    case "non_teaching_staff_profiles":
      if (isCreate && !data.staff_number) {
        data.staff_number = `NTS-${Date.now()}`;
      }
      break;
    default:
      break;
  }

  return data;
}

async function validateGenericModulePayload({ config, data, institutionId, isCreate = true }) {
  if (config.table === "teacher_profiles") {
    if (!data.full_name) return "Teacher full name is required.";
    if (!data.tsc_number) return "TSC number is required.";
    if (!data.id_number) return "Teacher ID number is required.";
  }

  if (config.table === "non_teaching_staff_profiles") {
    if (!data.full_name) return "Non-teaching staff full name is required.";
    if (!data.staff_number) return "Staff number is required.";
  }

  if (config.table === "teacher_resources") {
    if (!data.resource_type) return "Resource type is required.";
    if (!data.title) return "Resource title is required.";
    if (data.teacher_profile_id !== null) {
      await ensureEntityExists({
        table: "teacher_profiles",
        id: data.teacher_profile_id,
        institutionId,
        label: "Teacher profile"
      });
    }
  }

  if (config.table === "attendance_records") {
    if (!ATTENDANCE_TYPES.includes(data.attendance_type)) {
      return `Attendance type must be one of: ${ATTENDANCE_TYPES.join(", ")}`;
    }
    if (!data.person_name) return "Person name is required.";
    if (!data.attendance_date) return "Attendance date is required.";
    if (!ATTENDANCE_STATUS_OPTIONS.includes(data.status)) {
      return `Attendance status must be one of: ${ATTENDANCE_STATUS_OPTIONS.join(", ")}`;
    }
  }

  if (config.table === "academic_exams") {
    if (!data.title) return "Exam title is required.";
    if (data.term && !TERMS.includes(data.term)) {
      return `Exam term must be one of: ${TERMS.join(", ")}`;
    }
    if (data.year !== null && (data.year < 2000 || data.year > 2100)) {
      return "Exam year must be between 2000 and 2100.";
    }
  }

  if (config.table === "academic_marks") {
    if (data.learner_id === null) return "Learner ID is required.";
    if (!data.learner_name) return "Learner name is required.";
    if (!data.exam_type) return "Exam type is required.";
    if (!data.subject) return "Subject is required.";
    if (data.marks === null) return "Marks are required.";
    if (!EXAM_TYPES.includes(data.exam_type)) {
      return `Exam type must be one of: ${EXAM_TYPES.join(", ")}`;
    }
    if (data.term && !TERMS.includes(data.term)) {
      return `Term must be one of: ${TERMS.join(", ")}`;
    }
    if (data.marks < 0 || data.marks > 100) {
      return "Marks must be between 0 and 100.";
    }
    if (data.percentage !== null && (data.percentage < 0 || data.percentage > 100)) {
      return "Percentage must be between 0 and 100.";
    }
    await ensureEntityExists({
      table: "learners",
      id: data.learner_id,
      institutionId,
      label: "Learner"
    });
  }

  if (config.table === "hr_leave_requests") {
    if (!data.staff_name) return "Staff name is required.";
    if (!data.leave_type) return "Leave type is required.";
    if (!LEAVE_TYPES.includes(data.leave_type)) {
      return `Leave type must be one of: ${LEAVE_TYPES.join(", ")}`;
    }
    if (data.start_date && data.end_date && data.end_date < data.start_date) {
      return "Leave end date cannot be earlier than start date.";
    }
  }

  if (config.table === "hr_recruitment_records") {
    if (!data.record_type) return "Recruitment record type is required.";
  }

  if (config.table === "finance_fee_structures") {
    if (!data.grade) return "Fee structure grade is required.";
    if (!data.term) return "Fee structure term is required.";
    if (data.year === null) return "Fee structure year is required.";
    if (data.amount_required === null) return "Required fee amount is required.";
    if (!GRADES.includes(data.grade)) {
      return `Grade must be one of: ${GRADES.join(", ")}`;
    }
    if (!TERMS.includes(data.term)) {
      return `Term must be one of: ${TERMS.join(", ")}`;
    }
    if (data.amount_required <= 0) return "Required fee amount must be greater than zero.";
  }

  if (config.table === "finance_fee_payments") {
    if (data.learner_id === null) return "Learner ID is required.";
    if (!data.learner_name) return "Learner name is required.";
    if (data.amount_paid === null) return "Amount paid is required.";
    if (data.amount_paid <= 0) return "Amount paid must be greater than zero.";
    if (!data.payment_date) return "Payment date is required.";
    if (data.payment_method && !PAYMENT_METHOD_OPTIONS.includes(data.payment_method)) {
      return `Payment method must be one of: ${PAYMENT_METHOD_OPTIONS.join(", ")}`;
    }
    await ensureEntityExists({
      table: "learners",
      id: data.learner_id,
      institutionId,
      label: "Learner"
    });
  }

  if (config.table === "finance_procurement_records") {
    if (!data.document_type) return "Document type is required.";
    if (!DOCUMENT_CATEGORIES.PROCUREMENT.includes(data.document_type)) {
      return `Document type must be one of: ${DOCUMENT_CATEGORIES.PROCUREMENT.join(", ")}`;
    }
    if (!data.supplier_name) return "Supplier name is required.";
    if (data.quantity !== null && data.quantity < 0) return "Quantity cannot be negative.";
    if (data.amount !== null && data.amount < 0) return "Amount cannot be negative.";
    if (data.document_date && data.due_date && data.due_date < data.document_date) {
      return "Due date cannot be earlier than document date.";
    }
  }

  if (config.table === "communication_messages") {
    if (!data.message_type) return "Message type is required.";
    if (!data.recipient_contact) return "Recipient contact is required.";
    if (!data.message_body) return "Message body is required.";
    if (!MESSAGE_STATUS_OPTIONS.includes(data.status)) {
      return `Message status must be one of: ${MESSAGE_STATUS_OPTIONS.join(", ")}`;
    }
  }

  if (config.table === "communication_announcements") {
    if (!data.title) return "Announcement title is required.";
    if (!data.message) return "Announcement message is required.";
    if (data.start_date && data.end_date && data.end_date < data.start_date) {
      return "Announcement end date cannot be earlier than start date.";
    }
  }

  if (config.table === "learner_resources") {
    if (!data.title) return "Resource title is required.";
  }

  if (config.table === "welfare_members") {
    if (!data.member_name) return "Welfare member name is required.";
    if (!data.member_role) return "Welfare member role is required.";
  }

  if (config.table === "welfare_contributions") {
    if (data.member_id === null) return "Member ID is required.";
    if (!data.member_name) return "Member name is required.";
    if (!data.contribution_period) return "Contribution period is required.";
    if (data.amount === null || data.amount <= 0) {
      return "Contribution amount must be greater than zero.";
    }
    await ensureEntityExists({
      table: "welfare_members",
      id: data.member_id,
      institutionId,
      label: "Welfare member"
    });
  }

  if (config.table === "welfare_loans") {
    if (data.member_id === null) return "Member ID is required.";
    if (!data.member_name) return "Member name is required.";
    if (data.amount === null || data.amount <= 0) return "Loan amount must be greater than zero.";
    if (!data.application_date) return "Loan application date is required.";
    if (data.return_date && data.return_date < data.application_date) {
      return "Loan return date cannot be earlier than application date.";
    }
    await ensureEntityExists({
      table: "welfare_members",
      id: data.member_id,
      institutionId,
      label: "Welfare member"
    });
  }

  if (config.table === "laws_regulations_policies") {
    if (!data.document_category) return "Document category is required.";
    if (!DOCUMENT_CATEGORIES.LAW_POLICY.includes(data.document_category)) {
      return `Document category must be one of: ${DOCUMENT_CATEGORIES.LAW_POLICY.join(", ")}`;
    }
    if (!data.title) return "Document title is required.";
  }

  return null;
}

app.get("/api/meta", (_, res) => {
  res.json({
    roles: ROLES,
    permissions: PERMISSIONS,
    rolePermissions: ROLE_PERMISSIONS,
    gradeOptions: GRADES,
    formOptions: FORMS,
    termOptions: TERMS,
    genderOptions: GENDER_OPTIONS,
    admissionStatus: ADMISSION_STATUS,
    orphanStatus: ORPHAN_STATUS,
    relationshipOptions: RELATIONSHIP_OPTIONS,
    staffCategories: STAFF_CATEGORY,
    subjectOptions: SUBJECTS,
    examTypes: EXAM_TYPES,
    leaveTypes: LEAVE_TYPES,
    termsOfService: TERMS_OF_SERVICE,
    teacherResourceTypes: DOCUMENT_CATEGORIES.TEACHER_RESOURCE,
    legalDocumentCategories: DOCUMENT_CATEGORIES.LAW_POLICY,
    procurementDocumentTypes: DOCUMENT_CATEGORIES.PROCUREMENT,
    exportFormats: EXPORT_FORMATS
  });
});

app.get("/api/health", asyncHandler(async (_, res) => {
  await query("SELECT 1");
  res.json({ status: "ok", service: "IIMS API" });
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const { username, password, otpChannel } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  let account =
    (await authenticateByUserTable(username, password)) ||
    (await authenticateParentByLearner(username, password)) ||
    (await authenticateLearner(username, password));

  if (!account) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  const channel = otpChannel || process.env.OTP_CHANNEL || "console";
  await createOtpSession({
    identity: account.identity,
    role: account.role,
    institutionId: account.institution_id,
    payload: account.payload,
    destination: account.destination,
    channel
  });

  return res.json({
    message: "OTP sent successfully.",
    role: account.role,
    portal: toPortal(account.role)
  });
}));

app.post("/api/auth/verify-otp", asyncHandler(async (req, res) => {
  const { username, otp } = req.body;
  if (!username || !otp) {
    return res.status(400).json({ error: "Username and OTP are required." });
  }

  const sessions = await query(
    `SELECT * FROM otp_sessions
     WHERE identity_value = ? AND otp_code = ? AND is_used = 0 AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [username, otp]
  );

  if (!sessions.length) {
    return res.status(401).json({ error: "Invalid or expired OTP." });
  }

  const session = sessions[0];
  await query("UPDATE otp_sessions SET is_used = 1 WHERE id = ?", [session.id]);
  const payload = JSON.parse(session.payload_json);
  const token = issueToken(payload);
  await auditLog(payload, "LOGIN_SUCCESS", "auth", payload.id, { role: payload.role });

  res.json({
    token,
    role: payload.role,
    portal: toPortal(payload.role),
    user: payload
  });
}));

app.get("/api/portal/current", auth, (req, res) => {
  const normalizedRole = normalizeRoleValue(req.user.role);
  res.json({
    role: normalizedRole || req.user.role,
    portal: toPortal(normalizedRole || req.user.role),
    institution_id: req.user.institution_id,
    permissions: ROLE_PERMISSIONS[normalizedRole] || []
  });
});

app.post(
  "/api/uploads",
  auth,
  enforcePermission(PERMISSIONS.CREATE),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "File upload failed." });
    }
    await auditLog(req.user, "UPLOAD_FILE", "upload", null, { file: req.file.filename });
    res.json({
      fileName: req.file.filename,
      filePath: `/uploads/${req.file.filename}`,
      mimeType: req.file.mimetype
    });
  })
);

app.get(
  "/api/admission/learners/template/excel",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Learner Biodata Template");
    sheet.addRow(ADMISSION_IMPORT_HEADERS);
    sheet.addRow(ADMISSION_TEMPLATE_EXAMPLE_ROW);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((column) => {
      column.width = 20;
    });

    await auditLog(req.user, "DOWNLOAD_ADMISSION_TEMPLATE", "learners", null);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="admission-learner-template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  })
);

app.get(
  "/api/admission/learners/template/csv",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    await auditLog(req.user, "DOWNLOAD_ADMISSION_TEMPLATE_CSV", "learners", null);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="admission-learner-template.csv"');
    res.send(buildAdmissionTemplateCsvContent());
  })
);

app.post(
  "/api/admission/learners/bulk-upload",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "CSV or Excel file is required." });
    }

    const extension = path.extname(req.file.originalname || "").toLowerCase();
    const requiredHeaders = ADMISSION_IMPORT_REQUIRED_HEADERS;
    let parsedRecords = [];

    if (extension === ".xlsx") {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(req.file.path);
      const sheet = workbook.worksheets[0];
      if (!sheet) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: "Excel worksheet was not found in uploaded file." });
      }

      const headerCells = sheet.getRow(1).values.slice(1).map(extractSpreadsheetCellValue);
      const headerIndex = buildAdmissionHeaderIndex(headerCells.map(normalizeImportHeader));
      const missingHeaders = requiredHeaders.filter((header) => !headerIndex[header]);
      if (missingHeaders.length) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          error: `Missing required header columns: ${missingHeaders.join(", ")}`
        });
      }

      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const rawRecord = {};
        ADMISSION_IMPORT_HEADERS.forEach((header) => {
          const cellIndex = headerIndex[header];
          if (cellIndex) {
            rawRecord[header] = extractSpreadsheetCellValue(row.getCell(cellIndex).value);
          }
        });
        const hasAnyValue = Object.values(rawRecord).some(
          (value) => value !== null && value !== undefined && String(value).trim() !== ""
        );
        if (!hasAnyValue) continue;
        parsedRecords.push({ rowNumber, values: rawRecord });
      }
    } else if (extension === ".csv") {
      const csvText = fs.readFileSync(req.file.path, "utf8");
      const parsed = parseCsvText(csvText);
      const headerIndex = buildAdmissionHeaderIndex(parsed.headers);
      const missingHeaders = requiredHeaders.filter((header) => !headerIndex[header]);
      if (missingHeaders.length) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          error: `Missing required header columns: ${missingHeaders.join(", ")}`
        });
      }
      parsedRecords = parsed.rows
        .map((row) => {
          const rawRecord = {};
          ADMISSION_IMPORT_HEADERS.forEach((header) => {
            const idx = headerIndex[header];
            if (idx) {
              rawRecord[header] = row.values[idx - 1] ?? null;
            }
          });
          const hasAnyValue = Object.values(rawRecord).some(
            (value) => value !== null && value !== undefined && String(value).trim() !== ""
          );
          if (!hasAnyValue) return null;
          return { rowNumber: row.rowNumber, values: rawRecord };
        })
        .filter(Boolean);
    } else {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Admission upload supports only .xlsx and .csv formats." });
    }

    const { insertedOrUpdated, rejectedRows } = await upsertAdmissionRows({
      records: parsedRecords,
      institutionId: req.user.institution_id,
      userId: req.user.id
    });
    const rejectionReportPath = saveAdmissionRejectionReport(rejectedRows);

    fs.unlink(req.file.path, () => {});
    await auditLog(req.user, "BULK_UPLOAD_ADMISSION", "learners", null, {
      insertedOrUpdated,
      source_format: extension,
      rejected: rejectedRows.length,
      rejection_report: rejectionReportPath
    });
    res.json({
      message: "Admission bulk upload completed.",
      sourceFormat: extension,
      insertedOrUpdated,
      rejectedRows,
      rejectionReportPath
    });
  })
);

app.post(
  "/api/admission/learners/bulk-upload/dry-run",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "CSV or Excel file is required." });
    }
    let parseResult = null;
    try {
      parseResult = await parseAdmissionImportFile({
        absolutePath: req.file.path,
        originalName: req.file.originalname
      });
      const preview = await evaluateAdmissionDryRun({
        records: parseResult.parsedRecords,
        institutionId: req.user.institution_id
      });
      const reportPath = preview.rejectedRows.length
        ? saveAdmissionRejectionReport(preview.rejectedRows)
        : null;
      await auditLog(req.user, "DRY_RUN_ADMISSION_BULK_UPLOAD", "learners", null, {
        sourceFormat: parseResult.sourceFormat,
        totalRows: preview.totalRows,
        validRows: preview.validRows,
        estimatedInserts: preview.estimatedInserts,
        estimatedUpdates: preview.estimatedUpdates,
        rejectedRows: preview.rejectedRows.length
      });
      res.json({
        message: "Dry-run completed. Review the preview before applying import.",
        sourceFormat: parseResult.sourceFormat,
        preview,
        rejectionReportPath: reportPath
      });
    } finally {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
    }
  })
);

app.post(
  ["/api/admission/learners/bulk-upload/jobs", "/api/admission/jobs/import/apply"],
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "CSV or Excel file is required." });
    }
    const jobId = await createAdmissionJob({
      institutionId: req.user.institution_id,
      userId: req.user.id,
      jobType: "BULK_IMPORT_APPLY",
      payload: {
        originalName: req.file.originalname || null
      }
    });
    try {
      const parseResult = await parseAdmissionImportFile({
        absolutePath: req.file.path,
        originalName: req.file.originalname
      });
      await updateAdmissionJob(jobId, {
        status: "Running",
        progressPercent: 15,
        startedAt: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        payload: {
          originalName: req.file.originalname || null,
          sourceFormat: parseResult.sourceFormat
        }
      });
      const preview = await evaluateAdmissionDryRun({
        records: parseResult.parsedRecords,
        institutionId: req.user.institution_id
      });
      await updateAdmissionJob(jobId, {
        totalItems: preview.totalRows,
        processedItems: preview.validRows,
        progressPercent: 55,
        result: {
          preview
        }
      });

      const result = await applyAdmissionRecordsWithJob({
        records: parseResult.parsedRecords,
        institutionId: req.user.institution_id,
        userId: req.user.id,
        jobId
      });
      result.sourceFormat = parseResult.sourceFormat;
      result.preview = preview;
      await updateAdmissionJob(jobId, {
        status: "Completed",
        progressPercent: 100,
        processedItems: result.totalRows,
        completedAt: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        result
      });
      await auditLog(req.user, "QUEUE_APPLY_ADMISSION_BULK_UPLOAD", "admission_jobs", jobId, {
        sourceFormat: parseResult.sourceFormat,
        insertedOrUpdated: result.insertedOrUpdated,
        rejectedRows: result.rejectedRows.length
      });
      res.status(202).json({
        message: "Admission import job completed.",
        jobId,
        status: "Completed",
        result
      });
    } catch (error) {
      await updateAdmissionJob(jobId, {
        status: "Failed",
        progressPercent: 100,
        completedAt: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        errorMessage: error.message
      });
      throw error;
    } finally {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
    }
  })
);

app.get(
  "/api/admission/jobs",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const limit = normalizePaginationLimit(req.query.limit || 20, 20, 100);
    const offset = normalizePaginationOffset(req.query.offset || 0, 0);
    const rows = await query(
      `SELECT id, job_type, status, progress_percent, total_items, processed_items, payload_json, result_json, error_message,
              created_by_user_id, started_at, completed_at, created_at, updated_at
       FROM admission_jobs
       WHERE institution_id = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [req.user.institution_id, limit, offset]
    );
    const jobs = rows.map(normalizeAdmissionJobRow);
    const [countRow] = await query(
      "SELECT COUNT(*) total FROM admission_jobs WHERE institution_id = ?",
      [req.user.institution_id]
    );
    res.json({
      rows: jobs,
      pagination: {
        total: Number(countRow?.total || 0),
        limit,
        offset,
        returned: jobs.length,
        hasMore: offset + jobs.length < Number(countRow?.total || 0)
      }
    });
  })
);

app.get(
  "/api/admission/jobs/:id",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT *
       FROM admission_jobs
       WHERE id = ? AND institution_id = ?
       LIMIT 1`,
      [req.params.id, req.user.institution_id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Admission job not found." });
    }
    res.json(normalizeAdmissionJobRow(rows[0]));
  })
);

app.get(
  "/api/admission/learners/deleted",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const limit = normalizePaginationLimit(req.query.limit || 100, 100, 500);
    const offset = normalizePaginationOffset(req.query.offset || 0, 0);
    const rows = await query(
      `SELECT *
       FROM learners
       WHERE institution_id = ? AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [req.user.institution_id, limit, offset]
    );
    const [countRow] = await query(
      "SELECT COUNT(*) total FROM learners WHERE institution_id = ? AND deleted_at IS NOT NULL",
      [req.user.institution_id]
    );
    res.json({
      rows: formatLearnerStatusRows(rows),
      pagination: {
        total: Number(countRow?.total || 0),
        limit,
        offset,
        returned: rows.length,
        hasMore: offset + rows.length < Number(countRow?.total || 0)
      }
    });
  })
);

app.post(
  "/api/admission/learners/:id/restore",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const reason = normalizeText(req.body?.reason) || "Restored from recycle bin";
    await restoreAdmissionLearner({
      institutionId: req.user.institution_id,
      learnerId: req.params.id,
      actorUserId: req.user.id,
      reason
    });
    await auditLog(req.user, "RESTORE", "learners", req.params.id, { reason });
    res.json({ message: "Learner restored successfully." });
  })
);

app.get(
  "/api/admission/learners/:id/versions",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const learnerRows = await query(
      "SELECT id FROM learners WHERE id = ? AND institution_id = ? LIMIT 1",
      [req.params.id, req.user.institution_id]
    );
    if (!learnerRows.length) {
      return res.status(404).json({ error: "Learner not found." });
    }
    const versions = await query(
      `SELECT id, learner_id, version_action, changed_by_user_id, before_json, after_json, notes, changed_at
       FROM admission_record_versions
       WHERE institution_id = ? AND learner_id = ?
       ORDER BY changed_at DESC, id DESC`,
      [req.user.institution_id, req.params.id]
    );
    res.json({
      learnerId: Number(req.params.id),
      rows: versions.map((row) => ({
        ...row,
        before_json: safeJsonParse(row.before_json, null),
        after_json: safeJsonParse(row.after_json, null)
      }))
    });
  })
);

app.get(
  "/api/admission/learners/duplicates",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT id, first_name, last_name, full_name, admission_number, date_of_birth, parent_phone, parent_email, status
       FROM learners
       WHERE institution_id = ? AND deleted_at IS NULL
       ORDER BY first_name ASC, last_name ASC, id ASC`,
      [req.user.institution_id]
    );

    const groups = new Map();
    const byAdmission = new Map();
    rows.forEach((row) => {
      const admissionKey = normalizeAdmissionKey(row.admission_number);
      if (admissionKey) {
        if (!byAdmission.has(admissionKey)) byAdmission.set(admissionKey, []);
        byAdmission.get(admissionKey).push(row);
      }
      const fullNameKey = normalizeAdmissionKey(`${row.first_name || ""}${row.last_name || ""}`);
      const dobKey = normalizeText(row.date_of_birth);
      const contactKey = normalizeAdmissionKey(row.parent_phone || row.parent_email || "");
      if (!fullNameKey || !dobKey) return;
      const groupKey = `${fullNameKey}::${dobKey}::${contactKey || "NO_CONTACT"}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(row);
    });

    const duplicateGroups = [];
    let sequence = 1;
    byAdmission.forEach((items, key) => {
      if (items.length < 2) return;
      duplicateGroups.push({
        queue_id: `ADM-${sequence++}`,
        group_key: `ADMISSION::${key}`,
        reason: "Same admission number",
        items
      });
    });
    groups.forEach((items, key) => {
      if (items.length < 2) return;
      duplicateGroups.push({
        queue_id: `SIM-${sequence++}`,
        group_key: `SIMILAR::${key}`,
        reason: "Same names, DOB, and parent contact pattern",
        items
      });
    });

    res.json({
      totalGroups: duplicateGroups.length,
      rows: duplicateGroups
    });
  })
);

app.post(
  "/api/admission/learners/duplicates/review",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const groupKey = normalizeText(req.body?.group_key);
    const decision = normalizeText(req.body?.decision);
    const notes = normalizeText(req.body?.notes);
    if (!groupKey) {
      return res.status(400).json({ error: "group_key is required." });
    }
    if (!decision || !["Merge", "Keep Separate"].includes(decision)) {
      return res.status(400).json({ error: "decision must be either 'Merge' or 'Keep Separate'." });
    }

    await query(
      `INSERT INTO admission_duplicate_reviews
        (institution_id, group_key, decision, notes, resolved_by_user_id, resolved_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         decision = VALUES(decision),
         notes = VALUES(notes),
         resolved_by_user_id = VALUES(resolved_by_user_id),
         resolved_at = NOW(),
         updated_at = NOW()`,
      [req.user.institution_id, groupKey, decision, notes, req.user.id]
    );

    await auditLog(req.user, "REVIEW_ADMISSION_DUPLICATE", "admission_duplicate_reviews", null, {
      group_key: groupKey,
      decision,
      notes
    });
    res.json({ message: "Duplicate review saved." });
  })
);

app.post(
  "/api/admission/learners/:id/status/request-approval",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const desiredStatus = normalizeText(req.body?.to_status || req.body?.status);
    const requestReason = normalizeText(req.body?.reason || req.body?.request_reason);
    if (!desiredStatus || !ADMISSION_STATUS.includes(desiredStatus)) {
      return res.status(400).json({ error: "A valid target status is required." });
    }

    const learners = await query(
      "SELECT * FROM learners WHERE id = ? AND institution_id = ? AND deleted_at IS NULL LIMIT 1",
      [req.params.id, req.user.institution_id]
    );
    if (!learners.length) {
      return res.status(404).json({ error: "Learner not found." });
    }
    const learner = learners[0];
    const currentStatus = normalizeText(learner.status) || "In Session";

    if (!ADMISSION_SENSITIVE_STATUS.has(desiredStatus)) {
      const beforeSnapshot = admissionLearnerSnapshot(learner);
      await query(
        "UPDATE learners SET status = ?, updated_at = NOW() WHERE id = ? AND institution_id = ?",
        [desiredStatus, req.params.id, req.user.institution_id]
      );
      const afterSnapshot = { ...beforeSnapshot, status: desiredStatus };
      await recordAdmissionVersion({
        institutionId: req.user.institution_id,
        learnerId: req.params.id,
        action: "STATUS_DIRECT_UPDATE",
        changedByUserId: req.user.id,
        before: beforeSnapshot,
        after: afterSnapshot,
        notes: requestReason || `Status changed to ${desiredStatus}`
      });
      await auditLog(req.user, "UPDATE_STATUS_DIRECT", "learners", req.params.id, {
        from_status: currentStatus,
        to_status: desiredStatus,
        reason: requestReason || null
      });
      return res.json({
        message: "Status updated directly.",
        approvalRequired: false,
        from_status: currentStatus,
        to_status: desiredStatus
      });
    }

    const insertResult = await query(
      `INSERT INTO admission_status_approvals
        (institution_id, learner_id, admission_number, learner_name, from_status, to_status, request_reason, approval_status, requested_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`,
      [
        req.user.institution_id,
        req.params.id,
        learner.admission_number || null,
        learner.full_name || null,
        currentStatus,
        desiredStatus,
        requestReason,
        req.user.id
      ]
    );
    await auditLog(req.user, "REQUEST_STATUS_APPROVAL", "admission_status_approvals", insertResult.insertId, {
      learner_id: Number(req.params.id),
      from_status: currentStatus,
      to_status: desiredStatus,
      request_reason: requestReason || null
    });
    res.status(202).json({
      message: "Status change request submitted for approval.",
      approvalRequired: true,
      approvalId: insertResult.insertId
    });
  })
);

app.post(
  "/api/admission/status-approvals/:id/decide",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const decisionRaw = normalizeText(req.body?.decision);
    const decisionComment = normalizeText(req.body?.comment || req.body?.decision_comment);
    if (!decisionRaw) {
      return res.status(400).json({ error: "decision is required." });
    }
    const decisionNormalized = decisionRaw.toLowerCase();
    let nextStatus = null;
    if (["approve", "approved", "accept", "accepted"].includes(decisionNormalized)) {
      nextStatus = "Approved";
    } else if (["reject", "rejected", "deny", "denied"].includes(decisionNormalized)) {
      nextStatus = "Rejected";
    } else {
      return res.status(400).json({ error: "decision must be approve or reject." });
    }

    const rows = await query(
      "SELECT * FROM admission_status_approvals WHERE id = ? AND institution_id = ? LIMIT 1",
      [req.params.id, req.user.institution_id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Approval request not found." });
    }
    const approval = rows[0];
    if (approval.approval_status !== "Pending") {
      return res.status(409).json({ error: "This approval request has already been decided." });
    }

    await query(
      `UPDATE admission_status_approvals
       SET approval_status = ?, approved_by_user_id = ?, approved_at = NOW(), decision_comment = ?, updated_at = NOW()
       WHERE id = ? AND institution_id = ?`,
      [nextStatus, req.user.id, decisionComment, req.params.id, req.user.institution_id]
    );

    let learnerUpdated = false;
    if (nextStatus === "Approved") {
      const learnerRows = await query(
        "SELECT * FROM learners WHERE id = ? AND institution_id = ? AND deleted_at IS NULL LIMIT 1",
        [approval.learner_id, req.user.institution_id]
      );
      if (learnerRows.length) {
        const learner = learnerRows[0];
        const beforeSnapshot = admissionLearnerSnapshot(learner);
        await query(
          "UPDATE learners SET status = ?, updated_at = NOW() WHERE id = ? AND institution_id = ?",
          [approval.to_status, approval.learner_id, req.user.institution_id]
        );
        const afterSnapshot = { ...beforeSnapshot, status: approval.to_status };
        await recordAdmissionVersion({
          institutionId: req.user.institution_id,
          learnerId: approval.learner_id,
          action: "STATUS_APPROVAL_APPLIED",
          changedByUserId: req.user.id,
          before: beforeSnapshot,
          after: afterSnapshot,
          notes: decisionComment || `Approved status change to ${approval.to_status}`
        });
        learnerUpdated = true;
      }
    }

    await auditLog(req.user, "DECIDE_STATUS_APPROVAL", "admission_status_approvals", req.params.id, {
      decision: nextStatus,
      learner_id: approval.learner_id,
      to_status: approval.to_status,
      learnerUpdated
    });
    res.json({
      message: `Approval ${nextStatus.toLowerCase()}.`,
      status: nextStatus,
      learnerUpdated
    });
  })
);

app.post(
  "/api/admission/learners/photo-upload/:id",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.UPDATE),
  upload.single("photo"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Photo file is required." });
    }
    if (!String(req.file.mimetype || "").startsWith("image/")) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Only image files are allowed for learner photos." });
    }

    const learners = await query(
      "SELECT id FROM learners WHERE id = ? AND institution_id = ? AND deleted_at IS NULL LIMIT 1",
      [req.params.id, req.user.institution_id]
    );
    if (!learners.length) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Learner not found." });
    }

    const filePath = `/uploads/${req.file.filename}`;
    await query(
      "UPDATE learners SET passport_photo_path = ?, updated_at = NOW() WHERE id = ? AND institution_id = ?",
      [filePath, req.params.id, req.user.institution_id]
    );
    await auditLog(req.user, "UPLOAD_LEARNER_PHOTO", "learners", req.params.id, { filePath });
    res.json({ message: "Learner photo uploaded successfully.", filePath });
  })
);

app.get(
  "/api/admission/learners/search",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const field = String(req.query.field || "full_name");
    const value = String(req.query.value || "").trim();
    const status = String(req.query.status || "").trim();
    const limitRaw = Number(req.query.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 100;
    const offsetRaw = Number(req.query.offset || 0);
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
    const onlyIncomplete = ["1", "true", "yes", "y"].includes(
      String(req.query.incomplete_only || "").trim().toLowerCase()
    );

    if (!ALLOWED_ADMISSION_SEARCH_FIELDS.has(field)) {
      return res.status(400).json({ error: "Invalid admission search field selected." });
    }

    const params = [req.user.institution_id];
    let where = "WHERE institution_id = ? AND deleted_at IS NULL";
    if (value) {
      where += ` AND ${field} LIKE ?`;
      params.push(`%${value}%`);
    }
    if (status) {
      where += " AND status = ?";
      params.push(status);
    }

    if (onlyIncomplete) {
      const rows = await query(
        `SELECT * FROM learners
         ${where}
         ORDER BY ${ADMISSION_STATUS_ORDER_SQL}`,
        params
      );
      const filtered = formatLearnerStatusRows(rows).filter((row) => {
        const completeness = admissionCompletenessIndicators(row);
        return Array.isArray(completeness.missing) && completeness.missing.length > 0;
      });
      const pagedRows = filtered.slice(offset, offset + limit);
      return res.json({
        rows: pagedRows,
        pagination: {
          total: filtered.length,
          limit,
          offset,
          returned: pagedRows.length,
          hasMore: offset + pagedRows.length < filtered.length
        }
      });
    }

    const [countRow] = await query(
      `SELECT COUNT(*) total
       FROM learners
       ${where}`,
      params
    );
    const rows = await query(
      `SELECT * FROM learners
       ${where}
       ORDER BY ${ADMISSION_STATUS_ORDER_SQL}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const formatted = formatLearnerStatusRows(rows);
    res.json({
      rows: formatted,
      pagination: {
        total: Number(countRow?.total || 0),
        limit,
        offset,
        returned: formatted.length,
        hasMore: offset + formatted.length < Number(countRow?.total || 0)
      }
    });
  })
);

app.get(
  "/api/admission/learners/status-summary",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const statusFilter = normalizeText(req.query.status);
    if (statusFilter && !ADMISSION_STATUS.includes(statusFilter)) {
      return res.status(400).json({ error: "Invalid status filter provided." });
    }

    const params = [req.user.institution_id];
    let where = "WHERE institution_id = ? AND deleted_at IS NULL";
    if (statusFilter) {
      where += " AND status = ?";
      params.push(statusFilter);
    }

    const groupedRows = await query(
      `SELECT status, COUNT(*) total
       FROM learners
       ${where}
       GROUP BY status`,
      params
    );

    const summary = buildAdmissionStatusSummary(groupedRows);
    res.json({
      statusFilter: statusFilter || null,
      totalLearners: summary.total,
      byStatus: summary.byStatus
    });
  })
);

app.get(
  "/api/admission/learners/completeness",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const statusFilter = normalizeText(req.query.status);
    if (statusFilter && !ADMISSION_STATUS.includes(statusFilter)) {
      return res.status(400).json({ error: "Invalid status filter provided." });
    }
    const onlyIncomplete = ["1", "true", "yes", "y"].includes(
      String(req.query.incomplete_only || "").trim().toLowerCase()
    );
    const dataset = await buildAdmissionCompletenessDataset({
      institutionId: req.user.institution_id,
      statusFilter,
      onlyIncomplete
    });

    await auditLog(req.user, "VIEW_ADMISSION_COMPLETENESS", "learners", null, {
      status: statusFilter || "ALL",
      onlyIncomplete,
      totalLearners: dataset.summary.totalLearners,
      averageCompleteness: dataset.summary.averageCompleteness
    });

    res.json(dataset);
  })
);

app.get(
  "/api/admission/learners/completeness/export/csv",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const statusFilter = normalizeText(req.query.status);
    if (statusFilter && !ADMISSION_STATUS.includes(statusFilter)) {
      return res.status(400).json({ error: "Invalid status filter provided." });
    }
    const onlyIncomplete = ["1", "true", "yes", "y"].includes(
      String(req.query.incomplete_only || "").trim().toLowerCase()
    );

    const dataset = await buildAdmissionCompletenessDataset({
      institutionId: req.user.institution_id,
      statusFilter,
      onlyIncomplete
    });
    const csvContent = buildAdmissionCompletenessCsv({
      statusFilter: dataset.statusFilter,
      onlyIncomplete: dataset.onlyIncomplete,
      summary: dataset.summary,
      learners: dataset.learners
    });
    const stamp = dayjs().format("YYYYMMDD-HHmm");
    const filterSuffix = dataset.statusFilter ? `-${dataset.statusFilter.replace(/\s+/g, "-").toLowerCase()}` : "";
    const incompleteSuffix = dataset.onlyIncomplete ? "-incomplete" : "";
    const filename = `admission-completeness${filterSuffix}${incompleteSuffix}-${stamp}.csv`;

    await auditLog(req.user, "DOWNLOAD_ADMISSION_COMPLETENESS_CSV", "learners", null, {
      status: dataset.statusFilter || "ALL",
      onlyIncomplete: dataset.onlyIncomplete,
      count: dataset.learners.length
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csvContent);
  })
);

app.get(
  "/api/admission/learners/readiness/print",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const statusFilter = normalizeText(req.query.status);
    if (statusFilter && !ADMISSION_STATUS.includes(statusFilter)) {
      return res.status(400).json({ error: "Invalid status filter provided." });
    }
    const onlyIncomplete = ["1", "true", "yes", "y"].includes(
      String(req.query.incomplete_only || "").trim().toLowerCase()
    );
    const dataset = await buildAdmissionCompletenessDataset({
      institutionId: req.user.institution_id,
      statusFilter,
      onlyIncomplete
    });
    const readinessLabel = admissionReadinessLabel(Number(dataset.summary.averageCompleteness || 0));
    const focusRows = dataset.learners
      .slice()
      .sort((a, b) => Number(a.completeness_percentage || 0) - Number(b.completeness_percentage || 0));
    const missingFieldRank = topMissingAdmissionFields(focusRows);

    const doc = new PDFDocument({ margin: 24, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="admission-readiness-report.pdf"');
    doc.pipe(res);

    doc.fontSize(16).fillColor("#000000").text("Admission Readiness Report", { underline: true });
    doc
      .fontSize(10)
      .fillColor("#425466")
      .text(`Generated: ${dayjs().format("YYYY-MM-DD HH:mm")}`)
      .text(
        `Scope: ${dataset.statusFilter || "All statuses"} | Focus: ${
          dataset.onlyIncomplete ? "Incomplete records only" : "All records"
        }`
      );
    doc.moveDown(0.6);

    doc.fontSize(13).fillColor("#0f3860").text(`Overall Readiness: ${readinessLabel}`);
    doc.fontSize(10).fillColor("#111111");
    doc.text(`Learners in report: ${dataset.summary.totalLearners}`);
    doc.text(`Average completeness: ${dataset.summary.averageCompleteness}%`);
    doc.text(`90%+ complete: ${dataset.summary.highCompleteness}`);
    doc.text(`70%+ complete: ${dataset.summary.mediumCompleteness}`);
    doc.text(`With photos: ${dataset.summary.withPhotos}`);
    doc.text(`With parent contact: ${dataset.summary.withParentContact}`);
    doc.text(`Invalid statuses: ${dataset.summary.invalidStatusCount}`);
    doc.text(`Missing parent contacts: ${dataset.summary.missingParentContactsCount}`);
    doc.moveDown(0.6);

    doc.fontSize(12).fillColor("#0f3860").text("Most Missing Fields");
    doc.fontSize(10).fillColor("#111111");
    if (!missingFieldRank.length) {
      doc.text("No missing field patterns detected.");
    } else {
      missingFieldRank.forEach(([fieldName, count], index) => {
        doc.text(`${index + 1}. ${fieldName}: ${count}`);
      });
    }
    doc.moveDown(0.8);

    doc.fontSize(12).fillColor("#0f3860").text("Learners Requiring Attention");
    doc.fontSize(10).fillColor("#111111");
    if (!focusRows.length) {
      doc.text("No learner records found for this scope.");
    } else {
      focusRows.forEach((learner, index) => {
        if (doc.y > 740) doc.addPage();
        const statusColor = ADMISSION_STATUS_HEX[learner.status] || "#5f7187";
        const classSection = [learner.grade || learner.form_name || "N/A", learner.stream || ""].join(" ").trim();
        const parentContact = learner.parent_phone || learner.parent_email || "N/A";
        const missing = Array.isArray(learner.missing_fields) && learner.missing_fields.length
          ? learner.missing_fields.join(", ")
          : "None";

        doc.fillColor("#111111").text(`${index + 1}. ${learner.first_name || learner.full_name || "N/A"}`);
        doc.fillColor(statusColor).text(`Status: ${learner.status || "N/A"}`);
        doc.fillColor("#111111").text(
          `ADM: ${learner.admission_number || "N/A"} | Class: ${classSection} | Completeness: ${
            learner.completeness_percentage || 0
          }%`
        );
        doc.text(`Parent Contact: ${parentContact}`);
        doc.text(`Missing Fields: ${missing}`);
        doc.moveDown(0.45);
      });
    }

    await auditLog(req.user, "PRINT_ADMISSION_READINESS_REPORT", "learners", null, {
      status: dataset.statusFilter || "ALL",
      onlyIncomplete: dataset.onlyIncomplete,
      count: dataset.learners.length,
      averageCompleteness: dataset.summary.averageCompleteness
    });
    doc.end();
  })
);

app.get(
  "/api/admission/workflow/steps",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT *
       FROM learners
       WHERE institution_id = ? AND deleted_at IS NULL
       ORDER BY ${ADMISSION_STATUS_ORDER_SQL}`,
      [req.user.institution_id]
    );

    const completenessPercentages = rows.map((row) => admissionCompletenessIndicators(row).percentage);
    const averageCompleteness = completenessPercentages.length
      ? Math.round(
          completenessPercentages.reduce((sum, value) => sum + Number(value || 0), 0) /
            completenessPercentages.length
        )
      : 0;
    const withPhotos = rows.filter((row) => normalizeText(row.passport_photo_path)).length;
    const withParentContact = rows.filter(
      (row) => normalizeText(row.parent_phone) || normalizeText(row.parent_email)
    ).length;
    const invalidStatusCount = rows.filter(
      (row) => !normalizeText(row.status) || !ADMISSION_STATUS.includes(normalizeText(row.status))
    ).length;
    const missingParentContactsCount = rows.filter(
      (row) => !normalizeText(row.parent_phone) && !normalizeText(row.parent_email)
    ).length;

    const summary = {
      totalLearners: rows.length,
      averageCompleteness,
      withPhotos,
      withParentContact,
      invalidStatusCount,
      missingParentContactsCount
    };
    const steps = admissionGuideStepFlags(summary);

    res.json({
      summary,
      steps
    });
  })
);

app.get(
  "/api/admission/learners/:id/export/pdf",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query("SELECT * FROM learners WHERE id = ? AND institution_id = ? AND deleted_at IS NULL LIMIT 1", [
      req.params.id,
      req.user.institution_id
    ]);
    if (!rows.length) {
      return res.status(404).json({ error: "Learner not found." });
    }

    const learner = formatLearnerStatusRows(rows)[0];
    const statusColor = learner.status_color || "#6d6d6d";
    const doc = new PDFDocument({ margin: 30 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="learner-${learner.admission_number || learner.id}-record.pdf"`
    );
    doc.pipe(res);

    doc.fontSize(16).fillColor("#000000").text("Learner Bio Data Record", { underline: true });
    doc.moveDown(0.6);
    doc.fontSize(12).text(`Admission Number: ${learner.admission_number || "N/A"}`);
    doc.text(`Full Name: ${learner.full_name || "N/A"}`);
    doc.text(`Class Section: ${learner.grade || learner.form_name || "N/A"} ${learner.stream || ""}`);
    doc.text(`UPI: ${learner.upi_number || "N/A"} | Assessment: ${learner.assessment_number || "N/A"}`);
    doc.fillColor(statusColor).text(`Status: ${learner.status || "N/A"}`);
    doc.fillColor("#000000");
    doc.text(`Parent: ${learner.parent_full_name || "N/A"} | Phone: ${learner.parent_phone || "N/A"}`);
    doc.text(`Birth Certificate: ${learner.birth_certificate_number || "N/A"}`);
    doc.moveDown(0.6);
    doc.fontSize(10).fillColor("#3d4f63").text(
      "Photo management note: for many learners, upload biodata in bulk first, then add passport photos during edit or using the Upload Photo action."
    );
    doc.end();
  })
);

app.post(
  "/api/admission/learners/photo-batch-upload",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.UPDATE),
  upload.array("photos", 300),
  asyncHandler(async (req, res) => {
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: "At least one photo file is required." });
    }

    const learners = await query(
      "SELECT id, admission_number FROM learners WHERE institution_id = ?",
      [req.user.institution_id]
    );
    const learnerIndex = new Map(
      learners.map((learner) => [normalizeAdmissionKey(learner.admission_number), learner])
    );
    const { matchedCount, rejectedFiles } = await mapAdmissionPhotosFromFiles({
      files: req.files,
      institutionId: req.user.institution_id,
      learnerIndex
    });

    await auditLog(req.user, "PHOTO_BATCH_UPLOAD_ADMISSION", "learners", null, {
      uploaded: req.files.length,
      matchedCount,
      rejectedCount: rejectedFiles.length
    });

    res.json({
      message: "Batch photo upload processed.",
      uploaded: req.files.length,
      matchedCount,
      rejectedFiles
    });
  })
);

app.post(
  "/api/admission/learners/photo-batch-zip-upload",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.UPDATE),
  upload.single("zipFile"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "ZIP file is required." });
    }

    const extension = path.extname(req.file.originalname || "").toLowerCase();
    if (extension !== ".zip") {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "Only .zip files are accepted for ZIP photo upload." });
    }

    const learners = await query(
      "SELECT id, admission_number FROM learners WHERE institution_id = ?",
      [req.user.institution_id]
    );
    const learnerIndex = new Map(
      learners.map((learner) => [normalizeAdmissionKey(learner.admission_number), learner])
    );

    const extractedFiles = extractZipPhotosToUploads(req.file.path);
    fs.unlink(req.file.path, () => {});

    if (!extractedFiles.length) {
      return res.status(400).json({
        error:
          "No supported image files found in ZIP. Include files like .jpg, .png named by admission number."
      });
    }

    const { matchedCount, rejectedFiles } = await mapAdmissionPhotosFromFiles({
      files: extractedFiles,
      institutionId: req.user.institution_id,
      learnerIndex
    });

    await auditLog(req.user, "PHOTO_BATCH_ZIP_UPLOAD_ADMISSION", "learners", null, {
      zipFile: req.file.originalname,
      extracted: extractedFiles.length,
      matchedCount,
      rejectedCount: rejectedFiles.length
    });

    res.json({
      message: "ZIP batch photo upload processed.",
      extracted: extractedFiles.length,
      matchedCount,
      rejectedFiles
    });
  })
);

app.get(
  "/api/admission/learners/register/print",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const statusFilter = normalizeText(req.query.status);
    const params = [req.user.institution_id];
    let where = "WHERE institution_id = ? AND deleted_at IS NULL";
    if (statusFilter) {
      where += " AND status = ?";
      params.push(statusFilter);
    }

    const rows = await query(
      `SELECT *
       FROM learners
       ${where}
       ORDER BY ${ADMISSION_STATUS_ORDER_SQL}`,
      params
    );
    const formatted = formatLearnerStatusRows(rows);

    const grouped = new Map();
    ADMISSION_STATUS.forEach((status) => grouped.set(status, []));
    grouped.set("Uncategorized", []);
    for (const learner of formatted) {
      const statusKey = learner.status || "Uncategorized";
      if (!grouped.has(statusKey)) grouped.set(statusKey, []);
      grouped.get(statusKey).push(learner);
    }

    const doc = new PDFDocument({ margin: 24, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'inline; filename="admission-register.pdf"');
    doc.pipe(res);

    doc.fontSize(16).fillColor("#000000").text("Admission Status Register", { underline: true });
    doc
      .fontSize(10)
      .fillColor("#425466")
      .text(`Generated: ${dayjs().format("YYYY-MM-DD HH:mm")} | Learners: ${formatted.length}`);
    doc.moveDown(0.6);

    doc.fontSize(13).fillColor("#0f3860").text("Admission Status Summary");
    doc.moveDown(0.2);
    const summaryStatuses = ADMISSION_STATUS.concat(["Uncategorized"]);
    summaryStatuses.forEach((statusItem) => {
      const count = grouped.get(statusItem)?.length || 0;
      if (!count) return;
      const color = ADMISSION_STATUS_HEX[statusItem] || "#5f7187";
      const [r, g, b] = colorFromHex(color);
      doc.fillColor("black");
      doc.roundedRect(24, doc.y + 2, 10, 10, 2).fillAndStroke([r, g, b], [r, g, b]);
      doc.fillColor("#111111").text(`${statusItem}: ${count}`, 40, doc.y - 10);
    });
    doc.moveDown(1.1);

    for (const [status, learnersInStatus] of grouped.entries()) {
      if (!learnersInStatus.length) continue;
      const color = ADMISSION_STATUS_HEX[status] || "#5f7187";
      doc.fontSize(12).fillColor(color).text(`${status} (${learnersInStatus.length})`);
      doc.fillColor("#111111").fontSize(10);
      learnersInStatus.forEach((learner, index) => {
        doc.text(
          `${index + 1}. ${learner.first_name || learner.full_name || "N/A"} | ADM: ${
            learner.admission_number || "N/A"
          } | Class: ${learner.grade || learner.form_name || "N/A"} ${learner.stream || ""} | Parent: ${
            learner.parent_full_name || "N/A"
          } (${learner.parent_phone || "N/A"})`
        );
      });
      doc.moveDown(0.6);
    }

    await auditLog(req.user, "PRINT_ADMISSION_REGISTER", "learners", null, {
      status: statusFilter || "ALL",
      count: formatted.length
    });
    doc.end();
  })
);

app.get(
  "/api/dashboard/summary",
  auth,
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = req.user.institution_id;

    const [population] = await query(
      "SELECT COUNT(*) totalLearners FROM learners WHERE institution_id = ?",
      [institutionId]
    );
    const [present] = await query(
      `SELECT COUNT(*) totalPresent
       FROM attendance_records
       WHERE institution_id = ? AND attendance_type = 'Learner' AND status = 'Present'
       AND DATE(attendance_date) = CURDATE()`,
      [institutionId]
    );
    const [absent] = await query(
      `SELECT COUNT(*) totalAbsent
       FROM attendance_records
       WHERE institution_id = ? AND attendance_type = 'Learner' AND status = 'Absent'
       AND DATE(attendance_date) = CURDATE()`,
      [institutionId]
    );
    const [boys] = await query(
      "SELECT COUNT(*) totalBoys FROM learners WHERE institution_id = ? AND gender = 'Male'",
      [institutionId]
    );
    const [girls] = await query(
      "SELECT COUNT(*) totalGirls FROM learners WHERE institution_id = ? AND gender = 'Female'",
      [institutionId]
    );
    const [late] = await query(
      `SELECT COUNT(*) totalLate
       FROM attendance_records
       WHERE institution_id = ? AND status = 'Late' AND DATE(attendance_date) = CURDATE()`,
      [institutionId]
    );
    const [suspension] = await query(
      "SELECT COUNT(*) totalSuspended FROM learners WHERE institution_id = ? AND conduct_status = 'Suspended'",
      [institutionId]
    );
    const [expelled] = await query(
      "SELECT COUNT(*) totalExpelled FROM learners WHERE institution_id = ? AND conduct_status = 'Expelled'",
      [institutionId]
    );
    const [fees] = await query(
      `SELECT COALESCE(SUM(amount_paid), 0) totalFees
       FROM finance_fee_payments
       WHERE institution_id = ? AND DATE(payment_date) = CURDATE()`,
      [institutionId]
    );

    const attendanceBreakdown = await query(
      `SELECT attendance_type, status, COUNT(*) total
       FROM attendance_records
       WHERE institution_id = ? AND DATE(attendance_date) = CURDATE()
       GROUP BY attendance_type, status
       ORDER BY attendance_type, status`,
      [institutionId]
    );

    const performanceByClass = await query(
      `SELECT grade, stream, ROUND(AVG(marks), 2) meanScore
       FROM academic_marks
       WHERE institution_id = ?
       GROUP BY grade, stream
       ORDER BY grade, stream`,
      [institutionId]
    );

    const announcements = await query(
      `SELECT id, title, message, created_at
       FROM communication_announcements
       WHERE institution_id = ?
       ORDER BY id DESC LIMIT 10`,
      [institutionId]
    );

    const logs = await query(
      `SELECT id, actor_role, action, entity_name, created_at
       FROM activity_logs
       WHERE institution_id = ?
       ORDER BY id DESC LIMIT 20`,
      [institutionId]
    );

    res.json({
      stats: {
        totalLearners: population.totalLearners,
        totalPresent: present.totalPresent,
        totalAbsent: absent.totalAbsent,
        totalBoys: boys.totalBoys,
        totalGirls: girls.totalGirls,
        totalLate: late.totalLate,
        totalSuspended: suspension.totalSuspended,
        totalExpelled: expelled.totalExpelled,
        totalFeesCollectedToday: fees.totalFees
      },
      attendanceBreakdown,
      performanceByClass,
      announcements,
      systemActivityLogs: logs
    });
  })
);

app.get(
  "/api/search/global",
  auth,
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const { q = "" } = req.query;
    const institutionId = req.user.institution_id;

    const learnerRows = await getPaginatedRows({
      table: "learners",
      institutionId,
      searchFields: [
        "full_name",
        "admission_number",
        "upi_number",
        "assessment_number",
        "birth_certificate_number"
      ],
      q,
      limit: 20
    });
    const teacherRows = await getPaginatedRows({
      table: "teacher_profiles",
      institutionId,
      searchFields: ["full_name", "id_number", "tsc_number"],
      q,
      limit: 20
    });
    const parentRows = await getPaginatedRows({
      table: "learners",
      institutionId,
      searchFields: ["parent_full_name", "upi_number", "assessment_number"],
      q,
      limit: 20
    });

    res.json({
      learners: learnerRows,
      teachers: teacherRows,
      parentsAndBom: parentRows
    });
  })
);

app.get(
  "/api/users",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const users = await query(
      `SELECT id, institution_id, full_name, username, role, email, phone, is_active, created_at
       FROM users WHERE institution_id = ? ORDER BY id DESC`,
      [req.user.institution_id]
    );
    res.json(users);
  })
);

app.post(
  "/api/users",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const { full_name, username, password, role, email, phone } = req.body;
    if (!full_name || !username || !password || !role) {
      return res.status(400).json({ error: "full_name, username, password and role are required." });
    }
    const normalizedRole = normalizeRoleValue(role);
    if (!normalizedRole || !Object.values(ROLES).includes(normalizedRole)) {
      return res.status(400).json({ error: "Invalid role value supplied." });
    }
    const passwordHash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users
        (institution_id, full_name, username, password_hash, role, email, phone, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        req.user.institution_id,
        full_name,
        username,
        passwordHash,
        normalizedRole,
        email || null,
        phone || null,
        req.user.id
      ]
    );
    await auditLog(req.user, "CREATE_USER", "users", result.insertId, { username, role: normalizedRole });
    res.status(201).json({ id: result.insertId, message: "User created successfully." });
  })
);

app.patch(
  "/api/users/:id/status",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const { is_active } = req.body;
    await query("UPDATE users SET is_active = ? WHERE id = ? AND institution_id = ?", [
      Number(Boolean(is_active)),
      req.params.id,
      req.user.institution_id
    ]);
    await auditLog(req.user, "CHANGE_USER_STATUS", "users", req.params.id, { is_active });
    res.json({ message: "User status updated." });
  })
);

app.patch(
  "/api/users/:id/password",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const { new_password } = req.body;
    if (!new_password) {
      return res.status(400).json({ error: "new_password is required." });
    }
    const passwordHash = await hashPassword(new_password);
    await query("UPDATE users SET password_hash = ? WHERE id = ? AND institution_id = ?", [
      passwordHash,
      req.params.id,
      req.user.institution_id
    ]);
    await auditLog(req.user, "RESET_USER_PASSWORD", "users", req.params.id);
    res.json({ message: "Password reset successfully." });
  })
);

app.post(
  "/api/profile/change-credentials",
  auth,
  asyncHandler(async (req, res) => {
    const { current_password, new_username, new_password } = req.body;
    const users = await query("SELECT * FROM users WHERE id = ? AND institution_id = ? LIMIT 1", [
      req.user.id,
      req.user.institution_id
    ]);
    if (!users.length) {
      return res.status(404).json({ error: "User account not found." });
    }
    const user = users[0];
    const valid = await verifyPassword(current_password || "", user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const updates = [];
    const params = [];

    if (new_username) {
      updates.push("username = ?");
      params.push(new_username);
    }
    if (new_password) {
      updates.push("password_hash = ?");
      params.push(await hashPassword(new_password));
    }

    if (!updates.length) {
      return res.status(400).json({ error: "No credential changes submitted." });
    }

    await query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, [...params, user.id]);
    await auditLog(req.user, "CHANGE_OWN_CREDENTIALS", "users", user.id, { new_username });
    res.json({ message: "Credentials updated successfully." });
  })
);

const moduleConfigs = [
  {
    route: "/api/admission/learners",
    table: "learners",
    searchFields: [
      "full_name",
      "admission_number",
      "upi_number",
      "assessment_number",
      "birth_certificate_number"
    ],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER],
    fields: [
      "full_name",
      "first_name",
      "middle_name",
      "last_name",
      "other_names",
      "admission_number",
      "date_of_admission",
      "grade",
      "form_name",
      "stream",
      "assessment_number",
      "upi_number",
      "birth_certificate_number",
      "date_of_birth",
      "gender",
      "passport_photo_path",
      "religion",
      "nationality",
      "county",
      "sub_county",
      "location",
      "sub_location",
      "village",
      "year_joined",
      "term_joined",
      "orphan_condition",
      "status",
      "conduct_status",
      "parent_full_name",
      "parent_relationship",
      "parent_id_number",
      "parent_phone",
      "parent_email",
      "learner_password_hash"
    ]
  },
  {
    route: "/api/management/teachers",
    table: "teacher_profiles",
    searchFields: ["full_name", "id_number", "tsc_number", "phone_number"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: [
      "full_name",
      "tsc_number",
      "id_number",
      "phone_number",
      "category",
      "major_subject",
      "other_subject",
      "next_of_kin_name",
      "next_of_kin_relationship",
      "next_of_kin_mobile",
      "next_of_kin_email"
    ]
  },
  {
    route: "/api/management/non-teaching-staff",
    table: "non_teaching_staff_profiles",
    searchFields: ["full_name", "staff_number", "id_number", "position_department"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: [
      "full_name",
      "staff_number",
      "id_number",
      "phone_number",
      "position_department",
      "next_of_kin_name",
      "next_of_kin_contact"
    ]
  },
  {
    route: "/api/management/teacher-resources",
    table: "teacher_resources",
    searchFields: ["resource_type", "title", "grade", "term"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER],
    fields: [
      "teacher_profile_id",
      "resource_type",
      "title",
      "description",
      "grade",
      "stream",
      "term",
      "strand",
      "sub_strand",
      "file_path",
      "auto_generated"
    ]
  },
  {
    route: "/api/attendance/records",
    table: "attendance_records",
    searchFields: ["attendance_type", "person_name", "grade", "stream", "status", "reason"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER],
    fields: [
      "attendance_type",
      "person_id",
      "person_name",
      "grade",
      "stream",
      "attendance_date",
      "time_in",
      "time_out",
      "status",
      "reason",
      "comments"
    ]
  },
  {
    route: "/api/academic/exams",
    table: "academic_exams",
    searchFields: ["title", "grade", "subject", "strand", "sub_strand"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER],
    fields: [
      "title",
      "grade",
      "stream",
      "subject",
      "strand",
      "sub_strand",
      "notes_file_path",
      "generated_exam_text",
      "exam_file_path",
      "term",
      "year"
    ]
  },
  {
    route: "/api/academic/marks",
    table: "academic_marks",
    searchFields: [
      "learner_name",
      "upi_number",
      "assessment_number",
      "birth_certificate_number",
      "exam_type",
      "subject",
      "grade",
      "stream"
    ],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.TEACHER,
      ROLES.BOM
    ],
    fields: [
      "learner_id",
      "learner_name",
      "upi_number",
      "assessment_number",
      "birth_certificate_number",
      "grade",
      "stream",
      "exam_type",
      "subject",
      "marks",
      "percentage",
      "cbc_grade_band",
      "term",
      "year"
    ]
  },
  {
    route: "/api/hr/leave-requests",
    table: "hr_leave_requests",
    searchFields: ["staff_name", "leave_type", "status", "approval_stage"],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.NON_TEACHING_STAFF,
      ROLES.TEACHER
    ],
    fields: [
      "staff_profile_type",
      "staff_profile_id",
      "staff_name",
      "leave_type",
      "start_date",
      "end_date",
      "reason",
      "status",
      "applied_by_user_id",
      "approved_by_user_id",
      "approval_stage"
    ]
  },
  {
    route: "/api/hr/recruitment-records",
    table: "hr_recruitment_records",
    searchFields: ["record_type", "position_name", "candidate_name", "terms_of_service"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: [
      "record_type",
      "position_name",
      "candidate_name",
      "candidate_id_number",
      "candidate_mobile",
      "terms_of_service",
      "job_description",
      "comments",
      "upload_file_path",
      "deadline_date",
      "status"
    ]
  },
  {
    route: "/api/finance/fee-structures",
    table: "finance_fee_structures",
    searchFields: ["grade", "stream", "term", "year"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: ["grade", "stream", "term", "year", "amount_required", "description"]
  },
  {
    route: "/api/finance/fee-payments",
    table: "finance_fee_payments",
    searchFields: ["learner_name", "admission_number", "receipt_number", "payment_method"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.NON_TEACHING_STAFF],
    fields: [
      "learner_id",
      "learner_name",
      "admission_number",
      "grade",
      "stream",
      "amount_paid",
      "payment_method",
      "receipt_number",
      "payment_date",
      "balance_after_payment"
    ]
  },
  {
    route: "/api/finance/procurement",
    table: "finance_procurement_records",
    searchFields: ["document_type", "document_number", "supplier_name", "item_name", "status"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.NON_TEACHING_STAFF],
    fields: [
      "document_type",
      "document_number",
      "supplier_name",
      "item_name",
      "description",
      "quantity",
      "amount",
      "document_date",
      "due_date",
      "status",
      "file_path",
      "qr_code_text"
    ]
  },
  {
    route: "/api/communication/messages",
    table: "communication_messages",
    searchFields: ["message_type", "recipient_role", "recipient_contact", "status"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: [
      "message_type",
      "recipient_role",
      "recipient_contact",
      "message_body",
      "status",
      "sent_at"
    ]
  },
  {
    route: "/api/communication/announcements",
    table: "communication_announcements",
    searchFields: ["title", "message", "audience"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: ["title", "message", "audience", "start_date", "end_date"]
  },
  {
    route: "/api/learners/resources",
    table: "learner_resources",
    searchFields: ["title", "subject", "grade", "resource_format"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER, ROLES.LEARNER],
    fields: [
      "title",
      "subject",
      "grade",
      "stream",
      "resource_format",
      "file_path",
      "description",
      "uploaded_by_user_id"
    ]
  },
  {
    route: "/api/welfare/members",
    table: "welfare_members",
    searchFields: ["member_name", "member_role", "status"],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.NON_TEACHING_STAFF,
      ROLES.TEACHER
    ],
    fields: [
      "member_name",
      "member_role",
      "phone_number",
      "email",
      "joined_date",
      "status"
    ]
  },
  {
    route: "/api/welfare/contributions",
    table: "welfare_contributions",
    searchFields: ["member_name", "contribution_period", "payment_mode"],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.NON_TEACHING_STAFF,
      ROLES.TEACHER
    ],
    fields: [
      "member_id",
      "member_name",
      "contribution_period",
      "amount",
      "payment_mode",
      "payment_date"
    ]
  },
  {
    route: "/api/welfare/loans",
    table: "welfare_loans",
    searchFields: ["member_name", "status", "loan_officer_approval", "principal_approval"],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.NON_TEACHING_STAFF,
      ROLES.TEACHER
    ],
    fields: [
      "member_id",
      "member_name",
      "amount",
      "application_date",
      "return_date",
      "status",
      "loan_officer_approval",
      "principal_approval",
      "repayment_status"
    ]
  },
  {
    route: "/api/laws/documents",
    table: "laws_regulations_policies",
    searchFields: ["document_category", "title", "description"],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.NON_TEACHING_STAFF,
      ROLES.TEACHER
    ],
    fields: [
      "document_category",
      "title",
      "description",
      "file_path",
      "effective_date",
      "uploaded_by_user_id"
    ]
  }
];

const admissionConfig = moduleConfigs.find((config) => config.route === "/api/admission/learners");

if (admissionConfig) {
  app.get(
    admissionConfig.route,
    auth,
    enforceRole(admissionConfig.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await getPaginatedRows({
        table: admissionConfig.table,
        institutionId: req.user.institution_id,
        searchFields: admissionConfig.searchFields,
        q: req.query.q || "",
        extraWhere: " AND deleted_at IS NULL",
        orderBy: ADMISSION_STATUS_ORDER_SQL,
        limit: req.query.limit || 100,
        offset: req.query.offset || 0
      });
      res.json(formatLearnerStatusRows(rows));
    })
  );

  app.get(
    `${admissionConfig.route}/:id`,
    auth,
    enforceRole(admissionConfig.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await query(
        `SELECT * FROM ${admissionConfig.table}
         WHERE id = ? AND institution_id = ? AND deleted_at IS NULL
         LIMIT 1`,
        [req.params.id, req.user.institution_id]
      );
      if (!rows.length) {
        return res.status(404).json({ error: "Record not found." });
      }
      return res.json(formatLearnerStatusRows(rows)[0]);
    })
  );

  app.post(
    admissionConfig.route,
    auth,
    enforceRole(admissionConfig.allowedRoles),
    enforcePermission(PERMISSIONS.CREATE),
    asyncHandler(async (req, res) => {
      const data = normalizeLearnerPayload(pickFields(req.body, admissionConfig.fields));
      data.institution_id = req.user.institution_id;
      data.created_by_user_id = req.user.id;

      const validationError = validateLearnerPayload(data);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const columns = Object.keys(data);
      if (!columns.length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }

      const duplicateRows = await query(
        `SELECT id
         FROM learners
         WHERE institution_id = ? AND admission_number = ? AND deleted_at IS NULL
         LIMIT 1`,
        [req.user.institution_id, data.admission_number]
      );
      if (duplicateRows.length) {
        return res.status(409).json({
          error: "Admission number already exists. Use edit/update instead."
        });
      }

      const placeholders = columns.map(() => "?").join(", ");
      const sql = `INSERT INTO ${admissionConfig.table} (${columns.join(", ")}) VALUES (${placeholders})`;
      const result = await query(sql, Object.values(data));
      await auditLog(req.user, "CREATE", admissionConfig.table, result.insertId, data);
      res.status(201).json({ id: result.insertId, message: "Record created." });
    })
  );

  app.put(
    `${admissionConfig.route}/:id`,
    auth,
    enforceRole(admissionConfig.allowedRoles),
    enforcePermission(PERMISSIONS.UPDATE),
    asyncHandler(async (req, res) => {
      const incoming = pickFields(req.body, admissionConfig.fields);
      const incomingColumns = Object.keys(incoming);
      if (!incomingColumns.length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }

      const existingRows = await query(
        `SELECT * FROM ${admissionConfig.table}
         WHERE id = ? AND institution_id = ? AND deleted_at IS NULL
         LIMIT 1`,
        [req.params.id, req.user.institution_id]
      );
      if (!existingRows.length) {
        return res.status(404).json({ error: "Record not found." });
      }

      const merged = normalizeLearnerPayload({
        ...existingRows[0],
        ...incoming
      });
      const validationError = validateLearnerPayload(merged);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const requestedAdmission = normalizeText(merged.admission_number);
      if (requestedAdmission) {
        const duplicateRows = await query(
          `SELECT id
           FROM learners
           WHERE institution_id = ? AND admission_number = ? AND id <> ? AND deleted_at IS NULL
           LIMIT 1`,
          [req.user.institution_id, requestedAdmission, req.params.id]
        );
        if (duplicateRows.length) {
          return res.status(409).json({
            error: "Admission number already exists for another learner."
          });
        }
      }

      const columns = admissionConfig.fields;
      const setClause = columns.map((column) => `${column} = ?`).join(", ");
      const sql = `UPDATE ${admissionConfig.table}
                   SET ${setClause}, updated_at = NOW()
                   WHERE id = ? AND institution_id = ?`;
      await query(sql, [...columns.map((column) => merged[column] ?? null), req.params.id, req.user.institution_id]);
      await auditLog(req.user, "UPDATE", admissionConfig.table, req.params.id, incoming);
      res.json({ message: "Record updated." });
    })
  );

  app.delete(
    `${admissionConfig.route}/:id`,
    auth,
    enforceRole(admissionConfig.allowedRoles),
    enforcePermission(PERMISSIONS.DELETE),
    asyncHandler(async (req, res) => {
      const reason = normalizeText(req.body?.reason) || "Archived by delete action";
      try {
        await softDeleteAdmissionLearner({
          institutionId: req.user.institution_id,
          learnerId: req.params.id,
          actorUserId: req.user.id,
          reason
        });
      } catch (error) {
        if (String(error.message || "").includes("not found")) {
          return res.status(404).json({ error: "Record not found." });
        }
        return res.status(400).json({ error: error.message || "Unable to archive learner." });
      }
      await auditLog(req.user, "SOFT_DELETE", admissionConfig.table, req.params.id, { reason });
      res.json({ message: "Record archived. Use recycle bin to restore if needed." });
    })
  );

  app.get(
    `${admissionConfig.route}/export/pdf`,
    auth,
    enforceRole(admissionConfig.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await getPaginatedRows({
        table: admissionConfig.table,
        institutionId: req.user.institution_id,
        searchFields: admissionConfig.searchFields,
        q: req.query.q || "",
        extraWhere: " AND deleted_at IS NULL",
        orderBy: ADMISSION_STATUS_ORDER_SQL,
        limit: 5000
      });
      const formattedRows = formatLearnerStatusRows(rows);
      const lines = formattedRows.map((row) => JSON.stringify(row));
      sendSimplePdf(res, `${admissionConfig.table}-report`, lines);
    })
  );

  app.get(
    `${admissionConfig.route}/export/excel`,
    auth,
    enforceRole(admissionConfig.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await getPaginatedRows({
        table: admissionConfig.table,
        institutionId: req.user.institution_id,
        searchFields: admissionConfig.searchFields,
        q: req.query.q || "",
        extraWhere: " AND deleted_at IS NULL",
        orderBy: ADMISSION_STATUS_ORDER_SQL,
        limit: 5000
      });
      const formattedRows = formatLearnerStatusRows(rows);
      const headers = formattedRows.length ? Object.keys(formattedRows[0]) : ["No Data"];
      const dataRows = formattedRows.length
        ? formattedRows.map((row) => headers.map((header) => row[header]))
        : [];
      await sendSimpleExcel(res, admissionConfig.table, headers, dataRows);
    })
  );
}

moduleConfigs.forEach((config) => {
  if (config.route === "/api/admission/learners") {
    return;
  }
  app.get(
    config.route,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await getPaginatedRows({
        table: config.table,
        institutionId: req.user.institution_id,
        searchFields: config.searchFields,
        q: req.query.q || "",
        limit: req.query.limit || 100,
        offset: req.query.offset || 0
      });

      res.json(rows);
    })
  );

  app.get(
    `${config.route}/:id`,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await query(
        `SELECT * FROM ${config.table} WHERE id = ? AND institution_id = ? LIMIT 1`,
        [req.params.id, req.user.institution_id]
      );
      if (!rows.length) {
        return res.status(404).json({ error: "Record not found." });
      }
      return res.json(rows[0]);
    })
  );

  app.post(
    config.route,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.CREATE),
    asyncHandler(async (req, res) => {
      const picked = pickFields(req.body, config.fields);
      if (!Object.keys(picked).length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }
      const data = normalizeGenericModulePayload(config, picked, { isCreate: true });
      const validationError = await validateGenericModulePayload({
        config,
        data,
        institutionId: req.user.institution_id
      });
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      data.institution_id = req.user.institution_id;
      data.created_by_user_id = req.user.id;

      const columns = Object.keys(data);
      if (!columns.length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }
      const placeholders = columns.map(() => "?").join(", ");
      const sql = `INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders})`;
      const result = await query(sql, Object.values(data));
      await auditLog(req.user, "CREATE", config.table, result.insertId, data);
      res.status(201).json({ id: result.insertId, message: "Record created." });
    })
  );

  app.put(
    `${config.route}/:id`,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.UPDATE),
    asyncHandler(async (req, res) => {
      const incoming = pickFields(req.body, config.fields);
      const incomingColumns = Object.keys(incoming);
      if (!incomingColumns.length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }

      const existingRows = await query(
        `SELECT * FROM ${config.table} WHERE id = ? AND institution_id = ? LIMIT 1`,
        [req.params.id, req.user.institution_id]
      );
      if (!existingRows.length) {
        return res.status(404).json({ error: "Record not found." });
      }

      const merged = normalizeGenericModulePayload(
        config,
        { ...existingRows[0], ...incoming },
        { isCreate: false }
      );
      const validationError = await validateGenericModulePayload({
        config,
        data: merged,
        institutionId: req.user.institution_id
      });
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const columns = config.fields;
      const setClause = columns.map((column) => `${column} = ?`).join(", ");
      const sql = `UPDATE ${config.table}
                   SET ${setClause}, updated_at = NOW()
                   WHERE id = ? AND institution_id = ?`;
      await query(sql, [...columns.map((column) => merged[column] ?? null), req.params.id, req.user.institution_id]);
      await auditLog(req.user, "UPDATE", config.table, req.params.id, incoming);
      res.json({ message: "Record updated." });
    })
  );

  app.delete(
    `${config.route}/:id`,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.DELETE),
    asyncHandler(async (req, res) => {
      await query(`DELETE FROM ${config.table} WHERE id = ? AND institution_id = ?`, [
        req.params.id,
        req.user.institution_id
      ]);
      await auditLog(req.user, "DELETE", config.table, req.params.id);
      res.json({ message: "Record deleted." });
    })
  );

  app.get(
    `${config.route}/export/pdf`,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await getPaginatedRows({
        table: config.table,
        institutionId: req.user.institution_id,
        searchFields: config.searchFields,
        q: req.query.q || "",
        limit: 5000
      });

      const lines = rows.map((row) => JSON.stringify(row));
      sendSimplePdf(res, `${config.table}-report`, lines);
    })
  );

  app.get(
    `${config.route}/export/excel`,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await getPaginatedRows({
        table: config.table,
        institutionId: req.user.institution_id,
        searchFields: config.searchFields,
        q: req.query.q || "",
        limit: 5000
      });
      const headers = rows.length ? Object.keys(rows[0]) : ["No Data"];
      const dataRows = rows.length ? rows.map((row) => headers.map((header) => row[header])) : [];
      await sendSimpleExcel(res, config.table, headers, dataRows);
    })
  );
});

app.post(
  "/api/management/teacher-resources/auto-generate",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const { teacher_profile_id, resource_type, grade, term, strand, sub_strand } = req.body;
    const generated = [
      `Auto-generated ${resource_type} for ${grade} (${term})`,
      `Curriculum focus: Strand ${strand}, Sub-strand ${sub_strand}`,
      "Objectives: Define competency goals, learner engagement and assessment method.",
      "Learning materials: CBC approved text, learner workbook and rubric.",
      "Evaluation: Continuous assessment aligned to CBC standards."
    ].join("\n");

    const result = await query(
      `INSERT INTO teacher_resources
       (institution_id, teacher_profile_id, resource_type, title, description, grade, term, strand, sub_strand, auto_generated, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        req.user.institution_id,
        teacher_profile_id || null,
        resource_type || "Lesson Plan",
        `${resource_type || "Lesson Plan"} - ${grade || "General"}`,
        generated,
        grade || null,
        term || null,
        strand || null,
        sub_strand || null,
        req.user.id
      ]
    );
    await auditLog(req.user, "AUTO_GENERATE_TEACHER_RESOURCE", "teacher_resources", result.insertId);
    res.status(201).json({ id: result.insertId, generatedDocument: generated });
  })
);

app.post(
  "/api/academic/exams/auto-generate",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const {
      grade,
      stream,
      subject,
      strand,
      sub_strand,
      term,
      year,
      title,
      notes_file_path
    } = req.body;

    const examText = [
      `${title || "CBC Auto Generated Exam"} - ${subject || "General Subject"}`,
      `Grade/Class: ${grade || "N/A"} | Stream: ${stream || "N/A"} | Term: ${term || "N/A"} ${year || ""}`,
      `Coverage: Strand ${strand || "N/A"} - Sub-strand ${sub_strand || "N/A"}`,
      "",
      "Section A: Multiple Choice",
      "1. [Auto-generated question from covered concepts]",
      "2. [Auto-generated question from learner notes]",
      "",
      "Section B: Structured Questions",
      "3. Explain the key competency learned under this strand.",
      "4. Apply the competency in a real-life school context.",
      "",
      "Marking guide: Aligned to Kenya CBC mastery levels."
    ].join("\n");

    const result = await query(
      `INSERT INTO academic_exams
        (institution_id, title, grade, stream, subject, strand, sub_strand, notes_file_path, generated_exam_text, term, year, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.institution_id,
        title || "Auto Generated Exam",
        grade || null,
        stream || null,
        subject || null,
        strand || null,
        sub_strand || null,
        notes_file_path || null,
        examText,
        term || null,
        year || null,
        req.user.id
      ]
    );

    await auditLog(req.user, "AUTO_GENERATE_EXAM", "academic_exams", result.insertId);
    res.status(201).json({ id: result.insertId, examText });
  })
);

app.post(
  "/api/attendance/auto-class-register",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const { grade, stream, attendance_date } = req.body;
    const dateValue = attendance_date || dayjs().format("YYYY-MM-DD");
    const learners = await query(
      `SELECT id, full_name, grade, stream
       FROM learners
       WHERE institution_id = ? AND grade = ? AND (? IS NULL OR stream = ?)`,
      [req.user.institution_id, grade, stream || null, stream || null]
    );

    for (const learner of learners) {
      await query(
        `INSERT INTO attendance_records
          (institution_id, attendance_type, person_id, person_name, grade, stream, attendance_date, status, created_by_user_id)
         VALUES (?, 'Learner', ?, ?, ?, ?, ?, 'Present', ?)`,
        [
          req.user.institution_id,
          learner.id,
          learner.full_name,
          learner.grade,
          learner.stream,
          dateValue,
          req.user.id
        ]
      );
    }

    await auditLog(req.user, "AUTO_GENERATE_CLASS_REGISTER", "attendance_records", null, {
      grade,
      stream,
      date: dateValue,
      count: learners.length
    });
    res.json({ message: "Class register auto-generated.", count: learners.length });
  })
);

app.post(
  "/api/workflows/admission-integrity-audit",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = req.user.institution_id;
    const sampleLimitRaw = Number(req.body?.sampleLimit || 100);
    const sampleLimit = Number.isFinite(sampleLimitRaw)
      ? Math.max(10, Math.min(sampleLimitRaw, 500))
      : 100;
    const duplicateAdmissions = await query(
      `SELECT admission_number, COUNT(*) total
       FROM learners
       WHERE institution_id = ? AND deleted_at IS NULL AND admission_number IS NOT NULL AND admission_number <> ''
       GROUP BY admission_number
       HAVING COUNT(*) > 1`,
      [institutionId]
    );
    const duplicateAdmissionSample = duplicateAdmissions.slice(0, sampleLimit);
    const duplicateAdmissionExcess = Math.max(0, duplicateAdmissions.length - duplicateAdmissionSample.length);
    const missingParentContacts = await query(
      `SELECT id, full_name, admission_number
       FROM learners
       WHERE institution_id = ?
         AND deleted_at IS NULL
         AND (parent_phone IS NULL OR parent_phone = '')
         AND (parent_email IS NULL OR parent_email = '')
       ORDER BY id DESC
       LIMIT ?`,
      [institutionId, sampleLimit]
    );
    const [missingParentContactsTotalRow] = await query(
      `SELECT COUNT(*) total
       FROM learners
       WHERE institution_id = ?
         AND deleted_at IS NULL
         AND (parent_phone IS NULL OR parent_phone = '')
         AND (parent_email IS NULL OR parent_email = '')`,
      [institutionId]
    );
    const missingParentContactsTotal = Number(missingParentContactsTotalRow?.total || 0);
    const invalidStatusRows = await query(
      `SELECT id, full_name, admission_number, status
       FROM learners
       WHERE institution_id = ?
         AND deleted_at IS NULL
         AND (status IS NULL OR status = '' OR status NOT IN (?, ?, ?, ?, ?))
       ORDER BY id DESC
       LIMIT ?`,
      [
        institutionId,
        ADMISSION_STATUS[0],
        ADMISSION_STATUS[1],
        ADMISSION_STATUS[2],
        ADMISSION_STATUS[3],
        ADMISSION_STATUS[4],
        sampleLimit
      ]
    );
    const [invalidStatusTotalRow] = await query(
      `SELECT COUNT(*) total
       FROM learners
       WHERE institution_id = ?
         AND deleted_at IS NULL
         AND (status IS NULL OR status = '' OR status NOT IN (?, ?, ?, ?, ?))`,
      [
        institutionId,
        ADMISSION_STATUS[0],
        ADMISSION_STATUS[1],
        ADMISSION_STATUS[2],
        ADMISSION_STATUS[3],
        ADMISSION_STATUS[4]
      ]
    );
    const invalidStatusTotal = Number(invalidStatusTotalRow?.total || 0);

    await auditLog(req.user, "RUN_ADMISSION_INTEGRITY_AUDIT", "learners", null, {
      duplicateAdmissionSets: duplicateAdmissions.length,
      missingParentContacts: missingParentContactsTotal,
      invalidStatusRows: invalidStatusTotal,
      sampleLimit
    });

    res.json({
      message: "Admission integrity audit completed.",
      duplicateAdmissionSets: duplicateAdmissions.length,
      duplicateAdmissions: duplicateAdmissionSample,
      duplicateAdmissionsTruncated: duplicateAdmissionExcess > 0,
      duplicateAdmissionsRemaining: duplicateAdmissionExcess,
      missingParentContactsCount: missingParentContactsTotal,
      missingParentContacts,
      missingParentContactsTruncated: missingParentContactsTotal > missingParentContacts.length,
      invalidStatusCount: invalidStatusTotal,
      invalidStatusRows,
      invalidStatusRowsTruncated: invalidStatusTotal > invalidStatusRows.length,
      sampleLimit
    });
  })
);

app.get(
  "/api/workflows/admission-integrity-audit",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = req.user.institution_id;
    const duplicateAdmissions = await query(
      `SELECT admission_number, COUNT(*) total
       FROM learners
       WHERE institution_id = ? AND deleted_at IS NULL AND admission_number IS NOT NULL AND admission_number <> ''
       GROUP BY admission_number
       HAVING COUNT(*) > 1`,
      [institutionId]
    );
    const missingParentContacts = await query(
      `SELECT id, full_name, admission_number
       FROM learners
       WHERE institution_id = ?
         AND deleted_at IS NULL
         AND (parent_phone IS NULL OR parent_phone = '')
         AND (parent_email IS NULL OR parent_email = '')
       ORDER BY id DESC
       LIMIT 100`,
      [institutionId]
    );
    const invalidStatusRows = await query(
      `SELECT id, full_name, admission_number, status
       FROM learners
       WHERE institution_id = ?
         AND deleted_at IS NULL
         AND (status IS NULL OR status = '' OR status NOT IN (?, ?, ?, ?, ?))
       ORDER BY id DESC
       LIMIT 100`,
      [
        institutionId,
        ADMISSION_STATUS[0],
        ADMISSION_STATUS[1],
        ADMISSION_STATUS[2],
        ADMISSION_STATUS[3],
        ADMISSION_STATUS[4]
      ]
    );

    const summary = {
      duplicateAdmissionSets: duplicateAdmissions.length,
      duplicateAdmissions,
      missingParentContactsCount: missingParentContacts.length,
      missingParentContacts,
      invalidStatusCount: invalidStatusRows.length,
      invalidStatusRows,
      generatedAt: dayjs().format("YYYY-MM-DD HH:mm:ss")
    };

    await auditLog(req.user, "VIEW_ADMISSION_INTEGRITY_AUDIT", "learners", null, {
      duplicateAdmissionSets: summary.duplicateAdmissionSets,
      missingParentContacts: summary.missingParentContactsCount,
      invalidStatusRows: summary.invalidStatusCount
    });

    res.json(summary);
  })
);

app.post(
  "/api/workflows/communication/dispatch-queued",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const institutionId = req.user.institution_id;
    const limitRaw = Number(req.body?.limit || 200);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 200;
    const queuedRows = await query(
      `SELECT id, message_type, recipient_contact
       FROM communication_messages
       WHERE institution_id = ? AND status = 'Queued'
       ORDER BY id ASC
       LIMIT ?`,
      [institutionId, limit]
    );

    let processed = 0;
    for (const message of queuedRows) {
      await query(
        `UPDATE communication_messages
         SET status = 'Sent', sent_at = NOW(), updated_at = NOW()
         WHERE id = ? AND institution_id = ?`,
        [message.id, institutionId]
      );
      processed += 1;
    }
    const [remainingRow] = await query(
      `SELECT COUNT(*) total
       FROM communication_messages
       WHERE institution_id = ? AND status = 'Queued'`,
      [institutionId]
    );

    await auditLog(req.user, "DISPATCH_QUEUED_MESSAGES", "communication_messages", null, {
      processed,
      limit
    });

    res.json({
      message: "Queued messages were marked as sent.",
      processed,
      remainingQueued: Number(remainingRow?.total || 0)
    });
  })
);

app.post(
  "/api/workflows/finance/fee-summary",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.NON_TEACHING_STAFF]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = req.user.institution_id;
    const gradeFilter = normalizeText(req.body?.grade);
    const termFilter = normalizeText(req.body?.term);
    const yearFilter = normalizeYear(req.body?.year);

    const params = [institutionId];
    let extra = "";
    if (gradeFilter) {
      extra += " AND grade = ?";
      params.push(gradeFilter);
    }
    if (termFilter) {
      extra += " AND term = ?";
      params.push(termFilter);
    }
    if (yearFilter !== null) {
      extra += " AND year = ?";
      params.push(yearFilter);
    }

    const structures = await query(
      `SELECT grade, stream, term, year, amount_required
       FROM finance_fee_structures
       WHERE institution_id = ?${extra}`,
      params
    );
    const payments = await query(
      `SELECT grade, stream, SUM(amount_paid) total_paid, COUNT(*) total_payments
       FROM finance_fee_payments
       WHERE institution_id = ?${gradeFilter ? " AND grade = ?" : ""}${
        yearFilter !== null ? " AND YEAR(payment_date) = ?" : ""
      }
       GROUP BY grade, stream`,
      [
        institutionId,
        ...(gradeFilter ? [gradeFilter] : []),
        ...(yearFilter !== null ? [yearFilter] : [])
      ]
    );

    const paymentIndex = new Map(
      payments.map((row) => [`${row.grade || ""}::${row.stream || ""}`, row])
    );
    const merged = structures.map((row) => {
      const key = `${row.grade || ""}::${row.stream || ""}`;
      const payment = paymentIndex.get(key) || { total_paid: 0, total_payments: 0 };
      const required = Number(row.amount_required || 0);
      const paid = Number(payment.total_paid || 0);
      return {
        ...row,
        total_paid: paid,
        balance: required - paid,
        total_payments: Number(payment.total_payments || 0)
      };
    });

    const totals = merged.reduce(
      (acc, item) => {
        acc.required += Number(item.amount_required || 0);
        acc.paid += Number(item.total_paid || 0);
        return acc;
      },
      { required: 0, paid: 0 }
    );
    totals.balance = totals.required - totals.paid;

    await auditLog(req.user, "GENERATE_FEE_SUMMARY", "finance_fee_structures", null, {
      grade: gradeFilter || null,
      term: termFilter || null,
      year: yearFilter,
      lines: merged.length
    });

    res.json({
      message: "Fee summary generated.",
      filters: {
        grade: gradeFilter || null,
        term: termFilter || null,
        year: yearFilter
      },
      totals,
      lines: merged
    });
  })
);

app.post(
  "/api/workflows/academic/normalize-gradebook",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const institutionId = req.user.institution_id;
    const gradeFilter = normalizeText(req.body?.grade);
    const termFilter = normalizeText(req.body?.term);
    const yearFilter = normalizeYear(req.body?.year);

    const params = [institutionId];
    let where = "WHERE institution_id = ?";
    if (gradeFilter) {
      where += " AND grade = ?";
      params.push(gradeFilter);
    }
    if (termFilter) {
      where += " AND term = ?";
      params.push(termFilter);
    }
    if (yearFilter !== null) {
      where += " AND year = ?";
      params.push(yearFilter);
    }

    const rows = await query(
      `SELECT id, marks, percentage, cbc_grade_band
       FROM academic_marks
       ${where}
       ORDER BY id ASC`,
      params
    );

    let updated = 0;
    for (const row of rows) {
      const marks = Number(row.marks || 0);
      const percentage = Number.isFinite(Number(row.percentage)) ? Number(row.percentage) : marks;
      const band = computeCbcBand(marks);
      const needsUpdate =
        Number(row.percentage) !== percentage || String(row.cbc_grade_band || "") !== String(band || "");
      if (!needsUpdate) continue;
      await query(
        `UPDATE academic_marks
         SET percentage = ?, cbc_grade_band = ?, updated_at = NOW()
         WHERE id = ? AND institution_id = ?`,
        [percentage, band, row.id, institutionId]
      );
      updated += 1;
    }

    await auditLog(req.user, "NORMALIZE_GRADEBOOK", "academic_marks", null, {
      grade: gradeFilter || null,
      term: termFilter || null,
      year: yearFilter,
      scanned: rows.length,
      updated
    });

    res.json({
      message: "Academic gradebook normalization completed.",
      scanned: rows.length,
      updated
    });
  })
);

app.get(
  "/api/academic/performance/class-summary",
  auth,
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const summary = await query(
      `SELECT grade, stream, subject,
              ROUND(AVG(marks), 2) mean_score,
              ROUND(AVG(percentage), 2) mean_percentage
       FROM academic_marks
       WHERE institution_id = ?
       GROUP BY grade, stream, subject
       ORDER BY grade, stream, subject`,
      [req.user.institution_id]
    );
    res.json(summary);
  })
);

app.get(
  "/api/academic/performance/positions",
  auth,
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT learner_id, learner_name, grade, stream, SUM(marks) total_score,
              ROUND(AVG(percentage), 2) mean_percentage
       FROM academic_marks
       WHERE institution_id = ?
       GROUP BY learner_id, learner_name, grade, stream
       ORDER BY grade, stream, total_score DESC`,
      [req.user.institution_id]
    );
    res.json(rows);
  })
);

app.get(
  "/api/parent/results",
  auth,
  enforceRole([ROLES.PARENT]),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT *
       FROM academic_marks
       WHERE institution_id = ? AND learner_id = ?
       ORDER BY year DESC, term DESC`,
      [req.user.institution_id, req.user.learner_id]
    );
    res.json(rows);
  })
);

app.get(
  "/api/parent/results/export/pdf",
  auth,
  enforceRole([ROLES.PARENT, ROLES.BOM]),
  asyncHandler(async (req, res) => {
    let rows = [];
    if (req.user.role === ROLES.PARENT) {
      rows = await query(
        `SELECT learner_name, subject, marks, percentage, cbc_grade_band, term, year
         FROM academic_marks
         WHERE institution_id = ? AND learner_id = ?
         ORDER BY year DESC, term DESC`,
        [req.user.institution_id, req.user.learner_id]
      );
    } else {
      rows = await query(
        `SELECT learner_name, subject, marks, percentage, cbc_grade_band, term, year
         FROM academic_marks
         WHERE institution_id = ?
         ORDER BY year DESC, term DESC
         LIMIT 1000`,
        [req.user.institution_id]
      );
    }
    sendSimplePdf(
      res,
      "learner-results",
      rows.map(
        (row) =>
          `${row.learner_name} | ${row.subject} | ${row.marks} | ${row.cbc_grade_band} | ${row.term} ${row.year}`
      )
    );
  })
);

app.get(
  "/api/learner/materials",
  auth,
  enforceRole([ROLES.LEARNER]),
  asyncHandler(async (req, res) => {
    const learnerRows = await query(
      "SELECT grade, stream FROM learners WHERE id = ? AND institution_id = ? LIMIT 1",
      [req.user.learner_id, req.user.institution_id]
    );
    if (!learnerRows.length) {
      return res.status(404).json({ error: "Learner profile not found." });
    }
    const learner = learnerRows[0];
    const resources = await query(
      `SELECT *
       FROM learner_resources
       WHERE institution_id = ? AND grade = ? AND (stream = ? OR stream IS NULL OR stream = '')
       ORDER BY id DESC`,
      [req.user.institution_id, learner.grade, learner.stream || ""]
    );
    res.json(resources);
  })
);

app.get(
  "/api/learner/marks",
  auth,
  enforceRole([ROLES.LEARNER]),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT learner_name, exam_type, subject, marks, percentage, cbc_grade_band, term, year
       FROM academic_marks
       WHERE institution_id = ? AND learner_id = ?`,
      [req.user.institution_id, req.user.learner_id]
    );
    res.json(rows);
  })
);

app.get(
  "/api/communication/chat-placeholder",
  auth,
  enforceRole([ROLES.PARENT, ROLES.TEACHER, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    res.json({
      message:
        "Parent/Teacher chat endpoint placeholder is enabled. Plug a websocket service for live chat."
    });
  })
);

app.get("/", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  // eslint-disable-next-line no-console
  console.error("Unhandled API error:", err);
  return res.status(500).json({ error: "Internal server error.", details: err.message });
});

module.exports = app;
