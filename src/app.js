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
  STAFF_SERVICE_PROVIDERS: "staff-service-providers",
  MANAGEMENT_BOM: "management-bom",
  MANAGEMENT_SERVICE_PROVIDERS: "management-service-providers",
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
  /** Dashboard cockpit tiles (fine-grained; default-gated HoI/Dev can widen per user overrides) */
  DASHBOARD_ALERTS_ANNOUNCEMENTS: "dashboard-alerts-announcements",
  DASHBOARD_ATTENDANCE_LIST: "dashboard-attendance-list",
  DASHBOARD_PERFORMANCE: "dashboard-performance",
  DASHBOARD_FEE_COLLECTION: "dashboard-fee-collection",
  DASHBOARD_OUTSTANDING_BALANCES: "dashboard-outstanding-balances",
  SEARCH: "search",
  PARENT_RESULTS: "parent-results",
  LEARNER_MATERIALS: "learner-materials",
  ADMISSION_REGISTER: "admission-register",
  ADMISSION_FORM: "admission-form",
  ADMISSION_LETTER: "admission-letter",
  ADMISSION_BIO_DATA_BULK_UPLOAD: "admission-bio-data-bulk-upload",
  ATTENDANCE_TEACHER_REGISTER: "attendance-teacher-register",
  ATTENDANCE_SUPPORT_STAFF_REGISTER: "attendance-support-staff-register",
  ATTENDANCE_LEARNER_REGISTER: "attendance-learner-register",
  STAFF_PROFILE_TEACHER: "staff-profile-teacher",
  STAFF_PROFILE_SUPPORT_STAFF: "staff-profile-support-staff",
  REGISTER_INSTITUTION: "register-institution",
  REGISTER_USERS: "register-users",
  SECURITY_LOGIN_AUDIT: "security-login-audit",
  INSTITUTION_LETTERHEAD_UPLOAD: "institution-letterhead-upload",
  INSTITUTION_UPLOADS: "institution-uploads",
  HR_INSTITUTIONAL_LETTERS: "hr-institutional-letters",
  FINANCE_FEE_STATUS: "finance-fee-status",
  INSTITUTIONAL_REGISTERS: "institutional-registers"
};

const DEFAULT_MODULE_ACCESS_BY_ROLE = {
  [ROLES.SUPER_SYSTEM_DEVELOPER]: Object.values(MODULE_KEYS),
  [ROLES.SYSTEM_DEVELOPER]: Object.values(MODULE_KEYS),
  [ROLES.SYSTEM_ADMINISTRATOR]: Object.values(MODULE_KEYS).filter((key) => key !== MODULE_KEYS.SECURITY_AUDIT),
  [ROLES.ADMIN]: Object.values(MODULE_KEYS).filter((key) => key !== MODULE_KEYS.SECURITY_AUDIT),
  [ROLES.HEAD_OF_INSTITUTION]: Object.values(MODULE_KEYS).filter(
    (key) => key !== MODULE_KEYS.SECURITY_AUDIT
  ),
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
  const exposeOtpPreview =
    isSuperSystemDeveloperLogin && (process.env.NODE_ENV !== "production" || parseTruthy(process.env.EXPOSE_OTP_PREVIEW));
  const loggedOtpDetails = await augmentAuthAuditDetailsWithInstitution(
    buildAuthAuditDetails(req, username, {
      password_correct: true,
      otp_correct: false,
      otp_channel_requested: requestedChannel,
      otp_channel_used: effectiveChannel,
      otp_channels_delivered: otpSession.sendResults || [],
      otp_expires_at: otpSession.expiresAt,
      otp_code: exposeOtpPreview ? otpSession.code : undefined
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

  const sendLog = otpSession.sendResults || [];
  const okSteps = sendLog.filter((line) => typeof line === "string" && line.endsWith(":ok"));
  const usedFallbackFromLogin = requestedChannel !== effectiveChannel && effectiveChannel === "console";
  const smsEmailPartial =
    requestedChannel === "sms_email" &&
    okSteps.length > 0 &&
    deliveryPlan?.channels?.length &&
    okSteps.length < deliveryPlan.channels.length;
  let messageBody = "OTP dispatched immediately. Check SMS and Email.";
  if (effectiveChannel === "console" || (sendLog.length && !okSteps.length)) {
    messageBody =
      "OTP queued for console fallback: configure SMTP/Twilio and ensure profile email/mobile; check server logs for the code.";
  } else if (smsEmailPartial) {
    messageBody =
      `OTP sent on ${okSteps.length} channel(s); another channel failed or is not configured — see delivery log below.`;
  } else if (usedFallbackFromLogin) {
    messageBody = `OTP delivered via console fallback. Configure SMTP (${process.env.SMTP_HOST ? "ok" : "missing"}) and Twilio (${process.env.TWILIO_ACCOUNT_SID ? "ok" : "missing"}) for instant email/SMS; ensure your profile has both email and mobile.`;
  }

  return res.json({
    message: messageBody,
    role: account.role,
    portal: toPortal(account.role),
    otp_channel: effectiveChannel,
    otp_channel_requested: requestedChannel,
    otp_channel_used: effectiveChannel,
    otp_delivery_log: otpSession.sendResults || [],
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
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
    const rowLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

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
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query?.limit || 200), 1), 1000);
    const institutionScope = canManageAcrossInstitutions(req.user)
      ? Number(req.query?.institution_id || 0)
      : req.user.institution_id;
    const whereClause = institutionScope ? "WHERE a.institution_id = ?" : "";
    const params = institutionScope ? [institutionScope] : [];
    const logs = await query(
      `SELECT a.id, a.institution_id, i.institution_code AS joined_institution_code,
              a.actor_user_id, a.actor_role, a.action, a.entity_name, a.entity_id, a.details_json, a.created_at
       FROM activity_logs a
       LEFT JOIN institutions i ON i.id = a.institution_id
       ${whereClause}
       ORDER BY a.id DESC
       LIMIT ?`,
      [...params, limit]
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
       ${whereClause ? `${whereClause} AND` : "WHERE"} a.action IN ('LOGIN_FAILED', 'ACCOUNT_LOCKED')
       AND a.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      params
    );
    const [otpFailuresRow] = await query(
      `SELECT COUNT(*) total
       FROM activity_logs a
       ${whereClause ? `${whereClause} AND` : "WHERE"} a.action IN ('OTP_VERIFY_FAILED', 'OTP_EXHAUSTED')
       AND a.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      params
    );
    res.json({
      logs: filteredLogs,
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
    const scopedInstitutions = await loadInstitutionScopeOptions(req.user);
    const includeInstitutionRegistry = scopedInstitutions.length > 0;
    const institutions = scopedInstitutions.map((row) => ({
      id: row.id,
      institution_name: row.institution_name,
      institution_code: row.institution_code
    }));
    const scopedInstitutionIds = institutions.map((item) => Number(item.id || 0)).filter((id) => id > 0);
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
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
    const statusUserScopeError = await assertInstitutionScopeAccess(req, target.institution_id, "You can only change user status in your assigned institution scope.");
    if (statusUserScopeError) {
      return res.status(statusUserScopeError.status).json({ error: statusUserScopeError.error });
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
    await purgeExpiredRecycleBinItems();
    await normalizeLegacyRecycleBinVisibility();
    const limit = Math.min(Math.max(Number(req.query?.limit || 200), 1), 1000);
    const statusFilter = cleanValue(req.query?.status).toUpperCase();
    const visibilityScope = determineRecycleVisibilityScope(req.user);
    const requestedScope = Number(req.query?.institution_id || 0) || null;
    const institutionScope = visibilityScope.includeAllInstitutions
      ? requestedScope
      : visibilityScope.scopeInstitutionId;
    let sql = `SELECT id, institution_id, entity_name, entity_id, archived_payload_json, deleted_by_user_id, deleted_at,
                      restored_at, restored_by_user_id, permanently_deleted_at, permanently_deleted_by_user_id,
                      status, hidden_for_roles_json
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
    const rows = await query(sql, params);
    const normalizedRows = rows
      .filter((row) => !roleHiddenFromItem(req.user.role, row))
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

app.get(
  "/api/cbc/curriculum",
  auth,
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const replaceExisting = parseTruthy(req.body?.replace_existing);
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
    for (const row of seedRows) {
      const key = [
        cleanValue(row.grade).toLowerCase(),
        cleanValue(row.learning_area).toLowerCase(),
        cleanValue(row.strand).toLowerCase(),
        cleanValue(row.sub_strand).toLowerCase()
      ].join("::");
      if (existingEntryKeys.has(key)) {
        // eslint-disable-next-line no-continue
        continue;
      }
      await query(
        `INSERT INTO cbc_curriculum_entries
          (institution_id, grade, form_name, learning_area, strand, sub_strand, specific_learning_outcomes,
           learning_experiences, notes, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.institution_id,
          cleanOptionalValue(row.grade),
          null,
          row.learning_area,
          row.strand,
          row.sub_strand,
          "",
          "",
          "",
          req.user.id
        ]
      );
      existingEntryKeys.add(key);
      insertedCurriculumEntries += 1;
    }

    await auditLog(req.user, "SEED_JSS_PRETECHNICAL_STRANDS", "cbc_structure_mappings", null, {
      source_label: sourceLabel,
      replace_existing: replaceExisting,
      inserted_mappings: insertedMappings,
      skipped_mappings: skippedMappings,
      inserted_curriculum_entries: insertedCurriculumEntries
    });
    res.json({
      message: "Grade 7-9 Pre-Technical + Social Studies strands/sub-strands seeded successfully.",
      source_label: sourceLabel,
      inserted_mappings: insertedMappings,
      skipped_mappings: skippedMappings,
      inserted_curriculum_entries: insertedCurriculumEntries
    });
  })
);

app.post(
  "/api/cbc/local-curriculum/import",
  auth,
  enforceModuleAccess(MODULE_KEYS.CBC_CURRICULUM_EDITOR),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
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
      const data = pickFields(req.body, config.fields);
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
      const data = pickFields(req.body, config.fields);
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

function rowWithinExamCoverage({ row, selectedStrand, selectedSubStrand }) {
  const selectedStrandNum = extractNumericToken(selectedStrand);
  const selectedSubStrandNum = extractNumericToken(selectedSubStrand);
  const rowStrandNum = extractNumericToken(row?.strand || "");
  const rowSubStrandNum = extractNumericToken(row?.sub_strand || "");
  if (selectedStrandNum === null || rowStrandNum === null) return true;
  if (rowStrandNum < selectedStrandNum) return true;
  if (rowStrandNum > selectedStrandNum) return false;
  if (selectedSubStrandNum === null || rowSubStrandNum === null) return true;
  return rowSubStrandNum <= selectedSubStrandNum;
}

function buildAdvancedExamText({
  title,
  learningArea,
  levelLabel,
  stream,
  term,
  academicYear,
  examSession,
  strand,
  subStrand,
  structure,
  structureDetail,
  percentageText,
  referenceRows,
  generatedNotes,
  supplementalMaterialNotes
}) {
  const references = (Array.isArray(referenceRows) ? referenceRows : []).slice(0, 24).map((row, index) => {
    const outcomes = cleanOptionalValue(row?.specific_learning_outcomes || "");
    const experiences = cleanOptionalValue(row?.learning_experiences || "");
    const notes = cleanOptionalValue(row?.notes || "");
    const parts = [
      `${index + 1}. ${cleanValue(row?.strand) || "-"} -> ${cleanValue(row?.sub_strand) || "-"}`,
      outcomes ? `   Outcomes: ${outcomes}` : "",
      experiences ? `   Experiences: ${experiences}` : "",
      notes ? `   Curriculum Notes: ${notes}` : ""
    ].filter(Boolean);
    return parts.join("\n");
  });

  const sharedHeader = [
    "INSTITUTION LETTERHEAD: [AUTO-INJECTED FROM INSTITUTION SETTINGS]",
    `EXAM TITLE: ${title || `${examSession} ${learningArea}`}`.trim(),
    `LEARNING AREA: ${learningArea || "-"}`,
    `LEVEL: ${levelLabel || "-"}`,
    `STREAM: ${stream || "-"}`,
    `ACADEMIC YEAR: ${academicYear || "-"}`,
    `TERM: ${term || "-"}`,
    `EXAM SESSION: ${examSession || "-"}`,
    `COVERAGE LIMIT: STRAND ${strand || "-"} | SUB-STRAND ${subStrand || "-"}`,
    `STRUCTURE: ${structure || "unified"} ${structureDetail ? `(${structureDetail})` : ""}`.trim(),
    `PERCENTAGE ALLOCATION: ${percentageText || "-"}`,
    "CANDIDATE IDENTIFIER: Assessment No / UPI / Admission No",
    "QR CODE: [AUTO-GENERATED AT PRINT/DOWNLOAD]",
    "DISTINCT SERIAL: [AUTO-GENERATED PER LEARNER/GRADE/STREAM]",
    ""
  ];

  const sectionTemplates = {
    unified: [
      "UNIFIED PAPER",
      "1) Explain key concepts from selected strand/sub-strand and prior covered strands.",
      "2) Apply the concept in a school/community context.",
      "3) Distinguish related terms and provide practical examples.",
      "4) Problem-solving / short practical item based on curriculum outcomes.",
      "5) Extended response aligned to CBC competencies."
    ],
    structured: [
      "STRUCTURED PAPER",
      "SECTION A: Short objective questions (coverage constrained to selected scope).",
      "SECTION B: Structured response questions requiring explanation and application.",
      "SECTION C: Competency/performance item linked to learning outcomes."
    ],
    "multi-section": [
      "MULTI-SECTION PAPER",
      "PAPER 1: Foundational recall + comprehension questions.",
      "PAPER 2: Application and analysis questions.",
      "PAPER 3: Competency-based project/task questions."
    ]
  };

  const body = sectionTemplates[structure] || sectionTemplates.unified;
  return [
    ...sharedHeader,
    "AI GENERATED EXAM PAPER",
    ...body,
    "",
    "AI NOTES BASIS (NO UPLOADED NOTES REQUIRED):",
    generatedNotes || "Notes generated directly from strands/sub-strands and curriculum mappings.",
    supplementalMaterialNotes ? `\nSUPPLEMENTAL MATERIAL INSIGHTS:\n${supplementalMaterialNotes}` : "",
    "",
    "CURRICULUM REFERENCE CONTEXT:",
    references.length ? references.join("\n") : "No mapped curriculum rows found; AI fallback used from selected strand/sub-strand."
  ].join("\n");
}

app.post(
  "/api/academic/exams/auto-generate",
  auth,
  enforceAnyModuleAccess([MODULE_KEYS.ACADEMIC_EXAMS, MODULE_KEYS.CBC_CURRICULUM_EDITOR]),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const {
      grade,
      form_name,
      stream,
      subject,
      learning_area,
      strand,
      sub_strand,
      term,
      year,
      title,
      notes_file_path,
      exam_type,
      structure,
      structure_detail,
      total_percentage,
      percentage_allocation,
      academic_year
    } = req.body;

    const selectedGrade = cleanOptionalValue(grade);
    const selectedForm = cleanOptionalValue(form_name);
    const selectedLearningArea = cleanValue(learning_area || subject || "");
    const selectedStrand = cleanValue(strand || "");
    const selectedSubStrand = cleanOptionalValue(sub_strand);
    const selectedTerm = cleanOptionalValue(term);
    const selectedYear = Number(year || 0) || new Date().getFullYear();
    const selectedSession = cleanOptionalValue(exam_type);
    if ((!selectedGrade && !selectedForm) || !selectedLearningArea || !selectedStrand) {
      return res.status(400).json({
        error: "grade/form_name, learning_area/subject, and strand are required for AI exam generation."
      });
    }

    const curriculumRowsRaw = await query(
      `SELECT id, grade, form_name, learning_area, strand, sub_strand,
              specific_learning_outcomes, learning_experiences, notes
       FROM cbc_curriculum_entries
       WHERE institution_id = ?
         AND learning_area = ?
       ORDER BY id ASC
       LIMIT 2500`,
      [req.user.institution_id, selectedLearningArea]
    );
    const selectedLevelNumber = extractLevelNumber(selectedGrade || selectedForm);
    const scopedCurriculumRows = curriculumRowsRaw.filter((row) => {
      if (selectedGrade && cleanValue(row.grade) && cleanValue(row.grade) !== selectedGrade) {
        const rowLevel = extractLevelNumber(row.grade);
        if (!(rowLevel !== null && selectedLevelNumber !== null && rowLevel <= selectedLevelNumber && rowLevel >= selectedLevelNumber - 2)) {
          return false;
        }
      }
      if (selectedForm && cleanValue(row.form_name) && cleanValue(row.form_name) !== selectedForm) {
        const rowLevel = extractLevelNumber(row.form_name);
        if (!(rowLevel !== null && selectedLevelNumber !== null && rowLevel <= selectedLevelNumber && rowLevel >= selectedLevelNumber - 2)) {
          return false;
        }
      }
      return rowWithinExamCoverage({
        row,
        selectedStrand,
        selectedSubStrand
      });
    });

    let referenceRows = scopedCurriculumRows;
    if (!referenceRows.length) {
      const mappingRows = await query(
        `SELECT learning_area, strand, sub_strand, notes, grade, form_name
         FROM cbc_structure_mappings
         WHERE institution_id = ?
           AND learning_area = ?
         ORDER BY id ASC
         LIMIT 1000`,
        [req.user.institution_id, selectedLearningArea]
      );
      referenceRows = mappingRows.filter((row) =>
        rowWithinExamCoverage({
          row,
          selectedStrand,
          selectedSubStrand
        })
      ).map((row) => ({
        ...row,
        specific_learning_outcomes: "",
        learning_experiences: ""
      }));
    }

    const materialRows = await query(
      `SELECT title, description, strand, sub_strand, grade, stream, term
       FROM teacher_resources
       WHERE institution_id = ?
         AND (grade = ? OR ? = '' OR grade IS NULL OR grade = '')
         AND (term = ? OR ? = '' OR term IS NULL OR term = '')
       ORDER BY id DESC
       LIMIT 120`,
      [req.user.institution_id, selectedGrade || selectedForm || "", selectedGrade || selectedForm || "", selectedTerm || "", selectedTerm || ""]
    );
    const supplementalMaterialNotes = materialRows
      .filter((row) => {
        if (selectedStrand && cleanValue(row.strand) && cleanValue(row.strand) !== selectedStrand) return false;
        if (selectedSubStrand && cleanValue(row.sub_strand) && cleanValue(row.sub_strand) !== selectedSubStrand) return false;
        return true;
      })
      .slice(0, 6)
      .map((row) => [cleanValue(row.title), cleanOptionalValue(row.description)].filter(Boolean).join(": "))
      .filter(Boolean)
      .join("\n");

    const generatedNotes = makeNotes({
      grade: selectedGrade || null,
      formName: selectedForm || null,
      learningArea: selectedLearningArea,
      strand: selectedStrand,
      subStrand: selectedSubStrand || null
    });
    const percentageText = cleanOptionalValue(total_percentage || percentage_allocation) || "";
    const examText = buildAdvancedExamText({
      title: cleanOptionalValue(title) || `${selectedSession || "Exam"} - ${selectedLearningArea}`,
      learningArea: selectedLearningArea,
      levelLabel: selectedGrade || selectedForm,
      stream: cleanOptionalValue(stream),
      term: selectedTerm,
      academicYear: cleanOptionalValue(academic_year) || `${selectedYear}/${selectedYear + 1}`,
      examSession: selectedSession || "Exam",
      strand: selectedStrand,
      subStrand: selectedSubStrand,
      structure: cleanOptionalValue(structure) || "unified",
      structureDetail: cleanOptionalValue(structure_detail),
      percentageText,
      referenceRows,
      generatedNotes,
      supplementalMaterialNotes
    });

    const result = await query(
      `INSERT INTO academic_exams
        (institution_id, title, grade, stream, subject, strand, sub_strand, notes_file_path, generated_exam_text, term, year, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.institution_id,
        cleanOptionalValue(title) || `${selectedSession || "Auto Generated Exam"} - ${selectedLearningArea}`,
        selectedGrade || selectedForm || null,
        cleanOptionalValue(stream) || null,
        selectedLearningArea || null,
        selectedStrand || null,
        selectedSubStrand || null,
        notes_file_path || null,
        examText,
        selectedTerm || null,
        selectedYear || null,
        req.user.id
      ]
    );

    await auditLog(req.user, "AUTO_GENERATE_EXAM", "academic_exams", result.insertId);
    res.status(201).json({
      id: result.insertId,
      examText,
      notes_required: false,
      used_curriculum_rows: referenceRows.length,
      used_material_rows: supplementalMaterialNotes ? supplementalMaterialNotes.split("\n").length : 0
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

app.post(
  "/api/academic/exams/allocate-serials",
  auth,
  enforceAnyModuleAccess([MODULE_KEYS.ACADEMIC_EXAMS, MODULE_KEYS.CBC_CURRICULUM_EDITOR]),
  enforceRole([ROLES.SUPER_SYSTEM_DEVELOPER, ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  asyncHandler(async (req, res) => {
    const institutionId = Number(req.user.institution_id);
    const body = req.body || {};
    const grade = cleanValue(body.grade || "");
    const form = cleanValue(body.form_name || "");
    const learningArea = cleanValue(body.learning_area || body.subject || "");
    const examType = cleanValue(body.exam_type || "");
    const term = cleanValue(body.term || "");
    const year = Number(body.year || new Date().getFullYear());
    const stream = cleanValue(body.stream || "");
    const mode = (cleanValue(body.mode || "per_learner") || "per_learner").toLowerCase();
    if (!(grade || form) || !learningArea || !examType) {
      return res.status(400).json({ error: "grade/form, learning_area/subject and exam_type are required." });
    }
    const learnerSerialColumns = await getExistingColumns("learners", ["learner_serial_number"]);
    const hasLearnerSerialColumn = learnerSerialColumns.includes("learner_serial_number");
    const learners = mode === "per_learner"
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
    const serials = learners.map((learner) => ({
      learner_id: learner.id,
      learner_serial_number: learner.learner_serial_number || null,
      learner_name: learner.full_name,
      admission_number: learner.admission_number,
      grade: learner.grade || grade || form,
      stream: learner.stream || stream || null,
      serial: buildExamSerialSegment({
        grade, form, learningArea, examType, term, year, stream,
        learnerSerialNumber: learner.learner_serial_number || learner.id
      })
    }));
    res.json({ count: serials.length, mode, serials });
  })
);

app.get(
  "/api/academic/results/ranked",
  auth,
  enforceRole([ROLES.SYSTEM_DEVELOPER, ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
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
