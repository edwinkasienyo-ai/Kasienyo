require("dotenv").config();
const app = require("./app");
const { query } = require("./config/db");
const { hashPassword } = require("./utils/password");
const { ROLES } = require("./config/constants");

const PORT = Number(process.env.PORT || 5000);

async function ensureColumn(tableName, columnName, definitionSql) {
  const rows = await query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  if (rows.length) return;
  await query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql}`);
}

async function ensureAdmissionEnterpriseSchema() {
  await ensureColumn("learners", "deleted_at", "DATETIME NULL");
  await ensureColumn("learners", "deleted_by_user_id", "VARCHAR(100) NULL");

  await query(`
    CREATE TABLE IF NOT EXISTS admission_jobs (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      institution_id BIGINT NOT NULL,
      job_type VARCHAR(80) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'Queued',
      progress_percent INT NOT NULL DEFAULT 0,
      total_items INT NOT NULL DEFAULT 0,
      processed_items INT NOT NULL DEFAULT 0,
      payload_json JSON NULL,
      result_json JSON NULL,
      error_message TEXT NULL,
      created_by_user_id VARCHAR(100) NULL,
      started_at DATETIME NULL,
      completed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_admission_jobs_main (institution_id, job_type, status, created_at),
      CONSTRAINT fk_admission_jobs_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admission_record_versions (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      institution_id BIGINT NOT NULL,
      learner_id BIGINT NOT NULL,
      version_action VARCHAR(80) NOT NULL,
      changed_by_user_id VARCHAR(100) NULL,
      before_json JSON NULL,
      after_json JSON NULL,
      notes TEXT NULL,
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_admission_versions_lookup (institution_id, learner_id, changed_at),
      CONSTRAINT fk_admission_versions_institution FOREIGN KEY (institution_id) REFERENCES institutions(id),
      CONSTRAINT fk_admission_versions_learner FOREIGN KEY (learner_id) REFERENCES learners(id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admission_status_approvals (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      institution_id BIGINT NOT NULL,
      learner_id BIGINT NOT NULL,
      admission_number VARCHAR(120) NULL,
      learner_name VARCHAR(255) NULL,
      from_status VARCHAR(60) NULL,
      to_status VARCHAR(60) NOT NULL,
      request_reason TEXT NULL,
      approval_status VARCHAR(40) NOT NULL DEFAULT 'Pending',
      requested_by_user_id VARCHAR(100) NULL,
      approved_by_user_id VARCHAR(100) NULL,
      approved_at DATETIME NULL,
      decision_comment TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_admission_status_approvals_main (institution_id, approval_status, learner_id, created_at),
      CONSTRAINT fk_admission_status_approvals_institution FOREIGN KEY (institution_id) REFERENCES institutions(id),
      CONSTRAINT fk_admission_status_approvals_learner FOREIGN KEY (learner_id) REFERENCES learners(id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admission_duplicate_reviews (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      institution_id BIGINT NOT NULL,
      group_key VARCHAR(255) NOT NULL,
      decision VARCHAR(80) NOT NULL,
      notes TEXT NULL,
      resolved_by_user_id VARCHAR(100) NULL,
      resolved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_admission_duplicate_review (institution_id, group_key),
      INDEX idx_admission_duplicate_reviews_main (institution_id, resolved_at),
      CONSTRAINT fk_admission_duplicate_reviews_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
    )
  `);
}

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
  await ensureAdmissionEnterpriseSchema();
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
