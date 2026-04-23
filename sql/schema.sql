CREATE DATABASE IF NOT EXISTS iims_school_system;
USE iims_school_system;

CREATE TABLE IF NOT EXISTS institutions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_name VARCHAR(255) NOT NULL,
  institution_code VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255) NULL,
  phone VARCHAR(50) NULL,
  county VARCHAR(100) NULL,
  sub_county VARCHAR(100) NULL,
  location VARCHAR(100) NULL,
  postal_address VARCHAR(255) NULL,
  agreement_template_text TEXT NULL,
  agreement_template_file_url VARCHAR(255) NULL,
  village VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS institution_agreement_templates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NULL,
  template_name VARCHAR(180) NOT NULL,
  file_name VARCHAR(255) NULL,
  file_path VARCHAR(255) NULL,
  mime_type VARCHAR(120) NULL,
  template_text LONGTEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_agreement_template_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  username VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1) DEFAULT 0,
  password_expires_at DATETIME NULL,
  password_last_changed_at DATETIME NULL,
  role VARCHAR(60) NOT NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(50) NULL,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  last_failed_login_at DATETIME NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_by BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_per_institution (institution_id, username),
  CONSTRAINT fk_users_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS user_module_access_overrides (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  module_key VARCHAR(120) NOT NULL,
  can_access TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_module_override_lookup (user_id, module_key, created_at),
  CONSTRAINT fk_user_module_overrides_institution FOREIGN KEY (institution_id) REFERENCES institutions(id),
  CONSTRAINT fk_user_module_overrides_user FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS recycle_bin_items (
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
  INDEX idx_recycle_bin_lookup (institution_id, entity_name, status, deleted_at),
  CONSTRAINT fk_recycle_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS cbc_curriculum_entries (
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
  INDEX idx_cbc_curriculum_inst_lookup (institution_id, grade, learning_area, term, year),
  CONSTRAINT fk_cbc_curriculum_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS otp_sessions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(80) NOT NULL UNIQUE,
  identity_value VARCHAR(180) NOT NULL,
  role_name VARCHAR(60) NOT NULL,
  institution_id BIGINT NOT NULL,
  payload_json JSON NOT NULL,
  otp_code VARCHAR(20) NOT NULL,
  otp_channel VARCHAR(20) NOT NULL DEFAULT 'console',
  destination VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  is_used TINYINT(1) DEFAULT 0,
  verify_attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  last_attempt_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_otp_identity (identity_value),
  INDEX idx_otp_expiry (expires_at),
  CONSTRAINT fk_otp_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NULL,
  actor_user_id VARCHAR(100) NULL,
  actor_role VARCHAR(60) NULL,
  action VARCHAR(120) NOT NULL,
  entity_name VARCHAR(120) NULL,
  entity_id VARCHAR(80) NULL,
  details_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_activity_institution (institution_id)
);

CREATE TABLE IF NOT EXISTS learners (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NOT NULL,
  other_names VARCHAR(200) NULL,
  admission_number VARCHAR(80) NOT NULL,
  date_of_admission DATE NULL,
  grade VARCHAR(60) NOT NULL,
  form_name VARCHAR(60) NULL,
  stream VARCHAR(80) NULL,
  assessment_number VARCHAR(120) NULL,
  upi_number VARCHAR(120) NULL,
  birth_certificate_number VARCHAR(120) NOT NULL,
  date_of_birth DATE NULL,
  gender VARCHAR(20) NULL,
  passport_photo_path VARCHAR(255) NULL,
  religion VARCHAR(100) NULL,
  nationality VARCHAR(100) NULL,
  county VARCHAR(100) NULL,
  sub_county VARCHAR(100) NULL,
  location VARCHAR(100) NULL,
  sub_location VARCHAR(100) NULL,
  village VARCHAR(100) NULL,
  year_joined INT NULL,
  term_joined VARCHAR(40) NULL,
  orphan_condition VARCHAR(60) NULL,
  status VARCHAR(60) NULL,
  conduct_status VARCHAR(40) DEFAULT 'In Session',
  parent_full_name VARCHAR(255) NULL,
  parent_relationship VARCHAR(50) NULL,
  parent_id_number VARCHAR(120) NULL,
  parent_phone VARCHAR(50) NULL,
  parent_email VARCHAR(255) NULL,
  learner_password_hash VARCHAR(255) NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_adm_per_institution (institution_id, admission_number),
  INDEX idx_learners_search_1 (institution_id, full_name),
  INDEX idx_learners_search_2 (institution_id, upi_number),
  INDEX idx_learners_search_3 (institution_id, assessment_number),
  INDEX idx_learners_search_4 (institution_id, birth_certificate_number),
  CONSTRAINT fk_learners_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS teacher_profiles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  tsc_number VARCHAR(120) NOT NULL,
  id_number VARCHAR(120) NOT NULL,
  phone_number VARCHAR(60) NULL,
  category VARCHAR(80) NULL,
  major_subject VARCHAR(150) NULL,
  other_subject VARCHAR(150) NULL,
  next_of_kin_name VARCHAR(255) NULL,
  next_of_kin_relationship VARCHAR(100) NULL,
  next_of_kin_mobile VARCHAR(60) NULL,
  next_of_kin_email VARCHAR(255) NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_teachers_institution_name (institution_id, full_name),
  CONSTRAINT fk_teacher_profiles_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS non_teaching_staff_profiles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  staff_number VARCHAR(120) NOT NULL,
  id_number VARCHAR(120) NULL,
  phone_number VARCHAR(60) NULL,
  position_department VARCHAR(160) NULL,
  next_of_kin_name VARCHAR(255) NULL,
  next_of_kin_contact VARCHAR(255) NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_non_teaching_institution_name (institution_id, full_name),
  CONSTRAINT fk_non_teaching_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS teacher_resources (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  teacher_profile_id BIGINT NULL,
  resource_type VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  grade VARCHAR(60) NULL,
  stream VARCHAR(60) NULL,
  term VARCHAR(40) NULL,
  strand VARCHAR(120) NULL,
  sub_strand VARCHAR(120) NULL,
  file_path VARCHAR(255) NULL,
  auto_generated TINYINT(1) DEFAULT 0,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_teacher_resources_inst (institution_id, resource_type),
  CONSTRAINT fk_teacher_resources_institution FOREIGN KEY (institution_id) REFERENCES institutions(id),
  CONSTRAINT fk_teacher_resources_teacher FOREIGN KEY (teacher_profile_id) REFERENCES teacher_profiles(id)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  attendance_type VARCHAR(30) NOT NULL,
  person_id VARCHAR(100) NOT NULL,
  person_name VARCHAR(255) NOT NULL,
  grade VARCHAR(60) NULL,
  stream VARCHAR(80) NULL,
  attendance_date DATETIME NOT NULL,
  time_in DATETIME NULL,
  time_out DATETIME NULL,
  status VARCHAR(30) NOT NULL,
  reason VARCHAR(255) NULL,
  comments TEXT NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_attendance_main (institution_id, attendance_type, attendance_date),
  CONSTRAINT fk_attendance_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS academic_exams (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  grade VARCHAR(60) NULL,
  stream VARCHAR(60) NULL,
  subject VARCHAR(150) NULL,
  strand VARCHAR(120) NULL,
  sub_strand VARCHAR(120) NULL,
  notes_file_path VARCHAR(255) NULL,
  generated_exam_text LONGTEXT NULL,
  exam_file_path VARCHAR(255) NULL,
  term VARCHAR(40) NULL,
  year INT NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_exams_inst_grade_subject (institution_id, grade, subject),
  CONSTRAINT fk_exams_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS academic_marks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  learner_id BIGINT NOT NULL,
  learner_name VARCHAR(255) NOT NULL,
  upi_number VARCHAR(120) NULL,
  assessment_number VARCHAR(120) NULL,
  birth_certificate_number VARCHAR(120) NULL,
  grade VARCHAR(60) NULL,
  stream VARCHAR(80) NULL,
  exam_type VARCHAR(80) NOT NULL,
  subject VARCHAR(150) NOT NULL,
  marks DECIMAL(6,2) NOT NULL,
  percentage DECIMAL(6,2) NULL,
  cbc_grade_band VARCHAR(20) NULL,
  term VARCHAR(40) NULL,
  year INT NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_marks_inst_learner (institution_id, learner_id),
  INDEX idx_marks_inst_grade (institution_id, grade, stream),
  CONSTRAINT fk_marks_institution FOREIGN KEY (institution_id) REFERENCES institutions(id),
  CONSTRAINT fk_marks_learner FOREIGN KEY (learner_id) REFERENCES learners(id)
);

CREATE TABLE IF NOT EXISTS hr_leave_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  staff_profile_type VARCHAR(50) NOT NULL,
  staff_profile_id BIGINT NULL,
  staff_name VARCHAR(255) NOT NULL,
  leave_type VARCHAR(80) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  reason TEXT NULL,
  status VARCHAR(40) DEFAULT 'Pending',
  applied_by_user_id BIGINT NULL,
  approved_by_user_id BIGINT NULL,
  approval_stage VARCHAR(80) DEFAULT 'Member',
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_leave_inst_status (institution_id, status),
  CONSTRAINT fk_leave_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS hr_recruitment_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  record_type VARCHAR(80) NOT NULL,
  position_name VARCHAR(200) NULL,
  candidate_name VARCHAR(255) NULL,
  candidate_id_number VARCHAR(120) NULL,
  candidate_mobile VARCHAR(50) NULL,
  terms_of_service VARCHAR(80) NULL,
  job_description TEXT NULL,
  comments TEXT NULL,
  upload_file_path VARCHAR(255) NULL,
  deadline_date DATE NULL,
  status VARCHAR(40) DEFAULT 'Pending',
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_recruitment_inst_type (institution_id, record_type),
  CONSTRAINT fk_recruitment_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS finance_fee_structures (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  grade VARCHAR(60) NOT NULL,
  stream VARCHAR(80) NULL,
  term VARCHAR(40) NOT NULL,
  year INT NOT NULL,
  amount_required DECIMAL(12,2) NOT NULL,
  description TEXT NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fee_structure_inst_grade (institution_id, grade, term, year),
  CONSTRAINT fk_fee_structure_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS finance_fee_payments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  learner_id BIGINT NOT NULL,
  learner_name VARCHAR(255) NOT NULL,
  admission_number VARCHAR(120) NULL,
  grade VARCHAR(60) NULL,
  stream VARCHAR(80) NULL,
  amount_paid DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR(80) NULL,
  receipt_number VARCHAR(100) NOT NULL,
  payment_date DATETIME NOT NULL,
  balance_after_payment DECIMAL(12,2) NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fee_payments_inst_learner (institution_id, learner_id),
  INDEX idx_fee_payments_receipt (receipt_number),
  CONSTRAINT fk_fee_payment_institution FOREIGN KEY (institution_id) REFERENCES institutions(id),
  CONSTRAINT fk_fee_payment_learner FOREIGN KEY (learner_id) REFERENCES learners(id)
);

CREATE TABLE IF NOT EXISTS finance_procurement_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  document_type VARCHAR(60) NOT NULL,
  document_number VARCHAR(100) NOT NULL,
  supplier_name VARCHAR(255) NOT NULL,
  item_name VARCHAR(255) NULL,
  description TEXT NULL,
  quantity DECIMAL(10,2) NULL,
  amount DECIMAL(12,2) NULL,
  document_date DATE NULL,
  due_date DATE NULL,
  status VARCHAR(60) DEFAULT 'Draft',
  file_path VARCHAR(255) NULL,
  qr_code_text VARCHAR(255) NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_procurement_inst_type (institution_id, document_type),
  CONSTRAINT fk_procurement_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS finance_payroll_records (
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
  INDEX idx_payroll_lookup (institution_id, payroll_year, payroll_month, staff_name),
  CONSTRAINT fk_payroll_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS finance_salary_advances (
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
  INDEX idx_salary_advance_lookup (institution_id, approval_status, processing_status, repayment_status, staff_name),
  CONSTRAINT fk_salary_advance_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS communication_messages (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  message_type VARCHAR(60) NOT NULL,
  recipient_role VARCHAR(60) NULL,
  recipient_contact VARCHAR(255) NULL,
  message_body TEXT NOT NULL,
  status VARCHAR(40) DEFAULT 'Queued',
  sent_at DATETIME NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_comm_message_inst_status (institution_id, status),
  CONSTRAINT fk_comm_message_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS communication_announcements (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  audience VARCHAR(120) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_announcements_inst_dates (institution_id, start_date, end_date),
  CONSTRAINT fk_announcement_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS communication_chat_messages (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  thread_key VARCHAR(160) NOT NULL,
  parent_learner_id BIGINT NULL,
  sender_user_id VARCHAR(100) NULL,
  sender_role VARCHAR(60) NOT NULL,
  sender_name VARCHAR(255) NULL,
  audience_role VARCHAR(60) NULL,
  message_body TEXT NOT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_chat_inst_thread (institution_id, thread_key, created_at),
  INDEX idx_chat_inst_read (institution_id, is_read),
  CONSTRAINT fk_chat_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS learner_resources (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  subject VARCHAR(150) NULL,
  grade VARCHAR(60) NULL,
  stream VARCHAR(80) NULL,
  resource_format VARCHAR(100) NULL,
  file_path VARCHAR(255) NULL,
  description TEXT NULL,
  uploaded_by_user_id BIGINT NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_learner_resources_inst_grade (institution_id, grade, stream),
  CONSTRAINT fk_learner_resources_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS welfare_members (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  member_name VARCHAR(255) NOT NULL,
  member_role VARCHAR(80) NOT NULL,
  phone_number VARCHAR(50) NULL,
  email VARCHAR(255) NULL,
  joined_date DATE NULL,
  status VARCHAR(40) DEFAULT 'Active',
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_welfare_members_inst (institution_id, member_name),
  CONSTRAINT fk_welfare_members_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);

CREATE TABLE IF NOT EXISTS welfare_contributions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  member_name VARCHAR(255) NOT NULL,
  contribution_period VARCHAR(80) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_mode VARCHAR(80) NULL,
  payment_date DATE NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_welfare_contributions_inst_member (institution_id, member_id),
  CONSTRAINT fk_welfare_contributions_institution FOREIGN KEY (institution_id) REFERENCES institutions(id),
  CONSTRAINT fk_welfare_contributions_member FOREIGN KEY (member_id) REFERENCES welfare_members(id)
);

CREATE TABLE IF NOT EXISTS welfare_loans (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  member_name VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  application_date DATE NOT NULL,
  return_date DATE NULL,
  status VARCHAR(40) DEFAULT 'Pending',
  loan_officer_approval VARCHAR(40) DEFAULT 'Pending',
  principal_approval VARCHAR(40) DEFAULT 'Pending',
  repayment_status VARCHAR(40) DEFAULT 'Not Started',
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_welfare_loans_inst_status (institution_id, status),
  CONSTRAINT fk_welfare_loans_institution FOREIGN KEY (institution_id) REFERENCES institutions(id),
  CONSTRAINT fk_welfare_loans_member FOREIGN KEY (member_id) REFERENCES welfare_members(id)
);

CREATE TABLE IF NOT EXISTS laws_regulations_policies (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  institution_id BIGINT NOT NULL,
  document_category VARCHAR(80) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  file_path VARCHAR(255) NULL,
  effective_date DATE NULL,
  uploaded_by_user_id BIGINT NULL,
  created_by_user_id VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_laws_inst_category (institution_id, document_category),
  CONSTRAINT fk_laws_institution FOREIGN KEY (institution_id) REFERENCES institutions(id)
);
