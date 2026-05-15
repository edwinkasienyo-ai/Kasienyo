/**
 * Used by imis-bootstrap-windows.ps1 (avoids fragile PowerShell quoting for node -e).
 * Loads .env from repo root (parent of /scripts), not process.cwd().
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const n = String(process.env.DB_PASS || "").length;
if (!n) {
  // eslint-disable-next-line no-console
  console.error("FAIL: DB_PASS still empty in .env");
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log("OK: DB_PASS length =", n);
