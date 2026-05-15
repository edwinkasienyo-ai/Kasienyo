/**
 * Ensures project-root .env exists before the server starts.
 * Runs automatically via npm "prestart" so it works even when server.js is an older version.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

const minimal = [
  "NODE_ENV=development",
  "PORT=5002",
  "JWT_SECRET=change-me-very-long-secret",
  "DB_HOST=127.0.0.1",
  "DB_PORT=3306",
  "DB_USER=root",
  "DB_PASS=",
  "DB_NAME=iims_school_system",
  "FRONTEND_ORIGIN=http://localhost:5002"
].join("\n");

if (fs.existsSync(envPath)) {
  process.exit(0);
}

try {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log(`[IMIS Basic Education] Created .env from .env.example:\n  ${envPath}`);
  } else {
    fs.writeFileSync(envPath, minimal, "utf8");
    console.log(`[IMIS Basic Education] Created minimal .env (no .env.example found):\n  ${envPath}`);
  }
  console.log("");
  console.log("[IMIS Basic Education] NEXT: Open that file in Notepad, set DB_PASS to your MySQL password (same as phpMyAdmin),");
  console.log("                 save the file, then run:  npm start");
  console.log("");
  process.exit(1);
} catch (err) {
  console.error("[IMIS Basic Education] Could not create .env:", err && err.message ? err.message : err);
  process.exit(1);
}
