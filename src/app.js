const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const dayjs = require("dayjs");
const { query } = require("./config/db");
const {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  GRADES,
  FORMS,
  TERMS,
  GENDER_OPTIONS,
  ADMISSION_STATUS,
  ORPHAN_STATUS,
  RELATIONSHIP_OPTIONS,
  STAFF_CATEGORY,
  SUBJECTS,
  EXAM_TYPES,
  LEAVE_TYPES,
  TERMS_OF_SERVICE,
  DOCUMENT_CATEGORIES,
  EXPORT_FORMATS
} = require("./config/constants");
const { auth } = require("./middleware/auth");
const { hashPassword, verifyPassword } = require("./utils/password");
const { sendSimplePdf, sendSimpleExcel } = require("./services/exportService");
const { generateOtpCode, buildOtpExpiry, sendOtp } = require("./services/otpService");
const { buildSearchWhere } = require("./utils/sql");

const app = express();

const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5000";
app.use(
  cors({
    origin: frontendOrigin,
    credentials: true
  })
);
app.use(helmet());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const uploadsPath = path.join(process.cwd(), "uploads");
const publicPath = path.join(process.cwd(), "public");
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

app.use("/uploads", express.static(uploadsPath));
app.use(express.static(publicPath));
app.get("/", (_, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsPath),
    filename: (_, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  })
});

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function issueToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d"
  });
}

async function auditLog(user, action, entity, entityId, details = null) {
  await query(
    `INSERT INTO activity_logs
      (institution_id, actor_user_id, actor_role, action, entity_name, entity_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      user?.institution_id || null,
      user?.id || null,
      user?.role || null,
      action,
      entity,
      entityId || null,
      details ? JSON.stringify(details) : null
    ]
  );
}

function hasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

function enforcePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({ error: `Missing permission: ${permission}` });
    }
    return next();
  };
}

function enforceRole(roles = []) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Role is not allowed for this action." });
    }
    return next();
  };
}

function toPortal(role) {
  switch (role) {
    case ROLES.ADMIN:
      return "Administrator Dashboard";
    case ROLES.HEAD_OF_INSTITUTION:
      return "Head of Institution Portal";
    case ROLES.TEACHER:
      return "Teacher Portal";
    case ROLES.LEARNER:
      return "Learners Portal";
    default:
      return "General Portal";
  }
}

function pickFields(payload, allowedFields) {
  return allowedFields.reduce((acc, field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      acc[field] = payload[field];
    }
    return acc;
  }, {});
}

async function createOtpSession({ identity, role, institutionId, payload, destination, channel }) {
  const code = generateOtpCode();
  const expiresAt = buildOtpExpiry();
  await query(
    `INSERT INTO otp_sessions
      (session_id, identity_value, role_name, institution_id, payload_json, otp_code, expires_at, otp_channel, destination)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      identity,
      role,
      institutionId,
      JSON.stringify(payload),
      code,
      expiresAt,
      channel,
      destination
    ]
  );
  await sendOtp({ channel, destination, code });
}

async function authenticateByUserTable(username, password) {
  const users = await query(
    "SELECT * FROM users WHERE username = ? AND is_active = 1 LIMIT 1",
    [username]
  );
  if (!users.length) {
    return null;
  }
  const user = users[0];
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return null;
  }

  return {
    identity: user.username,
    role: user.role,
    institution_id: user.institution_id,
    destination: user.email || user.phone || user.username,
    payload: {
      id: user.id,
      role: user.role,
      institution_id: user.institution_id,
      full_name: user.full_name,
      username: user.username
    }
  };
}

async function authenticateParentByLearner(username, password) {
  const learners = await query(
    `SELECT id, institution_id, full_name, parent_full_name, parent_phone, parent_email, parent_id_number
     FROM learners
     WHERE birth_certificate_number = ? AND parent_id_number = ? LIMIT 1`,
    [username, password]
  );

  if (!learners.length) {
    return null;
  }

  const learner = learners[0];
  return {
    identity: username,
    role: ROLES.PARENT,
    institution_id: learner.institution_id,
    destination: learner.parent_email || learner.parent_phone || username,
    payload: {
      id: `PARENT-${learner.id}`,
      role: ROLES.PARENT,
      institution_id: learner.institution_id,
      learner_id: learner.id,
      learner_name: learner.full_name,
      full_name: learner.parent_full_name || "Parent User",
      username
    }
  };
}

async function authenticateLearner(username, password) {
  const learners = await query(
    `SELECT id, institution_id, full_name, upi_number, assessment_number, birth_certificate_number,
            learner_password_hash, parent_phone, parent_email
     FROM learners
     WHERE upi_number = ? OR assessment_number = ? OR birth_certificate_number = ?
     LIMIT 1`,
    [username, username, username]
  );

  if (!learners.length) {
    return null;
  }

  const learner = learners[0];
  const valid = learner.learner_password_hash
    ? await verifyPassword(password, learner.learner_password_hash)
    : password === "1234";
  if (!valid) {
    return null;
  }

  return {
    identity: username,
    role: ROLES.LEARNER,
    institution_id: learner.institution_id,
    destination: learner.parent_email || learner.parent_phone || username,
    payload: {
      id: `LEARNER-${learner.id}`,
      role: ROLES.LEARNER,
      institution_id: learner.institution_id,
      learner_id: learner.id,
      full_name: learner.full_name,
      username
    }
  };
}

async function getPaginatedRows({
  table,
  institutionId,
  searchFields,
  q,
  extraWhere = "",
  extraParams = [],
  limit = 50,
  offset = 0
}) {
  const search = buildSearchWhere({
    fields: searchFields,
    queryValue: q,
    params: [institutionId, ...extraParams]
  });
  const sql = `SELECT * FROM ${table}
               WHERE institution_id = ? ${extraWhere}${search.where}
               ORDER BY id DESC
               LIMIT ? OFFSET ?`;
  return query(sql, [...search.params, Number(limit), Number(offset)]);
}

app.get("/api/meta", (_, res) => {
  res.json({
    roles: ROLES,
    permissions: PERMISSIONS,
    rolePermissions: ROLE_PERMISSIONS,
    gradeOptions: GRADES,
    formOptions: FORMS,
    termOptions: TERMS,
    genderOptions: GENDER_OPTIONS,
    admissionStatus: ADMISSION_STATUS,
    orphanStatus: ORPHAN_STATUS,
    relationshipOptions: RELATIONSHIP_OPTIONS,
    staffCategories: STAFF_CATEGORY,
    subjectOptions: SUBJECTS,
    examTypes: EXAM_TYPES,
    leaveTypes: LEAVE_TYPES,
    termsOfService: TERMS_OF_SERVICE,
    teacherResourceTypes: DOCUMENT_CATEGORIES.TEACHER_RESOURCE,
    legalDocumentCategories: DOCUMENT_CATEGORIES.LAW_POLICY,
    procurementDocumentTypes: DOCUMENT_CATEGORIES.PROCUREMENT,
    exportFormats: EXPORT_FORMATS
  });
});

app.get("/api/health", asyncHandler(async (_, res) => {
  await query("SELECT 1");
  res.json({ status: "ok", service: "IIMS API" });
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const { username, password, otpChannel } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  let account =
    (await authenticateByUserTable(username, password)) ||
    (await authenticateParentByLearner(username, password)) ||
    (await authenticateLearner(username, password));

  if (!account) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  const channel = otpChannel || process.env.OTP_CHANNEL || "console";
  await createOtpSession({
    identity: account.identity,
    role: account.role,
    institutionId: account.institution_id,
    payload: account.payload,
    destination: account.destination,
    channel
  });

  return res.json({
    message: "OTP sent successfully.",
    role: account.role,
    portal: toPortal(account.role)
  });
}));

app.post("/api/auth/verify-otp", asyncHandler(async (req, res) => {
  const { username, otp } = req.body;
  if (!username || !otp) {
    return res.status(400).json({ error: "Username and OTP are required." });
  }

  const sessions = await query(
    `SELECT * FROM otp_sessions
     WHERE identity_value = ? AND otp_code = ? AND is_used = 0 AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [username, otp]
  );

  if (!sessions.length) {
    return res.status(401).json({ error: "Invalid or expired OTP." });
  }

  const session = sessions[0];
  await query("UPDATE otp_sessions SET is_used = 1 WHERE id = ?", [session.id]);
  const payload = JSON.parse(session.payload_json);
  const token = issueToken(payload);
  await auditLog(payload, "LOGIN_SUCCESS", "auth", payload.id, { role: payload.role });

  res.json({
    token,
    role: payload.role,
    portal: toPortal(payload.role),
    user: payload
  });
}));

app.get("/api/portal/current", auth, (req, res) => {
  res.json({
    role: req.user.role,
    portal: toPortal(req.user.role),
    institution_id: req.user.institution_id,
    permissions: ROLE_PERMISSIONS[req.user.role] || []
  });
});

app.post(
  "/api/uploads",
  auth,
  enforcePermission(PERMISSIONS.CREATE),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "File upload failed." });
    }
    await auditLog(req.user, "UPLOAD_FILE", "upload", null, { file: req.file.filename });
    res.json({
      fileName: req.file.filename,
      filePath: `/uploads/${req.file.filename}`,
      mimeType: req.file.mimetype
    });
  })
);

app.get(
  "/api/dashboard/summary",
  auth,
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const institutionId = req.user.institution_id;

    const [population] = await query(
      "SELECT COUNT(*) totalLearners FROM learners WHERE institution_id = ?",
      [institutionId]
    );
    const [present] = await query(
      `SELECT COUNT(*) totalPresent
       FROM attendance_records
       WHERE institution_id = ? AND attendance_type = 'Learner' AND status = 'Present'
       AND DATE(attendance_date) = CURDATE()`,
      [institutionId]
    );
    const [absent] = await query(
      `SELECT COUNT(*) totalAbsent
       FROM attendance_records
       WHERE institution_id = ? AND attendance_type = 'Learner' AND status = 'Absent'
       AND DATE(attendance_date) = CURDATE()`,
      [institutionId]
    );
    const [boys] = await query(
      "SELECT COUNT(*) totalBoys FROM learners WHERE institution_id = ? AND gender = 'Male'",
      [institutionId]
    );
    const [girls] = await query(
      "SELECT COUNT(*) totalGirls FROM learners WHERE institution_id = ? AND gender = 'Female'",
      [institutionId]
    );
    const [late] = await query(
      `SELECT COUNT(*) totalLate
       FROM attendance_records
       WHERE institution_id = ? AND status = 'Late' AND DATE(attendance_date) = CURDATE()`,
      [institutionId]
    );
    const [suspension] = await query(
      "SELECT COUNT(*) totalSuspended FROM learners WHERE institution_id = ? AND conduct_status = 'Suspended'",
      [institutionId]
    );
    const [expelled] = await query(
      "SELECT COUNT(*) totalExpelled FROM learners WHERE institution_id = ? AND conduct_status = 'Expelled'",
      [institutionId]
    );
    const [fees] = await query(
      `SELECT COALESCE(SUM(amount_paid), 0) totalFees
       FROM finance_fee_payments
       WHERE institution_id = ? AND DATE(payment_date) = CURDATE()`,
      [institutionId]
    );

    const attendanceBreakdown = await query(
      `SELECT attendance_type, status, COUNT(*) total
       FROM attendance_records
       WHERE institution_id = ? AND DATE(attendance_date) = CURDATE()
       GROUP BY attendance_type, status
       ORDER BY attendance_type, status`,
      [institutionId]
    );

    const performanceByClass = await query(
      `SELECT grade, stream, ROUND(AVG(marks), 2) meanScore
       FROM academic_marks
       WHERE institution_id = ?
       GROUP BY grade, stream
       ORDER BY grade, stream`,
      [institutionId]
    );

    const announcements = await query(
      `SELECT id, title, message, created_at
       FROM communication_announcements
       WHERE institution_id = ?
       ORDER BY id DESC LIMIT 10`,
      [institutionId]
    );

    const logs = await query(
      `SELECT id, actor_role, action, entity_name, created_at
       FROM activity_logs
       WHERE institution_id = ?
       ORDER BY id DESC LIMIT 20`,
      [institutionId]
    );

    res.json({
      stats: {
        totalLearners: population.totalLearners,
        totalPresent: present.totalPresent,
        totalAbsent: absent.totalAbsent,
        totalBoys: boys.totalBoys,
        totalGirls: girls.totalGirls,
        totalLate: late.totalLate,
        totalSuspended: suspension.totalSuspended,
        totalExpelled: expelled.totalExpelled,
        totalFeesCollectedToday: fees.totalFees
      },
      attendanceBreakdown,
      performanceByClass,
      announcements,
      systemActivityLogs: logs
    });
  })
);

app.get(
  "/api/search/global",
  auth,
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const { q = "" } = req.query;
    const institutionId = req.user.institution_id;

    const learnerRows = await getPaginatedRows({
      table: "learners",
      institutionId,
      searchFields: [
        "full_name",
        "admission_number",
        "upi_number",
        "assessment_number",
        "birth_certificate_number"
      ],
      q,
      limit: 20
    });
    const teacherRows = await getPaginatedRows({
      table: "teacher_profiles",
      institutionId,
      searchFields: ["full_name", "id_number", "tsc_number"],
      q,
      limit: 20
    });
    const parentRows = await getPaginatedRows({
      table: "learners",
      institutionId,
      searchFields: ["parent_full_name", "upi_number", "assessment_number"],
      q,
      limit: 20
    });

    res.json({
      learners: learnerRows,
      teachers: teacherRows,
      parentsAndBom: parentRows
    });
  })
);

app.get(
  "/api/users",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const users = await query(
      `SELECT id, institution_id, full_name, username, role, email, phone, is_active, created_at
       FROM users WHERE institution_id = ? ORDER BY id DESC`,
      [req.user.institution_id]
    );
    res.json(users);
  })
);

app.post(
  "/api/users",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const { full_name, username, password, role, email, phone } = req.body;
    if (!full_name || !username || !password || !role) {
      return res.status(400).json({ error: "full_name, username, password and role are required." });
    }
    const passwordHash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users
        (institution_id, full_name, username, password_hash, role, email, phone, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        req.user.institution_id,
        full_name,
        username,
        passwordHash,
        role,
        email || null,
        phone || null,
        req.user.id
      ]
    );
    await auditLog(req.user, "CREATE_USER", "users", result.insertId, { username, role });
    res.status(201).json({ id: result.insertId, message: "User created successfully." });
  })
);

app.patch(
  "/api/users/:id/status",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const { is_active } = req.body;
    await query("UPDATE users SET is_active = ? WHERE id = ? AND institution_id = ?", [
      Number(Boolean(is_active)),
      req.params.id,
      req.user.institution_id
    ]);
    await auditLog(req.user, "CHANGE_USER_STATUS", "users", req.params.id, { is_active });
    res.json({ message: "User status updated." });
  })
);

app.patch(
  "/api/users/:id/password",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    const { new_password } = req.body;
    if (!new_password) {
      return res.status(400).json({ error: "new_password is required." });
    }
    const passwordHash = await hashPassword(new_password);
    await query("UPDATE users SET password_hash = ? WHERE id = ? AND institution_id = ?", [
      passwordHash,
      req.params.id,
      req.user.institution_id
    ]);
    await auditLog(req.user, "RESET_USER_PASSWORD", "users", req.params.id);
    res.json({ message: "Password reset successfully." });
  })
);

app.post(
  "/api/profile/change-credentials",
  auth,
  asyncHandler(async (req, res) => {
    const { current_password, new_username, new_password } = req.body;
    const users = await query("SELECT * FROM users WHERE id = ? AND institution_id = ? LIMIT 1", [
      req.user.id,
      req.user.institution_id
    ]);
    if (!users.length) {
      return res.status(404).json({ error: "User account not found." });
    }
    const user = users[0];
    const valid = await verifyPassword(current_password || "", user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const updates = [];
    const params = [];

    if (new_username) {
      updates.push("username = ?");
      params.push(new_username);
    }
    if (new_password) {
      updates.push("password_hash = ?");
      params.push(await hashPassword(new_password));
    }

    if (!updates.length) {
      return res.status(400).json({ error: "No credential changes submitted." });
    }

    await query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, [...params, user.id]);
    await auditLog(req.user, "CHANGE_OWN_CREDENTIALS", "users", user.id, { new_username });
    res.json({ message: "Credentials updated successfully." });
  })
);

const moduleConfigs = [
  {
    route: "/api/admission/learners",
    table: "learners",
    searchFields: [
      "full_name",
      "admission_number",
      "upi_number",
      "assessment_number",
      "birth_certificate_number"
    ],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER],
    fields: [
      "full_name",
      "first_name",
      "middle_name",
      "last_name",
      "other_names",
      "admission_number",
      "date_of_admission",
      "grade",
      "form_name",
      "stream",
      "assessment_number",
      "upi_number",
      "birth_certificate_number",
      "date_of_birth",
      "gender",
      "passport_photo_path",
      "religion",
      "nationality",
      "county",
      "sub_county",
      "location",
      "sub_location",
      "village",
      "year_joined",
      "term_joined",
      "orphan_condition",
      "status",
      "conduct_status",
      "parent_full_name",
      "parent_relationship",
      "parent_id_number",
      "parent_phone",
      "parent_email",
      "learner_password_hash"
    ]
  },
  {
    route: "/api/management/teachers",
    table: "teacher_profiles",
    searchFields: ["full_name", "id_number", "tsc_number", "phone_number"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: [
      "full_name",
      "tsc_number",
      "id_number",
      "phone_number",
      "category",
      "major_subject",
      "other_subject",
      "next_of_kin_name",
      "next_of_kin_relationship",
      "next_of_kin_mobile",
      "next_of_kin_email"
    ]
  },
  {
    route: "/api/management/non-teaching-staff",
    table: "non_teaching_staff_profiles",
    searchFields: ["full_name", "staff_number", "id_number", "position_department"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: [
      "full_name",
      "staff_number",
      "id_number",
      "phone_number",
      "position_department",
      "next_of_kin_name",
      "next_of_kin_contact"
    ]
  },
  {
    route: "/api/management/teacher-resources",
    table: "teacher_resources",
    searchFields: ["resource_type", "title", "grade", "term"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER],
    fields: [
      "teacher_profile_id",
      "resource_type",
      "title",
      "description",
      "grade",
      "stream",
      "term",
      "strand",
      "sub_strand",
      "file_path",
      "auto_generated"
    ]
  },
  {
    route: "/api/attendance/records",
    table: "attendance_records",
    searchFields: ["attendance_type", "person_name", "grade", "stream", "status", "reason"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER],
    fields: [
      "attendance_type",
      "person_id",
      "person_name",
      "grade",
      "stream",
      "attendance_date",
      "time_in",
      "time_out",
      "status",
      "reason",
      "comments"
    ]
  },
  {
    route: "/api/academic/exams",
    table: "academic_exams",
    searchFields: ["title", "grade", "subject", "strand", "sub_strand"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER],
    fields: [
      "title",
      "grade",
      "stream",
      "subject",
      "strand",
      "sub_strand",
      "notes_file_path",
      "generated_exam_text",
      "exam_file_path",
      "term",
      "year"
    ]
  },
  {
    route: "/api/academic/marks",
    table: "academic_marks",
    searchFields: [
      "learner_name",
      "upi_number",
      "assessment_number",
      "birth_certificate_number",
      "exam_type",
      "subject",
      "grade",
      "stream"
    ],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.TEACHER,
      ROLES.BOM
    ],
    fields: [
      "learner_id",
      "learner_name",
      "upi_number",
      "assessment_number",
      "birth_certificate_number",
      "grade",
      "stream",
      "exam_type",
      "subject",
      "marks",
      "percentage",
      "cbc_grade_band",
      "term",
      "year"
    ]
  },
  {
    route: "/api/hr/leave-requests",
    table: "hr_leave_requests",
    searchFields: ["staff_name", "leave_type", "status", "approval_stage"],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.NON_TEACHING_STAFF,
      ROLES.TEACHER
    ],
    fields: [
      "staff_profile_type",
      "staff_profile_id",
      "staff_name",
      "leave_type",
      "start_date",
      "end_date",
      "reason",
      "status",
      "applied_by_user_id",
      "approved_by_user_id",
      "approval_stage"
    ]
  },
  {
    route: "/api/hr/recruitment-records",
    table: "hr_recruitment_records",
    searchFields: ["record_type", "position_name", "candidate_name", "terms_of_service"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: [
      "record_type",
      "position_name",
      "candidate_name",
      "candidate_id_number",
      "candidate_mobile",
      "terms_of_service",
      "job_description",
      "comments",
      "upload_file_path",
      "deadline_date",
      "status"
    ]
  },
  {
    route: "/api/finance/fee-structures",
    table: "finance_fee_structures",
    searchFields: ["grade", "stream", "term", "year"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: ["grade", "stream", "term", "year", "amount_required", "description"]
  },
  {
    route: "/api/finance/fee-payments",
    table: "finance_fee_payments",
    searchFields: ["learner_name", "admission_number", "receipt_number", "payment_method"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.NON_TEACHING_STAFF],
    fields: [
      "learner_id",
      "learner_name",
      "admission_number",
      "grade",
      "stream",
      "amount_paid",
      "payment_method",
      "receipt_number",
      "payment_date",
      "balance_after_payment"
    ]
  },
  {
    route: "/api/finance/procurement",
    table: "finance_procurement_records",
    searchFields: ["document_type", "document_number", "supplier_name", "item_name", "status"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.NON_TEACHING_STAFF],
    fields: [
      "document_type",
      "document_number",
      "supplier_name",
      "item_name",
      "description",
      "quantity",
      "amount",
      "document_date",
      "due_date",
      "status",
      "file_path",
      "qr_code_text"
    ]
  },
  {
    route: "/api/communication/messages",
    table: "communication_messages",
    searchFields: ["message_type", "recipient_role", "recipient_contact", "status"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: [
      "message_type",
      "recipient_role",
      "recipient_contact",
      "message_body",
      "status",
      "sent_at"
    ]
  },
  {
    route: "/api/communication/announcements",
    table: "communication_announcements",
    searchFields: ["title", "message", "audience"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION],
    fields: ["title", "message", "audience", "start_date", "end_date"]
  },
  {
    route: "/api/learners/resources",
    table: "learner_resources",
    searchFields: ["title", "subject", "grade", "resource_format"],
    allowedRoles: [ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER, ROLES.LEARNER],
    fields: [
      "title",
      "subject",
      "grade",
      "stream",
      "resource_format",
      "file_path",
      "description",
      "uploaded_by_user_id"
    ]
  },
  {
    route: "/api/welfare/members",
    table: "welfare_members",
    searchFields: ["member_name", "member_role", "status"],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.NON_TEACHING_STAFF,
      ROLES.TEACHER
    ],
    fields: [
      "member_name",
      "member_role",
      "phone_number",
      "email",
      "joined_date",
      "status"
    ]
  },
  {
    route: "/api/welfare/contributions",
    table: "welfare_contributions",
    searchFields: ["member_name", "contribution_period", "payment_mode"],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.NON_TEACHING_STAFF,
      ROLES.TEACHER
    ],
    fields: [
      "member_id",
      "member_name",
      "contribution_period",
      "amount",
      "payment_mode",
      "payment_date"
    ]
  },
  {
    route: "/api/welfare/loans",
    table: "welfare_loans",
    searchFields: ["member_name", "status", "loan_officer_approval", "principal_approval"],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.NON_TEACHING_STAFF,
      ROLES.TEACHER
    ],
    fields: [
      "member_id",
      "member_name",
      "amount",
      "application_date",
      "return_date",
      "status",
      "loan_officer_approval",
      "principal_approval",
      "repayment_status"
    ]
  },
  {
    route: "/api/laws/documents",
    table: "laws_regulations_policies",
    searchFields: ["document_category", "title", "description"],
    allowedRoles: [
      ROLES.ADMIN,
      ROLES.HEAD_OF_INSTITUTION,
      ROLES.NON_TEACHING_STAFF,
      ROLES.TEACHER
    ],
    fields: [
      "document_category",
      "title",
      "description",
      "file_path",
      "effective_date",
      "uploaded_by_user_id"
    ]
  }
];

moduleConfigs.forEach((config) => {
  app.get(
    config.route,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await getPaginatedRows({
        table: config.table,
        institutionId: req.user.institution_id,
        searchFields: config.searchFields,
        q: req.query.q || "",
        limit: req.query.limit || 100,
        offset: req.query.offset || 0
      });

      res.json(rows);
    })
  );

  app.get(
    `${config.route}/:id`,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await query(
        `SELECT * FROM ${config.table} WHERE id = ? AND institution_id = ? LIMIT 1`,
        [req.params.id, req.user.institution_id]
      );
      if (!rows.length) {
        return res.status(404).json({ error: "Record not found." });
      }
      return res.json(rows[0]);
    })
  );

  app.post(
    config.route,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.CREATE),
    asyncHandler(async (req, res) => {
      const data = pickFields(req.body, config.fields);
      data.institution_id = req.user.institution_id;
      data.created_by_user_id = req.user.id;

      if (config.table === "academic_marks" && data.marks !== undefined && data.marks !== null) {
        const markValue = Number(data.marks);
        data.percentage = data.percentage ?? markValue;
        if (!data.cbc_grade_band) {
          if (markValue >= 75) data.cbc_grade_band = "EE";
          else if (markValue >= 50) data.cbc_grade_band = "ME";
          else if (markValue >= 25) data.cbc_grade_band = "AE";
          else data.cbc_grade_band = "BE";
        }
      }

      if (config.table === "non_teaching_staff_profiles" && !data.staff_number) {
        data.staff_number = `NTS-${Date.now()}`;
      }

      if (config.table === "finance_fee_payments" && !data.receipt_number) {
        data.receipt_number = `RCPT-${Date.now()}`;
      }

      if (config.table === "finance_procurement_records" && !data.document_number) {
        const prefix = (data.document_type || "DOC").replace(/\s+/g, "").toUpperCase();
        data.document_number = `${prefix}-${Date.now()}`;
      }

      const columns = Object.keys(data);
      if (!columns.length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }
      const placeholders = columns.map(() => "?").join(", ");
      const sql = `INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders})`;
      const result = await query(sql, Object.values(data));
      await auditLog(req.user, "CREATE", config.table, result.insertId, data);
      res.status(201).json({ id: result.insertId, message: "Record created." });
    })
  );

  app.put(
    `${config.route}/:id`,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.UPDATE),
    asyncHandler(async (req, res) => {
      const data = pickFields(req.body, config.fields);
      const columns = Object.keys(data);
      if (!columns.length) {
        return res.status(400).json({ error: "No valid payload fields." });
      }

      const setClause = columns.map((column) => `${column} = ?`).join(", ");
      const sql = `UPDATE ${config.table}
                   SET ${setClause}, updated_at = NOW()
                   WHERE id = ? AND institution_id = ?`;
      await query(sql, [...Object.values(data), req.params.id, req.user.institution_id]);
      await auditLog(req.user, "UPDATE", config.table, req.params.id, data);
      res.json({ message: "Record updated." });
    })
  );

  app.delete(
    `${config.route}/:id`,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.DELETE),
    asyncHandler(async (req, res) => {
      await query(`DELETE FROM ${config.table} WHERE id = ? AND institution_id = ?`, [
        req.params.id,
        req.user.institution_id
      ]);
      await auditLog(req.user, "DELETE", config.table, req.params.id);
      res.json({ message: "Record deleted." });
    })
  );

  app.get(
    `${config.route}/export/pdf`,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await getPaginatedRows({
        table: config.table,
        institutionId: req.user.institution_id,
        searchFields: config.searchFields,
        q: req.query.q || "",
        limit: 5000
      });

      const lines = rows.map((row) => JSON.stringify(row));
      sendSimplePdf(res, `${config.table}-report`, lines);
    })
  );

  app.get(
    `${config.route}/export/excel`,
    auth,
    enforceRole(config.allowedRoles),
    enforcePermission(PERMISSIONS.VIEW),
    asyncHandler(async (req, res) => {
      const rows = await getPaginatedRows({
        table: config.table,
        institutionId: req.user.institution_id,
        searchFields: config.searchFields,
        q: req.query.q || "",
        limit: 5000
      });
      const headers = rows.length ? Object.keys(rows[0]) : ["No Data"];
      const dataRows = rows.length ? rows.map((row) => headers.map((header) => row[header])) : [];
      await sendSimpleExcel(res, config.table, headers, dataRows);
    })
  );
});

app.post(
  "/api/management/teacher-resources/auto-generate",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const { teacher_profile_id, resource_type, grade, term, strand, sub_strand } = req.body;
    const generated = [
      `Auto-generated ${resource_type} for ${grade} (${term})`,
      `Curriculum focus: Strand ${strand}, Sub-strand ${sub_strand}`,
      "Objectives: Define competency goals, learner engagement and assessment method.",
      "Learning materials: CBC approved text, learner workbook and rubric.",
      "Evaluation: Continuous assessment aligned to CBC standards."
    ].join("\n");

    const result = await query(
      `INSERT INTO teacher_resources
       (institution_id, teacher_profile_id, resource_type, title, description, grade, term, strand, sub_strand, auto_generated, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        req.user.institution_id,
        teacher_profile_id || null,
        resource_type || "Lesson Plan",
        `${resource_type || "Lesson Plan"} - ${grade || "General"}`,
        generated,
        grade || null,
        term || null,
        strand || null,
        sub_strand || null,
        req.user.id
      ]
    );
    await auditLog(req.user, "AUTO_GENERATE_TEACHER_RESOURCE", "teacher_resources", result.insertId);
    res.status(201).json({ id: result.insertId, generatedDocument: generated });
  })
);

app.post(
  "/api/academic/exams/auto-generate",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const {
      grade,
      stream,
      subject,
      strand,
      sub_strand,
      term,
      year,
      title,
      notes_file_path
    } = req.body;

    const examText = [
      `${title || "CBC Auto Generated Exam"} - ${subject || "General Subject"}`,
      `Grade/Class: ${grade || "N/A"} | Stream: ${stream || "N/A"} | Term: ${term || "N/A"} ${year || ""}`,
      `Coverage: Strand ${strand || "N/A"} - Sub-strand ${sub_strand || "N/A"}`,
      "",
      "Section A: Multiple Choice",
      "1. [Auto-generated question from covered concepts]",
      "2. [Auto-generated question from learner notes]",
      "",
      "Section B: Structured Questions",
      "3. Explain the key competency learned under this strand.",
      "4. Apply the competency in a real-life school context.",
      "",
      "Marking guide: Aligned to Kenya CBC mastery levels."
    ].join("\n");

    const result = await query(
      `INSERT INTO academic_exams
        (institution_id, title, grade, stream, subject, strand, sub_strand, notes_file_path, generated_exam_text, term, year, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.institution_id,
        title || "Auto Generated Exam",
        grade || null,
        stream || null,
        subject || null,
        strand || null,
        sub_strand || null,
        notes_file_path || null,
        examText,
        term || null,
        year || null,
        req.user.id
      ]
    );

    await auditLog(req.user, "AUTO_GENERATE_EXAM", "academic_exams", result.insertId);
    res.status(201).json({ id: result.insertId, examText });
  })
);

app.post(
  "/api/attendance/auto-class-register",
  auth,
  enforceRole([ROLES.ADMIN, ROLES.HEAD_OF_INSTITUTION, ROLES.TEACHER]),
  enforcePermission(PERMISSIONS.CREATE),
  asyncHandler(async (req, res) => {
    const { grade, stream, attendance_date } = req.body;
    const dateValue = attendance_date || dayjs().format("YYYY-MM-DD");
    const learners = await query(
      `SELECT id, full_name, grade, stream
       FROM learners
       WHERE institution_id = ? AND grade = ? AND (? IS NULL OR stream = ?)`,
      [req.user.institution_id, grade, stream || null, stream || null]
    );

    for (const learner of learners) {
      await query(
        `INSERT INTO attendance_records
          (institution_id, attendance_type, person_id, person_name, grade, stream, attendance_date, status, created_by_user_id)
         VALUES (?, 'Learner', ?, ?, ?, ?, ?, 'Present', ?)`,
        [
          req.user.institution_id,
          learner.id,
          learner.full_name,
          learner.grade,
          learner.stream,
          dateValue,
          req.user.id
        ]
      );
    }

    await auditLog(req.user, "AUTO_GENERATE_CLASS_REGISTER", "attendance_records", null, {
      grade,
      stream,
      date: dateValue,
      count: learners.length
    });
    res.json({ message: "Class register auto-generated.", count: learners.length });
  })
);

app.get(
  "/api/academic/performance/class-summary",
  auth,
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const summary = await query(
      `SELECT grade, stream, subject,
              ROUND(AVG(marks), 2) mean_score,
              ROUND(AVG(percentage), 2) mean_percentage
       FROM academic_marks
       WHERE institution_id = ?
       GROUP BY grade, stream, subject
       ORDER BY grade, stream, subject`,
      [req.user.institution_id]
    );
    res.json(summary);
  })
);

app.get(
  "/api/academic/performance/positions",
  auth,
  enforcePermission(PERMISSIONS.VIEW),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT learner_id, learner_name, grade, stream, SUM(marks) total_score,
              ROUND(AVG(percentage), 2) mean_percentage
       FROM academic_marks
       WHERE institution_id = ?
       GROUP BY learner_id, learner_name, grade, stream
       ORDER BY grade, stream, total_score DESC`,
      [req.user.institution_id]
    );
    res.json(rows);
  })
);

app.get(
  "/api/parent/results",
  auth,
  enforceRole([ROLES.PARENT]),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT *
       FROM academic_marks
       WHERE institution_id = ? AND learner_id = ?
       ORDER BY year DESC, term DESC`,
      [req.user.institution_id, req.user.learner_id]
    );
    res.json(rows);
  })
);

app.get(
  "/api/parent/results/export/pdf",
  auth,
  enforceRole([ROLES.PARENT, ROLES.BOM]),
  asyncHandler(async (req, res) => {
    let rows = [];
    if (req.user.role === ROLES.PARENT) {
      rows = await query(
        `SELECT learner_name, subject, marks, percentage, cbc_grade_band, term, year
         FROM academic_marks
         WHERE institution_id = ? AND learner_id = ?
         ORDER BY year DESC, term DESC`,
        [req.user.institution_id, req.user.learner_id]
      );
    } else {
      rows = await query(
        `SELECT learner_name, subject, marks, percentage, cbc_grade_band, term, year
         FROM academic_marks
         WHERE institution_id = ?
         ORDER BY year DESC, term DESC
         LIMIT 1000`,
        [req.user.institution_id]
      );
    }
    sendSimplePdf(
      res,
      "learner-results",
      rows.map(
        (row) =>
          `${row.learner_name} | ${row.subject} | ${row.marks} | ${row.cbc_grade_band} | ${row.term} ${row.year}`
      )
    );
  })
);

app.get(
  "/api/learner/materials",
  auth,
  enforceRole([ROLES.LEARNER]),
  asyncHandler(async (req, res) => {
    const learnerRows = await query(
      "SELECT grade, stream FROM learners WHERE id = ? AND institution_id = ? LIMIT 1",
      [req.user.learner_id, req.user.institution_id]
    );
    if (!learnerRows.length) {
      return res.status(404).json({ error: "Learner profile not found." });
    }
    const learner = learnerRows[0];
    const resources = await query(
      `SELECT *
       FROM learner_resources
       WHERE institution_id = ? AND grade = ? AND (stream = ? OR stream IS NULL OR stream = '')
       ORDER BY id DESC`,
      [req.user.institution_id, learner.grade, learner.stream || ""]
    );
    res.json(resources);
  })
);

app.get(
  "/api/learner/marks",
  auth,
  enforceRole([ROLES.LEARNER]),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT learner_name, exam_type, subject, marks, percentage, cbc_grade_band, term, year
       FROM academic_marks
       WHERE institution_id = ? AND learner_id = ?`,
      [req.user.institution_id, req.user.learner_id]
    );
    res.json(rows);
  })
);

app.get(
  "/api/communication/chat-placeholder",
  auth,
  enforceRole([ROLES.PARENT, ROLES.TEACHER, ROLES.HEAD_OF_INSTITUTION]),
  asyncHandler(async (req, res) => {
    res.json({
      message:
        "Parent/Teacher chat endpoint placeholder is enabled. Plug a websocket service for live chat."
    });
  })
);

app.get("/", (_, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  // eslint-disable-next-line no-console
  console.error("Unhandled API error:", err);
  return res.status(500).json({ error: "Internal server error.", details: err.message });
});

module.exports = app;
