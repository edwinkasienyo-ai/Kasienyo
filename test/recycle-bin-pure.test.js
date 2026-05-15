const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { isSafeTableIdentifier, verifyThreeStepDeleteConfirm } = require("../src/recycleBinPure");

describe("recycleBinPure", () => {
  it("isSafeTableIdentifier allows tables and rejects injection-shaped names", () => {
    assert.equal(isSafeTableIdentifier("users"), true);
    assert.equal(isSafeTableIdentifier("academic_exams"), true);
    assert.equal(isSafeTableIdentifier(""), false);
    assert.equal(isSafeTableIdentifier("users;drop"), false);
    assert.equal(isSafeTableIdentifier("users--"), false);
  });

  it("verifyThreeStepDeleteConfirm requires exact phased acknowledgement", () => {
    assert.equal(verifyThreeStepDeleteConfirm([]), false);
    assert.equal(
      verifyThreeStepDeleteConfirm(["yes", "confirm", "delete"]),
      true
    );
    assert.equal(verifyThreeStepDeleteConfirm(["YES", "CONFIRM", ""]), false);
  });
});
