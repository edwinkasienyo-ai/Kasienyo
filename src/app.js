const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
const { v4: uuidv4 } = require("uuid");
const dayjs = require("dayjs");
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
const {
  COUNTIES,
  INSTITUTION_CATEGORIES,
  KENYA_POSTAL_CODES,
  COUNTY_BY_CODE,
  INSTITUTION_CATEGORY_BY_LABEL
} = require("./config/registrationData");
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
  return (ROLE_PERMISSIONS[normalizeRole(role)] || []).includes(permission);
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
    const normalizedRole = normalizeRole(req.user.role);
    if (normalizedRole === ROLES.SYSTEM_DEVELOPER) {
      return next();
    }
    if (!roles.includes(normalizedRole)) {
      return res.status(403).json({ error: "Role is not allowed for this action." });
    }
    return next();
  };
}

function toPortal(role) {
  switch (normalizeRole(role)) {
    case ROLES.SYSTEM_DEVELOPER:
      return "System Developer Console";
    case ROLES.ADMIN:
      return "Administrator Dashboard";
    case ROLES.HEAD_OF_INSTITUTION:
      return "Head of Institution Portal";
    case ROLES.MOD:
      return "MoE Oversight Portal";
    case ROLES.TSC:
      return "TSC Oversight Portal";
    case ROLES.TEACHER:
      return "Teacher Portal";
    case ROLES.NON_TEACHING_STAFF:
      return "Non-Teaching Staff Portal";
    case ROLES.PARENT:
      return "Parent Portal";
    case ROLES.BOM:
      return "Board of Management Portal";
    case ROLES.LEARNER:
      return "Learners Portal";
    case ROLES.SUPPLIER:
      return "Supplier Portal";
    case ROLES.CONTRACTOR:
      return "Contractor Portal";
    default:
      return "General Portal";
  }
}

function cleanValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeRole(value) {
  const base = cleanValue(value).toUpperCase().replace(/[\s-]+/g, "_");
  if (!base) return "";
  const roleAliases = {
    ADMINISTRATOR: ROLES.ADMIN,
    SCHOOL_ADMIN: ROLES.ADMIN,
    HEAD: ROLES.HEAD_OF_INSTITUTION,
    HEAD_TEACHER: ROLES.HEAD_OF_INSTITUTION,
    PRINCIPAL: ROLES.HEAD_OF_INSTITUTION,
    HEAD_OF_SCHOOL: ROLES.HEAD_OF_INSTITUTION,
    NON_TEACHING: ROLES.NON_TEACHING_STAFF,
    NONTEACHING: ROLES.NON_TEACHING_STAFF,
    BOARD_OF_MANAGEMENT: ROLES.BOM,
    SYSTEMDEVELOPER: ROLES.SYSTEM_DEVELOPER,
    MINISTRY_OF_EDUCATION: ROLES.MOD,
    MINISTRY_OF_BASIC_EDUCATION: ROLES.MOD
  };
  if (roleAliases[base]) {
    return roleAliases[base];
  }
  return Object.values(ROLES).includes(base) ? base : base;
}

function cleanOptionalValue(value) {
  const cleaned = cleanValue(value);
  return cleaned || null;
}

const PUBLIC_ROLE_OPTIONS = [
  ROLES.SYSTEM_DEVELOPER,
  ROLES.HEAD_OF_INSTITUTION,
  ROLES.TEACHER,
  ROLES.NON_TEACHING_STAFF,
  ROLES.MOD,
  ROLES.TSC,
  ROLES.BOM,
  ROLES.PARENT,
  ROLES.LEARNER,
  ROLES.SUPPLIER,
  ROLES.CONTRACTOR
];

const AGREEMENT_COMPANY = {
  name: "Mwendegu Enterprise Limited",
  email: "mwendeguenterpriseltd@gmail.com",
  phone: "+254 725 757 767"
};

const PASSWORD_ROTATION_DAYS = Number(process.env.PASSWORD_ROTATION_DAYS || 30);
const PASSWORD_ROTATION_EXEMPT_ROLES = new Set([ROLES.SYSTEM_DEVELOPER]);

function padThree(value) {
  return String(Number(value) || 0).padStart(3, "0");
}

function parseTruthy(value) {
  if (typeof value === "boolean") return value;
  const normalized = cleanValue(value).toLowerCase();
  if (!normalized) return false;
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function isOtpChannelConfigured(channel) {
  const normalized = cleanValue(channel).toLowerCase();
  if (!normalized || normalized === "console") {
    return true;
  }
  const smtpReady = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const smsReady = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM
  );
  if (normalized === "email") {
    return smtpReady;
  }
  if (normalized === "sms") {
    return smsReady;
  }
  if (normalized === "sms_email") {
    return smtpReady && smsReady;
  }
  return false;
}

function resolveCounty({ countyCode, countyName }) {
  const byCode = countyCode ? COUNTY_BY_CODE[padThree(countyCode)] : null;
  if (byCode) return byCode;
  if (!countyName) return null;
  return COUNTIES.find((item) => item.name.toLowerCase() === countyName.toLowerCase()) || null;
}

function resolveInstitutionCategory({ categoryCode, categoryLabel }) {
  const normalizedCode = cleanValue(categoryCode).toUpperCase();
  if (normalizedCode) {
    const byCode = INSTITUTION_CATEGORIES.find((item) => item.code === normalizedCode);
    if (byCode) return byCode;
  }
  if (!categoryLabel) return null;
  return INSTITUTION_CATEGORY_BY_LABEL[categoryLabel.toLowerCase()] || null;
}

function getPostalDetails(postalCode) {
  const normalized = cleanValue(postalCode);
  if (!normalized) return null;
  return KENYA_POSTAL_CODES.find((item) => item.postal_code === normalized) || null;
}

async function nextInstitutionCode({ countyCode, categoryCode }) {
  const prefix = `${countyCode}/${categoryCode}/`;
  const [row] = await query(
    "SELECT COUNT(*) total FROM institutions WHERE institution_code LIKE ?",
    [`${prefix}%`]
  );
  const next = Number(row?.total || 0) + 1;
  return `${countyCode}/${categoryCode}/${padThree(next)}`;
}

function generateStrongPassword(length = 12) {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%&*!";
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return output;
}

async function dispatchCredentialNotice({ email, phone, subject, message }) {
  const report = { emailSent: false, smsSent: false, errors: [] };

  if (email && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || "false") === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: email,
        subject,
        text: message
      });
      report.emailSent = true;
    } catch (error) {
      report.errors.push(`Email not sent: ${error.message}`);
    }
  }

  if (
    phone &&
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM
  ) {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        from: process.env.TWILIO_FROM,
        to: phone,
        body: message
      });
      report.smsSent = true;
    } catch (error) {
      report.errors.push(`SMS not sent: ${error.message}`);
    }
  }

  // Always print credential traffic for ops traceability.
  // eslint-disable-next-line no-console
  console.log(`[IMIS NOTICE] ${subject}\n${message}`);
  return report;
}

function evaluatePasswordRotation(user = {}) {
  const role = normalizeRole(user.role);
  if (!PASSWORD_ROTATION_DAYS || PASSWORD_ROTATION_EXEMPT_ROLES.has(role)) {
    return {
      requiredDays: PASSWORD_ROTATION_DAYS,
      exempt: true,
      remainingDays: null,
      overdue: false,
      passwordAgeDays: null,
      referenceDate: null
    };
  }
  const referenceDateRaw = user.password_last_changed_at || user.updated_at || user.created_at || null;
  const referenceDate = referenceDateRaw ? dayjs(referenceDateRaw) : dayjs();
  const ageDays = Math.max(dayjs().diff(referenceDate, "day"), 0);
  const remainingDays = PASSWORD_ROTATION_DAYS - ageDays;
  return {
    requiredDays: PASSWORD_ROTATION_DAYS,
    exempt: false,
    remainingDays,
    overdue: remainingDays < 0,
    passwordAgeDays: ageDays,
    referenceDate: referenceDate.format("YYYY-MM-DD HH:mm:ss")
  };
}

const MODULE_KEYS = {
  ADMISSION: "admission",
  MANAGEMENT_TEACHERS: "management-teachers",
  MANAGEMENT_NON_TEACHING: "management-non-teaching",
  MANAGEMENT_TEACHER_RESOURCES: "management-teacher-resources",
  ATTENDANCE: "attendance",
  ACADEMIC_EXAMS: "academic-exams",
  ACADEMIC_MARKS: "academic-marks",
  HR_LEAVE: "hr-leave",
  HR_RECRUITMENT: "hr-recruitment",
  FINANCE_FEE_STRUCTURE: "finance-fee-structure",
  FINANCE_FEE_PAYMENTS: "finance-fee-payments",
  FINANCE_PROCUREMENT: "finance-procurement",
  COMMUNICATION_ANNOUNCEMENTS: "communication-announcements",
  COMMUNICATION_MESSAGES: "communication-messages",
  LEARNER_RESOURCES: "learner-resources",
  WELFARE_MEMBERS: "welfare-members",
  WELFARE_CONTRIBUTIONS: "welfare-contributions",
  WELFARE_LOANS: "welfare-loans",
  LAWS: "laws",
  DASHBOARD: "dashboard",
  SEARCH: "search",
  PARENT_RESULTS: "parent-results",
  LEARNER_MATERIALS: "learner-materials"
};

const DEFAULT_MODULE_ACCESS_BY_ROLE = {
  [ROLES.SYSTEM_DEVELOPER]: Object.values(MODULE_KEYS),
  [ROLES.ADMIN]: Object.values(MODULE_KEYS),
  [ROLES.HEAD_OF_INSTITUTION]: Object.values(MODULE_KEYS),
  [ROLES.MOD]: [MODULE_KEYS.DASHBOARD],
  [ROLES.TSC]: [MODULE_KEYS.DASHBOARD],
  [ROLES.TEACHER]: [
    MODULE_KEYS.ADMISSION,
    MODULE_KEYS.MANAGEMENT_TEACHER_RESOURCES,
    MODULE_KEYS.ATTENDANCE,
    MODULE_KEYS.ACADEMIC_EXAMS,
    MODULE_KEYS.ACADEMIC_MARKS,
    MODULE_KEYS.HR_LEAVE,
    MODULE_KEYS.LEARNER_RESOURCES,
    MODULE_KEYS.COMMUNICATION_ANNOUNCEMENTS,
    MODULE_KEYS.LEARNER_MATERIALS,
    MODULE_KEYS.DASHBOARD,
    MODULE_KEYS.SEARCH
  ],
  [ROLES.NON_TEACHING_STAFF]: [
    MODULE_KEYS.HR_LEAVE,
    MODULE_KEYS.FINANCE_FEE_PAYMENTS,
    MODULE_KEYS.FINANCE_PROCUREMENT,
    MODULE_KEYS.WELFARE_MEMBERS,
    MODULE_KEYS.WELFARE_CONTRIBUTIONS,
    MODULE_KEYS.WELFARE_LOANS,
    MODULE_KEYS.LAWS,
    MODULE_KEYS.DASHBOARD
  ],
  [ROLES.BOM]: [MODULE_KEYS.PARENT_RESULTS, MODULE_KEYS.ACADEMIC_MARKS, MODULE_KEYS.DASHBOARD],
  [ROLES.PARENT]: [MODULE_KEYS.PARENT_RESULTS, MODULE_KEYS.DASHBOARD],
  [ROLES.LEARNER]: [MODULE_KEYS.LEARNER_MATERIALS, MODULE_KEYS.DASHBOARD],
  [ROLES.SUPPLIER]: [MODULE_KEYS.FINANCE_PROCUREMENT, MODULE_KEYS.DASHBOARD],
  [ROLES.CONTRACTOR]: [MODULE_KEYS.FINANCE_PROCUREMENT, MODULE_KEYS.DASHBOARD]
};

async function hasModuleAccess(user, moduleKey) {
  if (!moduleKey || !user?.id) {
    return true;
  }
  const normalizedRole = normalizeRole(user.role);
  if (normalizedRole === ROLES.SYSTEM_DEVELOPER) {
    return true;
  }
  const defaultModules = DEFAULT_MODULE_ACCESS_BY_ROLE[normalizedRole] || [];
  const defaultAllowed = defaultModules.includes(moduleKey);
  const overrides = await query(
    `SELECT can_access
     FROM user_module_access_overrides
     WHERE user_id = ? AND module_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [user.id, moduleKey]
  );
  if (overrides.length) {
    return Number(overrides[0].can_access) === 1;
  }
  return defaultAllowed;
}

function enforceModuleAccess(moduleKey) {
  return asyncHandler(async (req, res, next) => {
    const allowed = await hasModuleAccess(req.user, moduleKey);
    if (!allowed) {
      return res.status(403).json({
        error: "Module access denied for this role. Request access from System Developer."
      });
    }
    return next();
  });
}

function getScopedFilter(config, user) {
  const normalizedRole = normalizeRole(user.role);
  if (
    config?.scopedByRole &&
    Array.isArray(config.scopedByRole.roles) &&
    config.scopedByRole.roles.includes(normalizedRole) &&
    config.scopedByRole.column
  ) {
    const identity = cleanValue(user.full_name) || cleanValue(user.username);
    return {
      where: ` AND ${config.scopedByRole.column} = ?`,
      params: [identity]
    };
  }
  return { where: "", params: [] };
}

function buildAgreementLines({ institution, adminUser }) {
  const today = dayjs().format("YYYY-MM-DD");
  return [
    `${AGREEMENT_COMPANY.name} - Institution System Agreement`,
    `Date: ${today}`,
    "",
    `To: The Head of Institution`,
    `Institution: ${institution.institution_name}`,
    `Institution Code: ${institution.institution_code}`,
    `County: ${institution.county || "-"}`,
    `Email: ${institution.email || "-"}`,
    `Phone: ${institution.phone || "-"}`,
    "",
    "This agreement confirms that the institution will:",
    "1. Use IMIS in line with all applicable laws and regulations.",
    "2. Protect user credentials and sensitive learner/staff data.",
    "3. Settle subscription/service obligations on time.",
    "4. Prevent misuse under computer misuse and cybercrime statutes.",
    "",
    `Administrator/Head Account: ${adminUser?.username || "-"}`,
    "By using this system, the institution accepts these terms as binding.",
    "",
    `Provider: ${AGREEMENT_COMPANY.name}`,
    `Contacts: ${AGREEMENT_COMPANY.phone} | ${AGREEMENT_COMPANY.email}`
  ];
}

app.get("/api/public/registration/meta", (_, res) => {
  res.json({
    counties: COUNTIES,
    categories: INSTITUTION_CATEGORIES,
    postalCodes: KENYA_POSTAL_CODES
  });
});

function pickFields(payload, allowedFields) {
  return allowedFields.reduce((acc, field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      acc[field] = payload[field];
    }
    return acc;
  }, {});
}

function parseStoredJson(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  const raw = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  const normalized = raw.trim();
  if (!normalized || normalized === "[object Object]") {
    return null;
  }
  // Guard malformed legacy payload rows that are not JSON strings.
  if (!normalized.startsWith("{") && !normalized.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(normalized);
  } catch (error) {
    return null;
  }
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
  return { code, expiresAt };
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
  const normalizedRole = normalizeRole(user.role);
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return null;
  }
  if (
    !PASSWORD_ROTATION_EXEMPT_ROLES.has(normalizedRole) &&
    user.password_expires_at &&
    dayjs(user.password_expires_at).isValid() &&
    dayjs(user.password_expires_at).isBefore(dayjs())
  ) {
    return {
      blocked: true,
      role: normalizedRole,
      error:
        "Password expired. Use Forgot Password or contact your administrator/System Developer for reset."
    };
  }

  return {
    identity: user.username,
    role: normalizedRole,
    institution_id: user.institution_id,
    destination: user.email || user.phone || user.username,
    payload: {
      id: user.id,
      role: normalizedRole,
      institution_id: user.institution_id,
      full_name: user.full_name,
      username: user.username,
      password_last_changed_at: user.password_last_changed_at || null,
      password_expires_at: user.password_expires_at || null,
      must_change_password: Number(user.must_change_password || 0) === 1
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
               ORDER BY id DESC
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
    exportFormats: EXPORT_FORMATS,
    moduleKeys: MODULE_KEYS,
    defaultModuleAccessByRole: DEFAULT_MODULE_ACCESS_BY_ROLE
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

  const userAccount = await authenticateByUserTable(username, password);
  if (userAccount?.blocked) {
    return res.status(403).json({
      error: userAccount.error,
      role: userAccount.role,
      action_required: "PASSWORD_RESET_REQUIRED"
    });
  }
  let account =
    userAccount ||
    (await authenticateParentByLearner(username, password)) ||
    (await authenticateLearner(username, password));

  if (!account) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  const requestedChannel = cleanValue(otpChannel || process.env.OTP_CHANNEL || "console").toLowerCase() || "console";
  const channel = isOtpChannelConfigured(requestedChannel) ? requestedChannel : "console";
  const otpSession = await createOtpSession({
    identity: account.identity,
    role: account.role,
    institutionId: account.institution_id,
    payload: account.payload,
    destination: account.destination,
    channel
  });
  const exposeOtpPreview =
    process.env.NODE_ENV !== "production" || parseTruthy(process.env.EXPOSE_OTP_PREVIEW);

  return res.json({
    message:
      channel === requestedChannel
        ? "OTP sent successfully."
        : `OTP sent successfully using console fallback because '${requestedChannel}' is not configured.`,
    role: account.role,
    portal: toPortal(account.role),
    otp_channel: channel,
    otp_channel_used: channel,
    otp_preview: exposeOtpPreview ? otpSession.code : null,
    otp_expires_at: exposeOtpPreview ? otpSession.expiresAt : null
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
     ORDER BY id DESC
     LIMIT 20`,
    [username, otp]
  );

  if (!sessions.length) {
    return res.status(401).json({ error: "Invalid or expired OTP." });
  }

  let payload = null;
  let session = null;
  for (const candidate of sessions) {
    try {
      const parsed = parseStoredJson(candidate.payload_json);
      if (parsed && typeof parsed === "object") {
        session = candidate;
        payload = parsed;
        break;
      }
      // Invalidate empty or non-object payloads to keep OTP store healthy.
      // eslint-disable-next-line no-await-in-loop
      await query("UPDATE otp_sessions SET is_used = 1 WHERE id = ?", [candidate.id]);
    } catch (error) {
      // Invalidate malformed payload rows so future verifications skip them.
      // eslint-disable-next-line no-await-in-loop
      await query("UPDATE otp_sessions SET is_used = 1 WHERE id = ?", [candidate.id]);
    }
  }
  if (!session || !payload) {
    return res.status(401).json({
      error: "Invalid or expired OTP. Please request a fresh OTP and try again."
    });
  }
  await query("UPDATE otp_sessions SET is_used = 1 WHERE id = ?", [session.id]);
  payload.role = normalizeRole(payload.role);
  const token = issueToken(payload);
  await auditLog(payload, "LOGIN_SUCCESS", "auth", payload.id, { role: payload.role });

  res.json({
    token,
    role: payload.role,
    portal: toPortal(payload.role),
    user: payload
  });
}));

app.get("/api/auth/me", auth, asyncHandler(async (req, res) => {
  if (!req.user?.id || String(req.user.id).startsWith("PARENT-") || String(req.user.id).startsWith("LEARNER-")) {
    return res.json({
      id: req.user?.id || null,
      role: req.user?.role || null,
      institution_id: req.user?.institution_id || null,
      full_name: req.user?.full_name || null,
      username: req.user?.username || null,
      password_last_changed_at: null,
      password_expires_at: null,
      must_change_password: false,
      password_days_remaining: null
    });
  }

  const rows = await query(
    `SELECT id, role, institution_id, full_name, username, password_last_changed_at, password_expires_at, must_change_password
     FROM users
     WHERE id = ? AND institution_id = ?
     LIMIT 1`,
    [req.user.id, req.user.institution_id]
  );
  if (!rows.length) {
    return res.status(404).json({ error: "User account not found." });
  }
  const user = rows[0];
  const passwordPolicy = evaluatePasswordRotation(user);
  res.json({
    ...user,
    must_change_password: Number(user.must_change_password || 0) === 1,
    password_days_remaining: passwordPolicy.remainingDays
  });
}));

app.patch("/api/users/:id/force-reset-password", auth, enforceRole([ROLES.SYSTEM_DEVELOPER]), asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (!userId) {
    return res.status(400).json({ error: "Valid user id is required." });
  }
  const users = await query("SELECT id, full_name, username, email, phone, institution_id FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!users.length) {
    return res.status(404).json({ error: "User account not found." });
  }

  const generatedPassword = generateStrongPassword(12);
  const passwordHash = await hashPassword(generatedPassword);
  await query(
    `UPDATE users
     SET password_hash = ?, password_last_changed_at = NOW(), password_expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY)
     WHERE id = ?`,
    [passwordHash, userId]
  );

  const user = users[0];
  const credentialDispatch = await dispatchCredentialNotice({
    email: user.email,
    phone: user.phone,
    subject: "IMIS Password Reset by System Developer",
    message: [
      "Your IMIS password has been reset by the system developer.",
      `Institution ID: ${user.institution_id}`,
      `Username: ${user.username}`,
      `Password: ${generatedPassword}`,
      "Please change your password immediately after login."
    ].join("\n")
  });

  await auditLog(req.user, "SYSTEM_DEVELOPER_FORCE_RESET_PASSWORD", "users", userId, {
    username: user.username,
    credential_dispatch: credentialDispatch
  });

  res.json({
    message: "Password reset and credential dispatch completed.",
    username: user.username,
    generated_password: generatedPassword,
    credential_dispatch: credentialDispatch
  });
}));

app.post("/api/public/register-institution", asyncHandler(async (req, res) => {
  const institutionName = cleanValue(req.body?.institution_name);
  const institutionEmail = cleanOptionalValue(req.body?.email);
  const institutionPhone = cleanOptionalValue(req.body?.phone);
  const countyInput = cleanOptionalValue(req.body?.county);
  const countyCodeInput = cleanOptionalValue(req.body?.county_code);
  const categoryInput = cleanOptionalValue(req.body?.category);
  const subCounty = cleanOptionalValue(req.body?.sub_county);
  const location = cleanOptionalValue(req.body?.location);
  const village = cleanOptionalValue(req.body?.village);
  const postalCodeInput = cleanOptionalValue(req.body?.postal_code);
  const townInput = cleanOptionalValue(req.body?.town);
  const sendAgreementEmail = parseTruthy(req.body?.send_agreement_email);
  const autoGeneratePassword = parseTruthy(req.body?.auto_generate_password);

  const adminFullName = cleanValue(req.body?.admin_full_name);
  const adminUsername = cleanValue(req.body?.admin_username);
  const adminPasswordInput = cleanValue(req.body?.admin_password);
  const portalRoleRaw = cleanValue(req.body?.portal_role);
  const portalRole = [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION].includes(portalRoleRaw)
    ? portalRoleRaw
    : ROLES.HEAD_OF_INSTITUTION;

  const countyRecord = resolveCounty({ countyCode: countyCodeInput, countyName: countyInput });
  if (!countyRecord) {
    return res.status(400).json({ error: "Select a valid county." });
  }
  const categoryRecord = resolveInstitutionCategory({
    categoryCode: categoryInput,
    categoryLabel: categoryInput
  });
  if (!categoryRecord) {
    return res.status(400).json({ error: "Select a valid institution category." });
  }

  const postalDetails = getPostalDetails(postalCodeInput);
  const normalizedTown = townInput || postalDetails?.town || null;
  const institutionCode = await nextInstitutionCode({
    countyCode: countyRecord.code,
    categoryCode: categoryRecord.code
  });

  const adminPassword = autoGeneratePassword
    ? generateStrongPassword(12)
    : adminPasswordInput;

  if (!institutionName || !adminFullName || !adminUsername || !adminPassword) {
    return res.status(400).json({
      error: "institution_name, admin_full_name, admin_username and admin_password are required."
    });
  }

  const existingInstitution = await query(
    "SELECT id FROM institutions WHERE institution_code = ? LIMIT 1",
    [institutionCode]
  );
  if (existingInstitution.length) {
    return res.status(409).json({ error: "Institution code already exists." });
  }

  const institutionInsert = await query(
    `INSERT INTO institutions
      (institution_name, institution_code, email, phone, county, sub_county, location, village)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      institutionName,
      institutionCode,
      institutionEmail,
      institutionPhone,
      countyRecord.name,
      subCounty,
      location,
      normalizedTown || village
    ]
  );
  const institutionId = institutionInsert.insertId;
  const passwordHash = await hashPassword(adminPassword);

  await query(
    `INSERT INTO users
      (institution_id, full_name, username, password_hash, password_last_changed_at, password_expires_at, role, email, phone, is_active)
     VALUES (?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY), ?, ?, ?, 1)`,
    [
      institutionId,
      adminFullName,
      adminUsername,
      passwordHash,
      PASSWORD_ROTATION_DAYS,
      portalRole,
      institutionEmail,
      institutionPhone
    ]
  );

  const credentialMessage = [
    "Welcome to the Integrated Management Information System for Basic Education.",
    `Institution: ${institutionName}`,
    `Institution Code: ${institutionCode}`,
    `Username: ${adminUsername}`,
    `Password: ${adminPassword}`,
    "Please change your password immediately after first login."
  ].join("\n");
  const credentialDispatch = await dispatchCredentialNotice({
    email: institutionEmail,
    phone: institutionPhone,
    subject: "IMIS Institution Administrator Credentials",
    message: credentialMessage
  });

  const institutionRecord = {
    id: institutionId,
    institution_name: institutionName,
    institution_code: institutionCode,
    county: countyRecord.name,
    email: institutionEmail,
    phone: institutionPhone
  };

  let agreementEmailDispatch = null;
  if (sendAgreementEmail) {
    agreementEmailDispatch = await dispatchCredentialNotice({
      email: institutionEmail,
      phone: null,
      subject: "IMIS Service Agreement Letter",
      message: buildAgreementLines({
        institution: institutionRecord,
        adminUser: { username: adminUsername }
      }).join("\n")
    });
  }

  res.status(201).json({
    message: "Institution and administrator account registered successfully.",
    institution_id: institutionId,
    institution_code: institutionCode,
    admin_username: adminUsername,
    admin_password: adminPassword,
    county: countyRecord.name,
    county_code: countyRecord.code,
    category: categoryRecord.label,
    category_code: categoryRecord.code,
    postal_code: postalDetails?.postal_code || postalCodeInput || null,
    town: normalizedTown,
    agreement_pdf_url: `/api/public/institutions/${institutionId}/agreement.pdf`,
    credential_dispatch: credentialDispatch,
    agreement_email_dispatch: agreementEmailDispatch
  });
}));

app.post("/api/public/register-user", asyncHandler(async (req, res) => {
  const institutionCode = cleanValue(req.body?.institution_code);
  const fullName = cleanValue(req.body?.full_name);
  const username = cleanValue(req.body?.username);
  const passwordInput = cleanValue(req.body?.password);
  const autoGeneratePassword = parseTruthy(req.body?.auto_generate_password);
  const password = autoGeneratePassword ? generateStrongPassword(12) : passwordInput;
  const role = cleanValue(req.body?.portal_role);
  const email = cleanOptionalValue(req.body?.email);
  const phone = cleanOptionalValue(req.body?.phone);

  if (!institutionCode || !fullName || !username || !password || !role) {
    return res.status(400).json({
      error: "institution_code, full_name, username, password and portal_role are required."
    });
  }
  if (!PUBLIC_ROLE_OPTIONS.includes(role)) {
    return res.status(400).json({
      error: `portal_role must be one of: ${PUBLIC_ROLE_OPTIONS.join(", ")}`
    });
  }

  const institutions = await query("SELECT id FROM institutions WHERE institution_code = ? LIMIT 1", [institutionCode]);
  if (!institutions.length) {
    return res.status(404).json({ error: "Institution code was not found." });
  }

  const institutionId = institutions[0].id;
  const existingUser = await query(
    "SELECT id FROM users WHERE institution_id = ? AND username = ? LIMIT 1",
    [institutionId, username]
  );
  if (existingUser.length) {
    return res.status(409).json({ error: "Username already exists for this institution." });
  }

  const passwordHash = await hashPassword(password);
  const isRotationExempt = PASSWORD_ROTATION_EXEMPT_ROLES.has(role);
  const insert = await query(
    `INSERT INTO users
      (institution_id, full_name, username, password_hash, password_last_changed_at, password_expires_at, must_change_password, role, email, phone, is_active)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, 1)`,
    [
      institutionId,
      fullName,
      username,
      passwordHash,
      isRotationExempt ? null : dayjs().add(PASSWORD_ROTATION_DAYS, "day").format("YYYY-MM-DD HH:mm:ss"),
      autoGeneratePassword ? 1 : 0,
      role,
      email,
      phone
    ]
  );

  const [institutionRow] = await query(
    "SELECT institution_name FROM institutions WHERE id = ? LIMIT 1",
    [institutionId]
  );

  let credentialDispatch = null;
  if (role !== ROLES.SYSTEM_DEVELOPER) {
    const message = [
      "Welcome to the Integrated Management Information System for Basic Education.",
      `Institution: ${institutionRow?.institution_name || "-"}`,
      `Username: ${username}`,
      `Password: ${password}`,
      "Please change your password immediately after first login."
    ].join("\n");
    credentialDispatch = await dispatchCredentialNotice({
      email,
      phone,
      subject: "IMIS User Credentials",
      message
    });
  }

  res.status(201).json({
    message: "User registered successfully.",
    user_id: insert.insertId,
    username,
    role,
    password,
    credential_dispatch: credentialDispatch
  });
}));

app.get("/api/public/institutions", asyncHandler(async (_, res) => {
  const rows = await query(
    `SELECT id, institution_name, institution_code, email, phone, county, sub_county, location, village, created_at
     FROM institutions
     ORDER BY id DESC`
  );
  res.json(rows);
}));

app.get("/api/public/institutions/:id/agreement.pdf", asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT i.*, u.username AS admin_username
     FROM institutions i
     LEFT JOIN users u ON u.institution_id = i.id AND u.role IN (?, ?)
     WHERE i.id = ?
     ORDER BY u.id ASC
     LIMIT 1`,
    [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, req.params.id]
  );
  if (!rows.length) {
    return res.status(404).json({ error: "Institution not found." });
  }
  const institution = rows[0];
  const lines = buildAgreementLines({
    institution,
    adminUser: { username: institution.admin_username || "-" }
  });
  sendSimplePdf(
    res,
    `institution-agreement-${institution.institution_code || institution.id}`,
    lines
  );
}));

app.post("/api/public/institutions/:id/agreement/send", asyncHandler(async (req, res) => {
  const institutionId = Number(req.params.id);
  if (!institutionId) {
    return res.status(400).json({ error: "Valid institution id is required." });
  }
  const rows = await query(
    `SELECT i.*, u.username AS admin_username
     FROM institutions i
     LEFT JOIN users u ON u.institution_id = i.id AND u.role IN (?, ?)
     WHERE i.id = ?
     ORDER BY u.id ASC
     LIMIT 1`,
    [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, institutionId]
  );
  if (!rows.length) {
    return res.status(404).json({ error: "Institution not found." });
  }
  const institution = rows[0];
  const lines = buildAgreementLines({
    institution,
    adminUser: { username: institution.admin_username || "-" }
  });
  const dispatch = await dispatchCredentialNotice({
    email: institution.email,
    phone: null,
    subject: "IMIS Service Agreement Letter",
    message: lines.join("\n")
  });
  res.json({
    message: "Agreement dispatch completed.",
    institution_id: institution.id,
    credential_dispatch: dispatch
  });
}));

app.post("/api/public/forgot-username", asyncHandler(async (req, res) => {
  const institutionCode = cleanValue(req.body?.institution_code);
  const email = cleanOptionalValue(req.body?.email);
  const phone = cleanOptionalValue(req.body?.phone);

  if (!email && !phone) {
    return res.status(400).json({ error: "Provide email or phone." });
  }

  let where = "WHERE u.is_active = 1";
  const params = [];
  if (institutionCode) {
    where += " AND i.institution_code = ?";
    params.push(institutionCode);
  }
  if (email && phone) {
    where += " AND (u.email = ? OR u.phone = ?)";
    params.push(email, phone);
  } else if (email) {
    where += " AND u.email = ?";
    params.push(email);
  } else {
    where += " AND u.phone = ?";
    params.push(phone);
  }

  const rows = await query(
    `SELECT u.username, i.institution_code, i.institution_name
     FROM users u
     INNER JOIN institutions i ON i.id = u.institution_id
     ${where}
     ORDER BY u.id DESC
     LIMIT 10`,
    params
  );
  if (!rows.length) {
    return res.status(404).json({ error: "No usernames matched the details provided." });
  }

  res.json({
    message: "Matching usernames found.",
    usernames: rows.map((row) => ({
      username: row.username,
      institution_code: row.institution_code,
      institution_name: row.institution_name
    }))
  });
}));

app.post("/api/public/forgot-password", asyncHandler(async (req, res) => {
  const institutionCode = cleanValue(req.body?.institution_code);
  const username = cleanValue(req.body?.username);
  const newPassword = cleanValue(req.body?.new_password);
  const email = cleanOptionalValue(req.body?.email);
  const phone = cleanOptionalValue(req.body?.phone);

  if (!username || !newPassword) {
    return res.status(400).json({ error: "username and new_password are required." });
  }
  if (!email && !phone) {
    return res.status(400).json({ error: "Provide email or phone to verify identity." });
  }

  let where = "WHERE u.username = ?";
  const params = [username];
  if (institutionCode) {
    where += " AND i.institution_code = ?";
    params.push(institutionCode);
  }
  const rows = await query(
    `SELECT u.id, u.email, u.phone, i.id AS institution_id
     FROM users u
     INNER JOIN institutions i ON i.id = u.institution_id
     ${where}
     LIMIT 1`,
    params
  );
  if (!rows.length) {
    return res.status(404).json({ error: "User was not found for the provided details." });
  }

  const user = rows[0];
  if (email && cleanValue(user.email) !== cleanValue(email)) {
    return res.status(401).json({ error: "Email does not match our records." });
  }
  if (phone && cleanValue(user.phone) !== cleanValue(phone)) {
    return res.status(401).json({ error: "Phone does not match our records." });
  }

  const passwordHash = await hashPassword(newPassword);
  await query(
    `UPDATE users
     SET password_hash = ?, password_last_changed_at = NOW(), password_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY), must_change_password = 1
     WHERE id = ?`,
    [passwordHash, PASSWORD_ROTATION_DAYS, user.id]
  );
  const credentialDispatch = await dispatchCredentialNotice({
    email: user.email,
    phone: user.phone,
    subject: "IMIS Password Reset Confirmation",
    message: [
      "Your IMIS password has been reset.",
      `Username: ${username}`,
      `New Password: ${newPassword}`,
      "Please log in and change your password immediately."
    ].join("\n")
  });
  await auditLog(
    { institution_id: user.institution_id || null, id: null, role: "PUBLIC" },
    "PUBLIC_PASSWORD_RESET",
    "users",
    user.id,
    { username, credential_dispatch: credentialDispatch }
  );
  res.json({
    message: "Password reset successful. You can now log in.",
    credential_dispatch: credentialDispatch
  });
}));

app.post("/api/public/institutions/register", asyncHandler(async (req, res) => {
  const institution_name = cleanValue(req.body?.institution_name);
  const institution_code = cleanValue(req.body?.institution_code).toUpperCase();
  const email = cleanOptionalValue(req.body?.email);
  const phone = cleanOptionalValue(req.body?.phone);
  const county = cleanOptionalValue(req.body?.county);
  const sub_county = cleanOptionalValue(req.body?.sub_county);
  const location = cleanOptionalValue(req.body?.location);
  const village = cleanOptionalValue(req.body?.village);

  if (!institution_name || !institution_code) {
    return res.status(400).json({ error: "institution_name and institution_code are required." });
  }

  const existing = await query("SELECT id FROM institutions WHERE institution_code = ? LIMIT 1", [institution_code]);
  if (existing.length) {
    return res.status(409).json({ error: "Institution code already exists." });
  }

  const result = await query(
    `INSERT INTO institutions
      (institution_name, institution_code, email, phone, county, sub_county, location, village)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [institution_name, institution_code, email, phone, county, sub_county, location, village]
  );

  await auditLog(
    { institution_id: result.insertId, id: null, role: "PUBLIC" },
    "REGISTER_INSTITUTION_LEGACY",
    "institutions",
    result.insertId,
    { institution_name, institution_code, email, phone }
  );

  res.status(201).json({
    id: result.insertId,
    message: "Institution registered successfully."
  });
}));

app.post("/api/public/users/register", asyncHandler(async (req, res) => {
  const institution_code = cleanValue(req.body?.institution_code).toUpperCase();
  const full_name = cleanValue(req.body?.full_name);
  const username = cleanValue(req.body?.username);
  const role = cleanValue(req.body?.portal_role || req.body?.role);
  const autoGeneratePassword = parseTruthy(req.body?.auto_generate_password);
  const requestedPassword = cleanValue(req.body?.password);
  const password = autoGeneratePassword ? generateStrongPassword(12) : requestedPassword;
  const email = cleanOptionalValue(req.body?.email);
  const phone = cleanOptionalValue(req.body?.phone);

  if (!institution_code || !full_name || !username || !password || !role) {
    return res.status(400).json({
      error: "institution_code, full_name, username, password and role are required."
    });
  }
  if (!Object.values(ROLES).includes(role)) {
    return res.status(400).json({ error: "Invalid role selected." });
  }

  const institutions = await query("SELECT id, institution_name FROM institutions WHERE institution_code = ? LIMIT 1", [institution_code]);
  if (!institutions.length) {
    return res.status(404).json({ error: "Institution code was not found." });
  }
  const institutionId = institutions[0].id;

  const existingUser = await query(
    "SELECT id FROM users WHERE institution_id = ? AND username = ? LIMIT 1",
    [institutionId, username]
  );
  if (existingUser.length) {
    return res.status(409).json({ error: "Username already exists in this institution." });
  }

  const passwordHash = await hashPassword(password);
  const isRotationExempt = PASSWORD_ROTATION_EXEMPT_ROLES.has(role);
  const result = await query(
    `INSERT INTO users
      (institution_id, full_name, username, password_hash, password_last_changed_at, password_expires_at, must_change_password, role, email, phone, is_active)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, 1)`,
    [
      institutionId,
      full_name,
      username,
      passwordHash,
      isRotationExempt ? null : dayjs().add(PASSWORD_ROTATION_DAYS, "day").format("YYYY-MM-DD HH:mm:ss"),
      autoGeneratePassword ? 1 : 0,
      role,
      email,
      phone
    ]
  );

  let credentialDispatch = null;
  if (role !== ROLES.SYSTEM_DEVELOPER) {
    credentialDispatch = await dispatchCredentialNotice({
      email,
      phone,
      subject: "IMIS User Credentials",
      message: [
        "Welcome to the Integrated Management Information System for Basic Education.",
        `Institution: ${institutions[0].institution_name || "-"}`,
        `Username: ${username}`,
        `Password: ${password}`,
        "Please change your password immediately after first login."
      ].join("\n")
    });
  }

  await auditLog(
    { institution_id: institutionId, id: null, role: "PUBLIC" },
    "REGISTER_USER_LEGACY",
    "users",
    result.insertId,
    { username, role, credential_dispatch: credentialDispatch }
  );

  res.status(201).json({
    id: result.insertId,
    message: "User registered successfully.",
    password,
    credential_dispatch: credentialDispatch
  });
}));

app.post("/api/public/recovery/username", asyncHandler(async (req, res) => {
  const institution_code = cleanValue(req.body?.institution_code).toUpperCase();
  const email = cleanOptionalValue(req.body?.email);
  const phone = cleanOptionalValue(req.body?.phone);

  if (!institution_code || (!email && !phone)) {
    return res.status(400).json({ error: "institution_code plus email or phone is required." });
  }

  const institutions = await query("SELECT id FROM institutions WHERE institution_code = ? LIMIT 1", [institution_code]);
  if (!institutions.length) {
    return res.status(404).json({ error: "Institution code was not found." });
  }

  let rows = [];
  if (email) {
    rows = await query(
      `SELECT username FROM users
       WHERE institution_id = ? AND email = ?
       ORDER BY id DESC LIMIT 1`,
      [institutions[0].id, email]
    );
  } else {
    rows = await query(
      `SELECT username FROM users
       WHERE institution_id = ? AND phone = ?
       ORDER BY id DESC LIMIT 1`,
      [institutions[0].id, phone]
    );
  }

  if (!rows.length) {
    return res.status(404).json({ error: "No user matched the supplied recovery details." });
  }

  return res.json({
    message: "Username recovered successfully.",
    username: rows[0].username
  });
}));

app.post("/api/public/recovery/password", asyncHandler(async (req, res) => {
  const institution_code = cleanValue(req.body?.institution_code).toUpperCase();
  const username = cleanValue(req.body?.username);
  const email = cleanOptionalValue(req.body?.email);
  const phone = cleanOptionalValue(req.body?.phone);
  const new_password = cleanValue(req.body?.new_password);

  if (!institution_code || !username || !new_password || (!email && !phone)) {
    return res.status(400).json({
      error: "institution_code, username, new_password and email or phone are required."
    });
  }

  const institutions = await query("SELECT id FROM institutions WHERE institution_code = ? LIMIT 1", [institution_code]);
  if (!institutions.length) {
    return res.status(404).json({ error: "Institution code was not found." });
  }
  const institutionId = institutions[0].id;

  const users = await query(
    `SELECT id, email, phone FROM users
     WHERE institution_id = ? AND username = ? LIMIT 1`,
    [institutionId, username]
  );
  if (!users.length) {
    return res.status(404).json({ error: "User account not found." });
  }

  const account = users[0];
  const emailMatches = email && account.email && account.email.toLowerCase() === email.toLowerCase();
  const phoneMatches = phone && account.phone && account.phone === phone;
  if (!emailMatches && !phoneMatches) {
    return res.status(401).json({ error: "Recovery details do not match account records." });
  }

  const passwordHash = await hashPassword(new_password);
  await query(
    `UPDATE users
     SET password_hash = ?, password_last_changed_at = NOW(), password_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY), must_change_password = 1
     WHERE id = ?`,
    [passwordHash, PASSWORD_ROTATION_DAYS, account.id]
  );
  const credentialDispatch = await dispatchCredentialNotice({
    email: account.email,
    phone: account.phone,
    subject: "IMIS Password Reset Confirmation",
    message: [
      "Your IMIS password has been reset.",
      `Username: ${username}`,
      `New Password: ${new_password}`,
      "Please log in and change your password immediately."
    ].join("\n")
  });
  await auditLog(
    { institution_id: institutionId, id: null, role: "PUBLIC" },
    "RECOVER_PASSWORD_LEGACY",
    "users",
    account.id,
    { username, credential_dispatch: credentialDispatch }
  );

  return res.json({
    message: "Password reset completed successfully.",
    credential_dispatch: credentialDispatch
  });
}));

app.get("/api/portal/current", auth, asyncHandler(async (req, res) => {
  const defaultModules = DEFAULT_MODULE_ACCESS_BY_ROLE[req.user.role] || [];
  const allowedModules = [];
  for (const moduleKey of defaultModules) {
    // Apply optional per-user overrides while keeping role defaults.
    // eslint-disable-next-line no-await-in-loop
    if (await hasModuleAccess(req.user, moduleKey)) {
      allowedModules.push(moduleKey);
    }
  }
  const passwordPolicy = evaluatePasswordRotation(req.user);
  res.json({
    role: req.user.role,
    portal: toPortal(req.user.role),
    institution_id: req.user.institution_id,
    permissions: ROLE_PERMISSIONS[req.user.role] || [],
    allowed_modules: allowedModules,
    must_change_password: Boolean(req.user.must_change_password),
    password_last_changed_at: req.user.password_last_changed_at || null,
    password_expires_at: req.user.password_expires_at || null,
    password_days_remaining: passwordPolicy.remainingDays
  });
}));

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
  "/api/dashboard/summary",
  auth,
  enforceModuleAccess(MODULE_KEYS.DASHBOARD),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = req.user.institution_id;
    const toNumber = (value) => Number(value || 0);
    const toMoney = (value) => Number(toNumber(value).toFixed(2));

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
    const [feesToday] = await query(
      `SELECT COALESCE(SUM(amount_paid), 0) totalFees, COUNT(*) totalPayments
       FROM finance_fee_payments
       WHERE institution_id = ? AND DATE(payment_date) = CURDATE()`,
      [institutionId]
    );
    const [feesMonth] = await query(
      `SELECT COALESCE(SUM(amount_paid), 0) totalFees, COUNT(*) totalPayments
       FROM finance_fee_payments
       WHERE institution_id = ?
         AND YEAR(payment_date) = YEAR(CURDATE())
         AND MONTH(payment_date) = MONTH(CURDATE())`,
      [institutionId]
    );
    const [feesYear] = await query(
      `SELECT COALESCE(SUM(amount_paid), 0) totalFees
       FROM finance_fee_payments
       WHERE institution_id = ? AND YEAR(payment_date) = YEAR(CURDATE())`,
      [institutionId]
    );
    const [feeStructureYear] = await query(
      `SELECT COALESCE(SUM(amount_required), 0) totalRequired
       FROM finance_fee_structures
       WHERE institution_id = ? AND year = YEAR(CURDATE())`,
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
    const dailyAttendanceList = await query(
      `SELECT id, attendance_type, person_id, person_name, grade, stream,
              DATE_FORMAT(attendance_date, '%Y-%m-%d %H:%i:%s') attendance_date,
              DATE_FORMAT(time_in, '%Y-%m-%d %H:%i:%s') time_in,
              DATE_FORMAT(time_out, '%Y-%m-%d %H:%i:%s') time_out,
              status, reason
       FROM attendance_records
       WHERE institution_id = ? AND DATE(attendance_date) = CURDATE()
       ORDER BY attendance_type ASC, person_name ASC, attendance_date DESC
       LIMIT 300`,
      [institutionId]
    );

    const performanceByClass = await query(
      `SELECT grade, stream,
              COUNT(*) totalEntries,
              COUNT(DISTINCT learner_id) totalLearners,
              ROUND(AVG(marks), 2) meanScore,
              ROUND(MIN(marks), 2) lowestScore,
              ROUND(MAX(marks), 2) highestScore
       FROM academic_marks
       WHERE institution_id = ? AND (year = YEAR(CURDATE()) OR year IS NULL)
       GROUP BY grade, stream
       ORDER BY grade, stream`,
      [institutionId]
    );

    const announcements = await query(
      `SELECT id, title, message, audience, start_date, end_date, created_at
       FROM communication_announcements
       WHERE institution_id = ?
         AND (start_date IS NULL OR start_date <= CURDATE())
         AND (end_date IS NULL OR end_date >= CURDATE())
       ORDER BY created_at DESC
       LIMIT 10`,
      [institutionId]
    );
    const recentFeePayments = await query(
      `SELECT id, learner_id, learner_name, admission_number, grade, stream, amount_paid,
              payment_method, receipt_number, balance_after_payment,
              DATE_FORMAT(payment_date, '%Y-%m-%d %H:%i:%s') payment_date
       FROM finance_fee_payments
       WHERE institution_id = ?
       ORDER BY payment_date DESC, id DESC
       LIMIT 10`,
      [institutionId]
    );
    const outstandingBalances = await query(
      `SELECT latest.learner_id, latest.learner_name, latest.admission_number, latest.grade, latest.stream,
              latest.balance_after_payment AS balance
       FROM finance_fee_payments latest
       INNER JOIN (
         SELECT learner_id, MAX(id) latest_id
         FROM finance_fee_payments
         WHERE institution_id = ?
         GROUP BY learner_id
       ) grouped ON grouped.latest_id = latest.id
       WHERE latest.balance_after_payment IS NOT NULL
         AND latest.balance_after_payment > 0
       ORDER BY latest.balance_after_payment DESC, latest.learner_name ASC
       LIMIT 20`,
      [institutionId]
    );
    const outstandingBalanceTotal = outstandingBalances.reduce(
      (sum, row) => sum + toNumber(row.balance),
      0
    );

    const logs = await query(
      `SELECT id, actor_user_id, actor_role, action, entity_name, entity_id, details_json, created_at
       FROM activity_logs
       WHERE institution_id = ?
       ORDER BY id DESC LIMIT 20`,
      [institutionId]
    );
    const alerts = [];
    if (toNumber(absent.totalAbsent) > 0) {
      alerts.push({
        severity: "warning",
        title: "Learner Absenteeism",
        message: `${toNumber(absent.totalAbsent)} learner(s) are marked absent today.`
      });
    }
    if (toNumber(late.totalLate) > 0) {
      alerts.push({
        severity: "info",
        title: "Late Arrivals",
        message: `${toNumber(late.totalLate)} attendance record(s) are marked late today.`
      });
    }
    if (toNumber(suspension.totalSuspended) > 0 || toNumber(expelled.totalExpelled) > 0) {
      alerts.push({
        severity: "error",
        title: "Conduct Status Watch",
        message: `${toNumber(suspension.totalSuspended)} suspended and ${toNumber(expelled.totalExpelled)} expelled learner(s) recorded.`
      });
    }
    if (outstandingBalanceTotal > 0) {
      alerts.push({
        severity: "warning",
        title: "Outstanding Fee Balances",
        message: `KES ${toMoney(outstandingBalanceTotal).toLocaleString()} remains outstanding across latest learner balances.`
      });
    }
    if (!announcements.length) {
      alerts.push({
        severity: "info",
        title: "No Active Announcements",
        message: "There are no active announcements scheduled for today."
      });
    }
    if (!alerts.length) {
      alerts.push({
        severity: "success",
        title: "All Indicators Normal",
        message: "No dashboard alerts have been triggered for today."
      });
    }
    const feeCollectionSummary = {
      todayTotal: toMoney(feesToday.totalFees),
      todayPaymentsCount: toNumber(feesToday.totalPayments),
      monthTotal: toMoney(feesMonth.totalFees),
      monthPaymentsCount: toNumber(feesMonth.totalPayments),
      yearTotal: toMoney(feesYear.totalFees),
      yearExpected: toMoney(feeStructureYear.totalRequired),
      yearVariance: toMoney(toNumber(feesYear.totalFees) - toNumber(feeStructureYear.totalRequired)),
      outstandingBalanceTotal: toMoney(outstandingBalanceTotal),
      learnersWithOutstandingBalance: outstandingBalances.length,
      recentPayments: recentFeePayments,
      outstandingBalances
    };

    res.json({
      generated_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      stats: {
        totalLearners: toNumber(population.totalLearners),
        totalPresent: toNumber(present.totalPresent),
        totalAbsent: toNumber(absent.totalAbsent),
        totalBoys: toNumber(boys.totalBoys),
        totalGirls: toNumber(girls.totalGirls),
        totalLate: toNumber(late.totalLate),
        totalSuspended: toNumber(suspension.totalSuspended),
        totalExpelled: toNumber(expelled.totalExpelled),
        totalFeesCollectedToday: toMoney(feesToday.totalFees)
      },
      attendanceBreakdown,
      dailyAttendanceList,
      performanceByClass,
      feeCollectionSummary,
      alerts,
      announcements,
      systemActivityLogs: logs
    });
  })
);

app.get(
  "/api/search/global",
  auth,
  enforceModuleAccess(MODULE_KEYS.SEARCH),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const {
      q = "",
      target = "all",
      grade = "",
      stream = "",
      learner_status = "",
      teacher_category = "",
      limit = 20
    } = req.query;
    const institutionId = req.user.institution_id;
    const normalizedTarget = cleanValue(target).toLowerCase();
    const rowLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

    const includeLearners = ["all", "learners", "learner"].includes(normalizedTarget);
    const includeTeachers = ["all", "teachers", "teacher"].includes(normalizedTarget);
    const includeParents = ["all", "parents", "parent"].includes(normalizedTarget);
    const includeBom = ["all", "bom"].includes(normalizedTarget);

    const learnerExtraWhereParts = [];
    const learnerExtraParams = [];
    if (cleanValue(grade)) {
      learnerExtraWhereParts.push(" AND grade = ?");
      learnerExtraParams.push(cleanValue(grade));
    }
    if (cleanValue(stream)) {
      learnerExtraWhereParts.push(" AND stream = ?");
      learnerExtraParams.push(cleanValue(stream));
    }
    if (cleanValue(learner_status)) {
      learnerExtraWhereParts.push(" AND status = ?");
      learnerExtraParams.push(cleanValue(learner_status));
    }
    const learnerExtraWhere = learnerExtraWhereParts.join("");

    const teacherExtraWhereParts = [];
    const teacherExtraParams = [];
    if (cleanValue(teacher_category)) {
      teacherExtraWhereParts.push(" AND category = ?");
      teacherExtraParams.push(cleanValue(teacher_category));
    }
    const teacherExtraWhere = teacherExtraWhereParts.join("");

    const learnerRows = includeLearners
      ? await getPaginatedRows({
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
        extraWhere: learnerExtraWhere,
        extraParams: learnerExtraParams,
        limit: rowLimit
      })
      : [];
    const teacherRows = includeTeachers
      ? await getPaginatedRows({
        table: "teacher_profiles",
        institutionId,
        searchFields: ["full_name", "id_number", "tsc_number", "major_subject", "other_subject"],
        q,
        extraWhere: teacherExtraWhere,
        extraParams: teacherExtraParams,
        limit: rowLimit
      })
      : [];
    const parentRows = includeParents
      ? await getPaginatedRows({
        table: "learners",
        institutionId,
        searchFields: [
          "parent_full_name",
          "parent_phone",
          "parent_email",
          "upi_number",
          "assessment_number",
          "birth_certificate_number"
        ],
        q,
        extraWhere: learnerExtraWhere,
        extraParams: learnerExtraParams,
        limit: rowLimit
      })
      : [];
    const bomRows = includeBom
      ? await query(
        `SELECT id, full_name, username, role, email, phone, is_active, created_at
         FROM users
         WHERE institution_id = ?
           AND UPPER(REPLACE(role, ' ', '_')) IN (?, ?)
           AND (
             ? = ''
             OR full_name LIKE CONCAT('%', ?, '%')
             OR username LIKE CONCAT('%', ?, '%')
             OR email LIKE CONCAT('%', ?, '%')
             OR phone LIKE CONCAT('%', ?, '%')
           )
         ORDER BY id DESC
         LIMIT ?`,
        [institutionId, ROLES.BOM, "BOARD_OF_MANAGEMENT", cleanValue(q), cleanValue(q), cleanValue(q), cleanValue(q), cleanValue(q), rowLimit]
      )
      : [];

    res.json({
      filters_applied: {
        target: normalizedTarget || "all",
        grade: cleanValue(grade) || null,
        stream: cleanValue(stream) || null,
        learner_status: cleanValue(learner_status) || null,
        teacher_category: cleanValue(teacher_category) || null,
        limit: rowLimit
      },
      totals: {
        learners: learnerRows.length,
        teachers: teacherRows.length,
        parents: parentRows.length,
        bom: bomRows.length
      },
      learners: learnerRows,
      teachers: teacherRows,
      parents: parentRows,
      bom: bomRows,
      parentsAndBom: [...parentRows, ...bomRows]
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
    const isRotationExempt = PASSWORD_ROTATION_EXEMPT_ROLES.has(role);
    const result = await query(
      `INSERT INTO users
        (institution_id, full_name, username, password_hash, password_last_changed_at, password_expires_at, role, email, phone, is_active, created_by)
       VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, 1, ?)`,
      [
        req.user.institution_id,
        full_name,
        username,
        passwordHash,
        isRotationExempt ? null : dayjs().add(PASSWORD_ROTATION_DAYS, "day").format("YYYY-MM-DD HH:mm:ss"),
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
    const userId = Number(req.params.id);
    const autoGeneratePassword = parseTruthy(req.body?.auto_generate_password);
    const requestedPassword = cleanValue(req.body?.new_password);
    const newPassword = autoGeneratePassword ? generateStrongPassword(12) : requestedPassword;
    if (!newPassword) {
      return res.status(400).json({ error: "new_password is required unless auto_generate_password is true." });
    }

    const users = await query(
      `SELECT id, username, email, phone
       FROM users
       WHERE id = ? AND institution_id = ?
       LIMIT 1`,
      [userId, req.user.institution_id]
    );
    if (!users.length) {
      return res.status(404).json({ error: "User account not found in your institution." });
    }

    const passwordHash = await hashPassword(newPassword);
    await query(
      `UPDATE users
       SET password_hash = ?, password_last_changed_at = NOW(), password_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY), must_change_password = 1
       WHERE id = ? AND institution_id = ?`,
      [passwordHash, PASSWORD_ROTATION_DAYS, userId, req.user.institution_id]
    );

    let credentialDispatch = null;
    if (autoGeneratePassword) {
      const account = users[0];
      credentialDispatch = await dispatchCredentialNotice({
        email: account.email,
        phone: account.phone,
        subject: "IMIS Administrator Password Reset",
        message: [
          "Your institution administrator has reset your password.",
          `Username: ${account.username}`,
          `New Password: ${newPassword}`,
          "Please log in and change this password immediately."
        ].join("\n")
      });
    }

    await auditLog(req.user, autoGeneratePassword ? "AUTO_GENERATED_PASSWORD_RESET" : "RESET_USER_PASSWORD", "users", userId, {
      auto_generate_password: autoGeneratePassword,
      credential_dispatch: credentialDispatch
    });

    res.json({
      message: "Password reset successfully.",
      generated_password: autoGeneratePassword ? newPassword : null,
      credential_dispatch: credentialDispatch
    });
  })
);

app.post(
  "/api/users/module-access",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const userId = Number(req.body?.user_id);
    const moduleKey = cleanValue(req.body?.module_key);
    const canAccess = parseTruthy(req.body?.can_access);
    if (!userId || !moduleKey) {
      return res.status(400).json({ error: "user_id and module_key are required." });
    }

    const users = await query(
      `SELECT id, institution_id, role
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (!users.length) {
      return res.status(404).json({ error: "Target user not found." });
    }

    const targetUser = users[0];
    if (req.user.role !== ROLES.SYSTEM_DEVELOPER && targetUser.institution_id !== req.user.institution_id) {
      return res.status(403).json({ error: "Cannot change module access for users outside your institution." });
    }

    await query(
      `INSERT INTO user_module_access_overrides (institution_id, user_id, module_key, can_access, created_by_user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [targetUser.institution_id, userId, moduleKey, Number(canAccess), req.user.id]
    );

    await auditLog(req.user, "MODULE_ACCESS_OVERRIDE", "user_module_access_overrides", userId, {
      module_key: moduleKey,
      can_access: canAccess
    });

    res.json({ message: "Module access override saved.", user_id: userId, module_key: moduleKey, can_access: canAccess });
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
      updates.push("password_last_changed_at = NOW()");
      updates.push("password_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)");
      params.push(PASSWORD_ROTATION_DAYS);
      updates.push("must_change_password = 0");
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
    moduleKey: MODULE_KEYS.ADMISSION,
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
    moduleKey: MODULE_KEYS.MANAGEMENT_TEACHERS,
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
    moduleKey: MODULE_KEYS.MANAGEMENT_NON_TEACHING,
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
    moduleKey: MODULE_KEYS.MANAGEMENT_TEACHER_RESOURCES,
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
    moduleKey: MODULE_KEYS.ATTENDANCE,
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
    moduleKey: MODULE_KEYS.ACADEMIC_EXAMS,
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
    moduleKey: MODULE_KEYS.ACADEMIC_MARKS,
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
    moduleKey: MODULE_KEYS.HR_LEAVE,
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
    moduleKey: MODULE_KEYS.HR_RECRUITMENT,
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
    moduleKey: MODULE_KEYS.FINANCE_FEE_STRUCTURE,
    searchFields: ["grade", "stream", "term", "year"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: ["grade", "stream", "term", "year", "amount_required", "description"]
  },
  {
    route: "/api/finance/fee-payments",
    table: "finance_fee_payments",
    moduleKey: MODULE_KEYS.FINANCE_FEE_PAYMENTS,
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
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.NON_TEACHING_STAFF, ROLES.SUPPLIER, ROLES.CONTRACTOR],
    moduleKey: MODULE_KEYS.FINANCE_PROCUREMENT,
    scopedByRole: {
      roles: [ROLES.SUPPLIER, ROLES.CONTRACTOR],
      column: "supplier_name"
    },
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
    moduleKey: MODULE_KEYS.COMMUNICATION_MESSAGES,
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
    moduleKey: MODULE_KEYS.COMMUNICATION_ANNOUNCEMENTS,
    searchFields: ["title", "message", "audience"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: ["title", "message", "audience", "start_date", "end_date"]
  },
  {
    route: "/api/learners/resources",
    table: "learner_resources",
    moduleKey: MODULE_KEYS.LEARNER_RESOURCES,
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
    moduleKey: MODULE_KEYS.WELFARE_MEMBERS,
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
    moduleKey: MODULE_KEYS.WELFARE_CONTRIBUTIONS,
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
    moduleKey: MODULE_KEYS.WELFARE_LOANS,
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
    moduleKey: MODULE_KEYS.LAWS,
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

moduleConfigs.forEach((config) => {
  app.get(
    config.route,
    auth,
    enforceModuleAccess(config.moduleKey),
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const scopedFilter = getScopedFilter(config, req.user);
      const rows = await getPaginatedRows({
        table: config.table,
        institutionId: req.user.institution_id,
        searchFields: config.searchFields,
        q: req.query.q || "",
        extraWhere: scopedFilter.where,
        extraParams: scopedFilter.params,
        limit: req.query.limit || 100,
        offset: req.query.offset || 0
      });

      res.json(rows);
    })
  );

  app.get(
    `${config.route}/:id`,
    auth,
    enforceModuleAccess(config.moduleKey),
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const scopedFilter = getScopedFilter(config, req.user);
      const rows = await query(
        `SELECT * FROM ${config.table}
         WHERE id = ? AND institution_id = ?${scopedFilter.where}
         LIMIT 1`,
        [req.params.id, req.user.institution_id, ...scopedFilter.params]
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
    enforceModuleAccess(config.moduleKey),
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.CREATE),
    asyncHandler(async (req, res) => {
      const scopedFilter = getScopedFilter(config, req.user);
      const data = pickFields(req.body, config.fields);
      data.institution_id = req.user.institution_id;
      data.created_by_user_id = req.user.id;
      if (scopedFilter.where && config.scopedByRole?.column) {
        data[config.scopedByRole.column] = cleanValue(req.user.full_name) || cleanValue(req.user.username);
      }

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
    enforceModuleAccess(config.moduleKey),
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.UPDATE),
    asyncHandler(async (req, res) => {
      const scopedFilter = getScopedFilter(config, req.user);
      const data = pickFields(req.body, config.fields);
      const columns = Object.keys(data);
      if (!columns.length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }

      const setClause = columns.map((column) => `${column} = ?`).join(", ");
      const sql = `UPDATE ${config.table}
                   SET ${setClause}, updated_at = NOW()
                   WHERE id = ? AND institution_id = ?${scopedFilter.where}`;
      await query(sql, [...Object.values(data), req.params.id, req.user.institution_id, ...scopedFilter.params]);
      await auditLog(req.user, "UPDATE", config.table, req.params.id, data);
      res.json({ message: "Record updated." });
    })
  );

  app.delete(
    `${config.route}/:id`,
    auth,
    enforceModuleAccess(config.moduleKey),
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.DELETE),
    asyncHandler(async (req, res) => {
      const scopedFilter = getScopedFilter(config, req.user);
      await query(
        `DELETE FROM ${config.table}
         WHERE id = ? AND institution_id = ?${scopedFilter.where}`,
        [req.params.id, req.user.institution_id, ...scopedFilter.params]
      );
      await auditLog(req.user, "DELETE", config.table, req.params.id);
      res.json({ message: "Record deleted." });
    })
  );

  app.get(
    `${config.route}/export/pdf`,
    auth,
    enforceModuleAccess(config.moduleKey),
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const scopedFilter = getScopedFilter(config, req.user);
      const rows = await getPaginatedRows({
        table: config.table,
        institutionId: req.user.institution_id,
        searchFields: config.searchFields,
        q: req.query.q || "",
        extraWhere: scopedFilter.where,
        extraParams: scopedFilter.params,
        limit: 5000
      });

      const lines = rows.map((row) => JSON.stringify(row));
      sendSimplePdf(res, `${config.table}-report`, lines);
    })
  );

  app.get(
    `${config.route}/export/excel`,
    auth,
    enforceModuleAccess(config.moduleKey),
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const scopedFilter = getScopedFilter(config, req.user);
      const rows = await getPaginatedRows({
        table: config.table,
        institutionId: req.user.institution_id,
        searchFields: config.searchFields,
        q: req.query.q || "",
        extraWhere: scopedFilter.where,
        extraParams: scopedFilter.params,
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
  enforceModuleAccess(MODULE_KEYS.MANAGEMENT_TEACHER_RESOURCES),
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
  enforceModuleAccess(MODULE_KEYS.ACADEMIC_EXAMS),
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
  enforceModuleAccess(MODULE_KEYS.ATTENDANCE),
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
  enforceModuleAccess(MODULE_KEYS.ACADEMIC_MARKS),
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
  enforceModuleAccess(MODULE_KEYS.ACADEMIC_MARKS),
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
  enforceModuleAccess(MODULE_KEYS.PARENT_RESULTS),
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
  enforceModuleAccess(MODULE_KEYS.PARENT_RESULTS),
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
  enforceModuleAccess(MODULE_KEYS.LEARNER_MATERIALS),
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
  enforceModuleAccess(MODULE_KEYS.LEARNER_MATERIALS),
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
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
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
