require("dotenv").config();
const app = require("./app");
const { readPublicIndexFingerprint } = require("./readIndexFingerprint");

const IIMS_BUILD_STAMP = process.env.IIMS_BUILD_STAMP || "ui-deploy-rev45";
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
  const systemDeveloperFullName = process.env.SYSTEM_DEVELOPER_FULL_NAME || "Mr.Edwin Onyango";
  const systemDeveloperEmail = process.env.SYSTEM_DEVELOPER_EMAIL || "mwendeguenterpriseltd@gmail.com";
  const systemDeveloperPhone = process.env.SYSTEM_DEVELOPER_PHONE || "0725757767";
  const systemDeveloperInstitutionName =
    process.env.SYSTEM_DEVELOPER_INSTITUTION_NAME || "MWENDEGU ENTERPRISE LIMITED";
  const systemDeveloperInstitutionCode =
    process.env.SYSTEM_DEVELOPER_INSTITUTION_CODE || "254001";
  const maxSystemDevelopers = Number(process.env.SYSTEM_DEVELOPER_MAX_ACCOUNTS || 50);
  const passwordHash = await hashPassword(password);
  let systemDeveloperInstitutionId = defaultInstitutionId;
  const institutionRows = await query(
    `SELECT id
     FROM institutions
     WHERE institution_code = ?
        OR institution_name = ?
     ORDER BY id ASC
     LIMIT 1`,
    [systemDeveloperInstitutionCode, systemDeveloperInstitutionName]
  );
  if (institutionRows.length) {
    systemDeveloperInstitutionId = institutionRows[0].id;
    await query(
      `UPDATE institutions
       SET institution_name = ?,
           institution_code = ?,
           email = COALESCE(NULLIF(email, ''), ?),
           phone = COALESCE(NULLIF(phone, ''), ?)
       WHERE id = ?`,
      [
        systemDeveloperInstitutionName,
        systemDeveloperInstitutionCode,
        systemDeveloperEmail,
        systemDeveloperPhone,
        systemDeveloperInstitutionId
      ]
    );
  } else {
    const insertedInstitution = await query(
      `INSERT INTO institutions (institution_name, institution_code, email, phone, county, sub_county, location, village)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        systemDeveloperInstitutionName,
        systemDeveloperInstitutionCode,
        systemDeveloperEmail,
        systemDeveloperPhone,
        "N/A",
        "N/A",
        "N/A",
        "N/A"
      ]
    );
    systemDeveloperInstitutionId = insertedInstitution.insertId || defaultInstitutionId;
  }
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
        systemDeveloperInstitutionId,
        systemDeveloperFullName,
        username,
        passwordHash,
        ROLES.SYSTEM_DEVELOPER,
        systemDeveloperEmail,
        systemDeveloperPhone
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
      systemDeveloperInstitutionId,
      systemDeveloperFullName,
      passwordHash,
      ROLES.SYSTEM_DEVELOPER,
      username
    ]
  );
  await query(
    `UPDATE users
     SET email = ?,
         phone = ?
     WHERE username = ?`,
    [systemDeveloperEmail, systemDeveloperPhone, username]
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

  const institutionPostalAddressRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'institutions'
       AND COLUMN_NAME = 'postal_address'`
  );
  if (!Number(institutionPostalAddressRows[0]?.total || 0)) {
    await query("ALTER TABLE institutions ADD COLUMN postal_address VARCHAR(255) NULL");
  }

  const institutionCategoryRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'institutions'
       AND COLUMN_NAME = 'category'`
  );
  if (!Number(institutionCategoryRows[0]?.total || 0)) {
    // Backward compatibility for older search queries that still reference institutions.category.
    await query("ALTER TABLE institutions ADD COLUMN category VARCHAR(100) NULL");
  }

  const institutionHeroImagePathRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'institutions'
       AND COLUMN_NAME = 'login_hero_image_path'`
  );
  if (!Number(institutionHeroImagePathRows[0]?.total || 0)) {
    await query("ALTER TABLE institutions ADD COLUMN login_hero_image_path VARCHAR(255) NULL");
  }

  const institutionAgreementTemplateRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'institutions'
       AND COLUMN_NAME = 'agreement_template_text'`
  );
  if (!Number(institutionAgreementTemplateRows[0]?.total || 0)) {
    await query("ALTER TABLE institutions ADD COLUMN agreement_template_text TEXT NULL");
  }

  const institutionAgreementTemplateFileRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'institutions'
       AND COLUMN_NAME = 'agreement_template_file_url'`
  );
  if (!Number(institutionAgreementTemplateFileRows[0]?.total || 0)) {
    await query("ALTER TABLE institutions ADD COLUMN agreement_template_file_url VARCHAR(255) NULL");
  }

  const institutionActiveRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'institutions'
       AND COLUMN_NAME = 'is_active'`
  );
  if (!Number(institutionActiveRows[0]?.total || 0)) {
    await query("ALTER TABLE institutions ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1");
  }

  const institutionSuspendedRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'institutions'
       AND COLUMN_NAME = 'is_suspended'`
  );
  if (!Number(institutionSuspendedRows[0]?.total || 0)) {
    await query("ALTER TABLE institutions ADD COLUMN is_suspended TINYINT(1) NOT NULL DEFAULT 0");
  }

  const institutionStatusReasonRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'institutions'
       AND COLUMN_NAME = 'status_reason'`
  );
  if (!Number(institutionStatusReasonRows[0]?.total || 0)) {
    await query("ALTER TABLE institutions ADD COLUMN status_reason TEXT NULL");
  }

  const userSuspendedRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'is_suspended'`
  );
  if (!Number(userSuspendedRows[0]?.total || 0)) {
    await query("ALTER TABLE users ADD COLUMN is_suspended TINYINT(1) NOT NULL DEFAULT 0");
  }

  const userStatusReasonRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'status_reason'`
  );
  if (!Number(userStatusReasonRows[0]?.total || 0)) {
    await query("ALTER TABLE users ADD COLUMN status_reason TEXT NULL");
  }

  const institutionSuspendedReasonRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'institutions'
       AND COLUMN_NAME = 'suspended_reason'`
  );
  if (!Number(institutionSuspendedReasonRows[0]?.total || 0)) {
    await query("ALTER TABLE institutions ADD COLUMN suspended_reason TEXT NULL");
  }

  // status_updated_at + status_updated_by_user_id are referenced by the
  // institution suspend/deactivate UPDATE in app.js but were missing from
  // both schema.sql and the migration loop. Without them, suspending an
  // institution from the SysDev console throws ER_BAD_FIELD_ERROR.
  const institutionStatusUpdatedAtRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'institutions'
       AND COLUMN_NAME = 'status_updated_at'`
  );
  if (!Number(institutionStatusUpdatedAtRows[0]?.total || 0)) {
    await query("ALTER TABLE institutions ADD COLUMN status_updated_at DATETIME NULL");
  }

  const institutionStatusUpdatedByRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'institutions'
       AND COLUMN_NAME = 'status_updated_by_user_id'`
  );
  if (!Number(institutionStatusUpdatedByRows[0]?.total || 0)) {
    await query("ALTER TABLE institutions ADD COLUMN status_updated_by_user_id BIGINT NULL");
  }

  const userSuspendedReasonRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'suspended_reason'`
  );
  if (!Number(userSuspendedReasonRows[0]?.total || 0)) {
    await query("ALTER TABLE users ADD COLUMN suspended_reason TEXT NULL");
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

  const modulePermissionRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'user_module_access_overrides'
       AND COLUMN_NAME = 'permission_key'`
  );
  if (!Number(modulePermissionRows[0]?.total || 0)) {
    await query("ALTER TABLE user_module_access_overrides ADD COLUMN permission_key VARCHAR(60) NULL AFTER module_key");
    await query(
      `UPDATE user_module_access_overrides
       SET permission_key = 'ACCESS'
       WHERE permission_key IS NULL`
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

  const recycleBinHiddenRolesRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'recycle_bin_items'
       AND COLUMN_NAME = 'hidden_for_roles_json'`
  );
  if (!Number(recycleBinHiddenRolesRows[0]?.total || 0)) {
    await query("ALTER TABLE recycle_bin_items ADD COLUMN hidden_for_roles_json JSON NULL");
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
        form_name VARCHAR(60) NULL,
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

  const cbcStructureMappingRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'cbc_structure_mappings'`
  );
  if (!Number(cbcStructureMappingRows[0]?.total || 0)) {
    await query(
      `CREATE TABLE cbc_structure_mappings (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        institution_id BIGINT NOT NULL,
        learning_area VARCHAR(180) NOT NULL,
        strand VARCHAR(180) NOT NULL,
        sub_strand VARCHAR(180) NOT NULL,
        notes TEXT NULL,
        grade VARCHAR(60) NULL,
        form_name VARCHAR(60) NULL,
        source_label VARCHAR(120) NULL,
        created_by_user_id BIGINT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_cbc_mapping_lookup (institution_id, learning_area, grade, form_name, strand)
      )`
    );
  }
  const cbcStructureNotesRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'cbc_structure_mappings'
       AND COLUMN_NAME = 'notes'`
  );
  if (!Number(cbcStructureNotesRows[0]?.total || 0)) {
    await query("ALTER TABLE cbc_structure_mappings ADD COLUMN notes TEXT NULL AFTER sub_strand");
  }
  const cbcCurriculumColumns = await query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'cbc_curriculum_entries'`
  );
  const cbcColumnSet = new Set((cbcCurriculumColumns || []).map((row) => String(row?.COLUMN_NAME || "").toLowerCase()));
  if (!cbcColumnSet.has("form_name")) {
    await query("ALTER TABLE cbc_curriculum_entries ADD COLUMN form_name VARCHAR(60) NULL AFTER grade");
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

  const learnersReasonLeavingRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'learners'
       AND COLUMN_NAME = 'reason_for_leaving'`
  );
  if (!Number(learnersReasonLeavingRows[0]?.total || 0)) {
    await query("ALTER TABLE learners ADD COLUMN reason_for_leaving VARCHAR(120) NULL");
  }

  const learnerColMigrations = [
    ["learner_condition", "VARCHAR(80) NULL"],
    ["disability_type", "VARCHAR(120) NULL"],
    ["biological_parental_status", "VARCHAR(80) NULL"],
    ["parent_phone_secondary", "VARCHAR(50) NULL"],
    ["parent2_full_name", "VARCHAR(255) NULL"],
    ["parent2_id_number", "VARCHAR(120) NULL"],
    ["parent2_phone_primary", "VARCHAR(50) NULL"],
    ["parent2_phone_secondary", "VARCHAR(50) NULL"],
    ["parent2_nationality", "VARCHAR(100) NULL"],
    ["parent2_residence", "VARCHAR(255) NULL"],
    ["parent2_occupation", "VARCHAR(150) NULL"],
    ["parent2_email", "VARCHAR(255) NULL"],
    ["parent2_relationship", "VARCHAR(80) NULL"],
    // conduct_status is referenced by the dashboard (Suspended / Expelled / Drop
    // Out / Completion / Transferred cards) but was never present in
    // sql/schema.sql nor previously migrated. Add it idempotently here so
    // existing databases gain the column on next startup.
    ["conduct_status", "VARCHAR(80) NULL"],
    ["postal_address", "VARCHAR(255) NULL"],
    ["postal_code", "VARCHAR(20) NULL"],
    ["town", "VARCHAR(120) NULL"]
  ];
  for (const [colName, ddl] of learnerColMigrations) {
    // eslint-disable-next-line no-await-in-loop
    const checkCol = await query(
      `SELECT COUNT(*) total
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'learners'
         AND COLUMN_NAME = ?`,
      [colName]
    );
    // eslint-disable-next-line no-await-in-loop
    if (!Number(checkCol[0]?.total || 0)) {
      await query(`ALTER TABLE learners ADD COLUMN ${colName} ${ddl}`);
    }
  }

  const teacherEmploymentStatusRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'teacher_profiles'
       AND COLUMN_NAME = 'employment_status'`
  );
  if (!Number(teacherEmploymentStatusRows[0]?.total || 0)) {
    await query("ALTER TABLE teacher_profiles ADD COLUMN employment_status VARCHAR(60) NOT NULL DEFAULT 'Active'");
  }

  const teacherLeaveStatusRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'teacher_profiles'
       AND COLUMN_NAME = 'leave_status'`
  );
  if (!Number(teacherLeaveStatusRows[0]?.total || 0)) {
    await query("ALTER TABLE teacher_profiles ADD COLUMN leave_status VARCHAR(60) NULL");
  }

  const teacherAccountabilityStatusRows = await query(
    `SELECT COUNT(*) total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'teacher_profiles'
       AND COLUMN_NAME = 'accountability_status'`
  );
  if (!Number(teacherAccountabilityStatusRows[0]?.total || 0)) {
    await query("ALTER TABLE teacher_profiles ADD COLUMN accountability_status VARCHAR(60) NULL");
  }

  const teacherPostalCols = [
    ["postal_address", "VARCHAR(255) NULL"],
    ["town", "VARCHAR(120) NULL"],
    ["postal_code", "VARCHAR(20) NULL"],
    ["email_address", "VARCHAR(255) NULL"],
    ["passport_photo_path", "VARCHAR(255) NULL"]
  ];
  for (const [colName, ddl] of teacherPostalCols) {
    // eslint-disable-next-line no-await-in-loop
    const chk = await query(
      `SELECT COUNT(*) total FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'teacher_profiles' AND COLUMN_NAME = ?`,
      [colName]
    );
    // eslint-disable-next-line no-await-in-loop
    if (!Number(chk[0]?.total || 0)) {
      await query(`ALTER TABLE teacher_profiles ADD COLUMN ${colName} ${ddl}`);
    }
  }

  const supportPostalCols = [
    ["email_address", "VARCHAR(255) NULL"],
    ["postal_address", "VARCHAR(255) NULL"],
    ["town", "VARCHAR(120) NULL"],
    ["postal_code", "VARCHAR(20) NULL"],
    ["next_of_kin_email", "VARCHAR(255) NULL"],
    ["next_of_kin_mobile", "VARCHAR(60) NULL"],
    ["passport_photo_path", "VARCHAR(255) NULL"],
    ["next_of_kin_relationship", "VARCHAR(100) NULL"]
  ];
  for (const [colName, ddl] of supportPostalCols) {
    // eslint-disable-next-line no-await-in-loop
    const chk = await query(
      `SELECT COUNT(*) total FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'non_teaching_staff_profiles' AND COLUMN_NAME = ?`,
      [colName]
    );
    // eslint-disable-next-line no-await-in-loop
    if (!Number(chk[0]?.total || 0)) {
      await query(`ALTER TABLE non_teaching_staff_profiles ADD COLUMN ${colName} ${ddl}`);
    }
  }

  await query(`
CREATE TABLE IF NOT EXISTS service_provider_profiles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255) NULL,
  id_number VARCHAR(120) NULL,
  service_rendered VARCHAR(255) NULL,
  postal_address VARCHAR(255) NULL,
  town VARCHAR(120) NULL,
  postal_code VARCHAR(20) NULL,
  phone_number VARCHAR(60) NULL,
  email_address VARCHAR(255) NULL,
  next_of_kin_name VARCHAR(255) NULL,
  next_of_kin_relationship VARCHAR(100) NULL,
  next_of_kin_mobile VARCHAR(60) NULL,
  next_of_kin_email VARCHAR(255) NULL,
  passport_photo_path VARCHAR(255) NULL,
  employment_status VARCHAR(60) NOT NULL DEFAULT 'Active',
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_service_providers_institution (institution_id, full_name),
  CONSTRAINT fk_service_providers_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
)`);

  await query(`
CREATE TABLE IF NOT EXISTS bom_profiles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  id_number VARCHAR(120) NULL,
  postal_address VARCHAR(255) NULL,
  town VARCHAR(120) NULL,
  postal_code VARCHAR(20) NULL,
  phone_number VARCHAR(60) NULL,
  email_address VARCHAR(255) NULL,
  passport_photo_path VARCHAR(255) NULL,
  employment_status VARCHAR(60) NOT NULL DEFAULT 'Active',
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bom_institution (institution_id, full_name),
  CONSTRAINT fk_bom_profiles_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
)`);

  await query(`
CREATE TABLE IF NOT EXISTS institution_streams (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  grade_or_form VARCHAR(60) NULL,
  stream_name VARCHAR(120) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_stream_per_institution (institution_id, grade_or_form, stream_name),
  INDEX idx_stream_institution (institution_id, is_active),
  CONSTRAINT fk_stream_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
)`);

  await query(`
CREATE TABLE IF NOT EXISTS teacher_timetable (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  teacher_profile_id BIGINT NOT NULL,
  teacher_name VARCHAR(255) NULL,
  timetable_category VARCHAR(60) NOT NULL DEFAULT 'Normal Lesson',
  term VARCHAR(30) NULL,
  grade VARCHAR(60) NULL,
  stream VARCHAR(60) NULL,
  learning_area VARCHAR(120) NULL,
  day_of_week VARCHAR(20) NULL,
  lesson_order INT NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  lessons_per_week INT NULL,
  is_manual_time TINYINT(1) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  generated_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_timetable_teacher (institution_id, teacher_profile_id),
  INDEX idx_timetable_day (institution_id, day_of_week, start_time),
  CONSTRAINT fk_timetable_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
)`);

  await query(`
CREATE TABLE IF NOT EXISTS learner_discipline_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  learner_id BIGINT NULL,
  learner_name VARCHAR(255) NULL,
  grade VARCHAR(60) NULL,
  stream VARCHAR(60) NULL,
  category VARCHAR(160) NOT NULL,
  custom_breach VARCHAR(255) NULL,
  occurred_at DATETIME NULL,
  other_persons_involved VARCHAR(255) NULL,
  action_taken TEXT NULL,
  recorded_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_discipline_institution (institution_id, grade, stream),
  CONSTRAINT fk_discipline_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
)`);

  // Idempotent column additions for rev44 HR leave workflow
  const leaveCols = [
    ["amended_days", "INT NULL"],
    ["approval_comment", "TEXT NULL"],
    ["approved_by_user_id", "VARCHAR(100) NULL"]
  ];
  for (const [colName, ddl] of leaveCols) {
    // eslint-disable-next-line no-await-in-loop
    const chk = await query(
      `SELECT COUNT(*) total FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hr_leave_requests' AND COLUMN_NAME = ?`,
      [colName]
    );
    if (!Number(chk[0]?.total || 0)) {
      // eslint-disable-next-line no-await-in-loop
      await query(`ALTER TABLE hr_leave_requests ADD COLUMN ${colName} ${ddl}`);
    }
  }

  await query(`
CREATE TABLE IF NOT EXISTS hr_institutional_letters (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  record_type VARCHAR(120) NOT NULL,
  title VARCHAR(255) NULL,
  target_user_id BIGINT NULL,
  target_staff_name VARCHAR(255) NULL,
  target_staff_category VARCHAR(80) NULL,
  target_id_number VARCHAR(120) NULL,
  target_mobile VARCHAR(60) NULL,
  target_email VARCHAR(255) NULL,
  terms_of_service VARCHAR(80) NULL,
  position_name VARCHAR(200) NULL,
  description TEXT NULL,
  body_text LONGTEXT NULL,
  file_path VARCHAR(255) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'Draft',
  created_by_user_id VARCHAR(100) NULL,
  issued_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_hr_letters_inst_type (institution_id, record_type),
  INDEX idx_hr_letters_target (institution_id, target_user_id),
  CONSTRAINT fk_hr_letters_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
)`);

  await query(`
CREATE TABLE IF NOT EXISTS institutional_registers (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  register_type VARCHAR(160) NOT NULL,
  title VARCHAR(255) NULL,
  description TEXT NULL,
  file_path VARCHAR(255) NULL,
  file_name VARCHAR(255) NULL,
  uploaded_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_registers_inst_type (institution_id, register_type),
  CONSTRAINT fk_registers_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
)`);
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
  const idxFp = readPublicIndexFingerprint();
  const portShiftNote =
    boundPort !== PORT
      ? `
  [!] Port ${PORT} is in use — this server bound to :${boundPort}.
      Use the URL above. If you still open :${PORT}, you may be hitting a *different* OLD Node process with stale files. Run: Get-Process node | Stop-Process -Force then npm start again.
`
      : "";

  const banner = `
================================================================================
  IIMS SERVER STARTED
  Folder (cwd): ${cwd}
  URL:          http://localhost:${boundPort}
  Release:      ${IIMS_BUILD_STAMP}
  Index UX:     STEP1_IDX_REV=${idxFp.step1_index_rev ?? "?"}, styles.css?v=${idxFp.styles_css_query_v ?? "?"}
  Check API:    http://localhost:${boundPort}/api/build-info
  Static test:  http://localhost:${boundPort}/build-check.txt
  If Release or the Index UX line looks stale after git pull, stop every Node process and npm start once.
${portShiftNote}================================================================================`;
  // eslint-disable-next-line no-console
  console.log(banner);
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server:", error);
  process.exit(1);
});
