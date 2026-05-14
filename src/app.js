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
const crypto = require("crypto");
const { generateExamStemsWithOpenAi } = require("./services/examAiService");
const dayjs = require("dayjs");
const { query } = require("./config/db");
const {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  GRADES,
  FORMS,
  CBC_LEVELS,
  TERMS,
  YEAR_JOINED_OPTIONS,
  YEAR_JOINED_WIDE_OPTIONS,
  WORLD_COUNTRY_OPTIONS,
  RELIGION_OPTIONS,
  DISABILITY_TYPE_OPTIONS,
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
const { MODULE_KEYS } = require("./config/moduleKeys");
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
const {
  generateOtpCode,
  buildOtpExpiry,
  sendOtp,
  sendTransactionalEmail,
  sendTransactionalSms,
  emailChannelReady,
  smsChannelReady
} = require("./services/otpService");
const { buildSearchWhere } = require("./utils/sql");
const {
  buildCbcSuggestion,
  buildSuggestionFromMappings,
  makeNotes,
  getAllCbcLearningAreas,
  buildBulkCbcEntries,
  getJuniorSecondaryCoreSeedRows
} = require("./config/cbcLibrary");
const {
  KICD_LEVEL_PAGES,
  fetchKicdCatalog,
  extractKicdCurriculumFromCatalog
} = require("./services/kicdCurriculumService");
const { importLocalCurriculumFromPdfDirectory } = require("./services/localCurriculumImportService");

/** Bump when shipping UI/API changes so schools can confirm they run the right copy. */
const IIMS_BUILD_STAMP = process.env.IIMS_BUILD_STAMP || "ui-deploy-rev45";
const {
  readPublicIndexFingerprint,
  readPublicDashboardFingerprint
} = require("./readIndexFingerprint");
const PUBLIC_INDEX_FINGERPRINT = readPublicIndexFingerprint();
const PUBLIC_DASHBOARD_FINGERPRINT = readPublicDashboardFingerprint();

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
// rev45: production hardening middleware
if (String(process.env.NODE_ENV || "").toLowerCase() === "production" && String(process.env.FORCE_HTTPS || "true").toLowerCase() !== "false") {
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    const xfProto = req.get("x-forwarded-proto") || req.protocol;
    if (xfProto !== "https") {
      return res.redirect(301, `https://${req.get("host")}${req.originalUrl}`);
    }
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    next();
  });
}
app.use(helmet({
  contentSecurityPolicy: String(process.env.ENABLE_CSP || "false").toLowerCase() === "true"
    ? {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:", "blob:"],
          "script-src": ["'self'", "'unsafe-inline'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"]
        }
      }
    : false,
  crossOriginEmbedderPolicy: false
}));
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
    filename: (req, file, cb) => {
      const mappedExtension = HERO_IMAGE_EXTENSION_BY_MIME[file.mimetype];
      const sourceExtension = cleanValue(path.extname(file.originalname)).toLowerCase();
      const extension = mappedExtension || sourceExtension || ".jpg";
      const institutionId = Number(req?.user?.institution_id || 0);
      const filePrefix = institutionId > 0 ? `index-hero-inst-${institutionId}` : "index-hero-default";
      cb(null, `${filePrefix}-${Date.now()}${extension}`);
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

function normalizeUploadPath(uploadPath) {
  const cleaned = cleanValue(uploadPath);
  if (!cleaned.startsWith("/uploads/")) return null;
  const fileName = cleaned.replace("/uploads/", "");
  if (!fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) return null;
  return { fileName, uploadPath: `/uploads/${fileName}` };
}

function resolveHeroAssetByUploadPath(uploadPath) {
  const normalized = normalizeUploadPath(uploadPath);
  if (!normalized) return null;
  const absolutePath = path.join(uploadsPath, normalized.fileName);
  if (!fs.existsSync(absolutePath)) return null;
  const stats = fs.statSync(absolutePath);
  return {
    file_name: normalized.fileName,
    hero_image_path: normalized.uploadPath,
    hero_image_url: `${normalized.uploadPath}?v=${Number(stats.mtimeMs || Date.now())}`,
    updated_at: stats.mtime.toISOString()
  };
}

function resolveGenericHeroAsset() {
  const legacyCandidates = [
    "index-hero.jpg",
    "index-hero.jpeg",
    "index-hero.png",
    "index-hero.webp",
    "index-hero.gif",
    "index-hero.avif"
  ];
  for (const candidate of legacyCandidates) {
    const legacy = resolveHeroAssetByUploadPath(`/uploads/${candidate}`);
    if (legacy) return legacy;
  }
  return {
    file_name: "imis-hero.jpg",
    hero_image_path: "/assets/imis-hero.jpg",
    hero_image_url: "/assets/imis-hero.jpg",
    updated_at: null
  };
}

async function resolveHeroImageAsset({ institutionId = null } = {}) {
  if (Number(institutionId || 0) > 0) {
    const rows = await query(
      `SELECT login_hero_image_path
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [Number(institutionId)]
    );
    const scopedAsset = resolveHeroAssetByUploadPath(rows[0]?.login_hero_image_path);
    if (scopedAsset) {
      return {
        ...scopedAsset,
        institution_id: Number(institutionId)
      };
    }
  }
  return {
    ...resolveGenericHeroAsset(),
    institution_id: Number(institutionId || 0) || null
  };
}

async function cleanupOldInstitutionHeroImage({ institutionId, currentUploadPath }) {
  const rows = await query(
    `SELECT login_hero_image_path
     FROM institutions
     WHERE id = ?
     LIMIT 1`,
    [Number(institutionId || 0)]
  );
  const oldPath = rows[0]?.login_hero_image_path;
  const normalizedOld = normalizeUploadPath(oldPath);
  const normalizedCurrent = normalizeUploadPath(currentUploadPath);
  if (!normalizedOld || !normalizedCurrent) return;
  if (normalizedOld.uploadPath === normalizedCurrent.uploadPath) return;
  const expectedPrefix = `index-hero-inst-${Number(institutionId)}-`;
  if (!normalizedOld.fileName.startsWith(expectedPrefix)) return;
  const absolutePath = path.join(uploadsPath, normalizedOld.fileName);
  if (!fs.existsSync(absolutePath)) return;
  try {
    fs.unlinkSync(absolutePath);
  } catch (_) {
    // Ignore stale image cleanup failures.
  }
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
    if (normalizedRole === ROLES.SUPER_SYSTEM_DEVELOPER) {
      return next();
    }
    if (normalizedRole === ROLES.SYSTEM_DEVELOPER && roles.includes(ROLES.SYSTEM_DEVELOPER)) {
      return next();
    }
    if (
      normalizedRole === ROLES.SYSTEM_ADMINISTRATOR &&
      (roles.includes(ROLES.ADMIN) || roles.includes(ROLES.HEAD_OF_INSTITUTION))
    ) {
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
    case ROLES.SUPER_SYSTEM_DEVELOPER:
      return "Super System Developer Console";
    case ROLES.SYSTEM_DEVELOPER:
      return "System Developer Console";
    case ROLES.SYSTEM_ADMINISTRATOR:
      return "System Administrator Dashboard";
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
    SUPER_SYSTEM_DEVELOPER: ROLES.SUPER_SYSTEM_DEVELOPER,
    SUPER_SYSTEMDEVELOPER: ROLES.SUPER_SYSTEM_DEVELOPER,
    SYSTEM_DEVELOPER: ROLES.SYSTEM_DEVELOPER,
    SYTEM_DEVELOPER: ROLES.SYSTEM_DEVELOPER,
    SYSTEM_ADMINISTRATOR: ROLES.SYSTEM_ADMINISTRATOR,
    SYSTEM_ADMIN: ROLES.SYSTEM_ADMINISTRATOR,
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
    SR_TEACHER: ROLES.SENIOR_TEACHER,
    TSC_SCD: ROLES.TSC,
    TSC_SUB_COUNTY_DIRECTOR: ROLES.TSC,
    MOE_SCD: ROLES.MOD,
    MOD_SCD: ROLES.MOD,
    TSC_CD: ROLES.TSC,
    TSC_COUNTY_DIRECTOR: ROLES.TSC,
    MOE_CD: ROLES.MOD,
    MOD_CD: ROLES.MOD,
    MOE_RD: ROLES.MOD,
    MOD_RD: ROLES.MOD,
    TSC_RD: ROLES.TSC,
    TSC_REGIONAL_DIRECTOR: ROLES.TSC,
    MINISTRY_REGIONAL_DIRECTOR: ROLES.MOD,
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
    LEARNER_PORTAL: ROLES.LEARNER
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

function normalizePhoneInput(value) {
  const cleaned = cleanValue(value);
  if (!cleaned) return null;
  const compact = cleaned.replace(/\s+/g, "");
  if (compact.length > 25) {
    return null;
  }
  if (!/^[0-9+]+$/.test(compact)) {
    return null;
  }
  const acceptedPrefixes = ["07", "01", "+254", "+"];
  if (!acceptedPrefixes.some((prefix) => compact.startsWith(prefix))) {
    return null;
  }
  return compact;
}

function hasAllowedPhonePrefix(value) {
  const normalized = normalizePhoneInput(value);
  if (!normalized) return true;
  return (
    normalized.startsWith("07") ||
    normalized.startsWith("01") ||
    normalized.startsWith("+254") ||
    normalized.startsWith("+")
  );
}

const PUBLIC_ROLE_OPTIONS = [
  ROLES.SUPER_SYSTEM_DEVELOPER,
  ROLES.SYSTEM_DEVELOPER,
  ROLES.SYSTEM_ADMINISTRATOR,
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
const HIGH_PRIVILEGE_REGISTRATION_ROLES = new Set([
  ROLES.SUPER_SYSTEM_DEVELOPER,
  ROLES.SYSTEM_DEVELOPER,
  ROLES.MOD,
  ROLES.TSC
]);

const AGREEMENT_COMPANY = {
  name: "Mwendegu Enterprise Limited",
  email: "mwendeguenterpriseltd@gmail.com",
  phone: "+254 725 757 767"
};
const RECYCLE_BIN_RETENTION_YEARS = Number(process.env.RECYCLE_BIN_RETENTION_YEARS || 15);

const PASSWORD_ROTATION_DAYS = Number(process.env.PASSWORD_ROTATION_DAYS || 90);
const PASSWORD_ROTATION_EXEMPT_ROLES = new Set([ROLES.SUPER_SYSTEM_DEVELOPER]);
const PASSWORD_MIN_LENGTH = Number(process.env.PASSWORD_MIN_LENGTH || 12);
const USERNAME_MIN_LENGTH = Number(process.env.USERNAME_MIN_LENGTH || 5);
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const LOGIN_LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES || 15);
const OTP_MAX_VERIFY_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS || 5);
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 30);
const ACCOUNT_MUTATION_COOLDOWN_SECONDS = Number(process.env.ACCOUNT_MUTATION_COOLDOWN_SECONDS || 5);
const LOGIN_JITTER_MAX_MS = Number(process.env.LOGIN_JITTER_MAX_MS || 350);
const SYSTEM_DEVELOPER_MAX_ACCOUNTS = Number(process.env.SYSTEM_DEVELOPER_MAX_ACCOUNTS || 5000);
const SUPER_SYSTEM_DEVELOPER_MAX_ACCOUNTS = Number(process.env.SUPER_SYSTEM_DEVELOPER_MAX_ACCOUNTS || 3);
const SUPER_SYSTEM_DEVELOPER_USERNAMES = Array.from(
  new Set(
    cleanValue(process.env.SUPER_SYSTEM_DEVELOPER_USERNAMES || "29645654,952252")
      .split(",")
      .map((item) => cleanValue(item))
      .filter(Boolean)
  )
).slice(0, SUPER_SYSTEM_DEVELOPER_MAX_ACCOUNTS);
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

function parseBoundedInt(value, { fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function isSuperSystemDeveloperUsername(value) {
  return SUPER_SYSTEM_DEVELOPER_USERNAMES.includes(cleanValue(value));
}

function isSuperSystemDeveloperRole(role) {
  return normalizeRole(role) === ROLES.SUPER_SYSTEM_DEVELOPER;
}

function isAnySystemDeveloperRole(role) {
  const normalized = normalizeRole(role);
  return normalized === ROLES.SUPER_SYSTEM_DEVELOPER || normalized === ROLES.SYSTEM_DEVELOPER;
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

async function augmentAuthAuditDetailsWithInstitution(authDetails, institutionId = null, institutionCodeFallback = null) {
  let code = institutionCodeFallback;
  let name = null;
  const nid = Number(institutionId || 0);
  if (!code && nid) {
    try {
      const rows = await query(
        `SELECT institution_code, institution_name FROM institutions WHERE id = ? LIMIT 1`,
        [nid]
      );
      if (rows.length) {
        code = cleanValue(rows[0]?.institution_code) || code;
        name = cleanValue(rows[0]?.institution_name) || null;
      }
    } catch (_) {
      code = institutionCodeFallback;
    }
  }
  return {
    ...authDetails,
    institution_id: nid || authDetails.institution_id || null,
    institution_code: cleanValue(authDetails.institution_code) || cleanValue(code) || null,
    institution_name: cleanValue(authDetails.institution_name) || name || null
  };
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

function buildRecycleDeleteDetails(req, user, description = "", extra = {}) {
  return {
    deleted_by_user_id: Number(user?.id || 0) || null,
    deleted_by_username: cleanValue(user?.username) || null,
    deleted_by_full_name: cleanValue(user?.full_name) || null,
    deleted_by_role: normalizeRole(user?.role) || null,
    deleted_ip_address: getClientIp(req),
    deleted_machine_name: getClientMachineName(req),
    deleted_user_agent: cleanValue(req.headers["user-agent"]),
    description: cleanValue(description) || null,
    deleted_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
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
const publicReadRateLimit = enforceRateLimit({
  bucket: "public-read",
  maxRequests: Number(process.env.RATE_LIMIT_PUBLIC_READ_MAX || 300),
  windowMs: REQUEST_RATE_WINDOW_MS
});
const publicAdmissionLookupRateLimit = enforceRateLimit({
  bucket: "public-admission-lookup",
  maxRequests: Number(process.env.RATE_LIMIT_PUBLIC_ADMISSION_LOOKUP_MAX || 60),
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
  const normalizedRole = normalizeRole(role);
  if (normalizedRole !== ROLES.SYSTEM_DEVELOPER && normalizedRole !== ROLES.SUPER_SYSTEM_DEVELOPER) {
    return { allowed: true, max: SYSTEM_DEVELOPER_MAX_ACCOUNTS, total: null };
  }
  if (normalizedRole === ROLES.SUPER_SYSTEM_DEVELOPER) {
    const superRows = await query(
      `SELECT COUNT(*) AS total
       FROM users
       WHERE role = ?`,
      [ROLES.SUPER_SYSTEM_DEVELOPER]
    );
    const superTotal = Number(superRows[0]?.total || 0);
    if (superTotal >= SUPER_SYSTEM_DEVELOPER_MAX_ACCOUNTS) {
      return { allowed: false, max: SUPER_SYSTEM_DEVELOPER_MAX_ACCOUNTS, total: superTotal };
    }
    return { allowed: true, max: SUPER_SYSTEM_DEVELOPER_MAX_ACCOUNTS, total: superTotal };
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
       AND deleted_at <= DATE_SUB(NOW(), INTERVAL ${RECYCLE_BIN_RETENTION_YEARS} YEAR)`
  );
  await query(
    `DELETE FROM recycle_bin_items
     WHERE status = 'DELETED'
       AND hidden_for_roles_json IS NOT NULL
       AND permanently_deleted_at IS NOT NULL
       AND permanently_deleted_at <= DATE_SUB(NOW(), INTERVAL 7 YEAR)`
  );
}

async function normalizeLegacyRecycleBinVisibility() {
  await query(
    `UPDATE recycle_bin_items
     SET hidden_for_roles_json = JSON_ARRAY('ADMIN', 'HEAD_OF_INSTITUTION')
     WHERE status = 'DELETED'
       AND hidden_for_roles_json IS NULL`
  );
}

function parseHiddenRoles(value) {
  const parsed = parseStoredJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => normalizeRole(item))
    .filter(Boolean);
}

function parseArchivedRecycleMeta(value) {
  const payload = parseStoredJson(value);
  if (!payload || typeof payload !== "object") return {};
  const meta = payload.__recycle_meta;
  if (!meta || typeof meta !== "object") return {};
  return meta;
}

function roleHiddenFromItem(role, recycleItem) {
  const normalizedRole = normalizeRole(role);
  const hiddenRoles = parseHiddenRoles(recycleItem?.hidden_for_roles_json);
  return hiddenRoles.includes(normalizedRole);
}

/** Institution roles must not see recycler entries authored by Super/System developers. */
function shouldRecycleBinEntryExposeDeleterViewer(actorRole, recycleItemRow) {
  const role = normalizeRole(actorRole);
  if (isAnySystemDeveloperRole(role)) {
    return true;
  }
  const meta = parseArchivedRecycleMeta(recycleItemRow?.archived_payload_json);
  const deletedByRole = normalizeRole(meta?.deleted_by_role || "");
  if (
    deletedByRole === ROLES.SUPER_SYSTEM_DEVELOPER ||
    deletedByRole === ROLES.SYSTEM_DEVELOPER
  ) {
    return false;
  }
  return true;
}

function verifyThreeStepDeleteConfirm(confirmations = []) {
  if (!Array.isArray(confirmations) || confirmations.length < 3) {
    return false;
  }
  const expected = ["YES", "CONFIRM", "DELETE"];
  return expected.every((step, index) => cleanValue(confirmations[index]).toUpperCase() === step);
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

function formatLearnerSerial(serialNumber) {
  const serial = Number(serialNumber || 0);
  if (!serial || !Number.isFinite(serial)) return "";
  return String(serial).padStart(3, "0");
}

function normalizeAdmissionSeed(seedValue = "") {
  return String(seedValue || "")
    .trim()
    .replace(/[^a-z0-9/-]/gi, "")
    .slice(0, 28)
    .toUpperCase();
}

async function nextAdmissionNumber({ institutionId, seed = "" }) {
  const normalizedSeed = normalizeAdmissionSeed(seed);
  const prefix = normalizedSeed ? `ADM/${normalizedSeed}` : "ADM";
  const rows = await query(
    `SELECT admission_number
     FROM learners
     WHERE institution_id = ?
       AND admission_number LIKE ?
     ORDER BY id DESC
     LIMIT 2000`,
    [institutionId, `${prefix}%`]
  );
  const nextSerial = rows.reduce((maxValue, row) => {
    const admissionNumber = cleanValue(row?.admission_number || "");
    const match = admissionNumber.match(/(\d+)\s*$/);
    if (!match) return maxValue;
    const value = Number(match[1] || 0);
    return Number.isFinite(value) && value > maxValue ? value : maxValue;
  }, 0) + 1;
  return `${prefix}-${String(nextSerial).padStart(3, "0")}`;
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
  return isAnySystemDeveloperRole(role);
}

function canRegisterPrivilegedUsers(user) {
  return isAnySystemDeveloperRole(user?.role);
}

function canRegisterInstitutionUsers(user) {
  const role = normalizeRole(user?.role);
  return [ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION].includes(role);
}

function getAssignableRolesForActor(user) {
  const role = normalizeRole(user?.role);
  if (role === ROLES.SUPER_SYSTEM_DEVELOPER) {
    return [...PUBLIC_ROLE_OPTIONS];
  }
  if (role === ROLES.SYSTEM_DEVELOPER) {
    return PUBLIC_ROLE_OPTIONS.filter((item) => item !== ROLES.SUPER_SYSTEM_DEVELOPER);
  }
  if (role === ROLES.SYSTEM_ADMINISTRATOR) {
    return PUBLIC_ROLE_OPTIONS.filter(
      (item) => ![ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER].includes(item)
    );
  }
  if ([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION].includes(role)) {
    return PUBLIC_ROLE_OPTIONS.filter(
      (item) =>
        !HIGH_PRIVILEGE_REGISTRATION_ROLES.has(item) &&
        ![ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION].includes(item)
    );
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

const DEFAULT_MODULE_ACCESS_BY_ROLE = {
  [ROLES.SUPER_SYSTEM_DEVELOPER]: Object.values(MODULE_KEYS),
  [ROLES.SYSTEM_DEVELOPER]: Object.values(MODULE_KEYS),
  [ROLES.SYSTEM_ADMINISTRATOR]: [],
  [ROLES.ADMIN]: [],
  [ROLES.HEAD_OF_INSTITUTION]: [],
  [ROLES.MOD]: [],
  [ROLES.TSC]: [],
  [ROLES.TEACHER]: [],
  [ROLES.SENIOR_TEACHER]: [],
  [ROLES.HEAD_OF_DEPARTMENT]: [],
  [ROLES.NON_TEACHING_STAFF]: [],
  [ROLES.BOM]: [],
  [ROLES.PARENT]: [],
  [ROLES.LEARNER]: [],
  [ROLES.SUPPLIER]: [],
  [ROLES.CONTRACTOR]: []
};

async function hasModuleAccessSingle(user, normalizedRole, moduleKey) {
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

async function hasModuleAccess(user, moduleKey) {
  if (!moduleKey || !user?.id) {
    return true;
  }
  const normalizedRole = normalizeRole(user.role);
  if (normalizedRole === ROLES.SUPER_SYSTEM_DEVELOPER || normalizedRole === ROLES.SYSTEM_DEVELOPER) {
    return true;
  }
  const staffBundleKeys = [
    MODULE_KEYS.STAFF_SERVICE_PROVIDERS,
    MODULE_KEYS.MANAGEMENT_TEACHERS,
    MODULE_KEYS.MANAGEMENT_NON_TEACHING
  ];
  if (staffBundleKeys.includes(moduleKey)) {
    for (const bundledKey of staffBundleKeys) {
      // eslint-disable-next-line no-await-in-loop
      if (await hasModuleAccessSingle(user, normalizedRole, bundledKey)) {
        return true;
      }
    }
    return false;
  }
  return hasModuleAccessSingle(user, normalizedRole, moduleKey);
}

async function userHasDelegatedAccessControl(user) {
  if (!user?.id) return false;
  const overrides = await query(
    `SELECT can_access
     FROM user_module_access_overrides
     WHERE user_id = ?
       AND module_key = ?
       AND (permission_key = 'ACCESS' OR permission_key IS NULL OR permission_key = '')
     ORDER BY id DESC
     LIMIT 1`,
    [user.id, MODULE_KEYS.ACCESS_CONTROL]
  );
  return overrides.length ? Number(overrides[0].can_access) === 1 : false;
}

function enforceAccessControlActors() {
  return asyncHandler(async (req, res, next) => {
    const role = normalizeRole(req.user.role);
    if (isAnySystemDeveloperRole(role) || role === ROLES.HEAD_OF_INSTITUTION || role === ROLES.SYSTEM_ADMINISTRATOR) {
      return next();
    }
    const delegated = await userHasDelegatedAccessControl(req.user);
    if (!delegated) {
      return res.status(403).json({
        error:
          "Access Control is reserved for System Developer / Head of Institution unless the System Developer has granted you delegated access."
      });
    }
    return next();
  });
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
        error: buildModuleRightsErrorMessage(moduleKey, req.user)
      });
    }
    return next();
  });
}

function enforceAnyModuleAccess(moduleKeys = []) {
  const keys = Array.isArray(moduleKeys) ? moduleKeys.filter(Boolean) : [];
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
    if (!keys.length) return next();
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      if (await hasModuleAccess(req.user, key)) {
        return next();
      }
    }
    return res.status(403).json({
      error: `Access denied. You need rights to one of: ${keys.join(", ")}.`
    });
  });
}

function canManageAcrossInstitutions(user) {
  return isSuperSystemDeveloperRole(user?.role);
}

function resolveTenantInstitutionId(req) {
  const ownId = Number(req.user?.institution_id || 0);
  const overrideId = Number(req.body?.institution_id || req.query?.institution_id || 0);
  if (isAnySystemDeveloperRole(req.user?.role)) {
    const picked = overrideId || ownId;
    return Number.isFinite(picked) && picked > 0 ? picked : 0;
  }
  return Number.isFinite(ownId) && ownId > 0 ? ownId : 0;
}

async function getSystemDeveloperAssignedInstitutionIds(userId) {
  const normalizedUserId = Number(userId || 0);
  if (!normalizedUserId) return [];
  const rows = await query(
    `SELECT institution_id
     FROM system_developer_institution_assignments
     WHERE developer_user_id = ?
       AND is_active = 1`,
    [normalizedUserId]
  );
  return rows
    .map((row) => Number(row.institution_id || 0))
    .filter((id) => id > 0);
}

async function hasInstitutionScopeAccess(user, targetInstitutionId, options = {}) {
  const targetId = Number(targetInstitutionId || 0);
  if (!targetId) return false;
  if (canManageAcrossInstitutions(user)) return true;
  const role = normalizeRole(user?.role);
  const ownInstitutionId = Number(user?.institution_id || 0);
  const includeOwnInstitution = options.includeOwnInstitution !== false;
  if (includeOwnInstitution && ownInstitutionId === targetId) {
    return true;
  }
  if (role !== ROLES.SYSTEM_DEVELOPER) {
    return false;
  }
  const assignedInstitutionIds = await getSystemDeveloperAssignedInstitutionIds(user?.id);
  return assignedInstitutionIds.includes(targetId);
}

async function assertInstitutionScopeAccess(req, targetInstitutionId, forbiddenMessage) {
  const allowed = await hasInstitutionScopeAccess(req.user, targetInstitutionId);
  if (!allowed) {
    return {
      error: forbiddenMessage || "You are not allowed to access this institution scope.",
      status: 403
    };
  }
  return null;
}

async function loadInstitutionScopeOptions(user) {
  if (canManageAcrossInstitutions(user)) {
    return query(
      `SELECT id, institution_name, institution_code
       FROM institutions
       ORDER BY institution_name ASC`
    );
  }
  const ownInstitutionId = Number(user?.institution_id || 0);
  if (normalizeRole(user?.role) !== ROLES.SYSTEM_DEVELOPER) {
    return query(
      `SELECT id, institution_name, institution_code
       FROM institutions
       WHERE id = ?
       ORDER BY institution_name ASC`,
      [ownInstitutionId]
    );
  }
  const assignedIds = await getSystemDeveloperAssignedInstitutionIds(user?.id);
  const scopedIds = Array.from(new Set([ownInstitutionId, ...assignedIds])).filter((id) => id > 0);
  if (!scopedIds.length) return [];
  const placeholders = scopedIds.map(() => "?").join(", ");
  return query(
    `SELECT id, institution_name, institution_code
     FROM institutions
     WHERE id IN (${placeholders})
     ORDER BY institution_name ASC`,
    scopedIds
  );
}

function buildModuleRightsErrorMessage(moduleKey, user) {
  const role = normalizeRole(user?.role);
  if (isAnySystemDeveloperRole(role)) return null;
  return `Access denied for ${moduleKey}. Request rights from the System Developer.`;
}

function determineRecycleVisibilityScope(user) {
  const role = normalizeRole(user?.role);
  if (isAnySystemDeveloperRole(role)) {
    return { includeAllInstitutions: true, scopeInstitutionId: null };
  }
  return { includeAllInstitutions: false, scopeInstitutionId: Number(user?.institution_id || 0) || null };
}

function canPurgeRecycleItem(requestUser, recycleItem) {
  const actorRole = normalizeRole(requestUser?.role);
  if (isAnySystemDeveloperRole(actorRole)) {
    return { allowed: true, mode: "SYSTEM_DEVELOPER_PURGE" };
  }
  if (Number(recycleItem?.institution_id || 0) !== Number(requestUser?.institution_id || 0)) {
    return { allowed: false, mode: "OUT_OF_SCOPE" };
  }
  return { allowed: true, mode: "INSTITUTION_SOFT_PURGE" };
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

async function assertInstitutionAgreementAccess(req, institutionRow) {
  if (!institutionRow) {
    return { error: "Institution not found.", status: 404 };
  }
  const accessError = await assertInstitutionScopeAccess(
    req,
    institutionRow.id,
    "You are not allowed to access this institution's agreement."
  );
  if (accessError) {
    return accessError;
  }
  return null;
}

async function archiveRecycleBinItem({
  institutionId,
  entityName,
  entityId = null,
  payload = {},
  deletedByUserId = null,
  recycleContext = null
}) {
  const parsedPayload = payload && typeof payload === "object" ? { ...payload } : {};
  const existingMeta = parsedPayload.__recycle_meta && typeof parsedPayload.__recycle_meta === "object"
    ? parsedPayload.__recycle_meta
    : {};
  const mergedMeta = {
    ...existingMeta,
    ...(recycleContext && typeof recycleContext === "object" ? recycleContext : {}),
    deleted_by_user_id: Number(deletedByUserId) || null,
    deleted_at: dayjs().format("YYYY-MM-DD HH:mm:ss")
  };
  parsedPayload.__recycle_meta = mergedMeta;
  await query(
    `INSERT INTO recycle_bin_items
      (institution_id, entity_name, entity_id, archived_payload_json, deleted_by_user_id, status)
     VALUES (?, ?, ?, ?, ?, 'TRASHED')`,
    [
      institutionId,
      cleanValue(entityName),
      Number(entityId) || null,
      JSON.stringify(parsedPayload),
      Number(deletedByUserId) || null
    ]
  );
}

async function canManageInstitutionUser(reqUser, targetInstitutionId) {
  return hasInstitutionScopeAccess(reqUser, targetInstitutionId);
}

function buildRecycleContextFromRequest(req, extra = {}) {
  const authDetails = buildAuthAuditDetails(req, req?.user?.username || "", {});
  return {
    deleted_by_username: cleanValue(req?.user?.username || null) || null,
    deleted_by_full_name: cleanValue(req?.user?.full_name || null) || null,
    deleted_by_role: normalizeRole(req?.user?.role || ""),
    ip_address: cleanValue(authDetails?.ip_address || null) || null,
    machine_name: cleanValue(authDetails?.machine_name || null) || null,
    deleted_ip_address: cleanValue(authDetails?.ip_address || null) || null,
    deleted_machine_name: cleanValue(authDetails?.machine_name || null) || null,
    user_agent: cleanValue(authDetails?.user_agent || null) || null,
    ...extra
  };
}

function isSafeTableIdentifier(name) {
  return /^[a-z_][a-z0-9_]*$/i.test(cleanValue(name));
}

const cachedTableColumns = new Map();

async function getTableColumns(tableName) {
  if (!isSafeTableIdentifier(tableName)) return [];
  const cacheKey = String(tableName || "").trim().toLowerCase();
  if (cachedTableColumns.has(cacheKey)) {
    return cachedTableColumns.get(cacheKey);
  }
  const rows = await query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName]
  );
  const names = rows.map((row) => row.COLUMN_NAME);
  cachedTableColumns.set(cacheKey, names);
  return names;
}

/** Drops payload keys MySQL doesn't have yet (avoids ER_BAD_FIELD errors when schema drift / partial imports). */
async function filterRowByTableColumns(tableName, row) {
  const source = row && typeof row === "object" ? row : {};
  const keys = Object.keys(source);
  if (!keys.length) {
    return {};
  }
  const existing = await getExistingColumns(tableName, keys);
  const allow = new Set(existing);
  const out = {};
  for (const key of keys) {
    if (allow.has(key)) {
      out[key] = source[key];
    }
  }
  return out;
}

function getScopedFilter(config, user) {
  const normalizedRole = normalizeRole(user.role);
  const resolveScopedIdentity = (columnName) => {
    const normalizedColumn = cleanValue(columnName || "").toLowerCase();
    if (normalizedColumn.endsWith("_user_id") || normalizedColumn === "created_by_user_id") {
      return Number(user.id || 0) || null;
    }
    return cleanValue(user.full_name) || cleanValue(user.username);
  };
  if (
    config?.scopedByRole &&
    Array.isArray(config.scopedByRole.roles) &&
    config.scopedByRole.roles.includes(normalizedRole) &&
    config.scopedByRole.column
  ) {
    const identity = resolveScopedIdentity(config.scopedByRole.column);
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

function buildParallelOtpDeliveries(requestedChannel, account) {
  const emailAddr = cleanValue(account?.otp_email || "");
  const phoneAddr = cleanValue(account?.otp_phone || "");
  const normalized = cleanValue(requestedChannel).toLowerCase();
  const emailReady = Boolean(emailChannelReady());
  const smsReady = Boolean(smsChannelReady());
  const channels = [];
  if (normalized === "sms_email") {
    if (emailReady && emailAddr) channels.push({ channel: "email", destination: emailAddr });
    if (smsReady && phoneAddr) channels.push({ channel: "sms", destination: phoneAddr });
    if (!channels.length) return null;
    return { parallel: true, channels, primaryChannel: "sms_email", primaryDestination: `${emailAddr}|${phoneAddr}` };
  }
  if (normalized === "email") {
    if (emailReady && emailAddr) channels.push({ channel: "email", destination: emailAddr });
    else if (!emailReady && phoneAddr && smsReady) channels.push({ channel: "sms", destination: phoneAddr });
    else if (!emailReady && emailAddr) channels.push({ channel: "console", destination: emailAddr });
    else return null;
  } else if (normalized === "sms") {
    if (smsReady && phoneAddr) channels.push({ channel: "sms", destination: phoneAddr });
    else if (!smsReady && emailAddr && emailReady) channels.push({ channel: "email", destination: emailAddr });
    else if (!smsReady && phoneAddr) channels.push({ channel: "console", destination: phoneAddr });
    else return null;
  } else if (normalized === "console") {
    channels.push({ channel: "console", destination: cleanValue(account?.destination || account?.identity || "console") });
  } else {
    return null;
  }
  if (!channels.length) return null;
  const primary = channels[0];
  return {
    parallel: normalized === "sms_email",
    channels,
    primaryChannel: primary.channel,
    primaryDestination: primary.destination
  };
}

function buildForgotPasswordOtpDeliveryPlan(requestedChannel, contactDestination) {
  const dest = cleanValue(contactDestination);
  if (!dest) return null;
  const normalized = cleanValue(requestedChannel).toLowerCase();
  const emailReady = Boolean(emailChannelReady());
  const smsReady = Boolean(smsChannelReady());
  if (normalized === "email") {
    if (emailReady) {
      return { parallel: false, channels: [{ channel: "email", destination: dest }], primaryChannel: "email", primaryDestination: dest };
    }
    return { parallel: false, channels: [{ channel: "console", destination: dest }], primaryChannel: "console", primaryDestination: dest };
  }
  if (normalized === "sms") {
    if (smsReady) {
      return { parallel: false, channels: [{ channel: "sms", destination: dest }], primaryChannel: "sms", primaryDestination: dest };
    }
    return { parallel: false, channels: [{ channel: "console", destination: dest }], primaryChannel: "console", primaryDestination: dest };
  }
  return null;
}

async function createOtpSession({
  identity,
  role,
  institutionId,
  payload,
  destination,
  channel,
  deliveryPlan = null
}) {
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
  const OTP_DISPATCH_TIMEOUT_MS = Number(process.env.OTP_DISPATCH_TIMEOUT_MS || 32000);
  const dispatchWithTimeout = async (entry) => {
    return Promise.race([
      sendOtp({
        channel: entry.channel,
        destination: entry.destination,
        code
      }).then(() => `${entry.channel}:ok`).catch((err) => `${entry.channel}:fail:${err?.message || "error"}`),
      new Promise((resolve) =>
        setTimeout(() => resolve(`${entry.channel}:timeout`), OTP_DISPATCH_TIMEOUT_MS)
      )
    ]);
  };

  const sendResults = [];
  if (deliveryPlan && Array.isArray(deliveryPlan.channels) && deliveryPlan.channels.length) {
    const settled = await Promise.allSettled(
      deliveryPlan.channels.map((entry) => dispatchWithTimeout(entry))
    );
    settled.forEach((r) => {
      if (r.status === "fulfilled") sendResults.push(r.value);
      else sendResults.push(`channel:fail:${r.reason?.message || "rejected"}`);
    });
  }
  if (!sendResults.length) {
    const single = await dispatchWithTimeout({ channel, destination });
    sendResults.push(single);
    if (single.endsWith(":timeout")) {
      // eslint-disable-next-line no-console
      console.warn("[otp] dispatch timeout; delivery may still arrive — check provider logs.");
    }
  }
  return { code, expiresAt, sendResults };
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
    otp_email: cleanValue(user.email) || null,
    otp_phone: cleanValue(user.phone) || null,
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
    otp_email: cleanValue(learner.parent_email) || null,
    otp_phone: cleanValue(learner.parent_phone) || null,
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
    otp_email: cleanValue(learner.parent_email) || null,
    otp_phone: cleanValue(learner.parent_phone) || null,
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
  const normalizePaginationValue = (value, { fallback, min = 0, max = 5000 }) => {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
  };
  const scopedInstitutionId = parseBoundedInt(institutionId, { fallback: 0, min: 0, max: 999999999 });
  if (!scopedInstitutionId) return [];
  const safeLimit = normalizePaginationValue(limit, { fallback: 50, min: 1, max: 5000 });
  const safeOffset = normalizePaginationValue(offset, { fallback: 0, min: 0, max: 1000000 });
  const usableFields = Array.isArray(searchFields)
    ? await getExistingColumns(table, searchFields)
    : [];
  const search = buildSearchWhere({
    fields: usableFields,
    queryValue: q,
    params: [scopedInstitutionId, ...(Array.isArray(extraParams) ? extraParams : [])]
  });
  const sql = `SELECT * FROM ${table}
               WHERE institution_id = ? ${extraWhere}${search.where}
               ORDER BY id DESC
               LIMIT ${safeLimit} OFFSET ${safeOffset}`;
  return query(sql, search.params);
}

async function getExistingColumns(tableName, candidateColumns = []) {
  const tableColumns = await getTableColumns(tableName);
  const available = new Set(tableColumns);
  return candidateColumns.filter((column) => available.has(column));
}

function sendBuildInfoJson(res) {
  res.set("Cache-Control", "no-store");
  res.json({
    build_stamp: IIMS_BUILD_STAMP,
    public_index: PUBLIC_INDEX_FINGERPRINT,
    public_dashboard: PUBLIC_DASHBOARD_FINGERPRINT,
    server_time: new Date().toISOString(),
    endpoints: ["/api/build-info", "/api/building-info"],
    tip:
      "Use ONLY the URL:port printed in this server banner. Stop all stray Node.exe (different port = old bundle). Reload dashboard with Ctrl+F5 / Ctrl+Shift+R. With DevTools open (F12), Network tab → Enable 'Disable cache' while verifying UI.",
    shortcuts: {
      hard_reload_windows_linux: ["Ctrl+F5", "Ctrl+Shift+R"],
      devtools_disable_cache:
        "F12 → Network → check 'Disable cache' (applies while DevTools stays open)."
    }
  });
}

app.get("/api/build-info", (_, res) => sendBuildInfoJson(res));
// Common typo when testing in the browser
app.get("/api/building-info", (_, res) => sendBuildInfoJson(res));

app.get("/api/meta", (_, res) => {
  const cbcLearningAreas = Array.from(
    new Set(
      CBC_LEVELS.flatMap((level) => [
        ...(Array.isArray(level.learningAreas) ? level.learningAreas : []),
        ...Object.values(level.pathways || {}).flatMap((areas) => (Array.isArray(areas) ? areas : []))
      ])
    )
  );
  res.json({
    roles: ROLES,
    permissions: PERMISSIONS,
    rolePermissions: ROLE_PERMISSIONS,
    gradeOptions: GRADES,
    cbcLevels: CBC_LEVELS,
    cbcLearningAreas,
    yearJoinedOptions: YEAR_JOINED_OPTIONS,
    yearJoinedWideOptions: YEAR_JOINED_WIDE_OPTIONS,
    formOptions: FORMS,
    termOptions: TERMS,
    genderOptions: GENDER_OPTIONS,
    nationalityOptions: WORLD_COUNTRY_OPTIONS,
    religionOptions: RELIGION_OPTIONS,
    disabilityTypes: DISABILITY_TYPE_OPTIONS,
    kenyaCountyOptions: COUNTIES.map((c) => `${c.name} (${c.code})`).concat(["Others"]),
    postalCodeTownOptions: Array.from(
      new Set(
        (Array.isArray(KENYA_POSTAL_CODES) ? KENYA_POSTAL_CODES : []).map((row) => {
          const code = cleanValue(row?.postal_code || "");
          const town = cleanValue(row?.town || row?.area || "");
          return `${code} — ${town || "Town"}`;
        })
      )
    ),
    kenyaPostalCodeSelectOptions: (Array.isArray(KENYA_POSTAL_CODES) ? KENYA_POSTAL_CODES : []).map((row) => {
      const code = cleanValue(row?.postal_code || "");
      const town = cleanValue(row?.town || row?.area || "");
      return {
        value: code,
        label: `${code} — ${town || "Town"}`,
        town: town || ""
      };
    }),
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

function friendlyModuleLabel(moduleKey = "") {
  return String(moduleKey || "")
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

app.post(
  "/api/dashboard/assistant",
  auth,
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const prompt = cleanValue(req.body?.prompt || "");
    const normalizedPrompt = prompt.toLowerCase();
    const allModuleKeys = Array.from(new Set(Object.values(MODULE_KEYS)));
    const moduleHints = [
      {
        module: "register-center",
        keywords: ["register", "registration", "institution registration", "user registration", "hoi registration", "system administrator registration"],
        guidance:
          "Open Institution Registration. Sub-modules: Institution Registration, SSD/SD Registration, HOI/Admin/System Administrator Registration, User Registration."
      },
      {
        module: "admission",
        keywords: ["admission", "learner", "bio data", "learners registration", "admission register", "admission letter", "admission form"],
        guidance:
          "Open Admission. Sub-modules: Learners Registration, Admission Register, Admission Form, Admission Letter."
      },
      {
        module: "cbc-curriculum-editor",
        keywords: ["exam", "curriculum", "marks", "result", "assessment", "performance"],
        guidance:
          "Open Examination Management. Sub-modules: Curriculum, Exam Generation, Marks Entry, Result Scripts, Assessment Report, Learner Performance Record."
      },
      {
        module: "institutions-users-registry",
        keywords: ["institution uploads", "institution documents", "letterhead", "logo", "template", "institution edit"],
        guidance:
          "Open Institution Edit Module / Institution Uploads to select institution, upload templates/docs, and auto-map documents per tenant."
      },
      {
        module: "access-control",
        keywords: ["access", "rights", "permissions", "module rights", "authorization"],
        guidance:
          "Open Access Control (Module Rights), select user, then enable module/sub-module/sub-sub-module permissions and save overrides."
      },
      {
        module: "security-audit",
        keywords: ["audit", "security", "logging", "login logs"],
        guidance:
          "Open Security & Logging Audit to review login and activity audit records."
      },
      {
        module: "communication-messages",
        keywords: ["sms", "message", "communication", "recipient"],
        guidance:
          "Open SMS and Communication. Select message type and recipient role; recipient contact can auto-fill from bio-data."
      }
    ];
    const allowedModules = [];
    const lockedModules = [];
    for (const moduleKey of allModuleKeys) {
      // eslint-disable-next-line no-await-in-loop
      const allowed = await hasModuleAccess(req.user, moduleKey);
      if (allowed) {
        allowedModules.push(moduleKey);
      } else {
        lockedModules.push(moduleKey);
      }
    }
    const matchedHint = moduleHints.find((hint) => hint.keywords.some((key) => normalizedPrompt.includes(key)));
    const suggestedModule = matchedHint?.module || null;
    const canAccessSuggested = suggestedModule ? allowedModules.includes(suggestedModule) : false;
    const fallbackTop = allowedModules.slice(0, 10).map((key) => friendlyModuleLabel(key));
    let answer = "";
    if (!prompt) {
      answer = `Ask any module/sub-module question. Available modules in your scope: ${fallbackTop.join(", ")}.`;
    } else if (matchedHint && canAccessSuggested) {
      answer = `${matchedHint.guidance}`;
    } else if (matchedHint && !canAccessSuggested) {
      answer = `${matchedHint.guidance} This module is currently locked for your user rights. Request access from System Developer / Institution System Administrator.`;
    } else {
      const suggestion = fallbackTop.length
        ? `Try one of: ${fallbackTop.slice(0, 6).join(", ")}.`
        : "No module list was available for this account.";
      answer = `I could not map that question exactly, but I can guide module and sub-module navigation. ${suggestion} For complex technical issues consult System Developer / Institution System Administrator.`;
    }
    res.json({
      answer,
      prompt,
      matched_module: suggestedModule,
      allowed_modules: allowedModules,
      locked_modules: lockedModules
    });
  })
);

app.get("/api/health", asyncHandler(async (_, res) => {
  await query("SELECT 1");
  res.json({ status: "ok", service: "IIMS API" });
}));

app.get("/api/health/messaging", (_, res) => {
  res.json({
    smtp_configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    twilio_sms_configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
    twilio_verify_configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID),
    otp_channels_supported: ["console", "email", "sms", "sms_email"],
    build_stamp: IIMS_BUILD_STAMP
  });
});

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
  const isSuperSystemDeveloperLogin =
    isSuperSystemDeveloperRole(account?.role) ||
    (isAnySystemDeveloperRole(account?.role) && isSuperSystemDeveloperUsername(account?.payload?.username || account?.identity));
  if (isSuperSystemDeveloperLogin) {
    const directPayload = {
      ...(account.payload || {}),
      role: normalizeRole(account.role),
      login_session_started_at: dayjs().format("YYYY-MM-DD HH:mm:ss")
    };
    const directToken = issueToken(directPayload);
    const superLoginAuditDetails = await augmentAuthAuditDetailsWithInstitution(
      buildAuthAuditDetails(req, directPayload.username || username, {
        password_correct: true,
        otp_correct: true,
        otp_bypassed: true,
        role: directPayload.role,
        activity_done: "LOGIN_SUCCESS"
      }),
      directPayload.institution_id
    );
    await auditLog(directPayload, "LOGIN_SUCCESS", "auth", directPayload.id, superLoginAuditDetails);
    return res.json({
      message: "Super System Developer login successful.",
      token: directToken,
      role: directPayload.role,
      portal: toPortal(directPayload.role),
      otp_required: false,
      user: directPayload
    });
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

  const requestedChannel =
    cleanValue(otpChannel || process.env.OTP_CHANNEL || "sms_email").toLowerCase() || "sms_email";
  const deliveryPlan =
    buildParallelOtpDeliveries(requestedChannel, account) ||
    buildParallelOtpDeliveries("sms_email", account) ||
    buildParallelOtpDeliveries("console", account);
  const effectiveChannel = deliveryPlan?.primaryChannel || "console";
  const effectiveDestination =
    deliveryPlan?.primaryDestination || cleanValue(account.destination) || cleanValue(account.identity) || "console";
  const otpSession = await createOtpSession({
    identity: account.identity,
    role: account.role,
    institutionId: account.institution_id,
    payload: account.payload,
    destination: effectiveDestination,
    channel: effectiveChannel,
    deliveryPlan
  });
  const sendLog = otpSession.sendResults || [];
  const okSteps = sendLog.filter((line) => typeof line === "string" && line.endsWith(":ok"));
  const allDeliveriesFailed = sendLog.length > 0 && okSteps.length === 0;
  const nodeEnvLower = String(process.env.NODE_ENV || "").toLowerCase();
  const consoleOtpOnFailure =
    nodeEnvLower !== "production" &&
    parseTruthy(process.env.IMIS_CONSOLE_OTP_ON_DISPATCH_FAILURE || process.env.IMIS_CONSOLE_OTP_ON_FAILURE);
  if (consoleOtpOnFailure && allDeliveriesFailed) {
    // eslint-disable-next-line no-console
    console.warn(
      `[OTP][development console fallback only] OTP for ${cleanValue(username)} after failed dispatch: ${otpSession.code}`
    );
  }
  const loggedOtpDetails = await augmentAuthAuditDetailsWithInstitution(
    buildAuthAuditDetails(req, username, {
      password_correct: true,
      otp_correct: false,
      otp_channel_requested: requestedChannel,
      otp_channel_used: effectiveChannel,
      otp_channels_delivered: otpSession.sendResults || [],
      otp_expires_at: otpSession.expiresAt
    }),
    account.institution_id
  );
  await auditLog(
    {
      institution_id: account?.institution_id || null,
      id: account?.payload?.id || null,
      role: account?.role || "PUBLIC"
    },
    "OTP_REQUESTED",
    "otp_sessions",
    null,
    loggedOtpDetails
  );

  const usedFallbackFromLogin = requestedChannel !== effectiveChannel && effectiveChannel === "console";
  const smsEmailPartial =
    requestedChannel === "sms_email" &&
    okSteps.length > 0 &&
    deliveryPlan?.channels?.length &&
    okSteps.length < deliveryPlan.channels.length;

  let messageBody = "OTP sent. Check SMS and Email for your code.";
  if (effectiveChannel === "console" || (sendLog.length && !okSteps.length)) {
    messageBody =
      "OTP could not be delivered through SMS or Email. Configure SendGrid/SMTP and Africa's Talking/Twilio, ensure your profile lists email/mobile, then try again.";
  } else if (smsEmailPartial) {
    messageBody =
      `OTP reached ${okSteps.length} channel(s); another destination failed — see otp_delivery_log in the developer tools network response.`;
  } else if (usedFallbackFromLogin) {
    messageBody =
      `Login requested ${requestedChannel}; delivery fell back because a provider is missing — verify SMTP/SMS credentials and profile contacts.`;
  }

  const otpExpirySeconds = Math.max(Number(process.env.OTP_EXPIRY_MINUTES || 10), 1) * 60;

  return res.json({
    message: messageBody,
    role: account.role,
    portal: toPortal(account.role),
    otp_channel: effectiveChannel,
    otp_channel_requested: requestedChannel,
    otp_channel_used: effectiveChannel,
    otp_delivery_log: otpSession.sendResults || [],
    otp_resend_available_after_seconds: OTP_RESEND_COOLDOWN_SECONDS,
    otp_expires_in_seconds: otpExpirySeconds
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
  const loginAuditDetails = await augmentAuthAuditDetailsWithInstitution(
    buildAuthAuditDetails(req, payload.username || username, {
      password_correct: true,
      otp_correct: true,
      login_time: payload.login_session_started_at,
      activity_done: "LOGIN_SUCCESS",
      role: payload.role
    }),
    payload.institution_id
  );
  await auditLog(payload, "LOGIN_SUCCESS", "auth", payload.id, loginAuditDetails);

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
            i.institution_name, i.institution_code, i.letterhead_file_path
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
  const logoutDetails = await augmentAuthAuditDetailsWithInstitution(
    buildAuthAuditDetails(req, req.user?.username, {
      password_correct: true,
      otp_correct: true,
      login_time: req.user?.login_session_started_at || null,
      logout_time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      activity_done: "LOGOUT",
      logging_status: "SUCCESSFUL"
    }),
    req.user?.institution_id
  );
  await auditLog(req.user, "LOGOUT", "auth", req.user?.id || null, logoutDetails);
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

app.patch("/api/system-developer/credentials", auth, accountMutationRateLimit, accountMutationCooldown, enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]), asyncHandler(async (req, res) => {
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
       AND role IN (?, ?)
     ORDER BY id ASC
     LIMIT 1`,
    [currentUsername, ROLES.SYSTEM_DEVELOPER, ROLES.SUPER_SYSTEM_DEVELOPER]
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

app.get(
  "/api/public/online-admission/institutions-summary",
  publicReadRateLimit,
  asyncHandler(async (_, res) => {
    const rows = await query(
      `SELECT id, institution_name, institution_code
       FROM institutions
       WHERE is_active = 1 AND (is_suspended = 0 OR is_suspended IS NULL)
       ORDER BY institution_name ASC
       LIMIT 500`
    );
    res.json({
      institutions: rows.map((row) => ({
        id: row.id,
        institution_name: cleanValue(row.institution_name || ""),
        institution_code: cleanValue(row.institution_code || "")
      }))
    });
  })
);

app.post(
  "/api/public/online-admission-requests",
  publicWriteRateLimit,
  enforcePublicSecurity,
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.body?.institution_id || 0);
    const learnerName = cleanValue(req.body?.learner_full_name || req.body?.learner_name);
    const learnerType = cleanValue(req.body?.learner_type || "NEW").toUpperCase();
    const gradeOrForm = cleanOptionalValue(req.body?.grade_or_form || req.body?.grade);
    const stream = cleanOptionalValue(req.body?.stream);
    const applicantEmail = cleanOptionalValue(req.body?.applicant_email);
    const applicantPhone = cleanOptionalValue(req.body?.applicant_mobile || req.body?.applicant_phone);
    const extras =
      req.body?.payload_json && typeof req.body.payload_json === "object"
        ? req.body.payload_json
        : req.body?.details && typeof req.body.details === "object"
          ? req.body.details
          : {};

    if (Array.isArray(req.body?.learning_areas) && req.body.learning_areas.length) {
      extras.learning_areas = req.body.learning_areas
        .map((item) => cleanValue(item || ""))
        .filter(Boolean)
        .slice(0, 36);
    }

    if (!institutionId) {
      return res.status(400).json({ error: "institution_id is required." });
    }
    if (!learnerName) {
      return res.status(400).json({ error: "learner_full_name is required." });
    }

    const instRows = await query(
      `SELECT id, institution_name, institution_code, is_active, is_suspended
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [institutionId]
    );
    if (!instRows.length) {
      return res.status(404).json({ error: "Selected institution could not be found." });
    }
    const institution = instRows[0];
    if (Number(institution.is_active || 0) !== 1 || Number(institution.is_suspended || 0) === 1) {
      return res.status(409).json({ error: "This institution is not accepting online admission requests." });
    }

    const normalizedType =
      learnerType === "TRANSFER" || learnerType === "TRANSFERRED" ? "TRANSFER" : learnerType === "NEW" ? "NEW" : "NEW";

    const result = await query(
      `INSERT INTO online_admission_requests
        (institution_id, applicant_email, applicant_phone, learner_name, learner_type, grade_or_form, stream, payload_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        institutionId,
        applicantEmail || null,
        applicantPhone || null,
        learnerName,
        normalizedType,
        gradeOrForm || null,
        stream || null,
        JSON.stringify(extras || {})
      ]
    );
    await auditLog(
      { institution_id: institutionId, id: null, role: "PUBLIC_APPLICANT" },
      "ONLINE_ADMISSION_REQUEST_SUBMIT",
      "online_admission_requests",
      result.insertId,
      { learner_name: learnerName }
    );

    const notifyRecipients = async () => {
      const stakeholderRows = await query(
        `SELECT email, phone
         FROM users
         WHERE institution_id = ?
           AND is_active = 1
           AND role IN (?, ?, ?)
           AND (email IS NOT NULL OR phone IS NOT NULL)`,
        [institutionId, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SYSTEM_ADMINISTRATOR]
      );
      const devRows = await query(
        `SELECT email, phone
         FROM users
         WHERE role IN (?, ?)
           AND is_active = 1
           AND email IS NOT NULL`,
        [ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER]
      );
      const reference = `#${result.insertId}`;
      const institutionLabel = cleanValue(institution.institution_name || "");
      const emailSubject = `IMIS admission request (${institutionLabel})`;
      const emailBodyLines = [
        `A learner admission request (${reference}) was submitted for ${institutionLabel}.`,
        `Learner: ${learnerName}`,
        `Parent/Applicant Email: ${applicantEmail || "n/a"}`,
        `Grade/Form: ${gradeOrForm || "n/a"} | Stream: ${stream || "n/a"}`,
        `Learning areas: ${
          Array.isArray(extras?.learning_areas) && extras.learning_areas.length
            ? extras.learning_areas.join("; ")
            : "n/a"
        }`,
        "Open Admission → Admission Processing Hub to review.",
        "",
        "(Automated admission notification — do not reply.)"
      ];
      const emailBodyText = emailBodyLines.join("\n");
      const smsTemplate = `${reference}: ${learnerName} admission for ${institutionLabel}.`;

      await Promise.all(
        [...stakeholderRows, ...devRows].flatMap((row) => {
          const jobs = [];
          if (cleanValue(row.email) && emailChannelReady()) {
            jobs.push(sendTransactionalEmail({ to: cleanValue(row.email), subject: emailSubject, text: emailBodyText }));
          }
          if (cleanValue(row.phone) && smsChannelReady()) {
            jobs.push(sendTransactionalSms({ to: cleanValue(row.phone), text: smsTemplate }));
          }
          return jobs.map((promise) =>
            promise.catch((err) => {
              // eslint-disable-next-line no-console
              console.warn("[online-admission] notify failure:", err?.message || err);
            })
          );
        })
      );
      if (applicantEmail && emailChannelReady()) {
        const trackerBase =
          cleanOptionalValue(process.env.ADMISSION_PUBLIC_BASE_URL || "").replace(/\/$/, "") || "";
        const trackerUrlLine = trackerBase ? [`Or open directly: ${trackerBase}/admission-portal.html`] : [];
        await sendTransactionalEmail({
          to: applicantEmail,
          subject: "IMIS — Admission Request Received",
          text: [
            "REQUEST RECEIVED:",
            institutionLabel,
            learnerName ? `Learner: ${learnerName}` : "",
            `Learning areas noted: ${
              Array.isArray(extras?.learning_areas) && extras.learning_areas.length
                ? extras.learning_areas.join("; ")
                : "n/a"
            }`,
            "Please wait for the institution to respond.",
            `Reference ID: ${result.insertId}`,
            "",
            "Track status: open Admission Portal (/admission-portal.html) → Track application → enter Reference ID and this exact email.",
            ...trackerUrlLine,
            "",
            "(Do not reply unless your deployment configures inbound mail.)"
          ].join("\n")
        }).catch(() => {});
      }
      if (applicantPhone && smsChannelReady()) {
        await sendTransactionalSms({
          to: applicantPhone,
          text: `IMIS admissions: Ref ${result.insertId} for ${learnerName} at ${institutionLabel}. Track on admission portal with ID + email.`
        }).catch(() => {});
      }
    };

    setImmediate(() => {
      notifyRecipients().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[online-admission] stakeholder notify cascade failed:", err?.message || err);
      });
    });

    res.json({
      message: "REQUEST SENT SUCCESSFULLY. PLEASE WAIT FOR INSTITUTION RESPONSE.",
      request_id: result.insertId
    });
  })
);

app.post(
  "/api/public/online-admission/lookup-status",
  publicAdmissionLookupRateLimit,
  enforcePublicSecurity,
  asyncHandler(async (req, res) => {
    const requestId = Number(req.body?.request_id || req.body?.id || 0);
    const applicantEmail = cleanOptionalValue(req.body?.applicant_email || req.body?.email);
    if (!requestId) {
      return res.status(400).json({ error: "request_id is required." });
    }
    if (!applicantEmail) {
      return res.status(400).json({ error: "applicant_email is required." });
    }
    const emailKey = applicantEmail.trim().toLowerCase();
    const rows = await query(
      `SELECT r.id,
              r.institution_id,
              r.learner_name,
              r.learner_type,
              r.grade_or_form,
              r.stream,
              r.status,
              r.applicant_email,
              r.applicant_phone,
              r.created_at,
              r.updated_at,
              r.reviewed_at,
              r.review_comment,
              i.institution_name
       FROM online_admission_requests r
       INNER JOIN institutions i ON i.id = r.institution_id
       WHERE r.id = ?
       LIMIT 1`,
      [requestId]
    );
    const ambiguousResponse = async () => {
      await delayWithRandomJitter();
      return res.status(404).json({ error: "No matching admission request was found." });
    };
    if (!rows.length) {
      return ambiguousResponse();
    }
    const record = rows[0];
    const storedEmail = String(record.applicant_email || "").trim().toLowerCase();
    if (!storedEmail || storedEmail !== emailKey) {
      return ambiguousResponse();
    }
    const truncateComment = (value) => {
      const cleaned = cleanOptionalValue(value || "");
      if (!cleaned) return "";
      return cleaned.slice(0, 4000);
    };
    res.json({
      request_id: record.id,
      institution_name: cleanValue(record.institution_name || ""),
      learner_name: cleanValue(record.learner_name || ""),
      learner_type: cleanValue(record.learner_type || ""),
      grade_or_form: cleanOptionalValue(record.grade_or_form),
      stream: cleanOptionalValue(record.stream),
      status: cleanValue(record.status || ""),
      applicant_email: storedEmail,
      submitted_at: record.created_at ? dayjs(record.created_at).format("YYYY-MM-DD HH:mm:ss") : null,
      last_updated_at: record.updated_at ? dayjs(record.updated_at).format("YYYY-MM-DD HH:mm:ss") : null,
      institution_response_at: record.reviewed_at ? dayjs(record.reviewed_at).format("YYYY-MM-DD HH:mm:ss") : null,
      institution_comment: truncateComment(record.review_comment)
    });
  })
);

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
    const recoveryDeliveryPlan = buildForgotPasswordOtpDeliveryPlan(channel, contactDestination);
    const effectiveRecoveryChannel = recoveryDeliveryPlan?.primaryChannel || channel;
    const otpSession = await createOtpSession({
      identity,
      role: "PUBLIC_PASSWORD_RESET",
      institutionId: user.institution_id,
      payload,
      destination: recoveryDeliveryPlan?.primaryDestination || contactDestination,
      channel: effectiveRecoveryChannel,
      deliveryPlan: recoveryDeliveryPlan
    });
    await auditLog(
      { institution_id: user.institution_id || null, id: user.id || null, role: "PUBLIC" },
      "PUBLIC_PASSWORD_RESET_OTP_REQUESTED",
      "otp_sessions",
      null,
      { username, otp_channel: channel, otp_expires_at: otpSession.expiresAt }
    );
    return res.json({
      message: `OTP delivered (see delivery log if a channel failed).`,
      otp_channel_used: channel,
      otp_delivery_log: otpSession.sendResults || [],
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
  const candidateModules = Object.values(MODULE_KEYS);
  const allowedModules = [];
  for (const moduleKey of candidateModules) {
    // Apply per-user overrides on top of deny-by-default role setup.
    // eslint-disable-next-line no-await-in-loop
    if (await hasModuleAccess(req.user, moduleKey)) {
      allowedModules.push(moduleKey);
    }
  }
  const passwordPolicy = evaluatePasswordRotation(req.user);
  const institution_scope_options = await loadInstitutionScopeOptions(req.user);
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
    password_days_remaining: passwordPolicy.remainingDays,
    institution_scope_options
  });
}));

app.get(
  "/api/system-developer/assigned-institutions",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const institutions = await loadInstitutionScopeOptions(req.user);
    res.json({ institutions });
  })
);

app.get(
  "/api/system-developer/institution-assignments",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const developerUserId = Number(req.query?.developer_user_id || 0) || null;
    const rows = await query(
      `SELECT a.id, a.developer_user_id, a.institution_id, a.is_active, a.created_at,
              d.username AS developer_username, d.full_name AS developer_name,
              i.institution_name, i.institution_code
       FROM system_developer_institution_assignments a
       INNER JOIN users d ON d.id = a.developer_user_id
       INNER JOIN institutions i ON i.id = a.institution_id
       WHERE (? IS NULL OR a.developer_user_id = ?)
       ORDER BY a.id DESC`,
      [developerUserId, developerUserId]
    );
    res.json({ assignments: rows });
  })
);

app.post(
  "/api/system-developer/institution-assignments",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const developerUserId = Number(req.body?.developer_user_id || 0);
    const institutionId = Number(req.body?.institution_id || 0);
    const isActive = Number(parseTruthy(req.body?.is_active ?? true));
    if (!developerUserId || !institutionId) {
      return res.status(400).json({ error: "developer_user_id and institution_id are required." });
    }
    const developerRows = await query(
      `SELECT id, role
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [developerUserId]
    );
    if (!developerRows.length) {
      return res.status(404).json({ error: "Developer account not found." });
    }
    const developerRole = normalizeRole(developerRows[0].role);
    if (developerRole !== ROLES.SYSTEM_DEVELOPER) {
      return res.status(400).json({ error: "Assignments can only be made to System Developer accounts." });
    }
    const institutionRows = await query(
      "SELECT id FROM institutions WHERE id = ? LIMIT 1",
      [institutionId]
    );
    if (!institutionRows.length) {
      return res.status(404).json({ error: "Institution not found." });
    }
    const existing = await query(
      `SELECT id
       FROM system_developer_institution_assignments
       WHERE developer_user_id = ? AND institution_id = ?
       LIMIT 1`,
      [developerUserId, institutionId]
    );
    if (existing.length) {
      await query(
        `UPDATE system_developer_institution_assignments
         SET is_active = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [isActive, existing[0].id]
      );
      return res.json({ message: "Assignment updated.", id: existing[0].id });
    }
    const result = await query(
      `INSERT INTO system_developer_institution_assignments
        (developer_user_id, institution_id, is_active, created_by_user_id)
       VALUES (?, ?, ?, ?)`,
      [developerUserId, institutionId, isActive, Number(req.user.id || 0) || null]
    );
    await auditLog(req.user, "ASSIGN_SYSTEM_DEVELOPER_INSTITUTION", "system_developer_institution_assignments", result.insertId, {
      developer_user_id: developerUserId,
      institution_id: institutionId,
      is_active: isActive
    });
    res.status(201).json({ message: "Assignment created.", id: result.insertId });
  })
);

app.delete(
  "/api/system-developer/institution-assignments/:id",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const assignmentId = Number(req.params.id || 0);
    if (!assignmentId) return res.status(400).json({ error: "Valid assignment id is required." });
    const result = await query(
      `DELETE FROM system_developer_institution_assignments
       WHERE id = ?`,
      [assignmentId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: "Assignment not found." });
    }
    await auditLog(req.user, "DELETE_SYSTEM_DEVELOPER_INSTITUTION_ASSIGNMENT", "system_developer_institution_assignments", assignmentId, {});
    res.json({ message: "Assignment removed." });
  })
);

app.post(
  "/api/portal/switch-institution",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.body?.institution_id || 0);
    if (!institutionId) {
      return res.status(400).json({ error: "institution_id is required." });
    }
    const allowed = await hasInstitutionScopeAccess(req.user, institutionId);
    if (!allowed) {
      return res.status(403).json({ error: "You are not assigned to this institution." });
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
    const switchedPayload = {
      ...req.user,
      institution_id: institutionId
    };
    const token = issueToken(switchedPayload);
    await auditLog(req.user, "SYSTEM_DEVELOPER_SWITCH_INSTITUTION", "institutions", institutionId, {
      from_institution_id: req.user.institution_id,
      to_institution_id: institutionId
    });
    res.json({
      message: "Institution scope switched successfully.",
      token,
      institution: institutions[0]
    });
  })
);

app.get(
  "/api/users/registrar-options",
  auth,
  enforceModuleAccess(MODULE_KEYS.REGISTRATION),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const canSeeAllInstitutions = canManageAcrossInstitutions(req.user);
    const requestedInstitutionId = Number(req.query?.institution_id || 0) || null;
    const scopeInstitutions = await loadInstitutionScopeOptions(req.user);
    const institutionScopeId = requestedInstitutionId || Number(req.user.institution_id || 0) || Number(scopeInstitutions[0]?.id || 0) || null;
    const scopedInstitutionIds = scopeInstitutions
      .map((item) => Number(item.id || 0))
      .filter((id) => id > 0)
      .filter((id) => !requestedInstitutionId || id === requestedInstitutionId);
    const institutionDetailColumns = await getExistingColumns("institutions", [
      "institution_name",
      "institution_code",
      "email",
      "phone",
      "county",
      "category",
      "sub_county",
      "location",
      "postal_address",
      "postal_code",
      "town",
      "institution_type",
      "institution_level",
      "created_at"
    ]);
    const institutions = scopedInstitutionIds.length
      ? await query(
        `SELECT id, ${institutionDetailColumns.join(", ")}
         FROM institutions
         WHERE id IN (${scopedInstitutionIds.map(() => "?").join(", ")})
         ORDER BY institution_name ASC`,
        scopedInstitutionIds
      )
      : [];
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
      can_view_registry_institutions: canSeeAllInstitutions || normalizeRole(req.user.role) === ROLES.SYSTEM_DEVELOPER,
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const institutionName = cleanValue(req.body?.institution_name);
    const institutionEmail = cleanOptionalValue(req.body?.email);
    const institutionPhone = normalizePhoneInput(req.body?.phone);
    const countyInput = cleanOptionalValue(req.body?.county);
    const countyCodeInput = cleanOptionalValue(req.body?.county_code);
    const categoryInput = cleanOptionalValue(req.body?.category);
    const subCounty = cleanOptionalValue(req.body?.sub_county);
    const location = cleanOptionalValue(req.body?.location);
    const village = cleanOptionalValue(req.body?.village);
    const postalAddress = cleanOptionalValue(req.body?.postal_address);
    const postalCodeInputRaw = cleanOptionalValue(req.body?.postal_code);
    const postalCodeInput = postalCodeInputRaw === "__manual__"
      ? cleanOptionalValue(req.body?.postal_code_manual)
      : postalCodeInputRaw;
    const townInput = cleanOptionalValue(req.body?.town);
    const sendAgreementEmail = parseTruthy(req.body?.send_agreement_email);

    const adminFullName = cleanValue(req.body?.admin_full_name);
    const adminUsername = cleanValue(req.body?.admin_username);
    if (adminUsername) {
      const adminUsernameValidationError = validateUsername(adminUsername, "admin_username");
      if (adminUsernameValidationError) {
        return res.status(400).json({ error: adminUsernameValidationError });
      }
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
    const shouldCreateAdminAccount = Boolean(adminFullName && adminUsername);
    const adminPassword = shouldCreateAdminAccount ? (adminPasswordInput || generateStrongPassword(14)) : null;
    if (adminPasswordInput && shouldCreateAdminAccount) {
      const weakAdminPasswordError = requireStrongPassword(adminPassword, "admin_password");
      if (weakAdminPasswordError) {
        return res.status(400).json({ error: weakAdminPasswordError });
      }
    }
    if (institutionPhone && !hasAllowedPhonePrefix(institutionPhone)) {
      return res.status(400).json({
        error: "Institution phone must start with 07, 01, +254, or +."
      });
    }

    if (!institutionName) {
      return res.status(400).json({
        error: "institution_name is required."
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
            (institution_name, institution_code, email, phone, county, category, sub_county, location, village, postal_address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            institutionName,
            institutionCode,
            institutionEmail,
            institutionPhone,
            countyRecord.name,
            categoryRecord.label,
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
    let credentialDispatch = null;
    if (shouldCreateAdminAccount) {
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
        "Welcome to IMIS for Basic Education Learning Institution.",
        "Your institution account has been registered successfully.",
        `Institution: ${institutionName}`,
        `Institution Code: ${institutionCode}`,
        `Username: ${adminUsername}`,
        `Password: ${adminPassword}`,
        "",
        "Login Link: www.theimis.com",
        "Please log in and change this password immediately after first sign-in."
      ].join("\n");
      credentialDispatch = await dispatchCredentialNotice({
        email: institutionEmail,
        phone: institutionPhone,
        subject: "IMIS Institution Administrator Credentials",
        message: credentialMessage
      });
    }

    const institutionRecord = {
      id: institutionId,
      institution_name: institutionName,
      institution_code: institutionCode,
      county: countyRecord.name,
      category: categoryRecord.label,
      email: institutionEmail,
      phone: institutionPhone
    };

    let agreementEmailDispatch = null;
    if (sendAgreementEmail && institutionEmail) {
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
      admin_username: adminUsername || null,
      admin_role: shouldCreateAdminAccount ? portalRole : null
    });

    res.status(201).json({
      message: shouldCreateAdminAccount
        ? "Institution and administrator account registered successfully."
        : "Institution registered successfully.",
      institution_id: institutionId,
      institution_code: institutionCode,
      admin_username: adminUsername || null,
      admin_password: null,
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
    const accessError = await assertInstitutionAgreementAccess(req, institution);
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
    const accessError = await assertInstitutionAgreementAccess(req, institution);
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
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const institutionIdFromQuery = Number(req.query?.institution_id || 0) || null;
    let institutionId = institutionIdFromQuery;
    if (!institutionId && cleanValue(req.query?.institution_code)) {
      const institutionRows = await query(
        `SELECT id
         FROM institutions
         WHERE institution_code = ?
         LIMIT 1`,
        [cleanValue(req.query?.institution_code).toUpperCase()]
      );
      institutionId = Number(institutionRows[0]?.id || 0) || null;
    }
    const heroImage = await resolveHeroImageAsset({ institutionId });
    res.json(heroImage);
  })
);

app.get(
  "/api/public/profile/by-username",
  publicWriteRateLimit,
  enforcePublicSecurity,
  asyncHandler(async (req, res) => {
    const username = cleanValue(req.query?.username);
    if (!username) {
      return res.status(400).json({ error: "username query parameter is required." });
    }
    const rows = await query(
      `SELECT u.id, u.username, i.id AS institution_id, i.institution_code
       FROM users u
       INNER JOIN institutions i ON i.id = u.institution_id
       WHERE u.username = ?
       LIMIT 1`,
      [username]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "User account not found." });
    }
    res.json({
      username: rows[0].username,
      institution_id: rows[0].institution_id,
      institution_code: rows[0].institution_code
    });
  })
);

app.post(
  "/api/system/branding/hero-image",
  auth,
  enforceModuleAccess(MODULE_KEYS.DASHBOARD),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.UPDATE),
  heroImageUploadMiddleware,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Hero image file is required." });
    }
    const institutionId = Number(req.user?.institution_id || 0);
    if (!institutionId) {
      return res.status(400).json({ error: "Institution scope is required for hero image upload." });
    }
    const uploadPath = `/uploads/${req.file.filename}`;
    await cleanupOldInstitutionHeroImage({ institutionId, currentUploadPath: uploadPath });
    await query(
      `UPDATE institutions
       SET login_hero_image_path = ?
       WHERE id = ?`,
      [uploadPath, institutionId]
    );
    const heroImage = await resolveHeroImageAsset({ institutionId });
    await auditLog(req.user, "UPLOAD_LOGIN_HERO_IMAGE", "branding", null, {
      institution_id: institutionId,
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
    const privilegedAdmissionBlinkRoles = new Set([
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.SYSTEM_ADMINISTRATOR,
      ROLES.SYSTEM_DEVELOPER,
      ROLES.SUPER_SYSTEM_DEVELOPER
    ]);
    let pendingOnlineAdmissionCount = 0;
    try {
      const normalizedDashboardRole = normalizeRole(req.user.role);
      if (privilegedAdmissionBlinkRoles.has(normalizedDashboardRole)) {
        let counterRows = [];
        if (isAnySystemDeveloperRole(normalizedDashboardRole)) {
          counterRows = await query(
            `SELECT COUNT(*) pending_count FROM online_admission_requests WHERE status = 'PENDING'`
          );
        } else {
          counterRows = await query(
            `SELECT COUNT(*) pending_count
             FROM online_admission_requests
             WHERE institution_id = ? AND status = 'PENDING'`,
            [institutionId]
          );
        }
        pendingOnlineAdmissionCount = toNumber(counterRows[0]?.pending_count);
      }
    } catch {
      pendingOnlineAdmissionCount = 0;
    }
    if (
      privilegedAdmissionBlinkRoles.has(normalizeRole(req.user.role)) &&
      pendingOnlineAdmissionCount > 0
    ) {
      alerts.unshift({
        severity: "admission-blink",
        title: "Online admission submissions pending",
        message: `${pendingOnlineAdmissionCount} admission request(s) require review.`,
        blink: true
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
      pending_online_admission_requests: pendingOnlineAdmissionCount,
      alerts,
      announcements
    });
  })
);

app.post(
  "/api/finance/session-sync",
  auth,
  enforceModuleAccess(MODULE_KEYS.FINANCE_FEE_PAYMENTS),
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
    try {
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
    const rowLimit = parseBoundedInt(limit, { fallback: 20, min: 1, max: 100 });

    const includeLearners = ["all", "learners", "learner", "grade", "stream"].includes(normalizedTarget);
    const includeTeachers = ["all", "teachers", "teacher"].includes(normalizedTarget);
    const includeParents = ["all", "parents", "parent"].includes(normalizedTarget);
    const includeBom = ["all", "bom"].includes(normalizedTarget);
    const includeInstitutions = ["all", "institutions", "institution"].includes(normalizedTarget);
    const includeUsers = ["all", "users", "user"].includes(normalizedTarget);
    const canSearchGlobalRegistry = canManageAcrossInstitutions(req.user);
    if (!canSearchGlobalRegistry && ["institutions", "institution", "users", "user"].includes(normalizedTarget)) {
      return res.status(403).json({
        error: "Institutions and users search scope is restricted to System Developer."
      });
    }

    const safeSearchRows = async (loader) => {
      try {
        return await loader();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[search] scope failed, returning []:", error?.code || error?.message, error?.sqlMessage || "");
        return [];
      }
    };

    const learnerColumns =
      includeLearners || includeParents
        ? await getTableColumns("learners")
        : [];
    const learnerColumnSet = new Set(learnerColumns);
    const hasLearnerColumn = (columnName) => learnerColumnSet.has(columnName);
    const learnerSearchFields = (await getExistingColumns("learners", [
      "full_name",
      "admission_number",
      "upi_number",
      "assessment_number",
      "birth_certificate_number"
    ])).filter(Boolean);
    const parentSearchFields = (await getExistingColumns("learners", [
      "parent_full_name",
      "parent_phone",
      "parent_email",
      "full_name",
      "upi_number",
      "assessment_number",
      "birth_certificate_number"
    ])).filter(Boolean);

    const learnerExtraWhereParts = [];
    const learnerExtraParams = [];
    if (cleanValue(grade) && hasLearnerColumn("grade")) {
      learnerExtraWhereParts.push(" AND grade = ?");
      learnerExtraParams.push(cleanValue(grade));
    }
    if (cleanValue(class_form)) {
      const classFormParts = [];
      if (hasLearnerColumn("grade")) {
        classFormParts.push("grade = ?");
        learnerExtraParams.push(cleanValue(class_form));
      }
      if (hasLearnerColumn("form_name")) {
        classFormParts.push("form_name = ?");
        learnerExtraParams.push(cleanValue(class_form));
      }
      if (classFormParts.length) {
        learnerExtraWhereParts.push(` AND (${classFormParts.join(" OR ")})`);
      }
    }
    if (cleanValue(stream) && hasLearnerColumn("stream")) {
      learnerExtraWhereParts.push(" AND stream = ?");
      learnerExtraParams.push(cleanValue(stream));
    }
    if (cleanValue(learner_status) && hasLearnerColumn("status")) {
      learnerExtraWhereParts.push(" AND status = ?");
      learnerExtraParams.push(cleanValue(learner_status));
    }
    const learnerExtraWhere = learnerExtraWhereParts.join("");

    const teacherColumns = includeTeachers ? await getTableColumns("teacher_profiles") : [];
    const teacherColumnSet = new Set(teacherColumns);
    const teacherExtraWhereParts = [];
    const teacherExtraParams = [];
    if (cleanValue(teacher_category)) {
      const teacherCategoryColumn = teacherColumnSet.has("category")
        ? "category"
        : teacherColumnSet.has("employment_status")
          ? "employment_status"
          : null;
      if (teacherCategoryColumn) {
        teacherExtraWhereParts.push(` AND ${teacherCategoryColumn} = ?`);
        teacherExtraParams.push(cleanValue(teacher_category));
      }
    }
    const teacherExtraWhere = teacherExtraWhereParts.join("");

    const learnerRows = includeLearners
      ? await safeSearchRows(() => getPaginatedRows({
        table: "learners",
        institutionId,
        searchFields: learnerSearchFields,
        q,
        extraWhere: learnerExtraWhere,
        extraParams: learnerExtraParams,
        limit: rowLimit
      }))
      : [];
    const sortedLearnerRows = learnerRows
      .slice()
      .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
    const teacherRows = includeTeachers
      ? await safeSearchRows(async () => {
        const teacherSearchFields = await getExistingColumns("teacher_profiles", [
          "full_name",
          "id_number",
          "tsc_number",
          "major_subject",
          "other_subject"
        ]);
        const fallbackTeacherFields = teacherSearchFields.length
          ? teacherSearchFields
          : ["full_name", "id_number", "tsc_number"];
        return getPaginatedRows({
          table: "teacher_profiles",
          institutionId,
          searchFields: fallbackTeacherFields,
          q,
          extraWhere: teacherExtraWhere,
          extraParams: teacherExtraParams,
          limit: rowLimit
        });
      })
      : [];
    const sortedTeacherRows = teacherRows
      .slice()
      .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
    const parentRows = includeParents
      ? await safeSearchRows(() => getPaginatedRows({
        table: "learners",
        institutionId,
        searchFields: parentSearchFields,
        q,
        extraWhere: learnerExtraWhere,
        extraParams: learnerExtraParams,
        limit: rowLimit
      }))
      : [];
    const sortedParentRows = parentRows
      .slice()
      .sort((a, b) => String(a.parent_full_name || "").localeCompare(String(b.parent_full_name || "")));
    const usersColumns = includeBom || (includeUsers && isSystemDeveloper)
      ? await getTableColumns("users")
      : [];
    const usersColumnSet = new Set(usersColumns);
    const bomRows = includeBom
      ? await safeSearchRows(async () => {
        if (!usersColumnSet.has("institution_id") || !usersColumnSet.has("role")) {
          return [];
        }
        const selectColumns = [
          usersColumnSet.has("id") ? "id" : "NULL AS id",
          usersColumnSet.has("full_name") ? "full_name" : "NULL AS full_name",
          usersColumnSet.has("username") ? "username" : "NULL AS username",
          usersColumnSet.has("role") ? "role" : "NULL AS role",
          usersColumnSet.has("email") ? "email" : "NULL AS email",
          usersColumnSet.has("phone") ? "phone" : "NULL AS phone",
          usersColumnSet.has("is_active") ? "is_active" : "1 AS is_active",
          usersColumnSet.has("created_at") ? "created_at" : "NULL AS created_at"
        ];
        const searchable = ["full_name", "username", "email", "phone"].filter((column) => usersColumnSet.has(column));
        const bomFilterParts = searchable.map((column) => `${column} LIKE CONCAT('%', ?, '%')`);
        const bomWhereClause = bomFilterParts.length
          ? `? = '' OR ${bomFilterParts.join(" OR ")}`
          : "? = ''";
        const orderColumn = usersColumnSet.has("full_name")
          ? "full_name"
          : usersColumnSet.has("username")
            ? "username"
            : "id";
        return query(
          `SELECT ${selectColumns.join(", ")}
           FROM users
           WHERE institution_id = ?
             AND UPPER(REPLACE(role, ' ', '_')) IN (?, ?)
             AND (${bomWhereClause})
           ORDER BY ${orderColumn} ASC
           LIMIT ?`,
          [
            institutionId,
            ROLES.BOM,
            "BOARD_OF_MANAGEMENT",
            cleanValue(q),
            ...searchable.map(() => cleanValue(q)),
            rowLimit
          ]
        );
      })
      : [];
    let institutionRows = [];
    if (includeInstitutions && isSystemDeveloper) {
      institutionRows = await safeSearchRows(async () => {
        const institutionColumns = await getTableColumns("institutions");
        const institutionColumnSet = new Set(institutionColumns);
        const categorySelect = institutionColumnSet.has("category")
          ? "category"
          : institutionColumnSet.has("sub_county")
            ? "sub_county AS category"
            : "NULL AS category";
        const selectColumns = [
          institutionColumnSet.has("id") ? "id" : "NULL AS id",
          institutionColumnSet.has("institution_name") ? "institution_name" : "NULL AS institution_name",
          institutionColumnSet.has("institution_code") ? "institution_code" : "NULL AS institution_code",
          institutionColumnSet.has("county") ? "county" : "NULL AS county",
          categorySelect,
          institutionColumnSet.has("email") ? "email" : "NULL AS email",
          institutionColumnSet.has("phone") ? "phone" : "NULL AS phone",
          institutionColumnSet.has("is_active") ? "is_active" : "1 AS is_active",
          institutionColumnSet.has("created_at") ? "created_at" : "NULL AS created_at"
        ];
        const searchable = ["institution_name", "institution_code", "county", "sub_county", "category", "email", "phone"]
          .filter((column) => institutionColumnSet.has(column));
        const searchClause = searchable.length
          ? `? = '' OR ${searchable.map((column) => `${column} LIKE CONCAT('%', ?, '%')`).join(" OR ")}`
          : "? = ''";
        const orderColumn = institutionColumnSet.has("institution_name")
          ? "institution_name"
          : institutionColumnSet.has("institution_code")
            ? "institution_code"
            : "id";
        return query(
          `SELECT ${selectColumns.join(", ")}
           FROM institutions
           WHERE ${searchClause}
           ORDER BY ${orderColumn} ASC
           LIMIT ?`,
          [cleanValue(q), ...searchable.map(() => cleanValue(q)), rowLimit]
        );
      });
    }
    const userRows = includeUsers
      ? (isSystemDeveloper
        ? await safeSearchRows(async () => {
          const selectable = [
            usersColumnSet.has("id") ? "id" : "NULL AS id",
            usersColumnSet.has("institution_id") ? "institution_id" : "NULL AS institution_id",
            usersColumnSet.has("full_name") ? "full_name" : "NULL AS full_name",
            usersColumnSet.has("username") ? "username" : "NULL AS username",
            usersColumnSet.has("role") ? "role" : "NULL AS role",
            usersColumnSet.has("email") ? "email" : "NULL AS email",
            usersColumnSet.has("phone") ? "phone" : "NULL AS phone",
            usersColumnSet.has("is_active") ? "is_active" : "1 AS is_active",
            usersColumnSet.has("created_at") ? "created_at" : "NULL AS created_at"
          ];
          const searchable = ["full_name", "username", "role", "email", "phone"]
            .filter((column) => usersColumnSet.has(column));
          const whereClause = searchable.length
            ? `? = '' OR ${searchable.map((column) => `${column} LIKE CONCAT('%', ?, '%')`).join(" OR ")}`
            : "? = ''";
          const orderColumn = usersColumnSet.has("full_name")
            ? "full_name"
            : usersColumnSet.has("username")
              ? "username"
              : "id";
          return query(
            `SELECT ${selectable.join(", ")}
             FROM users
             WHERE ${whereClause}
             ORDER BY ${orderColumn} ASC
             LIMIT ?`,
            [cleanValue(q), ...searchable.map(() => cleanValue(q)), rowLimit]
          );
        })
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
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[search] endpoint error:", err?.code || err?.message, err?.sqlMessage || "");
      return res.json({
        filters_applied: { target: "all", limit: Number(req.query?.limit) || 20 },
        totals: { learners: 0, teachers: 0, parents: 0, bom: 0, institutions: 0, users: 0 },
        learners: [], teachers: [], parents: [], bom: [], institutions: [], users: [], parentsAndBom: [],
        warning: "Search degraded (schema mismatch). Empty results returned."
      });
    }
  })
);

app.post(
  "/api/search/export/pdf",
  auth,
  enforceModuleAccess(MODULE_KEYS.SEARCH),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const scope = cleanValue(req.body?.scope || "search_record");
    const rowPayload = req.body?.row;
    if (!rowPayload || typeof rowPayload !== "object") {
      return res.status(400).json({ error: "row payload is required." });
    }
    const row = { ...rowPayload };
    delete row.password_hash;
    delete row.learner_password_hash;
    delete row.details_json;
    const lines = [
      "IMIS SEARCH RECORD EXPORT",
      `Scope: ${scope || "-"}`,
      `Generated At: ${dayjs().format("YYYY-MM-DD HH:mm:ss")}`,
      ""
    ];
    Object.entries(row).forEach(([key, value]) => {
      lines.push(`${toTitleCase(key)}: ${cleanValue(value) || "-"}`);
    });
    sendSimplePdf(
      res,
      `search-${scope.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}`,
      lines
    );
  })
);

app.get(
  "/api/users",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    if (canManageAcrossInstitutions(req.user)) {
      const users = await query(
        `SELECT u.id, u.institution_id, u.full_name, u.username, u.role, u.email, u.phone, u.is_active, u.created_at,
                u.is_suspended, u.suspended_reason, u.status_reason,
                i.institution_name, i.institution_code
         FROM users u
         INNER JOIN institutions i ON i.id = u.institution_id
         ORDER BY institution_id ASC, id DESC`
      );
      return res.json(users);
    }
    const users = await query(
      `SELECT u.id, u.institution_id, u.full_name, u.username, u.role, u.email, u.phone, u.is_active, u.created_at,
              u.is_suspended, u.suspended_reason, u.status_reason,
              i.institution_name, i.institution_code
       FROM users u
       INNER JOIN institutions i ON i.id = u.institution_id
       WHERE u.institution_id = ?
         AND u.role NOT IN (?, ?)
       ORDER BY u.id DESC`,
      [req.user.institution_id, ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER]
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const { full_name, username, role, email, phone } = req.body;
    if (!full_name || !username || !role) {
      return res.status(400).json({ error: "full_name, username, and role are required." });
    }
    if (!cleanOptionalValue(email) && !cleanOptionalValue(phone)) {
      return res.status(400).json({ error: "Either email or phone is required." });
    }
    const requestedPassword = cleanOptionalValue(req.body?.password);
    const shouldAutoGeneratePassword = parseTruthy(req.body?.auto_generate_password) || !requestedPassword;
    const password = shouldAutoGeneratePassword ? generateStrongPassword(12) : requestedPassword;
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
      const roleLabel = normalizedRole === ROLES.SUPER_SYSTEM_DEVELOPER
        ? "Super System Developer"
        : "System Developer";
      return res.status(409).json({
        error: `${roleLabel} registration limit reached. Maximum allowed is ${roleCapacity.max}.`,
        current_total: roleCapacity.total,
        max_allowed: roleCapacity.max
      });
    }
    const passwordHash = await hashPassword(password);
    const isRotationExempt = PASSWORD_ROTATION_EXEMPT_ROLES.has(normalizedRole);
    const targetInstitutionId =
      isAnySystemDeveloperRole(req.user.role)
        ? Number(req.body?.institution_id || req.user.institution_id)
        : req.user.institution_id;
    if (!targetInstitutionId) {
      return res.status(400).json({ error: "institution_id is required for this operation." });
    }
    if (isAnySystemDeveloperRole(req.user.role) && !canManageAcrossInstitutions(req.user)) {
      const scopeError = await assertInstitutionScopeAccess(
        req,
        targetInstitutionId,
        "You can only register users within your assigned institutions."
      );
      if (scopeError) {
        return res.status(scopeError.status).json({ error: scopeError.error });
      }
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
    const institutionRows = await query(
      `SELECT institution_name, institution_code
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [targetInstitutionId]
    );
    const institutionName = cleanValue(institutionRows[0]?.institution_name) || "Institution";
    const institutionCode = cleanValue(institutionRows[0]?.institution_code) || "-";
    await auditLog(req.user, "CREATE_USER", "users", result.insertId, {
      username,
      role: normalizedRole,
      institution_id: targetInstitutionId
    });
    const welcomeDispatchMode = cleanValue(req.body?.send_welcome_via).toUpperCase() || "BOTH";
    const welcomeDestination = {
      email: cleanOptionalValue(email),
      phone: cleanOptionalValue(phone)
    };
    if (welcomeDispatchMode === "EMAIL") {
      welcomeDestination.phone = null;
    } else if (welcomeDispatchMode === "SMS") {
      welcomeDestination.email = null;
    } else if (welcomeDispatchMode === "NONE") {
      welcomeDestination.email = null;
      welcomeDestination.phone = null;
    }
    const credentialMessage = [
      "WELCOME TO IMIS SYSTEM FOR BASIC EDUCATION LEARNING INSTITUTIONS.",
      "This account is issued under institutional digital-governance and data-protection obligations.",
      `Institution: ${institutionName}`,
      `Institution Code: ${institutionCode}`,
      `Username: ${username}`,
      `Temporary Password: ${password}`,
      `Role: ${normalizedRole}`,
      "",
      "By accessing this account, you agree to authorized use, confidentiality, and compliance policies.",
      "Please change this password immediately after first login."
    ].join("\n");
    const credentialDispatch = await dispatchCredentialNotice({
      email: welcomeDestination.email,
      phone: welcomeDestination.phone,
      subject: "IMIS User Account Credentials",
      message: credentialMessage
    });
    res.status(201).json({
      id: result.insertId,
      message: "User created successfully.",
      credential_dispatch: credentialDispatch,
      welcome_dispatch_mode: welcomeDispatchMode,
      generated_password: isAnySystemDeveloperRole(req.user.role) ? password : null
    });
  })
);

app.post(
  "/api/management/staff-portal-account",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const allowedStaffModule =
      (await hasModuleAccess(req.user, MODULE_KEYS.STAFF_SERVICE_PROVIDERS)) ||
      (await hasModuleAccess(req.user, MODULE_KEYS.MANAGEMENT_TEACHERS)) ||
      (await hasModuleAccess(req.user, MODULE_KEYS.MANAGEMENT_NON_TEACHING)) ||
      (await hasModuleAccess(req.user, MODULE_KEYS.MANAGEMENT_SERVICE_PROVIDERS)) ||
      (await hasModuleAccess(req.user, MODULE_KEYS.MANAGEMENT_BOM));
    if (!allowedStaffModule) {
      return res.status(403).json({ error: "Staff & Service Providers module access is required." });
    }
    const role = normalizeRole(req.body?.role || ROLES.TEACHER);
    const eligibleRoles = [ROLES.TEACHER, ROLES.NON_TEACHING_STAFF, ROLES.BOM, ROLES.SUPPLIER, ROLES.CONTRACTOR];
    if (!eligibleRoles.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${eligibleRoles.join(", ")}` });
    }
    const assignableRoles = getAssignableRolesForActor(req.user);
    if (!assignableRoles.includes(role)) {
      return res.status(403).json({ error: "You are not allowed to register this portal role." });
    }
    const full_name = cleanValue(req.body?.full_name);
    const usernameRaw = cleanValue(req.body?.username || "");
    const email = cleanOptionalValue(req.body?.email);
    const phone = cleanOptionalValue(req.body?.phone);
    let username = usernameRaw;
    if (!username && email) {
      username = email.split("@")[0].replace(/[^a-z0-9]+/gi, "").slice(0, 40) || `user_${Date.now()}`;
    }
    if (!username && phone) {
      username = phone.replace(/\D/g, "").slice(-10) || `user_${Date.now()}`;
    }
    if (!full_name || !username) {
      return res.status(400).json({ error: "full_name and username (or email/phone to derive username) are required." });
    }
    if (!email && !phone) {
      return res.status(400).json({ error: "Either email or phone is required for welcome dispatch." });
    }
    const password = generateStrongPassword(12);
    const passwordHash = await hashPassword(password);
    const isRotationExempt = PASSWORD_ROTATION_EXEMPT_ROLES.has(role);
    const targetInstitutionId = Number(req.user.institution_id);
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
        role,
        email || null,
        phone || null,
        req.user.id
      ]
    );
    const institutionRows = await query(`SELECT institution_name, institution_code FROM institutions WHERE id = ? LIMIT 1`, [
      targetInstitutionId
    ]);
    const institutionName = cleanValue(institutionRows[0]?.institution_name) || "Institution";
    const institutionCode = cleanValue(institutionRows[0]?.institution_code) || "-";
    await auditLog(req.user, "CREATE_STAFF_PORTAL_USER", "users", result.insertId, {
      username,
      role,
      institution_id: targetInstitutionId
    });
    const credentialMessage = [
      "WELCOME TO IMIS — Staff & Service Providers portal access.",
      `Institution: ${institutionName}`,
      `Institution Code: ${institutionCode}`,
      `Username: ${username}`,
      `Temporary Password: ${password}`,
      `Role: ${role}`,
      "",
      "Please sign in at your institution portal, complete OTP verification, and change this password immediately."
    ].join("\n");
    const credentialDispatch = await dispatchCredentialNotice({
      email: email || null,
      phone: phone || null,
      subject: "IMIS Staff Portal Login Instructions",
      message: credentialMessage
    });
    res.status(201).json({
      id: result.insertId,
      message: "Portal user registered; login instructions dispatched via email/SMS where configured.",
      credential_dispatch: credentialDispatch,
      username
    });
  })
);

// === rev41: Per-institution streams (manual entry) ===
app.get(
  "/api/institutions/streams",
  auth,
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const grade = cleanValue(req.query?.grade || "");
    const rows = grade
      ? await query(
          `SELECT id, grade_or_form, stream_name, is_active, created_at
           FROM institution_streams
           WHERE institution_id = ? AND (grade_or_form = ? OR grade_or_form IS NULL OR grade_or_form = '')
           ORDER BY stream_name ASC`,
          [institutionId, grade]
        )
      : await query(
          `SELECT id, grade_or_form, stream_name, is_active, created_at
           FROM institution_streams
           WHERE institution_id = ?
           ORDER BY grade_or_form, stream_name ASC`,
          [institutionId]
        );
    res.json({ streams: rows });
  })
);

app.post(
  "/api/institutions/streams",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const grade = cleanValue(req.body?.grade_or_form || "") || null;
    const name = cleanValue(req.body?.stream_name || "");
    if (!name) return res.status(400).json({ error: "stream_name is required." });
    try {
      const result = await query(
        `INSERT INTO institution_streams (institution_id, grade_or_form, stream_name, created_by_user_id)
         VALUES (?, ?, ?, ?)`,
        [institutionId, grade, name, String(req.user.id || "")]
      );
      await auditLog(req.user, "CREATE_STREAM", "institution_streams", result.insertId, { grade_or_form: grade, stream_name: name });
      res.status(201).json({ id: result.insertId, message: "Stream added." });
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Stream already exists for this grade." });
      }
      throw err;
    }
  })
);

app.delete(
  "/api/institutions/streams/:id",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const id = Number(req.params.id || 0);
    const result = await query(
      `DELETE FROM institution_streams WHERE id = ? AND institution_id = ?`,
      [id, institutionId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Stream not found." });
    await auditLog(req.user, "DELETE_STREAM", "institution_streams", id, {});
    res.json({ message: "Stream removed." });
  })
);

app.get(
  "/api/templates/institution-streams.csv",
  auth,
  enforceModuleAccess(MODULE_KEYS.ADMISSION),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const csv = [
      "grade_or_form,stream_name",
      "Grade 1,East",
      "Grade 1,West",
      "Form 3,North"
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"institution-streams-template.csv\"");
    res.send(csv);
  })
);

app.post(
  "/api/institutions/streams/bulk",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!entries.length) {
      return res.status(400).json({ error: "entries[] is required." });
    }
    let created = 0;
    let skipped = 0;
    for (const entry of entries) {
      const grade = cleanOptionalValue(entry?.grade_or_form);
      const streamName = cleanValue(entry?.stream_name || "");
      if (!streamName) {
        skipped += 1;
        // eslint-disable-next-line no-continue
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await query(
          `INSERT INTO institution_streams (institution_id, grade_or_form, stream_name, created_by_user_id)
           VALUES (?, ?, ?, ?)`,
          [institutionId, grade, streamName, String(req.user.id || "")]
        );
        created += 1;
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") {
          skipped += 1;
          // eslint-disable-next-line no-continue
          continue;
        }
        throw error;
      }
    }
    await auditLog(req.user, "BULK_CREATE_STREAM", "institution_streams", null, {
      attempted: entries.length,
      created,
      skipped
    });
    res.json({ message: "Streams bulk upload processed.", attempted: entries.length, created, skipped });
  })
);

app.get(
  "/api/templates/admission-bio-data.csv",
  auth,
  enforceModuleAccess(MODULE_KEYS.ADMISSION),
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION,
    ROLES.TEACHER
  ]),
  asyncHandler(async (req, res) => {
    const csv = [
      "first_name,middle_name,last_name,other_names,admission_number,date_of_birth,date_of_admission,grade,form_name,stream,gender,parent_full_name,parent_phone,parent_email,learner_condition,disability_type,has_medical_condition,medical_condition_notes,status",
      "Jane,,Achieng,,ADM-001,2015-02-10,2026-01-08,Grade 5,,Blue,Female,Mary Achieng,+254712000000,mary@example.com,No,,No,,In Session"
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"admission-bio-data-template.csv\"");
    res.send(csv);
  })
);

app.get(
  "/api/public/online-admission/learning-areas",
  publicReadRateLimit,
  enforcePublicSecurity,
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.query?.institution_id || 0);
    if (!institutionId) {
      return res.status(400).json({ error: "institution_id is required." });
    }
    const instOk = await query(`SELECT id FROM institutions WHERE id = ? AND is_active = 1 LIMIT 1`, [
      institutionId
    ]);
    if (!instOk.length) {
      return res.status(404).json({ error: "Institution not found or inactive." });
    }
    const rows = await query(
      `SELECT DISTINCT learning_area
       FROM cbc_curriculum_entries
       WHERE institution_id = ?
         AND learning_area IS NOT NULL
         AND TRIM(learning_area) <> ''
       ORDER BY learning_area ASC
       LIMIT 180`,
      [institutionId]
    );
    const learningAreas = (Array.isArray(rows) ? rows : [])
      .map((row) => cleanValue(row.learning_area))
      .filter(Boolean);
    res.json({ learning_areas: learningAreas });
  })
);

app.get(
  "/api/templates/staff-profiles.csv",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const profileType = cleanValue(req.query?.type || "teacher").toLowerCase();
    const csv = profileType === "support"
      ? [
        "full_name,staff_number,id_number,phone_number,email_address,position_department,postal_address,postal_code,town",
        "John Otieno,NTS-001,12345678,+254700000001,john@example.com,Accounts,P.O Box 1,00100,Nairobi"
      ].join("\n")
      : [
        "full_name,tsc_number,id_number,phone_number,email_address,category,major_subject,other_subject,postal_address,postal_code,town",
        "Grace Wanjiku,TSC12345,98765432,+254700000002,grace@example.com,Primary,English,Mathematics,P.O Box 2,20100,Nakuru"
      ].join("\n");
    const fileName = profileType === "support"
      ? "support-staff-profile-template.csv"
      : "teacher-profile-template.csv";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(csv);
  })
);

app.get(
  "/api/templates/lesson-plan.csv",
  auth,
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION,
    ROLES.SENIOR_TEACHER,
    ROLES.TEACHER
  ]),
  asyncHandler(async (_, res) => {
    const csv = [
      "academic_year,term,grade,form_name,stream,learning_area,strand,strand_description,sub_strand,sub_strand_description,lesson_title,learning_outcomes,resources,assessment_strategy,homework,teacher_notes",
      `${new Date().getFullYear()}/${new Date().getFullYear() + 1},Term One,Grade 7,,,Pre-Technical Studies,1.0 Foundation of Pre-Technical Studies,Core foundational competencies and practical orientation,1.1 Introduction to Pre-Technical Studies,Learners explain scope and importance of pre-technical learning,Introduction to Pre-Technical Studies,Learners describe pre-technical scope and identify applications in daily life,Textbook + projector + worksheet,Observation and rubric,Write two career paths linked to pre-technical studies,Adjust pace to learner readiness`
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"lesson-plan-template.csv\"");
    res.send(csv);
  })
);

app.get(
  "/api/templates/scheme-of-work.csv",
  auth,
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION,
    ROLES.SENIOR_TEACHER,
    ROLES.TEACHER
  ]),
  asyncHandler(async (_, res) => {
    const csv = [
      "academic_year,term,grade,form_name,stream,learning_area,strand,strand_description,sub_strand,sub_strand_description,week,lesson_focus,learning_experience,resources,assessment,remarks",
      `${new Date().getFullYear()}/${new Date().getFullYear() + 1},Term One,Grade 8,,,Social Studies,2.0 People and Relationships,Develops learner self-awareness and relational competencies,2.5 Building Healthy Relationships,Learners build healthy peer and community relationships,Week 2,Healthy Relationships,Discussion + case analysis + reflection,Textbook + chart + worksheet,Checklist + rubric,Institution-specific customization allowed`
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"scheme-of-work-template.csv\"");
    res.send(csv);
  })
);

app.get(
  "/api/templates/record-of-work.csv",
  auth,
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION,
    ROLES.SENIOR_TEACHER,
    ROLES.TEACHER
  ]),
  asyncHandler(async (_, res) => {
    const csv = [
      "date,academic_year,term,grade,form_name,stream,learning_area,strand,sub_strand,activity_done,evidence_of_learning,assessment_feedback,next_action,teacher_sign",
      `${new Date().toISOString().slice(0, 10)},${new Date().getFullYear()}/${new Date().getFullYear() + 1},Term One,Grade 9,,,Pre-Technical Studies,4.0 Tools and Production,4.1 Holding Tools,Demonstrated safe holding tools usage,Practical checklist complete,Most learners met expectation,Reinforce safety procedure for two learners,`
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"record-of-work-template.csv\"");
    res.send(csv);
  })
);

app.get(
  "/api/institutions/letterhead",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SYSTEM_ADMINISTRATOR]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const rows = await query(
      `SELECT id, institution_name, institution_code, letterhead_file_path, admission_letter_template_text, admission_letter_template_file_url
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [institutionId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Institution not found." });
    }
    res.json(rows[0]);
  })
);

app.patch(
  "/api/institutions/letterhead",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SYSTEM_ADMINISTRATOR]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const letterheadFilePath = cleanOptionalValue(req.body?.letterhead_file_path);
    const admissionLetterTemplateText = cleanOptionalValue(req.body?.admission_letter_template_text);
    const admissionLetterTemplateFileUrl = cleanOptionalValue(req.body?.admission_letter_template_file_url);
    await query(
      `UPDATE institutions
       SET letterhead_file_path = COALESCE(?, letterhead_file_path),
           admission_letter_template_text = COALESCE(?, admission_letter_template_text),
           admission_letter_template_file_url = COALESCE(?, admission_letter_template_file_url)
       WHERE id = ?`,
      [letterheadFilePath, admissionLetterTemplateText, admissionLetterTemplateFileUrl, institutionId]
    );
    await auditLog(req.user, "UPDATE_INSTITUTION_LETTERHEAD", "institutions", institutionId, {
      letterhead_file_path: letterheadFilePath,
      has_admission_letter_template_text: Boolean(admissionLetterTemplateText),
      admission_letter_template_file_url: admissionLetterTemplateFileUrl
    });
    res.json({ message: "Letterhead and admission letter template saved." });
  })
);

// === rev41: Teacher timetable (feed + list) ===
app.get(
  "/api/staff/teacher-timetable",
  auth,
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const teacherProfileId = Number(req.query?.teacher_profile_id || 0);
    const role = normalizeRole(req.user.role);
    // A teacher can ONLY see their own timetable; HoI/SysDev can see all in scope
    let where = `institution_id = ?`;
    const params = [institutionId];
    if (teacherProfileId) {
      where += ` AND teacher_profile_id = ?`;
      params.push(teacherProfileId);
    } else if (role === ROLES.TEACHER) {
      // Look up teacher_profile.id by user_id if email match
      const teacherLookup = await query(
        `SELECT id FROM teacher_profiles WHERE institution_id = ? AND (email_address = ? OR phone_number = ?) LIMIT 1`,
        [institutionId, req.user.email || "", req.user.phone || ""]
      );
      const selfId = teacherLookup[0]?.id;
      if (!selfId) return res.json({ rows: [] });
      where += ` AND teacher_profile_id = ?`;
      params.push(selfId);
    }
    const rows = await query(
      `SELECT * FROM teacher_timetable WHERE ${where} ORDER BY day_of_week, start_time, lesson_order`,
      params
    );
    res.json({ rows });
  })
);

app.post(
  "/api/staff/teacher-timetable/generate",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!entries.length) return res.status(400).json({ error: "entries[] is required." });

    const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const DEFAULT_SLOTS = [
      "08:00", "08:40", "09:20", "10:00", "10:40", "11:20", "12:00",
      "14:00", "14:40", "15:20", "16:00"
    ];

    const generated = [];
    for (const entry of entries) {
      const teacherProfileId = Number(entry?.teacher_profile_id || 0);
      const teacherName = cleanValue(entry?.teacher_name || "");
      const category = cleanValue(entry?.timetable_category || "Normal Lesson");
      const term = cleanValue(entry?.term || "");
      const grade = cleanValue(entry?.grade || "");
      const stream = cleanValue(entry?.stream || "");
      const learningArea = cleanValue(entry?.learning_area || "");
      const lessonsPerWeek = Math.max(1, Math.min(Number(entry?.lessons_per_week || 1), 40));
      const startTime = cleanValue(entry?.start_time || "08:00");
      const endTime = cleanValue(entry?.end_time || "08:40");
      const manualLessons = Array.isArray(entry?.manual_lessons) ? entry.manual_lessons : [];

      let generatedCount = 0;
      // First place any manual lessons (fixed times/days)
      for (const manual of manualLessons) {
        const day = cleanValue(manual?.day) || DAYS[generatedCount % DAYS.length];
        const s = cleanValue(manual?.start_time) || startTime;
        const e = cleanValue(manual?.end_time) || endTime;
        const clash = await query(
          `SELECT id FROM teacher_timetable
           WHERE institution_id = ? AND teacher_profile_id = ?
             AND day_of_week = ? AND start_time = ?`,
          [institutionId, teacherProfileId, day, s]
        );
        if (clash.length) continue;
        const insert = await query(
          `INSERT INTO teacher_timetable
            (institution_id, teacher_profile_id, teacher_name, timetable_category, term, grade, stream, learning_area,
             day_of_week, lesson_order, start_time, end_time, lessons_per_week, is_manual_time, generated_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [institutionId, teacherProfileId, teacherName, category, term, grade, stream, learningArea,
           day, generatedCount + 1, s, e, lessonsPerWeek, String(req.user.id || "")]
        );
        generated.push({ id: insert.insertId, day, start_time: s, end_time: e, manual: true });
        generatedCount += 1;
      }

      // Fill remaining lessons across days/slots avoiding clashes
      let slotIdx = 0;
      let dayIdx = 0;
      const guard = lessonsPerWeek * DAYS.length * DEFAULT_SLOTS.length;
      let safety = 0;
      while (generatedCount < lessonsPerWeek && safety < guard) {
        safety += 1;
        const day = DAYS[dayIdx % 5]; // Mon-Fri prioritized
        const s = DEFAULT_SLOTS[slotIdx % DEFAULT_SLOTS.length];
        slotIdx += 1;
        if (slotIdx % DEFAULT_SLOTS.length === 0) dayIdx += 1;
        const clash = await query(
          `SELECT id FROM teacher_timetable
           WHERE institution_id = ? AND teacher_profile_id = ?
             AND day_of_week = ? AND start_time = ?`,
          [institutionId, teacherProfileId, day, s]
        );
        if (clash.length) continue;
        const [h, m] = s.split(":").map((n) => Number(n));
        const endM = (h * 60 + m + 40);
        const e = `${String(Math.floor(endM / 60)).padStart(2, "0")}:${String(endM % 60).padStart(2, "0")}`;
        const insert = await query(
          `INSERT INTO teacher_timetable
            (institution_id, teacher_profile_id, teacher_name, timetable_category, term, grade, stream, learning_area,
             day_of_week, lesson_order, start_time, end_time, lessons_per_week, is_manual_time, generated_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [institutionId, teacherProfileId, teacherName, category, term, grade, stream, learningArea,
           day, generatedCount + 1, s, e, lessonsPerWeek, String(req.user.id || "")]
        );
        generated.push({ id: insert.insertId, day, start_time: s, end_time: e, manual: false });
        generatedCount += 1;
      }
    }

    await auditLog(req.user, "GENERATE_TIMETABLE", "teacher_timetable", null, { total_entries: generated.length });
    res.status(201).json({ message: "Timetable generated.", lessons: generated });
  })
);

app.delete(
  "/api/staff/teacher-timetable/:id",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const id = Number(req.params.id || 0);
    const result = await query(
      `DELETE FROM teacher_timetable WHERE id = ? AND institution_id = ?`,
      [id, institutionId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Lesson not found." });
    res.json({ message: "Lesson removed." });
  })
);

// === rev41: Learner discipline records ===
const LEARNER_DISCIPLINE_CATEGORIES = [
  "Physical fights",
  "Bullying of other learners",
  "Stealing",
  "Playing truancy",
  "Cheating in examinations",
  "Abusing teachers or other persons in authority",
  "Defiance of lawful instructions",
  "Drug trafficking or substance abuse",
  "Unlawful demonstration",
  "Boycott of classes or meals",
  "Destruction of school property",
  "Invasion of other institutions, shopping centres or homesteads",
  "Other conduct categorized as indiscipline by the Board of Management",
  "Breach of school rules"
];

app.get(
  "/api/staff/learner-discipline",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER, ROLES.SENIOR_TEACHER, ROLES.HEAD_OF_DEPARTMENT]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const rows = await query(
      `SELECT d.*, l.full_name AS resolved_learner_name
       FROM learner_discipline_records d
       LEFT JOIN learners l ON l.id = d.learner_id
       WHERE d.institution_id = ?
       ORDER BY d.occurred_at DESC, d.id DESC`,
      [institutionId]
    );
    res.json({ categories: LEARNER_DISCIPLINE_CATEGORIES, rows });
  })
);

app.post(
  "/api/staff/learner-discipline",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER, ROLES.SENIOR_TEACHER, ROLES.HEAD_OF_DEPARTMENT]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const body = req.body || {};
    const category = cleanValue(body.category || "");
    if (!category) return res.status(400).json({ error: "category is required." });
    const learnerId = Number(body.learner_id || 0) || null;
    const result = await query(
      `INSERT INTO learner_discipline_records
        (institution_id, learner_id, learner_name, grade, stream, category, custom_breach,
         occurred_at, other_persons_involved, action_taken, recorded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        institutionId,
        learnerId,
        cleanValue(body.learner_name || ""),
        cleanValue(body.grade || ""),
        cleanValue(body.stream || ""),
        category,
        cleanValue(body.custom_breach || ""),
        cleanValue(body.occurred_at || "") || null,
        cleanValue(body.other_persons_involved || ""),
        cleanValue(body.action_taken || ""),
        String(req.user.id || "")
      ]
    );
    await auditLog(req.user, "CREATE_DISCIPLINE", "learner_discipline_records", result.insertId, { category, learner_id: learnerId });
    res.status(201).json({ id: result.insertId, message: "Discipline record added." });
  })
);

app.delete(
  "/api/staff/learner-discipline/:id",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const id = Number(req.params.id || 0);
    const result = await query(
      `DELETE FROM learner_discipline_records WHERE id = ? AND institution_id = ?`,
      [id, institutionId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Record not found." });
    res.json({ message: "Discipline record removed." });
  })
);

app.get(
  "/api/institutions/:id/agreement-template",
  auth,
  enforceModuleAccess(MODULE_KEYS.REGISTRATION),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    const institution = await loadInstitutionAgreementContext(institutionId);
    const accessError = await assertInstitutionAgreementAccess(req, institution);
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    const institution = await loadInstitutionAgreementContext(institutionId);
    const accessError = await assertInstitutionAgreementAccess(req, institution);
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    const institution = await loadInstitutionAgreementContext(institutionId);
    const accessError = await assertInstitutionAgreementAccess(req, institution);
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
    const institutionScopeError = await assertInstitutionScopeAccess(
      req,
      institutionId,
      "You can only manage institution status within your assigned institution scope."
    );
    if (institutionScopeError) {
      return res.status(institutionScopeError.status).json({ error: institutionScopeError.error });
    }
    const normalizedRole = normalizeRole(req.user.role);
    if (!isAnySystemDeveloperRole(normalizedRole) && Number(is_active) === 0) {
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
    const statusScopeAllowed = await hasInstitutionScopeAccess(req.user, users[0].institution_id);
    if (!statusScopeAllowed) {
      return res.status(403).json({ error: "You can only change user status within your assigned institution scope." });
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
    const passwordScopeAllowed = await hasInstitutionScopeAccess(req.user, users[0].institution_id);
    if (!passwordScopeAllowed) {
      return res.status(403).json({ error: "You can only reset user passwords within your assigned institution scope." });
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
  enforceRole([ROLES.SYSTEM_DEVELOPER]),
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
    const deleteScopeAllowed = await hasInstitutionScopeAccess(req.user, targetUser.institution_id);
    if (!deleteScopeAllowed) {
      return res.status(403).json({ error: "You can only delete users within your assigned institution scope." });
    }
    if (!isSuperSystemDeveloperRole(requesterRole) && isAnySystemDeveloperRole(targetUser.role)) {
      return res.status(403).json({ error: "Only the Super/System Developer can delete this account." });
    }
    await archiveRecycleBinItem({
      institutionId: targetUser.institution_id,
      entityName: "users",
      entityId: targetUser.id,
      payload: targetUser,
      deletedByUserId: req.user.id,
      recycleContext: buildRecycleContextFromRequest(req, {
        description: `User account ${targetUser.username} deleted from registry.`
      })
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
  enforceModuleAccess(MODULE_KEYS.ACCESS_CONTROL),
  enforceAccessControlActors(),
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
    const accessScopeAllowed = await hasInstitutionScopeAccess(req.user, targetUser.institution_id);
    if (!accessScopeAllowed) {
      return res.status(403).json({ error: "Cannot change module access for users outside your assigned institution scope." });
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
  enforceModuleAccess(MODULE_KEYS.ACCESS_CONTROL),
  enforceAccessControlActors(),
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
    const bulkAccessScopeAllowed = await hasInstitutionScopeAccess(req.user, targetUser.institution_id);
    if (!bulkAccessScopeAllowed) {
      return res.status(403).json({ error: "Cannot change module access for users outside your assigned institution scope." });
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
  enforceAccessControlActors(),
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
    const targetUserScopeError = await assertInstitutionScopeAccess(
      req,
      targetUser.institution_id,
      "Cannot view module overrides for users outside your assigned institution scope."
    );
    if (targetUserScopeError) {
      return res.status(targetUserScopeError.status).json({ error: targetUserScopeError.error });
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
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.SYSTEM_ADMINISTRATOR,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION
  ]),
  asyncHandler(async (req, res) => {
    const limit = parseBoundedInt(req.query?.limit, { fallback: 200, min: 1, max: 1000 });
    const institutionScope = canManageAcrossInstitutions(req.user)
      ? Number(req.query?.institution_id || 0)
      : req.user.institution_id;
    const whereClause = institutionScope ? "WHERE a.institution_id = ?" : "";
    const params = institutionScope ? [institutionScope] : [];
    const auditColumns = await getExistingColumns("activity_logs", [
      "id",
      "institution_id",
      "actor_user_id",
      "actor_role",
      "action",
      "entity_name",
      "entity_id",
      "details_json",
      "created_at"
    ]);
    const institutionColumns = await getExistingColumns("institutions", ["institution_code"]);
    const hasAuditDetails = auditColumns.includes("details_json");
    const hasInstitutionCode = institutionColumns.includes("institution_code");
    const auditOrderBy = auditColumns.includes("id") ? "a.id DESC" : (auditColumns.includes("created_at") ? "a.created_at DESC" : "1 DESC");
    const hasCreatedAt = auditColumns.includes("created_at");
    const safeAuditSelect = [
      auditColumns.includes("id") ? "a.id AS id" : "NULL AS id",
      auditColumns.includes("institution_id") ? "a.institution_id AS institution_id" : "NULL AS institution_id",
      hasInstitutionCode ? "i.institution_code AS joined_institution_code" : "NULL AS joined_institution_code",
      auditColumns.includes("actor_user_id") ? "a.actor_user_id AS actor_user_id" : "NULL AS actor_user_id",
      auditColumns.includes("actor_role") ? "a.actor_role AS actor_role" : "NULL AS actor_role",
      auditColumns.includes("action") ? "a.action AS action" : "'UNKNOWN' AS action",
      auditColumns.includes("entity_name") ? "a.entity_name AS entity_name" : "NULL AS entity_name",
      auditColumns.includes("entity_id") ? "a.entity_id AS entity_id" : "NULL AS entity_id",
      hasAuditDetails ? "a.details_json AS details_json" : "NULL AS details_json",
      auditColumns.includes("created_at") ? "a.created_at AS created_at" : "NOW() AS created_at"
    ];
    const logs = await query(
      `SELECT ${safeAuditSelect.join(", ")}
       FROM activity_logs a
       LEFT JOIN institutions i ON i.id = a.institution_id
       ${whereClause}
       ORDER BY ${auditOrderBy}
       LIMIT ${limit}`,
      params
    );
    const normalizedLogs = logs.map((row) => {
      const details = parseStoredJson(row.details_json) || {};
      return {
        ...row,
        institution_code: cleanValue(details.institution_code || row.joined_institution_code) || null,
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
    const filteredLogs = isSuperSystemDeveloperRole(req.user.role)
      ? normalizedLogs
      : normalizedLogs.filter((row) => normalizeRole(row.actor_role) !== ROLES.SUPER_SYSTEM_DEVELOPER);
    const [failedLoginsRow] = await query(
      `SELECT COUNT(*) total
       FROM activity_logs a
       ${whereClause ? `${whereClause} AND` : "WHERE"} ${auditColumns.includes("action") ? "a.action" : "''"} IN ('LOGIN_FAILED', 'ACCOUNT_LOCKED')
       ${hasCreatedAt ? "AND a.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)" : ""}`,
      params
    );
    const [otpFailuresRow] = await query(
      `SELECT COUNT(*) total
       FROM activity_logs a
       ${whereClause ? `${whereClause} AND` : "WHERE"} ${auditColumns.includes("action") ? "a.action" : "''"} IN ('OTP_VERIFY_FAILED', 'OTP_EXHAUSTED')
       ${hasCreatedAt ? "AND a.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)" : ""}`,
      params
    );
    const postureRecommendations = [];
    if (!emailChannelReady()) {
      postureRecommendations.push("Email OTP channel is not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL.");
    }
    if (!smsChannelReady()) {
      postureRecommendations.push("SMS OTP channel is not configured. Set Africa's Talking or Twilio SMS credentials.");
    }
    if (!configuredJwtSecret) {
      postureRecommendations.push("JWT_SECRET is missing. Set a strong secret for production.");
    }
    if (String(process.env.ENABLE_CSP || "false").toLowerCase() !== "true") {
      postureRecommendations.push("ENABLE_CSP is disabled. Enable Content Security Policy in production.");
    }
    res.json({
      logs: filteredLogs,
      metrics: {
        failed_login_events_24h: Number(failedLoginsRow?.total || 0),
        otp_fail_events_24h: Number(otpFailuresRow?.total || 0)
      },
      security_posture: {
        jwt_secret_configured: Boolean(configuredJwtSecret),
        otp_default_channel: cleanValue(process.env.OTP_CHANNEL || "sms_email"),
        otp_email_ready: emailChannelReady(),
        otp_sms_ready: smsChannelReady(),
        csp_enabled: String(process.env.ENABLE_CSP || "false").toLowerCase() === "true",
        force_https: String(process.env.FORCE_HTTPS || "true").toLowerCase() !== "false",
        node_env: cleanValue(process.env.NODE_ENV || "development")
      },
      recommendations: postureRecommendations
    });
  })
);

app.get(
  "/api/system/registry",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const scopedInstitutions = await loadInstitutionScopeOptions(req.user);
    const includeInstitutionRegistry = scopedInstitutions.length > 0;
    const scopedInstitutionIds = scopedInstitutions.map((item) => Number(item.id || 0)).filter((id) => id > 0);
    const institutionColumns = await getExistingColumns("institutions", [
      "institution_name",
      "institution_code",
      "county",
      "sub_county",
      "location",
      "village",
      "postal_address",
      "postal_code",
      "town",
      "institution_type",
      "institution_level",
      "email",
      "phone",
      "is_active",
      "is_suspended",
      "status_reason",
      "suspended_reason",
      "created_at"
    ]);
    const institutions = scopedInstitutionIds.length
      ? await query(
        `SELECT id${institutionColumns.length ? `, ${institutionColumns.join(", ")}` : ""}
         FROM institutions
         WHERE id IN (${scopedInstitutionIds.map(() => "?").join(", ")})
         ORDER BY institution_name ASC`,
        scopedInstitutionIds
      )
      : [];
    const placeholders = scopedInstitutionIds.map(() => "?").join(", ");
    const users = scopedInstitutionIds.length
      ? await query(
        `SELECT u.id, u.institution_id, u.full_name, u.username, u.role, u.email, u.phone, u.is_active, u.created_at,
                i.institution_name, i.institution_code
         FROM users u
         INNER JOIN institutions i ON i.id = u.institution_id
         WHERE u.institution_id IN (${placeholders})
           AND ( ? = 1 OR u.role NOT IN (?, ?))
         ORDER BY u.id DESC`,
        [...scopedInstitutionIds, Number(canManageAcrossInstitutions(req.user)), ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER]
      )
      : [];
    res.json({
      include_institution_registry: includeInstitutionRegistry,
      institutions,
      users
    });
  })
);

app.get(
  "/api/system/institution-documents/institutions",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (_req, res) => {
    const institutions = await query(
      `SELECT id, institution_name, institution_code
       FROM institutions
       ORDER BY institution_name ASC`
    );
    res.json({ institutions });
  })
);

app.get(
  "/api/system/institution-documents",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.query?.institution_id || 0);
    if (!institutionId) {
      return res.status(400).json({ error: "institution_id is required." });
    }
    const q = `%${cleanValue(req.query?.q || "")}%`;
    const documents = await query(
      `SELECT d.id, d.institution_id, d.module_key, d.submodule_key, d.document_type, d.document_title,
              d.notes, d.file_path, d.mime_type, d.created_at, i.institution_name, i.institution_code
       FROM institution_documents d
       INNER JOIN institutions i ON i.id = d.institution_id
       WHERE d.institution_id = ?
         AND (
           ? = '%%'
           OR d.document_type LIKE ?
           OR d.document_title LIKE ?
           OR d.module_key LIKE ?
           OR d.submodule_key LIKE ?
         )
       ORDER BY d.id DESC
       LIMIT 500`,
      [institutionId, q, q, q, q, q]
    );
    res.json({ documents });
  })
);

app.post(
  "/api/system/institution-documents",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.body?.institution_id || 0);
    const documentType = cleanValue(req.body?.document_type || "");
    const title = cleanValue(req.body?.document_title || "");
    const filePath = cleanOptionalValue(req.body?.file_path);
    if (!institutionId || !documentType || !title || !filePath) {
      return res.status(400).json({ error: "institution_id, document_type, document_title and file_path are required." });
    }
    const exists = await query("SELECT id FROM institutions WHERE id = ? LIMIT 1", [institutionId]);
    if (!exists.length) {
      return res.status(404).json({ error: "Institution not found." });
    }
    const result = await query(
      `INSERT INTO institution_documents
        (institution_id, module_key, submodule_key, document_type, document_title, notes, file_path, mime_type, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        institutionId,
        cleanOptionalValue(req.body?.module_key),
        cleanOptionalValue(req.body?.submodule_key),
        documentType,
        title,
        cleanOptionalValue(req.body?.notes),
        filePath,
        cleanOptionalValue(req.body?.mime_type),
        Number(req.user.id || 0) || null
      ]
    );
    await auditLog(req.user, "UPSERT_INSTITUTION_DOCUMENT", "institution_documents", result.insertId, {
      institution_id: institutionId,
      document_type: documentType,
      module_key: cleanOptionalValue(req.body?.module_key),
      submodule_key: cleanOptionalValue(req.body?.submodule_key)
    });
    res.status(201).json({ id: result.insertId, message: "Institution document mapped successfully." });
  })
);

app.delete(
  "/api/system/institution-documents/:id",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.DELETE),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: "Valid document id is required." });
    const result = await query("DELETE FROM institution_documents WHERE id = ?", [id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Institution document not found." });
    await auditLog(req.user, "DELETE_INSTITUTION_DOCUMENT", "institution_documents", id, {});
    res.json({ message: "Institution document removed." });
  })
);

app.get(
  "/api/institutions/documents",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id || 0);
    if (!institutionId) {
      return res.status(400).json({ error: "institution scope is missing." });
    }
    const documentType = cleanOptionalValue(req.query?.document_type);
    const moduleKey = cleanOptionalValue(req.query?.module_key);
    const rows = await query(
      `SELECT id, module_key, submodule_key, document_type, document_title, notes, file_path, mime_type, created_at
       FROM institution_documents
       WHERE institution_id = ?
         AND (? IS NULL OR document_type = ?)
         AND (? IS NULL OR module_key = ?)
       ORDER BY id DESC`,
      [institutionId, documentType, documentType, moduleKey, moduleKey]
    );
    res.json({ documents: rows });
  })
);

app.get(
  "/api/system/registry/institutions/:id/view",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    if (!institutionId) return res.status(400).json({ error: "Valid institution id is required." });
    const institutionColumns = await getExistingColumns("institutions", [
      "institution_name",
      "institution_code",
      "email",
      "phone",
      "county",
      "sub_county",
      "location",
      "village",
      "postal_address",
      "postal_code",
      "town",
      "institution_type",
      "institution_level",
      "is_active",
      "is_suspended",
      "status_reason",
      "suspended_reason",
      "created_at"
    ]);
    const rows = await query(
      `SELECT id, ${institutionColumns.join(", ")}
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [institutionId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Institution not found." });
    }
    const institution = rows[0];
    const viewInstitutionScopeError = await assertInstitutionScopeAccess(req, institution.id, "You can only view institutions in your assigned scope.");
    if (viewInstitutionScopeError) {
      return res.status(viewInstitutionScopeError.status).json({ error: viewInstitutionScopeError.error });
    }
    res.json({ institution });
  })
);

app.patch(
  "/api/system/registry/institutions/:id",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    if (!institutionId) return res.status(400).json({ error: "Valid institution id is required." });
    const institutionColumns = await getExistingColumns("institutions", [
      "institution_name",
      "institution_code",
      "email",
      "phone",
      "county",
      "sub_county",
      "location",
      "village",
      "postal_address",
      "postal_code",
      "town",
      "institution_type",
      "institution_level"
    ]);
    const rows = await query(
      `SELECT id, ${institutionColumns.join(", ")}
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [institutionId]
    );
    if (!rows.length) return res.status(404).json({ error: "Institution not found." });
    const editInstitutionScopeError = await assertInstitutionScopeAccess(req, institutionId, "You can only edit institutions in your assigned scope.");
    if (editInstitutionScopeError) {
      return res.status(editInstitutionScopeError.status).json({ error: editInstitutionScopeError.error });
    }
    const existingInstitution = rows[0];
    const institution_name = cleanOptionalValue(req.body?.institution_name);
    const email = cleanOptionalValue(req.body?.email);
    const phone = cleanOptionalValue(req.body?.phone);
    const county = cleanOptionalValue(req.body?.county);
    const sub_county = cleanOptionalValue(req.body?.sub_county);
    const location = cleanOptionalValue(req.body?.location);
    const village = cleanOptionalValue(req.body?.village);
    const postal_address = cleanOptionalValue(req.body?.postal_address);
    const postal_code = cleanOptionalValue(req.body?.postal_code);
    const town = cleanOptionalValue(req.body?.town);
    const institution_type = cleanOptionalValue(req.body?.institution_type);
    const institution_level = cleanOptionalValue(req.body?.institution_level);
    const nextInstitutionName = institution_name ?? existingInstitution.institution_name;
    const nextInstitutionEmail = email ?? existingInstitution.email;
    const nextInstitutionPhone = phone ?? existingInstitution.phone;
    const updatePairs = [];
    const updateParams = [];
    const updatable = {
      institution_name,
      email,
      phone,
      county,
      sub_county,
      location,
      village,
      postal_address,
      postal_code,
      town,
      institution_type,
      institution_level
    };
    Object.entries(updatable).forEach(([column, value]) => {
      if (!institutionColumns.includes(column)) return;
      updatePairs.push(`${column} = COALESCE(?, ${column})`);
      updateParams.push(value);
    });
    if (updatePairs.length) {
      await query(
        `UPDATE institutions
         SET ${updatePairs.join(", ")}
         WHERE id = ?`,
        [...updateParams, institutionId]
      );
    }
    const shouldDispatchFreshWelcome =
      (institution_name !== null && cleanValue(institution_name) !== cleanValue(existingInstitution.institution_name)) ||
      (email !== null && cleanValue(email) !== cleanValue(existingInstitution.email)) ||
      (phone !== null && cleanValue(phone) !== cleanValue(existingInstitution.phone));
    let usersNotified = 0;
    if (shouldDispatchFreshWelcome) {
      const institutionUsers = await query(
        `SELECT id, username, full_name, role, email, phone
         FROM users
         WHERE institution_id = ?
         ORDER BY id ASC`,
        [institutionId]
      );
      for (const user of institutionUsers) {
        const generatedPassword = generateStrongPassword(12);
        const passwordHash = await hashPassword(generatedPassword);
        // eslint-disable-next-line no-await-in-loop
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
          [passwordHash, PASSWORD_ROTATION_DAYS, Number(user.id || 0)]
        );
        const message = [
          "WELCOME TO IMIS SYSTEM FOR BASIC EDUCATION LEARNING INSTITUTIONS.",
          `Institution: ${nextInstitutionName || "Institution"}`,
          `Institution Code: ${existingInstitution.institution_code || "-"}`,
          `Username: ${user.username || "-"}`,
          `Temporary Password: ${generatedPassword}`,
          `Role: ${user.role || "-"}`,
          `Institution Contact Email: ${nextInstitutionEmail || "-"}`,
          `Institution Contact Phone: ${nextInstitutionPhone || "-"}`,
          "",
          "Please sign in and change this password immediately."
        ].join("\n");
        // eslint-disable-next-line no-await-in-loop
        await dispatchCredentialNotice({
          email: cleanOptionalValue(user.email),
          phone: cleanOptionalValue(user.phone),
          subject: "IMIS Updated Institution Welcome Credentials",
          message
        });
        usersNotified += 1;
      }
    }
    await auditLog(req.user, "UPDATE_REGISTRY_INSTITUTION", "institutions", institutionId, {
      institution_name,
      email,
      phone,
      users_notified: usersNotified,
      fresh_welcome_dispatched: shouldDispatchFreshWelcome
    });
    res.json({
      message: "Institution saved successfully.",
      users_notified: usersNotified,
      fresh_welcome_dispatched: shouldDispatchFreshWelcome
    });
  })
);

app.patch(
  "/api/system/registry/institutions/:id/status",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.params.id);
    if (!institutionId) return res.status(400).json({ error: "Valid institution id is required." });
    const rows = await query("SELECT id FROM institutions WHERE id = ? LIMIT 1", [institutionId]);
    if (!rows.length) return res.status(404).json({ error: "Institution not found." });
    const institutionStatusScopeError = await assertInstitutionScopeAccess(req, institutionId, "You can only change status for institutions in your assigned scope.");
    if (institutionStatusScopeError) {
      return res.status(institutionStatusScopeError.status).json({ error: institutionStatusScopeError.error });
    }
    const isActive = req.body?.is_active;
    const isSuspended = req.body?.is_suspended;
    const reason = cleanOptionalValue(req.body?.reason) || null;
    const institutionStatusColumns = await getExistingColumns("institutions", [
      "is_active",
      "is_suspended",
      "status_reason",
      "suspended_reason"
    ]);
    const updatePairs = [];
    const updateParams = [];
    if (institutionStatusColumns.includes("is_active") && isActive !== undefined) {
      updatePairs.push("is_active = ?");
      updateParams.push(Number(Boolean(isActive)));
    }
    if (institutionStatusColumns.includes("is_suspended") && isSuspended !== undefined) {
      updatePairs.push("is_suspended = ?");
      updateParams.push(Number(Boolean(isSuspended)));
    }
    if (institutionStatusColumns.includes("status_reason") && reason && isActive !== undefined && Number(Boolean(isActive)) === 0) {
      updatePairs.push("status_reason = ?");
      updateParams.push(reason);
    }
    if (institutionStatusColumns.includes("suspended_reason") && reason && isSuspended !== undefined && Number(Boolean(isSuspended)) === 1) {
      updatePairs.push("suspended_reason = ?");
      updateParams.push(reason);
    }
    if (updatePairs.length) {
      await query(
        `UPDATE institutions
         SET ${updatePairs.join(", ")}
         WHERE id = ?`,
        [...updateParams, institutionId]
      );
    }
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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
    const deleteReason = "Institution moved to recycle bin";
    const userStatusColumns = await getExistingColumns("users", [
      "is_active",
      "is_suspended",
      "status_reason",
      "suspended_reason"
    ]);
    const userUpdatePairs = [];
    const userUpdateParams = [];
    if (userStatusColumns.includes("is_active")) {
      userUpdatePairs.push("is_active = 0");
    }
    if (userStatusColumns.includes("is_suspended")) {
      userUpdatePairs.push("is_suspended = 1");
    }
    if (userStatusColumns.includes("status_reason")) {
      userUpdatePairs.push("status_reason = COALESCE(status_reason, ?)");
      userUpdateParams.push(deleteReason);
    }
    if (userStatusColumns.includes("suspended_reason")) {
      userUpdatePairs.push("suspended_reason = COALESCE(suspended_reason, ?)");
      userUpdateParams.push(deleteReason);
    }
    if (userUpdatePairs.length) {
      await query(
        `UPDATE users
         SET ${userUpdatePairs.join(", ")}
         WHERE institution_id = ?`,
        [...userUpdateParams, institutionId]
      );
    }
    const institutionStatusColumns = await getExistingColumns("institutions", [
      "is_active",
      "is_suspended",
      "status_reason",
      "suspended_reason"
    ]);
    const institutionUpdatePairs = [];
    const institutionUpdateParams = [];
    if (institutionStatusColumns.includes("is_active")) {
      institutionUpdatePairs.push("is_active = 0");
    }
    if (institutionStatusColumns.includes("is_suspended")) {
      institutionUpdatePairs.push("is_suspended = 1");
    }
    if (institutionStatusColumns.includes("status_reason")) {
      institutionUpdatePairs.push("status_reason = COALESCE(status_reason, ?)");
      institutionUpdateParams.push(deleteReason);
    }
    if (institutionStatusColumns.includes("suspended_reason")) {
      institutionUpdatePairs.push("suspended_reason = COALESCE(suspended_reason, ?)");
      institutionUpdateParams.push(deleteReason);
    }
    if (institutionUpdatePairs.length) {
      await query(
        `UPDATE institutions
         SET ${institutionUpdatePairs.join(", ")}
         WHERE id = ?`,
        [...institutionUpdateParams, institutionId]
      );
    }
    await auditLog(req.user, "DELETE_INSTITUTION", "institutions", institutionId, {
      institution_code: institution.institution_code,
      users_deactivated: users.length,
      mode: "SOFT_DELETE_TO_RECYCLE_BIN"
    });
    res.json({ message: "Institution moved to recycle bin and deactivated successfully." });
  })
);

app.get(
  "/api/system/registry/users/:id/view",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
    const viewUserScopeError = await assertInstitutionScopeAccess(req, user.institution_id, "You can only view users in your assigned institution scope.");
    if (viewUserScopeError) {
      return res.status(viewUserScopeError.status).json({ error: viewUserScopeError.error });
    }
    res.json({ user });
  })
);

app.patch(
  "/api/system/registry/users/:id",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
    const editUserScopeError = await assertInstitutionScopeAccess(req, target.institution_id, "You can only edit users in your assigned institution scope.");
    if (editUserScopeError) {
      return res.status(editUserScopeError.status).json({ error: editUserScopeError.error });
    }
    const userRows = await query(
      `SELECT id, institution_id, username, role, full_name, email, phone
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (!userRows.length) return res.status(404).json({ error: "User not found." });
    const user = userRows[0];
    const username = cleanOptionalValue(req.body?.username);
    const full_name = cleanOptionalValue(req.body?.full_name);
    const email = cleanOptionalValue(req.body?.email);
    const phone = cleanOptionalValue(req.body?.phone);
    if (username !== null) {
      const usernameValidationError = validateUsername(username, "username");
      if (usernameValidationError) {
        return res.status(400).json({ error: usernameValidationError });
      }
      const duplicate = await query(
        `SELECT id
         FROM users
         WHERE institution_id = ? AND username = ? AND id <> ?
         LIMIT 1`,
        [user.institution_id, username, userId]
      );
      if (duplicate.length) {
        return res.status(409).json({ error: "Username already exists for this institution." });
      }
    }
    const nextName = full_name ?? user.full_name;
    const nextEmail = email ?? user.email;
    const nextPhone = phone ?? user.phone;
    const detailsChanged =
      (full_name !== null && cleanValue(full_name) !== cleanValue(user.full_name)) ||
      (email !== null && cleanValue(email) !== cleanValue(user.email)) ||
      (phone !== null && cleanValue(phone) !== cleanValue(user.phone)) ||
      (username !== null && cleanValue(username) !== cleanValue(user.username));
    let generatedPassword = null;
    let credentialDispatch = null;
    if (detailsChanged) {
      generatedPassword = generateStrongPassword(12);
      const passwordHash = await hashPassword(generatedPassword);
      await query(
        `UPDATE users
         SET full_name = COALESCE(?, full_name),
             username = COALESCE(?, username),
             email = COALESCE(?, email),
             phone = COALESCE(?, phone),
             password_hash = ?,
             password_last_changed_at = NOW(),
             password_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY),
             must_change_password = 1,
             failed_login_attempts = 0,
             locked_until = NULL,
             last_failed_login_at = NULL
         WHERE id = ?`,
        [full_name, username, email, phone, passwordHash, PASSWORD_ROTATION_DAYS, userId]
      );
      const institutionRows = await query(
        "SELECT institution_name, institution_code FROM institutions WHERE id = ? LIMIT 1",
        [user.institution_id]
      );
      const institutionName = cleanValue(institutionRows[0]?.institution_name || "-");
      const institutionCode = cleanValue(institutionRows[0]?.institution_code || "-");
      credentialDispatch = await dispatchCredentialNotice({
        email: nextEmail,
        phone: nextPhone,
        subject: "IMIS Updated Welcome Credentials",
        message: [
          "Your profile details were updated in IMIS.",
          `Institution: ${institutionName}`,
          `Institution Code: ${institutionCode}`,
          `Username: ${username || user.username || "-"}`,
          `Temporary Password: ${generatedPassword}`,
          `Role: ${user.role || "-"}`,
          `Name: ${nextName || "-"}`,
          "",
          "Use the new password and change it immediately at first login."
        ].join("\n")
      });
    } else {
      await query(
        `UPDATE users
         SET full_name = COALESCE(?, full_name),
             username = COALESCE(?, username),
             email = COALESCE(?, email),
             phone = COALESCE(?, phone)
         WHERE id = ?`,
        [full_name, username, email, phone, userId]
      );
    }
    await auditLog(req.user, "UPDATE_REGISTRY_USER", "users", userId, {
      username,
      full_name,
      email,
      phone,
      details_changed: detailsChanged,
      fresh_welcome_dispatched: detailsChanged
    });
    res.json({
      message: "User saved successfully.",
      fresh_welcome_dispatched: detailsChanged,
      generated_password: canManageAcrossInstitutions(req.user) ? generatedPassword : null,
      credential_dispatch: credentialDispatch
    });
  })
);

app.patch(
  "/api/system/registry/users/:id/status",
  auth,
  enforceModuleAccess(MODULE_KEYS.INSTITUTIONS_USERS_REGISTRY),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
    const statusUserScopeError = await assertInstitutionScopeAccess(req, target.institution_id, "You can only change user status in your assigned institution scope.");
    if (statusUserScopeError) {
      return res.status(statusUserScopeError.status).json({ error: statusUserScopeError.error });
    }
    const isActive = req.body?.is_active;
    const isSuspended = req.body?.is_suspended;
    const reason = cleanOptionalValue(req.body?.reason) || null;
    const userStatusColumns = await getExistingColumns("users", [
      "is_active",
      "is_suspended",
      "status_reason",
      "suspended_reason"
    ]);
    const updatePairs = [];
    const updateParams = [];
    if (userStatusColumns.includes("is_active") && isActive !== undefined) {
      updatePairs.push("is_active = ?");
      updateParams.push(Number(Boolean(isActive)));
    }
    if (userStatusColumns.includes("is_suspended") && isSuspended !== undefined) {
      updatePairs.push("is_suspended = ?");
      updateParams.push(Number(Boolean(isSuspended)));
    }
    if (userStatusColumns.includes("status_reason") && reason && isActive !== undefined && Number(Boolean(isActive)) === 0) {
      updatePairs.push("status_reason = ?");
      updateParams.push(reason);
    }
    if (userStatusColumns.includes("suspended_reason") && reason && isSuspended !== undefined && Number(Boolean(isSuspended)) === 1) {
      updatePairs.push("suspended_reason = ?");
      updateParams.push(reason);
    }
    if (updatePairs.length) {
      await query(
        `UPDATE users
         SET ${updatePairs.join(", ")}
         WHERE id = ?`,
        [...updateParams, userId]
      );
    }
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    await purgeExpiredRecycleBinItems();
    await normalizeLegacyRecycleBinVisibility();
    const limit = parseBoundedInt(req.query?.limit, { fallback: 200, min: 1, max: 1000 });
    const statusFilter = cleanValue(req.query?.status).toUpperCase();
    const visibilityScope = determineRecycleVisibilityScope(req.user);
    const requestedScope = Number(req.query?.institution_id || 0) || null;
    const institutionScopeWhenGlobal = visibilityScope.includeAllInstitutions ? requestedScope : null;
    let sql = `SELECT id, institution_id, entity_name, entity_id, archived_payload_json, deleted_by_user_id, deleted_at,
                      restored_at, restored_by_user_id, permanently_deleted_at, permanently_deleted_by_user_id,
                      status, hidden_for_roles_json
               FROM recycle_bin_items
               WHERE 1=1`;
    const params = [];
    if (visibilityScope.includeAllInstitutions) {
      if (institutionScopeWhenGlobal && Number(institutionScopeWhenGlobal) > 0) {
        sql += " AND institution_id = ?";
        params.push(Number(institutionScopeWhenGlobal));
      }
    } else {
      const scopedId = Number(visibilityScope.scopeInstitutionId || 0);
      if (!scopedId) {
        return res.json({
          items: [],
          retention_years: RECYCLE_BIN_RETENTION_YEARS,
          recycle_scope_notice: "Recycle bin scoped to institution, but no institution id is linked to your user."
        });
      }
      sql += " AND institution_id = ?";
      params.push(scopedId);
    }
    if (statusFilter) {
      sql += " AND status = ?";
      params.push(statusFilter);
    }
    sql += ` ORDER BY id DESC LIMIT ${limit}`;
    const rows = await query(sql, params);
    const normalizedRows = rows
      .filter((row) => !roleHiddenFromItem(req.user.role, row))
      .filter((row) => shouldRecycleBinEntryExposeDeleterViewer(req.user.role, row))
      .map((row) => {
        const payload = parseStoredJson(row.archived_payload_json) || {};
        const recycleMeta = parseArchivedRecycleMeta(row.archived_payload_json);
        return {
          ...row,
          deleted_by_name:
            cleanValue(recycleMeta.deleted_by_full_name) ||
            cleanValue(payload.deleted_by_name) ||
            null,
          deleted_by_username:
            cleanValue(recycleMeta.deleted_by_username) ||
            cleanValue(payload.deleted_by_username) ||
            null,
          deleted_ip_address:
            cleanValue(recycleMeta.deleted_ip_address) ||
            cleanValue(payload.deleted_ip_address) ||
            null,
          deleted_machine_name:
            cleanValue(recycleMeta.deleted_machine_name) ||
            cleanValue(payload.deleted_machine_name) ||
            null,
          delete_description:
            cleanValue(recycleMeta.description) ||
            cleanValue(payload.description) ||
            cleanValue(payload.entity_description) ||
            null
        };
      });
    res.json({
      items: normalizedRows,
      retention_years: RECYCLE_BIN_RETENTION_YEARS
    });
  })
);

app.post(
  "/api/system/recycle-bin/:id/restore",
  auth,
  enforceModuleAccess(MODULE_KEYS.RECYCLE_BIN),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
    if (!shouldRecycleBinEntryExposeDeleterViewer(req.user.role, item)) {
      return res.status(403).json({ error: "This recycle-bin record is retained for supervisory review only." });
    }
    const restoreScopeError = await assertInstitutionScopeAccess(req, item.institution_id, "You can only restore items from your assigned institution scope.");
    if (restoreScopeError) {
      return res.status(restoreScopeError.status).json({ error: restoreScopeError.error });
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.SYSTEM_ADMINISTRATOR, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.DELETE),
  asyncHandler(async (req, res) => {
    const recycleId = Number(req.params.id);
    if (!recycleId) return res.status(400).json({ error: "Valid recycle bin item id is required." });
    const rows = await query(
      `SELECT id, institution_id, status, entity_name, entity_id, archived_payload_json
       FROM recycle_bin_items
       WHERE id = ?
       LIMIT 1`,
      [recycleId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Recycle bin item not found." });
    }
    const item = rows[0];
    if (!shouldRecycleBinEntryExposeDeleterViewer(req.user.role, item)) {
      return res.status(403).json({ error: "This recycle-bin record is retained for supervisory review only." });
    }
    const purgeDecision = canPurgeRecycleItem(req.user, item);
    if (!purgeDecision.allowed) {
      return res.status(403).json({ error: "You can only purge items from your institution scope." });
    }
    const confirmations = Array.isArray(req.body?.confirmations) ? req.body.confirmations : [];
    if (!verifyThreeStepDeleteConfirm(confirmations)) {
      return res.status(400).json({
        error:
          "Three-step confirmation required. Send confirmations: ['YES','CONFIRM','DELETE'] in the request body."
      });
    }
    const normalizedRole = normalizeRole(req.user.role);
    if (isAnySystemDeveloperRole(normalizedRole)) {
      await query(
        `UPDATE recycle_bin_items
         SET status = 'DELETED',
             hidden_for_roles_json = NULL,
             permanently_deleted_at = NOW(),
             permanently_deleted_by_user_id = ?
         WHERE id = ?`,
        [req.user.id, recycleId]
      );
    } else {
      const hiddenRoles = new Set(parseHiddenRoles(item.hidden_for_roles_json));
      hiddenRoles.add(normalizedRole);
      await query(
        `UPDATE recycle_bin_items
         SET status = CASE WHEN status = 'TRASHED' THEN 'DELETED' ELSE status END,
             hidden_for_roles_json = ?,
             permanently_deleted_at = COALESCE(permanently_deleted_at, NOW()),
             permanently_deleted_by_user_id = COALESCE(permanently_deleted_by_user_id, ?)
         WHERE id = ?`,
        [JSON.stringify(Array.from(hiddenRoles)), req.user.id, recycleId]
      );
    }
    await auditLog(req.user, "PURGE_RECYCLE_BIN_ITEM", "recycle_bin_items", recycleId, {
      entity_name: item.entity_name,
      entity_id: item.entity_id,
      mode: purgeDecision.mode
    });
    const responseMessage = purgeDecision.mode === "SYSTEM_DEVELOPER_PURGE"
      ? "Recycle bin item permanently deleted."
      : "Item removed from your recycle bin view. It remains visible to System Developer for retention control.";
    res.json({
      message: responseMessage,
      recycle_bin_id: recycleId,
      purge_mode: purgeDecision.mode
    });
  })
);

async function buildSystemOpsOverview({ actorUser, requestedInstitutionId = null }) {
  const institutionScope = canManageAcrossInstitutions(actorUser)
    ? (Number(requestedInstitutionId || 0) || null)
    : Number(actorUser.institution_id || 0) || null;
  const whereClause = institutionScope ? "WHERE institution_id = ?" : "";
  const scopeParams = institutionScope ? [institutionScope] : [];
  const countRows = async (tableName) => {
    const columns = await getTableColumns(tableName);
    if (!columns.length) return null;
    const rows = await query(`SELECT COUNT(*) AS total FROM ${tableName} ${whereClause}`, scopeParams);
    return Number(rows[0]?.total || 0);
  };
  const moduleChecks = [];
  const pushModule = (moduleKey, moduleLabel, totalRows) => {
    const numeric = Number(totalRows);
    const isMissing = totalRows === null || !Number.isFinite(numeric);
    moduleChecks.push({
      module_key: moduleKey,
      module_label: moduleLabel,
      total_rows: isMissing ? null : numeric,
      status: isMissing ? "MISSING_TABLE" : (numeric > 0 ? "HEALTHY" : "EMPTY"),
      summary: isMissing
        ? "Underlying table is missing."
        : numeric > 0
          ? "Module data available."
          : "No rows found; module is enabled but currently empty."
    });
  };
  pushModule("admission", "Admission Learners", await countRows("learners"));
  pushModule("management-teacher-resources", "Teacher Resources", await countRows("teacher_resources"));
  pushModule("attendance", "Attendance", await countRows("attendance_records"));
  pushModule("academic-exams", "Academic Exams", await countRows("academic_exams"));
  pushModule("academic-marks", "Academic Marks", await countRows("academic_marks"));
  pushModule("finance-fee-structure", "Fee Structures", await countRows("finance_fee_structures"));
  pushModule("finance-fee-payments", "Fee Payments", await countRows("finance_fee_payments"));
  pushModule("finance-payroll", "Payroll", await countRows("finance_payroll_records"));
  pushModule("finance-salary-advance", "Salary Advances", await countRows("finance_salary_advances"));
  pushModule("finance-procurement", "Procurement", await countRows("finance_procurement_records"));
  pushModule("communication-messages", "Communication Queue", await countRows("communication_messages"));
  pushModule("learner-materials", "Learner Materials", await countRows("learner_resources"));
  pushModule("welfare-contributions", "Welfare Contributions", await countRows("welfare_contributions"));
  pushModule("welfare-loans", "Welfare Loans", await countRows("welfare_loans"));
  pushModule("laws", "Laws / Policies", await countRows("laws_regulations_policies"));
  const [failedLoginsRow] = await query(
    `SELECT COUNT(*) AS total
     FROM activity_logs
     ${whereClause ? `${whereClause} AND` : "WHERE"} action IN ('LOGIN_FAILED', 'ACCOUNT_LOCKED')
       AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
    scopeParams
  );
  const [otpFailureRow] = await query(
    `SELECT COUNT(*) AS total
     FROM activity_logs
     ${whereClause ? `${whereClause} AND` : "WHERE"} action IN ('OTP_VERIFY_FAILED', 'OTP_EXHAUSTED')
       AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
    scopeParams
  );
  const [queuedMessageRow] = await query(
    `SELECT COUNT(*) AS total
     FROM communication_messages
     ${whereClause ? `${whereClause} AND` : "WHERE"} status = 'Queued'`,
    scopeParams
  ).catch(() => [{ total: 0 }]);
  const [incidentOpenRow] = await query(
    `SELECT COUNT(*) AS total
     FROM system_security_incidents
     ${whereClause ? `${whereClause} AND` : "WHERE"} status IN ('OPEN', 'IN_PROGRESS')`,
    scopeParams
  ).catch(() => [{ total: 0 }]);
  const recommendations = [];
  const modulesMissingData = moduleChecks.filter((item) => item.status === "EMPTY").map((item) => item.module_label);
  if (modulesMissingData.length) {
    recommendations.push(`Module data currently empty: ${modulesMissingData.slice(0, 8).join(", ")}.`);
  }
  if (Number(failedLoginsRow?.total || 0) > 40) {
    recommendations.push("High failed login volume detected in the last 24h. Review account lock policies and IP patterns.");
  }
  if (Number(otpFailureRow?.total || 0) > 30) {
    recommendations.push("High OTP failure volume detected in the last 24h. Investigate channel delivery reliability and brute force attempts.");
  }
  if (!emailChannelReady()) {
    recommendations.push("Email channel is not ready. Configure SENDGRID credentials.");
  }
  if (!smsChannelReady()) {
    recommendations.push("SMS channel is not ready. Configure SMS provider credentials.");
  }
  if (!configuredJwtSecret) {
    recommendations.push("JWT secret not configured for production hardening.");
  }
  return {
    institution_scope: institutionScope,
    metrics: {
      failed_login_events_24h: Number(failedLoginsRow?.total || 0),
      otp_fail_events_24h: Number(otpFailureRow?.total || 0),
      queued_messages: Number(queuedMessageRow?.total || 0),
      open_security_incidents: Number(incidentOpenRow?.total || 0)
    },
    security_posture: {
      jwt_secret_configured: Boolean(configuredJwtSecret),
      otp_email_ready: emailChannelReady(),
      otp_sms_ready: smsChannelReady(),
      csp_enabled: String(process.env.ENABLE_CSP || "false").toLowerCase() === "true",
      force_https: String(process.env.FORCE_HTTPS || "true").toLowerCase() !== "false"
    },
    module_health: moduleChecks,
    recommendations
  };
}

app.get(
  "/api/system/ops/overview",
  auth,
  enforceModuleAccess(MODULE_KEYS.SYSTEM_OPS_CENTER),
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.SYSTEM_ADMINISTRATOR,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION
  ]),
  asyncHandler(async (req, res) => {
    const overview = await buildSystemOpsOverview({
      actorUser: req.user,
      requestedInstitutionId: req.query?.institution_id
    });
    const limit = parseBoundedInt(req.query?.snapshot_limit, { fallback: 20, min: 1, max: 100 });
    const params = [];
    let where = "WHERE 1=1";
    if (overview.institution_scope) {
      where += " AND institution_id = ?";
      params.push(overview.institution_scope);
    }
    const snapshots = await query(
      `SELECT id, institution_id, module_key, module_label, status, total_rows, metric_payload_json, created_at
       FROM system_module_health_snapshots
       ${where}
       ORDER BY id DESC
       LIMIT ${limit}`,
      params
    ).catch(() => []);
    res.json({ ...overview, recent_snapshots: snapshots.map((row) => ({ ...row, metric_payload_json: parseStoredJson(row.metric_payload_json) || null })) });
  })
);

app.post(
  "/api/system/ops/snapshots",
  auth,
  enforceModuleAccess(MODULE_KEYS.SYSTEM_OPS_CENTER),
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.SYSTEM_ADMINISTRATOR,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION
  ]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const overview = await buildSystemOpsOverview({
      actorUser: req.user,
      requestedInstitutionId: req.body?.institution_id
    });
    let created = 0;
    for (const moduleRow of overview.module_health) {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `INSERT INTO system_module_health_snapshots
          (institution_id, module_key, module_label, status, total_rows, metric_payload_json, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          overview.institution_scope || req.user.institution_id,
          moduleRow.module_key,
          moduleRow.module_label,
          moduleRow.status,
          moduleRow.total_rows,
          JSON.stringify({ summary: moduleRow.summary, metrics: overview.metrics, posture: overview.security_posture }),
          String(req.user.id || "")
        ]
      );
      created += 1;
    }
    await auditLog(req.user, "CREATE_SYSTEM_MODULE_HEALTH_SNAPSHOT", "system_module_health_snapshots", null, {
      created_rows: created,
      institution_scope: overview.institution_scope || req.user.institution_id
    });
    res.status(201).json({ message: "System module health snapshots created.", created_rows: created });
  })
);

app.get(
  "/api/system/security/incidents",
  auth,
  enforceModuleAccess(MODULE_KEYS.SYSTEM_INCIDENT_RESPONSE),
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.SYSTEM_ADMINISTRATOR,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION
  ]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionScope = canManageAcrossInstitutions(req.user)
      ? (Number(req.query?.institution_id || 0) || null)
      : Number(req.user.institution_id || 0) || null;
    const statusFilter = cleanValue(req.query?.status || "").toUpperCase();
    const severityFilter = cleanValue(req.query?.severity || "").toUpperCase();
    const limit = parseBoundedInt(req.query?.limit, { fallback: 100, min: 1, max: 1000 });
    const whereParts = ["1=1"];
    const params = [];
    if (institutionScope) {
      whereParts.push("institution_id = ?");
      params.push(institutionScope);
    }
    if (statusFilter) {
      whereParts.push("status = ?");
      params.push(statusFilter);
    }
    if (severityFilter) {
      whereParts.push("severity = ?");
      params.push(severityFilter);
    }
    const rows = await query(
      `SELECT id, institution_id, incident_code, incident_type, severity, status, title, description, affected_module,
              source_channel, details_json, response_actions, assigned_to_user_id, resolution_notes, detected_at, resolved_at, created_at, updated_at
       FROM system_security_incidents
       WHERE ${whereParts.join(" AND ")}
       ORDER BY detected_at DESC, id DESC
       LIMIT ${limit}`,
      params
    );
    res.json(rows.map((row) => ({ ...row, details_json: parseStoredJson(row.details_json) || null })));
  })
);

app.post(
  "/api/system/security/incidents",
  auth,
  enforceModuleAccess(MODULE_KEYS.SYSTEM_INCIDENT_RESPONSE),
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.SYSTEM_ADMINISTRATOR,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION
  ]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const incidentType = cleanValue(req.body?.incident_type || "GENERAL");
    const severity = cleanValue(req.body?.severity || "MEDIUM").toUpperCase();
    const title = cleanValue(req.body?.title || "");
    const description = cleanValue(req.body?.description || "");
    if (!title || !description) {
      return res.status(400).json({ error: "title and description are required." });
    }
    const institutionId = canManageAcrossInstitutions(req.user)
      ? (Number(req.body?.institution_id || 0) || Number(req.user.institution_id || 0))
      : Number(req.user.institution_id || 0);
    const incidentCode = `INC-${dayjs().format("YYYYMMDD")}-${String(Math.floor(Math.random() * 100000)).padStart(5, "0")}`;
    const result = await query(
      `INSERT INTO system_security_incidents
        (institution_id, incident_code, incident_type, severity, status, title, description, affected_module, source_channel,
         details_json, response_actions, assigned_to_user_id, resolution_notes, detected_at, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [
        institutionId,
        incidentCode,
        incidentType,
        severity || "MEDIUM",
        "OPEN",
        title,
        description,
        cleanOptionalValue(req.body?.affected_module),
        cleanOptionalValue(req.body?.source_channel),
        req.body?.details_json === undefined ? null : JSON.stringify(req.body.details_json),
        cleanOptionalValue(req.body?.response_actions),
        cleanOptionalValue(req.body?.assigned_to_user_id),
        cleanOptionalValue(req.body?.resolution_notes),
        String(req.user.id || "")
      ]
    );
    await auditLog(req.user, "CREATE_SECURITY_INCIDENT", "system_security_incidents", result.insertId, {
      incident_code: incidentCode,
      incident_type: incidentType,
      severity
    });
    res.status(201).json({ id: result.insertId, incident_code: incidentCode, message: "Security incident created." });
  })
);

app.patch(
  "/api/system/security/incidents/:id(\\d+)",
  auth,
  enforceModuleAccess(MODULE_KEYS.SYSTEM_INCIDENT_RESPONSE),
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.SYSTEM_ADMINISTRATOR,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION
  ]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const incidentId = Number(req.params.id || 0);
    if (!incidentId) {
      return res.status(400).json({ error: "Valid incident id is required." });
    }
    const institutionScope = canManageAcrossInstitutions(req.user)
      ? (Number(req.body?.institution_id || 0) || null)
      : Number(req.user.institution_id || 0);
    const updates = [];
    const params = [];
    const fields = [
      "incident_type",
      "severity",
      "status",
      "title",
      "description",
      "affected_module",
      "source_channel",
      "response_actions",
      "assigned_to_user_id",
      "resolution_notes"
    ];
    fields.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) return;
      updates.push(`${field} = ?`);
      if (field === "severity" || field === "status") {
        params.push(cleanOptionalValue(req.body?.[field]) ? cleanValue(req.body[field]).toUpperCase() : null);
      } else {
        params.push(cleanOptionalValue(req.body?.[field]));
      }
    });
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "details_json")) {
      updates.push("details_json = ?");
      params.push(req.body?.details_json === undefined ? null : JSON.stringify(req.body.details_json));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "status")) {
      const normalized = cleanValue(req.body?.status).toUpperCase();
      if (normalized === "RESOLVED") {
        updates.push("resolved_at = COALESCE(resolved_at, NOW())");
      }
    }
    if (!updates.length) {
      return res.status(400).json({ error: "No incident fields provided for update." });
    }
    const where = institutionScope ? " AND institution_id = ?" : "";
    const whereParams = institutionScope ? [institutionScope] : [];
    await query(
      `UPDATE system_security_incidents
       SET ${updates.join(", ")}, updated_at = NOW()
       WHERE id = ?${where}`,
      [...params, incidentId, ...whereParams]
    );
    await auditLog(req.user, "UPDATE_SECURITY_INCIDENT", "system_security_incidents", incidentId, pickFields(req.body || {}, [...fields, "details_json"]));
    res.json({ message: "Security incident updated." });
  })
);

app.get(
  "/api/cbc/curriculum",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    let data = pickFields(req.body, [
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
    data = await filterRowByTableColumns("cbc_curriculum_entries", data);
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const entryId = Number(req.params.id);
    if (!entryId) return res.status(400).json({ error: "Valid curriculum entry id is required." });
    let data = pickFields(req.body, [
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
    data = await filterRowByTableColumns("cbc_curriculum_entries", data);
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SENIOR_TEACHER, ROLES.HEAD_OF_DEPARTMENT, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SENIOR_TEACHER, ROLES.HEAD_OF_DEPARTMENT, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SENIOR_TEACHER, ROLES.HEAD_OF_DEPARTMENT, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SENIOR_TEACHER, ROLES.HEAD_OF_DEPARTMENT, ROLES.TEACHER]),
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
    const baseGenerated = makeNotes({
      grade,
      formName,
      learningArea,
      strand,
      subStrand: resolvedSubStrand
    });
    const levelCriteria = resolveLevelSelectionCriteria({ grade, formName });
    const curriculumRows = await query(
      `SELECT grade, form_name, strand, sub_strand, specific_learning_outcomes, learning_experiences, notes
       FROM cbc_curriculum_entries
       WHERE institution_id = ?
         AND learning_area = ?
       ORDER BY id DESC
       LIMIT 2400`,
      [req.user.institution_id, learningArea]
    ).catch(() => []);
    const scopedRows = (Array.isArray(curriculumRows) ? curriculumRows : [])
      .filter((row) => rowWithinSelectedLevelRange({ row, criteria: levelCriteria }));
    const scopedByStrand = scopedRows.filter((row) => {
      if (!strand) return true;
      return cleanValue(row.strand || "").toLowerCase() === strand.toLowerCase();
    });
    const strandCoverage = new Map();
    scopedByStrand.forEach((row) => {
      const strandName = cleanValue(row.strand || "");
      if (!strandName) return;
      if (!strandCoverage.has(strandName)) strandCoverage.set(strandName, new Set());
      const sub = cleanValue(row.sub_strand || "");
      if (sub) strandCoverage.get(strandName).add(sub);
    });
    const missingContentRows = scopedByStrand
      .filter((row) => {
        const hasOutcomes = Boolean(cleanOptionalValue(row.specific_learning_outcomes));
        const hasExperiences = Boolean(cleanOptionalValue(row.learning_experiences));
        const hasNotes = Boolean(cleanOptionalValue(row.notes));
        return !(hasOutcomes || hasExperiences || hasNotes);
      })
      .slice(0, 25)
      .map((row) => `${cleanValue(row.strand || "-")} -> ${cleanValue(row.sub_strand || "-")}`);
    const materialRows = await query(
      `SELECT resource_type, title, description, strand, sub_strand, grade, stream AS form_name, created_at
       FROM teacher_resources
       WHERE institution_id = ?
         AND ((? = '' AND ? = '') OR grade = ? OR stream = ?)
       ORDER BY id DESC
       LIMIT 300`,
      [req.user.institution_id, grade, formName, grade, formName]
    ).catch(() => []);
    const scopedMaterials = (Array.isArray(materialRows) ? materialRows : [])
      .filter((row) => {
        const text = `${cleanValue(row.title)} ${cleanValue(row.description)}`.toLowerCase();
        return learningArea ? text.includes(learningArea.toLowerCase()) : true;
      });
    const templateSnippets = scopedMaterials
      .filter((row) => cleanValue(row.resource_type).toLowerCase() === "notes_template")
      .map((row) => cleanValue(row.description))
      .map((text) => {
        const extracted = text.match(/uploaded content extract:\s*([\s\S]*)/i);
        return cleanValue((extracted && extracted[1]) || text).slice(0, 800);
      })
      .filter(Boolean)
      .slice(0, 3);
    const referenceSnippets = scopedMaterials
      .filter((row) => ["notes", "past_papers", "sample_exams"].includes(cleanValue(row.resource_type).toLowerCase()))
      .map((row) => cleanValue(row.description))
      .map((text) => {
        const extracted = text.match(/uploaded content extract:\s*([\s\S]*)/i);
        return cleanValue((extracted && extracted[1]) || text).slice(0, 400);
      })
      .filter(Boolean)
      .slice(0, 5);
    const enrichmentLines = [];
    if (strandCoverage.size) {
      enrichmentLines.push("FULL STRAND/SUB-STRAND COVERAGE IN SCOPE:");
      Array.from(strandCoverage.entries()).forEach(([strandName, subs]) => {
        const subList = Array.from(subs.values());
        enrichmentLines.push(`- ${strandName}: ${subList.length ? subList.join(" | ") : "No sub-strands captured"}`);
      });
    }
    if (missingContentRows.length) {
      enrichmentLines.push("", "MISSING CONTENT AREAS TO COMPLETE:");
      missingContentRows.forEach((item) => enrichmentLines.push(`- ${item}`));
    }
    if (templateSnippets.length) {
      enrichmentLines.push("", "UPLOADED NOTES TEMPLATE BASIS:");
      templateSnippets.forEach((snippet, index) => enrichmentLines.push(`${index + 1}. ${snippet}`));
    }
    if (referenceSnippets.length) {
      enrichmentLines.push("", "UPLOADED NOTES/PAPERS INSIGHTS:");
      referenceSnippets.forEach((snippet, index) => enrichmentLines.push(`${index + 1}. ${snippet}`));
    }
    const generated = [
      baseGenerated,
      "",
      "ADVANCED ENRICHMENT (AUTO-ADDED):",
      enrichmentLines.length ? enrichmentLines.join("\n") : "No additional enrichment data found. Continue uploading scoped notes/templates."
    ]
      .join("\n")
      .slice(0, 24000);
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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

async function extractUploadedMaterialSnippet(file = null) {
  if (!file?.path) return null;
  const extension = String(path.extname(file.originalname || file.path || "") || "").toLowerCase();
  const textExtensions = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log"]);
  try {
    let sourceText = "";
    if (extension === ".pdf") {
      let parsePdf = null;
      try {
        // Lazy-load to avoid hard startup dependency failures.
        // eslint-disable-next-line global-require
        parsePdf = require("pdf-parse");
      } catch (_) {
        parsePdf = null;
      }
      if (parsePdf) {
        const fileBuffer = await fs.promises.readFile(file.path);
        const parsed = await parsePdf(fileBuffer);
        sourceText = String(parsed?.text || "");
      }
    } else if (textExtensions.has(extension) || String(file.mimetype || "").startsWith("text/")) {
      sourceText = await fs.promises.readFile(file.path, "utf8");
    }
    const compact = String(sourceText || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!compact) return null;
    return compact.slice(0, 2600);
  } catch (_) {
    return null;
  }
}

app.post(
  "/api/cbc/curriculum/materials/upload",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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
    const learningArea = cleanOptionalValue(req.body?.learning_area);
    const uploadedSnippet = await extractUploadedMaterialSnippet(req.file);
    const mergedDescription = [
      cleanOptionalValue(payload.description),
      learningArea ? `Learning Area: ${learningArea}` : null,
      uploadedSnippet ? `Uploaded Content Extract: ${uploadedSnippet}` : null
    ]
      .filter(Boolean)
      .join("\n\n");
    const result = await query(
      `INSERT INTO teacher_resources
       (institution_id, teacher_profile_id, resource_type, title, description, grade, stream, term, strand, sub_strand, file_path, auto_generated, created_by_user_id)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        req.user.institution_id,
        cleanValue(payload.resource_type) || "CBC_CBE_MATERIAL_UPLOAD",
        cleanValue(payload.title),
        cleanOptionalValue(mergedDescription),
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
      learning_area: learningArea
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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

app.delete(
  "/api/cbc/curriculum/materials/:id(\\d+)",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.DELETE),
  asyncHandler(async (req, res) => {
    const materialId = Number(req.params.id);
    if (!materialId) return res.status(400).json({ error: "Valid material id is required." });
    const rows = await query(
      `SELECT *
       FROM teacher_resources
       WHERE id = ? AND institution_id = ?
       LIMIT 1`,
      [materialId, req.user.institution_id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Material not found." });
    }
    const target = rows[0];
    await archiveRecycleBinItem({
      institutionId: req.user.institution_id,
      entityName: "teacher_resources",
      entityId: target.id,
      payload: target,
      deletedByUserId: req.user.id
    });
    await query(
      `DELETE FROM teacher_resources
       WHERE id = ? AND institution_id = ?`,
      [materialId, req.user.institution_id]
    );
    await auditLog(req.user, "DELETE_CBC_CBE_MATERIAL", "teacher_resources", materialId, {});
    res.json({ message: "Material deleted." });
  })
);

app.post(
  "/api/cbc/curriculum/bulk-generate",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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
  function splitCsvLine(line = "") {
    const cells = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === "\"" && inQuotes && next === "\"") {
        current += "\"";
        i += 1;
        continue;
      }
      if (ch === "\"") {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  }

  function normalizeCsvHeader(value = "") {
    return cleanValue(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return [];
  const headerParts = splitCsvLine(lines[0]).map((item) => normalizeCsvHeader(item));
  const hasNamedColumns = headerParts.includes("learning_area") && headerParts.includes("strand");
  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const parts = splitCsvLine(line);
    if (!parts.length) continue;
    if (hasNamedColumns) {
      const row = {};
      headerParts.forEach((headerKey, idx) => {
        row[headerKey] = cleanValue(parts[idx] || "");
      });
      rows.push({
        action: cleanValue(row.action || "NEW").toUpperCase(),
        mapping_id: Number(row.mapping_id || 0) || null,
        curriculum_entry_id: Number(row.curriculum_entry_id || 0) || null,
        level_mode: cleanValue(row.level_mode || ""),
        grade: cleanValue(row.grade || ""),
        form_name: cleanValue(row.form_name || ""),
        learning_area: cleanValue(row.learning_area || ""),
        strand: cleanValue(row.strand || ""),
        strand_description: cleanValue(row.strand_description || ""),
        sub_strand: cleanValue(row.sub_strand || ""),
        sub_strand_description: cleanValue(row.sub_strand_description || ""),
        notes: cleanValue(row.notes || ""),
        source_label: cleanValue(row.source_label || "CSV Import")
      });
      continue;
    }
    if (parts.length < 3) continue;
    rows.push({
      action: "NEW",
      mapping_id: null,
      curriculum_entry_id: null,
      level_mode: "",
      learning_area: cleanValue(parts[0] || ""),
      strand: cleanValue(parts[1] || ""),
      sub_strand: cleanValue(parts[2] || ""),
      strand_description: "",
      sub_strand_description: "",
      notes: cleanValue(parts[3] || ""),
      grade: cleanValue(parts[4] || ""),
      form_name: cleanValue(parts[5] || ""),
      source_label: cleanValue(parts[6] || "CSV Import")
    });
  }
  return rows.filter((row) => row.learning_area && row.strand && row.sub_strand);
}

function buildMappingNotes({ strand_description, sub_strand_description, notes }) {
  const blocks = [];
  if (cleanValue(strand_description || "")) {
    blocks.push(`Strand Description: ${cleanValue(strand_description || "")}`);
  }
  if (cleanValue(sub_strand_description || "")) {
    blocks.push(`Sub-strand Description: ${cleanValue(sub_strand_description || "")}`);
  }
  if (cleanValue(notes || "")) {
    blocks.push(`Notes: ${cleanValue(notes || "")}`);
  }
  return blocks.join("\n");
}

function extractKicdNarrativeSection(notes = "", heading = "") {
  const source = String(notes || "");
  if (!source || !heading) return "";
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRegex = new RegExp(`${escapedHeading}:\\s*([\\s\\S]*?)(?:\\n\\n[A-Za-z ]+:|$)`, "i");
  const match = source.match(sectionRegex);
  return cleanOptionalValue(match?.[1] || "");
}

function csvCell(value) {
  const raw = String(value ?? "");
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, "\"\"")}"`;
}

app.get(
  "/api/cbc/curriculum/structure-mappings/template",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (_, res) => {
    const levelOrder = [
      "PP2",
      "Grade 1",
      "Grade 2",
      "Grade 3",
      "Grade 4",
      "Grade 5",
      "Grade 6",
      "Grade 7",
      "Grade 8",
      "Grade 9",
      "Grade 10",
      "Grade 11",
      "Grade 12",
      "Form 3",
      "Form 4"
    ];
    const selectedLevels = new Set(levelOrder);
    const previewRows = [];
    for (const level of CBC_LEVELS) {
      const levelLearningAreas = [
        ...(Array.isArray(level.learningAreas) ? level.learningAreas : []),
        ...Object.values(level.pathways || {}).flatMap((areas) => (Array.isArray(areas) ? areas : []))
      ];
      const uniqueAreas = Array.from(new Set(levelLearningAreas.map((area) => cleanValue(area)).filter(Boolean)));
      const gradeList = Array.isArray(level.grades) ? level.grades : [];
      for (const gradeName of gradeList) {
        if (!selectedLevels.has(gradeName)) continue;
        for (const learningArea of uniqueAreas) {
          previewRows.push({
            action: "NEW",
            mapping_id: "",
            curriculum_entry_id: "",
            level_mode: gradeName.startsWith("Form ") ? "form" : "grade",
            grade: gradeName.startsWith("Form ") ? "" : gradeName,
            form_name: gradeName.startsWith("Form ") ? gradeName : "",
            learning_area: learningArea,
            strand: "",
            strand_description: "",
            sub_strand: "",
            sub_strand_description: "",
            notes: "",
            source_label: "KICD-CBC-IMPORT"
          });
        }
      }
    }
    const lines = [
      "action,mapping_id,curriculum_entry_id,level_mode,grade,form_name,learning_area,strand,strand_description,sub_strand,sub_strand_description,notes,source_label",
      "NEW,,,grade,Grade 7,,Social Studies,Human Rights,Main competency area narrative,Meaning of Rights,Sub-topic narrative,Teacher notes/past paper linkage,CSV Import",
      "EDIT,145,3201,grade,Grade 7,,Social Studies,Human Rights Updated,Updated strand details,Meaning of Rights Updated,Updated sub-strand details,Corrective note after review,CSV Import",
      ...previewRows.map((row) => [
        csvCell(row.action),
        csvCell(row.mapping_id),
        csvCell(row.curriculum_entry_id),
        csvCell(row.level_mode),
        csvCell(row.grade),
        csvCell(row.form_name),
        csvCell(row.learning_area),
        csvCell(row.strand),
        csvCell(row.strand_description),
        csvCell(row.sub_strand),
        csvCell(row.sub_strand_description),
        csvCell(row.notes),
        csvCell(row.source_label)
      ].join(","))
    ];
    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"cbc-structure-mappings-template.csv\"");
    res.send(csv);
  })
);

app.get(
  "/api/cbc/curriculum/structure-mappings/template-doc",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (_, res) => {
    const docText = [
      "CBC/CBE STRAND-SUB-STRAND-NOTES TEMPLATE",
      "",
      "Instructions:",
      "1. Use action NEW for fresh rows and EDIT for correcting existing rows.",
      "2. mapping_id edits cbc_structure_mappings; curriculum_entry_id edits cbc_curriculum_entries.",
      "3. Fill one row per sub-strand per level + learning area.",
      "4. Supported levels in template: PP2, Grade 1-12, Form 3, Form 4.",
      "5. Fill strand_description and sub_strand_description to retain detailed narratives.",
      "",
      "CSV Columns:",
      "action,mapping_id,curriculum_entry_id,level_mode,grade,form_name,learning_area,strand,strand_description,sub_strand,sub_strand_description,notes,source_label",
      "",
      "Example:",
      "NEW,,,grade,Grade 8,,Pre-Technical Studies,Workshop Safety,Foundational safety standards,Safety Rules,Sub-strand scope and lesson aims,Include practical tasks and assessment notes,CSV Import",
      "EDIT,218,4402,form,,Form 4,Mathematics,Algebra,Corrected strand narrative,Quadratic Equations,Corrected sub-strand narrative,Updated after curriculum validation,CSV Import"
    ].join("\r\n");
    res.setHeader("Content-Type", "application/msword; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"cbc-structure-mappings-template.doc\"");
    res.send(docText);
  })
);

app.post(
  "/api/cbc/curriculum/structure-mappings/import",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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
    let updatedMappings = 0;
    let updatedCurriculum = 0;
    let createdCurriculum = 0;
    let skipped = 0;
    const skippedRows = [];
    for (const row of rows) {
      const action = cleanValue(row.action || "NEW").toUpperCase();
      const grade = cleanOptionalValue(row.grade);
      const formName = cleanOptionalValue(row.form_name);
      const mappingNotes = buildMappingNotes({
        strand_description: row.strand_description,
        sub_strand_description: row.sub_strand_description,
        notes: row.notes
      });
      if (action === "EDIT") {
        if (Number(row.mapping_id || 0) > 0) {
          const result = await query(
            `UPDATE cbc_structure_mappings
             SET learning_area = ?, strand = ?, sub_strand = ?, notes = ?, grade = ?, form_name = ?, source_label = ?, updated_at = NOW()
             WHERE id = ? AND institution_id = ?`,
            [
              cleanValue(row.learning_area),
              cleanValue(row.strand),
              cleanValue(row.sub_strand),
              cleanOptionalValue(mappingNotes),
              grade,
              formName,
              cleanOptionalValue(row.source_label) || "CSV Import",
              Number(row.mapping_id),
              req.user.institution_id
            ]
          );
          if (Number(result?.affectedRows || 0) > 0) {
            updatedMappings += 1;
          } else {
            skipped += 1;
            skippedRows.push({ row: row.mapping_id, reason: "Mapping ID not found for this institution." });
          }
        } else {
          skipped += 1;
          skippedRows.push({ row: "-", reason: "EDIT action requires mapping_id." });
        }
        if (Number(row.curriculum_entry_id || 0) > 0) {
          const result = await query(
            `UPDATE cbc_curriculum_entries
             SET learning_area = ?, strand = ?, sub_strand = ?, notes = ?, specific_learning_outcomes = ?, updated_at = NOW()
             WHERE id = ? AND institution_id = ?`,
            [
              cleanValue(row.learning_area),
              cleanValue(row.strand),
              cleanValue(row.sub_strand),
              cleanOptionalValue(mappingNotes),
              cleanOptionalValue(row.sub_strand_description || row.notes),
              Number(row.curriculum_entry_id),
              req.user.institution_id
            ]
          );
          if (Number(result?.affectedRows || 0) > 0) {
            updatedCurriculum += 1;
          } else {
            skipped += 1;
            skippedRows.push({ row: row.curriculum_entry_id, reason: "Curriculum entry ID not found for this institution." });
          }
        }
        // eslint-disable-next-line no-continue
        continue;
      }
      const mappingInsert = await query(
        `INSERT INTO cbc_structure_mappings
          (institution_id, learning_area, strand, sub_strand, notes, grade, form_name, source_label, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.institution_id,
          cleanValue(row.learning_area),
          cleanValue(row.strand),
          cleanValue(row.sub_strand),
          cleanOptionalValue(mappingNotes),
          grade,
          formName,
          cleanOptionalValue(row.source_label) || "CSV Import",
          req.user.id
        ]
      );
      if (Number(mappingInsert?.insertId || 0) > 0) imported += 1;
      if (grade || formName) {
        await query(
          `INSERT INTO cbc_curriculum_entries
            (institution_id, grade, form_name, learning_area, strand, sub_strand, specific_learning_outcomes, suggested_assessment_rubric, notes, term, year, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            req.user.institution_id,
            grade || formName || "Grade 7",
            formName,
            cleanValue(row.learning_area),
            cleanValue(row.strand),
            cleanValue(row.sub_strand),
            cleanOptionalValue(row.sub_strand_description || row.notes),
            cleanOptionalValue(row.strand_description),
            cleanOptionalValue(mappingNotes),
            "Term One",
            new Date().getFullYear(),
            req.user.id
          ]
        );
        createdCurriculum += 1;
      }
    }
    await auditLog(req.user, "IMPORT_CBC_STRUCTURE_MAPPINGS", "cbc_structure_mappings", null, {
      imported,
      updated_mappings: updatedMappings,
      updated_curriculum_entries: updatedCurriculum,
      created_curriculum_entries: createdCurriculum,
      skipped
    });
    res.status(201).json({
      message: "Structure mappings import processed.",
      imported_new_mappings: imported,
      updated_mappings: updatedMappings,
      updated_curriculum_entries: updatedCurriculum,
      created_curriculum_entries: createdCurriculum,
      skipped,
      skipped_rows: skippedRows.slice(0, 60)
    });
  })
);

app.post(
  "/api/cbc/curriculum/structure-mappings",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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

app.get(
  "/api/cbc/kicd/catalog",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const includeLevels = Array.isArray(req.query?.include_levels)
      ? req.query.include_levels
      : cleanOptionalValue(req.query?.include_levels)
        ? String(req.query.include_levels).split(",")
        : [];
    const catalog = await fetchKicdCatalog({ includeLevels });
    res.json({
      available_levels: KICD_LEVEL_PAGES,
      ...catalog
    });
  })
);

app.post(
  "/api/cbc/kicd/import",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const includeLevels = Array.isArray(req.body?.include_levels)
      ? req.body.include_levels
      : cleanOptionalValue(req.body?.include_levels)
        ? String(req.body.include_levels).split(",")
        : [];
    const replaceExisting = parseTruthy(req.body?.replace_existing);
    const maxDocuments = Math.min(Math.max(Number(req.body?.max_documents || 200), 1), 1000);
    const maxPagesPerDocument = Math.min(Math.max(Number(req.body?.max_pages_per_document || 200), 10), 1000);
    const upsertCurriculumEntries = parseTruthy(req.body?.upsert_curriculum_entries ?? true);
    const sourceLabel = "KICD_AUTO";

    const catalog = await fetchKicdCatalog({ includeLevels });
    const extracted = await extractKicdCurriculumFromCatalog(catalog, {
      max_documents: maxDocuments,
      max_pages_per_document: maxPagesPerDocument
    });
    const importedRows = Array.isArray(extracted.rows) ? extracted.rows : [];

    if (replaceExisting) {
      await query(
        `DELETE FROM cbc_structure_mappings
         WHERE institution_id = ? AND source_label = ?`,
        [req.user.institution_id, sourceLabel]
      );
    }

    const existingMappings = await query(
      `SELECT learning_area, strand, sub_strand, COALESCE(grade, '') grade, COALESCE(form_name, '') form_name
       FROM cbc_structure_mappings
       WHERE institution_id = ? AND source_label = ?`,
      [req.user.institution_id, sourceLabel]
    );
    const existingMappingKeys = new Set(
      existingMappings.map((row) => [
        cleanValue(row.learning_area).toLowerCase(),
        cleanValue(row.strand).toLowerCase(),
        cleanValue(row.sub_strand).toLowerCase(),
        cleanValue(row.grade).toLowerCase(),
        cleanValue(row.form_name).toLowerCase()
      ].join("::"))
    );

    let insertedMappings = 0;
    let skippedMappings = 0;
    for (const row of importedRows) {
      const grade = cleanOptionalValue(row.grade_label);
      const formName = null;
      const key = [
        cleanValue(row.learning_area).toLowerCase(),
        cleanValue(row.strand).toLowerCase(),
        cleanValue(row.sub_strand).toLowerCase(),
        cleanValue(grade).toLowerCase(),
        cleanValue(formName).toLowerCase()
      ].join("::");
      if (!replaceExisting && existingMappingKeys.has(key)) {
        skippedMappings += 1;
        // eslint-disable-next-line no-continue
        continue;
      }
      const notes = [
        row.learning_outcomes ? `Learning Outcomes:\n${row.learning_outcomes}` : "",
        row.learning_experiences ? `Learning Experiences:\n${row.learning_experiences}` : "",
        row.source_document ? `Source Document: ${row.source_document}` : "",
        row.source_preview_url ? `Source URL: ${row.source_preview_url}` : ""
      ].filter(Boolean).join("\n\n");
      await query(
        `INSERT INTO cbc_structure_mappings
          (institution_id, learning_area, strand, sub_strand, notes, grade, form_name, source_label, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.institution_id,
          cleanValue(row.learning_area),
          cleanValue(row.strand),
          cleanValue(row.sub_strand),
          cleanOptionalValue(notes),
          grade,
          formName,
          sourceLabel,
          req.user.id
        ]
      );
      existingMappingKeys.add(key);
      insertedMappings += 1;
    }

    let insertedCurriculumEntries = 0;
    let updatedCurriculumEntries = 0;
    if (upsertCurriculumEntries) {
      const existingEntries = await query(
        `SELECT id, COALESCE(grade, '') grade, COALESCE(form_name, '') form_name, learning_area, strand, sub_strand,
                specific_learning_outcomes, learning_experiences, resources_reference
         FROM cbc_curriculum_entries
         WHERE institution_id = ?`,
        [req.user.institution_id]
      );
      const existingEntryMap = new Map(
        existingEntries.map((entry) => [
          [
            cleanValue(entry.grade).toLowerCase(),
            cleanValue(entry.form_name).toLowerCase(),
            cleanValue(entry.learning_area).toLowerCase(),
            cleanValue(entry.strand).toLowerCase(),
            cleanValue(entry.sub_strand).toLowerCase()
          ].join("::"),
          entry
        ])
      );

      for (const row of importedRows) {
        const grade = cleanOptionalValue(row.grade_label);
        const formName = null;
        const key = [
          cleanValue(grade).toLowerCase(),
          cleanValue(formName).toLowerCase(),
          cleanValue(row.learning_area).toLowerCase(),
          cleanValue(row.strand).toLowerCase(),
          cleanValue(row.sub_strand).toLowerCase()
        ].join("::");
        const sourceReference = cleanOptionalValue(row.source_preview_url);
        const existing = existingEntryMap.get(key);
        if (existing) {
          const nextOutcomes = replaceExisting
            ? cleanOptionalValue(row.learning_outcomes)
            : cleanOptionalValue(existing.specific_learning_outcomes || row.learning_outcomes);
          const nextExperiences = replaceExisting
            ? cleanOptionalValue(row.learning_experiences)
            : cleanOptionalValue(existing.learning_experiences || row.learning_experiences);
          const nextResources = replaceExisting
            ? sourceReference
            : cleanOptionalValue(existing.resources_reference || sourceReference);
          await query(
            `UPDATE cbc_curriculum_entries
             SET specific_learning_outcomes = COALESCE(?, specific_learning_outcomes),
                 learning_experiences = COALESCE(?, learning_experiences),
                 resources_reference = COALESCE(?, resources_reference),
                 updated_at = NOW()
             WHERE id = ?`,
            [nextOutcomes, nextExperiences, nextResources, existing.id]
          );
          updatedCurriculumEntries += 1;
        } else {
          await query(
            `INSERT INTO cbc_curriculum_entries
              (institution_id, grade, form_name, learning_area, strand, sub_strand, specific_learning_outcomes,
               learning_experiences, resources_reference, created_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              req.user.institution_id,
              grade,
              formName,
              cleanValue(row.learning_area),
              cleanValue(row.strand),
              cleanValue(row.sub_strand),
              cleanOptionalValue(row.learning_outcomes),
              cleanOptionalValue(row.learning_experiences),
              sourceReference,
              req.user.id
            ]
          );
          insertedCurriculumEntries += 1;
        }
      }
    }

    await auditLog(req.user, "IMPORT_KICD_CURRICULUM", "cbc_structure_mappings", null, {
      include_levels: includeLevels,
      replace_existing: replaceExisting,
      max_documents: maxDocuments,
      max_pages_per_document: maxPagesPerDocument,
      scanned_document_count: extracted.scanned_document_count,
      unique_row_count: extracted.unique_row_count,
      inserted_mappings: insertedMappings,
      skipped_mappings: skippedMappings,
      inserted_curriculum_entries: insertedCurriculumEntries,
      updated_curriculum_entries: updatedCurriculumEntries
    });

    res.json({
      message: "KICD curriculum import completed.",
      include_levels: includeLevels,
      catalog_document_count: catalog.document_count,
      scanned_document_count: extracted.scanned_document_count,
      extracted_row_count: extracted.extracted_row_count,
      unique_row_count: extracted.unique_row_count,
      inserted_mappings: insertedMappings,
      skipped_mappings: skippedMappings,
      inserted_curriculum_entries: insertedCurriculumEntries,
      updated_curriculum_entries: updatedCurriculumEntries,
      document_summaries: extracted.document_summaries,
      level_errors: catalog.level_errors,
      document_errors: extracted.document_errors
    });
  })
);

app.post(
  "/api/cbc/curriculum/pretechnical-seed",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const replaceExisting = parseTruthy(req.body?.replace_existing);
    const refreshDescriptions = parseTruthy(req.body?.refresh_descriptions ?? true);
    const sourceLabel = "PHOTO_JSS_CORE";
    const seedRows = getJuniorSecondaryCoreSeedRows();
    if (replaceExisting) {
      await query(
        `DELETE FROM cbc_structure_mappings
         WHERE institution_id = ? AND source_label = ?`,
        [req.user.institution_id, sourceLabel]
      );
    }
    const existingRows = await query(
      `SELECT learning_area, strand, sub_strand, COALESCE(grade, '') grade
       FROM cbc_structure_mappings
       WHERE institution_id = ? AND source_label = ?`,
      [req.user.institution_id, sourceLabel]
    );
    const existingKeys = new Set(
      existingRows.map((row) => [
        cleanValue(row.grade).toLowerCase(),
        cleanValue(row.learning_area).toLowerCase(),
        cleanValue(row.strand).toLowerCase(),
        cleanValue(row.sub_strand).toLowerCase()
      ].join("::"))
    );
    let insertedMappings = 0;
    let skippedMappings = 0;
    for (const row of seedRows) {
      const key = [
        cleanValue(row.grade).toLowerCase(),
        cleanValue(row.learning_area).toLowerCase(),
        cleanValue(row.strand).toLowerCase(),
        cleanValue(row.sub_strand).toLowerCase()
      ].join("::");
      if (!replaceExisting && existingKeys.has(key)) {
        skippedMappings += 1;
        // eslint-disable-next-line no-continue
        continue;
      }
      await query(
        `INSERT INTO cbc_structure_mappings
          (institution_id, learning_area, strand, sub_strand, notes, grade, form_name, source_label, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.institution_id,
          row.learning_area,
          row.strand,
          row.sub_strand,
          cleanOptionalValue(row.notes),
          cleanOptionalValue(row.grade),
          null,
          sourceLabel,
          req.user.id
        ]
      );
      existingKeys.add(key);
      insertedMappings += 1;
    }

    const existingEntries = await query(
      `SELECT id, COALESCE(grade, '') grade, learning_area, strand, sub_strand
       FROM cbc_curriculum_entries
       WHERE institution_id = ?`,
      [req.user.institution_id]
    );
    const existingEntryKeys = new Set(
      existingEntries.map((entry) => [
        cleanValue(entry.grade).toLowerCase(),
        cleanValue(entry.learning_area).toLowerCase(),
        cleanValue(entry.strand).toLowerCase(),
        cleanValue(entry.sub_strand).toLowerCase()
      ].join("::"))
    );
    let insertedCurriculumEntries = 0;
    let updatedCurriculumEntries = 0;
    let updatedMappings = 0;
    const existingEntryIdByKey = new Map(
      existingEntries.map((entry) => ([
        [
          cleanValue(entry.grade).toLowerCase(),
          cleanValue(entry.learning_area).toLowerCase(),
          cleanValue(entry.strand).toLowerCase(),
          cleanValue(entry.sub_strand).toLowerCase()
        ].join("::"),
        Number(entry.id || 0)
      ]))
    );
    for (const row of seedRows) {
      const key = [
        cleanValue(row.grade).toLowerCase(),
        cleanValue(row.learning_area).toLowerCase(),
        cleanValue(row.strand).toLowerCase(),
        cleanValue(row.sub_strand).toLowerCase()
      ].join("::");
      if (existingEntryKeys.has(key)) {
        if (refreshDescriptions) {
          const existingId = Number(existingEntryIdByKey.get(key) || 0);
          if (existingId) {
            await query(
              `UPDATE cbc_curriculum_entries
               SET specific_learning_outcomes = COALESCE(NULLIF(?, ''), specific_learning_outcomes),
                   suggested_assessment_rubric = COALESCE(NULLIF(?, ''), suggested_assessment_rubric),
                   learning_experiences = COALESCE(NULLIF(?, ''), learning_experiences),
                   notes = COALESCE(NULLIF(?, ''), notes),
                   updated_at = NOW()
               WHERE id = ? AND institution_id = ?`,
              [
                cleanOptionalValue(row.sub_strand_description || row.specific_learning_outcomes),
                cleanOptionalValue(row.strand_description),
                cleanOptionalValue(row.learning_experiences),
                cleanOptionalValue(row.notes),
                existingId,
                req.user.institution_id
              ]
            );
            updatedCurriculumEntries += 1;
          }
        }
        // eslint-disable-next-line no-continue
        continue;
      }
      await query(
        `INSERT INTO cbc_curriculum_entries
          (institution_id, grade, form_name, learning_area, strand, sub_strand, specific_learning_outcomes,
           suggested_assessment_rubric, learning_experiences, notes, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.institution_id,
          cleanOptionalValue(row.grade),
          null,
          row.learning_area,
          row.strand,
          row.sub_strand,
          cleanOptionalValue(row.sub_strand_description || row.specific_learning_outcomes),
          cleanOptionalValue(row.strand_description),
          cleanOptionalValue(row.learning_experiences),
          cleanOptionalValue(row.notes),
          req.user.id
        ]
      );
      existingEntryKeys.add(key);
      insertedCurriculumEntries += 1;
    }
    if (refreshDescriptions) {
      for (const row of seedRows) {
        const updateResult = await query(
          `UPDATE cbc_structure_mappings
           SET notes = COALESCE(NULLIF(?, ''), notes), updated_at = NOW()
           WHERE institution_id = ? AND source_label = ? AND grade = ? AND learning_area = ? AND strand = ? AND sub_strand = ?`,
          [
            cleanOptionalValue(row.notes),
            req.user.institution_id,
            sourceLabel,
            cleanOptionalValue(row.grade),
            row.learning_area,
            row.strand,
            row.sub_strand
          ]
        );
        if (Number(updateResult?.affectedRows || 0) > 0) {
          updatedMappings += 1;
        }
      }
    }

    await auditLog(req.user, "SEED_JSS_PRETECHNICAL_STRANDS", "cbc_structure_mappings", null, {
      source_label: sourceLabel,
      replace_existing: replaceExisting,
      refresh_descriptions: refreshDescriptions,
      inserted_mappings: insertedMappings,
      skipped_mappings: skippedMappings,
      inserted_curriculum_entries: insertedCurriculumEntries,
      updated_curriculum_entries: updatedCurriculumEntries,
      updated_mappings: updatedMappings
    });
    res.json({
      message: "Grade 7-9 Pre-Technical + Social Studies strands/sub-strands seeded successfully.",
      source_label: sourceLabel,
      inserted_mappings: insertedMappings,
      skipped_mappings: skippedMappings,
      inserted_curriculum_entries: insertedCurriculumEntries,
      updated_curriculum_entries: updatedCurriculumEntries,
      updated_mappings: updatedMappings
    });
  })
);

app.post(
  "/api/cbc/local-curriculum/import",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const baseDirectory = cleanOptionalValue(req.body?.base_directory) || path.join(process.cwd(), "uploads", "curriculum-design");
    const replaceExisting = parseTruthy(req.body?.replace_existing);
    const upsertCurriculumEntries = parseTruthy(req.body?.upsert_curriculum_entries ?? true);
    const maxFiles = Math.min(Math.max(Number(req.body?.max_files || 500), 1), 5000);
    const sourceLabel = cleanOptionalValue(req.body?.source_label) || "LOCAL_CURRICULUM_PDF";

    const extracted = await importLocalCurriculumFromPdfDirectory({
      base_directory: baseDirectory,
      max_files: maxFiles
    });
    const importedRows = Array.isArray(extracted.rows) ? extracted.rows : [];

    if (replaceExisting) {
      await query(
        `DELETE FROM cbc_structure_mappings
         WHERE institution_id = ? AND source_label = ?`,
        [req.user.institution_id, sourceLabel]
      );
    }

    const existingMappings = await query(
      `SELECT learning_area, strand, sub_strand, COALESCE(grade, '') grade, COALESCE(form_name, '') form_name
       FROM cbc_structure_mappings
       WHERE institution_id = ? AND source_label = ?`,
      [req.user.institution_id, sourceLabel]
    );
    const existingMappingKeys = new Set(
      existingMappings.map((row) => [
        cleanValue(row.learning_area).toLowerCase(),
        cleanValue(row.strand).toLowerCase(),
        cleanValue(row.sub_strand).toLowerCase(),
        cleanValue(row.grade).toLowerCase(),
        cleanValue(row.form_name).toLowerCase()
      ].join("::"))
    );

    let insertedMappings = 0;
    let skippedMappings = 0;
    for (const row of importedRows) {
      const gradeOrForm = cleanValue(row.grade_label);
      const isForm = /^form\s+\d+/i.test(gradeOrForm);
      const grade = isForm ? null : cleanOptionalValue(gradeOrForm);
      const formName = isForm ? cleanOptionalValue(gradeOrForm) : null;
      const learningArea = cleanValue(row.learning_area);
      const strand = cleanValue(row.strand);
      const subStrand = cleanValue(row.sub_strand);
      if (!learningArea || !strand || !subStrand) {
        skippedMappings += 1;
        // eslint-disable-next-line no-continue
        continue;
      }
      const key = [
        learningArea.toLowerCase(),
        strand.toLowerCase(),
        subStrand.toLowerCase(),
        cleanValue(grade).toLowerCase(),
        cleanValue(formName).toLowerCase()
      ].join("::");
      if (!replaceExisting && existingMappingKeys.has(key)) {
        skippedMappings += 1;
        // eslint-disable-next-line no-continue
        continue;
      }
      const notes = [
        row.learning_outcomes ? `Learning Outcomes:\n${row.learning_outcomes}` : "",
        row.learning_experiences ? `Learning Experiences:\n${row.learning_experiences}` : "",
        row.pathway ? `Pathway: ${row.pathway}` : "",
        row.source_document ? `Source Document: ${row.source_document}` : "",
        row.source_file_path ? `Source File Path: ${row.source_file_path}` : ""
      ].filter(Boolean).join("\n\n");
      await query(
        `INSERT INTO cbc_structure_mappings
          (institution_id, learning_area, strand, sub_strand, notes, grade, form_name, source_label, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.institution_id,
          learningArea,
          strand,
          subStrand,
          cleanOptionalValue(notes),
          grade,
          formName,
          sourceLabel,
          req.user.id
        ]
      );
      existingMappingKeys.add(key);
      insertedMappings += 1;
    }

    let insertedCurriculumEntries = 0;
    let updatedCurriculumEntries = 0;
    if (upsertCurriculumEntries) {
      const existingEntries = await query(
        `SELECT id, COALESCE(grade, '') grade, COALESCE(form_name, '') form_name, learning_area, strand, sub_strand,
                specific_learning_outcomes, learning_experiences, resources_reference
         FROM cbc_curriculum_entries
         WHERE institution_id = ?`,
        [req.user.institution_id]
      );
      const existingEntryMap = new Map(
        existingEntries.map((entry) => [
          [
            cleanValue(entry.grade).toLowerCase(),
            cleanValue(entry.form_name).toLowerCase(),
            cleanValue(entry.learning_area).toLowerCase(),
            cleanValue(entry.strand).toLowerCase(),
            cleanValue(entry.sub_strand).toLowerCase()
          ].join("::"),
          entry
        ])
      );

      for (const row of importedRows) {
        const gradeOrForm = cleanValue(row.grade_label);
        const isForm = /^form\s+\d+/i.test(gradeOrForm);
        const grade = isForm ? null : cleanOptionalValue(gradeOrForm);
        const formName = isForm ? cleanOptionalValue(gradeOrForm) : null;
        const learningArea = cleanValue(row.learning_area);
        const strand = cleanValue(row.strand);
        const subStrand = cleanValue(row.sub_strand);
        if (!learningArea || !strand || !subStrand) {
          // eslint-disable-next-line no-continue
          continue;
        }
        const key = [
          cleanValue(grade).toLowerCase(),
          cleanValue(formName).toLowerCase(),
          learningArea.toLowerCase(),
          strand.toLowerCase(),
          subStrand.toLowerCase()
        ].join("::");
        const sourceReference = cleanOptionalValue(row.source_file_path || row.source_document);
        const existing = existingEntryMap.get(key);
        if (existing) {
          const nextOutcomes = replaceExisting
            ? cleanOptionalValue(row.learning_outcomes)
            : cleanOptionalValue(existing.specific_learning_outcomes || row.learning_outcomes);
          const nextExperiences = replaceExisting
            ? cleanOptionalValue(row.learning_experiences)
            : cleanOptionalValue(existing.learning_experiences || row.learning_experiences);
          const nextResources = replaceExisting
            ? sourceReference
            : cleanOptionalValue(existing.resources_reference || sourceReference);
          await query(
            `UPDATE cbc_curriculum_entries
             SET specific_learning_outcomes = COALESCE(?, specific_learning_outcomes),
                 learning_experiences = COALESCE(?, learning_experiences),
                 resources_reference = COALESCE(?, resources_reference),
                 updated_at = NOW()
             WHERE id = ?`,
            [nextOutcomes, nextExperiences, nextResources, existing.id]
          );
          updatedCurriculumEntries += 1;
        } else {
          await query(
            `INSERT INTO cbc_curriculum_entries
              (institution_id, grade, form_name, learning_area, strand, sub_strand, specific_learning_outcomes,
               learning_experiences, resources_reference, created_by_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              req.user.institution_id,
              grade,
              formName,
              learningArea,
              strand,
              subStrand,
              cleanOptionalValue(row.learning_outcomes),
              cleanOptionalValue(row.learning_experiences),
              sourceReference,
              req.user.id
            ]
          );
          insertedCurriculumEntries += 1;
        }
      }
    }

    await auditLog(req.user, "IMPORT_LOCAL_CURRICULUM_PDF", "cbc_structure_mappings", null, {
      base_directory: extracted.base_directory,
      replace_existing: replaceExisting,
      source_label: sourceLabel,
      max_files: maxFiles,
      scanned_file_count: extracted.scanned_file_count,
      parsed_file_count: extracted.parsed_file_count,
      unique_row_count: extracted.unique_row_count,
      inserted_mappings: insertedMappings,
      skipped_mappings: skippedMappings,
      inserted_curriculum_entries: insertedCurriculumEntries,
      updated_curriculum_entries: updatedCurriculumEntries
    });

    res.json({
      message: "Local curriculum PDF import completed.",
      base_directory: extracted.base_directory,
      source_label: sourceLabel,
      scanned_file_count: extracted.scanned_file_count,
      parsed_file_count: extracted.parsed_file_count,
      extracted_row_count: extracted.extracted_row_count,
      unique_row_count: extracted.unique_row_count,
      inserted_mappings: insertedMappings,
      skipped_mappings: skippedMappings,
      inserted_curriculum_entries: insertedCurriculumEntries,
      updated_curriculum_entries: updatedCurriculumEntries,
      file_summaries: extracted.file_summaries,
      file_errors: extracted.file_errors
    });
  })
);

app.get(
  "/api/cbc/kicd/export/csv",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const sourceLabel = cleanOptionalValue(req.query?.source_label) || "KICD_AUTO";
    const rows = await query(
      `SELECT learning_area, strand, sub_strand, notes, COALESCE(grade, '') grade, COALESCE(form_name, '') form_name,
              source_label, created_at, updated_at
       FROM cbc_structure_mappings
       WHERE institution_id = ?
         AND (? = '*' OR source_label = ?)
       ORDER BY learning_area, strand, sub_strand`,
      [req.user.institution_id, sourceLabel, sourceLabel]
    );
    const header = [
      "grade",
      "form_name",
      "learning_area",
      "strand",
      "sub_strand",
      "learning_outcomes",
      "learning_experiences",
      "notes",
      "source_label",
      "created_at",
      "updated_at"
    ];
    const csv = [
      header.join(","),
      ...rows.map((row) =>
        [
          row.grade || "",
          row.form_name || "",
          row.learning_area || "",
          row.strand || "",
          row.sub_strand || "",
          extractKicdNarrativeSection(row.notes, "Learning Outcomes"),
          extractKicdNarrativeSection(row.notes, "Learning Experiences"),
          row.notes || "",
          row.source_label || "",
          row.created_at ? new Date(row.created_at).toISOString() : "",
          row.updated_at ? new Date(row.updated_at).toISOString() : ""
        ].map(csvCell).join(",")
      )
    ].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"kicd-curriculum-structure.csv\"");
    res.send(csv);
  })
);

app.get(
  "/api/cbc/kicd/export/excel",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const sourceLabel = cleanOptionalValue(req.query?.source_label) || "KICD_AUTO";
    const rows = await query(
      `SELECT learning_area, strand, sub_strand, notes, COALESCE(grade, '') grade, COALESCE(form_name, '') form_name,
              source_label, created_at, updated_at
       FROM cbc_structure_mappings
       WHERE institution_id = ?
         AND (? = '*' OR source_label = ?)
       ORDER BY learning_area, strand, sub_strand`,
      [req.user.institution_id, sourceLabel, sourceLabel]
    );
    const headers = [
      "Grade",
      "Form",
      "Learning Area",
      "Strand",
      "Sub-Strand",
      "Learning Outcomes",
      "Learning Experiences",
      "Notes",
      "Source Label",
      "Created At",
      "Updated At"
    ];
    const dataRows = rows.map((row) => [
      row.grade || "",
      row.form_name || "",
      row.learning_area || "",
      row.strand || "",
      row.sub_strand || "",
      extractKicdNarrativeSection(row.notes, "Learning Outcomes"),
      extractKicdNarrativeSection(row.notes, "Learning Experiences"),
      row.notes || "",
      row.source_label || "",
      row.created_at ? new Date(row.created_at).toISOString() : "",
      row.updated_at ? new Date(row.updated_at).toISOString() : ""
    ]);
    await sendSimpleExcel(res, "kicd-curriculum-structure", headers, dataRows);
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
      if (![ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN].includes(requesterRole)) {
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
    const updateType = cleanValue(req.body?.update_type || "profile_update");
    const passwordChange = updateType === "password_change" || Boolean(req.body?.password_change);
    if (
      !passwordChange &&
      [ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN].includes(requesterRole)
    ) {
      return res.json({
        message: "OTP is optional for your role for non-password changes. Proceed directly.",
        otp_required: false
      });
    }
    const requestedChannelRaw = cleanValue(req.body?.otp_channel || "email").toLowerCase();
    const requestedProfileChannel = ["both", "sms_email", "email_sms"].includes(requestedChannelRaw)
      ? "sms_email"
      : requestedChannelRaw;
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
    const deliveryPlan =
      buildParallelOtpDeliveries(requestedProfileChannel, {
        otp_email: me.email,
        otp_phone: me.phone,
        destination: `${me.username}@profile`
      }) ||
      buildParallelOtpDeliveries("console", {
        otp_email: me.email,
        otp_phone: me.phone,
        destination: me.username
      });
    if (!deliveryPlan?.channels?.length) {
      return res.status(400).json({
        error: "OTP could not be dispatched. Add email and mobile to your profile and configure SMTP/SMS."
      });
    }
    const identity = `profile-update:${me.username}`;
    const otpSession = await createOtpSession({
      identity,
      role: "PROFILE_UPDATE",
      institutionId: me.institution_id,
      payload: { user_id: me.id, update_type: updateType },
      destination: deliveryPlan.primaryDestination,
      channel: deliveryPlan.primaryChannel,
      deliveryPlan
    });
    await auditLog(req.user, "PROFILE_UPDATE_OTP_REQUESTED", "otp_sessions", null, {
      update_type: updateType,
      otp_channels: otpSession.sendResults || []
    });
    const exposeOtp =
      isSuperSystemDeveloperRole(req.user.role) &&
      (process.env.NODE_ENV !== "production" || parseTruthy(process.env.EXPOSE_OTP_PREVIEW));
    res.json({
      message: `OTP dispatched (${(otpSession.sendResults || []).join(", ")}).`,
      otp_required: true,
      otp_channels_used: deliveryPlan.channels.map((c) => c.channel),
      otp_delivery_log: otpSession.sendResults || [],
      otp_preview: exposeOtp ? otpSession.code : null,
      otp_expires_at: exposeOtp ? otpSession.expiresAt : null
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
    const phoneChanged =
      phone !== undefined &&
      phone !== null &&
      String(phone).trim() !== String(user.phone || "").trim();
    const requireOtp =
      Boolean(newPassword) || phoneChanged || ![ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN].includes(requesterRole);

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
      "birth_certificate_number",
      "grade",
      "form_name",
      "stream"
    ],
    allowedRoles: [ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER],
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
      "postal_address",
      "postal_code",
      "town",
      "year_joined",
      "term_joined",
      "orphan_condition",
      "status",
      "conduct_status",
      "parent_full_name",
      "parent_relationship",
      "parent_id_number",
      "parent_phone",
      "parent_phone_secondary",
      "parent_email",
      "parent_nationality",
      "parent_residence",
      "parent_occupation",
      "biological_parental_status",
      "parent2_full_name",
      "parent2_id_number",
      "parent2_phone_primary",
      "parent2_phone_secondary",
      "parent2_nationality",
      "parent2_residence",
      "parent2_occupation",
      "parent2_email",
      "parent2_relationship",
      "learner_condition",
      "has_medical_condition",
      "medical_condition_notes",
      "disability_type",
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
      "next_of_kin_email",
      "postal_address",
      "town",
      "postal_code",
      "email_address",
      "passport_photo_path"
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
      "next_of_kin_contact",
      "next_of_kin_relationship",
      "next_of_kin_mobile",
      "next_of_kin_email",
      "postal_address",
      "town",
      "postal_code",
      "email_address",
      "passport_photo_path"
    ]
  },
  {
    route: "/api/management/service-providers",
    table: "service_provider_profiles",
    moduleKey: MODULE_KEYS.MANAGEMENT_SERVICE_PROVIDERS,
    searchFields: ["full_name", "company_name", "service_rendered", "id_number"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: [
      "full_name",
      "company_name",
      "id_number",
      "service_rendered",
      "postal_address",
      "town",
      "postal_code",
      "phone_number",
      "email_address",
      "next_of_kin_name",
      "next_of_kin_relationship",
      "next_of_kin_mobile",
      "next_of_kin_email",
      "passport_photo_path",
      "employment_status"
    ]
  },
  {
    route: "/api/management/bom",
    table: "bom_profiles",
    moduleKey: MODULE_KEYS.MANAGEMENT_BOM,
    searchFields: ["full_name", "id_number"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: [
      "full_name",
      "id_number",
      "postal_address",
      "town",
      "postal_code",
      "phone_number",
      "email_address",
      "passport_photo_path",
      "employment_status"
    ]
  },
  {
    route: "/api/management/teacher-resources",
    table: "teacher_resources",
    moduleKey: MODULE_KEYS.MANAGEMENT_TEACHER_RESOURCES,
    searchFields: ["resource_type", "title", "grade", "term"],
    allowedRoles: [ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER],
    scopedByRole: {
      roles: [ROLES.TEACHER],
      column: "created_by_user_id"
    },
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
      "teacher_exam_supplement",
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
      ROLES.SUPER_SYSTEM_DEVELOPER,
      ROLES.SYSTEM_DEVELOPER,
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
      let data = pickFields(req.body, config.fields);
      let assignLearnerSerialAfterInsert = false;
      data.institution_id = req.user.institution_id;
      data.created_by_user_id = req.user.id;
      if (scopedFilter.where && config.scopedByRole?.column) {
        const scopedColumn = cleanValue(config.scopedByRole.column || "").toLowerCase();
        data[config.scopedByRole.column] =
          scopedColumn.endsWith("_user_id") || scopedColumn === "created_by_user_id"
            ? Number(req.user.id || 0) || null
            : cleanValue(req.user.full_name) || cleanValue(req.user.username);
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

      if (config.table === "learners") {
        if (Object.prototype.hasOwnProperty.call(data, "learner_serial_number")) {
          delete data.learner_serial_number;
        }
        const gradePart = cleanValue(data.grade || "");
        const formPart = cleanValue(data.form_name || "");
        if (gradePart && formPart) {
          return res.status(400).json({ error: "Select either Grade or Form, not both." });
        }
        if (!gradePart && !formPart) {
          return res.status(400).json({ error: "Either Grade or Form must be provided." });
        }
        if (formPart) {
          data.grade = "";
        } else {
          data.form_name = null;
        }
        const lc = cleanValue(data.learner_condition || "").toLowerCase();
        if (lc !== "with disability" && lc !== "yes") {
          data.disability_type = null;
        }
        const mc = cleanValue(data.has_medical_condition || "").toLowerCase();
        if (mc !== "yes") {
          data.medical_condition_notes = null;
        }
        const learnerSerialColumn = await getExistingColumns("learners", ["learner_serial_number"]);
        if (learnerSerialColumn.includes("learner_serial_number")) {
          // Use insert id as permanent learner serial (first-registered sequence, never reassigned).
          assignLearnerSerialAfterInsert = true;
        }
      }

      data = await filterRowByTableColumns(config.table, data);
      const columns = Object.keys(data);
      if (!columns.length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }
      const placeholders = columns.map(() => "?").join(", ");
      const sql = `INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders})`;
      const result = await query(sql, Object.values(data));
      if (config.table === "learners" && assignLearnerSerialAfterInsert) {
        await query(
          `UPDATE learners
           SET learner_serial_number = COALESCE(learner_serial_number, ?)
           WHERE id = ? AND institution_id = ?`,
          [Number(result.insertId || 0), Number(result.insertId || 0), req.user.institution_id]
        );
      }
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
      let data = pickFields(req.body, config.fields);
      if (config.table === "learners") {
        const mergeRows = await query(
          `SELECT grade, form_name, learner_condition, has_medical_condition FROM ${config.table}
           WHERE id = ? AND institution_id = ?${scopedFilter.where}
           LIMIT 1`,
          [req.params.id, req.user.institution_id, ...scopedFilter.params]
        );
        if (!mergeRows.length) {
          return res.status(404).json({ error: "Record not found." });
        }
        const prev = mergeRows[0];
        const gradePart = cleanValue(
          Object.prototype.hasOwnProperty.call(data, "grade") ? data.grade : prev.grade
        );
        const formPart = cleanValue(
          Object.prototype.hasOwnProperty.call(data, "form_name") ? data.form_name : prev.form_name
        );
        if (gradePart && formPart) {
          return res.status(400).json({ error: "Select either Grade or Form, not both." });
        }
        if (!gradePart && !formPart) {
          return res.status(400).json({ error: "Either Grade or Form must be provided." });
        }
        if (formPart) {
          data.grade = "";
        } else {
          data.form_name = null;
        }
        const lcSource = Object.prototype.hasOwnProperty.call(data, "learner_condition")
          ? data.learner_condition
          : prev.learner_condition;
        const lc = cleanValue(lcSource || "").toLowerCase();
        if (lc !== "with disability" && lc !== "yes") {
          data.disability_type = null;
        }
        const mcSource = Object.prototype.hasOwnProperty.call(data, "has_medical_condition")
          ? data.has_medical_condition
          : prev.has_medical_condition;
        const mc = cleanValue(mcSource || "").toLowerCase();
        if (mc !== "yes") {
          data.medical_condition_notes = null;
        }
      }
      if (config.table === "academic_exams") {
        const touchesExam =
          Object.prototype.hasOwnProperty.call(data, "generated_exam_text") ||
          Object.prototype.hasOwnProperty.call(data, "teacher_exam_supplement");
        if (touchesExam) {
          data.serials_processed_at = null;
        }
      }
      data = await filterRowByTableColumns(config.table, data);
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
  "/api/admission/learners/bulk-import",
  auth,
  enforceModuleAccess(MODULE_KEYS.ADMISSION),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const admissionCfg = moduleConfigs.find((c) => c.route === "/api/admission/learners");
    const allowedFields = admissionCfg ? admissionCfg.fields : [];
    const rowsIn = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rowsIn.length) {
      return res.status(400).json({ error: "rows array is required (parsed CSV)." });
    }
    if (rowsIn.length > 500) {
      return res.status(400).json({ error: "Maximum 500 learner rows per upload." });
    }
    const learnerSerialColumn = await getExistingColumns("learners", ["learner_serial_number"]);
    const hasSerialCol = learnerSerialColumn.includes("learner_serial_number");
    let created = 0;
    const errors = [];

    // eslint-disable-next-line no-await-in-loop
    for (let i = 0; i < rowsIn.length; i += 1) {
      const rawRow = rowsIn[i];
      if (!rawRow || typeof rawRow !== "object") {
        errors.push({ index: i, error: "Empty row." });
        // eslint-disable-next-line no-continue
        continue;
      }
      const payload = { ...rawRow };
      const fname = cleanValue(payload.full_name || "");
      if (!fname) {
        const assembled = [payload.first_name, payload.middle_name, payload.last_name, payload.other_names]
          .map((part) => cleanValue(part || ""))
          .filter(Boolean)
          .join(" ")
          .trim();
        if (assembled) {
          payload.full_name = assembled;
        }
      }
      const dataPrep = pickFields(payload, allowedFields);
      if (Object.prototype.hasOwnProperty.call(dataPrep, "learner_serial_number")) {
        delete dataPrep.learner_serial_number;
      }
      dataPrep.institution_id = req.user.institution_id;
      dataPrep.created_by_user_id = req.user.id;
      if (!cleanValue(dataPrep.full_name || "")) {
        errors.push({ index: i, error: "full_name is required (or provide first_name / last_name)." });
        // eslint-disable-next-line no-continue
        continue;
      }
      const gradePart = cleanValue(dataPrep.grade || "");
      const formPart = cleanValue(dataPrep.form_name || "");
      if (gradePart && formPart) {
        errors.push({ index: i, error: "Select either Grade or Form, not both." });
        // eslint-disable-next-line no-continue
        continue;
      }
      if (!gradePart && !formPart) {
        errors.push({ index: i, error: "Either Grade or Form must be provided." });
        // eslint-disable-next-line no-continue
        continue;
      }
      if (formPart) {
        dataPrep.grade = "";
      } else {
        dataPrep.form_name = null;
      }
      const lc = cleanValue(dataPrep.learner_condition || "").toLowerCase();
      if (lc !== "with disability" && lc !== "yes") {
        dataPrep.disability_type = null;
      }
      const mc = cleanValue(dataPrep.has_medical_condition || "").toLowerCase();
      if (mc !== "yes") {
        dataPrep.medical_condition_notes = null;
      }
      try {
        const insertRow = await filterRowByTableColumns("learners", dataPrep);
        const columns = Object.keys(insertRow);
        if (!columns.length) {
          errors.push({ index: i, error: "No valid learner fields." });
          // eslint-disable-next-line no-continue
          continue;
        }
        const placeholders = columns.map(() => "?").join(", ");
        const sql = `INSERT INTO learners (${columns.join(", ")}) VALUES (${placeholders})`;
        // eslint-disable-next-line no-await-in-loop
        const result = await query(sql, Object.values(insertRow));
        if (hasSerialCol && result.insertId) {
          // eslint-disable-next-line no-await-in-loop
          await query(
            `UPDATE learners
             SET learner_serial_number = COALESCE(learner_serial_number, ?)
             WHERE id = ? AND institution_id = ?`,
            [Number(result.insertId), Number(result.insertId), req.user.institution_id]
          );
        }
        await auditLog(req.user, "BULK_CREATE", "learners", result.insertId, { row_index: i });
        created += 1;
      } catch (err) {
        errors.push({ index: i, error: String(err?.message || err || "Insert failed.") });
      }
    }
    await auditLog(req.user, "BULK_IMPORT_LEARNERS", "learners", null, {
      attempted: rowsIn.length,
      created,
      error_count: errors.length
    });
    res.json({
      message: "Bulk learner import finished.",
      attempted: rowsIn.length,
      created,
      failed: errors.length,
      errors: errors.slice(0, 40)
    });
  })
);

app.post(
  "/api/management/teacher-resources/auto-generate",
  auth,
  enforceModuleAccess(MODULE_KEYS.MANAGEMENT_TEACHER_RESOURCES),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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

function extractNumericToken(rawValue = "") {
  const match = String(rawValue || "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractLevelNumber(rawLevel = "") {
  const match = String(rawLevel || "").match(/(?:grade|form)\s*(\d+)/i);
  if (match) return Number(match[1]);
  const direct = String(rawLevel || "").match(/(\d+)/);
  if (!direct) return null;
  const parsed = Number(direct[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyLevelTrack(rawLevel = "") {
  const normalized = cleanValue(rawLevel || "").toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.startsWith("pp")) return "pre-primary";
  if (normalized.startsWith("form")) return "senior-secondary";
  if (normalized.startsWith("grade")) {
    const num = extractLevelNumber(normalized);
    if (!Number.isFinite(num)) return "unknown";
    if (num <= 3) return "lower-primary";
    if (num <= 6) return "upper-primary";
    if (num <= 9) return "junior-secondary";
    return "senior-secondary";
  }
  return "unknown";
}

function baseLevelByTrack(track = "unknown") {
  if (track === "pre-primary") return 1;
  if (track === "lower-primary") return 1;
  if (track === "upper-primary") return 4;
  if (track === "junior-secondary") return 7;
  if (track === "senior-secondary") return 3;
  return null;
}

function resolveLevelSelectionCriteria({ grade = "", formName = "" } = {}) {
  const selectedLabel = cleanValue(grade || formName || "");
  const track = classifyLevelTrack(selectedLabel);
  const levelNumber = extractLevelNumber(selectedLabel);
  const baseLevel = baseLevelByTrack(track);
  return {
    selected_label: selectedLabel,
    track,
    level_number: Number.isFinite(levelNumber) ? levelNumber : null,
    base_level: Number.isFinite(baseLevel) ? baseLevel : null
  };
}

function rowWithinSelectedLevelRange({ row, criteria }) {
  if (!criteria || !criteria.selected_label) return true;
  const rowLabel = cleanValue(row?.grade || row?.form_name || "");
  if (!rowLabel) return true;
  const rowTrack = classifyLevelTrack(rowLabel);
  if (criteria.track !== "unknown" && rowTrack !== "unknown" && rowTrack !== criteria.track) {
    return false;
  }
  const rowLevel = extractLevelNumber(rowLabel);
  if (criteria.level_number === null || rowLevel === null) {
    return cleanValue(rowLabel) === criteria.selected_label;
  }
  if (criteria.base_level !== null) {
    return rowLevel >= criteria.base_level && rowLevel <= criteria.level_number;
  }
  return rowLevel <= criteria.level_number;
}

function rowWithinExamCoverage({ row, selectedStrands = [], selectedSubStrands = [] }) {
  const selectedStrandSet = new Set((Array.isArray(selectedStrands) ? selectedStrands : []).map((item) => cleanValue(item)).filter(Boolean));
  const selectedSubStrandSet = new Set((Array.isArray(selectedSubStrands) ? selectedSubStrands : []).map((item) => cleanValue(item)).filter(Boolean));
  const rowStrand = cleanValue(row?.strand || "");
  const rowSubStrand = cleanValue(row?.sub_strand || "");
  if (selectedStrandSet.size && !selectedStrandSet.has(rowStrand)) return false;
  if (selectedSubStrandSet.size && rowSubStrand && !selectedSubStrandSet.has(rowSubStrand)) return false;
  return true;
}

function examPaperHash32(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function examPaperMulberry32(a) {
  return function exMul() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function examPaperShuffle(items, rng) {
  const arr = Array.isArray(items) ? items.slice() : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function examPaperSplitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 18);
}

/** Labels used only for curriculum tagging — must not leak into learner-facing questions */
function examPaperRefNeedles(ref = {}) {
  const out = [];
  [ref?.strand, ref?.sub_strand].forEach((x) => {
    const v = cleanOptionalValue(x);
    if (v.length > 2) out.push(v);
  });
  return out;
}

function examPaperSentenceLooksLikeCatalogHeading(s) {
  const t = String(s || "").trim();
  if (!t) return true;
  if (/^strand\s*[:.]?$/i.test(t) || /^sub[-\s]?strand\s*[:.]?$/i.test(t)) return true;
  if (/^strand\s+description\b/i.test(t) || /^sub[-\s]?strand\s+description\b/i.test(t)) return true;
  if (/^description\s*[:(]/i.test(t)) return true;
  if (/^learning\s+outcomes?\b/i.test(t) && t.length < 100) return true;
  const headNum = /^\s*\d+(?:\.\d+)+\s+/.exec(t);
  if (headNum && t.length < 95) return true;
  return false;
}

function examPaperStripStrandNoise(text, ref = {}) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  examPaperRefNeedles(ref).forEach((needle) => {
    if (needle.length < 3) return;
    const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(esc, "gi"), " ").replace(/\s{2,}/g, " ").trim();
  });
  t = t.replace(/^\s*(?:strand|sub[-\s]?strand)\s*(?:description)?\s*[:.\-]\s*/i, "").trim();
  t = t.replace(/^\s*\d+(?:\.\d+)+\s+/, "").trim();
  return t.replace(/^[,;:)»"'“”]+/, "").trim();
}

/** Stem source: teaching notes / experiences only — avoids pasting sub-strand description lines */
function examPaperStemContentPool(ref) {
  const merged = `${cleanOptionalValue(ref?.notes)} ${cleanOptionalValue(ref?.learning_experiences)}`;
  return examPaperSplitSentences(merged)
    .map((s) => examPaperStripStrandNoise(s, ref))
    .filter((s) => s.length > 24 && !examPaperSentenceLooksLikeCatalogHeading(s));
}

function examPaperSubjectKind(learningArea = "") {
  const s = cleanValue(learningArea).toLowerCase();
  if (s.includes("pre-technical")) return "pretechnical";
  if (s.includes("social studies")) return "social";
  return "general";
}

function examPaperDistractorBank(kind) {
  if (kind === "social") {
    return [
      "It narrows the idea to unrelated entertainment examples only.",
      "It ignores how environment and human activities influence each other.",
      "It assumes every community had identical historical experiences.",
      "It claims geography is only about naming places without processes.",
      "It suggests resources have no link to settlement or livelihoods."
    ];
  }
  if (kind === "pretechnical") {
    return [
      "It confuses workshop measurement with decorating finished work only.",
      "It suggests tools may be used without standard safety procedures.",
      "It mixes up marking-out tools with driving/fastening tools.",
      "It assumes material choice can ignore strength and task demands.",
      "It implies maintenance is unnecessary if the tool looks clean."
    ];
  }
  return [
    "It misstates a key relationship required by the CBC learning outcome.",
    "It selects an idea that contradicts basic definitions in the learning area.",
    "It applies a concept from an unrelated context.",
    "It overgeneralises one example to all cases."
  ];
}

function examPaperBuildDistractors({ kind, correctText, rng }) {
  const c = String(correctText || "").toLowerCase();
  const bank = examPaperShuffle(examPaperDistractorBank(kind), rng);
  const out = [];
  for (const line of bank) {
    if (!line) continue;
    if (line.toLowerCase() === c) continue;
    if (out.includes(line)) continue;
    out.push(line);
    if (out.length >= 3) break;
  }
  while (out.length < 3) {
    out.push(`It incorrectly states a core fact about the topic (${out.length + 1}).`);
  }
  return out.slice(0, 3);
}

function examPaperCorrectFromRef(ref, rng) {
  const merged = `${cleanOptionalValue(ref?.notes)} ${cleanOptionalValue(ref?.specific_learning_outcomes)}`;
  const pool = examPaperSplitSentences(merged)
    .map((s) => examPaperStripStrandNoise(s, ref))
    .filter((s) => s.length > 14 && !examPaperSentenceLooksLikeCatalogHeading(s));
  if (pool.length) {
    return pool[Math.floor(rng() * pool.length)].slice(0, 150);
  }
  return "It demonstrates accurate knowledge, correct reasoning, and CBC-aligned application for this topic.".slice(0, 150);
}

function examPaperStemSocialStudies(ref, snippet, learningArea, rng) {
  const pool = examPaperStemContentPool(ref);
  const area = cleanValue(learningArea);
  const leads = [
    "Which statement is most accurate?",
    "Choose the best answer from the alternatives given.",
    "Which option reflects sound reasoning for this topic?",
    "Identify the alternative that completes the idea correctly.",
    "Select the option that best fits the Citizenship / Social Studies context."
  ];
  if (pool.length && rng() > 0.12) {
    const pick = pool[Math.floor(rng() * pool.length)].replace(/\s+/g, " ").trim().slice(0, 210);
    const head = leads[Math.floor(rng() * leads.length)];
    return `${head}\nSupporting text: ${pick}`;
  }
  if (snippet && rng() > 0.28) {
    const s = examPaperStripStrandNoise(String(snippet).replace(/\s+/g, " ").trim().slice(0, 210), ref);
    if (s.length > 40) {
      return `${leads[Math.floor(rng() * leads.length)]}\nSituation: ${s}`;
    }
  }
  const fillers = [
    `Which alternative best describes learners' civic responsibility linked to themes in ${area}?`,
    `Which response shows careful use of geography and environment concepts in ${area}?`,
    `Identify the statement that respects rights, culture, and participation in society.`,
    `Choose the conclusion that fits historical or community evidence as taught in ${area}.`,
    `Which answer shows the safest way to handle a resource or conflict scenario?`
  ];
  return fillers[Math.floor(rng() * fillers.length)];
}

function examPaperStemFromRef(ref, snippet, learningArea, qn, rng, kind) {
  if (kind === "social") {
    return examPaperStemSocialStudies(ref, snippet, learningArea, rng);
  }
  const pool = examPaperStemContentPool(ref);
  const area = cleanValue(learningArea);
  if (pool.length && rng() > 0.22) {
    const pick = pool[Math.floor(rng() * pool.length)].slice(0, 220);
    return `Read the statement below and choose the most accurate option.\n"${pick}"`;
  }
  if (snippet && rng() > 0.35) {
    const s = examPaperStripStrandNoise(String(snippet).replace(/\s+/g, " ").trim().slice(0, 220), ref);
    if (s.length > 35) {
      return `Study the scenario and choose the best answer.\nScenario: ${s}`;
    }
  }
  if (kind === "pretechnical") {
    return `Choose the option that demonstrates correct understanding for safe workshop practice and materials use.`;
  }
  return `Which statement aligns best with the ideas covered in ${area}?`;
}

function normalizeQuestionBankMcqForExam(mcqPayload) {
  let payload = mcqPayload;
  if (payload === null || payload === undefined || payload === "") {
    return null;
  }
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (_) {
      return null;
    }
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const letters = ["A", "B", "C", "D"];
  const answerGuess = cleanValue(payload.answer ?? payload.correct_answer ?? payload.key ?? "");
  let answerLetter = letters.includes(answerGuess.slice(0, 1).toUpperCase())
    ? answerGuess.slice(0, 1).toUpperCase()
    : "";

  let rawItems = [];
  if (Array.isArray(payload.options)) rawItems = payload.options;
  else if (Array.isArray(payload.choices)) rawItems = payload.choices;
  const tuples = [];
  rawItems.forEach((entry) => {
    if (typeof entry === "string") {
      const textLine = cleanValue(entry);
      if (textLine) {
        tuples.push({ letter: "", text: textLine });
      }
      return;
    }
    if (!entry || typeof entry !== "object") return;
    const labelRaw = entry.label ?? entry.Letter ?? entry.letter ?? entry.key ?? "";
    const labelLetter = letters.includes(String(labelRaw).trim().toUpperCase().slice(0, 1))
      ? String(labelRaw).trim().toUpperCase().slice(0, 1)
      : "";
    const text = cleanValue(
      entry.text ?? entry.body ?? entry.value ?? entry.choice ?? entry.answer ?? entry.answer_text ?? ""
    );
    if (!text) return;
    tuples.push({ letter: labelLetter || "", text });
  });

  if (tuples.length >= 4 && tuples.every((item) => item.text && !item.letter)) {
    tuples.splice(4);
    tuples.forEach((item, idx) => {
      item.letter = letters[idx];
    });
  }

  if (tuples.length < 4 && rawItems.length >= 4) {
    tuples.length = 0;
    rawItems.slice(0, 8).forEach((entry, idx) => {
      if (idx > 3) return;
      const text =
        typeof entry === "string"
          ? cleanValue(entry)
          : cleanValue(
              entry?.text ?? entry?.body ?? entry?.value ?? entry?.choice ?? entry?.answer ?? entry?.answer_text ?? ""
            );
      if (!text) return;
      tuples.push({ letter: letters[idx], text });
    });
  }

  if (tuples.length < 4) {
    return null;
  }

  tuples.splice(4);
  const normalized = tuples.map((item, idx) => ({
    letter: letters.includes(item.letter) ? item.letter : letters[idx],
    text: cleanValue(item.text).slice(0, 780)
  }));
  const labelSet = new Set(normalized.map((t) => t.letter));
  if (labelSet.size !== 4) {
    normalized.forEach((item, idx) => {
      item.letter = letters[idx];
    });
  }

  if (!answerLetter && Number.isFinite(Number(payload.correct_index))) {
    const idx = Math.floor(Number(payload.correct_index));
    if (idx >= 0 && idx <= 3) {
      answerLetter = letters[idx];
    }
  }

  if (!answerLetter) {
    return null;
  }
  const hasAnswer = normalized.some((item) => item.letter === answerLetter && item.text);
  if (!hasAnswer) {
    return null;
  }

  return {
    tuples: normalized,
    answerLetter
  };
}

function examPaperQuestionBankGradeMatchesRow(row, grade, form) {
  const value = cleanOptionalValue(row?.grade_or_form || "");
  if (!value) return true;
  if (grade && value === grade) return true;
  if (form && value === form) return true;
  return false;
}

function examPaperQuestionBankCoverageMatchesRow(row, selectedStrands, selectedSubStrands) {
  if (!Array.isArray(selectedStrands) || !selectedStrands.length) {
    return true;
  }
  const strandVal = cleanValue(row?.strand || "");
  if (!strandVal) {
    return true;
  }
  if (!selectedStrands.includes(strandVal)) {
    return false;
  }
  if (!Array.isArray(selectedSubStrands) || !selectedSubStrands.length) {
    return true;
  }
  const subVal = cleanValue(row?.sub_strand || "");
  if (!subVal) {
    return true;
  }
  return selectedSubStrands.includes(subVal);
}

function examPaperQuestionBankStatusAllowed(statusRaw) {
  const normalized = cleanValue(statusRaw || "DRAFT").toUpperCase();
  const blocked = new Set(["ARCHIVED", "VOID", "DISABLED"]);
  return !blocked.has(normalized);
}

function examPaperEmitBankMcqCandidate({
  bankRow,
  stemOverrideText,
  ref,
  learningArea,
  startNumber,
  oneMarkEach,
  indentOptions,
  kind,
  rng,
  onConsumed,
  snippet
}) {
  const normalized = normalizeQuestionBankMcqForExam(bankRow?.mcq_json);
  if (!normalized) return null;

  let stemSeed = "";
  if (stemOverrideText && String(stemOverrideText).trim().length > 12) {
    stemSeed = String(stemOverrideText).replace(/\s+/g, " ").trim();
  } else if (cleanValue(bankRow?.stem_text || "")) {
    stemSeed = String(bankRow.stem_text).replace(/\s+/g, " ").trim();
  } else if (snippet) {
    stemSeed = snippet.slice(0, 240);
  } else {
    stemSeed = `Using ${cleanValue(learningArea)} curriculum ideas, evaluate the prompts below carefully.`;
  }

  let stemCore = examPaperStripStrandNoise(stemSeed, ref || {}).trim();
  if (!stemCore || stemCore.length < 6) {
    return null;
  }
  void kind;

  const choices = normalized.tuples.map((item) => ({
    txt: item.text,
    ok: item.letter === normalized.answerLetter
  }));
  if (choices.filter((choice) => choice.ok).length !== 1) {
    return null;
  }

  const shuffled = examPaperShuffle(choices, rng).slice(0, 4);
  const letters = ["A", "B", "C", "D"];
  const labeled = shuffled.map((choice, idx) => ({ ...choice, L: letters[idx] }));

  const answer = labeled.find((choice) => choice.ok)?.L || "A";
  const lines = [];

  const markNote = oneMarkEach ? " (1 mark)" : "";
  if (oneMarkEach) {
    const stemParts = String(stemCore || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const opening = stemParts.length ? stemParts[0] : stemCore || "Select the most accurate option.";
    lines.push(`${startNumber}.${markNote} ${opening}`.trim());
    for (let pi = 1; pi < stemParts.length; pi += 1) {
      lines.push(`         ${stemParts[pi]}`);
    }
  } else {
    lines.push(`${startNumber}. ${stemCore}`);
  }

  const optPad = oneMarkEach ? "         " : indentOptions;
  labeled.forEach((option) => {
    lines.push(`${optPad}${option.L}. ${option.txt}`);
  });
  lines.push("");

  if (typeof onConsumed === "function") {
    try {
      onConsumed();
    } catch (_) {}
  }

  return { linesFragment: lines, answerKeyFragment: `${startNumber}:${answer}` };
}

function examPaperBuildMcqBlock({
  count,
  startNumber,
  referenceRows,
  learningArea,
  materialSnippets,
  seedKey,
  kind,
  oneMarkEach = false,
  indentOptions = "   ",
  stemOverrides,
  examBankConsume = null
}) {
  const refs =
    Array.isArray(referenceRows) && referenceRows.length
      ? referenceRows
      : [{ strand: learningArea, sub_strand: "", notes: "", specific_learning_outcomes: "" }];
  const snippets = Array.isArray(materialSnippets) ? materialSnippets.filter(Boolean) : [];
  const seed = examPaperHash32(`${seedKey}|mcq|${cleanValue(learningArea)}|${count}|${startNumber}`);
  const rng = examPaperMulberry32(seed);
  const lines = [];
  const keyLines = [];
  const consumeBankCandidate =
    examBankConsume && typeof examBankConsume.next === "function" ? examBankConsume.next.bind(examBankConsume) : null;
  const acknowledgeConsumed =
    examBankConsume && typeof examBankConsume.onConsumed === "function"
      ? examBankConsume.onConsumed.bind(examBankConsume)
      : () => {};
  let probeBudget = Math.max(count * 6, 30);
  for (let i = 0; i < count; i++) {
    const ref = refs[i % refs.length];
    const snip = snippets.length
      ? examPaperStripStrandNoise(String(snippets[i % snippets.length] || "").replace(/\s+/g, " "), ref).trim()
      : "";
    const stemOverrideSeed =
      Array.isArray(stemOverrides) && stemOverrides[i] && String(stemOverrides[i]).trim().length > 12
        ? String(stemOverrides[i]).trim()
        : "";

    let bankEmitted = false;
    while (!bankEmitted && consumeBankCandidate && probeBudget > 0) {
      probeBudget -= 1;
      const bankRowCandidate = consumeBankCandidate();
      if (!bankRowCandidate) {
        break;
      }
      const bankBundle = examPaperEmitBankMcqCandidate({
        bankRow: bankRowCandidate,
        stemOverrideText: stemOverrideSeed,
        ref,
        learningArea,
        startNumber: startNumber + i,
        oneMarkEach,
        indentOptions,
        kind,
        rng,
        onConsumed: acknowledgeConsumed,
        snippet: snip
      });
      if (bankBundle?.linesFragment?.length && bankBundle.answerKeyFragment) {
        lines.push(...bankBundle.linesFragment);
        keyLines.push(bankBundle.answerKeyFragment);
        bankEmitted = true;
        break;
      }
    }

    if (bankEmitted) {
      continue;
    }

    const stem =
      stemOverrideSeed && stemOverrideSeed.length > 12
        ? examPaperStripStrandNoise(stemOverrideSeed.replace(/\s+/g, " ").trim(), ref).trim()
        : examPaperStemFromRef(ref, snip, learningArea, startNumber + i, rng, kind);
    const correct = examPaperCorrectFromRef(ref, rng);
    const wrong = examPaperBuildDistractors({ kind, correctText: correct, rng });
    const options = examPaperShuffle(
      [{ txt: correct, ok: true }, ...wrong.map((txt) => ({ txt, ok: false }))],
      rng
    );
    const letters = ["A", "B", "C", "D"];
    const labeled = options.slice(0, 4).map((o, idx) => ({ ...o, L: letters[idx] }));
    const answer = labeled.find((x) => x.ok)?.L || "A";
    keyLines.push(`${startNumber + i}:${answer}`);
    const markNote = oneMarkEach ? " (1 mark)" : "";
    if (oneMarkEach) {
      const stemParts = String(stem || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const opening = stemParts.length ? stemParts[0] : "Select the most accurate option.";
      lines.push(`${startNumber + i}.${markNote} ${opening}`.trim());
      for (let pi = 1; pi < stemParts.length; pi += 1) {
        lines.push(`         ${stemParts[pi]}`);
      }
    } else {
      lines.push(`${startNumber + i}. ${stem}`);
    }
    const optPad = oneMarkEach ? "         " : indentOptions;
    labeled.forEach((o) => {
      lines.push(`${optPad}${o.L}. ${o.txt}`);
    });
    lines.push("");
  }
  return { lines, keyLines };
}

function examPaperDistributeMarks(total, parts, rng) {
  const n = Math.max(1, Number(parts) || 1);
  const t = Math.max(Number(total) || 0, 1);
  const base = Math.floor(t / n);
  let rem = t - base * n;
  const marks = Array(n).fill(base);
  let i = 0;
  while (rem > 0) {
    marks[i % n] += 1;
    rem -= 1;
    i += 1;
  }
  return examPaperShuffle(marks.map((m) => Math.max(1, m)), rng);
}

function examPaperStructuredSectionLines({ startNumber, totalMarks, questionCount, referenceRows, learningArea, seedKey }) {
  void referenceRows;
  const rng = examPaperMulberry32(examPaperHash32(`${seedKey}|struct|${totalMarks}|${questionCount}`));
  const marksEach = examPaperDistributeMarks(totalMarks, questionCount, rng);
  const verbs = ["Explain", "Outline", "Describe", "Analyze", "Evaluate", "Justify"];
  const lines = ["*Answer ALL questions in this section.*", ""];
  const area = cleanValue(learningArea);
  const promptBank = [
    (v, n, m) =>
      `${n}. ${v} how the lesson ideas can be demonstrated in your school or a nearby community. (${m} marks)`,
    (v, n, m) => `${n}. ${v} one practical hazard that could arise and safe ways to minimise it. (${m} marks)`,
    (v, n, m) =>
      `${n}. ${v} how responsible choices support better learning outcomes in everyday activities. (${m} marks)`,
    (v, n, m) => `${n}. ${v} a short plan learners could follow when solving a realistic problem tied to ${area}. (${m} marks)`
  ];
  for (let i = 0; i < questionCount; i++) {
    const v = verbs[Math.floor(rng() * verbs.length)];
    const m = marksEach[i] || 5;
    const n = startNumber + i;
    const pick = promptBank[Math.floor(rng() * promptBank.length)](v, n, m);
    lines.push(pick);
    lines.push("_______________________________________________________________________________________");
    lines.push("");
  }
  return lines;
}

const EXAM_CARDINAL_NAMES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen"
];

function examPaperCardinalLt100(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (n < EXAM_CARDINAL_NAMES.length) return EXAM_CARDINAL_NAMES[n];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    const tensWords =
      tens === 2
        ? "twenty"
        : tens === 3
          ? "thirty"
          : tens === 4
            ? "forty"
            : tens === 5
              ? "fifty"
              : tens === 6
                ? "sixty"
                : tens === 7
                  ? "seventy"
                  : tens === 8
                    ? "eighty"
                    : tens === 9
                      ? "ninety"
                      : EXAM_CARDINAL_NAMES[n];
    if (tens < 2 || tens > 9) return EXAM_CARDINAL_NAMES[n] || `${n}`;
    return ones ? `${tensWords}-${EXAM_CARDINAL_NAMES[ones]}` : tensWords;
  }
  return `${Math.min(n, 99)}`;
}

function examPaperSpelledHourMinuteChunk(count, singular, plural) {
  const n = Math.floor(Math.max(0, Number(count) || 0));
  if (!n) return "";
  const w = examPaperCardinalLt100(n);
  return `${w} ${n === 1 ? singular : plural}`;
}

/** Written-out duration (legacy / optional). */
function examPaperSpelledExamDuration(hours, minutes) {
  const h = Math.floor(Math.max(0, Math.min(8, Number(hours) || 0)));
  const m = Math.floor(Math.max(0, Math.min(59, Number(minutes) || 0)));
  const parts = [examPaperSpelledHourMinuteChunk(h, "hour", "hours"), examPaperSpelledHourMinuteChunk(m, "minute", "minutes")].filter(
    Boolean
  );
  if (!parts.length) return "Time allowed will be announced by the invigilator.";
  const sentence = parts.join(" and ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Compact duration for headers e.g. 1hr 45 Min */
function examPaperCompactDurationLabel(hours, minutes) {
  const h = Math.floor(Math.max(0, Math.min(24, Number(hours) || 0)));
  const m = Math.floor(Math.max(0, Math.min(59, Number(minutes) || 0)));
  const parts = [];
  if (h > 0) parts.push(`${h}hr`);
  if (m > 0) parts.push(`${m} Min`);
  if (!parts.length) return "—";
  return parts.join(" ");
}

function examPaperResolveDurationParts(body = {}) {
  const rawH = body.exam_duration_hours;
  const rawM = body.exam_duration_minutes;
  const hasH = rawH !== undefined && rawH !== null && String(rawH).trim() !== "";
  const hasM = rawM !== undefined && rawM !== null && String(rawM).trim() !== "";
  let h = 0;
  let m = 0;
  if (hasH || hasM) {
    h = hasH ? Math.floor(Math.max(0, Number(rawH) || 0)) : 0;
    m = hasM ? Math.floor(Math.max(0, Number(rawM) || 0)) : 0;
    if (!hasH && m > 59) {
      const tot = m;
      h = Math.floor(tot / 60);
      m = tot % 60;
    }
  } else {
    const totalFallback = Number(body.exam_duration_minutes_total);
    if (Number.isFinite(totalFallback) && totalFallback > 0) {
      h = Math.floor(totalFallback / 60);
      m = Math.floor(totalFallback % 60);
    } else {
      h = 1;
      m = 30;
    }
  }
  h = Math.min(8, Math.max(0, h));
  m = Math.min(59, Math.max(0, m));
  if (h === 0 && m === 0) {
    h = 1;
    m = 30;
  }
  const labelOverride = cleanOptionalValue(body.exam_duration_label || body.time_allowed_label);
  const label = labelOverride || examPaperCompactDurationLabel(h, m);
  return { hours: h, minutes: m, label };
}

function examPaperPaginateAfterHeader(headerLines, contentLines, linesPerPage = 52) {
  const header = Array.isArray(headerLines) ? headerLines : [];
  const content = Array.isArray(contentLines) ? contentLines : [];
  const per = Math.min(72, Math.max(26, Number(linesPerPage) || 52));
  while (content.length && !String(content[content.length - 1] || "").trim()) content.pop();
  const linesMain = content.length ? content : [""];
  const pageCount = Math.max(1, Math.ceil(linesMain.length / per));
  const published = [...header];
  for (let p = 0; p < pageCount; p += 1) {
    published.push("", "................................................................................");
    published.push(`Page ${p + 1} of ${pageCount}`);
    published.push("................................................................................");
    published.push("", ...linesMain.slice(p * per, (p + 1) * per));
  }
  published.push("", "END", "");
  return published;
}

function buildTeacherExamSupplementBlocks({ mcqKeys, templateSampleText }) {
  const lines = [
    "",
    "===== TEACHER / EXAMINER MATERIAL — DO NOT DISTRIBUTE TO LEARNERS =====",
    ""
  ];
  if (mcqKeys && mcqKeys.length) {
    lines.push("IMIS_MCQ_KEY", ...mcqKeys, "IMIS_MCQ_KEY_END", "");
  }
  if (cleanOptionalValue(templateSampleText)) {
    lines.push("ANNEX (OPTIONAL STRUCTURE TEMPLATE BASIS FOR TEACHERS)", cleanOptionalValue(templateSampleText), "");
  }
  lines.push("PRINT / LAYOUT FOOTER GUIDE:", "LEFT — learner details   CENTRE — page markers   RIGHT — subject / level", "");
  return lines.join("\n");
}

function buildCbcKenyaHeaderBlock({
  institutionName,
  letterheadHint,
  title,
  learningArea,
  levelLabel,
  stream,
  academicYear,
  term,
  examSession,
  examDurationLabel,
  structureLabel,
  sectionAllocationText
}) {
  const examTitleLine = cleanValue(title || "SCHOOL BASED ASSESSMENT");
  const area = cleanValue(learningArea || "");
  const titleCoversSubject = Boolean(area && examTitleLine.toLowerCase().includes(area.toLowerCase()));
  const timeCompact = cleanValue(examDurationLabel) || "1hr 30 Min";
  const lines = [
    "================================================================================",
    "THE KENYA JUNIOR SCHOOL EXAMINATION",
    `SCHOOL / INSTITUTION: ${institutionName || "_____________________________"}`,
    letterheadHint
      ? `BRANDING / LOGO FILE: ${letterheadHint}`
      : "BRANDING / LOGO: Upload letterhead in Institution settings (used for official papers and dashboard preview).",
    "",
    examTitleLine
  ];
  if (!titleCoversSubject && area) {
    lines.push(String(area).toUpperCase());
  }
  lines.push(
    `LEVEL / CLASS: ${levelLabel || "-"}     STREAM: ${stream || "N/A"}`,
    `TIME: ${timeCompact}`,
    `SESSION: ${examSession || "-"}     ACADEMIC YEAR: ${academicYear || "-"}     TERM: ${term || "-"}`,
    `STRUCTURE: ${structureLabel || "unified"}    ALLOCATION: ${sectionAllocationText || "-"}`,
    "",
    "+-----------------------------+-----------------------------+",
    "| LEARNER DETAILS             | FOR OFFICIAL USE ONLY       |",
    "| NAME: _____________________ | SECTION A MARKS: __________ |",
    "| Assessment / UPI No: ______ | SECTION B MARKS: __________ |",
    "| DATE: _____________________ | TOTAL: ____________________ |",
    "| LEARNER SIGNATURE: _________ | PERCENTAGE: _______________ |",
    "|                             | EXAMINER NAME: ____________ |",
    "|                             | EXAMINER SIGNATURE: ________ |",
    "+-----------------------------+-----------------------------+",
    "",
    "INSTRUCTIONS",
    "1) Follow all directions on this paper.",
    "2) Section A: one letter (A–D) per question unless otherwise stated.",
    "3) Section B: write clearly; show working where needed.",
    "4) Mobile phones and unauthorised materials are not allowed.",
    ""
  );
  return lines;
}

function buildAdvancedExamText({
  title,
  institutionName,
  letterheadHint,
  learningArea,
  levelLabel,
  stream,
  term,
  academicYear,
  examSession,
  examDurationLabel,
  seedKey,
  structure,
  structureDetail,
  percentageText,
  sectionAllocationText,
  outputMode,
  templateSampleText,
  referenceRows,
  supplementalMaterialNotes,
  materialSnippets,
  socialStudiesSectionBMarks,
  socialStudiesSectionBQuestions,
  aiStemOverrides,
  examBankConsume = null
}) {
  const kind = examPaperSubjectKind(learningArea);
  const refsRaw = Array.isArray(referenceRows) ? referenceRows : [];
  const orderRng = examPaperMulberry32(examPaperHash32(`${seedKey}|ref-order`));
  const refs = refsRaw.length ? examPaperShuffle(refsRaw.slice(), orderRng) : [];
  const snippets = Array.isArray(materialSnippets) ? materialSnippets : [];
  const stemOv = Array.isArray(aiStemOverrides) ? aiStemOverrides : [];
  if (supplementalMaterialNotes) {
    supplementalMaterialNotes
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 40)
      .slice(0, 6)
      .forEach((line) => snippets.push(line));
  }
  const structureLabel = `${structure || "unified"}${structureDetail ? ` (${structureDetail})` : ""}`;
  const unifiedTotal = Math.min(100, Math.max(10, Number(percentageText) || 100));

  let resolvedHeaderAllocation = sectionAllocationText;
  let socialPaperLayout = null;
  if (kind === "social") {
    const sectionAMarksFixed = 20;
    let sectionBMarks = Math.max(unifiedTotal - sectionAMarksFixed, 20);
    const custB = Number(socialStudiesSectionBMarks);
    if (Number.isFinite(custB) && custB >= 10) {
      sectionBMarks = Math.min(100, Math.round(custB));
    }
    let bQuestionCount = Math.min(16, Math.max(3, Math.round(sectionBMarks / 8)));
    const custQ = Number(socialStudiesSectionBQuestions);
    if (Number.isFinite(custQ) && custQ >= 3) {
      bQuestionCount = Math.min(20, Math.round(custQ));
    }
    socialPaperLayout = { sectionAMarksFixed, sectionBMarks, bQuestionCount };
    resolvedHeaderAllocation = `A: ${sectionAMarksFixed} | B: ${sectionBMarks} | TOTAL: ${sectionAMarksFixed + sectionBMarks}`;
  }

  const header = buildCbcKenyaHeaderBlock({
    institutionName,
    letterheadHint,
    title,
    learningArea,
    levelLabel,
    stream,
    academicYear,
    term,
    examSession,
    examDurationLabel,
    structureLabel,
    sectionAllocationText: resolvedHeaderAllocation
  });
  const body = [];
  const mcqKeys = [];
  let qCursor = 1;

  if (kind === "social") {
    const sectionAMarks = socialPaperLayout.sectionAMarksFixed;
    const sectionBMarks = socialPaperLayout.sectionBMarks;
    const bCount = socialPaperLayout.bQuestionCount;
    const mcq = examPaperBuildMcqBlock({
      count: 20,
      startNumber: qCursor,
      referenceRows: refs,
      learningArea,
      materialSnippets: snippets,
      seedKey: `${seedKey}|SOC`,
      kind: "social",
      oneMarkEach: true,
      indentOptions: "         ",
      stemOverrides: stemOv,
      examBankConsume
    });
    body.push(`SECTION A (${sectionAMarks} MARKS)`, "*Answer all questions in this section.*", "");
    body.push(...mcq.lines);
    mcqKeys.push(...mcq.keyLines);
    qCursor += 20;
    body.push(`SECTION B (${sectionBMarks} MARKS)`, "");
    body.push(
      ...examPaperStructuredSectionLines({
        startNumber: qCursor,
        totalMarks: sectionBMarks,
        questionCount: bCount,
        referenceRows: refs,
        learningArea,
        seedKey: `${seedKey}|SOC-B`
      })
    );
    qCursor += bCount;
    body.push("", `TOTAL MARKS FOR THIS PAPER: ${sectionAMarks + sectionBMarks}`);
  } else if (kind === "pretechnical") {
    const totalPaper = 80;
    const sectionAMarks = 20;
    const sectionBMarks = 60;
    const mcq = examPaperBuildMcqBlock({
      count: 30,
      startNumber: qCursor,
      referenceRows: refs,
      learningArea,
      materialSnippets: snippets,
      seedKey: `${seedKey}|PT`,
      kind: "pretechnical",
      stemOverrides: stemOv,
      examBankConsume
    });
    body.push(`SECTION A (${sectionAMarks} MARKS AMONG ${30} ITEMS)`, "*Answer ALL questions in this section.*", "");
    body.push("(Each item carries equal weight within Section A; total Section A = 20 marks.)", "");
    body.push(...mcq.lines);
    mcqKeys.push(...mcq.keyLines);
    qCursor += 30;
    const bCount = 12;
    body.push(`SECTION B (${sectionBMarks} MARKS)`, "");
    body.push(
      ...examPaperStructuredSectionLines({
        startNumber: qCursor,
        totalMarks: sectionBMarks,
        questionCount: bCount,
        referenceRows: refs,
        learningArea,
        seedKey: `${seedKey}|PT-B`
      })
    );
    qCursor += bCount;
    body.push(`TOTAL MARKS FOR THIS PAPER: ${totalPaper}`);
  } else if (String(structure || "unified") === "structured") {
    const detail = cleanValue(structureDetail);
    const parts =
      detail === "A_B_C" ? ["SECTION A", "SECTION B", "SECTION C"] : ["SECTION A", "SECTION B"];
    const numbers = String(sectionAllocationText || "").match(/\d+/g);
    const aMarks = numbers && numbers[0] ? Number(numbers[0]) : 40;
    const bMarks = numbers && numbers[1] ? Number(numbers[1]) : 35;
    const cMarks = numbers && numbers[2] ? Number(numbers[2]) : 25;
    const mcqCountA = Math.min(20, Math.max(8, Math.round(aMarks / 2)));
    const mcqA = examPaperBuildMcqBlock({
      count: mcqCountA,
      startNumber: qCursor,
      referenceRows: refs,
      learningArea,
      materialSnippets: snippets,
      seedKey: `${seedKey}|ST-A`,
      kind: "general",
      stemOverrides: stemOv,
      examBankConsume
    });
    body.push(`${parts[0]} (${aMarks} MARKS) [OBJECTIVE]`, "", ...mcqA.lines);
    mcqKeys.push(...mcqA.keyLines);
    qCursor += mcqA.keyLines.length;
    const bQ = Math.min(10, Math.max(3, Math.round(bMarks / 10)));
    body.push("", `${parts[1]} (${bMarks} MARKS) [STRUCTURED]`, "");
    body.push(
      ...examPaperStructuredSectionLines({
        startNumber: qCursor,
        totalMarks: bMarks,
        questionCount: bQ,
        referenceRows: refs,
        learningArea,
        seedKey: `${seedKey}|ST-B`
      })
    );
    qCursor += bQ;
    if (parts[2]) {
      const mcqCountC = Math.min(15, Math.max(6, Math.round(cMarks / 2)));
      body.push("", `${parts[2]} (${cMarks} MARKS) [APPLICATION]`, "");
      const mcqC = examPaperBuildMcqBlock({
        count: mcqCountC,
        startNumber: qCursor,
        referenceRows: refs,
        learningArea,
        materialSnippets: snippets,
        seedKey: `${seedKey}|ST-C`,
        kind: "general",
        stemOverrides: stemOv,
        examBankConsume
      });
      body.push(...mcqC.lines);
      mcqKeys.push(...mcqC.keyLines);
      qCursor += mcqC.keyLines.length;
    }
  } else if (String(structure || "unified") === "multi-section") {
    const detail = cleanValue(structureDetail);
    const numbers = String(sectionAllocationText || "").match(/\d+/g);
    const p1 = numbers && numbers[0] ? Number(numbers[0]) : 40;
    const p2 = numbers && numbers[1] ? Number(numbers[1]) : 35;
    const p3 = detail === "PAPER_1_2_3" && numbers && numbers[2] ? Number(numbers[2]) : 0;
    const p1q = Math.min(8, Math.max(3, Math.round(p1 / 12)));
    body.push(`PAPER 1 (${p1} MARKS) [STRUCTURED]`, "");
    body.push(
      ...examPaperStructuredSectionLines({
        startNumber: qCursor,
        totalMarks: p1,
        questionCount: p1q,
        referenceRows: refs,
        learningArea,
        seedKey: `${seedKey}|MS-1`
      })
    );
    qCursor += p1q;
    const mcq2 = examPaperBuildMcqBlock({
      count: Math.min(20, Math.max(8, Math.round(p2 / 2))),
      startNumber: qCursor,
      referenceRows: refs,
      learningArea,
      materialSnippets: snippets,
      seedKey: `${seedKey}|MS-2`,
      kind: "general",
      stemOverrides: stemOv,
      examBankConsume
    });
    body.push("", `PAPER 2 (${p2} MARKS) [OBJECTIVE]`, "", ...mcq2.lines);
    mcqKeys.push(...mcq2.keyLines);
    qCursor += mcq2.keyLines.length;
    if (detail === "PAPER_1_2_3" && p3 > 0) {
      const p3q = Math.min(10, Math.max(2, Math.round(p3 / 10)));
      body.push("", `PAPER 3 (${p3} MARKS) [STRUCTURED]`, "");
      body.push(
        ...examPaperStructuredSectionLines({
          startNumber: qCursor,
          totalMarks: p3,
          questionCount: p3q,
          referenceRows: refs,
          learningArea,
          seedKey: `${seedKey}|MS-3`
        })
      );
      qCursor += p3q;
    }
  } else {
    const sectionAObjectiveMarks = Math.min(40, Math.max(10, Math.round(unifiedTotal * 0.35)));
    const sectionBMarks = Math.max(5, unifiedTotal - sectionAObjectiveMarks);
    const mcqCount = Math.min(25, Math.max(10, sectionAObjectiveMarks));
    const mcq = examPaperBuildMcqBlock({
      count: mcqCount,
      startNumber: qCursor,
      referenceRows: refs,
      learningArea,
      materialSnippets: snippets,
      seedKey: `${seedKey}|UN`,
      kind: "general",
      stemOverrides: stemOv,
      examBankConsume
    });
    body.push(`SECTION A (${sectionAObjectiveMarks} MARKS) [OBJECTIVE]`, "", ...mcq.lines);
    mcqKeys.push(...mcq.keyLines);
    qCursor += mcq.keyLines.length;
    const bQ = Math.min(10, Math.max(3, Math.round(sectionBMarks / 10)));
    body.push("", `SECTION B (${sectionBMarks} MARKS) [STRUCTURED]`, "");
    body.push(
      ...examPaperStructuredSectionLines({
        startNumber: qCursor,
        totalMarks: sectionBMarks,
        questionCount: bQ,
        referenceRows: refs,
        learningArea,
        seedKey: `${seedKey}|UN-B`
      })
    );
    qCursor += bQ;
    body.push("", `TOTAL TARGET MARKS (UNIFIED MODE): ${unifiedTotal}`);
  }

  const learnerContentLines = ["EXAM CONTENT", "", ...body];
  const learnerLines = examPaperPaginateAfterHeader(header, learnerContentLines);
  const learnerText = learnerLines.join("\n");
  const teacherSupplement = buildTeacherExamSupplementBlocks({
    mcqKeys,
    templateSampleText
  });
  const mcqAnswerKey = mcqKeys.length ? ["IMIS_MCQ_KEY", ...mcqKeys, "IMIS_MCQ_KEY_END"].join("\n") : "";
  return { learnerText, teacherSupplement, mcqAnswerKey };
}

const QUESTION_BANK_ROLES = [
  ROLES.SUPER_SYSTEM_DEVELOPER,
  ROLES.SYSTEM_DEVELOPER,
  ROLES.ADMIN,
  ROLES.HEAD_OF_INSTITUTION,
  ROLES.SYSTEM_ADMINISTRATOR,
  ROLES.TEACHER,
  ROLES.SENIOR_TEACHER,
  ROLES.HEAD_OF_DEPARTMENT
];

app.get(
  "/api/academic/question-bank",
  auth,
  enforceAnyModuleAccess([MODULE_KEYS.ACADEMIC_EXAMS, MODULE_KEYS.CBC_CURRICULUM_EDITOR]),
  enforceRole(QUESTION_BANK_ROLES),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = resolveTenantInstitutionId(req);
    if (!institutionId) {
      return res.status(403).json({ error: "No institution scope attached to this account." });
    }
    const gradeOrForm = cleanOptionalValue(req.query.grade_or_form || req.query.grade || req.query.form);
    const learningArea = cleanOptionalValue(req.query.learning_area || req.query.subject);
    const questionType = cleanOptionalValue(req.query.question_type)?.toUpperCase();
    const statusFilter = cleanOptionalValue(req.query.status)?.toUpperCase();
    let limit = Number(req.query.limit || 120);
    if (!Number.isFinite(limit) || limit < 1) limit = 120;
    limit = Math.min(400, limit);
    let offset = Number(req.query.offset || 0);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    let sql = `SELECT id, institution_id, grade_or_form, learning_area, strand, sub_strand, slo_reference,
         competency_tag, bloom_level, difficulty, question_type, stem_text, mcq_json, status, source,
         reviewed_at, reviewed_by_user_id, created_at, updated_at
       FROM exam_question_bank
       WHERE institution_id = ? AND deleted_at IS NULL`;
    const params = [institutionId];
    if (gradeOrForm) {
      sql += ` AND grade_or_form = ?`;
      params.push(gradeOrForm);
    }
    if (learningArea) {
      sql += ` AND learning_area = ?`;
      params.push(cleanValue(learningArea));
    }
    if (questionType) {
      sql += ` AND UPPER(question_type) = ?`;
      params.push(questionType.slice(0, 40));
    }
    if (statusFilter) {
      sql += ` AND UPPER(status) = ?`;
      params.push(statusFilter.slice(0, 40));
    }
    sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    const rows = await query(sql, params);
    res.json({ items: rows });
  })
);

app.post(
  "/api/academic/question-bank",
  auth,
  enforceAnyModuleAccess([MODULE_KEYS.ACADEMIC_EXAMS, MODULE_KEYS.CBC_CURRICULUM_EDITOR]),
  enforceRole(QUESTION_BANK_ROLES),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const institutionId = resolveTenantInstitutionId(req);
    if (!institutionId) {
      return res.status(403).json({ error: "No institution scope attached to this account." });
    }
    const exists = await query("SELECT id FROM institutions WHERE id = ? LIMIT 1", [institutionId]);
    if (!exists.length) {
      return res.status(404).json({ error: "Institution not found for this scope." });
    }
    const learningArea = cleanValue(req.body?.learning_area || req.body?.subject || "");
    const stemRaw = req.body?.stem_text ?? req.body?.stem ?? "";
    const stem =
      typeof stemRaw === "string"
        ? stemRaw.slice(0, 62000).trim()
        : String(stemRaw || "").slice(0, 62000).trim();
    if (!learningArea || !stem) {
      return res.status(400).json({ error: "learning_area and stem_text are required." });
    }
    const questionTypeUpper = cleanValue(req.body?.question_type || "STRUCTURED").toUpperCase().slice(0, 40) || "STRUCTURED";
    const gradeOrForm = cleanOptionalValue(req.body?.grade_or_form || req.body?.grade || req.body?.form_name);
    const strand = cleanOptionalValue(req.body?.strand);
    const subStrand = cleanOptionalValue(req.body?.sub_strand);
    const sloRef = cleanOptionalValue(req.body?.slo_reference);
    const competencyTag = cleanOptionalValue(req.body?.competency_tag);
    const bloomLevel = cleanOptionalValue(req.body?.bloom_level);
    const difficulty = cleanOptionalValue(req.body?.difficulty);
    const statusUpper = cleanValue(req.body?.status || "DRAFT").toUpperCase().slice(0, 40) || "DRAFT";
    const sourceUpper = cleanValue(req.body?.source || "MANUAL").toUpperCase().slice(0, 40) || "MANUAL";

    let mcqJsonPayload = req.body?.mcq_json ?? null;
    if (mcqJsonPayload === null && typeof req.body?.mcq_payload === "object") {
      mcqJsonPayload = req.body?.mcq_payload;
    }
    if (questionTypeUpper === "MCQ" && !mcqJsonPayload) {
      return res.status(400).json({ error: "mcq_json (or mcq_payload) is required for MCQ rows." });
    }
    let mcqJsonSerialized = null;
    if (mcqJsonPayload !== null && mcqJsonPayload !== undefined && mcqJsonPayload !== "") {
      try {
        const parsed =
          typeof mcqJsonPayload === "string" ? JSON.parse(mcqJsonPayload) : mcqJsonPayload;
        mcqJsonSerialized = JSON.stringify(parsed);
      } catch (_) {
        return res.status(400).json({ error: "mcq_json must be valid JSON." });
      }
    }

    const result = await query(
      `INSERT INTO exam_question_bank
        (institution_id, grade_or_form, learning_area, strand, sub_strand, slo_reference,
         competency_tag, bloom_level, difficulty, question_type, stem_text, mcq_json, status, source,
         created_by_user_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        institutionId,
        gradeOrForm || null,
        learningArea,
        strand || null,
        subStrand || null,
        sloRef || null,
        competencyTag || null,
        bloomLevel || null,
        difficulty || null,
        questionTypeUpper,
        stem,
        mcqJsonSerialized,
        statusUpper,
        sourceUpper,
        String(Number(req.user.id || 0) || "") || null
      ]
    );
    const insertId = result.insertId;
    await auditLog(req.user, "EXAM_QUESTION_BANK_CREATE", "exam_question_bank", insertId, {
      institution_id: institutionId,
      learning_area: learningArea,
      question_type: questionTypeUpper
    });
    res.status(201).json({
      message: "Question bank item captured.",
      id: insertId
    });
  })
);

app.post(
  "/api/academic/exams/auto-generate",
  auth,
  enforceAnyModuleAccess([MODULE_KEYS.ACADEMIC_EXAMS, MODULE_KEYS.CBC_CURRICULUM_EDITOR]),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const selectedGrade = cleanOptionalValue(body.grade);
    const selectedForm = cleanOptionalValue(body.form_name);
    const selectedLearningArea = cleanValue(body.learning_area || body.subject || "");
    const selectedTerm = cleanOptionalValue(body.term);
    const selectedYear = Number(body.year || 0) || new Date().getFullYear();
    const selectedSession = cleanOptionalValue(body.exam_type);
    const selectedStream = cleanOptionalValue(body.stream) || "N/A";
    const selectedStructureRaw = cleanValue(body.structure || "unified").toLowerCase();
    const selectedStructure = ["structured", "multi-section"].includes(selectedStructureRaw)
      ? selectedStructureRaw
      : "unified";
    const selectedStructureDetail = selectedStructure !== "unified"
      ? cleanOptionalValue(body.structure_detail)
      : null;
    const selectedOutputMode = cleanValue(body.output_mode || "per_learner").toLowerCase();
    const selectedAllocationMode = cleanValue(body.allocation_mode || "manual").toLowerCase();
    const MAX_SELECTION_ITEMS = 120;
    const MAX_SELECTION_ITEM_LENGTH = 180;
    const normalizeStringArray = (value) => {
      if (Array.isArray(value)) {
        return Array.from(
          new Set(
            value
              .map((item) => cleanValue(item).slice(0, MAX_SELECTION_ITEM_LENGTH))
              .filter(Boolean)
              .slice(0, MAX_SELECTION_ITEMS)
          )
        );
      }
      if (typeof value === "string") {
        return Array.from(
          new Set(
            value
              .split(",")
              .map((item) => cleanValue(item).slice(0, MAX_SELECTION_ITEM_LENGTH))
              .filter(Boolean)
              .slice(0, MAX_SELECTION_ITEMS)
          )
        );
      }
      return [];
    };
    const selectedStrands = normalizeStringArray(body.selected_strands || body.strand);
    const selectedSubStrands = normalizeStringArray(body.selected_sub_strands || body.sub_strand);
    if ((!selectedGrade && !selectedForm) || !selectedLearningArea || !selectedSession) {
      return res.status(400).json({
        error: "exam_type, grade/form_name and learning_area are required for AI exam generation."
      });
    }
    if (!selectedStrands.length || !selectedSubStrands.length) {
      return res.status(400).json({
        error: "Select at least one strand and one sub-strand. Generation is restricted to selected coverage only."
      });
    }
    if (selectedStrands.length > MAX_SELECTION_ITEMS || selectedSubStrands.length > MAX_SELECTION_ITEMS) {
      return res.status(400).json({ error: "Selection is too large. Reduce selected strands/sub-strands and retry." });
    }
    const levelCriteria = resolveLevelSelectionCriteria({ grade: selectedGrade, formName: selectedForm });
    if (levelCriteria.track === "unknown") {
      return res.status(400).json({ error: "Selected level is invalid or unsupported for exam generation." });
    }
    const parseMark = (value, fallback = 0) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(0, Math.round(parsed));
    };
    let sectionAllocationText = "";
    let percentageText = "";
    if (selectedStructure === "unified") {
      let totalMarks = 100;
      if (selectedAllocationMode === "automated") {
        const automated = parseMark(body.automated_percentage || body.total_percentage || 100, 100);
        const allowed = new Set([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
        if (!allowed.has(automated)) {
          return res.status(400).json({ error: "Automated percentage must be one of 100,90,80,70,60,50,40,30,20,10." });
        }
        totalMarks = automated;
      } else {
        totalMarks = parseMark(body.manual_percentage || body.total_percentage || body.percentage_allocation || 100, 100);
      }
      if (totalMarks < 10 || totalMarks > 100) {
        return res.status(400).json({ error: "Unified structure total percentage/marks must be between 10 and 100." });
      }
      percentageText = String(totalMarks);
      sectionAllocationText = `UNIFIED TOTAL: ${totalMarks}`;
    } else {
      const normalizedDetail = cleanValue(selectedStructureDetail);
      const validDetails = selectedStructure === "structured"
        ? ["A_B", "A_B_C"]
        : ["PAPER_1_2", "PAPER_1_2_3"];
      if (!validDetails.includes(normalizedDetail)) {
        return res.status(400).json({
          error: selectedStructure === "structured"
            ? "Structured exams require structure_detail as A_B or A_B_C."
            : "Multi-section exams require structure_detail as PAPER_1_2 or PAPER_1_2_3."
        });
      }
      const sectionAlloc = body.section_allocations && typeof body.section_allocations === "object"
        ? body.section_allocations
        : {};
      const aMarks = parseMark(sectionAlloc.A ?? body.section_a_marks, 0);
      const bMarks = parseMark(sectionAlloc.B ?? body.section_b_marks, 0);
      const cMarks = ["A_B_C", "PAPER_1_2_3"].includes(normalizedDetail)
        ? parseMark(sectionAlloc.C ?? body.section_c_marks, 0)
        : 0;
      if (aMarks <= 0 || bMarks <= 0 || (["A_B_C", "PAPER_1_2_3"].includes(normalizedDetail) && cMarks <= 0)) {
        return res.status(400).json({ error: "Structured section marks must be greater than zero for required sections." });
      }
      const total = aMarks + bMarks + cMarks;
      if (total > 100) {
        return res.status(400).json({ error: "Structured section marks total cannot exceed 100." });
      }
      percentageText = String(total);
      if (selectedStructure === "multi-section") {
        sectionAllocationText = normalizedDetail === "PAPER_1_2_3"
          ? `Paper 1:${aMarks}, Paper 2:${bMarks}, Paper 3:${cMarks} (Total ${total})`
          : `Paper 1:${aMarks}, Paper 2:${bMarks} (Total ${total})`;
      } else {
        sectionAllocationText = normalizedDetail === "A_B_C"
          ? `A:${aMarks}, B:${bMarks}, C:${cMarks} (Total ${total})`
          : `A:${aMarks}, B:${bMarks} (Total ${total})`;
      }
    }

    const curriculumRowsRaw = await query(
      `SELECT id, grade, form_name, learning_area, strand, sub_strand,
              specific_learning_outcomes, learning_experiences, notes
       FROM cbc_curriculum_entries
       WHERE institution_id = ?
         AND learning_area = ?
       ORDER BY id ASC
       LIMIT 4000`,
      [req.user.institution_id, selectedLearningArea]
    );
    const scopedCurriculumRows = curriculumRowsRaw.filter((row) =>
      rowWithinSelectedLevelRange({ row, criteria: levelCriteria })
      && rowWithinExamCoverage({
        row,
        selectedStrands,
        selectedSubStrands
      })
    );

    let referenceRows = scopedCurriculumRows;
    if (!referenceRows.length) {
      const mappingRows = await query(
        `SELECT learning_area, strand, sub_strand, notes, grade, form_name
         FROM cbc_structure_mappings
         WHERE institution_id = ?
           AND learning_area = ?
         ORDER BY id ASC
         LIMIT 3000`,
        [req.user.institution_id, selectedLearningArea]
      );
      referenceRows = mappingRows
        .filter((row) =>
          rowWithinSelectedLevelRange({ row, criteria: levelCriteria })
          && rowWithinExamCoverage({
            row,
            selectedStrands,
            selectedSubStrands
          })
        )
        .map((row) => ({
          ...row,
          specific_learning_outcomes: "",
          learning_experiences: ""
        }));
    }
    if (!referenceRows.length) {
      return res.status(400).json({
        error:
          "No curriculum coverage for the chosen level, learning area, strands and sub-strands. Add curriculum rows or adjust your selection."
      });
    }

    const materialRows = await query(
      `SELECT resource_type, title, description, strand, sub_strand, grade, stream, term
       FROM teacher_resources
       WHERE institution_id = ?
         AND (grade = ? OR ? = '' OR grade IS NULL OR grade = '')
         AND (term = ? OR ? = '' OR term IS NULL OR term = '')
       ORDER BY id DESC
       LIMIT 160`,
      [req.user.institution_id, selectedGrade || selectedForm || "", selectedGrade || selectedForm || "", selectedTerm || "", selectedTerm || ""]
    );
    const filteredMaterialRows = materialRows.filter((row) => {
      const areaText = `${cleanValue(row.title)} ${cleanValue(row.description)}`.toLowerCase();
      if (selectedLearningArea && areaText && !areaText.includes(selectedLearningArea.toLowerCase())) return false;
      if (selectedStrands.length && cleanValue(row.strand) && !selectedStrands.includes(cleanValue(row.strand))) return false;
      if (selectedSubStrands.length && cleanValue(row.sub_strand) && !selectedSubStrands.includes(cleanValue(row.sub_strand))) return false;
      return true;
    });
    const supplementalMaterialNotes = filteredMaterialRows
      .slice(0, 12)
      .map((row) => [cleanValue(row.resource_type), cleanValue(row.title), cleanOptionalValue(row.description)].filter(Boolean).join(": "))
      .filter(Boolean)
      .join("\n");
    const materialSnippets = filteredMaterialRows
      .flatMap((row) => {
        const line = [cleanValue(row.title), cleanOptionalValue(row.description)].filter(Boolean).join(" — ");
        return line.length > 40 ? [line.replace(/\s+/g, " ").trim().slice(0, 2200)] : [];
      })
      .slice(0, 20);

    const primaryStrand = selectedStrands[0] || "";
    const primarySubStrand = selectedSubStrands[0] || "";
    const toTemplateToken = (value = "") =>
      cleanValue(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const structureToken = toTemplateToken(selectedStructure) || "unified";
    const detailToken = selectedStructure !== "unified"
      ? (toTemplateToken(selectedStructureDetail || "default") || "default")
      : "default";
    const levelToken = toTemplateToken(selectedGrade || selectedForm || "general") || "general";
    const areaToken = toTemplateToken(selectedLearningArea || "general") || "general";
    const candidateTemplateKeys = Array.from(new Set([
      `exam-structure-${structureToken}-${detailToken}-${levelToken}-${areaToken}`,
      `exam-structure-${structureToken}-${detailToken}-${areaToken}`,
      `exam-structure-${structureToken}-${detailToken}-${levelToken}`,
      `exam-structure-${structureToken}-${detailToken}`
    ]));
    const placeholders = candidateTemplateKeys.map(() => "?").join(", ");
    const templateRows = candidateTemplateKeys.length
      ? await query(
        `SELECT template_key, content
         FROM exam_templates
         WHERE institution_id = ?
           AND template_key IN (${placeholders})
           AND is_active = 1
         ORDER BY updated_at DESC`,
        [req.user.institution_id, ...candidateTemplateKeys]
      )
      : [];
    const templatesByKey = new Map((Array.isArray(templateRows) ? templateRows : []).map((row) => [cleanValue(row.template_key), row.content]));
    const matchedTemplateKey = candidateTemplateKeys.find((key) => templatesByKey.has(key)) || "";
    const templateSampleText = cleanOptionalValue(templatesByKey.get(matchedTemplateKey) || "") || "";
    const instRows = await query(
      `SELECT institution_name, letterhead_file_path
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [req.user.institution_id]
    ).catch(() => []);
    const institutionName = cleanValue(instRows[0]?.institution_name || "");
    const letterheadHint = cleanOptionalValue(instRows[0]?.letterhead_file_path || "");
    const { hours: resolvedDurH, minutes: resolvedDurM, label: examDurationLabel } = examPaperResolveDurationParts(body);
    const seedEntropy = `${Date.now()}|${crypto.randomBytes(10).toString("hex")}|${uuidv4()}`;
    const seedKey = `${req.user.institution_id}|${selectedLearningArea}|${selectedSession}|${selectedYear}|${seedEntropy}`;
    let examBankConsume = null;
    let questionBankMcqPoolLoaded = 0;
    const examBankDisableMcqIntegration = ["1", "true", "yes", "on"].includes(
      String(process.env.EXAM_DISABLE_QUESTION_BANK_MCQ || "").trim().toLowerCase()
    );
    if (!examBankDisableMcqIntegration && req.user.institution_id) {
      try {
        const qbRowsAll = await query(
          `SELECT id, stem_text, mcq_json, strand, sub_strand, grade_or_form, status
           FROM exam_question_bank
           WHERE institution_id = ?
             AND learning_area = ?
             AND deleted_at IS NULL
             AND UPPER(IFNULL(question_type, '')) = 'MCQ'
             AND mcq_json IS NOT NULL
           ORDER BY updated_at DESC, id DESC
           LIMIT 900`,
          [req.user.institution_id, selectedLearningArea]
        );
        const qbCandidates = (Array.isArray(qbRowsAll) ? qbRowsAll : []).filter((row) => {
          if (!examPaperQuestionBankStatusAllowed(row?.status)) {
            return false;
          }
          if (!examPaperQuestionBankGradeMatchesRow(row, selectedGrade, selectedForm)) {
            return false;
          }
          if (!examPaperQuestionBankCoverageMatchesRow(row, selectedStrands, selectedSubStrands)) {
            return false;
          }
          if (!normalizeQuestionBankMcqForExam(row.mcq_json)) {
            return false;
          }
          const stemProbe = String(row.stem_text || "")
            .replace(/\s+/g, " ")
            .trim();
          return stemProbe.length >= 6;
        });
        questionBankMcqPoolLoaded = qbCandidates.length;
        if (questionBankMcqPoolLoaded) {
          const queue = examPaperShuffle(
            qbCandidates,
            examPaperMulberry32(examPaperHash32(`${seedKey}|exam-qbank-order`))
          );
          examBankConsume = {
            queue,
            consumed: 0,
            next() {
              return this.queue.length ? this.queue.shift() : null;
            },
            onConsumed() {
              this.consumed += 1;
            }
          };
        }
      } catch (_) {
        examBankConsume = null;
        questionBankMcqPoolLoaded = 0;
      }
    }
    let aiStemOverrides = [];
    if (String(process.env.OPENAI_API_KEY || "").trim()) {
      try {
        aiStemOverrides = await generateExamStemsWithOpenAi({
          institutionId: req.user.institution_id,
          learningArea: selectedLearningArea,
          gradeOrForm: selectedGrade || selectedForm || "",
          referenceRows,
          maxStems: 42
        });
      } catch (aiErr) {
        // eslint-disable-next-line no-console
        console.warn("[exam-ai] OpenAI stem pass skipped:", aiErr?.message || aiErr);
      }
    }
    const rawSocial = body.social_studies && typeof body.social_studies === "object" ? body.social_studies : {};
    const socialBM = Number(rawSocial.section_b_marks);
    const socialBQ = Number(rawSocial.section_b_questions);
    const examBundle = buildAdvancedExamText({
      title: cleanOptionalValue(body.title) || `${selectedSession || "Exam"} - ${selectedLearningArea}`,
      institutionName,
      letterheadHint,
      learningArea: selectedLearningArea,
      levelLabel: selectedGrade || selectedForm,
      stream: selectedStream,
      term: selectedTerm,
      academicYear: cleanOptionalValue(body.academic_year) || `${selectedYear}/${selectedYear + 1}`,
      examSession: selectedSession || "Exam",
      examDurationLabel,
      seedKey,
      structure: selectedStructure,
      structureDetail: cleanOptionalValue(selectedStructureDetail),
      percentageText,
      sectionAllocationText,
      outputMode: selectedOutputMode,
      templateSampleText,
      referenceRows,
      supplementalMaterialNotes,
      materialSnippets,
      socialStudiesSectionBMarks: Number.isFinite(socialBM) && socialBM >= 10 ? socialBM : null,
      socialStudiesSectionBQuestions: Number.isFinite(socialBQ) && socialBQ >= 3 ? socialBQ : null,
      aiStemOverrides,
      examBankConsume
    });
    const learnerExamText = examBundle.learnerText;
    const teacherExamSupplement = examBundle.teacherSupplement || "";

    const result = await query(
      `INSERT INTO academic_exams
        (institution_id, title, grade, stream, subject, strand, sub_strand, notes_file_path, generated_exam_text, teacher_exam_supplement, term, year, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.institution_id,
        cleanOptionalValue(body.title) || `${selectedSession || "Auto Generated Exam"} - ${selectedLearningArea}`,
        selectedGrade || selectedForm || null,
        selectedStream || null,
        selectedLearningArea || null,
        primaryStrand || null,
        primarySubStrand || null,
        cleanOptionalValue(body.notes_file_path) || null,
        learnerExamText,
        teacherExamSupplement || null,
        selectedTerm || null,
        selectedYear || null,
        req.user.id
      ]
    );

    await auditLog(req.user, "AUTO_GENERATE_EXAM", "academic_exams", result.insertId);
    res.status(201).json({
      id: result.insertId,
      examText: learnerExamText,
      mcq_answer_key: examBundle.mcqAnswerKey || "",
      teacher_exam_supplement: teacherExamSupplement,
      exam_duration_hours: resolvedDurH,
      exam_duration_minutes: resolvedDurM,
      duration_label_compact: examDurationLabel,
      duration_label_spelled: examDurationLabel,
      notes_required: false,
      structure: selectedStructure,
      structure_detail: selectedStructureDetail || null,
      selected_strands: selectedStrands,
      selected_sub_strands: selectedSubStrands,
      output_mode: selectedOutputMode,
      percentage_allocation: percentageText,
      section_allocation: sectionAllocationText,
      used_curriculum_rows: referenceRows.length,
      used_material_rows: supplementalMaterialNotes ? supplementalMaterialNotes.split("\n").length : 0,
      ai_stems_used: aiStemOverrides.length,
      ai_stems_source: aiStemOverrides.length ? "openai" : "curriculum_template",
      question_bank_mcq_pool: questionBankMcqPoolLoaded,
      question_bank_mcqs_used: examBankConsume ? Number(examBankConsume.consumed) || 0 : 0,
      question_bank_mcqs_env_disabled: examBankDisableMcqIntegration
    });
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
  "/api/admission/online-requests",
  auth,
  enforceModuleAccess(MODULE_KEYS.ADMISSION),
  enforcePermission(PERMISSIONS.VIEW),
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION,
    ROLES.SYSTEM_ADMINISTRATOR
  ]),
  asyncHandler(async (req, res) => {
    const normalizedRole = normalizeRole(req.user.role);
    const statusFilter = cleanOptionalValue(req.query?.status).toUpperCase() || null;
    const limit = parseBoundedInt(req.query?.limit, { fallback: 400, min: 1, max: 1000 });
    let sql = `
      SELECT *
      FROM online_admission_requests
      WHERE 1 = 1`;
    const params = [];
    if (!isAnySystemDeveloperRole(normalizedRole)) {
      sql += " AND institution_id = ?";
      params.push(req.user.institution_id);
    }
    if (statusFilter) {
      sql += " AND status = ?";
      params.push(statusFilter);
    }
    sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
    const rows = await query(sql, params);
    res.json({ items: rows });
  })
);

app.patch(
  "/api/admission/online-requests/:id",
  auth,
  enforceModuleAccess(MODULE_KEYS.ADMISSION),
  enforcePermission(PERMISSIONS.UPDATE),
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION,
    ROLES.SYSTEM_ADMINISTRATOR
  ]),
  asyncHandler(async (req, res) => {
    const requestId = Number(req.params.id || 0);
    if (!requestId) {
      return res.status(400).json({ error: "Valid request id is required." });
    }
    const normalizedStatusInput = cleanValue(req.body?.status || "").toUpperCase();
    const allowedStatuses = new Set([
      "PENDING",
      "APPROVED",
      "REJECTED",
      "WAITLIST",
      "WAITING_LIST",
      "MORE_INFO",
      "MORE_INFORMATION_REQUIRED",
      "INTERVIEW_REQUESTED"
    ]);
    if (!normalizedStatusInput || !allowedStatuses.has(normalizedStatusInput)) {
      return res.status(400).json({ error: "status must reference a recognised admission workflow outcome." });
    }
    let normalizedStoredStatus = normalizedStatusInput;
    if (normalizedStoredStatus === "WAITING_LIST") normalizedStoredStatus = "WAITLIST";
    if (normalizedStoredStatus === "MORE_INFORMATION_REQUIRED") normalizedStoredStatus = "MORE_INFO";

    const reviewComment = cleanOptionalValue(req.body?.review_comment || req.body?.comment);
    const rows = await query(`SELECT * FROM online_admission_requests WHERE id = ? LIMIT 1`, [requestId]);
    if (!rows.length) {
      return res.status(404).json({ error: "Admission request was not found." });
    }
    const record = rows[0];
    const scopeError = await assertInstitutionScopeAccess(
      req,
      record.institution_id,
      "You can only update admission submissions for institutions you manage."
    );
    if (scopeError) {
      return res.status(scopeError.status).json({ error: scopeError.error });
    }

    await query(
      `UPDATE online_admission_requests
       SET status = ?,
           review_comment = ?,
           reviewed_at = NOW(),
           reviewed_by_user_id = ?
       WHERE id = ?`,
      [normalizedStoredStatus, reviewComment || null, req.user.id, requestId]
    );

    await auditLog(req.user, "ONLINE_ADMISSION_REQUEST_DECISION", "online_admission_requests", requestId, {
      institution_id: record.institution_id,
      status: normalizedStoredStatus,
      review_comment: reviewComment || null
    });

    const applicantEmail = cleanOptionalValue(record.applicant_email);
    const applicantPhone = cleanOptionalValue(record.applicant_phone);
    const learnerName = cleanValue(record.learner_name || "");
    const instRows = await query(`SELECT institution_name FROM institutions WHERE id = ? LIMIT 1`, [
      record.institution_id
    ]);
    const institutionName = cleanValue(instRows[0]?.institution_name || "Institution");
    const statusLabel = normalizedStoredStatus.replace(/_/g, " ");
    const smsBody =
      learnerName ?
        `${learnerName}: admission status updated to ${statusLabel}. ${cleanValue(reviewComment || "")}`
        : `Admission status updated to ${statusLabel}. ${cleanValue(reviewComment || "")}`;

    await Promise.all(
      [
        applicantEmail && emailChannelReady()
          ? sendTransactionalEmail({
            to: applicantEmail,
            subject: `${institutionName} — Admission update`,
            text: [`Status: ${statusLabel}`, learnerName ? `Learner: ${learnerName}` : "", "", reviewComment || ""].join(
              "\n"
            )
          })
          : null,
        applicantPhone && smsChannelReady() ? sendTransactionalSms({ to: applicantPhone, text: smsBody }) : null
      ]
        .filter(Boolean)
        .map((promise) =>
          promise.catch((err) => {
            // eslint-disable-next-line no-console
            console.warn("[online-admission] applicant notify:", err?.message || err);
          })
        )
    );

    res.json({ message: "Admission request workflow updated.", id: requestId, status: normalizedStoredStatus });
  })
);

app.get(
  "/api/admission/learners/next-admission-number",
  auth,
  enforceModuleAccess(MODULE_KEYS.ADMISSION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SYSTEM_ADMINISTRATOR, ROLES.TEACHER]),
  asyncHandler(async (req, res) => {
    const seed = cleanOptionalValue(req.query?.seed);
    const admissionNumber = await nextAdmissionNumber({
      institutionId: Number(req.user.institution_id),
      seed: seed || ""
    });
    res.json({ admission_number: admissionNumber });
  })
);

app.get(
  "/api/admission/learners/next-learner-code",
  auth,
  enforceModuleAccess(MODULE_KEYS.ADMISSION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SYSTEM_ADMINISTRATOR, ROLES.TEACHER]),
  asyncHandler(async (req, res) => {
    const learnerSerialColumns = await getExistingColumns("learners", ["learner_serial_number"]);
    const useSerialColumn = learnerSerialColumns.includes("learner_serial_number");
    const [row] = await query(
      `SELECT MAX(${useSerialColumn ? "COALESCE(learner_serial_number, id)" : "id"}) AS max_serial
       FROM learners
       WHERE institution_id = ?`,
      [Number(req.user.institution_id || 0)]
    );
    const nextSerial = Number(row?.max_serial || 0) + 1;
    const learnerCode = `LC-${padThree(nextSerial)}`;
    res.json({
      next_serial: nextSerial,
      learner_code: learnerCode
    });
  })
);

app.post(
  "/api/admission/learners/next-admission-number",
  auth,
  enforceModuleAccess(MODULE_KEYS.ADMISSION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SYSTEM_ADMINISTRATOR, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const mode = cleanValue(req.body?.mode || "auto").toLowerCase();
    const seed = mode.includes("seed")
      ? cleanOptionalValue(req.body?.seed || "")
      : "";
    const admissionNumber = await nextAdmissionNumber({
      institutionId: Number(req.user.institution_id),
      seed
    });
    res.json({ admission_number: admissionNumber, mode });
  })
);

app.get(
  "/api/admission/learners/:id/admission-form",
  auth,
  enforceModuleAccess(MODULE_KEYS.ADMISSION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SYSTEM_ADMINISTRATOR, ROLES.TEACHER]),
  asyncHandler(async (req, res) => {
    const learnerId = Number(req.params.id || 0);
    if (!learnerId) {
      return res.status(400).json({ error: "Valid learner id is required." });
    }
    const rows = await query(
      `SELECT l.*, i.institution_name, i.institution_code, i.letterhead_file_path
       FROM learners l
       INNER JOIN institutions i ON i.id = l.institution_id
       WHERE l.id = ? AND l.institution_id = ?
       LIMIT 1`,
      [learnerId, req.user.institution_id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Learner not found." });
    }
    const learner = rows[0];
    let resolvedLetterhead = cleanOptionalValue(learner.letterhead_file_path);
    if (!resolvedLetterhead) {
      const letterheadDocs = await query(
        `SELECT file_path
         FROM institution_documents
         WHERE institution_id = ?
           AND document_type IN ('institution_letterhead', 'admission_form_template')
         ORDER BY id DESC
         LIMIT 1`,
        [learner.institution_id]
      );
      resolvedLetterhead = cleanOptionalValue(letterheadDocs[0]?.file_path);
    }
    const learnerSerialLabel = formatLearnerSerial(learner.learner_serial_number || learner.id);
    const referenceNo = `ADM-FORM-${learnerSerialLabel || learner.id}-${dayjs().format("YYYYMMDDHHmmss")}`;
    res.json({
      reference_no: referenceNo,
      learner_serial_number: learner.learner_serial_number || null,
      learner_serial_label: learnerSerialLabel || null,
      generated_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      title: "Institution Admission Form",
      letterhead_file_path: resolvedLetterhead || null,
      learner_details: learner,
      parent_guardian_details: {
        parent_full_name: learner.parent_full_name,
        parent_relationship: learner.parent_relationship,
        parent_id_number: learner.parent_id_number,
        parent_phone: learner.parent_phone,
        parent_phone_secondary: learner.parent_phone_secondary,
        parent_email: learner.parent_email,
        parent_residence: learner.parent_residence,
        parent_nationality: learner.parent_nationality,
        parent_occupation: learner.parent_occupation,
        parent2_full_name: learner.parent2_full_name,
        parent2_relationship: learner.parent2_relationship,
        parent2_phone_primary: learner.parent2_phone_primary,
        parent2_phone_secondary: learner.parent2_phone_secondary,
        parent2_email: learner.parent2_email,
        parent2_residence: learner.parent2_residence
      },
      learner_declaration:
        "I hereby confirm that the information provided above is true and complete to the best of my knowledge.",
      parent_declaration:
        "I/we, the parent/guardian, confirm that this learner's details are accurate and authorize this admission request.",
      signature_fields: {
        learner_signature: "",
        learner_signature_date: "",
        parent_signature: "",
        parent_signature_date: ""
      }
    });
  })
);

app.get(
  "/api/admission/learners/:id/admission-letter",
  auth,
  enforceModuleAccess(MODULE_KEYS.ADMISSION),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SYSTEM_ADMINISTRATOR, ROLES.TEACHER]),
  asyncHandler(async (req, res) => {
    const learnerId = Number(req.params.id || 0);
    if (!learnerId) {
      return res.status(400).json({ error: "Valid learner id is required." });
    }
    const rows = await query(
      `SELECT l.*, i.institution_name, i.institution_code, i.letterhead_file_path,
              i.admission_letter_template_text, i.admission_letter_template_file_url
       FROM learners l
       INNER JOIN institutions i ON i.id = l.institution_id
       WHERE l.id = ? AND l.institution_id = ?
       LIMIT 1`,
      [learnerId, req.user.institution_id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Learner not found." });
    }
    const learner = rows[0];
    let resolvedLetterhead = cleanOptionalValue(learner.letterhead_file_path);
    let resolvedTemplateFile = cleanOptionalValue(learner.admission_letter_template_file_url);
    if (!resolvedLetterhead || !resolvedTemplateFile) {
      const institutionDocs = await query(
        `SELECT document_type, file_path
         FROM institution_documents
         WHERE institution_id = ?
           AND document_type IN ('institution_letterhead', 'admission_letter_template')
         ORDER BY id DESC`,
        [learner.institution_id]
      );
      if (!resolvedLetterhead) {
        const letterhead = institutionDocs.find((row) => cleanValue(row.document_type) === "institution_letterhead");
        resolvedLetterhead = cleanOptionalValue(letterhead?.file_path);
      }
      if (!resolvedTemplateFile) {
        const admissionLetter = institutionDocs.find((row) => cleanValue(row.document_type) === "admission_letter_template");
        resolvedTemplateFile = cleanOptionalValue(admissionLetter?.file_path);
      }
    }
    const baseTemplate = cleanOptionalValue(learner.admission_letter_template_text) || [
      "Dear {{LEARNER_NAME}},",
      "",
      "We are pleased to offer you admission to {{INSTITUTION_NAME}}.",
      "Admission Number: {{ADMISSION_NUMBER}}",
      "Learner Serial Number: {{LEARNER_SERIAL_NUMBER}}",
      "Grade/Form: {{GRADE_FORM}}",
      "Stream: {{STREAM}}",
      "",
      "Reporting Date: {{REPORTING_DATE}}",
      "",
      "Please present this letter during reporting together with required documents.",
      "",
      "Yours faithfully,",
      "Head of Institution"
    ].join("\n");
    const renderedLetter = baseTemplate
      .replaceAll("{{LEARNER_NAME}}", cleanValue(learner.full_name || "-"))
      .replaceAll("{{INSTITUTION_NAME}}", cleanValue(learner.institution_name || "-"))
      .replaceAll("{{INSTITUTION_CODE}}", cleanValue(learner.institution_code || "-"))
      .replaceAll("{{ADMISSION_NUMBER}}", cleanValue(learner.admission_number || "-"))
      .replaceAll("{{LEARNER_SERIAL_NUMBER}}", cleanValue(formatLearnerSerial(learner.learner_serial_number || learner.id) || "-"))
      .replaceAll("{{GRADE_FORM}}", cleanValue(learner.grade || learner.form_name || "-"))
      .replaceAll("{{STREAM}}", cleanValue(learner.stream || "-"))
      .replaceAll("{{REPORTING_DATE}}", dayjs().add(7, "day").format("YYYY-MM-DD"))
      .replaceAll("{{DATE_TIME}}", dayjs().format("YYYY-MM-DD HH:mm:ss"));
    res.json({
      learner_id: learner.id,
      learner_serial_number: learner.learner_serial_number || null,
      learner_serial_label: formatLearnerSerial(learner.learner_serial_number || learner.id) || null,
      learner_name: learner.full_name,
      admission_number: learner.admission_number,
      generated_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
      letterhead_file_path: resolvedLetterhead || null,
      template_file_url: resolvedTemplateFile || null,
      letter_text: renderedLetter
    });
  })
);

app.get(
  "/api/attendance/participants",
  auth,
  enforceModuleAccess(MODULE_KEYS.ATTENDANCE),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SYSTEM_ADMINISTRATOR, ROLES.TEACHER]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const type = cleanValue(req.query?.type || "Teacher").toLowerCase();
    const grade = cleanValue(req.query?.grade || "");
    const stream = cleanValue(req.query?.stream || "");
    if (type === "teacher") {
      const rows = await query(
        `SELECT id, full_name AS person_name, tsc_number, id_number
         FROM teacher_profiles
         WHERE institution_id = ?
         ORDER BY full_name ASC`,
        [institutionId]
      );
      return res.json({ rows });
    }
    if (type === "support staff" || type === "support_staff") {
      const rows = await query(
        `SELECT id, full_name AS person_name, staff_number, id_number
         FROM non_teaching_staff_profiles
         WHERE institution_id = ?
         ORDER BY full_name ASC`,
        [institutionId]
      );
      return res.json({ rows });
    }
    const rows = await query(
      `SELECT id, full_name AS person_name, admission_number, grade, stream
       FROM learners
       WHERE institution_id = ?
         AND (? = '' OR grade = ? OR form_name = ?)
         AND (? = '' OR stream = ?)
       ORDER BY full_name ASC`,
      [institutionId, grade, grade, grade, stream, stream]
    );
    return res.json({ rows });
  })
);

app.get(
  "/api/attendance/register",
  auth,
  enforceModuleAccess(MODULE_KEYS.ATTENDANCE),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SYSTEM_ADMINISTRATOR, ROLES.TEACHER]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const type = cleanValue(req.query?.type || "").toLowerCase();
    const fromDate = cleanValue(req.query?.from_date || "");
    const toDate = cleanValue(req.query?.to_date || "");
    const grade = cleanValue(req.query?.grade || "");
    const stream = cleanValue(req.query?.stream || "");
    const whereParts = ["institution_id = ?"];
    const params = [institutionId];
    if (type) {
      whereParts.push("LOWER(attendance_type) = ?");
      params.push(type);
    }
    if (fromDate) {
      whereParts.push("DATE(attendance_date) >= DATE(?)");
      params.push(fromDate);
    }
    if (toDate) {
      whereParts.push("DATE(attendance_date) <= DATE(?)");
      params.push(toDate);
    }
    if (grade) {
      whereParts.push("(grade = ?)");
      params.push(grade);
    }
    if (stream) {
      whereParts.push("(stream = ?)");
      params.push(stream);
    }
    const rows = await query(
      `SELECT id, attendance_type, person_id, person_name, grade, stream, attendance_date, time_in, time_out, status, reason, comments
       FROM attendance_records
       WHERE ${whereParts.join(" AND ")}
       ORDER BY attendance_date DESC, person_name ASC`,
      params
    );
    res.json({ rows });
  })
);

app.get(
  "/api/attendance/register/export/:format",
  auth,
  enforceModuleAccess(MODULE_KEYS.ATTENDANCE),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SYSTEM_ADMINISTRATOR, ROLES.TEACHER]),
  asyncHandler(async (req, res) => {
    const format = cleanValue(req.params.format || "").toLowerCase();
    const registerResponse = await query(
      `SELECT attendance_type, person_id, person_name, grade, stream, attendance_date, time_in, time_out, status, reason, comments
       FROM attendance_records
       WHERE institution_id = ?
         AND (? = '' OR LOWER(attendance_type) = ?)
         AND (? = '' OR DATE(attendance_date) >= DATE(?))
         AND (? = '' OR DATE(attendance_date) <= DATE(?))
       ORDER BY attendance_date DESC, person_name ASC`,
      [
        Number(req.user.institution_id),
        cleanValue(req.query?.type || "").toLowerCase(),
        cleanValue(req.query?.type || "").toLowerCase(),
        cleanValue(req.query?.from_date || ""),
        cleanValue(req.query?.from_date || ""),
        cleanValue(req.query?.to_date || ""),
        cleanValue(req.query?.to_date || "")
      ]
    );
    if (format === "pdf") {
      return sendSimplePdf(
        res,
        `attendance-register-${dayjs().format("YYYYMMDDHHmmss")}`,
        registerResponse.map((row, index) => `${index + 1}. ${JSON.stringify(row)}`)
      );
    }
    if (format === "excel") {
      const headers = registerResponse.length ? Object.keys(registerResponse[0]) : ["No Data"];
      const rows = registerResponse.length ? registerResponse.map((row) => headers.map((header) => row[header])) : [];
      return sendSimpleExcel(res, `attendance-register-${dayjs().format("YYYYMMDDHHmmss")}`, headers, rows);
    }
    if (format === "word") {
      res.setHeader("Content-Type", "application/msword; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="attendance-register-${dayjs().format("YYYYMMDDHHmmss")}.doc"`);
      const content = registerResponse
        .map((row, index) => `${index + 1}. ${row.person_name || "-"} | ${row.attendance_type || "-"} | ${row.status || "-"} | ${row.attendance_date || "-"}`)
        .join("\n");
      return res.send(content || "No attendance records found.");
    }
    return res.status(400).json({ error: "Unsupported format. Use pdf, excel, or word." });
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

// === rev43: Examination Management — exam serial, result scripts, assessment report ===
function buildExamSerialSegment({
  grade,
  form,
  learningArea,
  examType,
  term,
  year,
  stream,
  learnerSerialNumber
}) {
  const bits = [
    String(grade || form || "GRADE").slice(0, 8).toUpperCase(),
    String(learningArea || "LA").slice(0, 3).toUpperCase(),
    String(examType || "EXM").slice(0, 3).toUpperCase(),
    String(term || "T").replace(/[^A-Z0-9]/gi, "").slice(0, 2).toUpperCase(),
    String(year || new Date().getFullYear()),
    stream ? String(stream).slice(0, 2).toUpperCase() : "XX",
    learnerSerialNumber ? `L${formatLearnerSerial(learnerSerialNumber)}` : "BULK"
  ];
  return bits.join("-");
}

function buildExamQrPayload({
  institutionId,
  institutionCode,
  learnerId,
  learnerName,
  admissionNumber,
  grade,
  form,
  learningArea,
  examType,
  term,
  year,
  stream,
  serial
}) {
  const payload = {
    schema: "IMIS_EXAM_QR_V1",
    institution_id: Number(institutionId || 0) || null,
    institution_code: cleanOptionalValue(institutionCode),
    learner_id: learnerId ? Number(learnerId) : null,
    learner_name: cleanOptionalValue(learnerName),
    admission_number: cleanOptionalValue(admissionNumber),
    grade: cleanOptionalValue(grade || form),
    form_name: cleanOptionalValue(form),
    learning_area: cleanOptionalValue(learningArea),
    exam_type: cleanOptionalValue(examType),
    exam_session: cleanOptionalValue(examType),
    term: cleanOptionalValue(term),
    year: Number(year || 0) || null,
    stream: cleanOptionalValue(stream),
    serial: cleanOptionalValue(serial)
  };
  return `IMIS_EXAM_QR_V1|${JSON.stringify(payload)}`;
}

app.post(
  "/api/academic/exams/allocate-serials",
  auth,
  enforceAnyModuleAccess([MODULE_KEYS.ACADEMIC_EXAMS, MODULE_KEYS.CBC_CURRICULUM_EDITOR]),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const body = req.body || {};
    const examId = Number(body.exam_id || body.academic_exam_id || 0) || 0;
    const grade = cleanValue(body.grade || "");
    const form = cleanValue(body.form_name || "");
    const learningArea = cleanValue(body.learning_area || body.subject || "");
    const examType = cleanValue(body.exam_type || "");
    const term = cleanValue(body.term || "");
    const year = Number(body.year || new Date().getFullYear());
    const stream = cleanValue(body.stream || "");
    const modeRaw = (cleanValue(body.mode || "per_learner") || "per_learner").toLowerCase();
    const mode = modeRaw === "per_stream" || modeRaw === "per_class" || modeRaw === "per_learner"
      ? modeRaw
      : "per_learner";
    if (!(grade || form) || !learningArea || !examType) {
      return res.status(400).json({ error: "grade/form, learning_area/subject and exam_type are required." });
    }
    if (examId > 0) {
      const examCols = await getExistingColumns("academic_exams", ["serials_processed_at"]);
      if (examCols.includes("serials_processed_at")) {
        const examRows = await query(
          `SELECT id, serials_processed_at FROM academic_exams WHERE id = ? AND institution_id = ? LIMIT 1`,
          [examId, institutionId]
        );
        if (!examRows.length) {
          return res.status(404).json({ error: "Exam record not found." });
        }
        if (examRows[0].serials_processed_at) {
          return res.status(409).json({
            error:
              "This exam has already been processed for serial numbers and QR payloads. Click Generate to create a new exam, then Process once."
          });
        }
      }
    }
    const learnerSerialColumns = await getExistingColumns("learners", ["learner_serial_number"]);
    const hasLearnerSerialColumn = learnerSerialColumns.includes("learner_serial_number");
    const learners = mode === "per_learner" || mode === "per_stream"
      ? await query(
          `SELECT id, full_name, admission_number, grade, stream${
            hasLearnerSerialColumn ? ", learner_serial_number" : ""
          }
           FROM learners
           WHERE institution_id = ?
             AND (grade = ? OR grade = ? OR ? = '')
             AND (stream = ? OR ? = '')
           ORDER BY full_name ASC`,
          [institutionId, grade || "", form || "", grade || form || "", stream || "", stream || ""]
        )
      : [{ id: null, full_name: "BULK", admission_number: "BULK", learner_serial_number: null }];
    const institutionRows = await query(
      `SELECT institution_code
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [institutionId]
    ).catch(() => []);
    const institutionCode = cleanValue(institutionRows[0]?.institution_code || "");
    let serials = [];
    if (mode === "per_learner") {
      serials = learners.map((learner) => ({
        learner_id: learner.id,
        learner_serial_number: learner.learner_serial_number || null,
        learner_name: learner.full_name,
        admission_number: learner.admission_number,
        institution_id: institutionId,
        institution_code: institutionCode || null,
        grade: learner.grade || grade || form,
        learning_area: learningArea || null,
        stream: learner.stream || stream || null,
        serial: buildExamSerialSegment({
          grade, form, learningArea, examType, term, year, stream,
          learnerSerialNumber: learner.learner_serial_number || learner.id
        }),
        qr_payload: buildExamQrPayload({
          institutionId,
          institutionCode,
          learnerId: learner.id,
          learnerName: learner.full_name,
          admissionNumber: learner.admission_number,
          grade: learner.grade || grade,
          form,
          learningArea,
          examType,
          term,
          year,
          stream: learner.stream || stream,
          serial: buildExamSerialSegment({
            grade, form, learningArea, examType, term, year, stream,
            learnerSerialNumber: learner.learner_serial_number || learner.id
          })
        })
      }));
    } else if (mode === "per_stream") {
      const streams = Array.from(
        new Set(
          learners
            .map((learner) => cleanValue(learner.stream || "N/A"))
            .filter(Boolean)
        )
      );
      serials = streams.map((streamName, index) => ({
        learner_id: null,
        learner_serial_number: null,
        learner_name: `STREAM ${streamName}`,
        admission_number: "STREAM",
        institution_id: institutionId,
        institution_code: institutionCode || null,
        grade: grade || form,
        learning_area: learningArea || null,
        stream: streamName,
        serial: buildExamSerialSegment({
          grade, form, learningArea, examType, term, year, stream: streamName,
          learnerSerialNumber: index + 1
        }),
        qr_payload: buildExamQrPayload({
          institutionId,
          institutionCode,
          learnerId: null,
          learnerName: `STREAM ${streamName}`,
          admissionNumber: "STREAM",
          grade,
          form,
          learningArea,
          examType,
          term,
          year,
          stream: streamName,
          serial: buildExamSerialSegment({
            grade, form, learningArea, examType, term, year, stream: streamName,
            learnerSerialNumber: index + 1
          })
        })
      }));
    } else {
      serials = [{
        learner_id: null,
        learner_serial_number: null,
        learner_name: "CLASS",
        admission_number: "CLASS",
        institution_id: institutionId,
        institution_code: institutionCode || null,
        grade: grade || form,
        learning_area: learningArea || null,
        stream: stream || "N/A",
        serial: buildExamSerialSegment({
          grade, form, learningArea, examType, term, year, stream: stream || "N/A",
          learnerSerialNumber: null
        }),
        qr_payload: buildExamQrPayload({
          institutionId,
          institutionCode,
          learnerId: null,
          learnerName: "CLASS",
          admissionNumber: "CLASS",
          grade,
          form,
          learningArea,
          examType,
          term,
          year,
          stream: stream || "N/A",
          serial: buildExamSerialSegment({
            grade, form, learningArea, examType, term, year, stream: stream || "N/A",
            learnerSerialNumber: null
          })
        })
      }];
    }
    if (examId > 0) {
      const examCols = await getExistingColumns("academic_exams", ["serials_processed_at"]);
      if (examCols.includes("serials_processed_at")) {
        await query(
          `UPDATE academic_exams SET serials_processed_at = UTC_TIMESTAMP() WHERE id = ? AND institution_id = ?`,
          [examId, institutionId]
        );
      }
    }
    res.json({ count: serials.length, mode, serials });
  })
);

app.post(
  "/api/academic/exams/resolve-serial",
  auth,
  enforceAnyModuleAccess([MODULE_KEYS.ACADEMIC_EXAMS, MODULE_KEYS.CBC_CURRICULUM_EDITOR, MODULE_KEYS.ACADEMIC_MARKS]),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const targetSerial = cleanValue(body.serial || body.serial_number || "");
    const grade = cleanValue(body.grade || "");
    const form = cleanValue(body.form_name || "");
    const learningArea = cleanValue(body.learning_area || body.subject || "");
    const examType = cleanValue(body.exam_type || "");
    const term = cleanValue(body.term || "");
    const year = Number(body.year || 0);
    const stream = cleanValue(body.stream || "");
    if (!targetSerial) {
      return res.status(400).json({ error: "serial is required." });
    }
    if (!(grade || form) || !learningArea || !examType || !Number.isFinite(year) || year < 2000) {
      return res.status(400).json({
        error: "grade/form_name, learning_area, exam_type and a valid academic year are required to resolve a serial."
      });
    }
    const institutionId = Number(req.user.institution_id);
    const learnerSerialColumns = await getExistingColumns("learners", ["learner_serial_number"]);
    const hasLearnerSerialColumn = learnerSerialColumns.includes("learner_serial_number");
    const learners = await query(
      `SELECT id, full_name, admission_number, grade, stream${hasLearnerSerialColumn ? ", learner_serial_number" : ""}
       FROM learners
       WHERE institution_id = ?
         AND (grade = ? OR grade = ? OR ? = '')
         AND (stream = ? OR ? = '')
       ORDER BY full_name ASC`,
      [institutionId, grade || "", form || "", grade || form || "", stream || "", stream || ""]
    );
    const institutionRows = await query(
      `SELECT institution_code
       FROM institutions
       WHERE id = ?
       LIMIT 1`,
      [institutionId]
    ).catch(() => []);
    const institutionCode = cleanValue(institutionRows[0]?.institution_code || "");
    for (const learner of learners) {
      const computed = buildExamSerialSegment({
        grade,
        form,
        learningArea,
        examType,
        term,
        year,
        stream: learner.stream || stream || "",
        learnerSerialNumber: learner.learner_serial_number || learner.id
      });
      if (computed === targetSerial) {
        return res.json({
          match: true,
          learner: {
            id: learner.id,
            full_name: learner.full_name,
            admission_number: learner.admission_number,
            grade: learner.grade,
            stream: learner.stream
          },
          serial: computed,
          qr_payload: buildExamQrPayload({
            institutionId,
            institutionCode,
            learnerId: learner.id,
            learnerName: learner.full_name,
            admissionNumber: learner.admission_number,
            grade: learner.grade || grade,
            form,
            learningArea,
            examType,
            term,
            year,
            stream: learner.stream || stream,
            serial: computed
          })
        });
      }
    }
    res.status(404).json({ match: false, error: "No learner matched this serial for the provided exam filters." });
  })
);

app.post(
  "/api/academic/exams/serials/qr.png",
  auth,
  enforceAnyModuleAccess([MODULE_KEYS.ACADEMIC_EXAMS, MODULE_KEYS.CBC_CURRICULUM_EDITOR, MODULE_KEYS.ACADEMIC_MARKS]),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.SENIOR_TEACHER, ROLES.HEAD_OF_DEPARTMENT, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const payload = cleanValue(req.body?.payload || "");
    if (!payload) return res.status(400).json({ error: "payload is required." });
    if (payload.length > 2400) return res.status(400).json({ error: "QR payload is too long." });
    try {
      const QRCode = require("qrcode");
      const pngBuffer = await QRCode.toBuffer(payload, {
        type: "png",
        margin: 1,
        width: 260,
        errorCorrectionLevel: "M"
      });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");
      return res.send(pngBuffer);
    } catch (error) {
      return res.status(500).json({ error: `Unable to generate exam QR code: ${error?.message || "Unknown error"}` });
    }
  })
);

app.get(
  "/api/academic/results/ranked",
  auth,
  enforceAnyModuleAccess([MODULE_KEYS.ACADEMIC_MARKS, MODULE_KEYS.CBC_CURRICULUM_EDITOR]),
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const grade = cleanValue(req.query?.grade || "");
    const stream = cleanValue(req.query?.stream || "");
    const term = cleanValue(req.query?.term || "");
    const year = Number(req.query?.year || new Date().getFullYear());
    const rows = await query(
      `SELECT learner_id, learner_name, grade, stream,
              AVG(percentage) AS avg_pct,
              SUM(marks) AS total_marks
       FROM academic_marks
       WHERE institution_id = ?
         AND (? = '' OR grade = ?)
         AND (? = '' OR stream = ?)
         AND (? = '' OR term = ?)
         AND (? = 0 OR year = ?)
       GROUP BY learner_id, learner_name, grade, stream
       ORDER BY avg_pct DESC, total_marks DESC`,
      [institutionId, grade, grade, stream, stream, term, term, year, year]
    );
    const ranked = rows.map((r, idx) => ({
      position: idx + 1,
      ...r,
      avg_pct: r.avg_pct == null ? 0 : Number(r.avg_pct).toFixed(2)
    }));
    res.json({ filters: { grade, stream, term, year }, ranked });
  })
);

app.get(
  "/api/academic/assessment-report/:learnerId",
  auth,
  enforceRole([
    ROLES.SUPER_SYSTEM_DEVELOPER,
    ROLES.SYSTEM_DEVELOPER,
    ROLES.SYSTEM_ADMINISTRATOR,
    ROLES.ADMIN,
    ROLES.HEAD_OF_INSTITUTION,
    ROLES.SENIOR_TEACHER,
    ROLES.HEAD_OF_DEPARTMENT,
    ROLES.TEACHER,
    ROLES.PARENT,
    ROLES.LEARNER
  ]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const learnerId = Number(req.params.learnerId || 0);
    if (!learnerId) return res.status(400).json({ error: "learner id required." });
    const role = normalizeRole(req.user.role);
    if (role === ROLES.PARENT || role === ROLES.LEARNER) {
      if (Number(req.user.learner_id) !== learnerId) {
        return res.status(403).json({ error: "You can only view your linked learner's assessment report." });
      }
    }
    const learnerRows = await query(
      `SELECT l.*, i.institution_name, i.institution_code, i.login_hero_image_path
       FROM learners l
       LEFT JOIN institutions i ON i.id = l.institution_id
       WHERE l.id = ? AND l.institution_id = ? LIMIT 1`,
      [learnerId, institutionId]
    );
    if (!learnerRows.length) return res.status(404).json({ error: "Learner not found." });
    const learner = learnerRows[0];
    const marks = await query(
      `SELECT exam_type, subject, marks, percentage, cbc_grade_band, term, year
       FROM academic_marks
       WHERE institution_id = ? AND learner_id = ?
       ORDER BY year ASC, term ASC`,
      [institutionId, learnerId]
    );
    const byPeriod = {};
    marks.forEach((m) => {
      const key = `${m.year || ""}-${m.term || ""}`;
      if (!byPeriod[key]) byPeriod[key] = { year: m.year, term: m.term, subjects: [] };
      byPeriod[key].subjects.push(m);
    });
    const trend = Object.values(byPeriod)
      .sort((a, b) => `${a.year}-${a.term}`.localeCompare(`${b.year}-${b.term}`))
      .map((p) => {
        const sum = p.subjects.reduce((acc, m) => acc + Number(m.percentage || 0), 0);
        const avg = p.subjects.length ? Number((sum / p.subjects.length).toFixed(2)) : 0;
        return { year: p.year, term: p.term, avg, count: p.subjects.length };
      });
    res.json({
      learner: {
        id: learner.id,
        full_name: learner.full_name,
        grade: learner.grade,
        stream: learner.stream,
        admission_number: learner.admission_number
      },
      institution: {
        name: learner.institution_name,
        code: learner.institution_code,
        logo_url: learner.login_hero_image_path || null
      },
      marks,
      performance_trend: trend
    });
  })
);

const EXAM_TEMPLATE_KEY_ALLOWLIST = new Set([
  "exam-paper",
  "mark-sheet",
  "assessment-report",
  "progress-report",
  "teacher-notes"
]);

const EXAM_SETTINGS_DEFAULTS = {
  auto_save_enabled: true,
  auto_save_interval_sec: 90,
  strict_cbc_validation: true,
  background_processing_enabled: true,
  realtime_sync_enabled: false,
  offline_cache_enabled: true
};
const MAX_EXAM_TEMPLATE_NAME_LENGTH = 180;
const MAX_EXAM_TEMPLATE_CONTENT_LENGTH = 200000;

function normalizeExamTemplateKey(value = "") {
  const key = cleanValue(value || "").toLowerCase();
  if (EXAM_TEMPLATE_KEY_ALLOWLIST.has(key)) return key;
  if (/^exam-structure-[a-z0-9_-]+$/.test(key)) return key;
  return "exam-paper";
}

function normalizeArchiveStatus(value = "") {
  const normalized = cleanValue(value || "").toUpperCase();
  return normalized === "ACTIVE" || normalized === "ARCHIVED" ? normalized : "ARCHIVED";
}

function readExamFilterInputs(queryParams = {}) {
  const grade = cleanValue(queryParams?.grade || "");
  const formName = cleanValue(queryParams?.form_name || "");
  const stream = cleanValue(queryParams?.stream || "");
  const term = cleanValue(queryParams?.term || "");
  const yearRaw = Number(queryParams?.year || 0);
  return {
    classFilter: grade || formName,
    stream,
    term,
    year: Number.isFinite(yearRaw) && yearRaw > 0 ? yearRaw : null
  };
}

app.get(
  "/api/examinations/analytics/overview",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const [curriculumCountRows, materialCountRows, examCountRows, marksCountRows, learnerCountRows, meanRows] = await Promise.all([
      query("SELECT COUNT(*) AS total FROM cbc_curriculum_entries WHERE institution_id = ?", [institutionId]),
      query("SELECT COUNT(*) AS total FROM teacher_resources WHERE institution_id = ?", [institutionId]),
      query("SELECT COUNT(*) AS total FROM academic_exams WHERE institution_id = ?", [institutionId]),
      query("SELECT COUNT(*) AS total FROM academic_marks WHERE institution_id = ?", [institutionId]),
      query("SELECT COUNT(DISTINCT learner_id) AS total FROM academic_marks WHERE institution_id = ?", [institutionId]),
      query("SELECT ROUND(AVG(marks), 2) AS mean_marks FROM academic_marks WHERE institution_id = ?", [institutionId])
    ]);
    const [curriculumByAreaRows, marksByAreaRows] = await Promise.all([
      query(
        `SELECT learning_area, COUNT(*) AS entry_count
         FROM cbc_curriculum_entries
         WHERE institution_id = ?
         GROUP BY learning_area
         ORDER BY learning_area ASC`,
        [institutionId]
      ),
      query(
        `SELECT subject AS learning_area, ROUND(AVG(marks), 2) AS avg_marks, ROUND(AVG(percentage), 2) AS avg_percentage
         FROM academic_marks
         WHERE institution_id = ?
         GROUP BY subject
         ORDER BY subject ASC`,
        [institutionId]
      )
    ]);
    const marksByAreaMap = new Map(marksByAreaRows.map((row) => [cleanValue(row.learning_area), row]));
    const allAreas = Array.from(
      new Set([
        ...curriculumByAreaRows.map((row) => cleanValue(row.learning_area)),
        ...marksByAreaRows.map((row) => cleanValue(row.learning_area))
      ].filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    const byLearningArea = allAreas.map((learningArea) => {
      const curriculum = curriculumByAreaRows.find((row) => cleanValue(row.learning_area) === learningArea);
      const marks = marksByAreaMap.get(learningArea);
      return {
        learning_area: learningArea,
        entry_count: Number(curriculum?.entry_count || 0),
        avg_marks: Number(marks?.avg_marks || 0).toFixed(2),
        avg_percentage: Number(marks?.avg_percentage || 0).toFixed(2)
      };
    });
    res.json({
      counters: {
        curriculum_rows: Number(curriculumCountRows[0]?.total || 0),
        learning_materials: Number(materialCountRows[0]?.total || 0),
        generated_exams: Number(examCountRows[0]?.total || 0),
        marks_records: Number(marksCountRows[0]?.total || 0),
        assessed_learners: Number(learnerCountRows[0]?.total || 0),
        mean_marks: Number(meanRows[0]?.mean_marks || 0).toFixed(2)
      },
      by_learning_area: byLearningArea
    });
  })
);

app.post(
  "/api/examinations/ai-copilot/recommendations",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const grade = cleanOptionalValue(req.body?.grade);
    const formName = cleanOptionalValue(req.body?.form_name);
    const learningArea = cleanOptionalValue(req.body?.learning_area);
    const scopedLevel = cleanValue(grade || formName || "");
    const [curriculumRows, examRows, marksRows, lowBandRows] = await Promise.all([
      query(
        `SELECT COUNT(*) AS total
         FROM cbc_curriculum_entries
         WHERE institution_id = ?
           AND (? = '' OR grade = ?)
           AND (? = '' OR form_name = ?)
           AND (? = '' OR learning_area = ?)`,
        [institutionId, cleanValue(grade), cleanValue(grade), cleanValue(formName), cleanValue(formName), cleanValue(learningArea), cleanValue(learningArea)]
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM academic_exams
         WHERE institution_id = ?
           AND (? = '' OR grade = ?)
           AND (? = '' OR subject = ?)`,
        [institutionId, scopedLevel, scopedLevel, cleanValue(learningArea), cleanValue(learningArea)]
      ),
      query(
        `SELECT COUNT(*) AS total, ROUND(AVG(percentage), 2) AS avg_percentage
         FROM academic_marks
         WHERE institution_id = ?
           AND (? = '' OR grade = ?)
           AND (? = '' OR subject = ?)`,
        [institutionId, scopedLevel, scopedLevel, cleanValue(learningArea), cleanValue(learningArea)]
      ),
      query(
        `SELECT subject, COUNT(*) AS total
         FROM academic_marks
         WHERE institution_id = ?
           AND cbc_grade_band IN ('BE', 'ABSENT')
           AND (? = '' OR grade = ?)
         GROUP BY subject
         ORDER BY total DESC
         LIMIT 8`,
        [institutionId, scopedLevel, scopedLevel]
      )
    ]);
    const curriculumCount = Number(curriculumRows[0]?.total || 0);
    const generatedExamCount = Number(examRows[0]?.total || 0);
    const marksCount = Number(marksRows[0]?.total || 0);
    const avgPct = Number(marksRows[0]?.avg_percentage || 0);
    const actions = [];
    if (curriculumCount < 20) {
      actions.push("Curriculum coverage is low for selected scope. Import strands/sub-strands first.");
    }
    if (generatedExamCount === 0) {
      actions.push("No generated exams found. Use Exam Generation to create at least one structured paper.");
    }
    if (marksCount === 0) {
      actions.push("No marks records found. Use Exam Entry to unlock scripts and progression analytics.");
    }
    if (marksCount > 0 && avgPct < 45) {
      actions.push("Average performance is below 45%. Prioritize remediation plans and targeted revision papers.");
    }
    if (Array.isArray(lowBandRows) && lowBandRows.length) {
      actions.push(`Focus intervention learning areas: ${lowBandRows.map((row) => cleanValue(row.subject)).filter(Boolean).join(", ")}.`);
    }
    if (!actions.length) {
      actions.push("Data quality and performance posture look stable. Proceed with archive + compliance reporting cycle.");
    }
    res.json({
      scope: {
        grade: grade || null,
        form_name: formName || null,
        learning_area: learningArea || null
      },
      metrics: {
        curriculum_rows: curriculumCount,
        generated_exams: generatedExamCount,
        marks_rows: marksCount,
        avg_percentage: avgPct
      },
      ai_actions: actions,
      intervention_subjects: lowBandRows
    });
  })
);

app.get(
  "/api/examinations/gradebook/overview",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const filters = readExamFilterInputs(req.query);
    const baseParams = [
      institutionId,
      filters.classFilter,
      filters.classFilter,
      filters.stream,
      filters.stream,
      filters.term,
      filters.term,
      filters.year,
      filters.year
    ];
    const [summaryRows, learnerRows, bandRows, detailedRows] = await Promise.all([
      query(
        `SELECT subject,
                COUNT(*) AS total_entries,
                ROUND(AVG(marks), 2) AS avg_marks,
                ROUND(AVG(percentage), 2) AS avg_percentage
         FROM academic_marks
         WHERE institution_id = ?
           AND (? = '' OR grade = ?)
           AND (? = '' OR stream = ?)
           AND (? = '' OR term = ?)
           AND (? IS NULL OR year = ?)
         GROUP BY subject
         ORDER BY subject ASC`,
        baseParams
      ),
      query(
        `SELECT learner_id,
                learner_name,
                grade,
                stream,
                ROUND(AVG(percentage), 2) AS mean_percentage,
                ROUND(SUM(marks), 2) AS total_marks,
                COUNT(*) AS subject_count
         FROM academic_marks
         WHERE institution_id = ?
           AND (? = '' OR grade = ?)
           AND (? = '' OR stream = ?)
           AND (? = '' OR term = ?)
           AND (? IS NULL OR year = ?)
         GROUP BY learner_id, learner_name, grade, stream
         ORDER BY mean_percentage DESC, learner_name ASC
         LIMIT 600`,
        baseParams
      ),
      query(
        `SELECT cbc_grade_band,
                COUNT(*) AS total
         FROM academic_marks
         WHERE institution_id = ?
           AND (? = '' OR grade = ?)
           AND (? = '' OR stream = ?)
           AND (? = '' OR term = ?)
           AND (? IS NULL OR year = ?)
         GROUP BY cbc_grade_band
         ORDER BY total DESC`,
        baseParams
      ),
      query(
        `SELECT learner_id,
                learner_name,
                grade,
                stream,
                exam_type,
                subject,
                marks,
                percentage,
                cbc_grade_band,
                term,
                year,
                updated_at
         FROM academic_marks
         WHERE institution_id = ?
           AND (? = '' OR grade = ?)
           AND (? = '' OR stream = ?)
           AND (? = '' OR term = ?)
           AND (? IS NULL OR year = ?)
         ORDER BY updated_at DESC
         LIMIT 1200`,
        baseParams
      )
    ]);
    res.json({
      filters,
      totals: {
        subjects: summaryRows.length,
        learners: learnerRows.length,
        marks_rows: detailedRows.length
      },
      by_subject: summaryRows.map((row) => ({
        subject: cleanValue(row.subject),
        total_entries: Number(row.total_entries || 0),
        avg_marks: Number(row.avg_marks || 0),
        avg_percentage: Number(row.avg_percentage || 0)
      })),
      learner_gradebook: learnerRows.map((row) => ({
        learner_id: Number(row.learner_id || 0),
        learner_name: cleanValue(row.learner_name),
        grade: cleanValue(row.grade),
        stream: cleanValue(row.stream),
        mean_percentage: Number(row.mean_percentage || 0),
        total_marks: Number(row.total_marks || 0),
        subject_count: Number(row.subject_count || 0)
      })),
      competency_distribution: bandRows.map((row) => ({
        cbc_grade_band: cleanValue(row.cbc_grade_band || "UNSET"),
        total: Number(row.total || 0)
      })),
      rows: detailedRows
    });
  })
);

app.get(
  "/api/examinations/assessment-tracking/overview",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const filters = readExamFilterInputs(req.query);
    const params = [
      institutionId,
      filters.classFilter,
      filters.classFilter,
      filters.stream,
      filters.stream,
      filters.term,
      filters.term,
      filters.year,
      filters.year
    ];
    const [learnerTrackingRows, subjectTrackingRows, atRiskRows, examTypeRows] = await Promise.all([
      query(
        `SELECT learner_id,
                learner_name,
                grade,
                stream,
                COUNT(*) AS assessments_done,
                ROUND(AVG(percentage), 2) AS avg_percentage,
                ROUND(MAX(percentage), 2) AS best_percentage,
                ROUND(MIN(percentage), 2) AS lowest_percentage,
                SUM(CASE WHEN cbc_grade_band = 'ABSENT' THEN 1 ELSE 0 END) AS absent_count
         FROM academic_marks
         WHERE institution_id = ?
           AND (? = '' OR grade = ?)
           AND (? = '' OR stream = ?)
           AND (? = '' OR term = ?)
           AND (? IS NULL OR year = ?)
         GROUP BY learner_id, learner_name, grade, stream
         ORDER BY avg_percentage DESC, learner_name ASC
         LIMIT 800`,
        params
      ),
      query(
        `SELECT subject,
                COUNT(*) AS total_assessments,
                ROUND(AVG(percentage), 2) AS avg_percentage,
                SUM(CASE WHEN cbc_grade_band IN ('EE', 'ME') THEN 1 ELSE 0 END) AS proficient_count,
                SUM(CASE WHEN cbc_grade_band IN ('BE', 'ABSENT') THEN 1 ELSE 0 END) AS intervention_count
         FROM academic_marks
         WHERE institution_id = ?
           AND (? = '' OR grade = ?)
           AND (? = '' OR stream = ?)
           AND (? = '' OR term = ?)
           AND (? IS NULL OR year = ?)
         GROUP BY subject
         ORDER BY subject ASC`,
        params
      ),
      query(
        `SELECT learner_id,
                learner_name,
                grade,
                stream,
                ROUND(AVG(percentage), 2) AS avg_percentage,
                COUNT(*) AS rows_count
         FROM academic_marks
         WHERE institution_id = ?
           AND (? = '' OR grade = ?)
           AND (? = '' OR stream = ?)
           AND (? = '' OR term = ?)
           AND (? IS NULL OR year = ?)
         GROUP BY learner_id, learner_name, grade, stream
         HAVING AVG(percentage) < 40
         ORDER BY avg_percentage ASC
         LIMIT 200`,
        params
      ),
      query(
        `SELECT exam_type,
                COUNT(*) AS total_entries,
                ROUND(AVG(percentage), 2) AS avg_percentage
         FROM academic_marks
         WHERE institution_id = ?
           AND (? = '' OR grade = ?)
           AND (? = '' OR stream = ?)
           AND (? = '' OR term = ?)
           AND (? IS NULL OR year = ?)
         GROUP BY exam_type
         ORDER BY total_entries DESC, exam_type ASC`,
        params
      )
    ]);
    res.json({
      filters,
      learner_tracking: learnerTrackingRows,
      by_subject: subjectTrackingRows,
      by_exam_type: examTypeRows,
      intervention_watchlist: atRiskRows
    });
  })
);

app.get(
  "/api/examinations/portals/overview",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const [learnerTotalsRows, assessedRows, parentMessageRows, topRows] = await Promise.all([
      query(
        `SELECT COUNT(*) AS total_learners,
                SUM(CASE WHEN COALESCE(parent_phone, '') <> '' OR COALESCE(parent_email, '') <> '' OR COALESCE(parent_full_name, '') <> '' THEN 1 ELSE 0 END) AS learners_with_parent_profile
         FROM learners
         WHERE institution_id = ?`,
        [institutionId]
      ),
      query(
        `SELECT COUNT(DISTINCT learner_id) AS assessed_learners
         FROM academic_marks
         WHERE institution_id = ?`,
        [institutionId]
      ),
      query(
        `SELECT status, COUNT(*) AS total
         FROM communication_messages
         WHERE institution_id = ?
           AND UPPER(COALESCE(recipient_role, '')) IN ('PARENT', 'PARENT/GUARDIAN', 'LEARNER', 'STUDENT')
         GROUP BY status
         ORDER BY total DESC`,
        [institutionId]
      ),
      query(
        `SELECT m.learner_id,
                m.learner_name,
                l.admission_number,
                l.grade,
                l.stream,
                ROUND(AVG(m.percentage), 2) AS avg_percentage,
                COUNT(*) AS exams_done
         FROM academic_marks m
         LEFT JOIN learners l ON l.id = m.learner_id AND l.institution_id = m.institution_id
         WHERE m.institution_id = ?
         GROUP BY m.learner_id, m.learner_name, l.admission_number, l.grade, l.stream
         ORDER BY avg_percentage DESC, exams_done DESC
         LIMIT 15`,
        [institutionId]
      )
    ]);
    const totalLearners = Number(learnerTotalsRows[0]?.total_learners || 0);
    const learnersWithParentProfile = Number(learnerTotalsRows[0]?.learners_with_parent_profile || 0);
    const assessedLearners = Number(assessedRows[0]?.assessed_learners || 0);
    const parentEngagementRate = totalLearners > 0
      ? Number(((learnersWithParentProfile / totalLearners) * 100).toFixed(2))
      : 0;
    const learnerPortalCoverageRate = totalLearners > 0
      ? Number(((assessedLearners / totalLearners) * 100).toFixed(2))
      : 0;
    res.json({
      counters: {
        total_learners: totalLearners,
        learners_with_parent_profile: learnersWithParentProfile,
        assessed_learners: assessedLearners,
        parent_engagement_rate_pct: parentEngagementRate,
        learner_portal_coverage_rate_pct: learnerPortalCoverageRate
      },
      communication_status: parentMessageRows.map((row) => ({
        status: cleanValue(row.status || "Queued"),
        total: Number(row.total || 0)
      })),
      learner_portal_feed: topRows
    });
  })
);

app.get(
  "/api/examinations/compliance/overview",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const [learnerRows, markRows, curriculumRows, missingRows] = await Promise.all([
      query(
        `SELECT COUNT(*) AS total_learners,
                SUM(CASE WHEN COALESCE(admission_number, '') <> '' THEN 1 ELSE 0 END) AS admission_ready,
                SUM(CASE WHEN COALESCE(upi_number, '') <> '' THEN 1 ELSE 0 END) AS upi_ready,
                SUM(CASE WHEN COALESCE(birth_certificate_number, '') <> '' THEN 1 ELSE 0 END) AS birth_cert_ready,
                SUM(CASE WHEN COALESCE(parent_phone, '') <> '' OR COALESCE(parent_email, '') <> '' THEN 1 ELSE 0 END) AS contact_ready
         FROM learners
         WHERE institution_id = ?`,
        [institutionId]
      ),
      query(
        `SELECT COUNT(*) AS total_marks,
                SUM(CASE WHEN COALESCE(exam_type, '') <> '' THEN 1 ELSE 0 END) AS exam_type_ready,
                SUM(CASE WHEN COALESCE(term, '') <> '' THEN 1 ELSE 0 END) AS term_ready,
                SUM(CASE WHEN year IS NOT NULL THEN 1 ELSE 0 END) AS year_ready,
                SUM(CASE WHEN COALESCE(cbc_grade_band, '') <> '' THEN 1 ELSE 0 END) AS competency_ready
         FROM academic_marks
         WHERE institution_id = ?`,
        [institutionId]
      ),
      query(
        `SELECT COUNT(*) AS curriculum_rows,
                COUNT(DISTINCT learning_area) AS mapped_learning_areas,
                COUNT(DISTINCT grade) AS mapped_grades
         FROM cbc_curriculum_entries
         WHERE institution_id = ?`,
        [institutionId]
      ),
      query(
        `SELECT l.id,
                l.full_name,
                l.admission_number,
                l.grade,
                l.stream
         FROM learners l
         LEFT JOIN academic_marks m
           ON m.learner_id = l.id
          AND m.institution_id = l.institution_id
         WHERE l.institution_id = ?
         GROUP BY l.id, l.full_name, l.admission_number, l.grade, l.stream
         HAVING COUNT(m.id) = 0
         ORDER BY l.full_name ASC
         LIMIT 300`,
        [institutionId]
      )
    ]);
    const learnerStats = learnerRows[0] || {};
    const markStats = markRows[0] || {};
    const curriculumStats = curriculumRows[0] || {};
    const totalLearners = Number(learnerStats.total_learners || 0);
    const totalMarks = Number(markStats.total_marks || 0);
    const pct = (value, total) => (total > 0 ? Number(((Number(value || 0) / total) * 100).toFixed(2)) : 0);
    res.json({
      coverage: {
        learner_registry: {
          total: totalLearners,
          admission_ready_pct: pct(learnerStats.admission_ready, totalLearners),
          upi_ready_pct: pct(learnerStats.upi_ready, totalLearners),
          birth_cert_ready_pct: pct(learnerStats.birth_cert_ready, totalLearners),
          contact_ready_pct: pct(learnerStats.contact_ready, totalLearners)
        },
        marks_registry: {
          total: totalMarks,
          exam_type_ready_pct: pct(markStats.exam_type_ready, totalMarks),
          term_ready_pct: pct(markStats.term_ready, totalMarks),
          year_ready_pct: pct(markStats.year_ready, totalMarks),
          competency_ready_pct: pct(markStats.competency_ready, totalMarks)
        },
        curriculum_registry: {
          curriculum_rows: Number(curriculumStats.curriculum_rows || 0),
          mapped_learning_areas: Number(curriculumStats.mapped_learning_areas || 0),
          mapped_grades: Number(curriculumStats.mapped_grades || 0)
        }
      },
      learners_without_assessment: missingRows
    });
  })
);

app.get(
  "/api/examinations/lifecycle/timeline",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const learnerId = Number(req.query?.learner_id || 0) || null;
    const [examEvents, markEvents, archiveEvents, templateEvents, totals] = await Promise.all([
      query(
        `SELECT id,
                title,
                subject,
                grade,
                stream,
                term,
                year,
                created_at
         FROM academic_exams
         WHERE institution_id = ?
         ORDER BY created_at DESC
         LIMIT 300`,
        [institutionId]
      ),
      query(
        `SELECT id,
                learner_id,
                learner_name,
                subject,
                exam_type,
                grade,
                stream,
                term,
                year,
                percentage,
                updated_at
         FROM academic_marks
         WHERE institution_id = ?
           AND (? IS NULL OR learner_id = ?)
         ORDER BY updated_at DESC
         LIMIT 1200`,
        [institutionId, learnerId, learnerId]
      ),
      query(
        `SELECT id,
                archive_type,
                title,
                status,
                archived_at
         FROM exam_archives
         WHERE institution_id = ?
         ORDER BY archived_at DESC
         LIMIT 300`,
        [institutionId]
      ),
      query(
        `SELECT id,
                template_key,
                template_name,
                version_tag,
                created_at,
                updated_at
         FROM exam_templates
         WHERE institution_id = ?
           AND is_active = 1
         ORDER BY updated_at DESC
         LIMIT 200`,
        [institutionId]
      ),
      query(
        `SELECT
          (SELECT COUNT(*) FROM cbc_curriculum_entries WHERE institution_id = ?) AS curriculum_rows,
          (SELECT COUNT(*) FROM academic_exams WHERE institution_id = ?) AS generated_exams,
          (SELECT COUNT(*) FROM academic_marks WHERE institution_id = ?) AS marks_rows,
          (SELECT COUNT(*) FROM exam_archives WHERE institution_id = ?) AS archived_rows`,
        [institutionId, institutionId, institutionId, institutionId]
      )
    ]);
    const timelineRows = [
      ...examEvents.map((row) => ({
        event_type: "EXAM_GENERATED",
        entity_type: "academic_exams",
        entity_id: Number(row.id || 0),
        title: cleanValue(row.title || row.subject || "Generated exam"),
        details: {
          subject: cleanValue(row.subject),
          level: cleanValue(row.grade),
          stream: cleanValue(row.stream),
          term: cleanValue(row.term),
          year: Number(row.year || 0) || null
        },
        occurred_at: row.created_at
      })),
      ...markEvents.map((row) => ({
        event_type: "MARK_ENTRY",
        entity_type: "academic_marks",
        entity_id: Number(row.id || 0),
        title: `${cleanValue(row.learner_name || "Learner")} · ${cleanValue(row.subject || "Learning Area")}`,
        details: {
          learner_id: Number(row.learner_id || 0),
          exam_type: cleanValue(row.exam_type),
          level: cleanValue(row.grade),
          stream: cleanValue(row.stream),
          term: cleanValue(row.term),
          year: Number(row.year || 0) || null,
          percentage: Number(row.percentage || 0)
        },
        occurred_at: row.updated_at
      })),
      ...archiveEvents.map((row) => ({
        event_type: "ARCHIVE_EVENT",
        entity_type: "exam_archives",
        entity_id: Number(row.id || 0),
        title: cleanValue(row.title || row.archive_type || "Archive event"),
        details: {
          archive_type: cleanValue(row.archive_type),
          status: cleanValue(row.status)
        },
        occurred_at: row.archived_at
      })),
      ...templateEvents.map((row) => ({
        event_type: "TEMPLATE_UPDATE",
        entity_type: "exam_templates",
        entity_id: Number(row.id || 0),
        title: `${cleanValue(row.template_name || "Template")} ${cleanValue(row.version_tag || "")}`.trim(),
        details: {
          template_key: cleanValue(row.template_key),
          version_tag: cleanValue(row.version_tag)
        },
        occurred_at: row.updated_at || row.created_at
      }))
    ]
      .filter((row) => row.occurred_at)
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
      .slice(0, 1500);
    const counter = totals[0] || {};
    const recommendations = [];
    if (Number(counter.curriculum_rows || 0) < 25) {
      recommendations.push("Curriculum coverage is low. Import strands/sub-strands before bulk exam generation.");
    }
    if (Number(counter.generated_exams || 0) === 0) {
      recommendations.push("No generated exams yet. Use Exam Generation to create term exam templates for each learning area.");
    }
    if (Number(counter.marks_rows || 0) === 0) {
      recommendations.push("No marks registered. Use Exam Entry to feed marks and unlock assessment/progress reporting.");
    }
    if (Number(counter.archived_rows || 0) === 0) {
      recommendations.push("No archives yet. Archive completed exam cycles for audit and compliance traceability.");
    }
    res.json({
      filters: { learner_id: learnerId },
      counters: {
        curriculum_rows: Number(counter.curriculum_rows || 0),
        generated_exams: Number(counter.generated_exams || 0),
        marks_rows: Number(counter.marks_rows || 0),
        archived_rows: Number(counter.archived_rows || 0)
      },
      recommendations,
      timeline: timelineRows
    });
  })
);

app.get(
  "/api/examinations/templates",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT id, template_key, template_name, version_tag, content, is_active, created_at, updated_at
       FROM exam_templates
       WHERE institution_id = ? AND is_active = 1
       ORDER BY updated_at DESC, id DESC`,
      [req.user.institution_id]
    );
    res.json(rows);
  })
);

app.post(
  "/api/examinations/templates",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const templateKey = normalizeExamTemplateKey(req.body?.template_key);
    const templateName = cleanValue(req.body?.template_name || "").slice(0, MAX_EXAM_TEMPLATE_NAME_LENGTH);
    const content = cleanValue(req.body?.content || "").slice(0, MAX_EXAM_TEMPLATE_CONTENT_LENGTH);
    if (!templateName || !content) {
      return res.status(400).json({ error: "template_name and content are required." });
    }
    if (cleanValue(req.body?.content || "").length > MAX_EXAM_TEMPLATE_CONTENT_LENGTH) {
      return res.status(400).json({ error: `template content exceeds ${MAX_EXAM_TEMPLATE_CONTENT_LENGTH} characters.` });
    }
    const result = await query(
      `INSERT INTO exam_templates
        (institution_id, template_key, template_name, version_tag, content, is_active, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [
        req.user.institution_id,
        templateKey,
        templateName,
        cleanOptionalValue(req.body?.version_tag),
        content,
        String(req.user.id || "")
      ]
    );
    await auditLog(req.user, "CREATE_EXAM_TEMPLATE", "exam_templates", result.insertId, {
      template_key: templateKey,
      template_name: templateName
    });
    res.status(201).json({ id: result.insertId, message: "Exam template saved." });
  })
);

app.put(
  "/api/examinations/templates/:id(\\d+)",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const templateId = Number(req.params.id || 0);
    if (!templateId) return res.status(400).json({ error: "Valid template id is required." });
    const templateKey = normalizeExamTemplateKey(req.body?.template_key);
    const templateName = cleanValue(req.body?.template_name || "").slice(0, MAX_EXAM_TEMPLATE_NAME_LENGTH);
    const content = cleanValue(req.body?.content || "").slice(0, MAX_EXAM_TEMPLATE_CONTENT_LENGTH);
    if (!templateName || !content) {
      return res.status(400).json({ error: "template_name and content are required." });
    }
    if (cleanValue(req.body?.content || "").length > MAX_EXAM_TEMPLATE_CONTENT_LENGTH) {
      return res.status(400).json({ error: `template content exceeds ${MAX_EXAM_TEMPLATE_CONTENT_LENGTH} characters.` });
    }
    await query(
      `UPDATE exam_templates
       SET template_key = ?, template_name = ?, version_tag = ?, content = ?, updated_at = NOW()
       WHERE id = ? AND institution_id = ? AND is_active = 1`,
      [
        templateKey,
        templateName,
        cleanOptionalValue(req.body?.version_tag),
        content,
        templateId,
        req.user.institution_id
      ]
    );
    await auditLog(req.user, "UPDATE_EXAM_TEMPLATE", "exam_templates", templateId, {
      template_key: templateKey,
      template_name: templateName
    });
    res.json({ message: "Exam template updated." });
  })
);

app.delete(
  "/api/examinations/templates/:id(\\d+)",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.DELETE),
  asyncHandler(async (req, res) => {
    const templateId = Number(req.params.id || 0);
    if (!templateId) return res.status(400).json({ error: "Valid template id is required." });
    await query(
      `UPDATE exam_templates
       SET is_active = 0, updated_at = NOW()
       WHERE id = ? AND institution_id = ?`,
      [templateId, req.user.institution_id]
    );
    await auditLog(req.user, "DELETE_EXAM_TEMPLATE", "exam_templates", templateId, {});
    res.json({ message: "Exam template removed." });
  })
);

app.post(
  "/api/examinations/templates/:id(\\d+)/clone",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const templateId = Number(req.params.id || 0);
    if (!templateId) return res.status(400).json({ error: "Valid template id is required." });
    const rows = await query(
      `SELECT template_key, template_name, version_tag, content
       FROM exam_templates
       WHERE id = ? AND institution_id = ? AND is_active = 1
       LIMIT 1`,
      [templateId, req.user.institution_id]
    );
    if (!rows.length) return res.status(404).json({ error: "Template not found." });
    const source = rows[0];
    const result = await query(
      `INSERT INTO exam_templates
        (institution_id, template_key, template_name, version_tag, content, is_active, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [
        req.user.institution_id,
        source.template_key,
        `${cleanValue(source.template_name)} (Clone)`,
        cleanOptionalValue(source.version_tag),
        cleanValue(source.content),
        String(req.user.id || "")
      ]
    );
    await auditLog(req.user, "CLONE_EXAM_TEMPLATE", "exam_templates", result.insertId, { source_template_id: templateId });
    res.status(201).json({ id: result.insertId, message: "Template cloned." });
  })
);

app.get(
  "/api/examinations/archives",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const statusFilter = cleanValue(req.query?.status || "").toUpperCase();
    const rows = await query(
      `SELECT id, archive_type, title, reference_id, payload_json, status, archived_at, updated_at
       FROM exam_archives
       WHERE institution_id = ?
         AND (? = '' OR status = ?)
       ORDER BY archived_at DESC, id DESC
       LIMIT 1500`,
      [req.user.institution_id, statusFilter, statusFilter]
    );
    res.json(rows.map((row) => ({ ...row, payload_json: parseStoredJson(row.payload_json) || null })));
  })
);

app.post(
  "/api/examinations/archives",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const archiveType = cleanValue(req.body?.archive_type || "");
    const title = cleanValue(req.body?.title || "");
    if (!archiveType || !title) {
      return res.status(400).json({ error: "archive_type and title are required." });
    }
    const result = await query(
      `INSERT INTO exam_archives
        (institution_id, archive_type, title, reference_id, payload_json, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.institution_id,
        archiveType,
        title,
        Number(req.body?.reference_id || 0) || null,
        req.body?.payload_json === undefined ? null : JSON.stringify(req.body?.payload_json),
        normalizeArchiveStatus(req.body?.status || "ARCHIVED"),
        String(req.user.id || "")
      ]
    );
    await auditLog(req.user, "ARCHIVE_EXAM_ITEM", "exam_archives", result.insertId, { archive_type: archiveType, title });
    res.status(201).json({ id: result.insertId, message: "Archive item saved." });
  })
);

app.patch(
  "/api/examinations/archives/:id(\\d+)",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const archiveId = Number(req.params.id || 0);
    if (!archiveId) return res.status(400).json({ error: "Valid archive id is required." });
    const updates = [];
    const params = [];
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "status")) {
      updates.push("status = ?");
      params.push(normalizeArchiveStatus(req.body?.status));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "title")) {
      updates.push("title = ?");
      params.push(cleanValue(req.body?.title || ""));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "payload_json")) {
      updates.push("payload_json = ?");
      params.push(req.body?.payload_json === null ? null : JSON.stringify(req.body?.payload_json));
    }
    if (!updates.length) {
      return res.status(400).json({ error: "No archive update fields supplied." });
    }
    await query(
      `UPDATE exam_archives
       SET ${updates.join(", ")}, updated_at = NOW()
       WHERE id = ? AND institution_id = ?`,
      [...params, archiveId, req.user.institution_id]
    );
    await auditLog(req.user, "UPDATE_EXAM_ARCHIVE", "exam_archives", archiveId, pickFields(req.body || {}, ["status", "title"]));
    res.json({ message: "Archive item updated." });
  })
);

app.get(
  "/api/examinations/settings",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT settings_json
       FROM exam_module_settings
       WHERE institution_id = ?
       LIMIT 1`,
      [req.user.institution_id]
    );
    const stored = parseStoredJson(rows[0]?.settings_json) || {};
    res.json({ settings: { ...EXAM_SETTINGS_DEFAULTS, ...stored } });
  })
);

app.put(
  "/api/examinations/settings",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
  enforcePermission(PERMISSIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const incoming = req.body && typeof req.body === "object" ? req.body : {};
    const settings = {
      auto_save_enabled: parseTruthy(incoming.auto_save_enabled),
      auto_save_interval_sec: Math.min(Math.max(Number(incoming.auto_save_interval_sec || 90), 10), 900),
      strict_cbc_validation: parseTruthy(incoming.strict_cbc_validation),
      background_processing_enabled: parseTruthy(incoming.background_processing_enabled),
      realtime_sync_enabled: parseTruthy(incoming.realtime_sync_enabled),
      offline_cache_enabled: parseTruthy(incoming.offline_cache_enabled)
    };
    const payload = JSON.stringify(settings);
    const existing = await query(
      `SELECT id
       FROM exam_module_settings
       WHERE institution_id = ?
       LIMIT 1`,
      [req.user.institution_id]
    );
    if (existing.length) {
      await query(
        `UPDATE exam_module_settings
         SET settings_json = ?, updated_by_user_id = ?, updated_at = NOW()
         WHERE institution_id = ?`,
        [payload, String(req.user.id || ""), req.user.institution_id]
      );
    } else {
      await query(
        `INSERT INTO exam_module_settings
          (institution_id, settings_json, updated_by_user_id)
         VALUES (?, ?, ?)`,
        [req.user.institution_id, payload, String(req.user.id || "")]
      );
    }
    await auditLog(req.user, "UPDATE_EXAM_SETTINGS", "exam_module_settings", null, settings);
    res.json({ message: "Examination settings saved.", settings });
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

// === rev44: Institutional Letters (view + generate) ===
app.get(
  "/api/hr/institutional-letters",
  auth,
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const role = normalizeRole(req.user.role);
    const scopeSelf = ![
      ROLES.SUPER_SYSTEM_DEVELOPER,
      ROLES.SYSTEM_DEVELOPER,
      ROLES.SYSTEM_ADMINISTRATOR,
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION
    ].includes(role);
    const rows = scopeSelf
      ? await query(
          `SELECT id, record_type, title, target_staff_name, terms_of_service, position_name, status, issued_at, created_at
           FROM hr_institutional_letters
           WHERE institution_id = ? AND target_user_id = ?
           ORDER BY COALESCE(issued_at, created_at) DESC`,
          [institutionId, req.user.id]
        )
      : await query(
          `SELECT id, record_type, title, target_staff_name, target_staff_category, position_name,
                  terms_of_service, status, issued_at, created_at, target_user_id
           FROM hr_institutional_letters
           WHERE institution_id = ?
           ORDER BY COALESCE(issued_at, created_at) DESC`,
          [institutionId]
        );
    res.json({ rows });
  })
);

app.post(
  "/api/hr/institutional-letters",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const b = req.body || {};
    const record_type = cleanValue(b.record_type || "");
    if (!record_type) return res.status(400).json({ error: "record_type is required." });
    const result = await query(
      `INSERT INTO hr_institutional_letters
        (institution_id, record_type, title, target_user_id, target_staff_name, target_staff_category,
         target_id_number, target_mobile, target_email, terms_of_service, position_name, description, body_text,
         file_path, status, created_by_user_id, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        institutionId,
        record_type,
        cleanValue(b.title || ""),
        Number(b.target_user_id || 0) || null,
        cleanValue(b.target_staff_name || ""),
        cleanValue(b.target_staff_category || ""),
        cleanValue(b.target_id_number || ""),
        cleanValue(b.target_mobile || ""),
        cleanValue(b.target_email || ""),
        cleanValue(b.terms_of_service || ""),
        cleanValue(b.position_name || ""),
        cleanValue(b.description || ""),
        cleanValue(b.body_text || ""),
        cleanValue(b.file_path || ""),
        cleanValue(b.status || "Issued"),
        String(req.user.id || ""),
        b.issued_at ? cleanValue(b.issued_at) : dayjs().format("YYYY-MM-DD HH:mm:ss")
      ]
    );
    await auditLog(req.user, "GENERATE_LETTER", "hr_institutional_letters", result.insertId, { record_type });
    res.status(201).json({ id: result.insertId, message: "Letter saved." });
  })
);

// === rev44: Fee Status per learner (roll-up of fee structure vs payments) ===
app.get(
  "/api/finance/fee-status",
  auth,
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const grade = cleanValue(req.query?.grade || "");
    const stream = cleanValue(req.query?.stream || "");
    const year = Number(req.query?.year || new Date().getFullYear());
    const role = normalizeRole(req.user.role);
    let learnerFilter = "";
    const params = [institutionId];
    if (role === ROLES.PARENT || role === ROLES.LEARNER) {
      learnerFilter = " AND l.id = ?";
      params.push(Number(req.user.learner_id || 0));
    } else {
      if (grade) { learnerFilter += " AND l.grade = ?"; params.push(grade); }
      if (stream) { learnerFilter += " AND l.stream = ?"; params.push(stream); }
    }
    const rows = await query(
      `SELECT
         l.id AS learner_id,
         l.full_name,
         l.admission_number,
         l.grade,
         l.stream,
         COALESCE((SELECT SUM(amount_required) FROM finance_fee_structures
                   WHERE institution_id = l.institution_id
                     AND grade = l.grade
                     AND (stream = l.stream OR stream IS NULL OR stream = '')
                     AND year = ?), 0) AS required,
         COALESCE((SELECT SUM(amount_paid) FROM finance_fee_payments
                   WHERE institution_id = l.institution_id
                     AND learner_id = l.id), 0) AS paid
       FROM learners l
       WHERE l.institution_id = ? ${learnerFilter}
       ORDER BY l.full_name ASC`,
      [year, ...params]
    );
    const balance = rows.map((r) => ({
      ...r,
      required: Number(r.required || 0),
      paid: Number(r.paid || 0),
      balance: Number(r.required || 0) - Number(r.paid || 0)
    }));
    res.json({ year, grade, stream, balance });
  })
);

// === rev44: Procurement document QR code (returns data URL PNG) ===
app.get(
  "/api/finance/procurement/:id/qr.png",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const id = Number(req.params.id || 0);
    const rows = await query(
      `SELECT * FROM finance_procurement_records WHERE id = ? AND institution_id = ? LIMIT 1`,
      [id, institutionId]
    );
    if (!rows.length) return res.status(404).json({ error: "Procurement record not found." });
    const row = rows[0];
    const payload = [
      `IMIS Procurement QR`,
      `Institution ID: ${institutionId}`,
      `Document: ${row.document_type || "-"}`,
      `Reference: ${row.document_number || row.reference_number || row.id}`,
      `Supplier: ${row.supplier_name || "-"}`,
      `Amount: ${row.amount || 0}`,
      `Due: ${row.due_date || "-"}`,
      `Issued: ${row.issue_date || row.created_at}`
    ].join("\n");
    try {
      const QRCode = require("qrcode");
      const buf = await QRCode.toBuffer(payload, { type: "png", margin: 1, width: 260 });
      res.set("Content-Type", "image/png");
      res.set("Cache-Control", "no-store");
      return res.send(buf);
    } catch (err) {
      return res.status(500).json({ error: "QR generation failed: " + (err?.message || "unknown") });
    }
  })
);

// === rev44: Institutional registers & records (per document type) ===
const INSTITUTIONAL_REGISTER_TYPES = [
  "Registration certificate of the institution",
  "Institutions' books of accounts",
  "Registers of the institutions' movable and immovable assets",
  "Admissions registers",
  "Parents register",
  "Visitors books",
  "Daily attendance registers for learners",
  "Learners progress reports",
  "Register of learners' transfers, drop-out and completion",
  "School title deed / land allotment letter",
  "Register of disciplinary action taken against learners",
  "Inventory of instructional materials, stationery, equipment and assistive devices",
  "Syllabi",
  "Approved list of text books and other instructional material",
  "Other records recommended by the Education Standards Quality Assurance Council"
];

app.get(
  "/api/institutional-registers/types",
  auth,
  asyncHandler(async (_req, res) => {
    res.json({ types: INSTITUTIONAL_REGISTER_TYPES });
  })
);

app.get(
  "/api/institutional-registers",
  auth,
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const rows = await query(
      `SELECT id, register_type, title, description, file_path, file_name, created_at
       FROM institutional_registers
       WHERE institution_id = ?
       ORDER BY register_type ASC, id DESC`,
      [institutionId]
    );
    res.json({ rows });
  })
);

app.post(
  "/api/institutional-registers",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const b = req.body || {};
    const register_type = cleanValue(b.register_type || "");
    if (!register_type) return res.status(400).json({ error: "register_type is required (select it FIRST)." });
    const result = await query(
      `INSERT INTO institutional_registers
        (institution_id, register_type, title, description, file_path, file_name, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        institutionId,
        register_type,
        cleanValue(b.title || ""),
        cleanValue(b.description || ""),
        cleanValue(b.file_path || ""),
        cleanValue(b.file_name || ""),
        String(req.user.id || "")
      ]
    );
    await auditLog(req.user, "UPLOAD_REGISTER", "institutional_registers", result.insertId, { register_type });
    res.status(201).json({ id: result.insertId, message: "Register/record uploaded." });
  })
);

app.delete(
  "/api/institutional-registers/:id",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const id = Number(req.params.id || 0);
    const result = await query(
      `DELETE FROM institutional_registers WHERE id = ? AND institution_id = ?`,
      [id, institutionId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Record not found." });
    res.json({ message: "Register entry removed." });
  })
);

// === rev44: HR Leave "approved by different officer" guard ===
app.put(
  "/api/hr/leave-requests/:id/decide",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const id = Number(req.params.id || 0);
    const body = req.body || {};
    const decision = cleanValue(body.decision || "").toLowerCase();
    if (!["approved", "amended", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "decision must be approved, amended, or rejected." });
    }
    const rows = await query(
      `SELECT id, created_by FROM hr_leave_requests WHERE id = ? AND institution_id = ? LIMIT 1`,
      [id, institutionId]
    );
    if (!rows.length) return res.status(404).json({ error: "Leave application not found." });
    if (Number(rows[0].created_by) === Number(req.user.id)) {
      return res.status(403).json({ error: "A leave request cannot be approved by the same officer who applied." });
    }
    const nextStatus = decision === "approved" ? "Approved" : decision === "rejected" ? "Rejected" : "Approved";
    const amendedDays = decision === "amended" ? Number(body.amended_days || 0) || null : null;
    const comment = cleanValue(body.comment || "");
    await query(
      `UPDATE hr_leave_requests
       SET status = ?, approval_stage = 'Final', amended_days = ?, approval_comment = ?, approved_by_user_id = ?
       WHERE id = ? AND institution_id = ?`,
      [nextStatus, amendedDays, comment, String(req.user.id), id, institutionId]
    );
    await auditLog(req.user, "HR_LEAVE_DECIDE", "hr_leave_requests", id, { decision, amended_days: amendedDays });
    res.json({ message: `Leave ${decision}.`, id });
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
  "/api/communication/messages/recipient-preview",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const recipientRole = cleanValue(req.body?.recipient_role);
    if (!recipientRole) {
      return res.status(400).json({ error: "recipient_role is required." });
    }
    const contacts = await resolveCommunicationRecipients({
      institutionId: req.user.institution_id,
      recipientRole,
      recipientContact: ""
    });
    res.json({
      recipient_role: recipientRole,
      total_contacts: contacts.length,
      first_contact: contacts[0] || null,
      contacts: contacts.slice(0, 20)
    });
  })
);

app.get(
  "/api/communication/messages/recipient-preview",
  auth,
  enforceModuleAccess(MODULE_KEYS.COMMUNICATION_MESSAGES),
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const recipientRole = cleanValue(req.query?.recipient_role);
    if (!recipientRole) {
      return res.status(400).json({ error: "recipient_role is required." });
    }
    const contacts = await resolveCommunicationRecipients({
      institutionId: req.user.institution_id,
      recipientRole,
      recipientContact: ""
    });
    res.json({
      recipient_role: recipientRole,
      total_contacts: contacts.length,
      first_contact: contacts[0] || null,
      contacts: contacts.slice(0, 20)
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
