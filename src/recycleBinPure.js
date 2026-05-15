function cleanTrim(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isSafeTableIdentifier(name) {
  return /^[a-z_][a-z0-9_]*$/i.test(cleanTrim(name));
}

function verifyThreeStepDeleteConfirm(confirmations = []) {
  if (!Array.isArray(confirmations) || confirmations.length < 3) {
    return false;
  }
  const expected = ["YES", "CONFIRM", "DELETE"];
  return expected.every((step, index) => cleanTrim(confirmations[index]).toUpperCase() === step);
}

module.exports = {
  cleanTrim,
  isSafeTableIdentifier,
  verifyThreeStepDeleteConfirm
};
