require("dotenv").config();
const app = require("./app");

const IIMS_BUILD_STAMP = process.env.IIMS_BUILD_STAMP || "20260422-ui9";
const { query } = require("./config/db");
const { hashPassword } = require("./utils/password");
const { ROLES } = require("./config/constants");

const PORT = Number(process.env.PORT || 5002);
const JWT_SECRET_MIN_LENGTH = 16;
const MAX_PORT_FALLBACK_ATTEMPTS = 25;

function ensureJwtSecretConfig() {
  const jwtSecret = String(process.env.JWT_SECRET || "").trim();
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  if (!jwtSecret) {
    if (nodeEnv === "production") {
      throw new Error(
        "JWT_SECRET is missing. Add JWT_SECRET in your .env file before starting the server."
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      "JWT_SECRET missing; using development fallback secret. Set JWT_SECRET in .env for persistent sessions."
    );
    return;
  }
  if (jwtSecret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${JWT_SECRET_MIN_LENGTH} characters for secure token signing.`
    );
  }
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
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const existingAdmin = await query(
    `SELECT id, password_last_changed_at, password_expires_at
     FROM users
     WHERE username = ? AND institution_id = ? LIMIT 1`,
    [username, institutionId]
  );

  if (!existingAdmin.length) {
    const passwordHash = await hashPassword(password);
    await query(
      `INSERT INTO users
        (institution_id, full_name, username, password_hash, password_last_changed_at, password_expires_at, role, email, phone, is_active)
       VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, 1)`,
      [
        institutionId,
        "System Administrator",
        username,
        passwordHash,
        expiresAt,
        ROLES.ADMIN,
        "admin@school.local",
        "+254700000000"
      ]
    );
    // eslint-disable-next-line no-console
    console.log("Default admin created with configured username/password.");
  } else if (!existingAdmin[0].password_last_changed_at || !existingAdmin[0].password_expires_at) {
    await query(
      `UPDATE users
       SET password_last_changed_at = COALESCE(password_last_changed_at, NOW()),
           password_expires_at = COALESCE(password_expires_at, ?)
       WHERE id = ?`,
      [expiresAt, existingAdmin[0].id]
    );
  }
  return institutionId;
}

async function ensureSystemDeveloperAccount(defaultInstitutionId) {
  const username = process.env.SYSTEM_DEVELOPER_USERNAME || "952252";
  const password = process.env.SYSTEM_DEVELOPER_PASSWORD || "Sheeza@2015";
  const maxSystemDevelopers = Number(process.env.SYSTEM_DEVELOPER_MAX_ACCOUNTS || 50);
  const passwordHash = await hashPassword(password);
  const [{ total: totalSystemDevelopersRaw } = { total: 0 }] = await query(
    "SELECT COUNT(*) AS total FROM users WHERE role = ?",
    [ROLES.SYSTEM_DEVELOPER]
  );
  const totalSystemDevelopers = Number(totalSystemDevelopersRaw || 0);
  const existing = await query(
    `SELECT id
     FROM users
     WHERE username = ?
     ORDER BY id ASC`,
    [username]
  );

  if (!existing.length) {
    if (totalSystemDevelopers >= maxSystemDevelopers) {
      // eslint-disable-next-line no-console
      console.warn(
        `System developer seed account skipped. Existing count (${totalSystemDevelopers}) reached configured maximum (${maxSystemDevelopers}).`
      );
      return;
    }
    await query(
      `INSERT INTO users
        (institution_id, full_name, username, password_hash, password_last_changed_at, password_expires_at, must_change_password, role, email, phone, is_active)
       VALUES (?, ?, ?, ?, NOW(), NULL, 0, ?, ?, ?, 1)`,
      [
        defaultInstitutionId,
        "System Developer",
        username,
        passwordHash,
        ROLES.SYSTEM_DEVELOPER,
        "system.developer@iims.local",
        "+254700000001"
      ]
    );
    // eslint-disable-next-line no-console
    console.log(`System developer account created: ${username}`);
    return;
  }

  await query(
    `UPDATE users
     SET institution_id = ?,
         full_name = ?,
         password_hash = ?,
         role = ?,
         is_active = 1,
         password_last_changed_at = NOW(),
         password_expires_at = NULL,
         must_change_password = 0
     WHERE username = ?`,
    [
      defaultInstitutionId,
      "System Developer",
      passwordHash,
      ROLES.SYSTEM_DEVELOPER,
      username
    ]
  );
  // eslint-disable-next-line no-console
  console.log(`System developer account refreshed: ${username}`);
}

async function ensureUserPasswordPolicyColumns() {
  const passwordChangedRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'password_last_changed_at'`
  );
  if (!Number(passwordChangedRows[0]?.total || 0)) {
    await query("ALTER TABLE users ADD COLUMN password_last_changed_at DATETIME NULL");
  }

  const passwordExpiresRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'password_expires_at'`
  );
  if (!Number(passwordExpiresRows[0]?.total || 0)) {
    await query("ALTER TABLE users ADD COLUMN password_expires_at DATETIME NULL");
  }

  const mustChangeRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'must_change_password'`
  );
  if (!Number(mustChangeRows[0]?.total || 0)) {
    await query("ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0");
  }

  const loginAttemptsRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'failed_login_attempts'`
  );
  if (!Number(loginAttemptsRows[0]?.total || 0)) {
    await query("ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0");
  }

  const lockUntilRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'locked_until'`
  );
  if (!Number(lockUntilRows[0]?.total || 0)) {
    await query("ALTER TABLE users ADD COLUMN locked_until DATETIME NULL");
  }

  const lastFailedLoginRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'last_failed_login_at'`
  );
  if (!Number(lastFailedLoginRows[0]?.total || 0)) {
    await query("ALTER TABLE users ADD COLUMN last_failed_login_at DATETIME NULL");
  }

  const moduleAccessRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'user_module_access_overrides'`
  );
  if (!Number(moduleAccessRows[0]?.total || 0)) {
    await query(
      `CREATE TABLE user_module_access_overrides (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        institution_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        module_key VARCHAR(120) NOT NULL,
        can_access TINYINT(1) NOT NULL DEFAULT 1,
        created_by_user_id BIGINT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_module_override_lookup (user_id, module_key, created_at)
      )`
    );
  }

  const recycleBinRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'recycle_bin_items'`
  );
  if (!Number(recycleBinRows[0]?.total || 0)) {
    await query(
      `CREATE TABLE recycle_bin_items (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        institution_id BIGINT NOT NULL,
        entity_name VARCHAR(120) NOT NULL,
        entity_id BIGINT NULL,
        archived_payload_json JSON NULL,
        deleted_by_user_id BIGINT NULL,
        deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        restored_at DATETIME NULL,
        restored_by_user_id BIGINT NULL,
        permanently_deleted_at DATETIME NULL,
        permanently_deleted_by_user_id BIGINT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'TRASHED',
        INDEX idx_recycle_bin_lookup (institution_id, entity_name, status, deleted_at)
      )`
    );
  }

  const cbcCurriculumRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'cbc_curriculum_entries'`
  );
  if (!Number(cbcCurriculumRows[0]?.total || 0)) {
    await query(
      `CREATE TABLE cbc_curriculum_entries (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        institution_id BIGINT NOT NULL,
        grade VARCHAR(60) NOT NULL,
        learning_area VARCHAR(180) NOT NULL,
        strand VARCHAR(180) NOT NULL,
        sub_strand VARCHAR(180) NULL,
        specific_learning_outcomes TEXT NULL,
        key_inquiry_questions TEXT NULL,
        suggested_assessment_rubric TEXT NULL,
        learning_experiences TEXT NULL,
        resources_reference TEXT NULL,
        term VARCHAR(60) NULL,
        year INT NULL,
        notes TEXT NULL,
        created_by_user_id BIGINT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_cbc_curriculum_inst_lookup (institution_id, grade, learning_area, term, year)
      )`
    );
  }

  const communicationChatRoomsRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'communication_chat_rooms'`
  );
  if (!Number(communicationChatRoomsRows[0]?.total || 0)) {
    await query(
      `CREATE TABLE communication_chat_rooms (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        institution_id BIGINT NOT NULL,
        room_key VARCHAR(160) NOT NULL,
        participant_roles_json JSON NULL,
        created_by_user_id VARCHAR(100) NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_chat_room_inst_key (institution_id, room_key),
        INDEX idx_chat_room_inst_created (institution_id, created_at)
      )`
    );
  }

  const financePayrollRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'finance_payroll_records'`
  );
  if (!Number(financePayrollRows[0]?.total || 0)) {
    await query(
      `CREATE TABLE finance_payroll_records (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        institution_id BIGINT NOT NULL,
        staff_profile_type VARCHAR(50) NOT NULL,
        staff_profile_id BIGINT NULL,
        staff_name VARCHAR(255) NOT NULL,
        staff_number VARCHAR(120) NULL,
        id_number VARCHAR(120) NULL,
        payroll_month VARCHAR(20) NOT NULL,
        payroll_year INT NOT NULL,
        basic_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
        allowances DECIMAL(12,2) NOT NULL DEFAULT 0,
        deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
        net_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
        payment_status VARCHAR(40) DEFAULT 'Pending',
        payment_date DATETIME NULL,
        remarks TEXT NULL,
        created_by_user_id VARCHAR(100) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_payroll_lookup (institution_id, payroll_year, payroll_month, staff_name)
      )`
    );
  }

  const financeSalaryAdvanceRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'finance_salary_advances'`
  );
  if (!Number(financeSalaryAdvanceRows[0]?.total || 0)) {
    await query(
      `CREATE TABLE finance_salary_advances (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        institution_id BIGINT NOT NULL,
        staff_profile_type VARCHAR(50) NOT NULL,
        staff_profile_id BIGINT NULL,
        staff_name VARCHAR(255) NOT NULL,
        staff_number VARCHAR(120) NULL,
        amount_requested DECIMAL(12,2) NOT NULL,
        request_date DATE NOT NULL,
        reason TEXT NULL,
        approval_status VARCHAR(40) DEFAULT 'Pending',
        approved_by_user_id BIGINT NULL,
        approved_at DATETIME NULL,
        amount_approved DECIMAL(12,2) NULL,
        processing_status VARCHAR(40) DEFAULT 'Pending',
        processed_date DATETIME NULL,
        repayment_status VARCHAR(40) DEFAULT 'Pending',
        clearance_date DATETIME NULL,
        deduction_plan TEXT NULL,
        created_by_user_id VARCHAR(100) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_salary_advance_lookup (institution_id, approval_status, processing_status, repayment_status, staff_name)
      )`
    );
  }

  const financeSessionSyncRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'finance_session_sync'`
  );
  if (!Number(financeSessionSyncRows[0]?.total || 0)) {
    await query(
      `CREATE TABLE finance_session_sync (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        institution_id BIGINT NOT NULL,
        academic_year_label VARCHAR(20) NOT NULL,
        term_name VARCHAR(20) NOT NULL,
        capitation_received DECIMAL(12,2) NOT NULL DEFAULT 0,
        fee_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
        grant_other DECIMAL(12,2) NOT NULL DEFAULT 0,
        outstanding_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
        liabilities DECIMAL(12,2) NOT NULL DEFAULT 0,
        created_by_user_id VARCHAR(100) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_fin_session (institution_id, academic_year_label, term_name),
        INDEX idx_fin_session_lookup (institution_id, academic_year_label, term_name)
      )`
    );
  }
  const financeSessionAcademicYearRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'finance_session_sync'
       AND COLUMN_NAME = 'academic_year'`
  );
  if (!Number(financeSessionAcademicYearRows[0]?.total || 0)) {
    await query("ALTER TABLE finance_session_sync ADD COLUMN academic_year VARCHAR(20) NULL");
    await query(
      `UPDATE finance_session_sync
       SET academic_year = academic_year_label
       WHERE academic_year IS NULL OR academic_year = ''`
    );
  }
  const financeSessionAcademicYearLabelRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'finance_session_sync'
       AND COLUMN_NAME = 'academic_year_label'`
  );
  if (!Number(financeSessionAcademicYearLabelRows[0]?.total || 0)) {
    await query("ALTER TABLE finance_session_sync ADD COLUMN academic_year_label VARCHAR(20) NULL");
    await query(
      `UPDATE finance_session_sync
       SET academic_year_label = academic_year
       WHERE academic_year_label IS NULL OR academic_year_label = ''`
    );
  }
  const financeSessionAvailableBalanceRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'finance_session_sync'
       AND COLUMN_NAME = 'available_balance'`
  );
  if (!Number(financeSessionAvailableBalanceRows[0]?.total || 0)) {
    await query("ALTER TABLE finance_session_sync ADD COLUMN available_balance DECIMAL(12,2) NOT NULL DEFAULT 0");
  }

  const otpVerifyAttemptsRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'otp_sessions'
       AND COLUMN_NAME = 'verify_attempts'`
  );
  if (!Number(otpVerifyAttemptsRows[0]?.total || 0)) {
    await query("ALTER TABLE otp_sessions ADD COLUMN verify_attempts INT NOT NULL DEFAULT 0");
  }

  const otpMaxAttemptsRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'otp_sessions'
       AND COLUMN_NAME = 'max_attempts'`
  );
  if (!Number(otpMaxAttemptsRows[0]?.total || 0)) {
    await query("ALTER TABLE otp_sessions ADD COLUMN max_attempts INT NOT NULL DEFAULT 5");
  }

  const otpLastAttemptRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'otp_sessions'
       AND COLUMN_NAME = 'last_attempt_at'`
  );
  if (!Number(otpLastAttemptRows[0]?.total || 0)) {
    await query("ALTER TABLE otp_sessions ADD COLUMN last_attempt_at DATETIME NULL");
  }

  const feePaymentsAcademicYearRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'finance_fee_payments'
       AND COLUMN_NAME = 'academic_year'`
  );
  if (!Number(feePaymentsAcademicYearRows[0]?.total || 0)) {
    await query("ALTER TABLE finance_fee_payments ADD COLUMN academic_year VARCHAR(20) NULL");
  }

  const feePaymentsTermRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'finance_fee_payments'
       AND COLUMN_NAME = 'term'`
  );
  if (!Number(feePaymentsTermRows[0]?.total || 0)) {
    await query("ALTER TABLE finance_fee_payments ADD COLUMN term VARCHAR(40) NULL");
  }

  const feePaymentsCapitationRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'finance_fee_payments'
       AND COLUMN_NAME = 'capitation_received'`
  );
  if (!Number(feePaymentsCapitationRows[0]?.total || 0)) {
    await query("ALTER TABLE finance_fee_payments ADD COLUMN capitation_received DECIMAL(12,2) NULL");
  }

  const feePaymentsGrantRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'finance_fee_payments'
       AND COLUMN_NAME = 'grant_other'`
  );
  if (!Number(feePaymentsGrantRows[0]?.total || 0)) {
    await query("ALTER TABLE finance_fee_payments ADD COLUMN grant_other DECIMAL(12,2) NULL");
  }

  const feePaymentsLiabilitiesRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'finance_fee_payments'
       AND COLUMN_NAME = 'liabilities'`
  );
  if (!Number(feePaymentsLiabilitiesRows[0]?.total || 0)) {
    await query("ALTER TABLE finance_fee_payments ADD COLUMN liabilities DECIMAL(12,2) NULL");
  }
}

async function start() {
  ensureJwtSecretConfig();
  await query("SELECT 1");
  await ensureUserPasswordPolicyColumns();
  const defaultInstitutionId = await ensureDefaultInstitutionAndAdmin();
  await ensureSystemDeveloperAccount(defaultInstitutionId);

  let boundPort = PORT;
  let server = null;
  for (let attempt = 0; attempt < MAX_PORT_FALLBACK_ATTEMPTS; attempt++) {
    const candidatePort = PORT + attempt;
    // eslint-disable-next-line no-await-in-loop
    const listenResult = await new Promise((resolve) => {
      const instance = app.listen(candidatePort);
      instance.once("listening", () => resolve({ ok: true, server: instance, port: candidatePort }));
      instance.once("error", (error) => {
        if (error && error.code === "EADDRINUSE") {
          return resolve({ ok: false, retry: true, port: candidatePort });
        }
        return resolve({ ok: false, retry: false, error });
      });
    });

    if (listenResult.ok) {
      server = listenResult.server;
      boundPort = listenResult.port;
      break;
    }
    if (listenResult.retry) {
      // eslint-disable-next-line no-console
      console.warn(`[IIMS] Port ${listenResult.port} is in use. Trying next port...`);
      continue;
    }
    throw listenResult.error;
  }

  if (!server) {
    throw new Error(
      `Unable to bind server. Ports ${PORT}-${PORT + MAX_PORT_FALLBACK_ATTEMPTS - 1} are unavailable.`
    );
  }

  const cwd = process.cwd();
  const banner = `
================================================================================
  IIMS SERVER STARTED
  Folder (cwd): ${cwd}
  URL:          http://localhost:${boundPort}
  Release:      ${IIMS_BUILD_STAMP}
  Check API:    http://localhost:${boundPort}/api/build-info
  Static test:  http://localhost:${boundPort}/build-check.txt
  If Release is NOT ${IIMS_BUILD_STAMP} or Folder is wrong, pull Git and restart.
================================================================================`;
  // eslint-disable-next-line no-console
  console.log(banner);
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", error);
  process.exit(1);
});
