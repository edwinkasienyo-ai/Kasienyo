const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const compression = require("compression");
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
  YEAR_JOINED_OPTIONS,
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
const {
  buildCbcSuggestion,
  buildSuggestionFromMappings,
  makeNotes,
  getAllCbcLearningAreas,
  buildBulkCbcEntries
} = require("./config/cbcLibrary");

/** Bump when shipping UI/API changes so schools can confirm they run the right copy. */
const IIMS_BUILD_STAMP = process.env.IIMS_BUILD_STAMP || "20260422-ui9";

const app = express();

const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5000";
const DEV_FALLBACK_JWT_SECRET = "iims-dev-insecure-secret-change-in-production";
const configuredJwtSecret = String(process.env.JWT_SECRET || "").trim();
const JWT_SECRET =
  configuredJwtSecret ||
  (String(process.env.NODE_ENV || "").toLowerCase() !== "production"
    ? DEV_FALLBACK_JWT_SECRET
    : "");
app.use(
  cors({
    origin: frontendOrigin,
    credentials: true
  })
);
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const uploadsPath = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use("/uploads", express.static(uploadsPath));

const publicRoot = path.join(process.cwd(), "public");
const noStoreStaticExtensions = new Set([".html", ".htm", ".css", ".js", ".json"]);
app.use(
  express.static(publicRoot, {
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (noStoreStaticExtensions.has(ext)) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    }
  })
);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsPath),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  })
});

const HERO_IMAGE_MANIFEST_FILE = path.join(uploadsPath, "index-hero-manifest.json");
const HERO_IMAGE_MAX_BYTES = Number(process.env.HERO_IMAGE_MAX_BYTES || 6 * 1024 * 1024);
const HERO_IMAGE_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif"
]);
const HERO_IMAGE_EXTENSION_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif"
};

const heroImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsPath),
    filename: (_, file, cb) => {
      const mappedExtension = HERO_IMAGE_EXTENSION_BY_MIME[file.mimetype];
      const sourceExtension = cleanValue(path.extname(file.originalname)).toLowerCase();
      const extension = mappedExtension || sourceExtension || ".jpg";
      cb(null, `index-hero-${Date.now()}${extension}`);
    }
  }),
  limits: {
    fileSize: HERO_IMAGE_MAX_BYTES
  },
  fileFilter: (_, file, cb) => {
    if (!HERO_IMAGE_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("Unsupported image format. Use JPEG, PNG, WEBP, GIF, or AVIF."));
    }
    return cb(null, true);
  }
});

function heroImageUploadMiddleware(req, res, next) {
  heroImageUpload.single("hero_image")(req, res, (error) => {
    if (!error) {
      return next();
    }
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: `Hero image exceeds size limit of ${Math.round(HERO_IMAGE_MAX_BYTES / (1024 * 1024))}MB.`
      });
    }
    return res.status(400).json({ error: error.message || "Hero image upload failed." });
  });
}

function readHeroImageManifest() {
  if (!fs.existsSync(HERO_IMAGE_MANIFEST_FILE)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(HERO_IMAGE_MANIFEST_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!cleanValue(parsed.file_name)) return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function writeHeroImageManifest(fileName, actorUserId = null) {
  const payload = {
    file_name: fileName,
    updated_at: new Date().toISOString(),
    updated_by_user_id: actorUserId || null
  };
  fs.writeFileSync(HERO_IMAGE_MANIFEST_FILE, JSON.stringify(payload, null, 2), "utf8");
}

function cleanupOldHeroImages(currentFileName) {
  const files = fs.readdirSync(uploadsPath);
  for (const fileName of files) {
    if (!fileName.startsWith("index-hero-")) continue;
    if (fileName === currentFileName) continue;
    const stalePath = path.join(uploadsPath, fileName);
    if (fs.existsSync(stalePath)) {
      fs.unlinkSync(stalePath);
    }
  }
}

function resolveHeroImageAsset() {
  const manifest = readHeroImageManifest();
  const candidates = [];
  if (cleanValue(manifest?.file_name)) {
    candidates.push(manifest.file_name);
  }
  candidates.push("index-hero.jpg", "index-hero.jpeg", "index-hero.png", "index-hero.webp", "index-hero.gif", "index-hero.avif");
  for (const candidate of candidates) {
    const absolutePath = path.join(uploadsPath, candidate);
    if (!fs.existsSync(absolutePath)) continue;
    const stats = fs.statSync(absolutePath);
    return {
      file_name: candidate,
      hero_image_path: `/uploads/${candidate}`,
      hero_image_url: `/uploads/${candidate}?v=${Number(stats.mtimeMs || Date.now())}`,
      updated_at: stats.mtime.toISOString()
    };
  }
  return {
    file_name: null,
    hero_image_path: null,
    hero_image_url: null,
    updated_at: null
  };
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function issueToken(payload) {
  if (!JWT_SECRET) {
    throw new Error(
      "JWT configuration error: JWT_SECRET is missing. Set JWT_SECRET in your environment."
    );
  }
  return jwt.sign(payload, JWT_SECRET, {
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
    SYSTEM_DEVELOPER: ROLES.SYSTEM_DEVELOPER,
    SYTEM_DEVELOPER: ROLES.SYSTEM_DEVELOPER,
    ADMINISTRATOR: ROLES.ADMIN,
    SCHOOL_ADMIN: ROLES.ADMIN,
    HOI_ADMINISTRATOR: ROLES.HEAD_OF_INSTITUTION,
    HOI_ADMIN: ROLES.HEAD_OF_INSTITUTION,
    HOI: ROLES.HEAD_OF_INSTITUTION,
    D_HOI: ROLES.HEAD_OF_INSTITUTION,
    DEPUTY_HOI: ROLES.HEAD_OF_INSTITUTION,
    DEPUTY_HEAD_OF_INSTITUTION: ROLES.HEAD_OF_INSTITUTION,
    HEAD: ROLES.HEAD_OF_INSTITUTION,
    HEAD_TEACHER: ROLES.HEAD_OF_INSTITUTION,
    SENIOR_TEACHER: ROLES.SENIOR_TEACHER,
    SENIORTEACHER: ROLES.SENIOR_TEACHER,
    HOD: ROLES.HEAD_OF_DEPARTMENT,
    HEAD_OF_DEPARTMENT: ROLES.HEAD_OF_DEPARTMENT,
    HEAD_DEPARTMENT: ROLES.HEAD_OF_DEPARTMENT,
    PRINCIPAL: ROLES.HEAD_OF_INSTITUTION,
    HEAD_OF_SCHOOL: ROLES.HEAD_OF_INSTITUTION,
    SENIOR_TEACHER: ROLES.SENIOR_TEACHER,
    SR_TEACHER: ROLES.SENIOR_TEACHER,
    HEAD_OF_DEPARTMENT: ROLES.HEAD_OF_DEPARTMENT,
    HOD: ROLES.HEAD_OF_DEPARTMENT,
    SUPPORT_STAFF: ROLES.NON_TEACHING_STAFF,
    NON_TEACHING: ROLES.NON_TEACHING_STAFF,
    NONTEACHING: ROLES.NON_TEACHING_STAFF,
    BOM_MEMBER: ROLES.BOM,
    BOARD_OF_MANAGEMENT: ROLES.BOM,
    PARENT_GUARDIAN: ROLES.PARENT,
    MOE: ROLES.MOD,
    MINISTRY_OF_EDUCATION_MOE: ROLES.MOD,
    MINISTRY_OF_EDUCATION: ROLES.MOD,
    MINISTRY_OF_BASIC_EDUCATION: ROLES.MOD,
    SUPPLIERS_CONTRACTORS_SERVICE_PROVIDERS: ROLES.SUPPLIER,
    SUPPLIERS_CONTUCTORS_SERVICE_PROVIDERS: ROLES.SUPPLIER,
    SUPPLIER_CONTRACTOR_SERVICE_PROVIDER: ROLES.SUPPLIER,
    SERVICE_PROVIDER: ROLES.SUPPLIER,
    SYSTEMDEVELOPER: ROLES.SYSTEM_DEVELOPER,
    CONTRACTORS: ROLES.CONTRACTOR,
    SENIOR_TEACHER: ROLES.TEACHER,
    HEAD_OF_DEPARTMENT: ROLES.TEACHER
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
  ROLES.MOD,
  ROLES.TSC,
  ROLES.HEAD_OF_INSTITUTION,
  ROLES.ADMIN,
  ROLES.TEACHER,
  ROLES.SENIOR_TEACHER,
  ROLES.HEAD_OF_DEPARTMENT,
  ROLES.BOM,
  ROLES.NON_TEACHING_STAFF,
  ROLES.PARENT,
  ROLES.SUPPLIER,
  ROLES.CONTRACTOR
];
const HIGH_PRIVILEGE_REGISTRATION_ROLES = new Set([ROLES.SYSTEM_DEVELOPER, ROLES.MOD, ROLES.TSC]);

const AGREEMENT_COMPANY = {
  name: "Mwendegu Enterprise Limited",
  email: "mwendeguenterpriseltd@gmail.com",
  phone: "+254 725 757 767"
};
const RECYCLE_BIN_RETENTION_YEARS = Number(process.env.RECYCLE_BIN_RETENTION_YEARS || 12);

const PASSWORD_ROTATION_DAYS = Number(process.env.PASSWORD_ROTATION_DAYS || 30);
const PASSWORD_ROTATION_EXEMPT_ROLES = new Set([ROLES.SYSTEM_DEVELOPER]);
const PASSWORD_MIN_LENGTH = Number(process.env.PASSWORD_MIN_LENGTH || 12);
const USERNAME_MIN_LENGTH = Number(process.env.USERNAME_MIN_LENGTH || 5);
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const LOGIN_LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES || 15);
const OTP_MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS || 5);
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 30);
const ACCOUNT_MUTATION_COOLDOWN_SECONDS = Number(process.env.ACCOUNT_MUTATION_COOLDOWN_SECONDS || 5);
const LOGIN_JITTER_MAX_MS = Number(process.env.LOGIN_JITTER_MAX_MS || 350);
const SYSTEM_DEVELOPER_MAX_ACCOUNTS = Number(process.env.SYSTEM_DEVELOPER_MAX_ACCOUNTS || 50);
const REQUEST_RATE_WINDOW_MS = Number(process.env.REQUEST_RATE_WINDOW_MS || 15 * 60 * 1000);
const MAX_PUBLIC_BODY_KEYS = Number(process.env.MAX_PUBLIC_BODY_KEYS || 120);
const REQUEST_RATE_TRACKER = new Map();
const OTP_REQUEST_TRACKER = new Map();
const ACCOUNT_MUTATION_TRACKER = new Map();

function padThree(value) {
  return String(Number(value) || 0).padStart(3, "0");
}

function parseTruthy(value) {
  if (typeof value === "boolean") return value;
  const normalized = cleanValue(value).toLowerCase();
  if (!normalized) return false;
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

async function delayWithRandomJitter() {
  const maxDelay = Math.max(LOGIN_JITTER_MAX_MS, 0);
  if (!maxDelay) return;
  const delay = Math.floor(Math.random() * (maxDelay + 1));
  await new Promise((resolve) => setTimeout(resolve, delay));
}

function getClientIp(req) {
  const forwarded = cleanValue(req.headers["x-forwarded-for"]);
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return cleanValue(req.ip || req.socket?.remoteAddress || "unknown");
}

function getClientMachineName(req) {
  return (
    cleanValue(req.headers["x-machine-name"]) ||
    cleanValue(req.headers["x-client-machine"]) ||
    cleanValue(req.headers["x-forwarded-host"]) ||
    cleanValue(req.hostname) ||
    cleanValue(req.headers.host) ||
    "unknown-machine"
  );
}

function buildAuthAuditDetails(req, username, extra = {}) {
  return {
    username: cleanValue(username),
    ip_address: getClientIp(req),
    machine_name: getClientMachineName(req),
    user_agent: cleanValue(req.headers["user-agent"]),
    request_time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
    ...extra
  };
}

function enforceRateLimit({ bucket, maxRequests, windowMs }) {
  return (req, res, next) => {
    const key = `${bucket}:${getClientIp(req)}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    const history = REQUEST_RATE_TRACKER.get(key) || [];
    const recent = history.filter((stamp) => stamp > windowStart);
    if (recent.length >= maxRequests) {
      const retryMs = Math.max(windowMs - (now - recent[0]), 1000);
      return res.status(429).json({
        error: "Too many requests. Please wait and try again.",
        retry_after_seconds: Math.ceil(retryMs / 1000)
      });
    }
    recent.push(now);
    REQUEST_RATE_TRACKER.set(key, recent);
    if (REQUEST_RATE_TRACKER.size > 5000) {
      for (const [storedKey, stamps] of REQUEST_RATE_TRACKER.entries()) {
        const kept = stamps.filter((stamp) => stamp > windowStart);
        if (!kept.length) REQUEST_RATE_TRACKER.delete(storedKey);
        else REQUEST_RATE_TRACKER.set(storedKey, kept);
      }
    }
    return next();
  };
}

function enforceAccountMutationCooldown() {
  return (req, res, next) => {
    const actorKey = cleanValue(req.user?.id || req.user?.username || "anonymous");
    const key = `acct-mutation:${actorKey}`;
    const now = Date.now();
    const previous = ACCOUNT_MUTATION_TRACKER.get(key) || 0;
    const minIntervalMs = Math.max(ACCOUNT_MUTATION_COOLDOWN_SECONDS, 0) * 1000;
    if (minIntervalMs > 0 && previous && now - previous < minIntervalMs) {
      const retryAfter = Math.ceil((minIntervalMs - (now - previous)) / 1000);
      return res.status(429).json({
        error: "Account mutation cooldown active. Retry shortly.",
        retry_after_seconds: retryAfter
      });
    }
    ACCOUNT_MUTATION_TRACKER.set(key, now);
    return next();
  };
}

const authLoginRateLimit = enforceRateLimit({
  bucket: "auth-login",
  maxRequests: Number(process.env.RATE_LIMIT_AUTH_LOGIN_MAX || 40),
  windowMs: REQUEST_RATE_WINDOW_MS
});
const otpVerifyRateLimit = enforceRateLimit({
  bucket: "auth-otp-verify",
  maxRequests: Number(process.env.RATE_LIMIT_OTP_VERIFY_MAX || 80),
  windowMs: REQUEST_RATE_WINDOW_MS
});
const publicWriteRateLimit = enforceRateLimit({
  bucket: "public-write",
  maxRequests: Number(process.env.RATE_LIMIT_PUBLIC_WRITE_MAX || 60),
  windowMs: REQUEST_RATE_WINDOW_MS
});
const accountMutationRateLimit = enforceRateLimit({
  bucket: "account-mutation",
  maxRequests: Number(process.env.RATE_LIMIT_ACCOUNT_MUTATION_MAX || 60),
  windowMs: REQUEST_RATE_WINDOW_MS
});
const accountMutationCooldown = enforceAccountMutationCooldown();

function enforcePublicSecurity(req, res, next) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const compactKeys = Object.keys(body);
  if (compactKeys.length > MAX_PUBLIC_BODY_KEYS) {
    return res.status(400).json({ error: "Request payload has too many fields." });
  }
  const contentType = cleanValue(req.headers["content-type"]).toLowerCase();
  if (contentType && !contentType.includes("application/json")) {
    return res.status(415).json({ error: "Only application/json content type is accepted." });
  }
  const bodySize = Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
  const maxBodyBytes = Number(process.env.MAX_PUBLIC_BODY_BYTES || 1024 * 1024);
  if (bodySize > maxBodyBytes) {
    return res.status(413).json({ error: "Request payload is too large." });
  }
  return next();
}

function evaluatePasswordStrength(password) {
  const value = cleanValue(password);
  const errors = [];
  if (value.length < PASSWORD_MIN_LENGTH) {
    errors.push(`must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (!/[A-Z]/.test(value)) {
    errors.push("must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(value)) {
    errors.push("must contain at least one lowercase letter");
  }
  if (!/\d/.test(value)) {
    errors.push("must contain at least one number");
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    errors.push("must contain at least one special character");
  }
  return errors;
}

function requireStrongPassword(password, fieldLabel = "password") {
  const errors = evaluatePasswordStrength(password);
  if (errors.length) {
    const label = cleanValue(fieldLabel) || "password";
    return `${label} ${errors.join(", ")}.`;
  }
  return null;
}

function validateUsername(username, fieldLabel = "username") {
  const value = cleanValue(username);
  if (!value) {
    return `${fieldLabel} is required.`;
  }
  if (value.length < USERNAME_MIN_LENGTH) {
    return `${fieldLabel} must be at least ${USERNAME_MIN_LENGTH} characters.`;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    return `${fieldLabel} can only include letters, numbers, dot, underscore or dash.`;
  }
  return null;
}

async function checkSystemDeveloperAccountCapacity(role) {
  if (normalizeRole(role) !== ROLES.SYSTEM_DEVELOPER) {
    return { allowed: true, max: SYSTEM_DEVELOPER_MAX_ACCOUNTS, total: null };
  }
  const rows = await query(
    `SELECT COUNT(*) AS total
     FROM users
     WHERE role = ?`,
    [ROLES.SYSTEM_DEVELOPER]
  );
  const total = Number(rows[0]?.total || 0);
  if (total >= SYSTEM_DEVELOPER_MAX_ACCOUNTS) {
    return { allowed: false, max: SYSTEM_DEVELOPER_MAX_ACCOUNTS, total };
  }
  return { allowed: true, max: SYSTEM_DEVELOPER_MAX_ACCOUNTS, total };
}

function normalizeDateTime(value) {
  if (!value) return null;
  const parsed = dayjs(value);
  if (!parsed.isValid()) return null;
  return parsed.format("YYYY-MM-DD HH:mm:ss");
}

function isAccountLocked(user = {}) {
  const lockedUntil = normalizeDateTime(user.locked_until);
  if (!lockedUntil) return false;
  return dayjs(lockedUntil).isAfter(dayjs());
}

async function recordFailedLoginAttempt(user = {}) {
  const userId = Number(user.id || 0);
  if (!userId) {
    return { attempts: 0, remainingAttempts: LOGIN_MAX_ATTEMPTS, lockedUntil: null };
  }
  const nextAttempts = Number(user.failed_login_attempts || 0) + 1;
  const shouldLock = nextAttempts >= LOGIN_MAX_ATTEMPTS;
  const lockedUntil = shouldLock
    ? dayjs().add(LOGIN_LOCKOUT_MINUTES, "minute").format("YYYY-MM-DD HH:mm:ss")
    : null;
  await query(
    `UPDATE users
     SET failed_login_attempts = ?, last_failed_login_at = NOW(), locked_until = ?
     WHERE id = ?`,
    [nextAttempts, lockedUntil, userId]
  );
  return {
    attempts: nextAttempts,
    remainingAttempts: Math.max(LOGIN_MAX_ATTEMPTS - nextAttempts, 0),
    lockedUntil
  };
}

async function resetLoginFailureState(userId) {
  if (!Number(userId)) return;
  await query(
    `UPDATE users
     SET failed_login_attempts = 0, locked_until = NULL
     WHERE id = ?`,
    [userId]
  );
}

async function getActiveUserSecurityState(username) {
  const rows = await query(
    `SELECT id, role, institution_id, failed_login_attempts, locked_until, is_suspended, suspended_reason
     FROM users
     WHERE username = ? AND is_active = 1
     ORDER BY id DESC
     LIMIT 1`,
    [cleanValue(username)]
  );
  return rows.length ? rows[0] : null;
}

async function purgeExpiredRecycleBinItems() {
  await query(
    `UPDATE recycle_bin_items
     SET status = 'DELETED',
         permanently_deleted_at = NOW()
     WHERE status = 'TRASHED'
       AND deleted_at <= DATE_SUB(NOW(), INTERVAL 12 YEAR)`
  );
}

async function recordOtpFailure(identity) {
  const activeRows = await query(
    `SELECT id, verify_attempts, max_attempts
     FROM otp_sessions
     WHERE identity_value = ? AND is_used = 0 AND expires_at > NOW()
     ORDER BY id DESC
     LIMIT 1`,
    [cleanValue(identity)]
  );
  if (!activeRows.length) {
    return null;
  }
  const active = activeRows[0];
  const attempts = Number(active.verify_attempts || 0) + 1;
  const maxAttempts = Math.max(Number(active.max_attempts || OTP_MAX_VERIFY_ATTEMPTS), 1);
  const exhausted = attempts >= maxAttempts;
  await query(
    `UPDATE otp_sessions
     SET verify_attempts = ?, last_attempt_at = NOW(), is_used = ?
     WHERE id = ?`,
    [attempts, exhausted ? 1 : 0, active.id]
  );
  return {
    attempts,
    remainingAttempts: Math.max(maxAttempts - attempts, 0),
    exhausted
  };
}

async function recordOtpSuccess(sessionId) {
  const numericId = Number(sessionId || 0);
  if (!numericId) return;
  await query(
    `UPDATE otp_sessions
     SET verify_attempts = 0, last_attempt_at = NOW()
     WHERE id = ?`,
    [numericId]
  );
}

function checkOtpRequestCooldown(identity) {
  const key = cleanValue(identity).toLowerCase();
  if (!key || OTP_RESEND_COOLDOWN_SECONDS <= 0) {
    return { allowed: true, remainingSeconds: 0 };
  }
  const now = Date.now();
  const previous = OTP_REQUEST_TRACKER.get(key) || 0;
  const cooldownMs = OTP_RESEND_COOLDOWN_SECONDS * 1000;
  if (previous && now - previous < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - (now - previous)) / 1000);
    return { allowed: false, remainingSeconds: remaining };
  }
  OTP_REQUEST_TRACKER.set(key, now);
  return { allowed: true, remainingSeconds: 0 };
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
  const rows = await query(
    "SELECT institution_code FROM institutions WHERE institution_code LIKE ?",
    [`${prefix}%`]
  );
  const next = rows.reduce((maxSerial, row) => {
    const rawCode = cleanValue(row?.institution_code);
    const parts = rawCode.split("/");
    const serial = Number(parts[2] || 0);
    return Number.isFinite(serial) && serial > maxSerial ? serial : maxSerial;
  }, 0) + 1;
  return `${countyCode}/${categoryCode}/${padThree(next)}`;
}

function generateStrongPassword(length = 12) {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%&*!";
  const targetLength = Math.max(Number(length) || 12, PASSWORD_MIN_LENGTH);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let output = "";
    for (let index = 0; index < targetLength; index += 1) {
      output += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    if (!requireStrongPassword(output)) {
      return output;
    }
  }
  return `Aa1!${uuidv4().replace(/-/g, "").slice(0, Math.max(targetLength - 4, 8))}`;
}

function canRegisterInstitution(user) {
  const role = normalizeRole(user?.role);
  return role === ROLES.SYSTEM_DEVELOPER;
}

function canRegisterPrivilegedUsers(user) {
  return normalizeRole(user?.role) === ROLES.SYSTEM_DEVELOPER;
}

function canRegisterInstitutionUsers(user) {
  const role = normalizeRole(user?.role);
  return [ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION].includes(role);
}

function getAssignableRolesForActor(user) {
  const role = normalizeRole(user?.role);
  if (role === ROLES.SYSTEM_DEVELOPER) {
    return [...PUBLIC_ROLE_OPTIONS];
  }
  if ([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION].includes(role)) {
    return PUBLIC_ROLE_OPTIONS.filter((item) => !HIGH_PRIVILEGE_REGISTRATION_ROLES.has(item));
  }
  return [];
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
  REGISTRATION: "register-center",
  ACCESS_CONTROL: "access-control",
  SECURITY_AUDIT: "security-audit",
  INSTITUTIONS_USERS_REGISTRY: "institutions-users-registry",
  RECYCLE_BIN: "recycle-bin",
  CBC_CURRICULUM_EDITOR: "cbc-curriculum-editor",
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
  FINANCE_PAYROLL: "finance-payroll",
  FINANCE_SALARY_ADVANCE: "finance-salary-advance",
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
  [ROLES.ADMIN]: [],
  [ROLES.HEAD_OF_INSTITUTION]: [],
  [ROLES.MOD]: [],
  [ROLES.TSC]: [],
  [ROLES.TEACHER]: [],
  [ROLES.NON_TEACHING_STAFF]: [],
  [ROLES.BOM]: [],
  [ROLES.PARENT]: [],
  [ROLES.LEARNER]: [],
  [ROLES.SUPPLIER]: [],
  [ROLES.CONTRACTOR]: []
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
       AND (permission_key = 'ACCESS' OR permission_key IS NULL OR permission_key = '')
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
    if (Number(req.user?.is_suspended) === 1) {
      return res.status(403).json({
        error:
          `You are suspended. Kindly contact the System Developer (${SYSTEM_DEVELOPER_CONTACT_EMAIL}, ${SYSTEM_DEVELOPER_CONTACT_PHONE}).`,
        suspended: true,
        system_developer_contact: {
          email: SYSTEM_DEVELOPER_CONTACT_EMAIL,
          phone: SYSTEM_DEVELOPER_CONTACT_PHONE
        }
      });
    }
    const allowed = await hasModuleAccess(req.user, moduleKey);
    if (!allowed) {
      return res.status(403).json({
        error: "Module access denied for this role. Request access from System Developer."
      });
    }
    return next();
  });
}

function canManageAcrossInstitutions(user) {
  return normalizeRole(user?.role) === ROLES.SYSTEM_DEVELOPER;
}

async function loadInstitutionAgreementContext(institutionId) {
  const rows = await query(
    `SELECT i.*, u.username AS admin_username
     FROM institutions i
     LEFT JOIN users u ON u.institution_id = i.id AND u.role IN (?, ?)
     WHERE i.id = ?
     ORDER BY u.id ASC
     LIMIT 1`,
    [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, institutionId]
  );
  return rows.length ? rows[0] : null;
}

function assertInstitutionAgreementAccess(req, institutionRow) {
  if (!institutionRow) {
    return { error: "Institution not found.", status: 404 };
  }
  if (canManageAcrossInstitutions(req.user)) {
    return null;
  }
  if (Number(institutionRow.id) !== Number(req.user.institution_id)) {
    return { error: "You are not allowed to access this institution's agreement.", status: 403 };
  }
  return null;
}

async function archiveRecycleBinItem({
  institutionId,
  entityName,
  entityId = null,
  payload = {},
  deletedByUserId = null
}) {
  await query(
    `INSERT INTO recycle_bin_items
      (institution_id, entity_name, entity_id, archived_payload_json, deleted_by_user_id, status)
     VALUES (?, ?, ?, ?, ?, 'TRASHED')`,
    [
      institutionId,
      cleanValue(entityName),
      Number(entityId) || null,
      JSON.stringify(payload || {}),
      Number(deletedByUserId) || null
    ]
  );
}

function canManageInstitutionUser(reqUser, targetInstitutionId) {
  return canManageAcrossInstitutions(reqUser) || Number(reqUser?.institution_id) === Number(targetInstitutionId || 0);
}

function isSafeTableIdentifier(name) {
  return /^[a-z_][a-z0-9_]*$/i.test(cleanValue(name));
}

async function getTableColumns(tableName) {
  if (!isSafeTableIdentifier(tableName)) return [];
  const rows = await query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName]
  );
  return rows.map((row) => row.COLUMN_NAME);
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
  const template = cleanOptionalValue(institution?.agreement_template_text);
  if (template) {
    const today = dayjs().format("YYYY-MM-DD");
    const rendered = template
      .replaceAll("{{DATE}}", today)
      .replaceAll("{{INSTITUTION_NAME}}", institution.institution_name || "-")
      .replaceAll("{{INSTITUTION_CODE}}", institution.institution_code || "-")
      .replaceAll("{{COUNTY}}", institution.county || "-")
      .replaceAll("{{POSTAL_ADDRESS}}", institution.postal_address || "-")
      .replaceAll("{{EMAIL}}", institution.email || "-")
      .replaceAll("{{PHONE}}", institution.phone || "-")
      .replaceAll("{{ADMIN_USERNAME}}", adminUser?.username || "-")
      .replaceAll("{{PROVIDER_NAME}}", AGREEMENT_COMPANY.name)
      .replaceAll("{{PROVIDER_PHONE}}", AGREEMENT_COMPANY.phone)
      .replaceAll("{{PROVIDER_EMAIL}}", AGREEMENT_COMPANY.email);
    return rendered.split("\n");
  }
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
  return res.status(403).json({
    error:
      "Registration metadata is not available on the public login page. Sign in and open Register (Institution/User) in the dashboard."
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

function isEmailContact(value) {
  const contact = cleanValue(value);
  return contact.includes("@");
}

async function sendCommunicationPayload({ messageType, destination, messageBody }) {
  const normalizedType = cleanValue(messageType).toUpperCase() || "SMS";
  const contact = cleanValue(destination);
  const body = cleanValue(messageBody);
  if (!contact) {
    throw new Error("Recipient contact is required for dispatch.");
  }
  if (!body) {
    throw new Error("Message body is required for dispatch.");
  }

  if (normalizedType === "PUSH") {
    // eslint-disable-next-line no-console
    console.log(`[IIMS PUSH] ${contact}: ${body}`);
    return;
  }

  const preferEmail =
    normalizedType === "EMAIL" || (normalizedType !== "SMS" && isEmailContact(contact));
  if (preferEmail) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      throw new Error("SMTP is not configured.");
    }
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
      to: contact,
      subject: `IIMS ${normalizedType || "Notification"}`,
      text: body
    });
    return;
  }

  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    !process.env.TWILIO_FROM
  ) {
    throw new Error("Twilio is not configured.");
  }
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_FROM,
    to: contact,
    body
  });
}

async function resolveCommunicationRecipients({ institutionId, recipientRole, recipientContact }) {
  const contacts = new Set();
  const normalizedRole = normalizeRole(recipientRole);
  const directContact = cleanValue(recipientContact);
  if (directContact) {
    contacts.add(directContact);
  }

  if (normalizedRole) {
    if (normalizedRole === ROLES.PARENT) {
      const learnerRows = await query(
        `SELECT parent_phone, parent_email
         FROM learners
         WHERE institution_id = ?`,
        [institutionId]
      );
      learnerRows.forEach((row) => {
        if (cleanValue(row.parent_phone)) contacts.add(cleanValue(row.parent_phone));
        if (cleanValue(row.parent_email)) contacts.add(cleanValue(row.parent_email));
      });
    } else {
      const userRows = await query(
        `SELECT phone, email
         FROM users
         WHERE institution_id = ? AND UPPER(REPLACE(role, ' ', '_')) = ?`,
        [institutionId, normalizedRole]
      );
      userRows.forEach((row) => {
        if (cleanValue(row.phone)) contacts.add(cleanValue(row.phone));
        if (cleanValue(row.email)) contacts.add(cleanValue(row.email));
      });
    }
  }

  return [...contacts].filter(Boolean);
}

async function dispatchCommunicationMessage({
  institutionId,
  messageType,
  recipientRole,
  recipientContact,
  messageBody,
  createdByUserId
}) {
  const normalizedType = cleanValue(messageType) || "SMS";
  const normalizedRole = normalizeRole(recipientRole);
  const normalizedBody = cleanValue(messageBody);
  if (!normalizedBody) {
    throw new Error("message_body is required.");
  }
  if (!normalizedRole && !cleanValue(recipientContact)) {
    throw new Error("recipient_role or recipient_contact is required.");
  }

  const recipients = await resolveCommunicationRecipients({
    institutionId,
    recipientRole: normalizedRole,
    recipientContact
  });
  if (!recipients.length) {
    throw new Error("No recipient contacts matched the supplied role/contact.");
  }

  const dispatchResults = [];
  for (const destination of recipients) {
    let status = "Sent";
    let errorMessage = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      await sendCommunicationPayload({
        messageType: normalizedType,
        destination,
        messageBody: normalizedBody
      });
    } catch (error) {
      status = "Failed";
      errorMessage = error.message;
    }
    // eslint-disable-next-line no-await-in-loop
    const insert = await query(
      `INSERT INTO communication_messages
        (institution_id, message_type, recipient_role, recipient_contact, message_body, status, sent_at, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        institutionId,
        normalizedType,
        normalizedRole || null,
        destination,
        normalizedBody,
        status,
        status === "Sent" ? dayjs().format("YYYY-MM-DD HH:mm:ss") : null,
        createdByUserId
      ]
    );
    dispatchResults.push({
      id: insert.insertId,
      recipient_contact: destination,
      status,
      error: errorMessage
    });
  }

  return dispatchResults;
}

async function dispatchQueuedMessageRecord({ institutionId, recordId, actorUserId }) {
  const rows = await query(
    `SELECT id, message_type, recipient_role, recipient_contact, message_body, status
     FROM communication_messages
     WHERE institution_id = ? AND id = ?
     LIMIT 1`,
    [institutionId, recordId]
  );
  if (!rows.length) {
    throw new Error("Message record not found.");
  }
  const record = rows[0];
  let status = "Sent";
  let errorMessage = null;
  try {
    await sendCommunicationPayload({
      messageType: record.message_type,
      destination: record.recipient_contact,
      messageBody: record.message_body
    });
  } catch (error) {
    status = "Failed";
    errorMessage = error.message;
  }
  await query(
    `UPDATE communication_messages
     SET status = ?, sent_at = ?, created_by_user_id = COALESCE(created_by_user_id, ?), updated_at = NOW()
     WHERE id = ? AND institution_id = ?`,
    [
      status,
      status === "Sent" ? dayjs().format("YYYY-MM-DD HH:mm:ss") : null,
      actorUserId,
      record.id,
      institutionId
    ]
  );
  return {
    id: record.id,
    recipient_contact: record.recipient_contact,
    status,
    error: errorMessage
  };
}

async function dispatchStoredCommunicationRow(row = {}) {
  const id = Number(row.id);
  const messageType = cleanValue(row.message_type) || "SMS";
  const destination = cleanValue(row.recipient_contact);
  const messageBody = cleanValue(row.message_body);
  if (!id) {
    return { id: null, status: "Failed", error: "Invalid message record id." };
  }
  if (!destination || !messageBody) {
    await query(
      `UPDATE communication_messages
       SET status = 'Failed', sent_at = NULL, updated_at = NOW()
       WHERE id = ?`,
      [id]
    );
    return {
      id,
      status: "Failed",
      error: "Recipient contact or message body is missing."
    };
  }

  let status = "Sent";
  let errorMessage = null;
  try {
    await sendCommunicationPayload({ messageType, destination, messageBody });
  } catch (error) {
    status = "Failed";
    errorMessage = error.message;
  }
  await query(
    `UPDATE communication_messages
     SET status = ?, sent_at = ?, updated_at = NOW()
     WHERE id = ?`,
    [status, status === "Sent" ? dayjs().format("YYYY-MM-DD HH:mm:ss") : null, id]
  );
  return { id, status, error: errorMessage };
}

async function ensureChatRoom({
  institutionId,
  roomKey,
  participantRoles = [],
  createdByUserId = null
}) {
  const normalizedRoomKey = cleanValue(roomKey);
  if (!normalizedRoomKey) {
    throw new Error("room_key is required.");
  }
  const normalizedRoles = [...new Set((participantRoles || [])
    .map((role) => normalizeRole(role))
    .filter(Boolean))];
  await query(
    `INSERT INTO communication_chat_rooms
      (institution_id, room_key, participant_roles_json, created_by_user_id, is_active)
     VALUES (?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       participant_roles_json = VALUES(participant_roles_json),
       is_active = 1,
       updated_at = NOW()`,
    [
      institutionId,
      normalizedRoomKey,
      JSON.stringify(normalizedRoles),
      createdByUserId ? String(createdByUserId) : null
    ]
  );
  const rooms = await query(
    `SELECT id, room_key, participant_roles_json, created_by_user_id, created_at, updated_at, is_active
     FROM communication_chat_rooms
     WHERE institution_id = ? AND room_key = ?
     LIMIT 1`,
    [institutionId, normalizedRoomKey]
  );
  const room = rooms[0] || null;
  return {
    room: room
      ? {
        ...room,
        participant_roles: parseStoredJson(room.participant_roles_json) || []
      }
      : null
  };
}

async function saveChatMessage({
  institutionId,
  threadKey,
  senderUserId,
  senderRole,
  senderName,
  audienceRole,
  messageBody
}) {
  const cleanedThreadKey = cleanValue(threadKey);
  const cleanedMessageBody = cleanValue(messageBody);
  if (!cleanedThreadKey) {
    throw new Error("thread/room key is required.");
  }
  if (!cleanedMessageBody) {
    throw new Error("message_body is required.");
  }
  const insert = await query(
    `INSERT INTO communication_chat_messages
      (institution_id, thread_key, sender_user_id, sender_role, sender_name, audience_role, message_body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      institutionId,
      cleanedThreadKey,
      senderUserId ? String(senderUserId) : null,
      normalizeRole(senderRole),
      cleanValue(senderName) || null,
      normalizeRole(audienceRole) || null,
      cleanedMessageBody
    ]
  );
  return insert.insertId;
}

async function createOtpSession({ identity, role, institutionId, payload, destination, channel }) {
  const code = generateOtpCode();
  const expiresAt = buildOtpExpiry();
  await query(
    `INSERT INTO otp_sessions
      (session_id, identity_value, role_name, institution_id, payload_json, otp_code, expires_at, otp_channel, destination, verify_attempts, max_attempts, last_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)`,
    [
      uuidv4(),
      identity,
      role,
      institutionId,
      JSON.stringify(payload),
      code,
      expiresAt,
      channel,
      destination,
      OTP_MAX_VERIFY_ATTEMPTS
    ]
  );
  await sendOtp({ channel, destination, code });
  return { code, expiresAt };
}

async function authenticateByUserTable(username, password) {
  const users = await query(
    "SELECT * FROM users WHERE username = ? LIMIT 1",
    [username]
  );
  if (!users.length) {
    return null;
  }
  const user = users[0];
  if (Number(user.is_active) !== 1) {
    return {
      blocked: true,
      role: normalizeRole(user.role),
      error: "This username is deactivated. Contact the System Developer."
    };
  }
  if (Number(user.is_suspended) === 1) {
    return {
      blocked: true,
      role: normalizeRole(user.role),
      error: `This account is suspended. Contact the System Developer at ${AGREEMENT_COMPANY.email} or ${AGREEMENT_COMPANY.phone}.`
    };
  }
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
     WHERE (birth_certificate_number = ? OR upi_number = ? OR assessment_number = ?)
       AND parent_id_number = ?
     LIMIT 1`,
    [username, username, username, password]
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

function sendBuildInfoJson(res) {
  res.set("Cache-Control", "no-store");
  res.json({
    build_stamp: IIMS_BUILD_STAMP,
    server_time: new Date().toISOString(),
    endpoints: ["/api/build-info", "/api/building-info"]
  });
}

app.get("/api/build-info", (_, res) => sendBuildInfoJson(res));
// Common typo when testing in the browser
app.get("/api/building-info", (_, res) => sendBuildInfoJson(res));

app.get("/api/meta", (_, res) => {
  res.json({
    roles: ROLES,
    permissions: PERMISSIONS,
    rolePermissions: ROLE_PERMISSIONS,
    gradeOptions: GRADES,
    yearJoinedOptions: YEAR_JOINED_OPTIONS,
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
    defaultModuleAccessByRole: DEFAULT_MODULE_ACCESS_BY_ROLE,
    otpChannels: ["console", "email", "sms", "sms_email"]
  });
});

app.get("/api/health", asyncHandler(async (_, res) => {
  await query("SELECT 1");
  res.json({ status: "ok", service: "IIMS API" });
}));

app.post("/api/auth/login", authLoginRateLimit, asyncHandler(async (req, res) => {
  const { username, password, otpChannel } = req.body;
  const auditBase = buildAuthAuditDetails(req, username, {
    password_correct: false,
    otp_correct: false
  });
  if (!username || !password) {
    await auditLog(
      { institution_id: null, id: null, role: "PUBLIC" },
      "LOGIN_FAILED",
      "auth",
      null,
      {
        ...auditBase,
        reason: "MISSING_CREDENTIALS"
      }
    );
    return res.status(400).json({ error: "Username and password are required." });
  }
  const usernameValidationError = validateUsername(username, "username");
  if (usernameValidationError) {
    await auditLog(
      { institution_id: null, id: null, role: "PUBLIC" },
      "LOGIN_FAILED",
      "auth",
      null,
      {
        ...auditBase,
        reason: "INVALID_USERNAME_FORMAT"
      }
    );
    await delayWithRandomJitter();
    return res.status(400).json({ error: usernameValidationError });
  }
  const securityUser = await getActiveUserSecurityState(username);
  if (isAccountLocked(securityUser)) {
    await auditLog(
      {
        institution_id: securityUser?.institution_id || null,
        id: securityUser?.id || null,
        role: securityUser?.role || "PUBLIC"
      },
      "ACCOUNT_LOCKED",
      "auth",
      securityUser?.id || null,
      {
        ...auditBase,
        reason: "ACCOUNT_TEMPORARILY_LOCKED",
        locked_until: normalizeDateTime(securityUser?.locked_until)
      }
    );
    await delayWithRandomJitter();
    return res.status(423).json({
      error: "Account temporarily locked due to repeated failed login attempts.",
      locked_until: normalizeDateTime(securityUser.locked_until)
    });
  }

  const userAccount = await authenticateByUserTable(username, password);
  if (userAccount?.blocked) {
    await auditLog(
      {
        institution_id: userAccount?.institution_id || securityUser?.institution_id || null,
        id: userAccount?.payload?.id || securityUser?.id || null,
        role: userAccount?.role || securityUser?.role || "PUBLIC"
      },
      "LOGIN_FAILED",
      "auth",
      userAccount?.payload?.id || securityUser?.id || null,
      {
        ...auditBase,
        password_correct: true,
        reason: "PASSWORD_EXPIRED"
      }
    );
    await delayWithRandomJitter();
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
    const failureState = await recordFailedLoginAttempt(securityUser || {});
    await auditLog(
      {
        institution_id: securityUser?.institution_id || null,
        id: securityUser?.id || null,
        role: securityUser?.role || "PUBLIC"
      },
      "LOGIN_FAILED",
      "auth",
      securityUser?.id || null,
      {
        ...auditBase,
        remaining_attempts: failureState?.remainingAttempts ?? null,
        locked_until: failureState?.lockedUntil || null,
        reason: "INVALID_PASSWORD_OR_UNKNOWN_USER"
      }
    );
    await delayWithRandomJitter();
    return res.status(failureState?.lockedUntil ? 423 : 401).json({
      error: failureState?.lockedUntil
        ? "Account temporarily locked due to repeated failed login attempts."
        : "Invalid username or password.",
      remaining_attempts: failureState?.remainingAttempts,
      locked_until: failureState?.lockedUntil
    });
  }
  if (securityUser?.id) {
    await resetLoginFailureState(securityUser.id);
  }
  const otpCooldown = checkOtpRequestCooldown(account.identity);
  if (!otpCooldown.allowed) {
    await auditLog(
      {
        institution_id: account?.institution_id || securityUser?.institution_id || null,
        id: account?.payload?.id || securityUser?.id || null,
        role: account?.role || securityUser?.role || "PUBLIC"
      },
      "OTP_RESEND_BLOCKED",
      "otp_sessions",
      null,
      {
        ...buildAuthAuditDetails(req, username, {
          password_correct: true,
          otp_correct: false,
          otp_resend_available_after_seconds: otpCooldown.remainingSeconds
        })
      }
    );
    return res.status(429).json({
      error: "OTP already requested recently. Please wait before requesting another code.",
      otp_resend_available_after_seconds: otpCooldown.remainingSeconds
    });
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
  await auditLog(
    {
      institution_id: account?.institution_id || null,
      id: account?.payload?.id || null,
      role: account?.role || "PUBLIC"
    },
    "OTP_REQUESTED",
    "otp_sessions",
    null,
    {
      ...buildAuthAuditDetails(req, username, {
        password_correct: true,
        otp_correct: false,
        otp_channel: channel,
        otp_expires_at: otpSession.expiresAt
      })
    }
  );

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
    otp_expires_at: exposeOtpPreview ? otpSession.expiresAt : null,
    otp_resend_available_after_seconds: OTP_RESEND_COOLDOWN_SECONDS
  });
}));

app.post("/api/auth/verify-otp", otpVerifyRateLimit, asyncHandler(async (req, res) => {
  const { username, otp } = req.body;
  const otpAuditBase = buildAuthAuditDetails(req, username, {
    password_correct: true,
    otp_correct: false
  });
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
    const failure = await recordOtpFailure(username);
    await auditLog(
      { institution_id: null, id: null, role: "PUBLIC" },
      "OTP_VERIFY_FAILED",
      "otp_sessions",
      null,
      {
        ...otpAuditBase,
        remaining_attempts: failure?.remainingAttempts ?? null
      }
    );
    return res.status(401).json({
      error: "Invalid or expired OTP.",
      remaining_attempts: failure?.remainingAttempts ?? null
    });
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
    const failure = await recordOtpFailure(username);
    await auditLog(
      { institution_id: null, id: null, role: "PUBLIC" },
      "OTP_VERIFY_FAILED",
      "otp_sessions",
      null,
      {
        ...otpAuditBase,
        reason: "MALFORMED_OR_INVALID_STORED_SESSION",
        remaining_attempts: failure?.remainingAttempts ?? null
      }
    );
    return res.status(401).json({
      error: "Invalid or expired OTP. Please request a fresh OTP and try again.",
      remaining_attempts: failure?.remainingAttempts ?? null
    });
  }
  await query("UPDATE otp_sessions SET is_used = 1 WHERE id = ?", [session.id]);
  await recordOtpSuccess(session.id);
  payload.role = normalizeRole(payload.role);
  payload.login_session_started_at = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const token = issueToken(payload);
  await auditLog(payload, "LOGIN_SUCCESS", "auth", payload.id, {
    ...buildAuthAuditDetails(req, payload.username || username, {
      password_correct: true,
      otp_correct: true,
      login_time: payload.login_session_started_at,
      role: payload.role
    })
  });

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
    `SELECT u.id, u.role, u.institution_id, u.full_name, u.username, u.email, u.phone, u.password_last_changed_at, u.password_expires_at, u.must_change_password,
            u.is_active, u.is_suspended, u.status_reason, u.suspended_reason,
            i.institution_name, i.institution_code
     FROM users u
     INNER JOIN institutions i ON i.id = u.institution_id
     WHERE u.id = ? AND u.institution_id = ?
     LIMIT 1`,
    [req.user.id, req.user.institution_id]
  );
  if (!rows.length) {
    return res.status(404).json({ error: "User account not found." });
  }
  const user = rows[0];
  if (Number(user.is_active) !== 1) {
    return res.status(403).json({ error: "Your username is deactivated. Contact the System Developer." });
  }
  if (Number(user.is_suspended) === 1) {
    return res.status(403).json({
      error:
        `You are suspended kindly contact the system developer (${AGREEMENT_COMPANY.email} / ${AGREEMENT_COMPANY.phone}).`,
      suspended: true,
      contact: {
        email: AGREEMENT_COMPANY.email,
        phone: AGREEMENT_COMPANY.phone
      }
    });
  }
  const passwordPolicy = evaluatePasswordRotation(user);
  res.json({
    ...user,
    must_change_password: Number(user.must_change_password || 0) === 1,
    password_days_remaining: passwordPolicy.remainingDays
  });
}));

app.post("/api/auth/logout", auth, asyncHandler(async (req, res) => {
  await auditLog(req.user, "LOGOUT", "auth", req.user?.id || null, {
    ...buildAuthAuditDetails(req, req.user?.username, {
      password_correct: true,
      otp_correct: true,
      login_time: req.user?.login_session_started_at || null,
      logout_time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      activity_done: "LOGOUT"
    })
  });
  res.json({ message: "Logged out successfully." });
}));

app.patch("/api/users/:id/force-reset-password", auth, accountMutationRateLimit, accountMutationCooldown, enforceRole([ROLES.SYSTEM_DEVELOPER]), asyncHandler(async (req, res) => {
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
     SET password_hash = ?,
         password_last_changed_at = NOW(),
         password_expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY),
         must_change_password = 1,
         failed_login_attempts = 0,
         locked_until = NULL,
         last_failed_login_at = NULL
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

app.patch("/api/system-developer/credentials", auth, accountMutationRateLimit, accountMutationCooldown, enforceRole([ROLES.SYSTEM_DEVELOPER]), asyncHandler(async (req, res) => {
  const currentUsername = cleanValue(req.body?.current_username) || cleanValue(req.user.username);
  const newUsername = cleanOptionalValue(req.body?.new_username);
  const newPasswordRaw = cleanOptionalValue(req.body?.new_password);
  const autoGeneratePassword = parseTruthy(req.body?.auto_generate_password);
  const newPassword = autoGeneratePassword ? generateStrongPassword(14) : newPasswordRaw;

  if (!currentUsername) {
    return res.status(400).json({ error: "current_username is required." });
  }
  if (!newUsername && !newPassword) {
    return res.status(400).json({
      error: "Provide new_username or new_password (or set auto_generate_password=true)."
    });
  }
  if (newUsername) {
    const usernameValidationError = validateUsername(newUsername, "new_username");
    if (usernameValidationError) {
      return res.status(400).json({ error: usernameValidationError });
    }
  }
  if (newPassword) {
    const weakPasswordError = requireStrongPassword(newPassword, "new_password");
    if (weakPasswordError) {
      return res.status(400).json({ error: weakPasswordError });
    }
  }

  const users = await query(
    `SELECT id, username
     FROM users
     WHERE username = ?
       AND role = ?
     ORDER BY id ASC
     LIMIT 1`,
    [currentUsername, ROLES.SYSTEM_DEVELOPER]
  );
  if (!users.length) {
    return res.status(404).json({ error: "System Developer account not found." });
  }
  const targetUser = users[0];

  if (newUsername && newUsername !== targetUser.username) {
    const existing = await query("SELECT id FROM users WHERE username = ? LIMIT 1", [newUsername]);
    if (existing.length) {
      return res.status(409).json({ error: "new_username is already in use." });
    }
  }

  const updates = [];
  const params = [];
  if (newUsername) {
    updates.push("username = ?");
    params.push(newUsername);
  }
  if (newPassword) {
    updates.push("password_hash = ?");
    params.push(await hashPassword(newPassword));
    updates.push("password_last_changed_at = NOW()");
    updates.push("password_expires_at = NULL");
    updates.push("must_change_password = 0");
    updates.push("failed_login_attempts = 0");
    updates.push("locked_until = NULL");
    updates.push("last_failed_login_at = NULL");
  }
  await query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, [...params, targetUser.id]);
  await auditLog(req.user, "SYSTEM_DEVELOPER_UPDATE_CREDENTIALS", "users", targetUser.id, {
    previous_username: targetUser.username,
    new_username: newUsername || targetUser.username,
    password_rotated: Boolean(newPassword),
    auto_generated_password: autoGeneratePassword
  });
  res.json({
    message: "System Developer credentials updated successfully.",
    username: newUsername || targetUser.username,
    generated_password: autoGeneratePassword ? newPassword : null
  });
}));

app.post("/api/public/register-institution", publicWriteRateLimit, enforcePublicSecurity, asyncHandler(async (req, res) => {
  return res.status(403).json({
    error:
      "Public institution registration is disabled. Log in and use Register (Institution/User) inside the system."
  });
}));

app.post("/api/public/register-user", publicWriteRateLimit, enforcePublicSecurity, asyncHandler(async (req, res) => {
  return res.status(403).json({
    error:
      "Public user registration is disabled. Log in and use Register (Institution/User) inside the system."
  });
}));

app.get("/api/public/institutions", asyncHandler(async (_, res) => {
  return res.status(403).json({
    error:
      "Public institution registry access is disabled. Log in and use Institutions & Users Registry inside the system."
  });
}));

app.get("/api/public/institutions/:id/agreement.pdf", asyncHandler(async (_, res) => {
  return res.status(403).json({
    error: "Agreement documents require authentication. Sign in and use the registration center or institution tools."
  });
}));

app.post("/api/public/institutions/:id/agreement/send", publicWriteRateLimit, enforcePublicSecurity, asyncHandler(async (_, res) => {
  return res.status(403).json({
    error: "Sending agreements requires authentication. Sign in and use the registration center."
  });
}));

app.post("/api/public/forgot-username", publicWriteRateLimit, enforcePublicSecurity, asyncHandler(async (req, res) => {
  return res.status(200).json({
    message:
      "For username recovery, contact your institution administrator or the system developer."
  });
}));

app.post("/api/public/forgot-password", publicWriteRateLimit, enforcePublicSecurity, asyncHandler(async (req, res) => {
  const institutionCode = cleanOptionalValue(req.body?.institution_code);
  const username = cleanValue(req.body?.username);
  const email = cleanOptionalValue(req.body?.email);
  const phone = cleanOptionalValue(req.body?.phone);
  const contactMethod = cleanOptionalValue(req.body?.contact_method);
  const requestedOtpChannel = cleanOptionalValue(req.body?.otp_channel);
  const otp = cleanOptionalValue(req.body?.otp);
  const newPassword = cleanOptionalValue(req.body?.new_password);
  const mode = otp && newPassword ? "verify" : "request";

  if (!institutionCode) {
    return res.status(400).json({ error: "institution_code is required." });
  }
  if (!username) {
    return res.status(400).json({ error: "username is required." });
  }
  if (!contactMethod || !["email", "phone"].includes(contactMethod)) {
    return res.status(400).json({ error: "contact_method must be either 'email' or 'phone'." });
  }
  if (contactMethod === "email" && !email) {
    return res.status(400).json({ error: "Email is required when contact method is email." });
  }
  if (contactMethod === "phone" && !phone) {
    return res.status(400).json({ error: "Mobile number is required when contact method is phone." });
  }
  if (mode === "request" && (!requestedOtpChannel || !["sms", "email"].includes(requestedOtpChannel))) {
    return res.status(400).json({ error: "otp_channel must be either 'sms' or 'email'." });
  }
  if (mode === "verify") {
    const weakNewPasswordError = requireStrongPassword(newPassword, "new_password");
    if (weakNewPasswordError) {
      return res.status(400).json({ error: weakNewPasswordError });
    }
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
  if (contactMethod === "email" && cleanValue(user.email) !== cleanValue(email)) {
    return res.status(401).json({ error: "Email does not match our records." });
  }
  if (contactMethod === "phone" && cleanValue(user.phone) !== cleanValue(phone)) {
    return res.status(401).json({ error: "Phone does not match our records." });
  }

  if (mode === "request") {
    const identity = `pwdreset:${username.toLowerCase()}`;
    const otpCooldown = checkOtpRequestCooldown(identity);
    if (!otpCooldown.allowed) {
      return res.status(429).json({
        error: "OTP already requested recently. Please wait before requesting another code.",
        otp_resend_available_after_seconds: otpCooldown.remainingSeconds
      });
    }

    const contactDestination = contactMethod === "phone" ? cleanValue(phone) : cleanValue(email);
    const channel = requestedOtpChannel;
    if (!contactDestination) {
      return res.status(400).json({ error: "Selected contact destination is missing." });
    }
    if (channel === "sms" && contactMethod !== "phone") {
      return res.status(400).json({ error: "SMS delivery requires mobile number contact method." });
    }
    if (channel === "email" && contactMethod !== "email") {
      return res.status(400).json({ error: "Email delivery requires email contact method." });
    }
    const payload = {
      username,
      institution_id: user.institution_id,
      recovery_type: "PASSWORD_RESET",
      email: cleanValue(email) || null,
      phone: cleanValue(phone) || null,
      contact_method: contactMethod
    };
    const otpSession = await createOtpSession({
      identity,
      role: "PUBLIC_PASSWORD_RESET",
      institutionId: user.institution_id,
      payload,
      destination: contactDestination,
      channel
    });
    await auditLog(
      { institution_id: user.institution_id || null, id: user.id || null, role: "PUBLIC" },
      "PUBLIC_PASSWORD_RESET_OTP_REQUESTED",
      "otp_sessions",
      null,
      { username, otp_channel: channel, otp_expires_at: otpSession.expiresAt }
    );
    return res.json({
      message: `OTP sent to your ${channel === "sms" ? "phone" : "email"}.`,
      otp_channel_used: channel,
      otp_resend_available_after_seconds: OTP_RESEND_COOLDOWN_SECONDS
    });
  }

  const sessions = await query(
    `SELECT * FROM otp_sessions
     WHERE identity_value = ?
       AND role_name = 'PUBLIC_PASSWORD_RESET'
       AND otp_code = ?
       AND is_used = 0
       AND expires_at > NOW()
     ORDER BY id DESC
     LIMIT 1`,
    [`pwdreset:${username.toLowerCase()}`, otp]
  );
  if (!sessions.length) {
    return res.status(401).json({ error: "Invalid or expired OTP." });
  }
  await query("UPDATE otp_sessions SET is_used = 1 WHERE id = ?", [sessions[0].id]);

  const passwordHash = await hashPassword(newPassword);
  await query(
    `UPDATE users
     SET password_hash = ?,
         password_last_changed_at = NOW(),
         password_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY),
         must_change_password = 1,
         failed_login_attempts = 0,
         locked_until = NULL,
         last_failed_login_at = NULL
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

app.post("/api/public/institutions/register", publicWriteRateLimit, enforcePublicSecurity, asyncHandler(async (req, res) => {
  return res.status(403).json({
    error:
      "Public institution registration is disabled. Log in and use Register (Institution/User) inside the system."
  });
}));

app.post("/api/public/users/register", publicWriteRateLimit, enforcePublicSecurity, asyncHandler(async (req, res) => {
  return res.status(403).json({
    error:
      "Public user registration is disabled. Log in and use Register (Institution/User) inside the system."
  });
}));

app.post(
  "/api/auth/logout",
  auth,
  asyncHandler(async (req, res) => {
    await auditLog(req.user, "LOGOUT", "auth", req.user?.id || null, {
      ...buildAuthAuditDetails(req, req.user?.username, {
        password_correct: true,
        otp_correct: true,
        login_time: req.user?.login_session_started_at || null,
        logout_time: dayjs().format("YYYY-MM-DD HH:mm:ss")
      })
    });
    res.json({ message: "Logged out successfully." });
  })
);

app.post("/api/public/recovery/username", publicWriteRateLimit, enforcePublicSecurity, asyncHandler(async (req, res) => {
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

app.post("/api/public/recovery/password", publicWriteRateLimit, enforcePublicSecurity, asyncHandler(async (req, res) => {
  const institution_code = cleanValue(req.body?.institution_code).toUpperCase();
  const username = cleanValue(req.body?.username);
  const email = cleanOptionalValue(req.body?.email);
  const phone = cleanOptionalValue(req.body?.phone);
  const new_password = cleanValue(req.body?.new_password);
  const weakNewPasswordError = requireStrongPassword(new_password, "new_password");
  if (weakNewPasswordError) {
    return res.status(400).json({ error: weakNewPasswordError });
  }

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
     SET password_hash = ?,
         password_last_changed_at = NOW(),
         password_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY),
         must_change_password = 1,
         failed_login_attempts = 0,
         locked_until = NULL,
         last_failed_login_at = NULL
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
    assignable_roles: getAssignableRolesForActor(req.user),
    can_register_institution: canRegisterInstitution(req.user),
    can_register_users: canRegisterInstitutionUsers(req.user),
    can_register_privileged_users: canRegisterPrivilegedUsers(req.user),
    must_change_password: Boolean(req.user.must_change_password),
    password_last_changed_at: req.user.password_last_changed_at || null,
    password_expires_at: req.user.password_expires_at || null,
    password_days_remaining: passwordPolicy.remainingDays
  });
}));

app.get(
  "/api/users/registrar-options",
  auth,
  enforceModuleAccess(MODULE_KEYS.REGISTRATION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const canSeeAllInstitutions = canManageAcrossInstitutions(req.user);
    const institutionScopeId = canSeeAllInstitutions
      ? Number(req.query?.institution_id || 0) || null
      : Number(req.user.institution_id || 0) || null;
    const institutions = canSeeAllInstitutions
      ? await query(
        `SELECT id, institution_name, institution_code, county, email, phone
         FROM institutions
         ${institutionScopeId ? "WHERE id = ?" : ""}
         ORDER BY institution_name ASC`,
        institutionScopeId ? [institutionScopeId] : []
      )
      : await query(
        `SELECT id, institution_name, institution_code, county, email, phone
         FROM institutions
         WHERE id = ?
         LIMIT 1`,
        [req.user.institution_id]
      );
    const registrationMeta = canRegisterInstitution(req.user)
      ? {
          counties: COUNTIES,
          categories: INSTITUTION_CATEGORIES,
          postalCodes: KENYA_POSTAL_CODES
        }
      : null;
    res.json({
      requester_role: normalizeRole(req.user.role),
      can_manage_all_institutions: canSeeAllInstitutions,
      institution_scope_id: institutionScopeId,
      assignable_roles: getAssignableRolesForActor(req.user),
      can_register_institution: canRegisterInstitution(req.user),
      can_register_users: canRegisterInstitutionUsers(req.user),
      can_register_privileged_users: canRegisterPrivilegedUsers(req.user),
      registration_meta: registrationMeta,
      institutions
    });
  })
);

app.post(
  "/api/institutions/preview-code",
  auth,
  enforceModuleAccess(MODULE_KEYS.REGISTRATION),
  enforceRole([ROLES.SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const countyInput = cleanOptionalValue(req.body?.county);
    const countyCodeInput = cleanOptionalValue(req.body?.county_code);
    const categoryInput = cleanOptionalValue(req.body?.category);
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
    const institutionCode = await nextInstitutionCode({
      countyCode: countyRecord.code,
      categoryCode: categoryRecord.code
    });
    res.json({
      county: countyRecord.name,
      county_code: countyRecord.code,
      category: categoryRecord.label,
      category_code: categoryRecord.code,
      institution_code: institutionCode
    });
  })
);

app.post(
  "/api/institutions",
  auth,
  accountMutationRateLimit,
  accountMutationCooldown,
  enforceModuleAccess(MODULE_KEYS.REGISTRATION),
  enforceRole([ROLES.SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const institutionName = cleanValue(req.body?.institution_name);
    const institutionEmail = cleanOptionalValue(req.body?.email);
    const institutionPhone = cleanOptionalValue(req.body?.phone);
    const countyInput = cleanOptionalValue(req.body?.county);
    const countyCodeInput = cleanOptionalValue(req.body?.county_code);
    const categoryInput = cleanOptionalValue(req.body?.category);
    const subCounty = cleanOptionalValue(req.body?.sub_county);
    const location = cleanOptionalValue(req.body?.location);
    const village = cleanOptionalValue(req.body?.village);
    const postalAddress = cleanOptionalValue(req.body?.postal_address);
    const postalCodeInput = cleanOptionalValue(req.body?.postal_code);
    const townInput = cleanOptionalValue(req.body?.town);
    const sendAgreementEmail = parseTruthy(req.body?.send_agreement_email);
    const autoGeneratePassword = parseTruthy(req.body?.auto_generate_password);

    const adminFullName = cleanValue(req.body?.admin_full_name);
    const adminUsername = cleanValue(req.body?.admin_username);
    const adminUsernameValidationError = validateUsername(adminUsername, "admin_username");
    if (adminUsernameValidationError) {
      return res.status(400).json({ error: adminUsernameValidationError });
    }
    const adminPasswordInput = cleanValue(req.body?.admin_password);
    const portalRoleRaw = normalizeRole(cleanValue(req.body?.portal_role));
    const portalRole = [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION].includes(portalRoleRaw)
      ? portalRoleRaw
      : ROLES.HEAD_OF_INSTITUTION;

    if (!institutionName) {
      return res.status(400).json({ error: "institution_name is required." });
    }

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
    const adminPassword = autoGeneratePassword
      ? generateStrongPassword(12)
      : adminPasswordInput;
    const weakAdminPasswordError = requireStrongPassword(adminPassword, "admin_password");
    if (weakAdminPasswordError) {
      return res.status(400).json({ error: weakAdminPasswordError });
    }

    if (!institutionName || !adminFullName || !adminUsername || !adminPassword) {
      return res.status(400).json({
        error: "institution_name, admin_full_name, admin_username and admin_password are required."
      });
    }

    // Avoid duplicate institution_code under concurrent registrations by retrying on duplicate-key conflict.
    let institutionCode = "";
    let institutionInsert = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      institutionCode = await nextInstitutionCode({
        countyCode: countyRecord.code,
        categoryCode: categoryRecord.code
      });
      try {
        institutionInsert = await query(
          `INSERT INTO institutions
            (institution_name, institution_code, email, phone, county, sub_county, location, village, postal_address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            institutionName,
            institutionCode,
            institutionEmail,
            institutionPhone,
            countyRecord.name,
            subCounty,
            location,
            normalizedTown || village,
            postalAddress
          ]
        );
        break;
      } catch (error) {
        if (error?.code !== "ER_DUP_ENTRY" || attempt === 4) {
          throw error;
        }
      }
    }
    if (!institutionInsert?.insertId) {
      return res.status(409).json({ error: "Unable to allocate a unique institution code. Please retry." });
    }
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
      "WELCOME TO INTEGRATED MANAGEMENT INFORMATION SYSTEM (IMIS).",
      "Your account has been created successfully.",
      `Institution: ${institutionName}`,
      `Institution Code: ${institutionCode}`,
      `Username: ${adminUsername}`,
      `Password: ${adminPassword}`,
      "",
      "IMPORTANT SECURITY NOTE:",
      "Please log in and change this password immediately after first sign-in."
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

    await auditLog(req.user, "REGISTER_INSTITUTION", "institutions", institutionId, {
      institution_name: institutionName,
      institution_code: institutionCode,
      county: countyRecord.name,
      county_code: countyRecord.code,
      category: categoryRecord.label,
      category_code: categoryRecord.code,
      postal_address: postalAddress,
      admin_username: adminUsername,
      admin_role: portalRole
    });

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
      postal_address: postalAddress,
      postal_code: postalDetails?.postal_code || postalCodeInput || null,
      town: normalizedTown,
      agreement_pdf_url: `/api/institutions/${institutionId}/agreement.pdf`,
      credential_dispatch: credentialDispatch,
      agreement_email_dispatch: agreementEmailDispatch
    });
  })
);

app.get(
  "/api/institutions/:id/agreement.pdf",
  auth,
  enforceModuleAccess(MODULE_KEYS.REGISTRATION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    if (!institutionId) {
      return res.status(400).json({ error: "Valid institution id is required." });
    }
    const institution = await loadInstitutionAgreementContext(institutionId);
    const accessError = assertInstitutionAgreementAccess(req, institution);
    if (accessError) {
      return res.status(accessError.status).json({ error: accessError.error });
    }
    const lines = buildAgreementLines({
      institution,
      adminUser: { username: institution.admin_username || "-" }
    });
    sendSimplePdf(
      res,
      `institution-agreement-${institution.institution_code || institution.id}`,
      lines
    );
  })
);

app.post(
  "/api/institutions/:id/agreement/send",
  auth,
  accountMutationRateLimit,
  accountMutationCooldown,
  enforceModuleAccess(MODULE_KEYS.REGISTRATION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    if (!institutionId) {
      return res.status(400).json({ error: "Valid institution id is required." });
    }
    const institution = await loadInstitutionAgreementContext(institutionId);
    const accessError = assertInstitutionAgreementAccess(req, institution);
    if (accessError) {
      return res.status(accessError.status).json({ error: accessError.error });
    }
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
    await auditLog(req.user, "AGREEMENT_DISPATCH", "institutions", institution.id, {
      institution_code: institution.institution_code,
      credential_dispatch: dispatch
    });
    res.json({
      message: "Agreement dispatch completed.",
      institution_id: institution.id,
      credential_dispatch: dispatch
    });
  })
);

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
  "/api/public/branding/hero-image",
  asyncHandler(async (_, res) => {
    res.set("Cache-Control", "no-store");
    const heroImage = resolveHeroImageAsset();
    res.json(heroImage);
  })
);

app.post(
  "/api/system/branding/hero-image",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.UPDATE),
  heroImageUploadMiddleware,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Hero image file is required." });
    }
    cleanupOldHeroImages(req.file.filename);
    writeHeroImageManifest(req.file.filename, req.user.id);
    const heroImage = resolveHeroImageAsset();
    await auditLog(req.user, "UPLOAD_LOGIN_HERO_IMAGE", "branding", null, {
      file_name: req.file.filename,
      hero_image_path: heroImage.hero_image_path
    });
    return res.json({
      message: "Login hero image updated successfully.",
      ...heroImage
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
    const [activeLearners] = await query(
      `SELECT COUNT(*) totalActiveLearners
       FROM learners
       WHERE institution_id = ?
         AND (
           status IS NULL
           OR TRIM(status) = ''
           OR LOWER(status) IN ('active', 'in session', 'continuing')
         )`,
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
    const [dropOutLearners] = await query(
      `SELECT COUNT(*) totalDropOut
       FROM learners
       WHERE institution_id = ?
         AND (
           LOWER(COALESCE(status, '')) LIKE '%drop%'
           OR LOWER(COALESCE(conduct_status, '')) LIKE '%drop%'
           OR LOWER(COALESCE(reason_for_leaving, '')) LIKE '%drop%'
         )`,
      [institutionId]
    );
    const [completedLearners] = await query(
      `SELECT COUNT(*) totalCompletion
       FROM learners
       WHERE institution_id = ?
         AND (
           LOWER(COALESCE(status, '')) LIKE '%complet%'
           OR LOWER(COALESCE(conduct_status, '')) LIKE '%complet%'
           OR LOWER(COALESCE(reason_for_leaving, '')) LIKE '%complet%'
         )`,
      [institutionId]
    );
    const [learnersTransferred] = await query(
      `SELECT COUNT(*) totalTransferred
       FROM learners
       WHERE institution_id = ?
         AND (
           conduct_status = 'Transferred'
           OR LOWER(COALESCE(conduct_status, '')) LIKE '%transfer%'
         )`,
      [institutionId]
    );
    const [feesToday] = await query(
      `SELECT COALESCE(SUM(amount_paid), 0) totalFees, COUNT(*) totalPayments
       FROM finance_fee_payments
       WHERE institution_id = ? AND DATE(payment_date) = CURDATE()`,
      [institutionId]
    );
    const [teachersTotal] = await query(
      "SELECT COUNT(*) totalTeachers FROM teacher_profiles WHERE institution_id = ?",
      [institutionId]
    );
    const [teachersPresent] = await query(
      `SELECT COUNT(*) totalTeachersPresent
       FROM attendance_records
       WHERE institution_id = ?
         AND attendance_type = 'Teacher'
         AND status = 'Present'
         AND DATE(attendance_date) = CURDATE()`,
      [institutionId]
    );
    const [teachersOfficialLeave] = await query(
      `SELECT COUNT(*) totalTeachersOfficialLeave
       FROM teacher_profiles
       WHERE institution_id = ?
         AND LOWER(COALESCE(leave_status, '')) LIKE '%official leave%'`,
      [institutionId]
    );
    const [teachersAbsentWithApology] = await query(
      `SELECT COUNT(*) totalTeachersAbsentWithApology
       FROM teacher_profiles
       WHERE institution_id = ?
         AND LOWER(COALESCE(accountability_status, '')) LIKE '%absent with apology%'`,
      [institutionId]
    );
    const [teachersAbsentWithoutApology] = await query(
      `SELECT COUNT(*) totalTeachersAbsentWithoutApology
       FROM teacher_profiles
       WHERE institution_id = ?
         AND LOWER(COALESCE(accountability_status, '')) LIKE '%absent without apology%'`,
      [institutionId]
    );
    const [teachersDeserter] = await query(
      `SELECT COUNT(*) totalTeachersDeserter
       FROM teacher_profiles
       WHERE institution_id = ?
         AND LOWER(COALESCE(employment_status, '')) LIKE '%deserter%'`,
      [institutionId]
    );
    const [teachersSuspended] = await query(
      `SELECT COUNT(*) totalTeachersSuspended
       FROM teacher_profiles
       WHERE institution_id = ?
         AND LOWER(COALESCE(employment_status, '')) LIKE '%suspend%'`,
      [institutionId]
    );
    const [teachersInterdicted] = await query(
      `SELECT COUNT(*) totalTeachersInterdicted
       FROM teacher_profiles
       WHERE institution_id = ?
         AND LOWER(COALESCE(employment_status, '')) LIKE '%interdict%'`,
      [institutionId]
    );
    const [teachersTransferred] = await query(
      `SELECT COUNT(*) totalTeachersTransferred
       FROM teacher_profiles
       WHERE institution_id = ?
         AND LOWER(COALESCE(employment_status, '')) LIKE '%transfer%'`,
      [institutionId]
    );
    const [teachersRetired] = await query(
      `SELECT COUNT(*) totalTeachersRetired
       FROM teacher_profiles
       WHERE institution_id = ?
         AND LOWER(COALESCE(employment_status, '')) LIKE '%retire%'`,
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

    const [financeSessionRows] = await query(
      `SELECT academic_year_label, term_name, capitation_received, fee_paid, grant_other,
              COALESCE(available_balance, (capitation_received + fee_paid + grant_other - liabilities)) AS available_balance,
              outstanding_balance, liabilities
       FROM finance_session_sync
       WHERE institution_id = ?
       ORDER BY id DESC
       LIMIT 1`,
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

    const financeSession = financeSessionRows || null;
    res.json({
      generated_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      stats: {
        totalLearners: toNumber(population.totalLearners),
        totalActiveLearners: toNumber(activeLearners.totalActiveLearners),
        totalPresent: toNumber(present.totalPresent),
        totalAbsent: toNumber(absent.totalAbsent),
        totalBoys: toNumber(boys.totalBoys),
        totalGirls: toNumber(girls.totalGirls),
        totalLate: toNumber(late.totalLate),
        totalSuspended: toNumber(suspension.totalSuspended),
        totalExpelled: toNumber(expelled.totalExpelled),
        totalDropOut: toNumber(dropOutLearners.totalDropOut),
        totalTransferred: toNumber(learnersTransferred.totalTransferred),
        totalCompletion: toNumber(completedLearners.totalCompletion),
        totalTeachers: toNumber(teachersTotal.totalTeachers),
        totalTeachersPresent: toNumber(teachersPresent.totalTeachersPresent),
        totalTeachersOfficialLeave: toNumber(teachersOfficialLeave.totalTeachersOfficialLeave),
        totalTeachersAbsentWithApology: toNumber(teachersAbsentWithApology.totalTeachersAbsentWithApology),
        totalTeachersAbsentWithoutApology: toNumber(teachersAbsentWithoutApology.totalTeachersAbsentWithoutApology),
        totalTeachersDeserter: toNumber(teachersDeserter.totalTeachersDeserter),
        totalTeachersSuspended: toNumber(teachersSuspended.totalTeachersSuspended),
        totalTeachersInterdicted: toNumber(teachersInterdicted.totalTeachersInterdicted),
        totalTeachersTransferred: toNumber(teachersTransferred.totalTeachersTransferred),
        totalTeachersRetired: toNumber(teachersRetired.totalTeachersRetired),
        totalFeesCollectedToday: toMoney(feesToday.totalFees)
      },
      attendanceBreakdown,
      dailyAttendanceList,
      performanceByClass,
      feeCollectionSummary,
      financeSessionSync: financeSession
        ? {
          academic_year: financeSession.academic_year_label,
          term_name: financeSession.term_name,
          capitation_received: toMoney(financeSession.capitation_received),
          fee_paid: toMoney(financeSession.fee_paid),
          grant_other: toMoney(financeSession.grant_other),
          available_balance: toMoney(financeSession.available_balance),
          outstanding_balance: toMoney(financeSession.outstanding_balance),
          liabilities: toMoney(financeSession.liabilities)
        }
        : null,
      alerts,
      announcements
    });
  })
);

app.post(
  "/api/finance/session-sync",
  auth,
  enforceModuleAccess(MODULE_KEYS.FINANCE),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const institutionId = req.user.institution_id;
    const academicYear = cleanValue(req.body?.academic_year);
    const termName = cleanValue(req.body?.term_name);
    const capitationReceived = Number(req.body?.capitation_received || 0);
    const feePaid = Number(req.body?.fee_paid || 0);
    const grantOther = Number(req.body?.grant_other || 0);
    const availableBalance = Number(req.body?.available_balance || 0);
    const outstandingBalance = Number(req.body?.outstanding_balance || 0);
    const liabilities = Number(req.body?.liabilities || 0);

    if (!academicYear || !termName) {
      return res.status(400).json({ error: "academic_year and term_name are required." });
    }

    const existing = await query(
      `SELECT id FROM finance_session_sync
       WHERE institution_id = ? AND academic_year_label = ? AND term_name = ?
       LIMIT 1`,
      [institutionId, academicYear, termName]
    );

    if (existing.length) {
      await query(
        `UPDATE finance_session_sync
         SET capitation_received = ?, fee_paid = ?, grant_other = ?, available_balance = ?,
             outstanding_balance = ?, liabilities = ?, updated_at = NOW()
         WHERE id = ?`,
        [
          capitationReceived,
          feePaid,
          grantOther,
          availableBalance,
          outstandingBalance,
          liabilities,
          existing[0].id
        ]
      );
    } else {
      await query(
        `INSERT INTO finance_session_sync
          (institution_id, academic_year_label, term_name, capitation_received, fee_paid, grant_other, available_balance, outstanding_balance, liabilities, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          institutionId,
          academicYear,
          termName,
          capitationReceived,
          feePaid,
          grantOther,
          availableBalance,
          outstandingBalance,
          liabilities,
          req.user.id
        ]
      );
    }

    await auditLog(req.user, "UPSERT_FINANCE_SESSION_SYNC", "finance_session_sync", null, {
      academic_year: academicYear,
      term_name: termName
    });

    res.json({ message: "Academic session finance synchronization saved successfully." });
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
      class_form = "",
      stream = "",
      learner_status = "",
      teacher_category = "",
      limit = 20
    } = req.query;
    const institutionId = req.user.institution_id;
    const normalizedTarget = cleanValue(target).toLowerCase();
    const rowLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

    const includeLearners = ["all", "learners", "learner", "grade", "stream"].includes(normalizedTarget);
    const includeTeachers = ["all", "teachers", "teacher"].includes(normalizedTarget);
    const includeParents = ["all", "parents", "parent"].includes(normalizedTarget);
    const includeBom = ["all", "bom"].includes(normalizedTarget);
    const includeInstitutions = ["all", "institutions", "institution"].includes(normalizedTarget);
    const includeUsers = ["all", "users", "user"].includes(normalizedTarget);
    const isSystemDeveloper = normalizeRole(req.user.role) === ROLES.SYSTEM_DEVELOPER;
    if (!isSystemDeveloper && ["institutions", "institution", "users", "user"].includes(normalizedTarget)) {
      return res.status(403).json({
        error: "Institutions and users search scope is restricted to System Developer."
      });
    }

    const learnerExtraWhereParts = [];
    const learnerExtraParams = [];
    if (cleanValue(grade)) {
      learnerExtraWhereParts.push(" AND grade = ?");
      learnerExtraParams.push(cleanValue(grade));
    }
    if (cleanValue(class_form)) {
      learnerExtraWhereParts.push(" AND (grade = ? OR form_name = ?)");
      learnerExtraParams.push(cleanValue(class_form), cleanValue(class_form));
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
    const sortedLearnerRows = learnerRows
      .slice()
      .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
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
    const sortedTeacherRows = teacherRows
      .slice()
      .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
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
    const sortedParentRows = parentRows
      .slice()
      .sort((a, b) => String(a.parent_full_name || "").localeCompare(String(b.parent_full_name || "")));
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
         ORDER BY full_name ASC
         LIMIT ?`,
        [institutionId, ROLES.BOM, "BOARD_OF_MANAGEMENT", cleanValue(q), cleanValue(q), cleanValue(q), cleanValue(q), cleanValue(q), rowLimit]
      )
      : [];
    const institutionRows = includeInstitutions
      ? (isSystemDeveloper
        ? await query(
          `SELECT id, institution_name, institution_code, county, NULL AS category, email, phone, is_active, created_at
           FROM institutions
           WHERE ? = ''
             OR institution_name LIKE CONCAT('%', ?, '%')
             OR institution_code LIKE CONCAT('%', ?, '%')
             OR county LIKE CONCAT('%', ?, '%')
             OR email LIKE CONCAT('%', ?, '%')
             OR phone LIKE CONCAT('%', ?, '%')
           ORDER BY institution_name ASC
           LIMIT ?`,
          [cleanValue(q), cleanValue(q), cleanValue(q), cleanValue(q), cleanValue(q), cleanValue(q), rowLimit]
        )
        : [])
      : [];
    const userRows = includeUsers
      ? (isSystemDeveloper
        ? await query(
          `SELECT id, institution_id, full_name, username, role, email, phone, is_active, created_at
           FROM users
           WHERE ? = ''
             OR full_name LIKE CONCAT('%', ?, '%')
             OR username LIKE CONCAT('%', ?, '%')
             OR role LIKE CONCAT('%', ?, '%')
             OR email LIKE CONCAT('%', ?, '%')
             OR phone LIKE CONCAT('%', ?, '%')
           ORDER BY full_name ASC
           LIMIT ?`,
          [cleanValue(q), cleanValue(q), cleanValue(q), cleanValue(q), cleanValue(q), cleanValue(q), rowLimit]
        )
        : [])
      : [];
    const filteredLearnerRows = normalizedTarget === "grade"
      ? sortedLearnerRows.filter((row) => cleanValue(grade) ? cleanValue(row.grade) === cleanValue(grade) : true)
      : normalizedTarget === "stream"
        ? sortedLearnerRows.filter((row) => {
          const streamMatches = cleanValue(stream) ? cleanValue(row.stream) === cleanValue(stream) : true;
          const gradeMatches = cleanValue(grade) ? cleanValue(row.grade) === cleanValue(grade) : true;
          return streamMatches && gradeMatches;
        })
        : sortedLearnerRows;

    res.json({
      filters_applied: {
        target: normalizedTarget || "all",
        grade: cleanValue(grade) || null,
        class_form: cleanValue(class_form) || null,
        stream: cleanValue(stream) || null,
        learner_status: cleanValue(learner_status) || null,
        teacher_category: cleanValue(teacher_category) || null,
        limit: rowLimit
      },
      totals: {
        learners: filteredLearnerRows.length,
        teachers: sortedTeacherRows.length,
        parents: sortedParentRows.length,
        bom: bomRows.length,
        institutions: institutionRows.length,
        users: userRows.length
      },
      learners: filteredLearnerRows,
      teachers: sortedTeacherRows,
      parents: sortedParentRows,
      bom: bomRows,
      institutions: institutionRows,
      users: userRows,
      parentsAndBom: [...sortedParentRows, ...bomRows]
    });
  })
);

app.get(
  "/api/users",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    if (normalizeRole(req.user.role) === ROLES.SYSTEM_DEVELOPER) {
      const users = await query(
        `SELECT id, institution_id, full_name, username, role, email, phone, is_active, created_at
         FROM users
         ORDER BY institution_id ASC, id DESC`
      );
      return res.json(users);
    }
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
  accountMutationRateLimit,
  accountMutationCooldown,
  enforceModuleAccess(MODULE_KEYS.REGISTRATION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const { full_name, username, role, email, phone } = req.body;
    if (!full_name || !username || !role) {
      return res.status(400).json({ error: "full_name, username, and role are required." });
    }
    if (!cleanOptionalValue(email) && !cleanOptionalValue(phone)) {
      return res.status(400).json({ error: "Either email or phone is required." });
    }
    const password = generateStrongPassword(12);
    const weakPasswordError = requireStrongPassword(password, "password");
    if (weakPasswordError) {
      return res.status(400).json({ error: weakPasswordError });
    }
    const usernameValidationError = validateUsername(username, "username");
    if (usernameValidationError) {
      return res.status(400).json({ error: usernameValidationError });
    }
    const normalizedRole = normalizeRole(role);
    if (!PUBLIC_ROLE_OPTIONS.includes(normalizedRole)) {
      return res.status(400).json({
        error: `role must be one of: ${PUBLIC_ROLE_OPTIONS.join(", ")}`
      });
    }
    const assignableRoles = getAssignableRolesForActor(req.user);
    if (!assignableRoles.includes(normalizedRole)) {
      return res.status(403).json({
        error:
          "You are not allowed to register this role. HoI/Administrator can only register users for their institution and cannot create System Developer, MoE, or TSC users."
      });
    }
    const roleCapacity = await checkSystemDeveloperAccountCapacity(normalizedRole);
    if (!roleCapacity.allowed) {
      return res.status(409).json({
        error: `System Developer registration limit reached. Maximum allowed is ${roleCapacity.max}.`,
        current_total: roleCapacity.total,
        max_allowed: roleCapacity.max
      });
    }
    const passwordHash = await hashPassword(password);
    const isRotationExempt = PASSWORD_ROTATION_EXEMPT_ROLES.has(normalizedRole);
    const targetInstitutionId =
      normalizeRole(req.user.role) === ROLES.SYSTEM_DEVELOPER
        ? Number(req.body?.institution_id || req.user.institution_id)
        : req.user.institution_id;
    if (!targetInstitutionId) {
      return res.status(400).json({ error: "institution_id is required for this operation." });
    }
    const existingUser = await query(
      "SELECT id FROM users WHERE institution_id = ? AND username = ? LIMIT 1",
      [targetInstitutionId, username]
    );
    if (existingUser.length) {
      return res.status(409).json({ error: "Username already exists for this institution." });
    }
    const result = await query(
      `INSERT INTO users
        (institution_id, full_name, username, password_hash, password_last_changed_at, password_expires_at, role, email, phone, is_active, created_by)
       VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, 1, ?)`,
      [
        targetInstitutionId,
        full_name,
        username,
        passwordHash,
        isRotationExempt ? null : dayjs().add(PASSWORD_ROTATION_DAYS, "day").format("YYYY-MM-DD HH:mm:ss"),
        normalizedRole,
        email || null,
        phone || null,
        req.user.id
      ]
    );
    await auditLog(req.user, "CREATE_USER", "users", result.insertId, {
      username,
      role: normalizedRole,
      institution_id: targetInstitutionId
    });
    const credentialMessage = [
      "WELCOME TO INTEGRATED MANAGEMENT INFORMATION SYSTEM (IMIS).",
      "Your user account has been created.",
      `Username: ${username}`,
      `Temporary Password: ${password}`,
      "",
      "Please change this password immediately after first login."
    ].join("\n");
    const credentialDispatch = await dispatchCredentialNotice({
      email: cleanOptionalValue(email),
      phone: cleanOptionalValue(phone),
      subject: "IMIS User Account Credentials",
      message: credentialMessage
    });
    res.status(201).json({
      id: result.insertId,
      message: "User created successfully.",
      credential_dispatch: credentialDispatch,
      generated_password: normalizeRole(req.user.role) === ROLES.SYSTEM_DEVELOPER ? password : null
    });
  })
);

app.get(
  "/api/institutions/:id/agreement-template",
  auth,
  enforceModuleAccess(MODULE_KEYS.REGISTRATION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    const institution = await loadInstitutionAgreementContext(institutionId);
    const accessError = assertInstitutionAgreementAccess(req, institution);
    if (accessError) return res.status(accessError.status).json({ error: accessError.error });
    res.json({
      institution_id: institution.id,
      agreement_template_text: institution.agreement_template_text || "",
      agreement_template_file_url: institution.agreement_template_file_url || ""
    });
  })
);

app.put(
  "/api/institutions/:id/agreement-template",
  auth,
  accountMutationRateLimit,
  accountMutationCooldown,
  enforceModuleAccess(MODULE_KEYS.REGISTRATION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    const institution = await loadInstitutionAgreementContext(institutionId);
    const accessError = assertInstitutionAgreementAccess(req, institution);
    if (accessError) return res.status(accessError.status).json({ error: accessError.error });
    const templateText = cleanOptionalValue(req.body?.agreement_template_text);
    const templateFileUrl = cleanOptionalValue(req.body?.agreement_template_file_url);
    await query(
      `UPDATE institutions
       SET agreement_template_text = ?, agreement_template_file_url = ?
       WHERE id = ?`,
      [templateText, templateFileUrl, institutionId]
    );
    await auditLog(req.user, "UPSERT_AGREEMENT_TEMPLATE", "institutions", institutionId, {
      has_template_text: Boolean(templateText),
      has_template_file_url: Boolean(templateFileUrl)
    });
    res.json({ message: "Agreement template saved successfully." });
  })
);

app.delete(
  "/api/institutions/:id/agreement-template",
  auth,
  accountMutationRateLimit,
  accountMutationCooldown,
  enforceModuleAccess(MODULE_KEYS.REGISTRATION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    const institution = await loadInstitutionAgreementContext(institutionId);
    const accessError = assertInstitutionAgreementAccess(req, institution);
    if (accessError) return res.status(accessError.status).json({ error: accessError.error });
    await query(
      `UPDATE institutions
       SET agreement_template_text = NULL, agreement_template_file_url = NULL
       WHERE id = ?`,
      [institutionId]
    );
    await auditLog(req.user, "DELETE_AGREEMENT_TEMPLATE", "institutions", institutionId, {});
    res.json({ message: "Agreement template deleted successfully." });
  })
);

app.patch(
  "/api/institutions/:id/status",
  auth,
  accountMutationRateLimit,
  accountMutationCooldown,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    const { is_active, is_suspended, status_reason } = req.body || {};
    if (!institutionId) {
      return res.status(400).json({ error: "Valid institution id is required." });
    }
    const institutions = await query(
      `SELECT id, institution_name, institution_code
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [institutionId]
    );
    if (!institutions.length) {
      return res.status(404).json({ error: "Institution not found." });
    }
    if (!canManageAcrossInstitutions(req.user) && Number(req.user.institution_id) !== institutionId) {
      return res.status(403).json({ error: "You can only manage institution status within your own institution." });
    }
    const normalizedRole = normalizeRole(req.user.role);
    if (normalizedRole !== ROLES.SYSTEM_DEVELOPER && Number(is_active) === 0) {
      return res.status(403).json({ error: "Only System Developer can deactivate an institution." });
    }
    const nextActive = Number(typeof is_active === "boolean" || typeof is_active === "number" ? is_active : 1) === 1 ? 1 : 0;
    const nextSuspended = Number(typeof is_suspended === "boolean" || typeof is_suspended === "number" ? is_suspended : 0) === 1 ? 1 : 0;
    const reason = cleanOptionalValue(status_reason);
    await query(
      `UPDATE institutions
       SET is_active = ?, is_suspended = ?, status_reason = ?, status_updated_at = NOW(), status_updated_by_user_id = ?
       WHERE id = ?`,
      [nextActive, nextSuspended, reason, req.user.id, institutionId]
    );
    await auditLog(req.user, "CHANGE_INSTITUTION_STATUS", "institutions", institutionId, {
      is_active: nextActive,
      is_suspended: nextSuspended,
      status_reason: reason
    });
    res.json({ message: "Institution status updated successfully." });
  })
);

app.patch(
  "/api/users/:id/status",
  auth,
  accountMutationRateLimit,
  accountMutationCooldown,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const { is_active } = req.body;
    const userId = Number(req.params.id);
    const normalizedRequesterRole = normalizeRole(req.user.role);
    const users = await query(
      `SELECT id, institution_id, username
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (!users.length) {
      return res.status(404).json({ error: "User account not found." });
    }
    if (normalizedRequesterRole !== ROLES.SYSTEM_DEVELOPER && users[0].institution_id !== req.user.institution_id) {
      return res.status(403).json({ error: "You can only change user status within your institution." });
    }
    await query("UPDATE users SET is_active = ? WHERE id = ?", [Number(Boolean(is_active)), userId]);
    await auditLog(req.user, "CHANGE_USER_STATUS", "users", req.params.id, { is_active });
    res.json({ message: "User status updated." });
  })
);

app.patch(
  "/api/users/:id/password",
  auth,
  accountMutationRateLimit,
  accountMutationCooldown,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    const autoGeneratePassword = parseTruthy(req.body?.auto_generate_password);
    const requestedPassword = cleanValue(req.body?.new_password);
    const newPassword = autoGeneratePassword ? generateStrongPassword(12) : requestedPassword;
    if (!newPassword) {
      return res.status(400).json({ error: "new_password is required unless auto_generate_password is true." });
    }
    const weakNewPasswordError = requireStrongPassword(newPassword, "new_password");
    if (weakNewPasswordError) {
      return res.status(400).json({ error: weakNewPasswordError });
    }

    const users = await query(
      `SELECT id, institution_id, username, email, phone
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (!users.length) {
      return res.status(404).json({ error: "User account not found." });
    }
    const normalizedRequesterRole = normalizeRole(req.user.role);
    if (normalizedRequesterRole !== ROLES.SYSTEM_DEVELOPER && users[0].institution_id !== req.user.institution_id) {
      return res.status(403).json({ error: "You can only reset user passwords within your institution." });
    }

    const passwordHash = await hashPassword(newPassword);
    await query(
      `UPDATE users
       SET password_hash = ?,
           password_last_changed_at = NOW(),
           password_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY),
           must_change_password = 1,
           failed_login_attempts = 0,
           locked_until = NULL,
           last_failed_login_at = NULL
       WHERE id = ?`,
      [passwordHash, PASSWORD_ROTATION_DAYS, userId]
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

app.delete(
  "/api/users/:id",
  auth,
  accountMutationRateLimit,
  accountMutationCooldown,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN]),
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId) {
      return res.status(400).json({ error: "Valid user id is required." });
    }
    if (Number(req.user.id) === userId) {
      return res.status(400).json({ error: "You cannot delete your own account." });
    }
    const users = await query(
      `SELECT id, institution_id, username, role
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (!users.length) {
      return res.status(404).json({ error: "User account not found." });
    }
    const targetUser = users[0];
    const requesterRole = normalizeRole(req.user.role);
    if (requesterRole !== ROLES.SYSTEM_DEVELOPER && targetUser.institution_id !== req.user.institution_id) {
      return res.status(403).json({ error: "You can only delete users within your institution." });
    }
    if (requesterRole !== ROLES.SYSTEM_DEVELOPER && normalizeRole(targetUser.role) === ROLES.SYSTEM_DEVELOPER) {
      return res.status(403).json({ error: "Only the System Developer can delete this account." });
    }
    await archiveRecycleBinItem({
      institutionId: targetUser.institution_id,
      entityName: "users",
      entityId: targetUser.id,
      payload: targetUser,
      deletedByUserId: req.user.id
    });
    await query("DELETE FROM users WHERE id = ?", [userId]);
    await auditLog(req.user, "DELETE_USER", "users", userId, {
      username: targetUser.username,
      role: targetUser.role
    });
    res.json({ message: "User deleted successfully." });
  })
);

app.post(
  "/api/finance/payroll/auto-generate",
  auth,
  enforceModuleAccess(MODULE_KEYS.FINANCE_PAYROLL),
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const payrollMonth = cleanValue(req.body?.payroll_month) || dayjs().format("MMMM");
    const payrollYear = Number(req.body?.payroll_year || dayjs().year());
    const basicSalary = Number(req.body?.basic_salary || 0);
    const allowances = Number(req.body?.allowances || 0);
    const deductions = Number(req.body?.deductions || 0);
    const paymentStatus = cleanValue(req.body?.payment_status) || "Pending";
    const paymentDate = cleanOptionalValue(req.body?.payment_date) || null;
    const remarks = cleanOptionalValue(req.body?.remarks);
    const netSalary = basicSalary + allowances - deductions;

    const teachers = await query(
      `SELECT id, full_name, tsc_number staff_number, id_number
       FROM teacher_profiles
       WHERE institution_id = ?`,
      [req.user.institution_id]
    );
    const nonTeaching = await query(
      `SELECT id, full_name, staff_number, id_number
       FROM non_teaching_staff_profiles
       WHERE institution_id = ?`,
      [req.user.institution_id]
    );
    const records = [
      ...teachers.map((row) => ({ ...row, staff_profile_type: "Teacher" })),
      ...nonTeaching.map((row) => ({ ...row, staff_profile_type: "Non-Teaching Staff" }))
    ];
    if (!records.length) {
      return res.status(400).json({ error: "No teacher or non-teaching staff records found for payroll generation." });
    }

    for (const item of records) {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `INSERT INTO finance_payroll_records
          (institution_id, staff_profile_type, staff_profile_id, staff_name, staff_number, id_number, payroll_month, payroll_year,
           basic_salary, allowances, deductions, net_salary, payment_status, payment_date, remarks, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.institution_id,
          item.staff_profile_type,
          item.id,
          item.full_name,
          item.staff_number || null,
          item.id_number || null,
          payrollMonth,
          payrollYear,
          basicSalary,
          allowances,
          deductions,
          netSalary,
          paymentStatus,
          paymentDate,
          remarks,
          req.user.id
        ]
      );
    }

    await auditLog(req.user, "AUTO_GENERATE_PAYROLL", "finance_payroll_records", null, {
      payroll_month: payrollMonth,
      payroll_year: payrollYear,
      generated_count: records.length
    });
    res.status(201).json({
      message: "Payroll records auto-generated.",
      generated_count: records.length,
      payroll_month: payrollMonth,
      payroll_year: payrollYear
    });
  })
);

app.post(
  "/api/finance/salary-advances/auto-process",
  auth,
  enforceModuleAccess(MODULE_KEYS.FINANCE_SALARY_ADVANCE),
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.NON_TEACHING_STAFF]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const requestId = Number(req.body?.request_id);
    if (!requestId) {
      return res.status(400).json({ error: "request_id is required." });
    }
    const decision = cleanValue(req.body?.decision).toLowerCase();
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ error: "decision must be approve or reject." });
    }
    const amountApproved = Number(req.body?.amount_approved || 0);
    const deductionPlan = cleanOptionalValue(req.body?.deduction_plan);
    const rows = await query(
      `SELECT id, institution_id, staff_name, amount_requested, approval_status
       FROM finance_salary_advances
       WHERE id = ? AND institution_id = ?
       LIMIT 1`,
      [requestId, req.user.institution_id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Salary advance request not found." });
    }
    const target = rows[0];
    if (target.approval_status === "Approved" || target.approval_status === "Rejected") {
      return res.status(409).json({ error: "Salary advance request already processed." });
    }

    const approvalStatus = decision === "approve" ? "Approved" : "Rejected";
    const approvedAmount = decision === "approve" ? (amountApproved > 0 ? amountApproved : Number(target.amount_requested || 0)) : 0;
    await query(
      `UPDATE finance_salary_advances
       SET approval_status = ?,
           approved_by_user_id = ?,
           approved_at = NOW(),
           amount_approved = ?,
           processing_status = ?,
           processed_date = ?,
           repayment_status = ?,
           deduction_plan = ?,
           updated_at = NOW()
       WHERE id = ? AND institution_id = ?`,
      [
        approvalStatus,
        req.user.id,
        approvedAmount,
        decision === "approve" ? "Processed" : "Declined",
        decision === "approve" ? dayjs().format("YYYY-MM-DD HH:mm:ss") : null,
        decision === "approve" ? "In Progress" : "Not Applicable",
        deductionPlan,
        requestId,
        req.user.institution_id
      ]
    );
    await auditLog(req.user, "PROCESS_SALARY_ADVANCE", "finance_salary_advances", requestId, {
      decision,
      approved_amount: approvedAmount
    });
    res.json({
      message: `Salary advance ${decision === "approve" ? "approved" : "rejected"} successfully.`,
      request_id: requestId,
      staff_name: target.staff_name,
      approval_status: approvalStatus,
      amount_approved: approvedAmount
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

    const actionKey = cleanValue(req.body?.action_key).toUpperCase() || "ACCESS";
    await query(
      `INSERT INTO user_module_access_overrides (institution_id, user_id, module_key, permission_key, can_access, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [targetUser.institution_id, userId, moduleKey, actionKey, Number(canAccess), req.user.id]
    );

    await auditLog(req.user, "MODULE_ACCESS_OVERRIDE", "user_module_access_overrides", userId, {
      module_key: moduleKey,
      action_key: actionKey,
      can_access: canAccess
    });

    res.json({
      message: "Module access override saved.",
      user_id: userId,
      module_key: moduleKey,
      action_key: actionKey,
      can_access: canAccess
    });
  })
);

app.post(
  "/api/users/module-access/bulk",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const userId = Number(req.body?.user_id);
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!userId || !entries.length) {
      return res.status(400).json({ error: "user_id and entries are required." });
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
    const normalizedEntries = entries
      .map((item) => ({
        module_key: cleanValue(item?.module_key),
        permission_key: cleanValue(item?.action_key || item?.permission_key || "ACCESS").toUpperCase(),
        can_access: parseTruthy(item?.can_access)
      }))
      .filter((item) => item.module_key);
    if (!normalizedEntries.length) {
      return res.status(400).json({ error: "No valid module access entries provided." });
    }
    for (const entry of normalizedEntries) {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `INSERT INTO user_module_access_overrides
          (institution_id, user_id, module_key, permission_key, can_access, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [targetUser.institution_id, userId, entry.module_key, entry.permission_key, Number(entry.can_access), req.user.id]
      );
    }
    await auditLog(req.user, "MODULE_ACCESS_BULK_OVERRIDE", "user_module_access_overrides", userId, {
      entries: normalizedEntries.length
    });
    res.json({ message: "Module access matrix saved successfully.", user_id: userId, entries: normalizedEntries.length });
  })
);

app.get(
  "/api/system/module-access/overrides",
  auth,
  enforceModuleAccess(MODULE_KEYS.ACCESS_CONTROL),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const userId = Number(req.query?.user_id || 0);
    if (!userId) {
      return res.status(400).json({ error: "user_id query parameter is required." });
    }
    const users = await query(
      `SELECT id, institution_id, full_name, username, role
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (!users.length) {
      return res.status(404).json({ error: "Target user not found." });
    }
    const targetUser = users[0];
    if (!canManageAcrossInstitutions(req.user) && targetUser.institution_id !== req.user.institution_id) {
      return res.status(403).json({ error: "Cannot view module overrides for users outside your institution." });
    }
    const overrides = await query(
      `SELECT id, institution_id, user_id, module_key, permission_key, can_access, created_by_user_id, created_at
       FROM user_module_access_overrides
       WHERE user_id = ?
       ORDER BY id DESC`,
      [userId]
    );
    res.json({ user: targetUser, overrides });
  })
);

app.get(
  "/api/system/audit-logs",
  auth,
  enforceModuleAccess(MODULE_KEYS.SECURITY_AUDIT),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query?.limit || 200), 1), 1000);
    const institutionScope = canManageAcrossInstitutions(req.user)
      ? Number(req.query?.institution_id || 0)
      : req.user.institution_id;
    const whereClause = institutionScope ? "WHERE institution_id = ?" : "";
    const params = institutionScope ? [institutionScope] : [];
    const logs = await query(
      `SELECT id, institution_id, actor_user_id, actor_role, action, entity_name, entity_id, details_json, created_at
       FROM activity_logs
       ${whereClause}
       ORDER BY id DESC
       LIMIT ?`,
      [...params, limit]
    );
    const normalizedLogs = logs.map((row) => {
      const details = parseStoredJson(row.details_json) || {};
      return {
        ...row,
        username: cleanValue(details.username || details.user_name) || null,
        password_correct: parseTruthy(details.password_correct),
        otp_correct: parseTruthy(details.otp_correct),
        ip_address: cleanValue(details.ip_address) || null,
        machine_name: cleanValue(details.machine_name) || null,
        user_agent: cleanValue(details.user_agent) || null,
        login_time: normalizeDateTime(details.login_time || details.request_time) || normalizeDateTime(row.created_at),
        logout_time: normalizeDateTime(details.logout_time) || null,
        activity_done: cleanValue(details.activity_done || details.action_note || row.action) || row.action,
        details_json: details
      };
    });
    const [failedLoginsRow] = await query(
      `SELECT COUNT(*) total
       FROM activity_logs
       ${whereClause ? `${whereClause} AND` : "WHERE"} action IN ('LOGIN_FAILED', 'ACCOUNT_LOCKED')
       AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      params
    );
    const [otpFailuresRow] = await query(
      `SELECT COUNT(*) total
       FROM activity_logs
       ${whereClause ? `${whereClause} AND` : "WHERE"} action IN ('OTP_VERIFY_FAILED', 'OTP_EXHAUSTED')
       AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      params
    );
    res.json({
      logs: normalizedLogs,
      metrics: {
        failed_login_events_24h: Number(failedLoginsRow?.total || 0),
        otp_fail_events_24h: Number(otpFailuresRow?.total || 0)
      }
    });
  })
);

app.get(
  "/api/system/registry",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutions = canManageAcrossInstitutions(req.user)
      ? await query(
        `SELECT id, institution_name, institution_code, email, phone, county, created_at
         FROM institutions
         ORDER BY id DESC`
      )
      : await query(
        `SELECT id, institution_name, institution_code, email, phone, county, created_at
         FROM institutions
         WHERE id = ?
         ORDER BY id DESC`,
        [req.user.institution_id]
      );
    const users = canManageAcrossInstitutions(req.user)
      ? await query(
        `SELECT id, institution_id, full_name, username, role, email, phone, is_active, created_at
         FROM users
         ORDER BY id DESC`
      )
      : await query(
        `SELECT id, institution_id, full_name, username, role, email, phone, is_active, created_at
         FROM users
         WHERE institution_id = ?
         ORDER BY id DESC`,
        [req.user.institution_id]
      );
    res.json({ institutions, users });
  })
);

app.get(
  "/api/system/registry/institutions/:id/view",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    if (!institutionId) return res.status(400).json({ error: "Valid institution id is required." });
    const rows = await query(
      `SELECT id, institution_name, institution_code, email, phone, county, sub_county, location, village,
              postal_address, is_active, is_suspended, status_reason, suspended_reason, created_at
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [institutionId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Institution not found." });
    }
    const institution = rows[0];
    if (!canManageAcrossInstitutions(req.user) && institution.id !== req.user.institution_id) {
      return res.status(403).json({ error: "You can only view institutions in your scope." });
    }
    res.json({ institution });
  })
);

app.patch(
  "/api/system/registry/institutions/:id",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    if (!institutionId) return res.status(400).json({ error: "Valid institution id is required." });
    const rows = await query("SELECT id, institution_name, email, phone FROM institutions WHERE id = ? LIMIT 1", [institutionId]);
    if (!rows.length) return res.status(404).json({ error: "Institution not found." });
    if (!canManageAcrossInstitutions(req.user) && institutionId !== req.user.institution_id) {
      return res.status(403).json({ error: "You can only edit institutions in your scope." });
    }
    const institution_name = cleanOptionalValue(req.body?.institution_name);
    const email = cleanOptionalValue(req.body?.email);
    const phone = cleanOptionalValue(req.body?.phone);
    await query(
      `UPDATE institutions
       SET institution_name = COALESCE(?, institution_name),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone)
       WHERE id = ?`,
      [institution_name, email, phone, institutionId]
    );
    await auditLog(req.user, "UPDATE_REGISTRY_INSTITUTION", "institutions", institutionId, {
      institution_name,
      email,
      phone
    });
    res.json({ message: "Institution saved successfully." });
  })
);

app.patch(
  "/api/system/registry/institutions/:id/status",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    if (!institutionId) return res.status(400).json({ error: "Valid institution id is required." });
    const rows = await query("SELECT id FROM institutions WHERE id = ? LIMIT 1", [institutionId]);
    if (!rows.length) return res.status(404).json({ error: "Institution not found." });
    if (!canManageAcrossInstitutions(req.user) && institutionId !== req.user.institution_id) {
      return res.status(403).json({ error: "You can only change status for your institution." });
    }
    const isActive = req.body?.is_active;
    const isSuspended = req.body?.is_suspended;
    const reason = cleanOptionalValue(req.body?.reason) || null;
    await query(
      `UPDATE institutions
       SET is_active = COALESCE(?, is_active),
           is_suspended = COALESCE(?, is_suspended),
           status_reason = CASE WHEN ? IS NOT NULL AND ? = 0 THEN ? ELSE status_reason END,
           suspended_reason = CASE WHEN ? IS NOT NULL AND ? = 1 THEN ? ELSE suspended_reason END
       WHERE id = ?`,
      [
        isActive === undefined ? null : Number(Boolean(isActive)),
        isSuspended === undefined ? null : Number(Boolean(isSuspended)),
        reason,
        isActive === undefined ? null : Number(Boolean(isActive)),
        reason,
        reason,
        isSuspended === undefined ? null : Number(Boolean(isSuspended)),
        reason,
        institutionId
      ]
    );
    await auditLog(req.user, "CHANGE_INSTITUTION_STATUS", "institutions", institutionId, {
      is_active: isActive,
      is_suspended: isSuspended,
      reason
    });
    res.json({ message: "Institution status updated." });
  })
);

app.delete(
  "/api/system/registry/institutions/:id",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    if (!institutionId) return res.status(400).json({ error: "Valid institution id is required." });
    if (institutionId === Number(req.user.institution_id)) {
      return res.status(400).json({ error: "You cannot delete your own active institution." });
    }
    const institutions = await query(
      `SELECT *
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [institutionId]
    );
    if (!institutions.length) return res.status(404).json({ error: "Institution not found." });
    const institution = institutions[0];
    const users = await query("SELECT * FROM users WHERE institution_id = ?", [institutionId]);
    await archiveRecycleBinItem({
      institutionId,
      entityName: "institutions",
      entityId: institutionId,
      payload: {
        ...institution,
        __cascade_users: users
      },
      deletedByUserId: req.user.id
    });
    await query("DELETE FROM users WHERE institution_id = ?", [institutionId]);
    await query("DELETE FROM institutions WHERE id = ?", [institutionId]);
    await auditLog(req.user, "DELETE_INSTITUTION", "institutions", institutionId, {
      institution_code: institution.institution_code,
      users_deleted: users.length
    });
    res.json({ message: "Institution moved to recycle bin successfully." });
  })
);

app.get(
  "/api/system/registry/users/:id/view",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json({ error: "Valid user id is required." });
    const rows = await query(
      `SELECT id, institution_id, full_name, username, role, email, phone, is_active, is_suspended,
              status_reason, suspended_reason, created_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found." });
    const user = rows[0];
    if (!canManageAcrossInstitutions(req.user) && user.institution_id !== req.user.institution_id) {
      return res.status(403).json({ error: "You can only view users in your scope." });
    }
    res.json({ user });
  })
);

app.patch(
  "/api/system/registry/users/:id",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json({ error: "Valid user id is required." });
    const rows = await query(
      `SELECT id, institution_id
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found." });
    const target = rows[0];
    if (!canManageAcrossInstitutions(req.user) && target.institution_id !== req.user.institution_id) {
      return res.status(403).json({ error: "You can only edit users in your institution." });
    }
    const full_name = cleanOptionalValue(req.body?.full_name);
    const email = cleanOptionalValue(req.body?.email);
    const phone = cleanOptionalValue(req.body?.phone);
    await query(
      `UPDATE users
       SET full_name = COALESCE(?, full_name),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone)
       WHERE id = ?`,
      [full_name, email, phone, userId]
    );
    await auditLog(req.user, "UPDATE_REGISTRY_USER", "users", userId, {
      full_name,
      email,
      phone
    });
    res.json({ message: "User saved successfully." });
  })
);

app.patch(
  "/api/system/registry/users/:id/status",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    if (!userId) return res.status(400).json({ error: "Valid user id is required." });
    const rows = await query(
      `SELECT id, institution_id, role
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found." });
    const target = rows[0];
    if (!canManageAcrossInstitutions(req.user) && target.institution_id !== req.user.institution_id) {
      return res.status(403).json({ error: "You can only change status for users in your institution." });
    }
    const isActive = req.body?.is_active;
    const isSuspended = req.body?.is_suspended;
    const reason = cleanOptionalValue(req.body?.reason) || null;
    await query(
      `UPDATE users
       SET is_active = COALESCE(?, is_active),
           is_suspended = COALESCE(?, is_suspended),
           status_reason = CASE WHEN ? IS NOT NULL AND ? = 0 THEN ? ELSE status_reason END,
           suspended_reason = CASE WHEN ? IS NOT NULL AND ? = 1 THEN ? ELSE suspended_reason END
       WHERE id = ?`,
      [
        isActive === undefined ? null : Number(Boolean(isActive)),
        isSuspended === undefined ? null : Number(Boolean(isSuspended)),
        reason,
        isActive === undefined ? null : Number(Boolean(isActive)),
        reason,
        reason,
        isSuspended === undefined ? null : Number(Boolean(isSuspended)),
        reason,
        userId
      ]
    );
    await auditLog(req.user, "CHANGE_REGISTRY_USER_STATUS", "users", userId, {
      is_active: isActive,
      is_suspended: isSuspended,
      reason
    });
    res.json({ message: "User status updated." });
  })
);

app.get(
  "/api/system/recycle-bin",
  auth,
  enforceModuleAccess(MODULE_KEYS.RECYCLE_BIN),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query?.limit || 200), 1), 1000);
    const statusFilter = cleanValue(req.query?.status).toUpperCase();
    const institutionScope = canManageAcrossInstitutions(req.user)
      ? Number(req.query?.institution_id || 0)
      : req.user.institution_id;
    let sql = `SELECT id, institution_id, entity_name, entity_id, archived_payload_json, deleted_by_user_id, deleted_at,
                      restored_at, restored_by_user_id, permanently_deleted_at, permanently_deleted_by_user_id, status
               FROM recycle_bin_items
               WHERE 1=1`;
    const params = [];
    if (institutionScope) {
      sql += " AND institution_id = ?";
      params.push(institutionScope);
    }
    if (statusFilter) {
      sql += " AND status = ?";
      params.push(statusFilter);
    }
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(limit);
    const items = await query(sql, params);
    res.json({ items });
  })
);

app.post(
  "/api/system/recycle-bin/:id/restore",
  auth,
  enforceModuleAccess(MODULE_KEYS.RECYCLE_BIN),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const recycleId = Number(req.params.id);
    if (!recycleId) return res.status(400).json({ error: "Valid recycle bin item id is required." });
    const rows = await query(
      `SELECT *
       FROM recycle_bin_items
       WHERE id = ?
       LIMIT 1`,
      [recycleId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Recycle bin item not found." });
    }
    const item = rows[0];
    if (!canManageAcrossInstitutions(req.user) && item.institution_id !== req.user.institution_id) {
      return res.status(403).json({ error: "You can only restore items from your institution." });
    }
    if (cleanValue(item.status).toUpperCase() !== "TRASHED") {
      return res.status(409).json({ error: "Only trashed items can be restored." });
    }
    const entityName = cleanValue(item.entity_name);
    if (!isSafeTableIdentifier(entityName)) {
      return res.status(400).json({ error: "Stored entity cannot be restored safely." });
    }
    const columns = await getTableColumns(entityName);
    if (!columns.length) {
      return res.status(404).json({ error: "Target table no longer exists; cannot restore item." });
    }
    const payload = parseStoredJson(item.archived_payload_json);
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Archived payload is invalid and cannot be restored." });
    }
    const insertPayload = columns.reduce((acc, column) => {
      if (Object.prototype.hasOwnProperty.call(payload, column)) {
        acc[column] = payload[column];
      }
      return acc;
    }, {});
    if (!Object.keys(insertPayload).length) {
      return res.status(400).json({ error: "No matching columns found for restoration." });
    }
    const restoredRecordId = Number(insertPayload.id || item.entity_id || 0);
    if (restoredRecordId) {
      const existing = await query(`SELECT id FROM ${entityName} WHERE id = ? LIMIT 1`, [restoredRecordId]);
      if (existing.length) {
        return res.status(409).json({ error: "A record with this ID already exists. Cannot restore." });
      }
    }
    const insertColumns = Object.keys(insertPayload);
    const placeholders = insertColumns.map(() => "?").join(", ");
    await query(
      `INSERT INTO ${entityName} (${insertColumns.join(", ")})
       VALUES (${placeholders})`,
      insertColumns.map((column) => insertPayload[column])
    );
    await query(
      `UPDATE recycle_bin_items
       SET status = 'RESTORED',
           restored_at = NOW(),
           restored_by_user_id = ?
       WHERE id = ?`,
      [req.user.id, recycleId]
    );
    await auditLog(req.user, "RESTORE_RECYCLE_BIN_ITEM", "recycle_bin_items", recycleId, {
      entity_name: entityName,
      entity_id: item.entity_id
    });
    res.json({
      message: "Recycle bin item restored successfully.",
      recycle_bin_id: recycleId,
      entity_name: entityName,
      restored_record_id: restoredRecordId || null
    });
  })
);

app.delete(
  "/api/system/recycle-bin/:id",
  auth,
  enforceModuleAccess(MODULE_KEYS.RECYCLE_BIN),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.DELETE),
  asyncHandler(async (req, res) => {
    const recycleId = Number(req.params.id);
    if (!recycleId) return res.status(400).json({ error: "Valid recycle bin item id is required." });
    const rows = await query(
      `SELECT id, institution_id, status, entity_name, entity_id
       FROM recycle_bin_items
       WHERE id = ?
       LIMIT 1`,
      [recycleId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Recycle bin item not found." });
    }
    const item = rows[0];
    if (!canManageAcrossInstitutions(req.user) && item.institution_id !== req.user.institution_id) {
      return res.status(403).json({ error: "You can only purge items from your institution." });
    }
    await query(
      `UPDATE recycle_bin_items
       SET status = 'DELETED',
           permanently_deleted_at = NOW(),
           permanently_deleted_by_user_id = ?
       WHERE id = ?`,
      [req.user.id, recycleId]
    );
    await auditLog(req.user, "PURGE_RECYCLE_BIN_ITEM", "recycle_bin_items", recycleId, {
      entity_name: item.entity_name,
      entity_id: item.entity_id
    });
    res.json({ message: "Recycle bin item permanently marked as deleted.", recycle_bin_id: recycleId });
  })
);

app.get(
  "/api/cbc/curriculum",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await getPaginatedRows({
      table: "cbc_curriculum_entries",
      institutionId: req.user.institution_id,
      searchFields: ["grade", "learning_area", "strand", "sub_strand", "term", "year"],
      q: req.query.q || "",
      limit: req.query.limit || 200,
      offset: req.query.offset || 0
    });
    res.json(rows);
  })
);

app.get(
  "/api/cbc/curriculum/:id(\\d+)",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT *
       FROM cbc_curriculum_entries
       WHERE id = ? AND institution_id = ?
       LIMIT 1`,
      [req.params.id, req.user.institution_id]
    );
    if (!rows.length) return res.status(404).json({ error: "Curriculum entry not found." });
    res.json(rows[0]);
  })
);

app.post(
  "/api/cbc/curriculum",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const data = pickFields(req.body, [
      "grade",
      "form_name",
      "learning_area",
      "strand",
      "sub_strand",
      "specific_learning_outcomes",
      "key_inquiry_questions",
      "suggested_assessment_rubric",
      "learning_experiences",
      "resources_reference",
      "term",
      "year",
      "notes"
    ]);
    if ((!cleanValue(data.grade) && !cleanValue(data.form_name)) || !cleanValue(data.learning_area) || !cleanValue(data.strand)) {
      return res.status(400).json({ error: "grade or form_name, learning_area and strand are required." });
    }
    data.institution_id = req.user.institution_id;
    data.created_by_user_id = req.user.id;
    const columns = Object.keys(data);
    const placeholders = columns.map(() => "?").join(", ");
    const result = await query(
      `INSERT INTO cbc_curriculum_entries (${columns.join(", ")})
       VALUES (${placeholders})`,
      columns.map((column) => data[column])
    );
    await auditLog(req.user, "CREATE_CBC_CURRICULUM_ENTRY", "cbc_curriculum_entries", result.insertId, data);
    res.status(201).json({ id: result.insertId, message: "CBC curriculum entry created." });
  })
);

app.put(
  "/api/cbc/curriculum/:id(\\d+)",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const entryId = Number(req.params.id);
    if (!entryId) return res.status(400).json({ error: "Valid curriculum entry id is required." });
    const data = pickFields(req.body, [
      "grade",
      "form_name",
      "learning_area",
      "strand",
      "sub_strand",
      "specific_learning_outcomes",
      "key_inquiry_questions",
      "suggested_assessment_rubric",
      "learning_experiences",
      "resources_reference",
      "term",
      "year",
      "notes"
    ]);
    const columns = Object.keys(data);
    if (!columns.length) {
      return res.status(400).json({ error: "No valid curriculum fields provided." });
    }
    await query(
      `UPDATE cbc_curriculum_entries
       SET ${columns.map((column) => `${column} = ?`).join(", ")}, updated_at = NOW()
       WHERE id = ? AND institution_id = ?`,
      [...columns.map((column) => data[column]), entryId, req.user.institution_id]
    );
    await auditLog(req.user, "UPDATE_CBC_CURRICULUM_ENTRY", "cbc_curriculum_entries", entryId, data);
    res.json({ message: "CBC curriculum entry updated." });
  })
);

app.delete(
  "/api/cbc/curriculum/:id(\\d+)",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.DELETE),
  asyncHandler(async (req, res) => {
    const entryId = Number(req.params.id);
    if (!entryId) return res.status(400).json({ error: "Valid curriculum entry id is required." });
    const rows = await query(
      `SELECT *
       FROM cbc_curriculum_entries
       WHERE id = ? AND institution_id = ?
       LIMIT 1`,
      [entryId, req.user.institution_id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Curriculum entry not found." });
    }
    const target = rows[0];
    await archiveRecycleBinItem({
      institutionId: req.user.institution_id,
      entityName: "cbc_curriculum_entries",
      entityId: target.id,
      payload: target,
      deletedByUserId: req.user.id
    });
    await query(
      `DELETE FROM cbc_curriculum_entries
       WHERE id = ? AND institution_id = ?`,
      [entryId, req.user.institution_id]
    );
    await auditLog(req.user, "DELETE_CBC_CURRICULUM_ENTRY", "cbc_curriculum_entries", entryId);
    res.json({ message: "CBC curriculum entry moved to recycle bin." });
  })
);

app.post(
  "/api/cbc/curriculum/ai-suggest-structure",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const grade = cleanValue(req.body?.grade);
    const formName = cleanValue(req.body?.form_name);
    const learningArea = cleanValue(req.body?.learning_area);
    if ((!grade && !formName) || !learningArea) {
      return res.status(400).json({ error: "grade or form_name and learning_area are required." });
    }
    const mappingRows = await query(
      `SELECT strand, sub_strand
       FROM cbc_structure_mappings
       WHERE institution_id = ?
         AND learning_area = ?
         AND ((? IS NULL AND grade IS NULL) OR grade = ? OR grade IS NULL OR grade = '')
         AND ((? IS NULL AND form_name IS NULL) OR form_name = ? OR form_name IS NULL OR form_name = '')
       ORDER BY strand, sub_strand`,
      [req.user.institution_id, learningArea, grade || null, grade || null, formName || null, formName || null]
    );
    const suggestion =
      buildSuggestionFromMappings({ grade, formName, learningArea, mappings: mappingRows }) ||
      buildCbcSuggestion({ grade, formName, learningArea });
    await auditLog(req.user, "GENERATE_CBC_AI_STRUCTURE", "cbc_curriculum_entries", null, {
      grade: grade || null,
      form_name: formName || null,
      learning_area: learningArea
    });
    res.json(suggestion);
  })
);

// Backward-compatible aliases for older frontend route names.
app.post(
  "/api/cbc/curriculum/ai-suggest-strands",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const grade = cleanValue(req.body?.grade);
    const formName = cleanValue(req.body?.form_name);
    const learningArea = cleanValue(req.body?.learning_area);
    if ((!grade && !formName) || !learningArea) {
      return res.status(400).json({ error: "grade or form_name and learning_area are required." });
    }
    const mappingRows = await query(
      `SELECT strand, sub_strand
       FROM cbc_structure_mappings
       WHERE institution_id = ?
         AND learning_area = ?
         AND ((? IS NULL AND grade IS NULL) OR grade = ? OR grade IS NULL OR grade = '')
         AND ((? IS NULL AND form_name IS NULL) OR form_name = ? OR form_name IS NULL OR form_name = '')
       ORDER BY strand, sub_strand`,
      [req.user.institution_id, learningArea, grade || null, grade || null, formName || null, formName || null]
    );
    const suggestion =
      buildSuggestionFromMappings({ grade, formName, learningArea, mappings: mappingRows }) ||
      buildCbcSuggestion({ grade, formName, learningArea });
    await auditLog(req.user, "GENERATE_CBC_AI_STRUCTURE", "cbc_curriculum_entries", null, {
      grade: grade || null,
      form_name: formName || null,
      learning_area: learningArea,
      endpoint_alias: "ai-suggest-strands"
    });
    res.json(suggestion);
  })
);

app.post(
  "/api/cbc/curriculum/ai-suggest-substrands",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const grade = cleanValue(req.body?.grade);
    const formName = cleanValue(req.body?.form_name);
    const learningArea = cleanValue(req.body?.learning_area);
    if ((!grade && !formName) || !learningArea) {
      return res.status(400).json({ error: "grade or form_name and learning_area are required." });
    }
    const mappingRows = await query(
      `SELECT strand, sub_strand
       FROM cbc_structure_mappings
       WHERE institution_id = ?
         AND learning_area = ?
         AND ((? IS NULL AND grade IS NULL) OR grade = ? OR grade IS NULL OR grade = '')
         AND ((? IS NULL AND form_name IS NULL) OR form_name = ? OR form_name IS NULL OR form_name = '')
       ORDER BY strand, sub_strand`,
      [req.user.institution_id, learningArea, grade || null, grade || null, formName || null, formName || null]
    );
    const suggestion =
      buildSuggestionFromMappings({ grade, formName, learningArea, mappings: mappingRows }) ||
      buildCbcSuggestion({ grade, formName, learningArea });
    await auditLog(req.user, "GENERATE_CBC_AI_STRUCTURE", "cbc_curriculum_entries", null, {
      grade: grade || null,
      form_name: formName || null,
      learning_area: learningArea,
      endpoint_alias: "ai-suggest-substrands"
    });
    res.json(suggestion);
  })
);

app.post(
  "/api/cbc/curriculum/ai-generate-notes",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const grade = cleanValue(req.body?.grade);
    const formName = cleanValue(req.body?.form_name);
    const learningArea = cleanValue(req.body?.learning_area);
    const strand = cleanValue(req.body?.strand);
    const subStrand = cleanValue(req.body?.sub_strand);
    if ((!grade && !formName) || !learningArea || !strand) {
      return res.status(400).json({ error: "grade or form_name, learning_area and strand are required." });
    }
    const mappingRows = await query(
      `SELECT strand, sub_strand
       FROM cbc_structure_mappings
       WHERE institution_id = ?
         AND learning_area = ?
         AND ((? IS NULL AND grade IS NULL) OR grade = ? OR grade IS NULL OR grade = '')
         AND ((? IS NULL AND form_name IS NULL) OR form_name = ? OR form_name IS NULL OR form_name = '')
       ORDER BY strand, sub_strand`,
      [req.user.institution_id, learningArea, grade || null, grade || null, formName || null, formName || null]
    );
    const fallbackStructure =
      buildSuggestionFromMappings({ grade, formName, learningArea, mappings: mappingRows }) ||
      buildCbcSuggestion({ grade, formName, learningArea });
    const resolvedSubStrand = subStrand || fallbackStructure.sub_strand;
    const generated = makeNotes({
      grade,
      formName,
      learningArea,
      strand,
      subStrand: resolvedSubStrand
    });
    await auditLog(req.user, "GENERATE_CBC_AI_NOTES", "cbc_curriculum_entries", null, {
      grade: grade || null,
      form_name: formName || null,
      learning_area: learningArea,
      strand,
      sub_strand: resolvedSubStrand
    });
    res.json({
      message: "AI simplified notes generated successfully.",
      generated_notes: generated,
      textbook_references: fallbackStructure.textbook_references
    });
  })
);

app.get(
  "/api/cbc/curriculum/materials",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT id, resource_type, title, description, grade, stream AS form_name, term, strand, sub_strand, file_path, created_at
       FROM teacher_resources
       WHERE institution_id = ?
       ORDER BY id DESC
       LIMIT 300`,
      [req.user.institution_id]
    );
    res.json(rows);
  })
);

app.post(
  "/api/cbc/curriculum/materials/upload",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const payload = pickFields(req.body, [
      "resource_type",
      "title",
      "description",
      "grade",
      "form_name",
      "term",
      "strand",
      "sub_strand"
    ]);
    if (!cleanValue(payload.title)) {
      payload.title = req.file?.originalname || "CBC/CBE Material";
    }
    const result = await query(
      `INSERT INTO teacher_resources
       (institution_id, teacher_profile_id, resource_type, title, description, grade, stream, term, strand, sub_strand, file_path, auto_generated, created_by_user_id)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        req.user.institution_id,
        cleanValue(payload.resource_type) || "CBC_CBE_MATERIAL_UPLOAD",
        cleanValue(payload.title),
        cleanOptionalValue(payload.description),
        cleanOptionalValue(payload.grade),
        cleanOptionalValue(payload.form_name),
        cleanOptionalValue(payload.term),
        cleanOptionalValue(payload.strand),
        cleanOptionalValue(payload.sub_strand),
        req.file ? `/uploads/${req.file.filename}` : null,
        req.user.id
      ]
    );
    await auditLog(req.user, "UPLOAD_CBC_CBE_MATERIAL", "teacher_resources", result.insertId, {
      title: cleanValue(payload.title),
      grade: cleanOptionalValue(payload.grade),
      form_name: cleanOptionalValue(payload.form_name),
      learning_area: cleanOptionalValue(req.body?.learning_area)
    });
    res.status(201).json({
      id: result.insertId,
      message: "Material uploaded successfully."
    });
  })
);

app.patch(
  "/api/cbc/curriculum/materials/:id(\\d+)",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const materialId = Number(req.params.id);
    if (!materialId) return res.status(400).json({ error: "Valid material id is required." });
    const data = pickFields(req.body, ["title", "description"]);
    const columns = Object.keys(data).filter((key) => cleanValue(data[key]) || data[key] === "");
    if (!columns.length) {
      return res.status(400).json({ error: "No editable fields provided." });
    }
    await query(
      `UPDATE teacher_resources
       SET ${columns.map((column) => `${column} = ?`).join(", ")}, updated_at = NOW()
       WHERE id = ? AND institution_id = ?`,
      [...columns.map((column) => cleanOptionalValue(data[column])), materialId, req.user.institution_id]
    );
    await auditLog(req.user, "UPDATE_CBC_CBE_MATERIAL", "teacher_resources", materialId, data);
    res.json({ message: "Material updated." });
  })
);

app.post(
  "/api/cbc/curriculum/bulk-generate",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const grade = cleanValue(req.body?.grade);
    const formName = cleanValue(req.body?.form_name);
    const term = cleanOptionalValue(req.body?.term) || "Term One";
    const year = Number(req.body?.year || 0) || dayjs().year();
    const overwriteExisting = parseTruthy(req.body?.overwrite_existing);
    if (!grade && !formName) {
      return res.status(400).json({ error: "grade or form_name is required for bulk generation." });
    }

    const learningAreas = getAllCbcLearningAreas();
    let entriesCreated = 0;
    let materialsCreated = 0;
    for (const learningArea of learningAreas) {
      const mappingRows = await query(
        `SELECT strand, sub_strand
         FROM cbc_structure_mappings
         WHERE institution_id = ?
           AND learning_area = ?
           AND ((? IS NULL AND grade IS NULL) OR grade = ? OR grade IS NULL OR grade = '')
           AND ((? IS NULL AND form_name IS NULL) OR form_name = ? OR form_name IS NULL OR form_name = '')
         ORDER BY strand, sub_strand`,
        [req.user.institution_id, learningArea, grade || null, grade || null, formName || null, formName || null]
      );
      const suggestion =
        buildSuggestionFromMappings({ grade, formName, learningArea, mappings: mappingRows }) ||
        buildCbcSuggestion({ grade, formName, learningArea });
      const strands = Array.isArray(suggestion.strand_options) ? suggestion.strand_options : [];
      for (const strand of strands) {
        const subStrands = Array.isArray(suggestion.sub_strand_options_by_strand?.[strand])
          ? suggestion.sub_strand_options_by_strand[strand]
          : [];
        for (const subStrand of subStrands) {
          const existingEntries = await query(
            `SELECT id
             FROM cbc_curriculum_entries
             WHERE institution_id = ?
               AND learning_area = ?
               AND strand = ?
               AND sub_strand = ?
               AND ((? IS NULL AND grade IS NULL) OR grade = ?)
               AND ((? IS NULL AND form_name IS NULL) OR form_name = ?)
             LIMIT 1`,
            [
              req.user.institution_id,
              learningArea,
              strand,
              subStrand,
              grade || null,
              grade || null,
              formName || null,
              formName || null
            ]
          );
          const notes = makeNotes({
            grade,
            formName,
            learningArea,
            strand,
            subStrand
          });
          if (existingEntries.length && overwriteExisting) {
            await query(
              `UPDATE cbc_curriculum_entries
               SET specific_learning_outcomes = ?,
                   suggested_assessment_rubric = ?,
                   resources_reference = ?,
                   term = ?,
                   year = ?,
                   notes = ?,
                   updated_at = NOW()
               WHERE id = ? AND institution_id = ?`,
              [
                suggestion.learning_outcomes,
                suggestion.assessment_rubric,
                (suggestion.textbook_references || []).join("\n"),
                term,
                year,
                notes,
                existingEntries[0].id,
                req.user.institution_id
              ]
            );
          } else if (!existingEntries.length) {
            await query(
              `INSERT INTO cbc_curriculum_entries
                (institution_id, grade, form_name, learning_area, strand, sub_strand, specific_learning_outcomes, suggested_assessment_rubric, resources_reference, term, year, notes, created_by_user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                req.user.institution_id,
                grade || null,
                formName || null,
                learningArea,
                strand,
                subStrand,
                suggestion.learning_outcomes,
                suggestion.assessment_rubric,
                (suggestion.textbook_references || []).join("\n"),
                term,
                year,
                notes,
                req.user.id
              ]
            );
            entriesCreated += 1;
          }
          await query(
            `INSERT INTO teacher_resources
              (institution_id, teacher_profile_id, resource_type, title, description, grade, stream, term, strand, sub_strand, auto_generated, created_by_user_id)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            [
              req.user.institution_id,
              "CBC_AUTO_GENERATED_NOTES",
              `${learningArea} - ${strand} - ${subStrand}`,
              notes,
              grade || null,
              formName || null,
              term,
              strand,
              subStrand,
              req.user.id
            ]
          );
          materialsCreated += 1;
        }
      }
    }

    await auditLog(req.user, "BULK_GENERATE_CBC_LIBRARY", "cbc_curriculum_entries", null, {
      grade: grade || null,
      form_name: formName || null,
      learning_area_count: learningAreas.length,
      entries_created: entriesCreated,
      materials_created: materialsCreated,
      term,
      year
    });

    res.status(201).json({
      message: "CBC/CBE bulk generation completed.",
      learning_areas_processed: learningAreas.length,
      entries_created: entriesCreated,
      materials_created: materialsCreated
    });
  })
);

function parseCbcMappingCsv(csvText = "") {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length < 3) continue;
    rows.push({
      learning_area: parts[0] || "",
      strand: parts[1] || "",
      sub_strand: parts[2] || "",
      notes: parts[3] || "",
      grade: parts[4] || "",
      form_name: parts[5] || "",
      source_label: parts[6] || "CSV Import"
    });
  }
  return rows.filter((row) => row.learning_area && row.strand && row.sub_strand);
}

app.get(
  "/api/cbc/curriculum/structure-mappings/template",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (_, res) => {
    const csv = [
      "learning_area,strand,sub_strand,notes,grade,form_name,source_label",
      "English,Reading,Comprehension Skills,Learners identify main ideas and answer comprehension questions.,Grade 4,,KICD",
      "Mathematics,Numbers,Fractions and Decimals,Learners represent fractions and decimals and solve daily-life examples.,Grade 6,,KICD"
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"cbc-structure-mappings-template.csv\"");
    res.send(csv);
  })
);

app.get(
  "/api/cbc/curriculum/structure-mappings/template-doc",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (_, res) => {
    const docText = [
      "CBC/CBE STRAND-SUB-STRAND-NOTES TEMPLATE",
      "",
      "Instructions:",
      "1. Fill one entry block per sub-strand.",
      "2. Save this file as .docx or .txt, then copy entries into CSV template if needed.",
      "",
      "Entry Block:",
      "Learning Area: ____________________________",
      "Strand: __________________________________",
      "Sub-Strand: ______________________________",
      "Notes: ___________________________________",
      "Grade (optional): ________________________",
      "Form (optional): _________________________",
      "Source Label: ____________________________",
      "",
      "Example:",
      "Learning Area: Mathematics",
      "Strand: Numbers",
      "Sub-Strand: Fractions and Decimals",
      "Notes: Learners identify numerator/denominator and solve real-life fraction tasks.",
      "Grade (optional): Grade 6",
      "Form (optional):",
      "Source Label: KICD"
    ].join("\r\n");
    res.setHeader("Content-Type", "application/msword; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"cbc-structure-mappings-template.doc\"");
    res.send(docText);
  })
);

app.post(
  "/api/cbc/curriculum/structure-mappings/import",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.CREATE),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "CSV file is required." });
    }
    const csvText = fs.readFileSync(req.file.path, "utf8");
    const rows = parseCbcMappingCsv(csvText);
    if (!rows.length) {
      return res.status(400).json({ error: "No valid mapping rows found in CSV." });
    }
    let imported = 0;
    for (const row of rows) {
      await query(
        `INSERT INTO cbc_structure_mappings
          (institution_id, learning_area, strand, sub_strand, notes, grade, form_name, source_label, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.institution_id,
          cleanValue(row.learning_area),
          cleanValue(row.strand),
          cleanValue(row.sub_strand),
          cleanOptionalValue(row.notes),
          cleanOptionalValue(row.grade),
          cleanOptionalValue(row.form_name),
          cleanOptionalValue(row.source_label) || "CSV Import",
          req.user.id
        ]
      );
      imported += 1;
    }
    await auditLog(req.user, "IMPORT_CBC_STRUCTURE_MAPPINGS", "cbc_structure_mappings", null, { imported });
    res.status(201).json({ message: "Structure mappings imported.", imported });
  })
);

app.post(
  "/api/cbc/curriculum/structure-mappings",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const learningArea = cleanValue(req.body?.learning_area);
    const strand = cleanValue(req.body?.strand);
    const subStrand = cleanValue(req.body?.sub_strand);
    const notes = cleanOptionalValue(req.body?.notes);
    const grade = cleanOptionalValue(req.body?.grade);
    const formName = cleanOptionalValue(req.body?.form_name);
    const sourceLabel = cleanOptionalValue(req.body?.source_label) || "Manual Correction";
    if (!learningArea || !strand || !subStrand) {
      return res.status(400).json({ error: "learning_area, strand and sub_strand are required." });
    }
    const result = await query(
      `INSERT INTO cbc_structure_mappings
        (institution_id, learning_area, strand, sub_strand, notes, grade, form_name, source_label, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.institution_id, learningArea, strand, subStrand, notes, grade, formName, sourceLabel, req.user.id]
    );
    await auditLog(req.user, "SAVE_CBC_STRUCTURE_MAPPING", "cbc_structure_mappings", result.insertId, {
      learning_area: learningArea,
      strand,
      sub_strand: subStrand,
      notes,
      grade,
      form_name: formName,
      source_label: sourceLabel
    });
    res.status(201).json({ id: result.insertId, message: "Structure mapping saved." });
  })
);

app.get(
  "/api/cbc/curriculum/structure-mappings",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const learningArea = cleanOptionalValue(req.query?.learning_area);
    const grade = cleanOptionalValue(req.query?.grade);
    const formName = cleanOptionalValue(req.query?.form_name);
    const whereParts = ["institution_id = ?"];
    const params = [req.user.institution_id];
    if (learningArea) {
      whereParts.push("learning_area = ?");
      params.push(learningArea);
    }
    if (grade) {
      whereParts.push("(grade = ? OR grade IS NULL OR grade = '')");
      params.push(grade);
    }
    if (formName) {
      whereParts.push("(form_name = ? OR form_name IS NULL OR form_name = '')");
      params.push(formName);
    }
    const rows = await query(
      `SELECT id, learning_area, strand, sub_strand, notes, grade, form_name, source_label, created_at, updated_at
       FROM cbc_structure_mappings
       WHERE ${whereParts.join(" AND ")}
       ORDER BY learning_area, strand, sub_strand
       LIMIT 1000`,
      params
    );
    res.json(rows);
  })
);

app.patch(
  "/api/cbc/curriculum/structure-mappings/:id(\\d+)",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const mappingId = Number(req.params.id);
    if (!mappingId) {
      return res.status(400).json({ error: "Valid mapping id is required." });
    }
    const data = pickFields(req.body || {}, ["strand", "sub_strand", "notes", "source_label", "grade", "form_name"]);
    const columns = Object.keys(data).filter((key) => cleanValue(data[key]) || data[key] === "");
    if (!columns.length) {
      return res.status(400).json({ error: "No mapping fields provided." });
    }
    await query(
      `UPDATE cbc_structure_mappings
       SET ${columns.map((column) => `${column} = ?`).join(", ")}, updated_at = NOW()
       WHERE id = ? AND institution_id = ?`,
      [...columns.map((column) => cleanOptionalValue(data[column])), mappingId, req.user.institution_id]
    );
    await auditLog(req.user, "UPDATE_CBC_STRUCTURE_MAPPING", "cbc_structure_mappings", mappingId, data);
    res.json({ message: "Structure mapping updated." });
  })
);

app.post(
  "/api/profile/change-credentials",
  auth,
  accountMutationRateLimit,
  accountMutationCooldown,
  asyncHandler(async (req, res) => {
    const { current_password, new_username, new_password } = req.body;
    const requesterRole = normalizeRole(req.user.role);
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
      if (![ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN].includes(requesterRole)) {
        return res.status(403).json({
          error: "Only the System Developer or HoI/Administrator can change usernames."
        });
      }
      const usernameValidationError = validateUsername(new_username, "new_username");
      if (usernameValidationError) {
        return res.status(400).json({ error: usernameValidationError });
      }
      const duplicates = await query(
        `SELECT id
         FROM users
         WHERE institution_id = ? AND username = ? AND id <> ?
         LIMIT 1`,
        [req.user.institution_id, new_username, user.id]
      );
      if (duplicates.length) {
        return res.status(409).json({ error: "new_username is already in use." });
      }
      updates.push("username = ?");
      params.push(new_username);
    }
    if (new_password) {
      const weakNewPasswordError = requireStrongPassword(new_password, "new_password");
      if (weakNewPasswordError) {
        return res.status(400).json({ error: weakNewPasswordError });
      }
      updates.push("password_hash = ?");
      params.push(await hashPassword(new_password));
      updates.push("password_last_changed_at = NOW()");
      updates.push("password_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)");
      params.push(PASSWORD_ROTATION_DAYS);
      updates.push("must_change_password = 0");
      updates.push("failed_login_attempts = 0");
      updates.push("locked_until = NULL");
      updates.push("last_failed_login_at = NULL");
    }

    if (!updates.length) {
      return res.status(400).json({ error: "No credential changes submitted." });
    }

    await query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, [...params, user.id]);
    await auditLog(req.user, "CHANGE_OWN_CREDENTIALS", "users", user.id, { new_username });
    res.json({ message: "Credentials updated successfully." });
  })
);

app.get("/api/profile", auth, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT u.id, u.institution_id, u.role, u.full_name, u.username, u.email, u.phone, u.created_at,
            i.institution_name
     FROM users u
     LEFT JOIN institutions i ON i.id = u.institution_id
     WHERE u.id = ? AND u.institution_id = ?
     LIMIT 1`,
    [req.user.id, req.user.institution_id]
  );
  if (!rows.length) {
    return res.status(404).json({ error: "Profile not found." });
  }
  const profile = rows[0];
  res.json({
    id: profile.id,
    institution_id: profile.institution_id,
    institution_name: profile.institution_name || null,
    role: profile.role,
    full_name: profile.full_name,
    username: profile.username,
    email: profile.email,
    phone: profile.phone,
    created_at: profile.created_at
  });
}));

app.post(
  "/api/profile/request-update-otp",
  auth,
  accountMutationRateLimit,
  accountMutationCooldown,
  asyncHandler(async (req, res) => {
    const requesterRole = normalizeRole(req.user.role);
    if ([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN].includes(requesterRole)) {
      return res.json({
        message: "OTP is optional for your role. Proceed with profile update directly.",
        otp_required: false
      });
    }
    const updateType = cleanValue(req.body?.update_type || "profile_update");
    const requestedChannel = cleanValue(req.body?.otp_channel || "email").toLowerCase();
    const meRows = await query(
      `SELECT id, institution_id, username, email, phone
       FROM users
       WHERE id = ? AND institution_id = ?
       LIMIT 1`,
      [req.user.id, req.user.institution_id]
    );
    if (!meRows.length) {
      return res.status(404).json({ error: "Profile user not found." });
    }
    const me = meRows[0];
    const channel = isOtpChannelConfigured(requestedChannel) ? requestedChannel : "console";
    const destination = channel === "sms" ? cleanValue(me.phone) : cleanValue(me.email);
    if (!destination) {
      return res.status(400).json({
        error: channel === "sms"
          ? "No phone number found for SMS OTP."
          : "No email address found for email OTP."
      });
    }
    const identity = `profile-update:${me.username}`;
    const otpSession = await createOtpSession({
      identity,
      role: "PROFILE_UPDATE",
      institutionId: me.institution_id,
      payload: { user_id: me.id, update_type: updateType },
      destination,
      channel
    });
    await auditLog(req.user, "PROFILE_UPDATE_OTP_REQUESTED", "otp_sessions", null, {
      update_type: updateType,
      otp_channel: channel,
      otp_expires_at: otpSession.expiresAt
    });
    res.json({
      message: `OTP sent via ${channel}.`,
      otp_required: true,
      otp_channel_used: channel
    });
  })
);

app.post(
  "/api/profile/update",
  auth,
  accountMutationRateLimit,
  accountMutationCooldown,
  asyncHandler(async (req, res) => {
    const requesterRole = normalizeRole(req.user.role);
    const email = cleanOptionalValue(req.body?.email);
    const phone = cleanOptionalValue(req.body?.phone);
    const newPassword = cleanOptionalValue(req.body?.new_password);
    const otpCode = cleanOptionalValue(req.body?.otp_code);
    const requireOtp = ![ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN].includes(requesterRole);

    const users = await query(
      `SELECT id, institution_id, username, password_hash, email, phone
       FROM users
       WHERE id = ? AND institution_id = ?
       LIMIT 1`,
      [req.user.id, req.user.institution_id]
    );
    if (!users.length) {
      return res.status(404).json({ error: "Profile not found." });
    }
    const user = users[0];

    if (requireOtp) {
      if (!otpCode) {
        return res.status(400).json({ error: "OTP code is required for this profile update." });
      }
      const otpRows = await query(
        `SELECT id
         FROM otp_sessions
         WHERE identity_value = ?
           AND role_name = 'PROFILE_UPDATE'
           AND otp_code = ?
           AND is_used = 0
           AND expires_at > NOW()
         ORDER BY id DESC
         LIMIT 1`,
        [`profile-update:${user.username}`, otpCode]
      );
      if (!otpRows.length) {
        return res.status(401).json({ error: "Invalid or expired OTP code." });
      }
      await query("UPDATE otp_sessions SET is_used = 1 WHERE id = ?", [otpRows[0].id]);
    }

    const updates = [];
    const params = [];
    if (email !== null) {
      updates.push("email = ?");
      params.push(email);
    }
    if (phone !== null) {
      updates.push("phone = ?");
      params.push(phone);
    }
    if (newPassword) {
      const weakPasswordError = requireStrongPassword(newPassword, "new_password");
      if (weakPasswordError) {
        return res.status(400).json({ error: weakPasswordError });
      }
      updates.push("password_hash = ?");
      params.push(await hashPassword(newPassword));
      updates.push("password_last_changed_at = NOW()");
      updates.push("password_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)");
      params.push(PASSWORD_ROTATION_DAYS);
      updates.push("must_change_password = 0");
      updates.push("failed_login_attempts = 0");
      updates.push("locked_until = NULL");
      updates.push("last_failed_login_at = NULL");
    }
    if (!updates.length) {
      return res.status(400).json({ error: "No profile changes supplied." });
    }
    await query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, [...params, user.id]);
    await auditLog(req.user, "PROFILE_UPDATED", "users", user.id, {
      email_updated: email !== null,
      phone_updated: phone !== null,
      password_updated: Boolean(newPassword),
      otp_used: requireOtp
    });
    res.json({ message: "Profile updated successfully." });
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
    searchFields: ["full_name", "id_number", "tsc_number", "phone_number", "employment_status", "leave_status", "accountability_status"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: [
      "full_name",
      "tsc_number",
      "id_number",
      "phone_number",
      "employment_status",
      "leave_status",
      "accountability_status",
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
      "balance_after_payment",
      "academic_year",
      "term",
      "capitation_received",
      "grant_other",
      "liabilities",
      "available_balance",
      "outstanding_balance"
    ]
  },
  {
    route: "/api/finance/payroll",
    table: "finance_payroll_records",
    moduleKey: MODULE_KEYS.FINANCE_PAYROLL,
    searchFields: ["staff_name", "staff_number", "payroll_month", "payroll_year", "payment_status"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.NON_TEACHING_STAFF],
    fields: [
      "staff_profile_type",
      "staff_profile_id",
      "staff_name",
      "staff_number",
      "id_number",
      "payroll_month",
      "payroll_year",
      "basic_salary",
      "allowances",
      "deductions",
      "net_salary",
      "payment_status",
      "payment_date",
      "remarks"
    ]
  },
  {
    route: "/api/finance/salary-advances",
    table: "finance_salary_advances",
    moduleKey: MODULE_KEYS.FINANCE_SALARY_ADVANCE,
    searchFields: ["staff_name", "staff_number", "approval_status", "processing_status", "repayment_status"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.NON_TEACHING_STAFF],
    fields: [
      "staff_profile_type",
      "staff_profile_id",
      "staff_name",
      "staff_number",
      "amount_requested",
      "request_date",
      "reason",
      "approval_status",
      "approved_by_user_id",
      "approved_at",
      "amount_approved",
      "processing_status",
      "processed_date",
      "repayment_status",
      "clearance_date",
      "deduction_plan"
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
    `${config.route}/:id(\\d+)`,
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

      if (config.table === "finance_payroll_records") {
        const basicSalary = Number(data.basic_salary || 0);
        const allowances = Number(data.allowances || 0);
        const deductions = Number(data.deductions || 0);
        data.basic_salary = basicSalary;
        data.allowances = allowances;
        data.deductions = deductions;
        data.net_salary = Number.isFinite(Number(data.net_salary))
          ? Number(data.net_salary)
          : basicSalary + allowances - deductions;
      }

      if (config.table === "finance_salary_advances") {
        data.amount_requested = Number(data.amount_requested || 0);
        if (data.amount_approved !== undefined && data.amount_approved !== null && data.amount_approved !== "") {
          data.amount_approved = Number(data.amount_approved);
        } else {
          delete data.amount_approved;
        }
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
    `${config.route}/:id(\\d+)`,
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
    `${config.route}/:id(\\d+)`,
    auth,
    enforceModuleAccess(config.moduleKey),
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.DELETE),
    asyncHandler(async (req, res) => {
      const scopedFilter = getScopedFilter(config, req.user);
      const existingRows = await query(
        `SELECT *
         FROM ${config.table}
         WHERE id = ? AND institution_id = ?${scopedFilter.where}
         LIMIT 1`,
        [req.params.id, req.user.institution_id, ...scopedFilter.params]
      );
      if (!existingRows.length) {
        return res.status(404).json({ error: "Record not found." });
      }
      const targetRecord = existingRows[0];
      await archiveRecycleBinItem({
        institutionId: req.user.institution_id,
        entityName: config.table,
        entityId: targetRecord.id || req.params.id,
        payload: targetRecord,
        deletedByUserId: req.user.id
      });
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

app.post(
  "/api/communication/messages/dispatch",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const { message_type, recipient_role, recipient_contact, message_body } = req.body;
    const results = await dispatchCommunicationMessage({
      institutionId: req.user.institution_id,
      messageType: message_type,
      recipientRole: recipient_role,
      recipientContact: recipient_contact,
      messageBody: message_body,
      createdByUserId: req.user.id
    });
    await auditLog(req.user, "DISPATCH_COMMUNICATION_MESSAGE", "communication_messages", null, {
      message_type,
      recipient_role,
      recipient_contact,
      total_recipients: results.length
    });
    res.status(201).json({
      message: "Communication dispatch completed.",
      total_recipients: results.length,
      success_count: results.filter((item) => item.status === "Sent").length,
      failed_count: results.filter((item) => item.status === "Failed").length,
      results
    });
  })
);

app.post(
  "/api/communication/messages/bulk-dispatch",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const { items = [] } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "items array is required." });
    }
    const aggregate = [];
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await dispatchCommunicationMessage({
        institutionId: req.user.institution_id,
        messageType: item.message_type,
        recipientRole: item.recipient_role,
        recipientContact: item.recipient_contact,
        messageBody: item.message_body,
        createdByUserId: req.user.id
      });
      aggregate.push(...rows);
    }
    await auditLog(req.user, "BULK_DISPATCH_COMMUNICATION_MESSAGE", "communication_messages", null, {
      total_items: items.length,
      total_recipients: aggregate.length
    });
    res.status(201).json({
      message: "Bulk communication dispatch completed.",
      total_items: items.length,
      total_recipients: aggregate.length,
      success_count: aggregate.filter((item) => item.status === "Sent").length,
      failed_count: aggregate.filter((item) => item.status === "Failed").length
    });
  })
);

app.post(
  "/api/communication/messages/:id(\\d+)/dispatch",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const result = await dispatchQueuedMessageRecord({
      institutionId: req.user.institution_id,
      recordId: Number(req.params.id),
      actorUserId: req.user.id
    });
    await auditLog(req.user, "DISPATCH_COMMUNICATION_MESSAGE_RECORD", "communication_messages", req.params.id, {
      status: result.status,
      recipient_contact: result.recipient_contact,
      error: result.error || null
    });
    res.json({
      message: result.status === "Sent" ? "Message dispatched successfully." : "Message dispatch failed.",
      result
    });
  })
);

app.post(
  "/api/communication/messages/dispatch-queued",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const requestedLimit = Number(req.body?.limit || 50);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 500);
    const queuedRows = await query(
      `SELECT id, message_type, recipient_contact, message_body
       FROM communication_messages
       WHERE institution_id = ? AND status = 'Queued'
       ORDER BY id ASC
       LIMIT ?`,
      [req.user.institution_id, limit]
    );
    const results = [];
    for (const row of queuedRows) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await dispatchStoredCommunicationRow(row));
    }
    const dispatched = results.filter((item) => item.status === "Sent").length;
    const failed = results.filter((item) => item.status === "Failed").length;
    await auditLog(req.user, "DISPATCH_QUEUED_COMMUNICATION_MESSAGES", "communication_messages", null, {
      processed: results.length,
      dispatched,
      failed
    });
    res.json({
      message: "Queued communication dispatch completed.",
      processed: results.length,
      dispatched,
      failed,
      results
    });
  })
);

app.get(
  "/api/communication/messages/delivery-summary",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT message_type, status, COUNT(*) total
       FROM communication_messages
       WHERE institution_id = ?
       GROUP BY message_type, status
       ORDER BY message_type, status`,
      [req.user.institution_id]
    );
    const recentFailed = await query(
      `SELECT id, message_type, recipient_role, recipient_contact, message_body, status, created_at
       FROM communication_messages
       WHERE institution_id = ? AND status = 'Failed'
       ORDER BY id DESC
       LIMIT 20`,
      [req.user.institution_id]
    );
    const queuedRows = await query(
      `SELECT id, message_type, recipient_role, recipient_contact, created_at
       FROM communication_messages
       WHERE institution_id = ? AND status = 'Queued'
       ORDER BY id ASC
       LIMIT 50`,
      [req.user.institution_id]
    );
    res.json({ summary: rows, recent_failed: recentFailed, queued: queuedRows });
  })
);

app.post(
  "/api/communication/chat/rooms",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.PARENT, ROLES.TEACHER, ROLES.HEAD_OF_INSTITUTION, ROLES.ADMIN]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const roomKey = cleanValue(req.body?.room_key);
    const participantRoles = Array.isArray(req.body?.participant_roles) ? req.body.participant_roles : [];
    const roomData = await ensureChatRoom({
      institutionId: req.user.institution_id,
      roomKey,
      participantRoles,
      createdByUserId: req.user.id
    });
    await auditLog(req.user, "CHAT_ROOM_UPSERT", "communication_chat_rooms", roomData.room?.id || null, {
      room_key: roomKey,
      participant_roles: participantRoles
    });
    res.status(201).json({ message: "Chat room is ready.", room: roomData.room });
  })
);

app.get(
  "/api/communication/chat/rooms",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.PARENT, ROLES.TEACHER, ROLES.HEAD_OF_INSTITUTION, ROLES.ADMIN]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rooms = await query(
      `SELECT r.id, r.room_key, r.participant_roles_json, r.is_active, r.created_at, r.updated_at,
              COALESCE(msg.messages_count, 0) messages_count,
              msg.last_message_at,
              msg.preview_message
       FROM communication_chat_rooms r
       LEFT JOIN (
         SELECT institution_id,
                thread_key,
                COUNT(*) messages_count,
                MAX(created_at) last_message_at,
                SUBSTRING_INDEX(GROUP_CONCAT(message_body ORDER BY id DESC SEPARATOR '||'), '||', 1) preview_message
         FROM communication_chat_messages
         WHERE institution_id = ?
         GROUP BY institution_id, thread_key
       ) msg ON msg.institution_id = r.institution_id AND msg.thread_key = r.room_key
       WHERE r.institution_id = ? AND r.is_active = 1
       ORDER BY COALESCE(msg.last_message_at, r.updated_at) DESC
       LIMIT 200`,
      [req.user.institution_id, req.user.institution_id]
    );
    res.json({
      rooms: rooms.map((room) => {
        const participantRoles = parseStoredJson(room.participant_roles_json) || [];
        return {
          ...room,
          participant_roles: participantRoles,
          participants_count: participantRoles.length
        };
      })
    });
  })
);

app.post(
  "/api/communication/chat/rooms/:roomKey/messages",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.PARENT, ROLES.TEACHER, ROLES.HEAD_OF_INSTITUTION, ROLES.ADMIN]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const roomKey = cleanValue(decodeURIComponent(req.params.roomKey || ""));
    const messageBody = cleanValue(req.body?.message_body);
    if (!roomKey) {
      return res.status(400).json({ error: "roomKey is required." });
    }
    if (!messageBody) {
      return res.status(400).json({ error: "message_body is required." });
    }
    await ensureChatRoom({
      institutionId: req.user.institution_id,
      roomKey,
      participantRoles: req.body?.participant_roles || [],
      createdByUserId: req.user.id
    });
    const senderName = cleanValue(req.user.full_name) || cleanValue(req.user.username) || "Unknown Sender";
    const insert = await query(
      `INSERT INTO communication_chat_messages
        (institution_id, thread_key, sender_user_id, sender_role, sender_name, audience_role, message_body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.institution_id,
        roomKey,
        String(req.user.id),
        normalizeRole(req.user.role),
        senderName,
        normalizeRole(req.body?.audience_role) || null,
        messageBody
      ]
    );
    await auditLog(req.user, "CHAT_MESSAGE_SEND", "communication_chat_messages", insert.insertId, {
      thread_key: roomKey
    });
    res.status(201).json({ id: insert.insertId, message: "Chat message sent.", room_key: roomKey });
  })
);

app.get(
  "/api/communication/chat/rooms/:roomKey/messages",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.PARENT, ROLES.TEACHER, ROLES.HEAD_OF_INSTITUTION, ROLES.ADMIN]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const roomKey = cleanValue(decodeURIComponent(req.params.roomKey || ""));
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    if (!roomKey) {
      return res.status(400).json({ error: "roomKey is required." });
    }
    const rows = await query(
      `SELECT id, thread_key, sender_user_id, sender_role, sender_name, audience_role, message_body, is_read, created_at
       FROM communication_chat_messages
       WHERE institution_id = ? AND thread_key = ?
       ORDER BY id DESC
       LIMIT ?`,
      [req.user.institution_id, roomKey, limit]
    );
    res.json({ room_key: roomKey, messages: rows.reverse() });
  })
);

app.post(
  "/api/communication/chat/messages",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.PARENT, ROLES.TEACHER, ROLES.HEAD_OF_INSTITUTION, ROLES.ADMIN]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const { conversation_key, recipient_role, message_body } = req.body;
    const threadKey =
      cleanValue(conversation_key) || `${req.user.institution_id}:${normalizeRole(req.user.role)}:${cleanValue(recipient_role)}`;
    if (!cleanValue(message_body)) {
      return res.status(400).json({ error: "message_body is required." });
    }
    await ensureChatRoom({
      institutionId: req.user.institution_id,
      roomKey: threadKey,
      participantRoles: [req.user.role, recipient_role].filter(Boolean),
      createdByUserId: req.user.id
    });
    const senderName = cleanValue(req.user.full_name) || cleanValue(req.user.username) || "Unknown Sender";
    const insert = await query(
      `INSERT INTO communication_chat_messages
        (institution_id, thread_key, sender_user_id, sender_role, sender_name, audience_role, message_body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.institution_id,
        threadKey,
        String(req.user.id),
        normalizeRole(req.user.role),
        senderName,
        normalizeRole(recipient_role) || null,
        cleanValue(message_body)
      ]
    );
    await auditLog(req.user, "CHAT_MESSAGE_SEND", "communication_chat_messages", insert.insertId, {
      thread_key: threadKey
    });
    res.status(201).json({ id: insert.insertId, message: "Chat message sent.", conversation_key: threadKey });
  })
);

app.get(
  "/api/communication/chat/messages",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.PARENT, ROLES.TEACHER, ROLES.HEAD_OF_INSTITUTION, ROLES.ADMIN]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const conversationKey = cleanValue(req.query.conversation_key);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    if (!conversationKey) {
      return res.status(400).json({ error: "conversation_key query parameter is required." });
    }
    const rows = await query(
      `SELECT id, thread_key AS conversation_key, sender_user_id, sender_role, sender_name, audience_role AS recipient_role, message_body, created_at
       FROM communication_chat_messages
       WHERE institution_id = ? AND thread_key = ?
       ORDER BY id DESC
       LIMIT ?`,
      [req.user.institution_id, conversationKey, limit]
    );
    res.json(rows.reverse());
  })
);

app.get(
  "/api/communication/chat/conversations",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.PARENT, ROLES.TEACHER, ROLES.HEAD_OF_INSTITUTION, ROLES.ADMIN]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT thread_key AS conversation_key, MAX(created_at) last_message_at, COUNT(*) total_messages
       FROM communication_chat_messages
       WHERE institution_id = ?
       GROUP BY thread_key
       ORDER BY last_message_at DESC
       LIMIT 200`,
      [req.user.institution_id]
    );
    res.json(rows);
  })
);

app.get("/", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.get("/privacy", (_, res) => {
  res.redirect(302, "/privacy.html");
});
app.get("/privacy-policy", (_, res) => {
  res.redirect(302, "/privacy.html");
});

app.get("/terms", (_, res) => {
  res.redirect(302, "/terms.html");
});
app.get("/terms-of-service", (_, res) => {
  res.redirect(302, "/terms.html");
});

app.get("/about", (_, res) => {
  res.redirect(302, "/about.html");
});
app.get("/about.html", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "about.html"));
});

app.get("/contact", (_, res) => {
  res.redirect(302, "/contact.html");
});
app.get("/contact.html", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "contact.html"));
});

app.get("/accessibility", (_, res) => {
  res.redirect(302, "/accessibility.html");
});
app.get("/accessibility.html", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "accessibility.html"));
});

app.get("/status", (_, res) => {
  res.redirect(302, "/status.html");
});
app.get("/status.html", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "status.html"));
});

app.get("/cookies", (_, res) => {
  res.redirect(302, "/cookies.html");
});
app.get("/cookie-notice", (_, res) => {
  res.redirect(302, "/cookies.html");
});
app.get("/cookies.html", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "cookies.html"));
});

app.get("/security", (_, res) => {
  res.redirect(302, "/security.html");
});
app.get("/security.html", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "security.html"));
});

app.get("/support-compliance", (_, res) => {
  res.redirect(302, "/support-compliance.html");
});

app.get("/support-compliance.html", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "support-compliance.html"));
});

app.get("/compliance", (_, res) => {
  res.redirect(302, "/compliance.html");
});
app.get("/compliance.html", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "compliance.html"));
});

app.get("/support", (_, res) => {
  res.redirect(302, "/support.html");
});
app.get("/support.html", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "support.html"));
});
app.get("/privacy.html", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "privacy.html"));
});
app.get("/terms.html", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "terms.html"));
});
app.get("/opensearch.xml", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "opensearch.xml"));
});
app.get("/llms.txt", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "llms.txt"));
});

app.use((req, res, next) => {
  if (String(req.path || "").startsWith("/api/")) {
    return res.status(404).json({ error: "API endpoint not found." });
  }
  return next();
});

app.use((req, res, next) => {
  if (req.method !== "GET") {
    return next();
  }
  return res.status(404).sendFile(path.join(process.cwd(), "public", "404.html"));
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
