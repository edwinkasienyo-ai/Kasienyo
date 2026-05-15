const crypto = require("crypto");
const path = require("path");

const ADMISSION_DOC_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);

const MIME_TO_EXT = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png"
};

const KNOWN_DOCUMENT_CATEGORIES = [
  "BIRTH_CERTIFICATE",
  "PARENT_ID",
  "LEARNER_REPORT",
  "TRANSFER_LETTER",
  "PASSPORT_PHOTO",
  "OTHER"
];

function admissionDocMaxBytes() {
  const n = Number(process.env.ADMISSION_UPLOAD_MAX_BYTES || 6 * 1024 * 1024);
  if (!Number.isFinite(n) || n < 512 * 1024) return 6 * 1024 * 1024;
  if (n > 20 * 1024 * 1024) return 20 * 1024 * 1024;
  return Math.floor(n);
}

function admissionMaxDocumentsPerApplicantRequest() {
  const n = Number(process.env.ADMISSION_UPLOAD_MAX_FILES_PER_REQUEST || 12);
  if (!Number.isFinite(n) || n < 1) return 12;
  if (n > 30) return 30;
  return Math.floor(n);
}

function hashAdmissionApplicantAccessToken(plain) {
  return crypto.createHash("sha256").update(String(plain || ""), "utf8").digest("hex");
}

function timingSafeEqualSha256Hex(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex || ""), "hex");
    const b = Buffer.from(String(bHex || ""), "hex");
    if (a.length !== b.length || a.length !== 32) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function normalizeAdmissionDocCategory(raw) {
  const u = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  return KNOWN_DOCUMENT_CATEGORIES.includes(u) ? u : null;
}

function sanitizeOriginalFilename(originalFilename, mimeType) {
  const baseRaw = path.basename(String(originalFilename || "document"));
  const trimmed = baseRaw.replace(/[^\w.\- ()+]+/g, "_").slice(0, 180);
  const base = trimmed || `document-${Date.now()}`;
  const extFromMime = MIME_TO_EXT[String(mimeType || "")];
  const extGuess = path.extname(base).toLowerCase();
  if (extFromMime && !(extGuess === ".pdf" || extGuess === ".jpg" || extGuess === ".jpeg" || extGuess === ".png")) {
    return base + extFromMime;
  }
  return base;
}

module.exports = {
  ADMISSION_DOC_ALLOWED_MIME_TYPES,
  KNOWN_DOCUMENT_CATEGORIES,
  MIME_TO_EXT,
  admissionDocMaxBytes,
  admissionMaxDocumentsPerApplicantRequest,
  hashAdmissionApplicantAccessToken,
  timingSafeEqualSha256Hex,
  normalizeAdmissionDocCategory,
  sanitizeOriginalFilename
};
