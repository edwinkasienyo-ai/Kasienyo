const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  hashAdmissionApplicantAccessToken,
  timingSafeEqualSha256Hex,
  normalizeAdmissionDocCategory,
  KNOWN_DOCUMENT_CATEGORIES
} = require("../src/admissionApplicantUploads");

describe("admissionApplicantUploads", () => {
  it("hashes applicant access tokens deterministically", () => {
    const a = hashAdmissionApplicantAccessToken("abc");
    const b = hashAdmissionApplicantAccessToken("abc");
    const c = hashAdmissionApplicantAccessToken("abcd");
    assert.equal(a.length, 64);
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.ok(timingSafeEqualSha256Hex(a, b));
    assert.ok(!timingSafeEqualSha256Hex(a, c));
    assert.ok(!timingSafeEqualSha256Hex(`${"00".repeat(32)}`, `${"ff".repeat(32)}`));
  });

  it("normalizeAdmissionDocCategory trims and maps to known enums", () => {
    assert.equal(normalizeAdmissionDocCategory("  birth_certificate "), "BIRTH_CERTIFICATE");
    assert.equal(normalizeAdmissionDocCategory("Passport-photo"), "PASSPORT_PHOTO");
    assert.ok(KNOWN_DOCUMENT_CATEGORIES.includes("PASSPORT_PHOTO"));
    assert.equal(normalizeAdmissionDocCategory("not-a-real-category"), null);
  });
});
