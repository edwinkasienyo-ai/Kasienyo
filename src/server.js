require("dotenv").config();
const app = require("./app");
const { query } = require("./config/db");
const { hashPassword } = require("./utils/password");
const { ROLES } = require("./config/constants");

const PORT = Number(process.env.PORT || 5000);

async function ensureDefaultInstitutionAndAdmin() {
  const institutionName = "Default Institution";
  const existingInstitutions = await query(
    "SELECT id FROM institutions WHERE institution_name = ? LIMIT 1",
    [institutionName]
  );

  let institutionId = null;
  if (!existingInstitutions.length) {
    const institutionInsert = await query(
      `INSERT INTO institutions (institution_name, institution_code, email, phone, county, sub_county, location, village)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [institutionName, "DEFAULT", "admin@school.local", "+254700000000", "N/A", "N/A", "N/A", "N/A"]
    );
    institutionId = institutionInsert.insertId;
  } else {
    institutionId = existingInstitutions[0].id;
  }

  const username = process.env.DEFAULT_ADMIN_USERNAME || "admin";
  const password = process.env.DEFAULT_ADMIN_PASSWORD || "1234";
  const existingAdmin = await query(
    "SELECT id FROM users WHERE username = ? AND institution_id = ? LIMIT 1",
    [username, institutionId]
  );

  if (!existingAdmin.length) {
    const passwordHash = await hashPassword(password);
    await query(
      `INSERT INTO users
        (institution_id, full_name, username, password_hash, role, email, phone, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        institutionId,
        "System Administrator",
        username,
        passwordHash,
        ROLES.ADMIN,
        "admin@school.local",
        "+254700000000"
      ]
    );
    // eslint-disable-next-line no-console
    console.log("Default admin created with configured username/password.");
  }
}

async function start() {
  await query("SELECT 1");
  await ensureDefaultInstitutionAndAdmin();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`IIMS server running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", error);
  process.exit(1);
});
