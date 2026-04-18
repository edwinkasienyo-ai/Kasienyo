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
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use("/uploads", express.static(uploadsPath));
app.use(express.static(path.join(process.cwd(), "public")));

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
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
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
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Role is not allowed for this action." });
    }
    return next();
  };
}

function toPortal(role) {
  switch (role) {
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

    if (
      !learner.first_name ||
      !learner.last_name ||
      !learner.admission_number ||
      !learner.birth_certificate_number
    ) {
      rejectedRows.push({
        row: record.rowNumber,
        reason:
          "Required values missing (first_name, last_name, admission_number, birth_certificate_number)."
      });
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
  data.status = normalizeText(data.status) || "In Session";
  data.parent_full_name = normalizeText(data.parent_full_name);
  data.parent_relationship = normalizeText(data.parent_relationship);
  data.parent_id_number = normalizeText(data.parent_id_number);
  data.parent_phone = normalizeText(data.parent_phone);
  data.parent_email = normalizeText(data.parent_email);

  data.year_joined = data.year_joined ? Number(data.year_joined) : null;
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

  return {
    identity: user.username,
    role: user.role,
    institution_id: user.institution_id,
    destination: user.email || user.phone || user.username,
    payload: {
      id: user.id,
      role: user.role,
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
  res.json({
    role: req.user.role,
    portal: toPortal(req.user.role),
    institution_id: req.user.institution_id,
    permissions: ROLE_PERMISSIONS[req.user.role] || []
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
    sheet.addRow([
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
    ]);
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
    const requiredHeaders = ["first_name", "last_name", "admission_number", "birth_certificate_number"];
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

    fs.unlink(req.file.path, () => {});
    await auditLog(req.user, "BULK_UPLOAD_ADMISSION", "learners", null, {
      insertedOrUpdated,
      source_format: extension,
      rejected: rejectedRows.length
    });
    res.json({
      message: "Admission bulk upload completed.",
      sourceFormat: extension,
      insertedOrUpdated,
      rejectedRows
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
      "SELECT id FROM learners WHERE id = ? AND institution_id = ? LIMIT 1",
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

    if (!ALLOWED_ADMISSION_SEARCH_FIELDS.has(field)) {
      return res.status(400).json({ error: "Invalid admission search field selected." });
    }

    const params = [req.user.institution_id];
    let where = "WHERE institution_id = ?";
    if (value) {
      where += ` AND ${field} LIKE ?`;
      params.push(`%${value}%`);
    }
    if (status) {
      where += " AND status = ?";
      params.push(status);
    }

    const rows = await query(
      `SELECT * FROM learners
       ${where}
       ORDER BY ${ADMISSION_STATUS_ORDER_SQL}`,
      params
    );
    res.json(formatLearnerStatusRows(rows));
  })
);

app.get(
  "/api/admission/learners/:id/export/pdf",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query("SELECT * FROM learners WHERE id = ? AND institution_id = ? LIMIT 1", [
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

    let matchedCount = 0;
    const rejectedFiles = [];

    for (const file of req.files) {
      const isImage = String(file.mimetype || "").startsWith("image/");
      if (!isImage) {
        rejectedFiles.push({
          file: file.originalname,
          reason: "Only image files are accepted."
        });
        fs.unlink(file.path, () => {});
        continue;
      }

      const inferredAdmission = inferAdmissionNumberFromFilename(file.originalname);
      const normalizedAdmission = normalizeAdmissionKey(inferredAdmission);
      const learner = learnerIndex.get(normalizedAdmission);
      if (!learner) {
        rejectedFiles.push({
          file: file.originalname,
          reason:
            "No learner matches this filename. Use admission number as filename (example: ADM001.jpg)."
        });
        fs.unlink(file.path, () => {});
        continue;
      }

      const filePath = `/uploads/${file.filename}`;
      await query(
        "UPDATE learners SET passport_photo_path = ?, updated_at = NOW() WHERE id = ? AND institution_id = ?",
        [filePath, learner.id, req.user.institution_id]
      );
      matchedCount += 1;
    }

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

app.get(
  "/api/admission/learners/register/print",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const statusFilter = normalizeText(req.query.status);
    const params = [req.user.institution_id];
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
    doc.moveDown(0.8);

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
        role,
        email || null,
        phone || null,
        req.user.id
      ]
    );
    await auditLog(req.user, "CREATE_USER", "users", result.insertId, { username, role });
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
        `SELECT * FROM ${admissionConfig.table} WHERE id = ? AND institution_id = ? LIMIT 1`,
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

      const columns = Object.keys(data);
      if (!columns.length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }

      if (!data.first_name || !data.last_name || !data.admission_number || !data.birth_certificate_number) {
        return res.status(400).json({
          error: "first_name, last_name, admission_number and birth_certificate_number are required."
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
      const data = normalizeLearnerPayload(pickFields(req.body, admissionConfig.fields));
      const columns = Object.keys(data);
      if (!columns.length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }

      const setClause = columns.map((column) => `${column} = ?`).join(", ");
      const sql = `UPDATE ${admissionConfig.table}
                   SET ${setClause}, updated_at = NOW()
                   WHERE id = ? AND institution_id = ?`;
      await query(sql, [...Object.values(data), req.params.id, req.user.institution_id]);
      await auditLog(req.user, "UPDATE", admissionConfig.table, req.params.id, data);
      res.json({ message: "Record updated." });
    })
  );

  app.delete(
    `${admissionConfig.route}/:id`,
    auth,
    enforceRole(admissionConfig.allowedRoles),
    enforcePermission(PERMISSIONS.DELETE),
    asyncHandler(async (req, res) => {
      await query(`DELETE FROM ${admissionConfig.table} WHERE id = ? AND institution_id = ?`, [
        req.params.id,
        req.user.institution_id
      ]);
      await auditLog(req.user, "DELETE", admissionConfig.table, req.params.id);
      res.json({ message: "Record deleted." });
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
      const data = pickFields(req.body, config.fields);
      data.institution_id = req.user.institution_id;
      data.created_by_user_id = req.user.id;

      if (config.table === "academic_marks" && data.marks !== undefined && data.marks !== null) {
        const markValue = Number(data.marks);
        data.percentage = data.percentage ?? markValue;
        if (!data.cbc_grade_band) {
          if (markValue >= 75) data.cbc_grade_band = "EE";
          else if (markValue >= 50) data.cbc_grade_band = "ME";
          else if (markValue >= 25) data.cbc_grade_band = "AE";
          else data.cbc_grade_band = "BE";
        }
      }

      if (config.table === "non_teaching_staff_profiles" && !data.staff_number) {
        data.staff_number = `NTS-${Date.now()}`;
      }

      if (config.table === "finance_fee_payments" && !data.receipt_number) {
        data.receipt_number = `RCPT-${Date.now()}`;
      }

      if (config.table === "finance_procurement_records" && !data.document_number) {
        const prefix = (data.document_type || "DOC").replace(/\s+/g, "").toUpperCase();
        data.document_number = `${prefix}-${Date.now()}`;
      }

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
      const data = pickFields(req.body, config.fields);
      const columns = Object.keys(data);
      if (!columns.length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }

      const setClause = columns.map((column) => `${column} = ?`).join(", ");
      const sql = `UPDATE ${config.table}
                   SET ${setClause}, updated_at = NOW()
                   WHERE id = ? AND institution_id = ?`;
      await query(sql, [...Object.values(data), req.params.id, req.user.institution_id]);
      await auditLog(req.user, "UPDATE", config.table, req.params.id, data);
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
