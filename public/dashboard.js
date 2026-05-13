const token = localStorage.getItem("token");
if (!token) {
  window.location.href = "/";
}

let meta = {};
let admissionRegisterRows = [];
let currentModule = "dashboard";
let currentEditId = null;
let allowedModules = [];
let portalContext = null;
let searchRowDrafts = {};
let dashboardAutoRefreshHandle = null;
let currentSidebarSubmoduleId = null;
const CLIENT_UI_BUNDLE_ID = "dash-bundle-main-v73-phase2-hardening-redesign";
const examPanelState = {
  generatedExam: null,
  serials: [],
  markingScheme: "",
  marksRows: [],
  resultRows: [],
  assessmentReport: null,
  notesCache: {},
  curriculumRows: [],
  curriculumMaterials: []
};
const DASHBOARD_STAT_LABELS = {
  totalLearners: "Total Learners Population",
  totalActiveLearners: "Active Learners",
  totalPresent: "Present Today",
  totalAbsent: "Absent Today",
  totalBoys: "Total Boys",
  totalGirls: "Total Girls",
  totalLate: "Late Today",
  totalSuspended: "Suspended",
  totalExpelled: "Expelled",
  totalDropOut: "Drop Out",
  totalTransferred: "Transferred",
  totalCompletion: "Completion",
  totalTeachers: "Total Teachers",
  totalTeachersPresent: "Teachers Present",
  totalTeachersOfficialLeave: "Teachers on Official Leave",
  totalTeachersAbsentWithApology: "Teachers Absent (Apology)",
  totalTeachersAbsentWithoutApology: "Teachers Absent (No Apology)",
  totalTeachersDeserter: "Teacher Deserters",
  totalTeachersSuspended: "Teachers Suspended",
  totalTeachersInterdicted: "Teachers Interdicted",
  totalTeachersTransferred: "Teachers Transferred",
  totalTeachersRetired: "Teachers Retired",
  totalFeesCollectedToday: "Fees Collected Today (KES)"
};

const DASHBOARD_WIDGET_KEYS = [
  "dashboard-alerts-announcements",
  "dashboard-attendance-list",
  "dashboard-performance",
  "dashboard-fee-collection",
  "dashboard-outstanding-balances"
];

const MODULE_KEY_BY_ID = {
  dashboard: "dashboard",
  "dashboard-alerts-announcements": "dashboard-alerts-announcements",
  "dashboard-attendance-list": "dashboard-attendance-list",
  "dashboard-performance": "dashboard-performance",
  "dashboard-fee-collection": "dashboard-fee-collection",
  "dashboard-outstanding-balances": "dashboard-outstanding-balances",
  admission: "admission",
  "management-staff-service": "staff-service-providers",
  "management-teachers": "management-teachers",
  "management-non-teaching": "management-non-teaching",
  "management-teacher-resources": "management-teacher-resources",
  attendance: "attendance",
  "academic-exams": "academic-exams",
  "academic-marks": "academic-marks",
  "hr-leave": "hr-leave",
  "hr-recruitment": "hr-recruitment",
  "finance-fee-structure": "finance-fee-structure",
  "finance-fee-payments": "finance-fee-payments",
  "finance-payroll": "finance-payroll",
  "finance-salary-advance": "finance-salary-advance",
  "finance-procurement": "finance-procurement",
  "communication-announcements": "communication-announcements",
  "communication-messages": "communication-messages",
  "parents-results": "parent-results",
  "learner-materials": "learner-materials",
  "welfare-members": "welfare-members",
  "welfare-contributions": "welfare-contributions",
  "welfare-loans": "welfare-loans",
  laws: "laws",
  "system-register": "register-center",
  "system-access-control": "access-control",
  "system-audit": "security-audit",
  "system-ops-center": "system-ops-center",
  "system-incident-response": "system-incident-response",
  "system-registry": "institutions-users-registry",
  "system-institution-edit": "institutions-users-registry",
  "system-institution-uploads": "institutions-users-registry",
  "system-recycle-bin": "recycle-bin",
  "system-cbc-editor": "cbc-curriculum-editor"
};

const MODULE_DESCRIPTIONS = {
  dashboard: "Real-time institution intelligence and activity overview.",
  admission: "Manage learner admissions, profiles, and onboarding records.",
  "management-teachers": "Maintain teacher profiles and professional details.",
  "management-non-teaching": "Manage support staff records and roles.",
  "management-staff-service":
    "Consolidated Staff Profile hub for teacher and support staff records, uploads, and portal registration workflows.",
  "management-service-providers": "Register service providers and companies supporting the institution.",
  "management-bom": "Maintain Board of Management member profiles and contact data.",
  "management-teacher-resources": "Teacher planning hub for lesson plans, schemes of work, records of work, templates, and curriculum-linked generation.",
  attendance: "Track daily attendance, punctuality, and attendance analytics.",
  "academic-exams": "Create and manage assessments by class, strand, and term.",
  "academic-marks": "Capture marks and compute performance bands and summaries.",
  "hr-leave": "Process leave applications, approvals, and HR workflows.",
  "hr-recruitment": "Handle vacancies, appointments, and HR letter workflows.",
  "finance-fee-structure": "Define fees by class, stream, term, and year.",
  "finance-fee-payments": "Record fee payments, balances, and payment methods.",
  "finance-payroll": "Manage staff payroll generation, net pay, and payroll status.",
  "finance-salary-advance": "Manage salary advance requests, approvals, and repayment tracking.",
  "finance-procurement": "Manage procurement documents, vouchers, and supplier records.",
  "communication-announcements": "Publish institution announcements for targeted audiences.",
  "communication-messages": "Queue, dispatch, and monitor multi-channel communication.",
  "parents-results": "Provide parent and BOM-facing learner performance visibility.",
  "learner-materials": "Offer learner access to learning materials and marks.",
  "welfare-members": "Register and manage welfare membership profiles.",
  "welfare-contributions": "Track periodic welfare member contributions.",
  "welfare-loans": "Administer welfare loan requests, approvals, and repayment status.",
  laws: "Store and retrieve institutional policies and legal documents.",
  "system-register": "Institution Registration and role-based user registration with strict sub-module isolation.",
  "system-access-control": "Assign module rights and review role-based access permissions.",
  "system-audit": "Review security and login audit trails for accountability.",
  "system-ops-center": "Operations center for module health, queue pressure, and system posture diagnostics.",
  "system-incident-response": "Incident response workspace for security events, escalation, and closure tracking.",
  "system-registry": "Browse institutions and user registry details in one place.",
  "system-institution-edit":
    "Institution Upgrade: edit/save/delete institution profile and institution user details (SSD only).",
  "system-institution-uploads":
    "Institution uploads workspace: templates, logos, letterheads, admission/assessment samples, and generated document files per institution.",
  "system-recycle-bin": "Restore or permanently purge archived deleted records.",
  "system-cbc-editor": "Enterprise examination intelligence engine: curriculum, generation, entry, scripts, gradebooks, tracking, portals, compliance, lifecycle, analytics, templates, archives and settings."
};

const SIDEBAR_SUBMODULES = {
  "system-register": [
    {
      id: "system-register-institution",
      label: "Institution Registration",
      targetModule: "system-register",
      options: { registrationFocus: "institution" },
      roles: ["SUPER_SYSTEM_DEVELOPER"]
    },
    {
      id: "system-register-developers",
      label: "SSD/SD Registration",
      targetModule: "system-register",
      options: { registrationFocus: "developers" },
      roles: ["SUPER_SYSTEM_DEVELOPER"]
    },
    {
      id: "system-register-hoi-admin",
      label: "HOI/Admin/Sys Admin Registration",
      targetModule: "system-register",
      options: { registrationFocus: "hoi-admin" },
      roles: ["SUPER_SYSTEM_DEVELOPER"]
    },
    {
      id: "system-register-user",
      label: "User Registration",
      targetModule: "system-register",
      options: { registrationFocus: "user" }
    }
  ],
  "system-audit": [
    { id: "system-security-audit-main", label: "Security Logs", targetModule: "system-audit" },
    { id: "system-ops-center-main", label: "Ops Center", targetModule: "system-ops-center" },
    { id: "system-incident-response-main", label: "Incident Response", targetModule: "system-incident-response" }
  ],
  admission: [
    {
      id: "admission-learners-registration",
      label: "Learners Registration",
      targetModule: "admission",
      options: { admissionFocus: "bio" }
    },
    { id: "admission-register", label: "Admission Register", targetModule: "admission", options: { admissionFocus: "register" } },
    { id: "admission-form", label: "Admission Form", targetModule: "admission", options: { admissionFocus: "form" } },
    { id: "admission-letter", label: "Admission Letter", targetModule: "admission", options: { admissionFocus: "letter" } },
    { id: "admission-parent-guardian", label: "Parent/Guardian Register", targetModule: "admission", options: { admissionFocus: "parent-guardian" } }
  ],
  "management-staff-service": [
    { id: "staff-profile-teacher", label: "Teacher Profile", targetModule: "management-staff-service", options: { staffCategory: "management-teachers" } },
    {
      id: "staff-profile-support-staff",
      label: "Support Staff Profile",
      targetModule: "management-staff-service",
      options: { staffCategory: "management-non-teaching" }
    }
  ],
  attendance: [
    { id: "attendance-teacher-register", label: "Teacher Attendance", targetModule: "attendance", options: { attendanceType: "Teacher" } },
    {
      id: "attendance-support-staff-register",
      label: "Support Staff Attendance",
      targetModule: "attendance",
      options: { attendanceType: "Support Staff" }
    },
    { id: "attendance-learner-register", label: "Learner Attendance", targetModule: "attendance", options: { attendanceType: "Learner" } }
  ],
  "system-cbc-editor": [
    { id: "exam-curriculum", label: "Curriculum", targetModule: "system-cbc-editor", options: { examTab: "curriculum" } },
    {
      id: "exam-generation",
      label: "Exam Generation",
      targetModule: "system-cbc-editor",
      options: { examTab: "exam-generation" }
    },
    { id: "exam-entry", label: "Exam Entry", targetModule: "system-cbc-editor", options: { examTab: "exam-entry" } },
    {
      id: "exam-scripts",
      label: "Exam Scripts",
      targetModule: "system-cbc-editor",
      options: { examTab: "exam-scripts" }
    },
    {
      id: "assessment-reports",
      label: "Assessment Reports",
      targetModule: "system-cbc-editor",
      options: { examTab: "assessment-reports" }
    },
    {
      id: "progress-reports",
      label: "Progress Reports",
      targetModule: "system-cbc-editor",
      options: { examTab: "progress-reports" }
    },
    { id: "exam-gradebook", label: "Gradebook", targetModule: "system-cbc-editor", options: { examTab: "gradebook" } },
    {
      id: "exam-assessment-tracking",
      label: "Assessment Tracking",
      targetModule: "system-cbc-editor",
      options: { examTab: "assessment-tracking" }
    },
    {
      id: "exam-portal-insights",
      label: "Portal Insights",
      targetModule: "system-cbc-editor",
      options: { examTab: "portal-insights" }
    },
    {
      id: "exam-compliance",
      label: "Compliance",
      targetModule: "system-cbc-editor",
      options: { examTab: "compliance" }
    },
    { id: "exam-lifecycle", label: "Lifecycle", targetModule: "system-cbc-editor", options: { examTab: "lifecycle" } },
    { id: "exam-analytics", label: "Analytics", targetModule: "system-cbc-editor", options: { examTab: "analytics" } },
    { id: "exam-ai-copilot", label: "AI Copilot", targetModule: "system-cbc-editor", options: { examTab: "ai-copilot" } },
    { id: "exam-templates", label: "Templates", targetModule: "system-cbc-editor", options: { examTab: "templates" } },
    { id: "exam-archives", label: "Archives", targetModule: "system-cbc-editor", options: { examTab: "archives" } },
    { id: "exam-settings", label: "Settings", targetModule: "system-cbc-editor", options: { examTab: "settings" } }
  ],
  "hr-leave": [
    { id: "hr-leave-sub", label: "HR Management", targetModule: "hr-leave" },
    { id: "hr-recruitment-sub", label: "HR Recruitment", targetModule: "hr-recruitment" },
    { id: "hr-institutional-letters-sub", label: "Institutional Letters", targetModule: "hr-institutional-letters" }
  ],
  "finance-fee-status": [
    { id: "finance-fee-status-sub", label: "Fee Status", targetModule: "finance-fee-status" },
    { id: "finance-fee-structure-sub", label: "Fee Structure", targetModule: "finance-fee-structure" },
    { id: "finance-fee-payments-sub", label: "Fee Payments", targetModule: "finance-fee-payments" },
    { id: "finance-payroll-sub", label: "Payroll", targetModule: "finance-payroll" },
    { id: "finance-salary-advance-sub", label: "Salary Advances", targetModule: "finance-salary-advance" },
    { id: "finance-procurement-sub", label: "Procurement", targetModule: "finance-procurement" }
  ],
  "communication-announcements": [
    { id: "communication-announcements-sub", label: "Announcements", targetModule: "communication-announcements" },
    { id: "communication-messages-sub", label: "SMS/Communication", targetModule: "communication-messages" },
    { id: "parents-results-sub", label: "Parents/BOM Results", targetModule: "parents-results" },
    { id: "learner-materials-sub", label: "Learner Materials", targetModule: "learner-materials" }
  ],
  "welfare-members": [
    { id: "welfare-members-sub", label: "Welfare Members", targetModule: "welfare-members" },
    { id: "welfare-contributions-sub", label: "Welfare Contributions", targetModule: "welfare-contributions" },
    { id: "welfare-loans-sub", label: "Welfare Loans", targetModule: "welfare-loans" }
  ]
};

function sidebarSubmodulesFor(moduleId = "") {
  return Array.isArray(SIDEBAR_SUBMODULES[moduleId]) ? SIDEBAR_SUBMODULES[moduleId] : [];
}

function isSidebarSubmoduleAllowed(submodule = {}) {
  const requiredRoles = Array.isArray(submodule?.roles) ? submodule.roles : [];
  if (!requiredRoles.length) return true;
  const actorRole = normalizeRoleKey(portalContext?.role || "");
  return requiredRoles.includes(actorRole);
}

function sidebarSubmoduleParent(submoduleId = "") {
  const target = String(submoduleId || "");
  return Object.keys(SIDEBAR_SUBMODULES).find((parent) =>
    sidebarSubmodulesFor(parent).some((item) => item.id === target)
  );
}

function isSuperSystemDeveloperPortal() {
  return normalizeRoleKey(portalContext?.role || "") === "SUPER_SYSTEM_DEVELOPER";
}

function inferAxButtonVariant(label = "", existingClasses = "") {
  const source = `${String(label || "")} ${String(existingClasses || "")}`.toLowerCase();
  if (source.includes("delete") || source.includes("remove") || source.includes("purge")) return "ax-btn--delete";
  if (source.includes("save")) return "ax-btn--save";
  if (source.includes("edit") || source.includes("amend") || source.includes("modify")) return "ax-btn--edit";
  if (source.includes("refresh")) return "ax-btn--refresh";
  if (source.includes("print")) return "ax-btn--print";
  if (source.includes("excel")) return "ax-btn--export-excel";
  if (source.includes("pdf")) return "ax-btn--export-pdf";
  if (source.includes("download")) return "ax-btn--download";
  if (source.includes("upload")) return "ax-btn--upload";
  if (source.includes("register") || source.includes("create")) return "ax-btn--register";
  if (source.includes("dispatch") || source.includes("generate") || source.includes("process") || source.includes("send")) return "ax-btn--process";
  if (source.includes("clear") || source.includes("reset")) return "ax-btn--reset";
  if (source.includes("view") || source.includes("open")) return "ax-btn--view";
  return "ax-btn--view";
}

function applyCompactIconButtons(scope = document) {
  if (!scope || typeof scope.querySelectorAll !== "function") return;
  const preserveButtonIds = new Set([
    "searchButton",
    "assistantSendButton",
    "assistantToggleButton",
    "updateHeroImageButton",
    "changeCredentialsButton",
    "logoutButton"
  ]);
  scope.querySelectorAll("button, label.ax-btn").forEach((node) => {
    if (node.closest(".sidebar-scroll")) return;
    if (preserveButtonIds.has(String(node.id || ""))) return;
    const text = String(node.textContent || "").trim();
    if (node.tagName === "BUTTON") {
      node.classList.add("ax-btn", "ax-btn--sm");
      const variant = inferAxButtonVariant(text, node.className);
      node.classList.add(variant);
      if (!node.getAttribute("title")) node.setAttribute("title", text || "Action");
      if (!node.getAttribute("aria-label")) node.setAttribute("aria-label", text || "Action");
      const explicitKeep =
        node.getAttribute("data-keep-button-style") === "1" ||
        /search|upload|hero|profile/i.test(String(node.id || "")) ||
        /search|upload|hero|profile/i.test(text);
      if (!explicitKeep) {
        node.classList.add("ax-btn--icon-only");
      } else {
        node.classList.remove("ax-btn--icon-only");
      }
      const compactText = String(text || "").replace(/\s+/g, "");
      const isSymbolOnly =
        node.classList.contains("ax-btn--icon-only") ||
        compactText.length <= 2 ||
        /^[^\p{L}\p{N}]+$/u.test(compactText);
      node.classList.toggle("icon-symbolic", isSymbolOnly);
    } else if (node.tagName === "LABEL") {
      if (!node.getAttribute("title")) node.setAttribute("title", text || "Action");
      if (!node.getAttribute("aria-label")) node.setAttribute("aria-label", text || "Action");
    }
  });
  attachActionLegends(scope);
}

function attachActionLegends(scope = document) {
  if (!scope || typeof scope.querySelectorAll !== "function") return;
  scope.querySelectorAll(".actions-row").forEach((row) => {
    if (row.nextElementSibling?.classList?.contains("action-legend-row")) return;
    const buttons = Array.from(row.querySelectorAll("button"));
    if (!buttons.length) return;
    const seen = new Set();
    const items = [];
    buttons.forEach((btn) => {
      const label = String(btn.getAttribute("aria-label") || btn.getAttribute("title") || btn.textContent || "")
        .trim()
        .replace(/\s+/g, " ");
      if (!label) return;
      if (seen.has(label.toLowerCase())) return;
      seen.add(label.toLowerCase());
      items.push(label);
    });
    if (!items.length) return;
    const legend = document.createElement("div");
    legend.className = "action-legend-row";
    legend.innerHTML = items
      .slice(0, 12)
      .map((label) => `<span class="action-legend-item">${escapeHtml(label)}</span>`)
      .join("");
    row.insertAdjacentElement("afterend", legend);
  });
}

function applyTemplateVisibility(scope = document) {
  if (!scope || typeof scope.querySelectorAll !== "function") return;
  if (isSuperSystemDeveloperPortal()) return;
  scope.querySelectorAll("[data-template-control='true']").forEach((node) => {
    node.style.display = "none";
  });
}

function styleExamModuleButtonsAsNamedIcons(scope = document) {
  if (!scope || typeof scope.querySelectorAll !== "function") return;
  scope.querySelectorAll("button.ax-btn, .actions-row > button").forEach((button) => {
    if (!button) return;
    button.classList.add("exam-stack-top", "ax-btn--icon-only");
    button.classList.remove("icon-symbolic");
    const label = String(button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent || "")
      .trim()
      .replace(/\s+/g, " ");
    if (label) {
      button.setAttribute("title", label);
      button.setAttribute("aria-label", label);
    }
  });
}

function isSystemAdminRole() {
  const role = String(portalContext?.role || "");
  return ["SUPER_SYSTEM_DEVELOPER", "SYSTEM_DEVELOPER", "SYSTEM_ADMINISTRATOR", "ADMIN", "HEAD_OF_INSTITUTION"].includes(role);
}

function canOpenSecurityAuditModule() {
  const role = normalizeRoleKey(portalContext?.role || "");
  return role === "SUPER_SYSTEM_DEVELOPER" || role === "SYSTEM_DEVELOPER" || role === "SYSTEM_ADMINISTRATOR" || role === "HEAD_OF_INSTITUTION";
}

function isAllowedAccessControlAdministrator() {
  const role = normalizeRoleKey(portalContext?.role || "");
  return role === "SUPER_SYSTEM_DEVELOPER" || role === "SYSTEM_DEVELOPER" || role === "HEAD_OF_INSTITUTION";
}
function isSystemDeveloperRole(roleValue = "") {
  const normalized = String(roleValue || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  return ["SYSTEM_DEVELOPER", "SYSTEMDEVELOPER", "SYTEM_DEVELOPER", "SUPER_SYSTEM_DEVELOPER"].includes(normalized);
}

function formatRoleLabel(role) {
  const normalized = String(role || "").toUpperCase();
  if (normalized === "SUPER_SYSTEM_DEVELOPER") return "SUPER SYSTEM DEVELOPER";
  if (normalized === "SYSTEM_DEVELOPER") return "SYSTEM DEVELOPER";
  if (normalized === "SYSTEM_ADMINISTRATOR") return "SYSTEM ADMINISTRATOR";
  if (normalized === "HEAD_OF_INSTITUTION" || normalized === "ADMIN") return "HoI/Administrator";
  if (normalized === "HEAD_OF_DEPARTMENT") return "Head of Department";
  if (normalized === "SENIOR_TEACHER") return "Senior Teacher";
  return normalized.replaceAll("_", " ");
}

function formatDashboardRoleLabel(role) {
  const normalized = String(role || "").toUpperCase();
  if (normalized === "HEAD_OF_INSTITUTION" || normalized === "ADMIN") return "HoI/Administrator";
  if (normalized === "NON_TEACHING_STAFF") return "Support Staff";
  if (normalized === "SENIOR_TEACHER") return "Senior Teacher";
  if (normalized === "HEAD_OF_DEPARTMENT") return "Head of Department";
  return String(role || "").replaceAll("_", " ");
}

function formatRoleForDisplay(role = "") {
  const normalized = String(role || "").toUpperCase();
  if (normalized === "SUPER_SYSTEM_DEVELOPER") return "SUPER SYSTEM DEVELOPER";
  if (normalized === "SYSTEM_DEVELOPER") return "SYSTEM DEVELOPER";
  if (normalized === "SYSTEM_ADMINISTRATOR") return "SYSTEM ADMINISTRATOR";
  if (normalized === "HEAD_OF_INSTITUTION") return "HOI/ADMINISTRATOR";
  if (normalized === "ADMIN") return "HOI/ADMINISTRATOR";
  if (normalized === "MOD") return "MOE";
  if (normalized === "TSC") return "TSC";
  if (normalized === "SENIOR_TEACHER") return "SENIOR TEACHER";
  if (normalized === "HEAD_OF_DEPARTMENT") return "HEAD OF DEPARTMENT";
  return normalized.replaceAll("_", " ");
}

function toTitleCase(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeRoleKey(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function isSystemAdminRoleValue(roleValue = "") {
  const normalized = normalizeRoleKey(roleValue);
  return ["SUPER_SYSTEM_DEVELOPER", "SYSTEM_DEVELOPER", "SYSTEM_ADMINISTRATOR", "ADMIN", "HEAD_OF_INSTITUTION"].includes(normalized);
}

function shouldHideInstitutionForIdentity(user = {}) {
  const normalizedRole = normalizeRoleKey(user?.role || "");
  return normalizedRole === "TSC" || normalizedRole === "MOD";
}

function friendlyRoleName(roleValue = "") {
  const normalized = normalizeRoleKey(roleValue);
  const map = {
    SUPER_SYSTEM_DEVELOPER: "Super System Developer",
    SYSTEM_DEVELOPER: "System Developer",
    SYSTEM_ADMINISTRATOR: "System Administrator",
    ADMIN: "HoI/Administrator",
    HEAD_OF_INSTITUTION: "HoI/Administrator",
    TEACHER: "Teacher",
    SENIOR_TEACHER: "Senior Teacher",
    HEAD_OF_DEPARTMENT: "Head of Department",
    PARENT: "Parent/Guardian",
    NON_TEACHING_STAFF: "Support Staff",
    BOM: "BoM Member",
    MOD: "MoE",
    TSC: "TSC"
  };
  return map[normalized] || String(roleValue || "-");
}

function buildWelcomeMessageTemplate({ institutionName, institutionCode, fullName, role }) {
  const normalizedRole = normalizeRoleKey(role);
  const resolvedInstitution = String(institutionName || "INSTITUTION").trim();
  const resolvedCode = String(institutionCode || "-").trim();
  const resolvedName = String(fullName || "USER").trim() || "USER";
  if (normalizedRole === "SYSTEM_DEVELOPER") {
    return `WELCOME ${resolvedInstitution || "MWENDEGU ENTERPRISE LIMITED"}-${resolvedCode || "0001"}-SYSTEM DEVELOPER`;
  }
  const roleLabel = formatRoleForDisplay(role || "");
  return `WELCOME ${resolvedName}-${resolvedInstitution}-${resolvedCode}-${roleLabel}`;
}

function systemDeveloperWelcomeMeta(profile = {}) {
  return {
    institutionName: profile?.institution_name || "MWENDEGU ENTERPRISE LIMITED",
    institutionCode: profile?.institution_code || "254001",
    fullName: profile?.full_name || profile?.username || "Mr.EDWIN ONYANGO",
    role: profile?.role || "SYSTEM_DEVELOPER"
  };
}

function buildRoleScopedUserLabel(user = {}) {
  const fullName = String(user?.full_name || user?.username || "-").trim();
  if (shouldHideInstitutionForIdentity(user)) {
    return fullName || "-";
  }
  const institutionName = String(user?.institution_name || "").trim();
  if (!institutionName) return fullName || "-";
  return `${fullName} - ${institutionName}`;
}

function resolveRegistryScopeOptions() {
  const normalizedRole = normalizeRoleKey(portalContext?.role || "");
  if (normalizedRole === "SYSTEM_DEVELOPER") {
    return [
      { key: "institution", label: "Institution" },
      { key: "user", label: "User" }
    ];
  }
  if (normalizedRole === "ADMIN" || normalizedRole === "HEAD_OF_INSTITUTION") {
    return [{ key: "user", label: "User" }];
  }
  return [];
}

function buildAuditOutcomeLabel(row = {}) {
  const action = normalizeRoleKey(row?.action || "");
  if (action.includes("FAILED") || action.includes("LOCKED") || action.includes("DENIED")) {
    return "Mistake/Failed";
  }
  if (action.includes("LOGIN") || action.includes("OTP") || action.includes("SUCCESS")) {
    return "Successful";
  }
  return "Recorded";
}

function buildDashboardFinanceSyncCard(financeSessionSync = null) {
  const defaults = {
    academic_year: "",
    term_name: "",
    capitation_received: "",
    fee_paid: "",
    grant_other: "",
    available_balance: "",
    outstanding_balance: "",
    liabilities: ""
  };
  const values = {
    ...defaults,
    ...(financeSessionSync && typeof financeSessionSync === "object" ? financeSessionSync : {})
  };
  return `
    <section class="dashboard-section">
      <h3>Academic Year / Term Finance Sync</h3>
      <p class="small-note">Enter capitation, fee paid, grant/other, balance, outstanding, and liabilities to keep dashboard figures accurate.</p>
      <div class="register-grid-compact">
        <label>Academic Year</label>
        <input id="dashboardSyncAcademicYear" placeholder="e.g. 2026" value="${escapeHtmlAttribute(values.academic_year || "")}" />
        <label>Term</label>
        <select id="dashboardSyncTermName">
          <option value="">Select term</option>
          ${(Array.isArray(meta?.termOptions) ? meta.termOptions : ["Term One", "Term Two", "Term Three"])
            .map((term) => `<option value="${escapeHtml(term)}" ${term === values.term_name ? "selected" : ""}>${escapeHtml(term)}</option>`)
            .join("")}
        </select>
        <label>Capitation Received</label>
        <input id="dashboardSyncCapitation" type="number" min="0" step="0.01" value="${escapeHtmlAttribute(values.capitation_received || "")}" />
        <label>Fee Paid</label>
        <input id="dashboardSyncFeePaid" type="number" min="0" step="0.01" value="${escapeHtmlAttribute(values.fee_paid || "")}" />
        <label>Grant / Other</label>
        <input id="dashboardSyncGrantOther" type="number" min="0" step="0.01" value="${escapeHtmlAttribute(values.grant_other || "")}" />
        <label>Available Balance</label>
        <input id="dashboardSyncAvailableBalance" type="number" min="0" step="0.01" value="${escapeHtmlAttribute(values.available_balance || "")}" />
        <label>Outstanding Balance</label>
        <input id="dashboardSyncOutstandingBalance" type="number" min="0" step="0.01" value="${escapeHtmlAttribute(values.outstanding_balance || "")}" />
        <label>Liabilities</label>
        <input id="dashboardSyncLiabilities" type="number" min="0" step="0.01" value="${escapeHtmlAttribute(values.liabilities || "")}" />
      </div>
      <div class="actions-row">
        <button id="saveDashboardSyncButton">Save Dashboard Sync</button>
      </div>
    </section>
  `;
}

async function upsertDashboardFinanceSync() {
  const payload = {
    academic_year: String(document.getElementById("dashboardSyncAcademicYear")?.value || "").trim(),
    term_name: String(document.getElementById("dashboardSyncTermName")?.value || "").trim(),
    capitation_received: Number(document.getElementById("dashboardSyncCapitation")?.value || 0),
    fee_paid: Number(document.getElementById("dashboardSyncFeePaid")?.value || 0),
    grant_other: Number(document.getElementById("dashboardSyncGrantOther")?.value || 0),
    available_balance: Number(document.getElementById("dashboardSyncAvailableBalance")?.value || 0),
    outstanding_balance: Number(document.getElementById("dashboardSyncOutstandingBalance")?.value || 0),
    liabilities: Number(document.getElementById("dashboardSyncLiabilities")?.value || 0)
  };
  if (!payload.academic_year || !payload.term_name) {
    throw new Error("Academic year and term are required.");
  }
  const response = await request("/api/finance/session-sync", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return response;
}

async function withLoadingMessage(message, handler) {
  const tableHead = document.getElementById("tableHead");
  const tableBody = document.getElementById("tableBody");
  if (tableHead && tableBody) {
    tableHead.innerHTML = "";
    tableBody.innerHTML = `<tr><td>${escapeHtml(message)}</td></tr>`;
  }
  return handler();
}

async function performRegistryRowAction(entityType, row = {}, action = "view") {
  const rowId = Number(row?.id || 0);
  if (!rowId) {
    alert("Invalid row selected.");
    return;
  }
  try {
    if (entityType === "institution") {
      if (action === "view") {
        const response = await request(`/api/system/registry/institutions/${rowId}/view`);
        alert(JSON.stringify(response?.institution || {}, null, 2));
        return;
      }
      if (action === "edit" || action === "save") {
        const response = await request(`/api/system/registry/institutions/${rowId}/view`);
        const current = response?.institution || {};
        const institutionName = prompt("Institution name", row.institution_name || current.institution_name || "");
        if (institutionName === null) return;
        const county = prompt("County", current.county || "");
        if (county === null) return;
        const subCounty = prompt("Sub county", current.sub_county || "");
        if (subCounty === null) return;
        const location = prompt("Location", current.location || "");
        if (location === null) return;
        const village = prompt("Village", current.village || "");
        if (village === null) return;
        const postalAddress = prompt("Postal address", current.postal_address || "");
        if (postalAddress === null) return;
        const postalCode = prompt("Postal code", current.postal_code || "");
        if (postalCode === null) return;
        const town = prompt("Town", current.town || "");
        if (town === null) return;
        const institutionType = prompt("Institution type", current.institution_type || "");
        if (institutionType === null) return;
        const institutionLevel = prompt("Institution level", current.institution_level || "");
        if (institutionLevel === null) return;
        const email = prompt("Institution email", row.email || current.email || "");
        if (email === null) return;
        const phone = prompt("Institution phone", row.phone || current.phone || "");
        if (phone === null) return;
        await request(`/api/system/registry/institutions/${rowId}`, {
          method: "PATCH",
          body: JSON.stringify({
            institution_name: institutionName,
            county,
            sub_county: subCounty,
            location,
            village,
            postal_address: postalAddress,
            postal_code: postalCode,
            town,
            institution_type: institutionType,
            institution_level: institutionLevel,
            email,
            phone
          })
        });
        alert("Institution saved successfully.");
        await renderInstitutionsRegistry();
        return;
      }
      if (["suspend", "deactivate", "activate", "desuspend"].includes(action)) {
        const requiresReason = action === "suspend" || action === "deactivate";
        const reasonPrompt = requiresReason ? "Reason is required" : "Reason (optional)";
        const reason = prompt(reasonPrompt, "") || "";
        if (requiresReason && !reason.trim()) {
          alert("Reason is required.");
          return;
        }
        const payload =
          action === "suspend"
            ? { is_suspended: true, reason: reason.trim() || null }
            : action === "deactivate"
              ? { is_active: false, reason: reason.trim() || null }
              : action === "activate"
                ? { is_active: true, reason: reason.trim() || null }
                : { is_suspended: false, reason: reason.trim() || null };
        await request(`/api/system/registry/institutions/${rowId}/status`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        alert("Institution status updated.");
        await renderInstitutionsRegistry();
        return;
      }
      if (action === "delete") {
        const ok = await confirmSoftDeletePrompts();
        if (!ok) return;
        await request(`/api/system/registry/institutions/${rowId}`, { method: "DELETE" });
        alert("Institution moved to recycle bin.");
        await renderInstitutionsRegistry();
        return;
      }
      if (action === "print") {
        window.print();
        return;
      }
      if (action === "download") {
        window.open("/api/system/registry/export/excel", "_blank");
        return;
      }
      if (action === "pdf") {
        window.open("/api/system/registry/export/pdf", "_blank");
        return;
      }
      alert("Action is not available for this institution row.");
      return;
    }

    if (action === "view") {
      const response = await request(`/api/system/registry/users/${rowId}/view`);
      alert(JSON.stringify(response?.user || {}, null, 2));
      return;
    }
    if (action === "edit" || action === "save") {
      const fullName = prompt("Full name", row.full_name || "");
      if (fullName === null) return;
      const email = prompt("Email", row.email || "");
      if (email === null) return;
      const phone = prompt("Phone", row.phone || "");
      if (phone === null) return;
      await request(`/api/system/registry/users/${rowId}`, {
        method: "PATCH",
        body: JSON.stringify({
          full_name: fullName,
          email,
          phone
        })
      });
      alert("User saved successfully.");
      await renderInstitutionsRegistry();
      return;
    }
    if (["suspend", "deactivate", "activate", "desuspend"].includes(action)) {
      const requiresReason = action === "suspend" || action === "deactivate";
      const reasonPrompt = requiresReason ? "Reason is required" : "Reason (optional)";
      const reason = prompt(reasonPrompt, "") || "";
      if (requiresReason && !reason.trim()) {
        alert("Reason is required.");
        return;
      }
      const payload =
        action === "suspend"
          ? { is_suspended: true, reason: reason.trim() || null }
          : action === "deactivate"
            ? { is_active: false, reason: reason.trim() || null }
            : action === "activate"
              ? { is_active: true, reason: reason.trim() || null }
              : { is_suspended: false, reason: reason.trim() || null };
      await request(`/api/system/registry/users/${rowId}/status`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      alert("User status updated.");
      await renderInstitutionsRegistry();
      return;
    }
      if (action === "delete") {
        const ok = await confirmSoftDeletePrompts();
        if (!ok) return;
        await request(`/api/users/${rowId}`, { method: "DELETE" });
      alert("User moved to recycle bin.");
      await renderInstitutionsRegistry();
      return;
    }
    if (action === "print") {
      window.print();
      return;
    }
    if (action === "download") {
      window.open("/api/users/export/excel", "_blank");
      return;
    }
    if (action === "pdf") {
      window.open("/api/users/export/pdf", "_blank");
      return;
    }
    alert("Action is not available for this user row.");
  } catch (error) {
    alert(error.message || "Action failed.");
  }
}

async function purgeRecycleWithThreeStepPrompt(recycleId) {
  if (!recycleId) throw new Error("Recycle item id is required.");
  if (!window.confirm("Confirm permanently delete this recycle bin record?")) return null;
  if (!window.confirm("Acknowledge that data cannot be retrieved once permanently deleted.")) return null;
  if (!window.confirm("Confirm the System Developer will not be held individually or collectively liable for this action."))
    return null;
  const first = prompt("Permanent delete verification step 1: Type YES");
  if (first === null) return null;
  const second = prompt("Permanent delete verification step 2: Type CONFIRM");
  if (second === null) return null;
  const third = prompt("Permanent delete verification step 3: Type DELETE");
  if (third === null) return null;
  return request(`/api/system/recycle-bin/${recycleId}`, {
    method: "DELETE",
    body: JSON.stringify({
      confirmations: [first, second, third]
    })
  });
}

function applyDashboardIdentity(meData = {}) {
  const systemTitle = document.querySelector(".sidebar-brand h2");
  const systemSubtitle = document.querySelector(".sidebar-brand p");
  if (systemTitle) {
    systemTitle.textContent = "IMIS SYSTEM";
  }
  if (systemSubtitle) {
    systemSubtitle.textContent = "Integrated Management Information System For Basic Education Learning Institutions";
  }
  const portalLabelEl = document.getElementById("portalLabel");
  const institutionName = String(meData?.institution_name || "").trim() || "INSTITUTION";
  const roleLabel = formatRoleForDisplay(meData?.role || portalContext?.role || "");
  if (portalLabelEl) {
    if (String(meData?.role || "").toUpperCase() === "SYSTEM_DEVELOPER") {
      portalLabelEl.textContent = `System Developer Console (${roleLabel})`;
      portalLabelEl.classList.add("portal-label-system");
      portalLabelEl.classList.remove("portal-label-institution");
    } else {
      portalLabelEl.textContent = `${toTitleCase(institutionName)} (${roleLabel})`;
      portalLabelEl.classList.add("portal-label-institution");
      portalLabelEl.classList.remove("portal-label-system");
    }
  }
  const welcomeEl = document.getElementById("dashboardWelcomeLine");
  const isSystemDeveloper = isSystemDeveloperRole(meData?.role || portalContext?.role || "");
  const welcomeMeta = isSystemDeveloper ? systemDeveloperWelcomeMeta(meData) : {
    institutionName: meData?.institution_name,
    institutionCode: meData?.institution_code,
    fullName: meData?.full_name || meData?.username,
    role: meData?.role || portalContext?.role
  };
  if (welcomeEl) {
    welcomeEl.textContent = buildWelcomeMessageTemplate(welcomeMeta);
  }
  const welcomeMetaEl = document.getElementById("dashboardWelcomeMeta");
  if (welcomeMetaEl) {
    const resolvedRole = friendlyRoleName(meData?.role || portalContext?.role || "");
    welcomeMetaEl.innerHTML = `
      <span class="tag">Institution: ${escapeHtml(toTitleCase(institutionName))}</span>
      <span class="tag">Code: ${escapeHtml(String(meData?.institution_code || "-"))}</span>
      <span class="tag">Role: ${escapeHtml(resolvedRole)}</span>
    `;
  }
  // Keep dashboard cockpit stable: do not mount login hero image here.
  // Large institution hero images can expand the welcome block and visually
  // mask modules/cards on smaller screens.
  const staleLogoWrap = document.getElementById("dashboardInstitutionLogoWrap");
  if (staleLogoWrap) {
    staleLogoWrap.remove();
  }
}

async function renderSystemRegistration(options = {}) {
  setActiveSidebarButton("system-register");
  document.getElementById("moduleTitle").textContent = "Institution Registration";
  if (!isSystemAdminRole()) {
    alert("Only Super/System Developer, System Administrator, HoI/Administrator can access registration center.");
    return loadDashboard();
  }
  try {
    const [registrarOptions, users] = await Promise.all([
      request("/api/users/registrar-options"),
      request("/api/users")
    ]);
    const institutionRows = Array.isArray(registrarOptions?.institutions) ? registrarOptions.institutions : [];
    const userRows = Array.isArray(users) ? users : [];
    const actorRole = normalizeRoleKey(portalContext?.role || "");
    const roleOptionsRaw = Array.isArray(registrarOptions?.assignable_roles) ? registrarOptions.assignable_roles : [];
    const roleOptions = roleOptionsRaw.filter((role) => {
      if (normalizeRoleKey(role) !== "SUPER_SYSTEM_DEVELOPER") return true;
      return actorRole === "SUPER_SYSTEM_DEVELOPER";
    });
    const developerRoles = roleOptions.filter((role) =>
      ["SUPER_SYSTEM_DEVELOPER", "SYSTEM_DEVELOPER"].includes(normalizeRoleKey(role))
    );
    const hoiAdminRoles = roleOptions.filter((role) =>
      ["HEAD_OF_INSTITUTION", "ADMIN", "SYSTEM_ADMINISTRATOR"].includes(normalizeRoleKey(role))
    );
    const userRegistrationRoles = roleOptions.filter((role) =>
      !["SUPER_SYSTEM_DEVELOPER", "SYSTEM_DEVELOPER"].includes(normalizeRoleKey(role))
    );
    const canRegisterInstitution = Boolean(registrarOptions?.can_register_institution);
    const canManageAllInstitutions = Boolean(registrarOptions?.can_manage_all_institutions);
    const canRegisterUsers = Boolean(registrarOptions?.can_register_users);
    const registrationMeta = registrarOptions?.registration_meta || null;
    const defaultInstitutionId =
      Number(registrarOptions?.institution_scope_id || 0) ||
      Number(portalContext?.institution_id || 0) ||
      Number(institutionRows[0]?.id || 0) ||
      0;
    const defaultInstitution =
      institutionRows.find((item) => Number(item.id) === defaultInstitutionId) ||
      institutionRows[0] ||
      null;
    const defaultRole = roleOptions[0] || "";
    const defaultDeveloperRole = developerRoles.find((role) => normalizeRoleKey(role) === "SYSTEM_DEVELOPER") || developerRoles[0] || "";
    const defaultHoiAdminRole = hoiAdminRoles.find((role) => normalizeRoleKey(role) === "HEAD_OF_INSTITUTION") || hoiAdminRoles[0] || "";
    const defaultUserRole = userRegistrationRoles[0] || roleOptions.find((role) => normalizeRoleKey(role) === "TEACHER") || "";
    const institutionRowsSorted = [...institutionRows].sort((a, b) =>
      String(a?.institution_name || "").localeCompare(String(b?.institution_name || ""))
    );
    const canSelectInstitutionForUser = canManageAllInstitutions;
    let latestInstitutionId = Number(defaultInstitution?.id || 0) || null;
    const composePrefixedPhone = (prefixElementId, localElementId) => {
      const prefix = String(document.getElementById(prefixElementId)?.value || "").trim();
      const localDigits = String(document.getElementById(localElementId)?.value || "")
        .replace(/[^\d+]/g, "")
        .slice(0, 25);
      if (!prefix && !localDigits) return "";
      return `${prefix}${localDigits}`;
    };

    const renderRegistryUserActions = (row) => {
      const rowId = Number(row?.id || 0);
      if (!rowId) return "-";
      return `
        <div class="search-inline-actions">
          <button class="search-action-icon view" title="View" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'view')">👁</button>
          <button class="search-action-icon edit" title="Edit" onclick="performRegistryRowAction('user', ${JSON.stringify({
            id: rowId,
            full_name: row?.full_name || "",
            email: row?.email || "",
            phone: row?.phone || ""
          }).replace(/"/g, "&quot;")}, 'edit')">✎</button>
          <button class="search-action-icon save" title="Save" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'save')">💾</button>
          <button class="search-action-icon print" title="Print" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'print')">🖨</button>
          <button class="search-action-icon pdf" title="PDF" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'pdf')">📄</button>
          <button class="search-action-icon download" title="Download" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'download')">⬇</button>
          <button class="search-action-icon delete" title="Delete" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'delete')">🗑</button>
          <button class="search-action-icon edit" title="Deactivate" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'deactivate')">⛔</button>
          <button class="search-action-icon view" title="Suspend" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'suspend')">⏸</button>
          <button class="search-action-icon save" title="Activate" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'activate')">▶</button>
          <button class="search-action-icon download" title="Desuspend" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'desuspend')">⏯</button>
        </div>
      `;
    };

    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>Registration Center</h4>
        <p>${formatNumber(institutionRows.length)} institution(s)</p>
      </div>
      <div class="card stats-card">
        <h4>Registered Users</h4>
        <p>${formatNumber(userRows.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Scope</h4>
        <p>${canManageAllInstitutions ? "System Developer - Global" : "HoI/Admin - Institution Only"}</p>
      </div>
    `;

    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Institution Registration</h3>
        <p>Use sub-modules: Institution Registration, SSD/SD Registration, HOI/Admin/System Administrator Registration, and User Registration.</p>
      </div>

      ${canRegisterInstitution ? `
      <section id="registrationInstitutionSection" class="registration-compact-card register-section-compact">
        <div class="section-card-header">
          <h3>Institution Registration</h3>
          <p class="small-note">SSD/SD only. Institution code auto-generates from county + institution level using first-come sequencing.</p>
        </div>
        <div class="form-grid registration-compact-grid">
          <label>Institution Name</label>
          <input id="sysInstitutionName" placeholder="Institution name" />
          <label>Institution Type</label>
          <select id="sysInstitutionType">
            <option value="">Select type</option>
            <option value="Private">Private</option>
            <option value="Public">Public</option>
          </select>
          <label>County</label>
          ${
            registrationMeta?.counties?.length
              ? `<select id="sysInstitutionCounty">
                  <option value="">Select county</option>
                  ${registrationMeta.counties
                    .map((c) => `<option value="${escapeHtml(c.name)}" data-county-code="${escapeHtml(c.code)}">${escapeHtml(c.name)} (${escapeHtml(c.code)})</option>`)
                    .join("")}
                  <option value="Other" data-county-code="048">Other (048)</option>
                </select>`
              : `<input id="sysInstitutionCounty" placeholder="County" />`
          }
          <label>Institution's Code</label>
          <input id="sysInstitutionCodePreview" class="readonly-field" readonly placeholder="Auto-generated code" />
          <input id="sysInstitutionCountyCode" type="hidden" />
          <label>Institution Level</label>
          <select id="sysInstitutionLevel">
            <option value="">Select level</option>
            <option value="P">Primary (P)</option>
            <option value="PJ">Primary/Junior (PJ)</option>
            <option value="JS">Junior Secondary (JS)</option>
            <option value="SS">Senior Secondary (SS)</option>
          </select>
          <label style="display:none;">Category</label>
          <select id="sysInstitutionCategory" style="display:none;">
            <option value="Primary">Primary (P)</option>
            <option value="Primary/Junior">Primary/Junior (PJ)</option>
            <option value="Junior Secondary">Junior Secondary (JS)</option>
            <option value="Senior Secondary">Senior Secondary (SS)</option>
          </select>
          <label>Sub County</label>
          <input id="sysInstitutionSubCounty" placeholder="Sub county" />
          <label>Location</label>
          <input id="sysInstitutionLocation" placeholder="Location" />
          <label>Village</label>
          <input id="sysInstitutionVillage" placeholder="Village" />
          <label>Postal Address</label>
          <input id="sysInstitutionPostalAddress" placeholder="P.O Box ..." />
          <label>Postal Code</label>
          ${
            registrationMeta?.postalCodes?.length
              ? `<select id="sysInstitutionPostalCode">
                  <option value="">Select postal code</option>
                  ${registrationMeta.postalCodes
                    .map((p) => `<option value="${escapeHtml(String(p.postal_code))}">${escapeHtml(String(p.postal_code))} — ${escapeHtml(p.town)}</option>`)
                    .join("")}
                  <option value="__manual__">Manual entry</option>
                </select>`
              : `<input id="sysInstitutionPostalCode" placeholder="Postal code" />`
          }
          <label id="sysInstitutionManualPostalCodeLabel" style="display:none;">Manual Postal Code</label>
          <input id="sysInstitutionManualPostalCode" placeholder="Enter postal code manually" style="display:none;" />
          <label>Town</label>
          <input id="sysInstitutionTown" placeholder="Town" />
        </div>
        <div class="agreement-toolbar-row" id="sysAgreementActionsRow">
          <button id="sysSendAgreementButton" style="display:none;">Send Agreement</button>
          <button id="sysViewAgreementButton">View PDF</button>
          <button id="sysDownloadAgreementButton">Download PDF</button>
          <button id="sysPrintAgreementButton">Print PDF</button>
        </div>
        <div class="form-grid registration-compact-grid" data-template-control="true">
          <label>Agreement Template Institution</label>
          <select id="sysAgreementInstitutionId">
            ${institutionRows
              .map((item) => `<option value="${item.id}" ${Number(item.id) === Number(defaultInstitutionId) ? "selected" : ""}>${escapeHtml(item.institution_name || "Institution")} (${escapeHtml(item.institution_code || "-")})</option>`)
              .join("")}
          </select>
          <label>Upload Agreement Letter Sample (PDF)</label>
          <input id="sysAgreementTemplateFile" type="file" accept="application/pdf" />
          <label>Agreement Template Text</label>
          <textarea id="sysAgreementTemplateText" class="template-spacious" rows="10" placeholder="Optional agreement body template"></textarea>
        </div>
        <div class="agreement-toolbar-row" data-template-control="true">
          <button id="sysSaveAgreementTemplateButton">Save Template</button>
          <button id="sysLoadAgreementTemplateButton">Open Template</button>
          <button id="sysDeleteAgreementTemplateButton" class="danger-button">Delete Template</button>
        </div>
        <div class="dashboard-welcome-pill" id="agreementPreviewBox">
          <strong>Agreement Preview:</strong>
          <div id="agreementPreviewBody">Institution Name · Postal Address · Addressee · Date/Time</div>
        </div>
        <div class="registration-compact-actions">
          <button id="sysRegisterInstitutionButton">Register Institution</button>
        </div>
        <div class="module-header-card">
          <h4>Registered Institutions</h4>
          <p class="small-note">Search by county, name, level, and type. Edit opens Institution Registration for amendment.</p>
        </div>
        <div class="form-grid registration-compact-grid">
          <label>Search by County</label>
          <input id="registeredInstitutionSearchCounty" placeholder="County" />
          <label>Search by Name</label>
          <input id="registeredInstitutionSearchName" placeholder="Institution name" />
          <label>Search by Level</label>
          <input id="registeredInstitutionSearchLevel" placeholder="P/PJ/JS/SS" />
          <label>Search by Type</label>
          <input id="registeredInstitutionSearchType" placeholder="Public/Private" />
        </div>
        <div class="iim-actions-row">
          <button id="registeredInstitutionRefreshButton" class="iim-action-btn">↻ Refresh</button>
          <button id="registeredInstitutionPrintButton" class="iim-action-btn">🖨 Print</button>
          <button id="registeredInstitutionPdfButton" class="iim-action-btn warn">📄 PDF</button>
          <button id="registeredInstitutionExcelButton" class="iim-action-btn warn">⬇ Excel</button>
        </div>
        <div id="registeredInstitutionsTableHost"></div>
      </section>
      ` : `
      <section id="registrationInstitutionSection" class="registration-compact-card register-section-compact">
        <div class="section-card-header">
          <h3>Register Institution</h3>
          <p class="small-note">Visible but not active for this role.</p>
        </div>
        <p class="small-note">Not allowed.</p>
      </section>
      `}

      <section id="registrationDeveloperSection" class="registration-compact-card register-section-compact">
        <div class="section-card-header">
          <h3>Super System Developer and System Developer Registration</h3>
          <p class="small-note">Only Super System Developer can register SSD/SD accounts.</p>
        </div>
        <div class="form-grid registration-compact-grid">
          <label>Institution</label>
          <select id="sysDevInstitutionId">
            ${institutionRowsSorted
              .map((item) => `<option value="${item.id}" ${Number(item.id) === Number(defaultInstitutionId) ? "selected" : ""}>${escapeHtml(item.institution_name || "Institution")} (${escapeHtml(item.institution_code || "-")})</option>`)
              .join("")}
          </select>
          <label>Name</label>
          <input id="sysDevFullName" placeholder="Full name" />
          <label>Prefix</label>
          <select id="sysDevPhonePrefix">
            <option value="+254">+254</option>
            <option value="07">07</option>
            <option value="01">01</option>
            <option value="+">+</option>
          </select>
          <label>Mobile Digits</label>
          <input id="sysDevPhoneLocal" placeholder="Mobile number digits" />
          <label>Postal Address</label>
          <input id="sysDevPostalAddress" placeholder="P.O. Box..." />
          <label>Postal Code</label>
          <input id="sysDevPostalCode" placeholder="Postal code" />
          <label>Town</label>
          <input id="sysDevTown" placeholder="Town" />
          <label>Role</label>
          <select id="sysDevRole">
            ${developerRoles.map((role) => `<option value="${escapeHtml(role)}" ${role === defaultDeveloperRole ? "selected" : ""}>${escapeHtml(toLabel(role))}</option>`).join("")}
          </select>
          <label>Username</label>
          <input id="sysDevUsername" placeholder="Username" />
          <label>Password Mode</label>
          <select id="sysDevAutoPassword">
            <option value="true">Auto</option>
            <option value="false">Manual</option>
          </select>
          <label>Manual Password</label>
          <input id="sysDevPassword" type="text" placeholder="Enter manual password if Auto=No" />
          <label>Email</label>
          <input id="sysDevEmail" placeholder="Email" />
        </div>
        <div class="registration-compact-actions">
          <button id="sysRegisterDeveloperButton">Register SSD/SD</button>
        </div>
        <div class="module-header-card">
          <h4>Registered Super System Developers and System Developers</h4>
        </div>
        <div id="registeredDevelopersTableHost"></div>
      </section>

      <section id="registrationHoiAdminSection" class="registration-compact-card register-section-compact">
        <div class="section-card-header">
          <h3>HOI/Administrator/System Administrator Registration</h3>
          <p class="small-note">Select institution first to activate role and user details.</p>
        </div>
        <div class="form-grid registration-compact-grid">
          <label>Institution (A-Z)</label>
          <select id="sysHoiInstitutionId">
            <option value="">Select institution</option>
            ${institutionRowsSorted
              .map((item) => `<option value="${item.id}">${escapeHtml(item.institution_name || "Institution")} (${escapeHtml(item.institution_code || "-")})</option>`)
              .join("")}
          </select>
          <label>Institution Code</label>
          <input id="sysHoiInstitutionCode" readonly class="readonly-field" />
          <label>Role</label>
          <select id="sysHoiRole" disabled>
            ${hoiAdminRoles.map((role) => `<option value="${escapeHtml(role)}" ${role === defaultHoiAdminRole ? "selected" : ""}>${escapeHtml(toLabel(role))}</option>`).join("")}
          </select>
          <label>Full Name</label>
          <input id="sysHoiFullName" placeholder="Full name" disabled />
          <label>Email</label>
          <input id="sysHoiEmail" placeholder="Email" disabled />
          <label>Phone Prefix</label>
          <select id="sysHoiPhonePrefix" disabled>
            <option value="+254">+254</option>
            <option value="07">07</option>
            <option value="01">01</option>
            <option value="+">+</option>
          </select>
          <label>Mobile Digits</label>
          <input id="sysHoiPhoneLocal" placeholder="Mobile digits" disabled />
          <label>Username</label>
          <input id="sysHoiUsername" placeholder="Username" disabled />
          <label>Auto Password</label>
          <select id="sysHoiAutoPassword" disabled>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
          <label>Password (Manual if Auto=No)</label>
          <input id="sysHoiPassword" type="text" placeholder="Manual password" disabled />
          <label>Delivery Mode</label>
          <select id="sysHoiWelcomeDispatch" disabled>
            <option value="SMS">SMS</option>
            <option value="EMAIL">Email</option>
            <option value="BOTH">Email & SMS</option>
          </select>
          <label>Generate Agreement Letter</label>
          <select id="sysHoiGenerateAgreement" disabled>
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
          <label>Agreement Mode</label>
          <select id="sysHoiAgreementMode" disabled>
            <option value="EMAIL">Email</option>
            <option value="PRINT">Print</option>
            <option value="PDF">PDF</option>
          </select>
          <label>Agreement Letter Sample Upload</label>
          <input id="sysHoiAgreementSample" type="file" accept=".pdf,.doc,.docx,.txt" disabled />
        </div>
        <div class="registration-compact-actions">
          <button id="sysRegisterHoiAdminButton">Register HOI/Admin/System Admin</button>
        </div>
        <div class="module-header-card">
          <h4>HOI/Administrator and System Administrator Profile</h4>
          <p class="small-note">HOI rows highlighted green, System Administrator rows highlighted yellow.</p>
        </div>
        <div class="form-grid registration-compact-grid">
          <label>Search Institution</label>
          <input id="hoiProfileSearchInstitution" placeholder="Institution" />
          <label>Search County</label>
          <input id="hoiProfileSearchCounty" placeholder="County" />
          <label>Search Level</label>
          <input id="hoiProfileSearchLevel" placeholder="Level" />
          <label>Search Category</label>
          <input id="hoiProfileSearchCategory" placeholder="Role/category" />
        </div>
        <div id="registeredHoiAdminsTableHost"></div>
      </section>

      <section id="registrationUserSection" class="registration-compact-card register-section-compact">
        <div class="section-card-header">
          <h3>User Registration</h3>
          <p class="small-note">Auto-generated password can be sent through Email, SMS, or both with legal onboarding text.</p>
        </div>
        <div class="form-grid registration-compact-grid">
          <label>Institution</label>
          <select id="sysUserInstitutionId" ${canSelectInstitutionForUser ? "" : "disabled"}>
            ${institutionRows
              .map((item) => `<option value="${item.id}" ${Number(item.id) === Number(defaultInstitutionId) ? "selected" : ""}>${escapeHtml(item.institution_name || "Institution")} (${escapeHtml(item.institution_code || "-")})</option>`)
              .join("")}
          </select>
          <label>Institution's Code</label>
          <input id="sysUserInstitutionCodePreview" class="readonly-field" readonly value="${escapeHtmlAttribute(defaultInstitution?.institution_code || "")}" />
          <label>Full Name</label>
          <input id="sysUserFullName" placeholder="Full name" />
          <label>Username</label>
          <input id="sysUserUsername" placeholder="Username" />
          <label>Role</label>
          <select id="sysUserRole">
            ${(userRegistrationRoles.length ? userRegistrationRoles : roleOptions).map((role) => `<option value="${escapeHtml(role)}" ${role === defaultUserRole ? "selected" : ""}>${escapeHtml(toLabel(role))}</option>`).join("")}
          </select>
          <label>Email</label>
          <input id="sysUserEmail" placeholder="Email" />
          <label>Phone Prefix</label>
          <select id="sysUserPhonePrefix">
            <option value="+254">+254</option>
            <option value="07">07</option>
            <option value="01">01</option>
            <option value="+">+</option>
          </select>
          <label>Phone Digits</label>
          <input id="sysUserPhoneLocal" maxlength="25" placeholder="Remaining digits (max 25)" />
          <label>Password</label>
          <input id="sysUserPassword" type="text" placeholder="Manual password if auto-generate is No" />
          <label>Auto Password</label>
          <select id="sysUserAutoPassword">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
          <label>Welcome Message Delivery</label>
          <select id="sysUserWelcomeDispatch">
            <option value="BOTH">Email + SMS</option>
            <option value="EMAIL">Email only</option>
            <option value="SMS">SMS only</option>
            <option value="NONE">Do not send</option>
          </select>
        </div>
        <div class="registration-compact-actions">
          <button id="sysRegisterUserButton" ${canRegisterUsers ? "" : "disabled"}>Register User</button>
          <button id="refreshInstitutionRegistryButton">Refresh User List</button>
        </div>
      </section>

      <section id="registrationUsersListSection" class="registration-compact-card register-section-compact">
        <div class="section-card-header">
          <h3>Users Register</h3>
          <p class="small-note">List of registered users aligned per institution with action icons.</p>
        </div>
        <div class="form-grid registration-compact-grid">
          <label>Search User Name</label>
          <input id="registeredUsersSearchName" placeholder="User name" />
          <label>Search Institution</label>
          <input id="registeredUsersSearchInstitution" placeholder="Institution" />
        </div>
        <div class="search-inline-actions">
          <button class="search-action-icon edit" id="bulkEditUserButton" title="Edit User">✎ Edit User</button>
          <button class="search-action-icon view" id="bulkViewUserButton" title="View User">👁 View User</button>
          <button class="search-action-icon delete" id="bulkDeleteUserButton" title="Delete User">🗑 Delete User</button>
          <button class="search-action-icon save" id="bulkRefreshUserButton" title="Refresh User">↻ Refresh User</button>
        </div>
        ${buildDashboardTable(
          ["Name", "Username", "Role", "Institution", "Email", "Phone", "Created", "Actions"],
          userRows.map((row) => [
            row.full_name || "-",
            row.username || "-",
            formatRoleDisplay(row.role || "-"),
            row.institution_name || row.institution_id || "-",
            row.email || "-",
            row.phone || "-",
            formatDateTime(row.created_at),
            renderRegistryUserActions(row)
          ])
        )}
      </section>
    `;

    const institutionDataRows = institutionRowsSorted.map((item) => ({
      id: Number(item.id || 0),
      institution_name: item.institution_name || "-",
      institution_code: item.institution_code || "-",
      county: item.county || "",
      institution_level: item.category_code || item.category || "",
      institution_type: item.institution_type || ""
    }));
    const renderRegisteredInstitutionsTable = () => {
      const host = document.getElementById("registeredInstitutionsTableHost");
      if (!host) return;
      const searchCounty = String(document.getElementById("registeredInstitutionSearchCounty")?.value || "").trim().toLowerCase();
      const searchName = String(document.getElementById("registeredInstitutionSearchName")?.value || "").trim().toLowerCase();
      const searchLevel = String(document.getElementById("registeredInstitutionSearchLevel")?.value || "").trim().toLowerCase();
      const searchType = String(document.getElementById("registeredInstitutionSearchType")?.value || "").trim().toLowerCase();
      const filtered = institutionDataRows.filter((row) => {
        if (searchCounty && !String(row.county || "").toLowerCase().includes(searchCounty)) return false;
        if (searchName && !String(row.institution_name || "").toLowerCase().includes(searchName)) return false;
        if (searchLevel && !String(row.institution_level || "").toLowerCase().includes(searchLevel)) return false;
        if (searchType && !String(row.institution_type || "").toLowerCase().includes(searchType)) return false;
        return true;
      });
      host.innerHTML = buildDashboardTable(
        ["Institution", "Code", "County", "Level", "Type", "Actions"],
        filtered.map((row) => [
          row.institution_name,
          row.institution_code,
          row.county || "-",
          row.institution_level || "-",
          row.institution_type || "-",
          `<div class="search-inline-actions">
            <button class="search-action-icon view" onclick="performRegistryRowAction('institution', { id: ${Number(row.id || 0)} }, 'view')" title="View">👁</button>
            <button class="search-action-icon edit" onclick="performRegistryRowAction('institution', { id: ${Number(row.id || 0)} }, 'edit')" title="Edit">✎</button>
            <button class="search-action-icon save" onclick="performRegistryRowAction('institution', { id: ${Number(row.id || 0)} }, 'save')" title="Save">💾</button>
            ${actorRole === "SUPER_SYSTEM_DEVELOPER" ? `<button class="search-action-icon delete" onclick="performRegistryRowAction('institution', { id: ${Number(row.id || 0)} }, 'delete')" title="Delete">🗑</button>` : ""}
            <button class="search-action-icon edit" onclick="performRegistryRowAction('institution', { id: ${Number(row.id || 0)} }, 'deactivate')" title="Deactivate">⛔</button>
            <button class="search-action-icon view" onclick="performRegistryRowAction('institution', { id: ${Number(row.id || 0)} }, 'suspend')" title="Suspend">⏸</button>
            <button class="search-action-icon save" onclick="performRegistryRowAction('institution', { id: ${Number(row.id || 0)} }, 'activate')" title="Activate">▶</button>
            <button class="search-action-icon download" onclick="performRegistryRowAction('institution', { id: ${Number(row.id || 0)} }, 'desuspend')" title="Desuspend">⏯</button>
            <button class="search-action-icon print" onclick="performRegistryRowAction('institution', { id: ${Number(row.id || 0)} }, 'print')" title="Print">🖨</button>
            <button class="search-action-icon pdf" onclick="performRegistryRowAction('institution', { id: ${Number(row.id || 0)} }, 'pdf')" title="PDF">📄</button>
          </div>`
        ])
      );
    };

    const renderRoleScopedTable = (hostId, rowsInput, titleRoleFilter = () => true) => {
      const host = document.getElementById(hostId);
      if (!host) return;
      const rowsScoped = (Array.isArray(rowsInput) ? rowsInput : []).filter(titleRoleFilter);
      host.innerHTML = buildDashboardTable(
        ["Name", "Role", "Institution", "Code", "Actions"],
        rowsScoped.map((row) => {
          const roleKey = normalizeRoleKey(row.role || "");
          const roleClass =
            roleKey === "HEAD_OF_INSTITUTION" || roleKey === "ADMIN"
              ? "role-chip role-chip--hoi"
              : roleKey === "SYSTEM_ADMINISTRATOR"
                ? "role-chip role-chip--sysadmin"
                : "role-chip";
          return [
            row.full_name || "-",
            `<span class="${roleClass}">${escapeHtml(formatRoleDisplay(row.role || "-"))}</span>`,
            row.institution_name || "-",
            row.institution_code || "-",
            renderRegistryUserActions(row)
          ];
        })
      );
    };

    resetDataTable("Registration center loaded.");

    const institutionSelect = document.getElementById("sysUserInstitutionId");
    const userInstitutionCodePreview = document.getElementById("sysUserInstitutionCodePreview");
    const agreementInstitutionSelect = document.getElementById("sysAgreementInstitutionId");
    const countySelect = document.getElementById("sysInstitutionCounty");
    const countyCodeInput = document.getElementById("sysInstitutionCountyCode");
    const levelSelect = document.getElementById("sysInstitutionLevel");
    const categorySelect = document.getElementById("sysInstitutionCategory");
    const institutionCodePreview = document.getElementById("sysInstitutionCodePreview");
    const postalCodeSelect = document.getElementById("sysInstitutionPostalCode");
    const townInput = document.getElementById("sysInstitutionTown");
    const manualPostalInput = document.getElementById("sysInstitutionManualPostalCode");
    const manualPostalLabel = document.getElementById("sysInstitutionManualPostalCodeLabel");
    const sendAgreementSelect = document.getElementById("sysInstitutionSendAgreement");
    const sendAgreementButton = document.getElementById("sysSendAgreementButton");
    const viewAgreementButton = document.getElementById("sysViewAgreementButton");
    const downloadAgreementButton = document.getElementById("sysDownloadAgreementButton");
    const printAgreementButton = document.getElementById("sysPrintAgreementButton");
    const previewBody = document.getElementById("agreementPreviewBody");

    const getInstitutionForSelection = (institutionId) =>
      institutionRows.find((item) => Number(item.id) === Number(institutionId)) || null;

    const updateUserInstitutionCodePreview = () => {
      if (!institutionSelect || !userInstitutionCodePreview) return;
      const selectedInstitution = getInstitutionForSelection(institutionSelect.value);
      userInstitutionCodePreview.value = selectedInstitution?.institution_code || "";
    };

    const updateAgreementPreview = () => {
      if (!previewBody) return;
      const institutionName = String(document.getElementById("sysInstitutionName")?.value || "").trim() || "-";
      const postalAddress = String(document.getElementById("sysInstitutionPostalAddress")?.value || "").trim() || "-";
      const addressee = String(document.getElementById("sysInstitutionAdminName")?.value || "").trim() || "Head of Institution / Deputy";
      previewBody.textContent = `${institutionName} | P.O Box ${postalAddress} | To: ${addressee} | ${formatDateTime(new Date())}`;
    };

    const togglePostalManualEntry = () => {
      if (!postalCodeSelect || !manualPostalInput || !manualPostalLabel) return;
      const manual = String(postalCodeSelect.value || "") === "__manual__";
      manualPostalInput.style.display = manual ? "block" : "none";
      manualPostalLabel.style.display = manual ? "block" : "none";
      if (!manual) {
        manualPostalInput.value = "";
      }
    };

    const syncPostalTown = () => {
      if (!postalCodeSelect || !townInput || !Array.isArray(registrationMeta?.postalCodes)) return;
      const code = String(postalCodeSelect.value || "");
      const selected = registrationMeta.postalCodes.find((item) => String(item.postal_code) === code);
      if (selected && selected.town) {
        townInput.value = selected.town;
      }
    };

    const refreshInstitutionCodePreview = async () => {
      if (!canRegisterInstitution || !institutionCodePreview || !countySelect || !categorySelect) return;
      const countyValue = String(countySelect.value || "").trim();
      const categoryValue = String(categorySelect.value || "").trim();
      if (!countyValue || !categoryValue) {
        institutionCodePreview.value = "";
        return;
      }
      const selectedCounty = countySelect.selectedOptions?.[0];
      const countyCode = String(selectedCounty?.dataset?.countyCode || "").trim();
      countyCodeInput.value = countyCode;
      try {
        const preview = await request("/api/institutions/preview-code", {
          method: "POST",
          body: JSON.stringify({
            county: countyValue,
            county_code: countyCode,
            category: categoryValue
          })
        });
        institutionCodePreview.value = preview?.institution_code || "";
      } catch (_) {
        institutionCodePreview.value = "";
      }
    };

    const syncLevelCategory = () => {
      if (!levelSelect || !categorySelect) return;
      const level = String(levelSelect.value || "").trim().toUpperCase();
      const mapByLevel = {
        P: "Primary",
        PJ: "Primary/Junior",
        JS: "Junior Secondary",
        SS: "Senior Secondary"
      };
      if (mapByLevel[level]) {
        categorySelect.value = mapByLevel[level];
      }
    };

    const toggleAgreementActionState = () => {
      const canSendAgreement = String(sendAgreementSelect?.value || "false") === "true";
      if (sendAgreementButton) sendAgreementButton.style.display = canSendAgreement ? "inline-flex" : "none";
      if (viewAgreementButton) viewAgreementButton.style.display = canSendAgreement ? "none" : "inline-flex";
      if (downloadAgreementButton) downloadAgreementButton.style.display = canSendAgreement ? "none" : "inline-flex";
      if (printAgreementButton) printAgreementButton.style.display = canSendAgreement ? "none" : "inline-flex";
    };

    const resolveAgreementInstitutionId = () => {
      if (agreementInstitutionSelect && Number(agreementInstitutionSelect.value || 0) > 0) {
        return Number(agreementInstitutionSelect.value);
      }
      if (latestInstitutionId && Number(latestInstitutionId) > 0) {
        return Number(latestInstitutionId);
      }
      if (institutionSelect && Number(institutionSelect.value || 0) > 0) {
        return Number(institutionSelect.value);
      }
      return Number(defaultInstitutionId || 0) || null;
    };

    institutionSelect?.addEventListener("change", updateUserInstitutionCodePreview);
    updateUserInstitutionCodePreview();
    countySelect?.addEventListener("change", refreshInstitutionCodePreview);
    levelSelect?.addEventListener("change", () => {
      syncLevelCategory();
      refreshInstitutionCodePreview();
    });
    categorySelect?.addEventListener("change", refreshInstitutionCodePreview);
    postalCodeSelect?.addEventListener("change", () => {
      togglePostalManualEntry();
      syncPostalTown();
    });
    sendAgreementSelect?.addEventListener("change", toggleAgreementActionState);
    document.getElementById("sysInstitutionName")?.addEventListener("input", updateAgreementPreview);
    document.getElementById("sysInstitutionPostalAddress")?.addEventListener("input", updateAgreementPreview);
    document.getElementById("sysInstitutionAdminName")?.addEventListener("input", updateAgreementPreview);
    togglePostalManualEntry();
    syncLevelCategory();
    toggleAgreementActionState();
    updateAgreementPreview();
    if (!canSelectInstitutionForUser && institutionSelect) {
      institutionSelect.disabled = true;
    }

    document.getElementById("sysRegisterInstitutionButton")?.addEventListener("click", async () => {
      try {
        const postalCodeValue = String(postalCodeSelect?.value || "").trim();
        const payload = {
          institution_name: String(document.getElementById("sysInstitutionName")?.value || "").trim(),
          institution_type: String(document.getElementById("sysInstitutionType")?.value || "").trim() || null,
          institution_level: String(document.getElementById("sysInstitutionLevel")?.value || "").trim() || null,
          county: String(countySelect?.value || "").trim(),
          county_code: String(countyCodeInput?.value || "").trim(),
          category: String(categorySelect?.value || "").trim(),
          sub_county: String(document.getElementById("sysInstitutionSubCounty")?.value || "").trim(),
          location: String(document.getElementById("sysInstitutionLocation")?.value || "").trim(),
          village: String(document.getElementById("sysInstitutionVillage")?.value || "").trim(),
          postal_address: String(document.getElementById("sysInstitutionPostalAddress")?.value || "").trim(),
          postal_code: postalCodeValue,
          postal_code_manual: postalCodeValue === "__manual__"
            ? String(manualPostalInput?.value || "").trim()
            : undefined,
          town: String(document.getElementById("sysInstitutionTown")?.value || "").trim()
        };
        const result = await request("/api/institutions", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        latestInstitutionId = Number(result?.institution_id || 0) || latestInstitutionId;
        alert(`Institution registered successfully. Code: ${result.institution_code}`);
        await renderSystemRegistration();
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("sysRegisterUserButton")?.addEventListener("click", async () => {
      try {
        const autoGenerate = String(document.getElementById("sysUserAutoPassword")?.value || "true") === "true";
        const payload = {
          institution_id: Number(institutionSelect?.value || 0) || undefined,
          full_name: String(document.getElementById("sysUserFullName")?.value || "").trim(),
          username: String(document.getElementById("sysUserUsername")?.value || "").trim(),
          role: String(document.getElementById("sysUserRole")?.value || defaultRole),
          email: String(document.getElementById("sysUserEmail")?.value || "").trim(),
          phone: composePrefixedPhone("sysUserPhonePrefix", "sysUserPhoneLocal"),
          auto_generate_password: autoGenerate,
          password: autoGenerate ? null : String(document.getElementById("sysUserPassword")?.value || ""),
          send_welcome_via: String(document.getElementById("sysUserWelcomeDispatch")?.value || "BOTH")
        };
        const result = await request("/api/users", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        const passwordLine = result?.generated_password ? ` Generated Password: ${result.generated_password}` : "";
        alert(`${result.message || "User registered successfully."}${passwordLine}`);
        await renderSystemRegistration();
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("refreshInstitutionRegistryButton")?.addEventListener("click", renderSystemRegistration);

    document.getElementById("bulkEditUserButton")?.addEventListener("click", async () => {
      const userId = Number(prompt("Enter User ID to edit:", "") || 0);
      if (!userId) return;
      await performRegistryRowAction("user", { id: userId }, "edit");
    });
    document.getElementById("bulkViewUserButton")?.addEventListener("click", async () => {
      const userId = Number(prompt("Enter User ID to view:", "") || 0);
      if (!userId) return;
      await performRegistryRowAction("user", { id: userId }, "view");
    });
    document.getElementById("bulkDeleteUserButton")?.addEventListener("click", async () => {
      const userId = Number(prompt("Enter User ID to delete:", "") || 0);
      if (!userId) return;
      await performRegistryRowAction("user", { id: userId }, "delete");
    });
    document.getElementById("bulkRefreshUserButton")?.addEventListener("click", renderSystemRegistration);
    ["registeredInstitutionSearchCounty", "registeredInstitutionSearchName", "registeredInstitutionSearchLevel", "registeredInstitutionSearchType"]
      .forEach((id) => document.getElementById(id)?.addEventListener("input", renderRegisteredInstitutionsTable));
    document.getElementById("registeredInstitutionRefreshButton")?.addEventListener("click", renderRegisteredInstitutionsTable);
    document.getElementById("registeredInstitutionPrintButton")?.addEventListener("click", () => window.print());
    document.getElementById("registeredInstitutionPdfButton")?.addEventListener("click", () => {
      window.open("/api/system/registry/export/pdf", "_blank");
    });
    document.getElementById("registeredInstitutionExcelButton")?.addEventListener("click", () => {
      window.open("/api/system/registry/export/excel", "_blank");
    });
    renderRegisteredInstitutionsTable();

    const registerDeveloperButton = document.getElementById("sysRegisterDeveloperButton");
    if (registerDeveloperButton) {
      if (actorRole !== "SUPER_SYSTEM_DEVELOPER") {
        registerDeveloperButton.disabled = true;
      }
      registerDeveloperButton.addEventListener("click", async () => {
        try {
          const autoGenerate = String(document.getElementById("sysDevAutoPassword")?.value || "true") === "true";
          const payload = {
            institution_id: Number(document.getElementById("sysDevInstitutionId")?.value || 0) || undefined,
            full_name: String(document.getElementById("sysDevFullName")?.value || "").trim(),
            username: String(document.getElementById("sysDevUsername")?.value || "").trim(),
            role: String(document.getElementById("sysDevRole")?.value || defaultDeveloperRole),
            email: String(document.getElementById("sysDevEmail")?.value || "").trim(),
            phone: composePrefixedPhone("sysDevPhonePrefix", "sysDevPhoneLocal"),
            auto_generate_password: autoGenerate,
            password: autoGenerate ? null : String(document.getElementById("sysDevPassword")?.value || ""),
            send_welcome_via: "BOTH"
          };
          const result = await request("/api/users", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          const generated = result?.generated_password ? ` Temporary Password: ${result.generated_password}` : "";
          alert(`Developer account registered.${generated}`);
          await renderSystemRegistration({ registrationFocus: "developers" });
        } catch (error) {
          alert(error.message);
        }
      });
    }
    renderRoleScopedTable("registeredDevelopersTableHost", userRows, (row) =>
      ["SUPER_SYSTEM_DEVELOPER", "SYSTEM_DEVELOPER"].includes(normalizeRoleKey(row.role || ""))
    );

    const hoiInstitutionSelect = document.getElementById("sysHoiInstitutionId");
    const hoiInstitutionCode = document.getElementById("sysHoiInstitutionCode");
    const hoiDependentIds = [
      "sysHoiRole",
      "sysHoiFullName",
      "sysHoiEmail",
      "sysHoiPhonePrefix",
      "sysHoiPhoneLocal",
      "sysHoiUsername",
      "sysHoiAutoPassword",
      "sysHoiPassword",
      "sysHoiWelcomeDispatch",
      "sysHoiGenerateAgreement",
      "sysHoiAgreementMode",
      "sysHoiAgreementSample"
    ];
    const syncHoiActivation = () => {
      const selectedInstitutionId = Number(hoiInstitutionSelect?.value || 0);
      const selectedInstitution = institutionRowsSorted.find((item) => Number(item.id) === selectedInstitutionId) || null;
      if (hoiInstitutionCode) hoiInstitutionCode.value = selectedInstitution?.institution_code || "";
      hoiDependentIds.forEach((id) => {
        const node = document.getElementById(id);
        if (node) node.disabled = !selectedInstitutionId;
      });
    };
    hoiInstitutionSelect?.addEventListener("change", syncHoiActivation);
    syncHoiActivation();

    document.getElementById("sysRegisterHoiAdminButton")?.addEventListener("click", async () => {
      try {
        const autoGenerate = String(document.getElementById("sysHoiAutoPassword")?.value || "true") === "true";
        const institutionId = Number(document.getElementById("sysHoiInstitutionId")?.value || 0);
        if (!institutionId) {
          alert("Select institution first.");
          return;
        }
        const payload = {
          institution_id: institutionId,
          full_name: String(document.getElementById("sysHoiFullName")?.value || "").trim(),
          username: String(document.getElementById("sysHoiUsername")?.value || "").trim(),
          role: String(document.getElementById("sysHoiRole")?.value || defaultHoiAdminRole),
          email: String(document.getElementById("sysHoiEmail")?.value || "").trim(),
          phone: composePrefixedPhone("sysHoiPhonePrefix", "sysHoiPhoneLocal"),
          auto_generate_password: autoGenerate,
          password: autoGenerate ? null : String(document.getElementById("sysHoiPassword")?.value || ""),
          send_welcome_via: String(document.getElementById("sysHoiWelcomeDispatch")?.value || "BOTH")
        };
        const result = await request("/api/users", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        const roleSelected = normalizeRoleKey(payload.role || "");
        if (roleSelected === "HEAD_OF_INSTITUTION" || roleSelected === "ADMIN") {
          const wantsAgreement = String(document.getElementById("sysHoiGenerateAgreement")?.value || "false") === "true";
          if (wantsAgreement) {
            const mode = String(document.getElementById("sysHoiAgreementMode")?.value || "EMAIL");
            if (mode === "EMAIL") {
              await request(`/api/institutions/${institutionId}/agreement/send`, { method: "POST" });
            } else {
              window.open(`/api/institutions/${institutionId}/agreement.pdf`, "_blank");
            }
          }
        }
        const generated = result?.generated_password ? ` Temporary Password: ${result.generated_password}` : "";
        alert(`HOI/Admin/System Administrator registered.${generated}`);
        await renderSystemRegistration({ registrationFocus: "hoi-admin" });
      } catch (error) {
        alert(error.message);
      }
    });

    ["hoiProfileSearchInstitution", "hoiProfileSearchCounty", "hoiProfileSearchLevel", "hoiProfileSearchCategory"]
      .forEach((id) => {
        document.getElementById(id)?.addEventListener("input", () => {
          const institutionQ = String(document.getElementById("hoiProfileSearchInstitution")?.value || "").trim().toLowerCase();
          const countyQ = String(document.getElementById("hoiProfileSearchCounty")?.value || "").trim().toLowerCase();
          const levelQ = String(document.getElementById("hoiProfileSearchLevel")?.value || "").trim().toLowerCase();
          const categoryQ = String(document.getElementById("hoiProfileSearchCategory")?.value || "").trim().toLowerCase();
          const filtered = userRows.filter((row) => {
            const roleKey = normalizeRoleKey(row.role || "");
            if (!["HEAD_OF_INSTITUTION", "ADMIN", "SYSTEM_ADMINISTRATOR"].includes(roleKey)) return false;
            if (institutionQ && !String(row.institution_name || "").toLowerCase().includes(institutionQ)) return false;
            if (countyQ && !String(row.county || "").toLowerCase().includes(countyQ)) return false;
            const levelValue = String(row.category || "").toLowerCase();
            if (levelQ && !levelValue.includes(levelQ)) return false;
            if (categoryQ && !String(formatRoleDisplay(row.role || "")).toLowerCase().includes(categoryQ)) return false;
            return true;
          });
          renderRoleScopedTable("registeredHoiAdminsTableHost", filtered, () => true);
        });
      });
    renderRoleScopedTable("registeredHoiAdminsTableHost", userRows, (row) =>
      ["HEAD_OF_INSTITUTION", "ADMIN", "SYSTEM_ADMINISTRATOR"].includes(normalizeRoleKey(row.role || ""))
    );

    const renderFilteredUsersRegister = () => {
      const hostTable = document.querySelector("#registrationUsersListSection .dashboard-table-wrap table tbody");
      if (!hostTable) return;
      const qName = String(document.getElementById("registeredUsersSearchName")?.value || "").trim().toLowerCase();
      const qInstitution = String(document.getElementById("registeredUsersSearchInstitution")?.value || "").trim().toLowerCase();
      const rowsFiltered = userRows.filter((row) => {
        if (qName && !String(row.full_name || "").toLowerCase().includes(qName)) return false;
        if (qInstitution && !String(row.institution_name || "").toLowerCase().includes(qInstitution)) return false;
        return true;
      });
      const host = document.querySelector("#registrationUsersListSection .dashboard-table-wrap");
      if (!host) return;
      host.innerHTML = buildDashboardTable(
        ["Name", "Username", "Role", "Institution", "Email", "Phone", "Created", "Actions"],
        rowsFiltered.map((row) => [
          row.full_name || "-",
          row.username || "-",
          formatRoleDisplay(row.role || "-"),
          row.institution_name || row.institution_id || "-",
          row.email || "-",
          row.phone || "-",
          formatDateTime(row.created_at),
          renderRegistryUserActions(row)
        ])
      );
      applyCompactIconButtons(document.getElementById("registrationUsersListSection"));
    };
    document.getElementById("registeredUsersSearchName")?.addEventListener("input", renderFilteredUsersRegister);
    document.getElementById("registeredUsersSearchInstitution")?.addEventListener("input", renderFilteredUsersRegister);
    renderFilteredUsersRegister();

    document.getElementById("sysSaveAgreementTemplateButton")?.addEventListener("click", async () => {
      try {
        const institutionId = resolveAgreementInstitutionId();
        if (!institutionId) {
          alert("Select an institution first.");
          return;
        }
        let templateFileUrl = null;
        const templateFile = document.getElementById("sysAgreementTemplateFile")?.files?.[0] || null;
        if (templateFile) {
          const uploadForm = new FormData();
          uploadForm.append("file", templateFile);
          const response = await fetch("/api/uploads", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: uploadForm
          });
          const uploaded = await response.json();
          if (!response.ok) {
            throw new Error(uploaded?.error || "Agreement template upload failed.");
          }
          templateFileUrl = uploaded.filePath;
        }
        const payload = {
          agreement_template_text: String(document.getElementById("sysAgreementTemplateText")?.value || "").trim(),
          agreement_template_file_url: templateFileUrl
        };
        const result = await request(`/api/institutions/${institutionId}/agreement-template`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        alert(result.message || "Agreement template saved.");
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("sysLoadAgreementTemplateButton")?.addEventListener("click", async () => {
      try {
        const institutionId = resolveAgreementInstitutionId();
        if (!institutionId) {
          alert("Select an institution first.");
          return;
        }
        const data = await request(`/api/institutions/${institutionId}/agreement-template`);
        document.getElementById("sysAgreementTemplateText").value = data?.agreement_template_text || "";
        alert("Agreement template loaded.");
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("sysDeleteAgreementTemplateButton")?.addEventListener("click", async () => {
      try {
        const institutionId = resolveAgreementInstitutionId();
        if (!institutionId) {
          alert("Select an institution first.");
          return;
        }
        if (!window.confirm("Delete this institution agreement template?")) return;
        const result = await request(`/api/institutions/${institutionId}/agreement-template`, { method: "DELETE" });
        alert(result.message || "Agreement template deleted.");
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("sysSendAgreementButton")?.addEventListener("click", async () => {
      try {
        const institutionId = resolveAgreementInstitutionId();
        if (!institutionId) {
          alert("Select an institution first.");
          return;
        }
        const result = await request(`/api/institutions/${institutionId}/agreement/send`, { method: "POST" });
        alert(result.message || "Agreement sent successfully.");
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("sysViewAgreementButton")?.addEventListener("click", () => {
      const institutionId = resolveAgreementInstitutionId();
      if (!institutionId) {
        alert("Select an institution first.");
        return;
      }
      window.open(`/api/institutions/${institutionId}/agreement.pdf`, "_blank");
    });
    document.getElementById("sysDownloadAgreementButton")?.addEventListener("click", () => {
      const institutionId = resolveAgreementInstitutionId();
      if (!institutionId) {
        alert("Select an institution first.");
        return;
      }
      window.open(`/api/institutions/${institutionId}/agreement.pdf`, "_blank");
    });
    document.getElementById("sysPrintAgreementButton")?.addEventListener("click", () => {
      const institutionId = resolveAgreementInstitutionId();
      if (!institutionId) {
        alert("Select an institution first.");
        return;
      }
      const printWindow = window.open(`/api/institutions/${institutionId}/agreement.pdf`, "_blank");
      setTimeout(() => {
        printWindow?.print();
      }, 700);
    });
    const institutionSection = document.getElementById("registrationInstitutionSection");
    const developerSection = document.getElementById("registrationDeveloperSection");
    const hoiAdminSection = document.getElementById("registrationHoiAdminSection");
    const userSection = document.getElementById("registrationUserSection");
    const usersListSection = document.getElementById("registrationUsersListSection");
    const registrationFocus = String(options?.registrationFocus || "").toLowerCase();
    const hideAllSections = () => {
      [institutionSection, developerSection, hoiAdminSection, userSection, usersListSection].forEach((section) => {
        if (section) section.style.display = "none";
      });
    };
    if (registrationFocus === "institution") {
      hideAllSections();
      if (institutionSection) institutionSection.style.display = "";
      document.querySelector("#sysInstitutionName")?.focus();
      document.querySelector("#sysInstitutionName")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (registrationFocus === "developers") {
      hideAllSections();
      if (developerSection) developerSection.style.display = "";
      document.querySelector("#sysDevFullName")?.focus();
      document.querySelector("#sysDevFullName")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (registrationFocus === "hoi-admin") {
      hideAllSections();
      if (hoiAdminSection) hoiAdminSection.style.display = "";
      document.querySelector("#sysHoiInstitutionId")?.focus();
      document.querySelector("#sysHoiInstitutionId")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (registrationFocus === "user") {
      hideAllSections();
      if (userSection) userSection.style.display = "";
      if (usersListSection) usersListSection.style.display = "";
      document.querySelector("#sysUserFullName")?.focus();
      document.querySelector("#sysUserFullName")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (actorRole !== "SUPER_SYSTEM_DEVELOPER" && developerSection) {
      developerSection.style.display = "none";
    }
    if (actorRole !== "SUPER_SYSTEM_DEVELOPER" && institutionSection) {
      institutionSection.style.display = "none";
    }
    if (actorRole !== "SUPER_SYSTEM_DEVELOPER" && hoiAdminSection) {
      hoiAdminSection.style.display = "none";
    }
    applyCompactIconButtons(document.getElementById("formArea"));
    applyTemplateVisibility(document.getElementById("formArea"));
  } catch (error) {
    alert(error.message);
  }
}

async function renderModuleRights() {
  setActiveSidebarButton("system-access-control");
  document.getElementById("moduleTitle").textContent = "Access Control (Module Rights)";
  if (!isAllowedAccessControlAdministrator()) {
    try {
      const me = await request("/api/auth/me");
      const res = await request(`/api/system/module-access/overrides?user_id=${me.id}`);
      const overrides = Array.isArray(res?.overrides) ? res.overrides : [];
      const hasDelegated = overrides.some(
        (row) =>
          String(row.module_key) === "access-control" &&
          Number(row.can_access) === 1 &&
          ["ACCESS", "VIEW", "", null].includes(String(row.permission_key || "ACCESS"))
      );
      if (!hasDelegated) {
        alert(
          "Access Control is reserved for the System Developer and Head of Institution unless the System Developer has granted you delegated access."
        );
        return loadDashboard();
      }
      allowedModules = Array.from(new Set([...(allowedModules || []), "access-control"]));
    } catch (error) {
      alert(error.message || "You do not have access to Access Control.");
      return loadDashboard();
    }
  }
  try {
    const [users, metaData] = await Promise.all([
      request("/api/users"),
      request("/api/meta")
    ]);
    const moduleKeysRaw = Array.from(new Set(Object.values(metaData?.moduleKeys || {})));
    const dashboardWidgetKeys = [
      "dashboard-alerts-announcements",
      "dashboard-attendance-list",
      "dashboard-performance",
      "dashboard-fee-collection",
      "dashboard-outstanding-balances"
    ];
    const dynamicSidebarSubmoduleKeys = Object.values(SIDEBAR_SUBMODULES)
      .flatMap((rows) => (Array.isArray(rows) ? rows : []))
      .map((row) => String(row.id || ""))
      .filter(Boolean);
    const explicitSubModuleKeys = [
      "admission-register",
      "admission-form",
      "admission-letter",
      "admission-bio-data-bulk-upload",
      "attendance-teacher-register",
      "attendance-support-staff-register",
      "attendance-learner-register",
      "staff-profile-teacher",
      "staff-profile-support-staff",
      "register-institution",
      "system-register-institution",
      "system-register-developers",
      "system-register-hoi-admin",
      "register-users",
      "system-register-user",
      "registered-institutions",
      "registered-developers",
      "registered-hoi-admins",
      "users-register",
      "security-login-audit",
      "institution-letterhead-upload",
      "hr-institutional-letters",
      "finance-fee-status",
      "institutional-registers",
      "system-institution-edit",
      "system-institution-uploads",
      ...dynamicSidebarSubmoduleKeys
    ];
    const moduleKeys = Array.from(new Set([...moduleKeysRaw, ...dashboardWidgetKeys, ...explicitSubModuleKeys])).sort((a, b) =>
      String(a).localeCompare(String(b))
    );
    const defaultMap = metaData?.defaultModuleAccessByRole || {};
    const rows = Array.isArray(users) ? users.slice(0, 200) : [];
    const permissionKeys = ["ACCESS", "VIEW", "EDIT", "DELETE", "SAVE", "PROCESS", "MODIFY", "DOWNLOAD", "SHOW_ROLES"];
    const permissionLabels = {
      ACCESS: "View",
      VIEW: "View",
      EDIT: "Edit",
      DELETE: "Delete",
      SAVE: "Save",
      PROCESS: "Process",
      MODIFY: "Modify",
      DOWNLOAD: "Download",
      SHOW_ROLES: "Show Roles"
    };
    const fallbackModuleError = "Access denied until rights are granted by the System Developer.";
    let currentUserId = Number(rows[0]?.id || 0) || null;
    let overrideMap = new Map();

    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>Module Rights Overrides</h4>
        <p>${formatNumber(rows.length)} user(s) loaded</p>
      </div>
      <div class="card stats-card">
        <h4>Modules</h4>
        <p>${formatNumber(moduleKeys.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Policy</h4>
        <p>Deny by default, grant per user</p>
      </div>
    `;

    document.getElementById("formArea").innerHTML = `
      <section class="module-rights-compact">
        <h3>Access Control Module Rights</h3>
      </section>
      <div class="module-rights-grid">
        <label>User</label>
        <select id="moduleAccessUserSelect">
          <option value="">Select user...</option>
          ${rows
            .map((user) => `
              <option value="${user.id}" data-role="${escapeHtml(user.role || "")}">
                ${escapeHtml(buildRoleScopedUserLabel(user))}
              </option>`)
            .join("")}
        </select>
      </div>
      <div class="iim-actions-row module-rights-matrix-tools">
        <button class="iim-action-btn success" id="moduleAccessMassSelectButton" title="Select All Access">✅ Select All</button>
        <button class="iim-action-btn muted" id="moduleAccessMassClearButton" title="Deselect All Access">⬜ Deselect All</button>
        <button class="iim-action-btn" id="moduleAccessSelectViewButton" title="Select All View">👁 View</button>
        <button class="iim-action-btn" id="moduleAccessSelectEditButton" title="Select All Edit">✎ Edit</button>
        <button class="iim-action-btn delete" id="moduleAccessSelectDeleteButton" title="Select All Delete">🗑 Delete</button>
        <button class="iim-action-btn success" id="moduleAccessSelectSaveButton" title="Select All Save">💾 Save</button>
        <button class="iim-action-btn warn" id="moduleAccessSelectProcessButton" title="Select All Process">⚙ Process</button>
        <button class="iim-action-btn" id="moduleAccessSelectModifyButton" title="Select All Modify">✎ Modify</button>
        <button class="iim-action-btn warn" id="moduleAccessSelectDownloadButton" title="Select All Download">⬇ Download</button>
        <button class="iim-action-btn success" id="saveModuleAccessButton" title="Save">💾 Save</button>
        <button class="iim-action-btn" id="modifyModuleAccessButton" title="Modify">✎ Modify</button>
        <button class="iim-action-btn warn" id="processModuleAccessButton" title="Process">⚙ Process</button>
        <button class="iim-action-btn muted" id="resetModuleAccessButton" title="Reset">↺ Reset</button>
        <button class="iim-action-btn delete" id="deleteModuleAccessButton" title="Delete">🗑 Delete</button>
        <button class="iim-action-btn" id="refreshModuleAccessButton" title="Refresh">🔄 Refresh</button>
        <button class="iim-action-btn gold" id="showRoleDefaultsButton" title="Show Role Defaults">⭐ Defaults</button>
      </div>
      <div id="moduleAccessInfo" class="small-note"></div>
      <div class="module-rights-matrix-wrap">
        <div class="module-rights-matrix" id="moduleRightsMatrixHost"></div>
      </div>
    `;

    const userSelect = document.getElementById("moduleAccessUserSelect");
    const info = document.getElementById("moduleAccessInfo");
    const matrixHost = document.getElementById("moduleRightsMatrixHost");

    if (userSelect && currentUserId) {
      userSelect.value = String(currentUserId);
    }

    const renderMatrix = () => {
      if (!matrixHost) return;
      const rowsMarkup = moduleKeys
        .map((moduleKey) => {
          const cells = permissionKeys
            .map((permissionKey) => {
              const key = `${moduleKey}::${permissionKey}`;
              const checked = overrideMap.has(key) ? Number(overrideMap.get(key)) === 1 : false;
              return `<td><input type="checkbox" class="module-access-check" data-module="${escapeHtmlAttribute(moduleKey)}" data-action="${escapeHtmlAttribute(permissionKey)}" ${checked ? "checked" : ""} /></td>`;
            })
            .join("");
          return `<tr>
            <td class="module-name-col">${escapeHtml(moduleKey)}</td>
            ${cells}
            <td>${escapeHtml(fallbackModuleError)}</td>
          </tr>`;
        })
        .join("");
      matrixHost.innerHTML = `
        <table class="module-rights-matrix-table">
          <thead>
            <tr>
              <th class="module-name-col">Module</th>
              ${permissionKeys.map((key) => `<th>${escapeHtml(permissionLabels[key] || key)}</th>`).join("")}
              <th>Error Message</th>
            </tr>
          </thead>
          <tbody>${rowsMarkup}</tbody>
        </table>
      `;
    };

    const loadOverrides = async () => {
      const selectedUserId = Number(userSelect?.value || 0);
      if (!selectedUserId) {
        overrideMap = new Map();
        renderMatrix();
        if (info) info.textContent = "Select user to view and manage module rights.";
        return;
      }
      const selectedRole = normalizeRoleKey(userSelect?.selectedOptions?.[0]?.dataset?.role || "");
      const response = await request(`/api/system/module-access/overrides?user_id=${selectedUserId}`);
      const overrides = Array.isArray(response?.overrides) ? response.overrides : [];
      overrideMap = new Map(
        overrides.map((row) => [`${row.module_key}::${String(row.permission_key || "ACCESS").toUpperCase()}`, Number(row.can_access || 0)])
      );
      renderMatrix();
      if (info) {
        const defaults = Array.isArray(defaultMap[selectedRole]) ? defaultMap[selectedRole] : [];
        info.textContent = `Role: ${friendlyRoleName(selectedRole)} | Role defaults loaded: ${defaults.length}`;
      }
    };

    userSelect?.addEventListener("change", loadOverrides);
    document.getElementById("moduleAccessMassSelectButton")?.addEventListener("click", () => {
      document.querySelectorAll(".module-access-check").forEach((input) => {
        input.checked = true;
      });
    });
    document.getElementById("moduleAccessMassClearButton")?.addEventListener("click", () => {
      document.querySelectorAll(".module-access-check").forEach((input) => {
        input.checked = false;
      });
    });
    document.getElementById("showRoleDefaultsButton")?.addEventListener("click", () => {
      const selectedRole = normalizeRoleKey(userSelect?.selectedOptions?.[0]?.dataset?.role || "");
      const defaults = Array.isArray(defaultMap[selectedRole]) ? defaultMap[selectedRole] : [];
      if (info) {
        info.textContent = selectedRole
          ? `Role defaults (${friendlyRoleName(selectedRole)}): ${defaults.length} module(s).`
          : "Select a user to show role defaults.";
      }
    });
    const submitOverrides = async (successMessage) => {
      const selectedUserId = Number(userSelect?.value || 0);
      if (!selectedUserId) {
        alert("Select a user first.");
        return;
      }
      const entries = Array.from(document.querySelectorAll(".module-access-check")).map((input) => ({
        module_key: String(input.getAttribute("data-module") || ""),
        action_key: String(input.getAttribute("data-action") || "ACCESS"),
        can_access: input.checked
      }));
      try {
        const result = await request("/api/users/module-access/bulk", {
          method: "POST",
          body: JSON.stringify({
            user_id: selectedUserId,
            entries
          })
        });
        alert(result.message || successMessage);
        await loadOverrides();
      } catch (error) {
        alert(error.message);
      }
    };

    const setAllForPermission = (permissionKey, checked) => {
      document.querySelectorAll(`.module-access-check[data-action="${permissionKey}"]`).forEach((input) => {
        input.checked = checked;
      });
    };

    document.getElementById("saveModuleAccessButton")?.addEventListener("click", () => submitOverrides("Module rights saved."));
    document.getElementById("modifyModuleAccessButton")?.addEventListener("click", () => submitOverrides("Module rights modified."));
    document.getElementById("processModuleAccessButton")?.addEventListener("click", () => submitOverrides("Module rights processed."));
    document.getElementById("refreshModuleAccessButton")?.addEventListener("click", loadOverrides);
    document.getElementById("resetModuleAccessButton")?.addEventListener("click", () => {
      if (!window.confirm("Reset all checkboxes to unchecked for this user?")) return;
      document.querySelectorAll(".module-access-check").forEach((input) => {
        input.checked = false;
      });
    });
    document.getElementById("deleteModuleAccessButton")?.addEventListener("click", async () => {
      const selectedUserId = Number(userSelect?.value || 0);
      if (!selectedUserId) {
        alert("Select a user first.");
        return;
      }
      if (!window.confirm("Remove all module rights for this user?")) return;
      document.querySelectorAll(".module-access-check").forEach((input) => {
        input.checked = false;
      });
      await submitOverrides("All module rights removed for this user.");
    });
    document.getElementById("moduleAccessSelectViewButton")?.addEventListener("click", () => {
      setAllForPermission("VIEW", true);
      setAllForPermission("ACCESS", true);
    });
    document.getElementById("moduleAccessSelectEditButton")?.addEventListener("click", () => setAllForPermission("EDIT", true));
    document.getElementById("moduleAccessSelectDeleteButton")?.addEventListener("click", () => setAllForPermission("DELETE", true));
    document.getElementById("moduleAccessSelectSaveButton")?.addEventListener("click", () => setAllForPermission("SAVE", true));
    document.getElementById("moduleAccessSelectProcessButton")?.addEventListener("click", () => setAllForPermission("PROCESS", true));
    document.getElementById("moduleAccessSelectModifyButton")?.addEventListener("click", () => setAllForPermission("MODIFY", true));
    document.getElementById("moduleAccessSelectDownloadButton")?.addEventListener("click", () => setAllForPermission("DOWNLOAD", true));

    await loadOverrides();
    applyCompactIconButtons(document.getElementById("formArea"));
    resetDataTable("Module access matrix loaded.");
  } catch (error) {
    alert(error.message);
  }
}

async function renderSecurityAudit() {
  setActiveSidebarButton("system-audit");
  document.getElementById("moduleTitle").textContent = "Security and Logging Audit";
  if (!canOpenSecurityAuditModule()) {
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>Section Not Allowed</h4>
        <p>Restricted</p>
      </div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Security & Logging Audit</h3>
        <p class="small-note">This module is not available for your role. Super/System Developers review assigned/global institutions, while HoI/System Administrator reviews institution-scoped audit trails.</p>
      </div>
    `;
    resetDataTable("Security audit unavailable for this account.");
    return;
  }
  try {
    const logs = await request("/api/system/audit-logs?limit=240");
    const rows = Array.isArray(logs?.logs) ? logs.logs : [];
    const posture = logs?.security_posture || {};
    const recommendations = Array.isArray(logs?.recommendations) ? logs.recommendations : [];
    const actorRole = normalizeRoleKey(portalContext?.role || "");
    const roleScopeNote =
      actorRole === "SUPER_SYSTEM_DEVELOPER"
        ? "Super System Developer: global/all institution logs"
        : "Institution scope only: you can see logs for your institution users";
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>Audit Events</h4>
        <p>${formatNumber(rows.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Failed Logins (24h)</h4>
        <p>${formatNumber(logs?.metrics?.failed_login_events_24h || 0)}</p>
      </div>
      <div class="card stats-card">
        <h4>OTP Failures (24h)</h4>
        <p>${formatNumber(logs?.metrics?.otp_fail_events_24h || 0)}</p>
      </div>
      <div class="card stats-card">
        <h4>Scope</h4>
        <p>${escapeHtml(roleScopeNote)}</p>
      </div>
      <div class="card stats-card">
        <h4>Email OTP Channel</h4>
        <p>${posture.otp_email_ready ? "Ready" : "Not configured"}</p>
      </div>
      <div class="card stats-card">
        <h4>SMS OTP Channel</h4>
        <p>${posture.otp_sms_ready ? "Ready" : "Not configured"}</p>
      </div>
      <div class="card stats-card">
        <h4>JWT Secret</h4>
        <p>${posture.jwt_secret_configured ? "Configured" : "Missing"}</p>
      </div>
      <div class="card stats-card">
        <h4>CSP / HTTPS</h4>
        <p>${posture.csp_enabled ? "CSP On" : "CSP Off"} · ${posture.force_https ? "HTTPS forced" : "HTTPS relaxed"}</p>
      </div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Security & Logging Audit</h3>
        <p>Advanced audit workspace with filters and event cards. Entries include username, institution code, IP address, machine identifier, login status, login time, activity done, and logout time.</p>
      </div>
      <div class="module-header-card">
        <h4>Security Posture Recommendations</h4>
        <p class="small-note">${recommendations.length ? recommendations.map((item) => escapeHtml(item)).join("<br/>") : "No immediate hardening alerts. Continue rotating credentials, reviewing logs, and enforcing per-institution access policies."}</p>
      </div>
      <div class="form-grid">
        <label>Filter Username</label>
        <input id="auditFilterUsername" placeholder="username" />
        <label>Filter Institution Code</label>
        <input id="auditFilterInstitutionCode" placeholder="institution code" />
        <label>Filter Action</label>
        <input id="auditFilterAction" placeholder="action/event" />
      </div>
      <div class="actions-row">
        <button id="refreshAuditLogButton">Refresh</button>
        <button id="auditExportViewButton">Print View</button>
      </div>
      <div id="auditAdvancedGrid" class="audit-advanced-grid">
        ${rows.length ? rows.map((row) => `
          <article class="audit-advanced-card"
            data-audit-username="${escapeHtmlAttribute(String(row.username || ""))}"
            data-audit-institution="${escapeHtmlAttribute(String(row.institution_code || ""))}"
            data-audit-action="${escapeHtmlAttribute(String(row.activity_done || row.action || ""))}">
            <div class="audit-advanced-head">
              <strong>${escapeHtml(row.username || row.actor_role || "User")}</strong>
              <span class="audit-event-tag">${escapeHtml(row.activity_done || row.action || "-")}</span>
            </div>
            <div class="audit-advanced-body">
              <div><span>Institution:</span> ${escapeHtml(row.institution_code || "-")}</div>
              <div><span>IP:</span> ${escapeHtml(row.ip_address || "-")}</div>
              <div><span>Machine:</span> ${escapeHtml(row.machine_name || "-")}</div>
              <div><span>Login:</span> ${escapeHtml(formatDateTime(row.login_time || row.created_at))}</div>
              <div><span>Logout:</span> ${escapeHtml(formatDateTime(row.logout_time))}</div>
            </div>
          </article>
        `).join("") : '<p class="small-note">No audit log entries found.</p>'}
      </div>
    `;
    resetDataTable("Audit strips loaded above.");
    const applyAuditFilters = () => {
      const usernameQ = String(document.getElementById("auditFilterUsername")?.value || "").trim().toLowerCase();
      const institutionQ = String(document.getElementById("auditFilterInstitutionCode")?.value || "").trim().toLowerCase();
      const actionQ = String(document.getElementById("auditFilterAction")?.value || "").trim().toLowerCase();
      document.querySelectorAll("#auditAdvancedGrid .audit-advanced-card").forEach((card) => {
        const usernameVal = String(card.getAttribute("data-audit-username") || "").toLowerCase();
        const institutionVal = String(card.getAttribute("data-audit-institution") || "").toLowerCase();
        const actionVal = String(card.getAttribute("data-audit-action") || "").toLowerCase();
        const visible =
          (!usernameQ || usernameVal.includes(usernameQ)) &&
          (!institutionQ || institutionVal.includes(institutionQ)) &&
          (!actionQ || actionVal.includes(actionQ));
        card.style.display = visible ? "" : "none";
      });
    };
    ["auditFilterUsername", "auditFilterInstitutionCode", "auditFilterAction"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", applyAuditFilters);
    });
    document.getElementById("refreshAuditLogButton")?.addEventListener("click", renderSecurityAudit);
    document.getElementById("auditExportViewButton")?.addEventListener("click", () => window.print());
    applyCompactIconButtons(document.getElementById("formArea"));
  } catch (error) {
    alert(error.message);
  }
}

async function renderInstitutionsRegistry() {
  setActiveSidebarButton("system-registry");
  document.getElementById("moduleTitle").textContent = "Institutions & Users Registry";
  if (!isSystemAdminRole()) {
    alert("Only Super/System Developer, System Administrator, Admin, or Head of Institution can open this registry.");
    return loadDashboard();
  }
  try {
    const registry = await request("/api/system/registry");
    const includeInstitutionRegistry = Boolean(registry?.include_institution_registry);
    const institutions = Array.isArray(registry?.institutions) ? registry.institutions : [];
    const users = Array.isArray(registry?.users) ? registry.users : [];
    const canDeleteInstitution = normalizeRoleKey(portalContext?.role || "") === "SUPER_SYSTEM_DEVELOPER";
    const institutionRows = institutions;
    const userRows = users;
    const scopeOptions = resolveRegistryScopeOptions().filter(
      (option) => option.key !== "institution" || includeInstitutionRegistry
    );
    const initialScope = scopeOptions[0]?.key || "user";

    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>Institutions</h4>
        <p>${formatNumber(institutionRows.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Users</h4>
        <p>${formatNumber(userRows.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Registry Scope</h4>
        <p>${escapeHtml(friendlyRoleName(portalContext?.role || "-"))}</p>
      </div>
    `;

    const institutionActions = (row) => {
      const rowId = Number(row?.id || 0);
      if (!rowId) return "-";
      const encoded = JSON.stringify({
        id: rowId,
        institution_name: row?.institution_name || "",
        email: row?.email || "",
        phone: row?.phone || ""
      }).replace(/"/g, "&quot;");
      return `
        <div class="search-inline-actions">
          <button class="search-action-icon view" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'view')" title="View">👁</button>
          <button class="search-action-icon edit" onclick="performRegistryRowAction('institution', ${encoded}, 'edit')" title="Edit">✎</button>
          <button class="search-action-icon save" onclick="performRegistryRowAction('institution', ${encoded}, 'save')" title="Save">💾</button>
          <button class="search-action-icon print" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'print')" title="Print">🖨</button>
          <button class="search-action-icon pdf" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'pdf')" title="PDF">📄</button>
          ${canDeleteInstitution ? `<button class="search-action-icon delete" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'delete')" title="Delete">🗑</button>` : ""}
          <button class="search-action-icon edit" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'deactivate')" title="Deactivate">⛔</button>
          <button class="search-action-icon view" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'suspend')" title="Suspend">⏸</button>
          <button class="search-action-icon save" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'activate')" title="Activate">▶</button>
          <button class="search-action-icon download" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'desuspend')" title="Desuspend">⏯</button>
        </div>
      `;
    };

    const userActions = (row) => {
      const rowId = Number(row?.id || 0);
      if (!rowId) return "-";
      const encoded = JSON.stringify({
        id: rowId,
        full_name: row?.full_name || "",
        email: row?.email || "",
        phone: row?.phone || ""
      }).replace(/"/g, "&quot;");
      return `
        <div class="search-inline-actions">
          <button class="search-action-icon view" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'view')" title="View">👁</button>
          <button class="search-action-icon edit" onclick="performRegistryRowAction('user', ${encoded}, 'edit')" title="Edit">✎</button>
          <button class="search-action-icon save" onclick="performRegistryRowAction('user', ${encoded}, 'save')" title="Save">💾</button>
          <button class="search-action-icon print" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'print')" title="Print">🖨</button>
          <button class="search-action-icon pdf" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'pdf')" title="PDF">📄</button>
          <button class="search-action-icon delete" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'delete')" title="Delete">🗑</button>
          <button class="search-action-icon edit" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'deactivate')" title="Deactivate">⛔</button>
          <button class="search-action-icon view" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'suspend')" title="Suspend">⏸</button>
          <button class="search-action-icon save" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'activate')" title="Activate">▶</button>
          <button class="search-action-icon download" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'desuspend')" title="Desuspend">⏯</button>
        </div>
      `;
    };

    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Registry</h3>
      </div>
      <div class="form-grid registry-top-controls">
        <label>Registry Scope</label>
        <select id="registryScopeSelect">
          ${scopeOptions.map((option) => `<option value="${option.key}">${escapeHtml(option.label)}</option>`).join("")}
        </select>
        <div class="search-inline-actions registry-top-actions">
          <button class="search-action-icon view" id="registryRefreshButton" title="Refresh">↻</button>
          <button class="search-action-icon print" id="registryPrintButton" title="Print">🖨</button>
          <button class="search-action-icon pdf" id="registryPdfButton" title="PDF">📄</button>
          <button class="search-action-icon download" id="registryExcelButton" title="Excel">⬇</button>
        </div>
      </div>
      <div id="registryScopeTable"></div>
    `;

    const renderRegistryScope = (scope = initialScope) => {
      const holder = document.getElementById("registryScopeTable");
      if (!holder) return;
      if (scope === "institution" && includeInstitutionRegistry) {
        holder.innerHTML = buildDashboardTable(
          ["Institution", "Code", "County", "Email", "Phone", "Date Created", "Actions"],
          institutionRows.map((item) => [
            item.institution_name || "-",
            item.institution_code || "-",
            item.county || "-",
            item.email || "-",
            item.phone || "-",
            formatDateTime(item.created_at),
            institutionActions(item)
          ])
        );
      } else if (scope === "user") {
        holder.innerHTML = buildDashboardTable(
          ["Name", "Username", "Role", "Institution Code", "Email", "Phone", "Date Created", "Status", "Actions"],
          userRows.map((row) => [
            row.full_name || "-",
            row.username || "-",
            friendlyRoleName(row.role || ""),
            row.institution_code || "-",
            row.email || "-",
            row.phone || "-",
            formatDateTime(row.created_at),
            normalizeStatusLabel(row.is_active),
            userActions(row)
          ])
        );
      } else {
        holder.innerHTML = '<p class="small-note">Not allowed.</p>';
      }
    };

    const scopeSelect = document.getElementById("registryScopeSelect");
    scopeSelect?.addEventListener("change", () => renderRegistryScope(scopeSelect.value));
    document.getElementById("registryRefreshButton")?.addEventListener("click", () => renderRegistryScope(scopeSelect?.value || initialScope));
    document.getElementById("registryPrintButton")?.addEventListener("click", () => window.print());
    document.getElementById("registryPdfButton")?.addEventListener("click", () => {
      if ((scopeSelect?.value || initialScope) === "institution") {
        window.open("/api/system/registry/export/pdf", "_blank");
      } else {
        window.open("/api/users/export/pdf", "_blank");
      }
    });
    document.getElementById("registryExcelButton")?.addEventListener("click", () => {
      if ((scopeSelect?.value || initialScope) === "institution") {
        window.open("/api/system/registry/export/excel", "_blank");
      } else {
        window.open("/api/users/export/excel", "_blank");
      }
    });
    renderRegistryScope(initialScope);
    applyCompactIconButtons(document.getElementById("formArea"));
    resetDataTable("Registry records loaded above.");
  } catch (error) {
    alert(error.message);
  }
}

async function renderInstitutionEditModule(options = {}) {
  const variant = String(options?.variant || "edit");
  const isUploadVariant = variant === "uploads";
  setActiveSidebarButton(isUploadVariant ? "system-institution-uploads" : "system-institution-edit");
  document.getElementById("moduleTitle").textContent = isUploadVariant ? "Institution Uploads" : "Institution Upgrade";
  if (!isSuperSystemDeveloperPortal()) {
    alert("Only Super System Developer can access Institution Upgrade.");
    return loadDashboard();
  }
  try {
    if (!isUploadVariant) {
      const registry = await request("/api/system/registry");
      const institutions = Array.isArray(registry?.institutions) ? registry.institutions : [];
      const users = Array.isArray(registry?.users) ? registry.users : [];
      const sortedInstitutions = [...institutions].sort((a, b) =>
        String(a?.institution_name || "").localeCompare(String(b?.institution_name || ""))
      );
      document.getElementById("cards").innerHTML = `
        <div class="card stats-card metric-emphasis">
          <h4>Institution Upgrade</h4>
          <p>${formatNumber(sortedInstitutions.length)} institution(s)</p>
        </div>
        <div class="card stats-card">
          <h4>Institution Users</h4>
          <p>${formatNumber(users.length)}</p>
        </div>
        <div class="card stats-card">
          <h4>Scope</h4>
          <p>Super System Developer only</p>
        </div>
      `;
      document.getElementById("formArea").innerHTML = `
        <div class="module-header-card">
          <h3>Institution Upgrade</h3>
          <p>Select an institution, then use Edit/Save/Delete to manage institution profile and institution user details.</p>
        </div>
        <div class="form-grid">
          <label>Institution</label>
          <select id="institutionUpgradeInstitutionId">
            <option value="">Select institution</option>
            ${sortedInstitutions.map((row) => `<option value="${Number(row.id || 0)}">${escapeHtml(row.institution_name || "-")} (${escapeHtml(row.institution_code || "-")})</option>`).join("")}
          </select>
        </div>
        <div class="actions-row">
          <button id="institutionUpgradeEditButton" type="button">Edit Institution</button>
          <button id="institutionUpgradeSaveButton" type="button">Save Institution</button>
          <button id="institutionUpgradeDeleteButton" type="button">Delete Institution</button>
        </div>
        <div class="form-grid">
          <label>Institution Name</label>
          <input id="institutionUpgradeName" disabled />
          <label>Institution Code</label>
          <input id="institutionUpgradeCode" class="readonly-field" readonly />
          <label>County</label>
          <input id="institutionUpgradeCounty" disabled />
          <label>Sub County</label>
          <input id="institutionUpgradeSubCounty" disabled />
          <label>Location</label>
          <input id="institutionUpgradeLocation" disabled />
          <label>Postal Address</label>
          <input id="institutionUpgradePostalAddress" disabled />
          <label>Postal Code</label>
          <input id="institutionUpgradePostalCode" disabled />
          <label>Town</label>
          <input id="institutionUpgradeTown" disabled />
          <label>Email</label>
          <input id="institutionUpgradeEmail" disabled />
          <label>Phone</label>
          <input id="institutionUpgradePhone" disabled />
        </div>
        <div class="module-header-card">
          <h4>Institution User Details</h4>
        </div>
        <div class="form-grid">
          <label>Institution User</label>
          <select id="institutionUpgradeUserId">
            <option value="">Select user</option>
          </select>
        </div>
        <div class="actions-row">
          <button id="institutionUpgradeUserEditButton" type="button">Edit User</button>
          <button id="institutionUpgradeUserSaveButton" type="button">Save User</button>
          <button id="institutionUpgradeUserDeleteButton" type="button">Delete User</button>
        </div>
        <div class="form-grid">
          <label>Full Name</label>
          <input id="institutionUpgradeUserName" disabled />
          <label>Username</label>
          <input id="institutionUpgradeUsername" disabled />
          <label>Email</label>
          <input id="institutionUpgradeUserEmail" disabled />
          <label>Phone</label>
          <input id="institutionUpgradeUserPhone" disabled />
          <label>Role</label>
          <input id="institutionUpgradeUserRole" disabled />
        </div>
      `;
      const institutionSelect = document.getElementById("institutionUpgradeInstitutionId");
      const userSelect = document.getElementById("institutionUpgradeUserId");
      const institutionFields = {
        name: document.getElementById("institutionUpgradeName"),
        code: document.getElementById("institutionUpgradeCode"),
        county: document.getElementById("institutionUpgradeCounty"),
        sub_county: document.getElementById("institutionUpgradeSubCounty"),
        location: document.getElementById("institutionUpgradeLocation"),
        postal_address: document.getElementById("institutionUpgradePostalAddress"),
        postal_code: document.getElementById("institutionUpgradePostalCode"),
        town: document.getElementById("institutionUpgradeTown"),
        email: document.getElementById("institutionUpgradeEmail"),
        phone: document.getElementById("institutionUpgradePhone")
      };
      const userFields = {
        full_name: document.getElementById("institutionUpgradeUserName"),
        username: document.getElementById("institutionUpgradeUsername"),
        email: document.getElementById("institutionUpgradeUserEmail"),
        phone: document.getElementById("institutionUpgradeUserPhone"),
        role: document.getElementById("institutionUpgradeUserRole")
      };
      const setInstitutionEditMode = (enabled) => {
        ["name", "county", "sub_county", "location", "postal_address", "postal_code", "town", "email", "phone"].forEach((key) => {
          if (institutionFields[key]) institutionFields[key].disabled = !enabled;
        });
      };
      const setUserEditMode = (enabled) => {
        ["full_name", "username", "email", "phone", "role"].forEach((key) => {
          if (userFields[key]) userFields[key].disabled = !enabled;
        });
      };
      const userMap = new Map();
      const refreshUsersForInstitution = (institutionId) => {
        const scopedUsers = users.filter((row) => Number(row.institution_id || 0) === Number(institutionId || 0));
        userMap.clear();
        userSelect.innerHTML = `<option value="">Select user</option>${scopedUsers
          .map((row) => {
            const id = Number(row.id || 0);
            userMap.set(id, row);
            return `<option value="${id}">${escapeHtml(row.full_name || row.username || `User ${id}`)} (${escapeHtml(
              row.username || "-"
            )})</option>`;
          })
          .join("")}`;
      };
      const loadInstitution = async (institutionId) => {
        if (!institutionId) {
          Object.values(institutionFields).forEach((field) => {
            if (field) field.value = "";
          });
          refreshUsersForInstitution(0);
          return;
        }
        const response = await request(`/api/system/registry/institutions/${institutionId}/view`);
        const institution = response?.institution || {};
        institutionFields.name.value = institution.institution_name || "";
        institutionFields.code.value = institution.institution_code || "";
        institutionFields.county.value = institution.county || "";
        institutionFields.sub_county.value = institution.sub_county || "";
        institutionFields.location.value = institution.location || "";
        institutionFields.postal_address.value = institution.postal_address || "";
        institutionFields.postal_code.value = institution.postal_code || "";
        institutionFields.town.value = institution.town || "";
        institutionFields.email.value = institution.email || "";
        institutionFields.phone.value = institution.phone || "";
        refreshUsersForInstitution(institutionId);
      };
      const loadUser = (userId) => {
        const row = userMap.get(Number(userId || 0)) || {};
        userFields.full_name.value = row.full_name || "";
        userFields.username.value = row.username || "";
        userFields.email.value = row.email || "";
        userFields.phone.value = row.phone || "";
        userFields.role.value = row.role || "";
      };
      institutionSelect?.addEventListener("change", async () => {
        setInstitutionEditMode(false);
        setUserEditMode(false);
        await loadInstitution(Number(institutionSelect.value || 0));
      });
      userSelect?.addEventListener("change", () => {
        setUserEditMode(false);
        loadUser(Number(userSelect.value || 0));
      });
      document.getElementById("institutionUpgradeEditButton")?.addEventListener("click", () => setInstitutionEditMode(true));
      document.getElementById("institutionUpgradeSaveButton")?.addEventListener("click", async () => {
        const institutionId = Number(institutionSelect?.value || 0);
        if (!institutionId) {
          alert("Select institution first.");
          return;
        }
        await request(`/api/system/registry/institutions/${institutionId}`, {
          method: "PATCH",
          body: JSON.stringify({
            institution_name: institutionFields.name.value,
            county: institutionFields.county.value,
            sub_county: institutionFields.sub_county.value,
            location: institutionFields.location.value,
            postal_address: institutionFields.postal_address.value,
            postal_code: institutionFields.postal_code.value,
            town: institutionFields.town.value,
            email: institutionFields.email.value,
            phone: institutionFields.phone.value
          })
        });
        alert("Institution details saved.");
        setInstitutionEditMode(false);
        await loadInstitution(institutionId);
      });
      document.getElementById("institutionUpgradeDeleteButton")?.addEventListener("click", async () => {
        const institutionId = Number(institutionSelect?.value || 0);
        if (!institutionId) {
          alert("Select institution first.");
          return;
        }
        await performRegistryRowAction("institution", { id: institutionId }, "delete");
      });
      document.getElementById("institutionUpgradeUserEditButton")?.addEventListener("click", () => setUserEditMode(true));
      document.getElementById("institutionUpgradeUserSaveButton")?.addEventListener("click", async () => {
        const userId = Number(userSelect?.value || 0);
        if (!userId) {
          alert("Select user first.");
          return;
        }
        await request(`/api/system/registry/users/${userId}`, {
          method: "PATCH",
          body: JSON.stringify({
            full_name: userFields.full_name.value,
            username: userFields.username.value,
            email: userFields.email.value,
            phone: userFields.phone.value
          })
        });
        alert("Institution user details saved.");
        setUserEditMode(false);
      });
      document.getElementById("institutionUpgradeUserDeleteButton")?.addEventListener("click", async () => {
        const userId = Number(userSelect?.value || 0);
        if (!userId) {
          alert("Select user first.");
          return;
        }
        await performRegistryRowAction("user", { id: userId }, "delete");
      });
      setInstitutionEditMode(false);
      setUserEditMode(false);
      applyCompactIconButtons(document.getElementById("formArea"));
      return;
    }

    const response = await request("/api/system/institution-documents/institutions");
    const institutions = Array.isArray(response?.institutions) ? response.institutions : [];
    const moduleOptions = Object.keys(MODULE_DESCRIPTIONS)
      .filter((key) => !key.startsWith("dashboard"))
      .sort((a, b) => a.localeCompare(b));
    const documentTypeOptions = [
      "institution_photo",
      "institution_logo",
      "institution_letterhead",
      "admission_registration_form_template",
      "admission_form_template",
      "admission_letter_template",
      "assessment_report_template",
      "exam_script_template",
      "result_script_template",
      "rules_and_regulations_template",
      "other"
    ];
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>${escapeHtml(isUploadVariant ? "Institution Uploads" : "Institution Edit Module")}</h4>
        <p>${formatNumber(institutions.length)} institutions</p>
      </div>
      <div class="card stats-card">
        <h4>Scope</h4>
        <p>Super System Developer only</p>
      </div>
      <div class="card stats-card">
        <h4>Auto-Pick</h4>
        <p>Documents are linked to selected institution immediately.</p>
      </div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>${escapeHtml(isUploadVariant ? "Institution Uploads" : "Institution Edit Module")}</h3>
        <p>Search institution, upload templates/logos/letterheads per institution, and classify by module/sub-module so each tenant only sees its own files.</p>
      </div>
      <div class="form-grid">
        <label>Search Institution</label>
        <input id="institutionDocSearchInput" placeholder="Type institution name/code..." />
        <label>Institution</label>
        <select id="institutionDocInstitutionId">
          <option value="">Select institution</option>
          ${institutions.map((row) => `<option value="${Number(row.id || 0)}">${escapeHtml(row.institution_name || "-")} (${escapeHtml(row.institution_code || "-")})</option>`).join("")}
        </select>
        <label>Module</label>
        <select id="institutionDocModuleKey">
          <option value="">Select module</option>
          ${moduleOptions.map((key) => `<option value="${escapeHtmlAttribute(key)}">${escapeHtml(toLabel(key))}</option>`).join("")}
        </select>
        <label>Sub-module</label>
        <select id="institutionDocSubmoduleKey">
          <option value="">Select sub-module</option>
        </select>
        <label>Sub-sub-module / Area</label>
        <input id="institutionDocSubSubmoduleKey" placeholder="Optional sub-sub-module or area" />
        <label>Document Type</label>
        <select id="institutionDocType">
          ${documentTypeOptions.map((entry) => `<option value="${escapeHtmlAttribute(entry)}">${escapeHtml(toLabel(entry))}</option>`).join("")}
        </select>
        <label>Document Title</label>
        <input id="institutionDocTitle" placeholder="Friendly title" />
        <label>Notes / Usage</label>
        <textarea id="institutionDocNotes" rows="3" placeholder="Usage notes"></textarea>
      </div>
      <div class="actions-row">
        <button id="institutionDocDownloadSampleBtn" type="button">Download Sample</button>
        <button id="institutionDocDownloadTemplatePackBtn" type="button">Download Template Pack</button>
        <label class="ax-btn ax-btn--upload ax-btn--sm" for="institutionDocFileInput">Select Upload</label>
        <input id="institutionDocFileInput" type="file" hidden />
        <button id="institutionDocSaveBtn" type="button">Upload & Save</button>
        <button id="institutionDocRefreshBtn" type="button">Refresh List</button>
      </div>
      <div id="institutionDocTableHolder"></div>
    `;
    const searchEl = document.getElementById("institutionDocSearchInput");
    const institutionEl = document.getElementById("institutionDocInstitutionId");
    const moduleEl = document.getElementById("institutionDocModuleKey");
    const submoduleEl = document.getElementById("institutionDocSubmoduleKey");
    const subSubmoduleEl = document.getElementById("institutionDocSubSubmoduleKey");
    const tableHolder = document.getElementById("institutionDocTableHolder");

    const refreshSubmodules = () => {
      const moduleKey = String(moduleEl?.value || "");
      const list = Array.isArray(SIDEBAR_SUBMODULES[moduleKey]) ? SIDEBAR_SUBMODULES[moduleKey] : [];
      if (!submoduleEl) return;
      submoduleEl.innerHTML = `<option value="">Select sub-module</option>${list
        .map((entry) => `<option value="${escapeHtmlAttribute(entry.id)}">${escapeHtml(entry.label)}</option>`)
        .join("")}`;
    };

    const refreshDocuments = async () => {
      const institutionId = Number(institutionEl?.value || 0);
      if (!institutionId) {
        tableHolder.innerHTML = '<p class="small-note">Select institution to view document mappings.</p>';
        return;
      }
      const q = String(searchEl?.value || "").trim();
      const docs = await request(
        `/api/system/institution-documents?institution_id=${institutionId}&q=${encodeURIComponent(q)}`
      );
      const rows = Array.isArray(docs?.documents) ? docs.documents : [];
      tableHolder.innerHTML = buildDashboardTable(
        ["ID", "Title", "Type", "Module", "Sub-module", "File", "Uploaded", "Actions"],
        rows.map((row) => [
          row.id,
          row.document_title || "-",
          row.document_type || "-",
          toLabel(row.module_key || "-"),
          row.submodule_key ? toLabel(row.submodule_key) : "-",
          row.file_path || "-",
          formatDateTime(row.created_at),
          `<div class="search-inline-actions">
            <button class="search-action-icon view" data-inst-doc-view="${Number(row.id || 0)}" title="View">👁</button>
            <button class="search-action-icon delete" data-inst-doc-delete="${Number(row.id || 0)}" title="Delete">🗑</button>
          </div>`
        ])
      );
      tableHolder.querySelectorAll("[data-inst-doc-view]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = Number(btn.getAttribute("data-inst-doc-view") || 0);
          const row = rows.find((entry) => Number(entry.id || 0) === id);
          if (!row?.file_path) return;
          window.open(row.file_path, "_blank");
        });
      });
      tableHolder.querySelectorAll("[data-inst-doc-delete]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = Number(btn.getAttribute("data-inst-doc-delete") || 0);
          if (!id || !window.confirm("Delete this institution document mapping?")) return;
          await request(`/api/system/institution-documents/${id}`, { method: "DELETE" });
          await refreshDocuments();
        });
      });
      applyCompactIconButtons(document.getElementById("formArea"));
    };

    moduleEl?.addEventListener("change", refreshSubmodules);
    institutionEl?.addEventListener("change", refreshDocuments);
    searchEl?.addEventListener("input", () => {
      window.clearTimeout(searchEl.__institutionDocTimer);
      searchEl.__institutionDocTimer = window.setTimeout(() => refreshDocuments().catch(() => {}), 250);
    });
    document.getElementById("institutionDocRefreshBtn")?.addEventListener("click", refreshDocuments);
    document.getElementById("institutionDocDownloadSampleBtn")?.addEventListener("click", () => {
      const payload = [
        "institution_code,module_key,submodule_key,document_type,document_title,notes,file_path",
        "001/PJ/001,admission,admission-letter,admission_letter_template,Admission Letter Template,Update placeholders,/uploads/sample-admission-letter.docx"
      ].join("\n");
      downloadTextFile("institution-document-template.csv", payload, "text/csv;charset=utf-8");
    });
    document.getElementById("institutionDocDownloadTemplatePackBtn")?.addEventListener("click", () => {
      const payload = [
        "TEMPLATE PACK",
        "1) admission_letter_template",
        "2) admission_form_template",
        "3) assessment_report_template",
        "4) exam_script_template",
        "5) result_script_template",
        "6) institution_letterhead",
        "",
        "Upload each file after selecting institution + module + sub-module."
      ].join("\n");
      downloadTextFile("institution-template-pack.txt", payload, "text/plain;charset=utf-8");
    });
    document.getElementById("institutionDocSaveBtn")?.addEventListener("click", async () => {
      const institutionId = Number(institutionEl?.value || 0);
      if (!institutionId) {
        alert("Select institution first.");
        return;
      }
      const uploadFile = document.getElementById("institutionDocFileInput")?.files?.[0] || null;
      if (!uploadFile) {
        alert("Select a file to upload.");
        return;
      }
      const uploaded = await uploadFileWithAuth(uploadFile);
      await request("/api/system/institution-documents", {
        method: "POST",
        body: JSON.stringify({
          institution_id: institutionId,
          module_key: String(moduleEl?.value || "").trim() || null,
          submodule_key: [String(submoduleEl?.value || "").trim(), String(subSubmoduleEl?.value || "").trim()]
            .filter(Boolean)
            .join(" / ") || null,
          document_type: String(document.getElementById("institutionDocType")?.value || "").trim() || "other",
          document_title: String(document.getElementById("institutionDocTitle")?.value || "").trim() || uploadFile.name,
          notes: String(document.getElementById("institutionDocNotes")?.value || "").trim() || null,
          file_path: uploaded?.filePath || null
        })
      });
      alert("Institution document uploaded and mapped successfully.");
      document.getElementById("institutionDocFileInput").value = "";
      await refreshDocuments();
    });
    refreshSubmodules();
    await refreshDocuments();
    applyCompactIconButtons(document.getElementById("formArea"));
  } catch (error) {
    alert(error.message);
  }
}

async function renderInstitutionUploadsModule() {
  return renderInstitutionEditModule({ variant: "uploads" });
}

async function renderRecycleBin() {
  setActiveSidebarButton("system-recycle-bin");
  document.getElementById("moduleTitle").textContent = "Recycle Bin";
  if (!isSystemAdminRole()) {
    alert("Only System Developer, Admin, or Head of Institution can manage recycle bin.");
    return loadDashboard();
  }
  try {
    const recycleData = await request("/api/system/recycle-bin?status=TRASHED&limit=200");
    const rows = Array.isArray(recycleData?.items) ? recycleData.items : [];
    const retentionYears = Number(recycleData?.retention_years || 15);
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>Trashed Items</h4>
        <p>${formatNumber(rows.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Retention</h4>
        <p>${retentionYears} years</p>
      </div>
      <div class="card stats-card">
        <h4>Purge Rule</h4>
        <p>3-step confirmation required</p>
      </div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Recycle Bin Management</h3>
        <p>Trashed learner and operational records remain available for institutional recovery for at least ${retentionYears} years. Non–System Developers who purge records only hide them locally; System Developer consoles retain supervisory copies for supervisory retention periods.</p>
      </div>
      <div class="actions-row">
        <button id="restoreRecycleItemButton">Restore Item</button>
        <button id="purgeRecycleItemButton" class="danger">Purge Item</button>
        <button id="viewRecycleItemButton">View Item</button>
        <button id="refreshRecycleBinButton">Refresh</button>
      </div>
      <div id="recycleTableHolder"></div>
    `;

    const recycleTableHolder = document.getElementById("recycleTableHolder");
    const actionButtons = (row) => `
      <div class="search-inline-actions">
        <button class="search-action-icon view" data-recycle-action="view" data-recycle-id="${Number(row.id || 0)}" title="View">👁</button>
        <button class="search-action-icon save" data-recycle-action="restore" data-recycle-id="${Number(row.id || 0)}" title="Restore">↩</button>
        <button class="search-action-icon delete" data-recycle-action="purge" data-recycle-id="${Number(row.id || 0)}" title="Delete Permanently">🗑</button>
      </div>
    `;
    if (recycleTableHolder) {
      recycleTableHolder.innerHTML = buildDashboardTable(
        ["Recycle ID", "Entity", "Entity ID", "Deleted By", "Username", "Deleted At", "IP Address", "Machine", "Description", "Status", "Actions"],
        rows.map((row) => [
          row.id || "-",
          row.entity_name || "-",
          row.entity_id || "-",
          row.deleted_by_name || "-",
          row.deleted_by_username || "-",
          formatDateTime(row.deleted_at),
          row.deleted_ip_address || "-",
          row.deleted_machine_name || "-",
          row.delete_description || "-",
          row.status || "-",
          actionButtons(row)
        ])
      );
      recycleTableHolder.querySelectorAll("[data-recycle-action]").forEach((button) => {
        button.addEventListener("click", async () => {
          const recycleId = Number(button.getAttribute("data-recycle-id") || 0);
          const action = String(button.getAttribute("data-recycle-action") || "");
          if (!recycleId) return;
          try {
            if (action === "view") {
              const item = rows.find((row) => Number(row.id) === recycleId) || null;
              alert(JSON.stringify(item || {}, null, 2));
              return;
            }
            if (action === "restore") {
              const result = await request(`/api/system/recycle-bin/${recycleId}/restore`, { method: "POST" });
              alert(result.message || "Item restored.");
              await renderRecycleBin();
              return;
            }
            if (action === "purge") {
              const result = await purgeRecycleWithThreeStepPrompt(recycleId);
              if (!result) return;
              alert(result.message || "Item purged.");
              await renderRecycleBin();
            }
          } catch (error) {
            alert(error.message);
          }
        });
      });
    }

    resetDataTable("Recycle bin records loaded above.");
    document.getElementById("restoreRecycleItemButton")?.addEventListener("click", async () => {
      const recycleId = Number(prompt("Enter recycle item ID to restore:"));
      if (!recycleId) return;
      try {
        const result = await request(`/api/system/recycle-bin/${recycleId}/restore`, { method: "POST" });
        alert(result.message || "Item restored.");
        await renderRecycleBin();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("purgeRecycleItemButton")?.addEventListener("click", async () => {
      const recycleId = Number(prompt("Enter recycle item ID to purge permanently:"));
      if (!recycleId) return;
      try {
        const result = await purgeRecycleWithThreeStepPrompt(recycleId);
        if (!result) return;
        alert(result.message || "Item purged permanently.");
        await renderRecycleBin();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("viewRecycleItemButton")?.addEventListener("click", () => {
      const recycleId = Number(prompt("Enter recycle item ID to view:", "") || 0);
      if (!recycleId) return;
      const item = rows.find((row) => Number(row.id) === recycleId);
      if (!item) {
        alert("Recycle item not found in current list.");
        return;
      }
      alert(JSON.stringify(item, null, 2));
    });
    document.getElementById("refreshRecycleBinButton")?.addEventListener("click", renderRecycleBin);
    applyCompactIconButtons(document.getElementById("formArea"));
  } catch (error) {
    alert(error.message);
  }
}

async function renderSystemOpsCenter() {
  setActiveSidebarButton("system-ops-center");
  document.getElementById("moduleTitle").textContent = "System Ops Center";
  if (!canOpenSecurityAuditModule()) {
    alert("Only System Developer / Admin scope can open System Ops Center.");
    return loadDashboard();
  }
  try {
    const payload = await request("/api/system/ops/overview?snapshot_limit=60");
    const moduleRows = Array.isArray(payload?.module_health) ? payload.module_health : [];
    const snapshots = Array.isArray(payload?.recent_snapshots) ? payload.recent_snapshots : [];
    const metrics = payload?.metrics || {};
    const posture = payload?.security_posture || {};
    const recommendations = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis"><h4>Healthy Modules</h4><p>${formatNumber(moduleRows.filter((row) => row.status === "HEALTHY").length)}</p></div>
      <div class="card stats-card"><h4>Empty Modules</h4><p>${formatNumber(moduleRows.filter((row) => row.status === "EMPTY").length)}</p></div>
      <div class="card stats-card"><h4>Failed Login 24h</h4><p>${formatNumber(metrics.failed_login_events_24h || 0)}</p></div>
      <div class="card stats-card"><h4>OTP Failures 24h</h4><p>${formatNumber(metrics.otp_fail_events_24h || 0)}</p></div>
      <div class="card stats-card"><h4>Queued Messages</h4><p>${formatNumber(metrics.queued_messages || 0)}</p></div>
      <div class="card stats-card"><h4>Open Incidents</h4><p>${formatNumber(metrics.open_security_incidents || 0)}</p></div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Operations & Hardening Center</h3>
        <p>Real-time health posture for critical modules, communication queues, and security readiness across your institution scope.</p>
      </div>
      <div class="actions-row">
        <button id="opsCenterRefreshBtn" class="ax-btn ax-btn--refresh ax-btn--sm">Refresh</button>
        <button id="opsCenterSnapshotBtn" class="ax-btn ax-btn--save ax-btn--sm">Capture Snapshot</button>
        <button id="opsCenterDownloadBtn" class="ax-btn ax-btn--download ax-btn--sm">Download</button>
        <button id="opsCenterPrintBtn" class="ax-btn ax-btn--print ax-btn--sm">Print</button>
      </div>
      <div class="module-header-card">
        <h4>Security Posture</h4>
        <p class="small-note">JWT: ${posture.jwt_secret_configured ? "Configured" : "Missing"} | SMS: ${posture.otp_sms_ready ? "Ready" : "Not ready"} | Email: ${posture.otp_email_ready ? "Ready" : "Not ready"} | CSP: ${posture.csp_enabled ? "Enabled" : "Disabled"} | HTTPS: ${posture.force_https ? "Enforced" : "Relaxed"}</p>
        <p class="small-note">${recommendations.length ? recommendations.map((item) => `- ${escapeHtml(item)}`).join("<br/>") : "No blocking hardening recommendation at this time."}</p>
      </div>
      <h4>Module Health Matrix</h4>
      <div id="opsCenterModuleTable"></div>
      <h4>Recent Health Snapshots</h4>
      <div id="opsCenterSnapshotTable"></div>
    `;
    const moduleTableNode = document.getElementById("opsCenterModuleTable");
    if (moduleTableNode) {
      moduleTableNode.innerHTML = buildDashboardTable(
        ["Module", "Rows", "Status", "Summary"],
        moduleRows.map((row) => [row.module_label || row.module_key || "-", row.total_rows ?? "-", row.status || "-", row.summary || "-"])
      );
    }
    const snapshotTableNode = document.getElementById("opsCenterSnapshotTable");
    if (snapshotTableNode) {
      snapshotTableNode.innerHTML = buildDashboardTable(
        ["Snapshot ID", "Module", "Rows", "Status", "Captured"],
        snapshots.slice(0, 120).map((row) => [row.id || "-", row.module_label || row.module_key || "-", row.total_rows ?? "-", row.status || "-", formatDateTime(row.created_at)])
      );
    }
    document.getElementById("opsCenterRefreshBtn")?.addEventListener("click", renderSystemOpsCenter);
    document.getElementById("opsCenterSnapshotBtn")?.addEventListener("click", async () => {
      try {
        const result = await request("/api/system/ops/snapshots", { method: "POST", body: JSON.stringify({}) });
        alert(result?.message || "Snapshot captured.");
        await renderSystemOpsCenter();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("opsCenterDownloadBtn")?.addEventListener("click", () => {
      const csv = rowsToCsv(moduleRows.map((row) => ({
        module_key: row.module_key || "",
        module_label: row.module_label || "",
        total_rows: row.total_rows ?? "",
        status: row.status || "",
        summary: row.summary || ""
      })));
      downloadTextFile("system-ops-center-health.csv", csv, "text/csv;charset=utf-8");
    });
    document.getElementById("opsCenterPrintBtn")?.addEventListener("click", () => window.print());
    applyCompactIconButtons(document.getElementById("formArea"));
    resetDataTable("System Ops Center loaded.");
  } catch (error) {
    alert(error.message);
  }
}

async function renderSystemIncidentResponse() {
  setActiveSidebarButton("system-incident-response");
  document.getElementById("moduleTitle").textContent = "System Incident Response";
  if (!canOpenSecurityAuditModule()) {
    alert("Only System Developer / Admin scope can open Incident Response.");
    return loadDashboard();
  }
  try {
    const incidents = await request("/api/system/security/incidents?limit=220");
    const rows = Array.isArray(incidents) ? incidents : [];
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis"><h4>Open</h4><p>${formatNumber(rows.filter((row) => String(row.status || "").toUpperCase() === "OPEN").length)}</p></div>
      <div class="card stats-card"><h4>In Progress</h4><p>${formatNumber(rows.filter((row) => String(row.status || "").toUpperCase() === "IN_PROGRESS").length)}</p></div>
      <div class="card stats-card"><h4>Resolved</h4><p>${formatNumber(rows.filter((row) => String(row.status || "").toUpperCase() === "RESOLVED").length)}</p></div>
      <div class="card stats-card"><h4>Total Incidents</h4><p>${formatNumber(rows.length)}</p></div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Incident Response Desk</h3>
        <p>Create incidents, escalate or resolve them, and keep auditable response notes per institution scope.</p>
      </div>
      <div class="form-grid">
        <label>Incident Type</label>
        <input id="incidentTypeInput" placeholder="e.g. AUTH_BRUTE_FORCE" />
        <label>Severity</label>
        <select id="incidentSeverityInput"><option value="LOW">LOW</option><option value="MEDIUM" selected>MEDIUM</option><option value="HIGH">HIGH</option><option value="CRITICAL">CRITICAL</option></select>
        <label>Affected Module</label>
        <input id="incidentModuleInput" placeholder="e.g. communication-messages" />
        <label>Title</label>
        <input id="incidentTitleInput" placeholder="Short title" />
        <label>Description</label>
        <textarea id="incidentDescriptionInput" rows="4" placeholder="Incident details"></textarea>
      </div>
      <div class="actions-row">
        <button id="incidentCreateBtn" class="ax-btn ax-btn--save ax-btn--sm">Create</button>
        <button id="incidentResolveBtn" class="ax-btn ax-btn--process ax-btn--sm">Resolve by ID</button>
        <button id="incidentRefreshBtn" class="ax-btn ax-btn--refresh ax-btn--sm">Refresh</button>
        <button id="incidentDownloadBtn" class="ax-btn ax-btn--download ax-btn--sm">Download</button>
        <button id="incidentPrintBtn" class="ax-btn ax-btn--print ax-btn--sm">Print</button>
      </div>
      <div id="incidentResponseTable"></div>
    `;
    const tableNode = document.getElementById("incidentResponseTable");
    if (tableNode) {
      tableNode.innerHTML = buildDashboardTable(
        ["ID", "Code", "Type", "Severity", "Status", "Module", "Title", "Detected", "Resolved"],
        rows.map((row) => [
          row.id || "-",
          row.incident_code || "-",
          row.incident_type || "-",
          row.severity || "-",
          row.status || "-",
          row.affected_module || "-",
          row.title || "-",
          formatDateTime(row.detected_at),
          formatDateTime(row.resolved_at)
        ])
      );
    }
    document.getElementById("incidentCreateBtn")?.addEventListener("click", async () => {
      const payload = {
        incident_type: String(document.getElementById("incidentTypeInput")?.value || "").trim() || "GENERAL",
        severity: String(document.getElementById("incidentSeverityInput")?.value || "MEDIUM").trim(),
        affected_module: String(document.getElementById("incidentModuleInput")?.value || "").trim() || null,
        title: String(document.getElementById("incidentTitleInput")?.value || "").trim(),
        description: String(document.getElementById("incidentDescriptionInput")?.value || "").trim()
      };
      if (!payload.title || !payload.description) {
        alert("Incident title and description are required.");
        return;
      }
      try {
        const result = await request("/api/system/security/incidents", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        alert(result?.message || "Incident created.");
        await renderSystemIncidentResponse();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("incidentResolveBtn")?.addEventListener("click", async () => {
      const incidentId = Number(prompt("Enter incident ID to resolve:", "") || 0);
      if (!incidentId) return;
      const notes = prompt("Resolution notes:", "") || "";
      try {
        await request(`/api/system/security/incidents/${incidentId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "RESOLVED", resolution_notes: notes })
        });
        alert("Incident resolved.");
        await renderSystemIncidentResponse();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("incidentRefreshBtn")?.addEventListener("click", renderSystemIncidentResponse);
    document.getElementById("incidentDownloadBtn")?.addEventListener("click", () => {
      const csv = rowsToCsv(rows.map((row) => ({
        id: row.id || "",
        incident_code: row.incident_code || "",
        incident_type: row.incident_type || "",
        severity: row.severity || "",
        status: row.status || "",
        affected_module: row.affected_module || "",
        title: row.title || "",
        description: row.description || "",
        detected_at: row.detected_at || "",
        resolved_at: row.resolved_at || ""
      })));
      downloadTextFile("system-security-incidents.csv", csv, "text/csv;charset=utf-8");
    });
    document.getElementById("incidentPrintBtn")?.addEventListener("click", () => window.print());
    applyCompactIconButtons(document.getElementById("formArea"));
    resetDataTable("Incident response records loaded.");
  } catch (error) {
    alert(error.message);
  }
}

function buildExamGradeFormSelectOptions() {
  const gradeOptions = Array.isArray(meta?.gradeOptions) ? meta.gradeOptions : [];
  const formOptions = Array.isArray(meta?.formOptions) ? meta.formOptions : ["Form 3", "Form 4"];
  return {
    grades: gradeOptions.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join(""),
    forms: formOptions.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("")
  };
}

function buildExamLearningAreaOptions() {
  return buildExamLearningAreaOptionsBySelection({});
}

function normalizeLookupKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function collectAllCbcLearningAreas() {
  if (Array.isArray(meta?.cbcLearningAreas) && meta.cbcLearningAreas.length) {
    return meta.cbcLearningAreas;
  }
  const levels = Array.isArray(meta?.cbcLevels) ? meta.cbcLevels : [];
  return levels.flatMap((level) => [
    ...(Array.isArray(level.learningAreas) ? level.learningAreas : []),
    ...Object.values(level.pathways || {}).flatMap((areas) => (Array.isArray(areas) ? areas : []))
  ]);
}

function getSeniorSecondaryPathwayOptions() {
  const levels = Array.isArray(meta?.cbcLevels) ? meta.cbcLevels : [];
  const senior = levels.find((level) => normalizeLookupKey(level.key || level.label) === "seniorsecondary");
  return Object.keys(senior?.pathways || {});
}

function buildExamLearningAreaOptionsBySelection(selection = {}) {
  const fallback = (Array.isArray(meta?.subjectOptions) ? meta.subjectOptions : [])
    .filter((item) => String(item || "").toUpperCase() !== "ALL");
  const levels = Array.isArray(meta?.cbcLevels) ? meta.cbcLevels : [];
  if (!levels.length) {
    return fallback.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  }
  const grade = String(selection?.grade || "");
  const form = String(selection?.form || "");
  const pathway = String(selection?.pathway || "");
  const chosen = grade || form;
  const chosenKey = normalizeLookupKey(chosen);
  const selectedLevel = levels.find((level) =>
    Array.isArray(level.grades)
    && level.grades.some((item) => normalizeLookupKey(item) === chosenKey)
  );
  const areas = [];
  if (selectedLevel) {
    areas.push(...(Array.isArray(selectedLevel.learningAreas) ? selectedLevel.learningAreas : []));
    const pathways = selectedLevel.pathways || {};
    const selectedPathwayKey = normalizeLookupKey(pathway);
    if (selectedPathwayKey && Object.keys(pathways).length) {
      const matchedPathway = Object.keys(pathways).find((name) => normalizeLookupKey(name) === selectedPathwayKey);
      if (matchedPathway) {
        areas.splice(0, areas.length);
        areas.push(...(Array.isArray(pathways[matchedPathway]) ? pathways[matchedPathway] : []));
      }
    } else {
      Object.values(pathways).forEach((items) => {
        if (Array.isArray(items)) areas.push(...items);
      });
    }
  } else {
    areas.push(...collectAllCbcLearningAreas());
  }
  const deduped = Array.from(new Set(areas.map((item) => String(item || "").trim()).filter(Boolean)));
  return deduped.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
}

function buildExamTermYearOptions() {
  const termOptions = Array.isArray(meta?.termOptions) ? meta.termOptions : ["Term One", "Term Two", "Term Three"];
  const yearOptions = Array.from({ length: 54 }, (_, index) => {
    const start = 2017 + index;
    return `${start}/${start + 1}`;
  });
  return {
    terms: termOptions.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join(""),
    years: yearOptions.map((y) => `<option value="${y}">${y}</option>`).join("")
  };
}

function parseAcademicYearStart(academicYear = "") {
  const start = Number(String(academicYear || "").split("/")[0] || 0);
  return Number.isFinite(start) && start > 0 ? start : new Date().getFullYear();
}

function buildLearningAreaCode(learningArea = "") {
  const source = String(learningArea || "").trim().toLowerCase();
  if (!source) return "99";
  if (source.includes("mathematics")) return "01";
  if (source.includes("english")) return "02";
  if (source.includes("kiswahili")) return "03";
  if (source.includes("science")) return "04";
  if (source.includes("social")) return "05";
  if (source.includes("pre-technical")) return "06";
  return String(
    Math.max(
      1,
      (Array.from(source).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 89) + 10
    )
  ).padStart(2, "0");
}

function buildExamShortCode(examSession = "") {
  const source = String(examSession || "").trim().toUpperCase();
  const known = {
    "HEAD START": "HS",
    CATS: "CT",
    MIDTERM: "MT",
    "END TERM": "ET",
    JOINT: "JT",
    MOCK: "MK",
    KNEC: "KC",
    "INTER-SCHOOLS": "IS",
    "INTER-COUNTY": "IC",
    OTHER: "OT"
  };
  return known[source] || source.replace(/[^A-Z0-9]/g, "").slice(0, 2) || "EX";
}

function buildLearnerExamSerial({
  learningArea = "",
  gradeOrForm = "",
  stream = "",
  examSession = "",
  learnerSerialNumber = ""
} = {}) {
  const areaCode = buildLearningAreaCode(learningArea);
  const levelCode = String(gradeOrForm || "").replace(/[^\dA-Za-z]/g, "").slice(-2) || "00";
  const streamCode = String(stream || "X").trim().toUpperCase().slice(0, 1) || "X";
  const examCode = buildExamShortCode(examSession);
  const learnerCode = String(learnerSerialNumber || "")
    .replace(/\D/g, "")
    .padStart(3, "0")
    .slice(-3) || "000";
  return `${areaCode}/${levelCode}/${streamCode}/${examCode}/${learnerCode}`;
}

function isExamNotesGenerationRole(role = "") {
  const normalized = normalizeRoleKey(role || "");
  return [
    "SUPER_SYSTEM_DEVELOPER",
    "SYSTEM_DEVELOPER",
    "ADMIN",
    "HEAD_OF_INSTITUTION",
    "SENIOR_TEACHER",
    "HEAD_OF_DEPARTMENT",
    "TEACHER"
  ].includes(normalized);
}

function renderExamGenerationPanel() {
  const { grades, forms } = buildExamGradeFormSelectOptions();
  const { terms, years } = buildExamTermYearOptions();
  const learningAreas = buildExamLearningAreaOptionsBySelection({});
  const examSessions = [
    "Head Start",
    "CATS",
    "Midterm",
    "End Term",
    "Joint",
    "Mock",
    "KNEC",
    "Inter-Schools",
    "Inter-County",
    "Other"
  ];
  return `
    <div class="module-header-card">
      <h4>Exam Generation</h4>
      <p>Generate exams with AI from selected learning area, strand and sub-strand only. Coverage never goes beyond selected curriculum scope. Notes upload is optional.</p>
    </div>
    <div class="form-grid">
      <label>Examination Session</label>
      <select id="examGenSession">
        <option value="">Select examination session</option>
        ${examSessions.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
      </select>
      <label>Academic Year</label>
      <select id="examGenAcademicYear" disabled><option value="">Select academic year</option>${years}</select>
      <label>Term</label>
      <select id="examGenTerm" disabled><option value="">Select term</option>${terms}</select>
      <label>Grade</label>
      <select id="examGenGrade" disabled><option value="">Select grade</option>${grades}</select>
      <label>Form</label>
      <select id="examGenForm" disabled><option value="">Select form</option>${forms}</select>
      <label>Learning Area</label>
      <select id="examGenLearningArea" disabled><option value="">Select learning area</option>${learningAreas}</select>
      <label>Strand</label>
      <select id="examGenStrand" disabled><option value="">Select strand</option></select>
      <label>Sub-Strand</label>
      <select id="examGenSubStrand" disabled><option value="">Select sub-strand</option></select>
      <label>Stream</label>
      <input id="examGenStream" placeholder="Stream" />
      <label>Exam Structure</label>
      <select id="examGenStructure" disabled>
        <option value="">Select exam structure</option>
        <option value="unified">Unified paper</option>
        <option value="structured">Structured paper</option>
        <option value="multi-section">Multi-section paper</option>
      </select>
      <label>Structure Detail</label>
      <select id="examGenStructureDetail" disabled>
        <option value="">Select structure detail</option>
        <option value="A_B">Section A & B</option>
        <option value="A_B_C">Section A, B & C</option>
        <option value="PAPER_1_2">Paper 1 & 2</option>
        <option value="PAPER_1_2_3">Paper 1, 2 & 3</option>
      </select>
      <label>Exam Percentage Allocation</label>
      <input id="examGenPercentage" disabled placeholder="e.g. 40,30,30 (sum must be <= 100)" />
      <label>Exam Output Mode</label>
      <select id="examGenOutputMode" disabled>
        <option value="per_learner">Per learner</option>
        <option value="per_grade">Per grade/form</option>
        <option value="per_stream">Per stream</option>
      </select>
    </div>
    <div class="ax-toolbar">
      <button class="ax-btn ax-btn--generate" id="examGenGenerateButton" title="Generate exam with AI" disabled>Generate</button>
      <button class="ax-btn ax-btn--save" id="examGenSaveButton" title="Save generated exam" disabled>Save</button>
      <button class="ax-btn ax-btn--edit" id="examGenEditButton" title="Edit generated exam" disabled>Edit</button>
      <button class="ax-btn ax-btn--view" id="examGenViewButton" title="View">View</button>
      <button class="ax-btn ax-btn--download" id="examGenDownloadButton" title="Download">Download</button>
      <button class="ax-btn ax-btn--print" id="examGenPrintButton" title="Print">Print</button>
      <button class="ax-btn ax-btn--export-excel" id="examGenDownloadSerialsButton" title="Download serial list">Serials</button>
    </div>
    <label>Generated Exam Text (editable after generate)</label>
    <textarea id="examGenGeneratedText" rows="12" placeholder="Generated exam text appears here." readonly></textarea>
    <div id="examGenLearnerActions" class="dashboard-section"></div>
    <div id="examGenPreview" class="small-note">Select examination session first to activate the rest of the workflow. You do not need to upload notes for AI generation.</div>
  `;
}

function buildExamSerialNumber({ grade, form, learningArea, examType, term, year, stream, learnerId }) {
  const part = (value) => String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  const gradePart = part(grade || form);
  const learningPart = part(learningArea).slice(0, 4) || "GEN";
  const termPart = part(term).replace(/[^A-Z0-9]/g, "").slice(0, 3) || "T0";
  const yearPart = part(year) || new Date().getFullYear();
  const examPart = part(examType).replace(/[^A-Z0-9]/g, "").slice(0, 3) || "EXM";
  const streamPart = part(stream).slice(0, 4);
  const learnerPart = learnerId ? `L${learnerId}` : "BULK";
  const seq = Math.random().toString(36).slice(2, 7).toUpperCase();
  return [examPart, gradePart, learningPart, termPart, yearPart, streamPart, learnerPart, seq]
    .filter(Boolean)
    .join("-");
}

function downloadTextFile(filename, text, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([String(text || "")], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const raw = String(value ?? "");
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, "\"\"")}"`;
}

function rowsToCsv(rows, headers) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const columns = Array.isArray(headers) && headers.length ? headers : Object.keys(rows[0]);
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ].join("\n");
}

function wireExamGenerationPanel() {
  const fields = {
    session: document.getElementById("examGenSession"),
    academicYear: document.getElementById("examGenAcademicYear"),
    term: document.getElementById("examGenTerm"),
    grade: document.getElementById("examGenGrade"),
    form: document.getElementById("examGenForm"),
    learningArea: document.getElementById("examGenLearningArea"),
    strand: document.getElementById("examGenStrand"),
    subStrand: document.getElementById("examGenSubStrand"),
    structure: document.getElementById("examGenStructure"),
    structureDetail: document.getElementById("examGenStructureDetail"),
    percentage: document.getElementById("examGenPercentage"),
    outputMode: document.getElementById("examGenOutputMode"),
    stream: document.getElementById("examGenStream"),
    generatedText: document.getElementById("examGenGeneratedText")
  };
  const controls = {
    generate: document.getElementById("examGenGenerateButton"),
    save: document.getElementById("examGenSaveButton"),
    edit: document.getElementById("examGenEditButton"),
    view: document.getElementById("examGenViewButton"),
    download: document.getElementById("examGenDownloadButton"),
    print: document.getElementById("examGenPrintButton"),
    serials: document.getElementById("examGenDownloadSerialsButton"),
    preview: document.getElementById("examGenPreview"),
    learnerActions: document.getElementById("examGenLearnerActions")
  };
  let strandMap = {};

  const setEnabled = (node, enabled) => {
    if (!node) return;
    node.disabled = !enabled;
  };

  const refreshLearningAreas = () => {
    if (!fields.learningArea) return;
    const selected = String(fields.learningArea.value || "");
    fields.learningArea.innerHTML = `<option value="">Select learning area</option>${buildExamLearningAreaOptionsBySelection({
      grade: fields.grade?.value || "",
      form: fields.form?.value || ""
    })}`;
    if (selected && Array.from(fields.learningArea.options).some((option) => option.value === selected)) {
      fields.learningArea.value = selected;
    }
  };

  const ensureActivationFlow = () => {
    setEnabled(fields.academicYear, Boolean(fields.session?.value));
    setEnabled(fields.term, Boolean(fields.academicYear?.value));
    setEnabled(fields.grade, Boolean(fields.term?.value && !fields.form?.value));
    setEnabled(fields.form, Boolean(fields.term?.value && !fields.grade?.value));
    setEnabled(fields.learningArea, Boolean((fields.grade?.value || fields.form?.value) && fields.term?.value));
    setEnabled(fields.strand, Boolean(fields.learningArea?.value));
    setEnabled(fields.subStrand, Boolean(fields.strand?.value));
    setEnabled(fields.structure, Boolean(fields.strand?.value));
    const structureChosen = Boolean(fields.structure?.value);
    setEnabled(fields.structureDetail, structureChosen && fields.structure?.value !== "unified");
    setEnabled(fields.percentage, structureChosen);
    setEnabled(fields.outputMode, structureChosen);
    const detailOk = fields.structure?.value === "unified" || Boolean(fields.structureDetail?.value);
    const readyToGenerate = Boolean(
      fields.session?.value
      && fields.academicYear?.value
      && fields.term?.value
      && (fields.grade?.value || fields.form?.value)
      && fields.learningArea?.value
      && fields.strand?.value
      && fields.structure?.value
      && detailOk
      && fields.percentage?.value
    );
    setEnabled(controls.generate, readyToGenerate);
  };

  const refreshStructureFromCurriculum = async () => {
    const learningArea = String(fields.learningArea?.value || "");
    const grade = String(fields.grade?.value || "");
    const formName = String(fields.form?.value || "");
    if ((!grade && !formName) || !learningArea) {
      strandMap = {};
      if (fields.strand) fields.strand.innerHTML = `<option value="">Select strand</option>`;
      if (fields.subStrand) fields.subStrand.innerHTML = `<option value="">Select sub-strand</option>`;
      ensureActivationFlow();
      return;
    }
    try {
      const result = await request("/api/cbc/curriculum/ai-suggest-structure", {
        method: "POST",
        body: JSON.stringify({ grade, form_name: formName, learning_area: learningArea })
      });
      strandMap = result?.sub_strand_options_by_strand || {};
      const strandOptions = Array.isArray(result?.strand_options) ? result.strand_options : [];
      if (fields.strand) {
        fields.strand.innerHTML = `<option value="">Select strand</option>${strandOptions
          .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
          .join("")}`;
      }
      if (fields.subStrand) {
        fields.subStrand.innerHTML = `<option value="">Select sub-strand</option>`;
      }
    } catch (_) {
      // Keep manual selection possible even if AI structure lookup fails.
    } finally {
      ensureActivationFlow();
    }
  };

  const renderPerLearnerActions = (payload) => {
    if (!controls.learnerActions) return;
    if (payload.outputMode !== "per_learner") {
      controls.learnerActions.innerHTML = "";
      return;
    }
    const rows = Array.isArray(examPanelState.serials) ? examPanelState.serials : [];
    if (!rows.length) {
      controls.learnerActions.innerHTML = `<p class="small-note">No learner serials generated yet.</p>`;
      return;
    }
    const baseText = String(fields.generatedText?.value || "");
    controls.learnerActions.innerHTML = `
      <h5>Per Learner Print / Download</h5>
      <div class="dashboard-table-wrap">
        <table class="dashboard-table">
          <thead>
            <tr><th>Learner</th><th>Admission</th><th>Grade</th><th>Stream</th><th>Exam Serial</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${rows.slice(0, 200).map((row) => {
              const serial = buildLearnerExamSerial({
                learningArea: payload.learningArea,
                gradeOrForm: payload.grade || payload.formName,
                stream: row.stream || payload.stream || "",
                examSession: payload.session,
                learnerSerialNumber: row.learner_serial_number || row.learner_id
              });
              return `
                <tr>
                  <td>${escapeHtml(row.learner_name || "-")}</td>
                  <td>${escapeHtml(row.admission_number || "-")}</td>
                  <td>${escapeHtml(row.grade || payload.grade || payload.formName || "-")}</td>
                  <td>${escapeHtml(row.stream || payload.stream || "-")}</td>
                  <td>${escapeHtml(serial)}</td>
                  <td>
                    <button class="ax-btn ax-btn--print ax-btn--sm exam-learner-print" data-learner-serial="${escapeHtmlAttribute(serial)}">Print</button>
                    <button class="ax-btn ax-btn--download ax-btn--sm exam-learner-download" data-learner-serial="${escapeHtmlAttribute(serial)}" data-learner-name="${escapeHtmlAttribute(row.learner_name || "learner")}">Download</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
    controls.learnerActions.querySelectorAll(".exam-learner-print").forEach((btn) => {
      btn.addEventListener("click", () => {
        const serial = String(btn.getAttribute("data-learner-serial") || "");
        const popup = window.open("", "_blank");
        if (!popup) return;
        popup.document.write(`<pre>${escapeHtml(`EXAM SERIAL: ${serial}\n\n${baseText}`)}</pre>`);
        popup.document.close();
        popup.print();
      });
    });
    controls.learnerActions.querySelectorAll(".exam-learner-download").forEach((btn) => {
      btn.addEventListener("click", () => {
        const serial = String(btn.getAttribute("data-learner-serial") || "");
        const learnerName = String(btn.getAttribute("data-learner-name") || "learner");
        downloadTextFile(
          `exam-${learnerName.replace(/\s+/g, "-").toLowerCase()}-${serial.replace(/[^\w-]+/g, "-")}.txt`,
          `EXAM SERIAL: ${serial}\n\n${baseText}`
        );
      });
    });
  };

  const parsePercentageTotal = () => {
    const raw = String(fields.percentage?.value || "").trim();
    if (!raw) return null;
    const list = raw
      .split(",")
      .map((item) => Number(String(item || "").replace("%", "").trim()))
      .filter((value) => Number.isFinite(value) && value >= 0);
    if (!list.length) return null;
    return list.reduce((sum, value) => sum + value, 0);
  };

  const getPayload = () => {
    const grade = String(fields.grade?.value || "");
    const formName = String(fields.form?.value || "");
    const learningArea = String(fields.learningArea?.value || "");
    const session = String(fields.session?.value || "");
    const academicYear = String(fields.academicYear?.value || "");
    const term = String(fields.term?.value || "");
    const strand = String(fields.strand?.value || "");
    const subStrand = String(fields.subStrand?.value || "");
    const structure = String(fields.structure?.value || "");
    const structureDetail = String(fields.structureDetail?.value || "");
    const outputMode = String(fields.outputMode?.value || "per_learner");
    const stream = String(fields.stream?.value || "");
    if (grade && formName) {
      alert("Choose either grade or form, not both.");
      return null;
    }
    const total = parsePercentageTotal();
    if (!Number.isFinite(total)) {
      alert("Enter exam percentage values, for example 50 or 40,30,30.");
      return null;
    }
    if (total > 100) {
      alert("The total percentage allocation cannot exceed 100%.");
      return null;
    }
    if (!session || !academicYear || !term || (!grade && !formName) || !learningArea || !strand || !structure) {
      alert("Complete all required steps before generating.");
      return null;
    }
    if (structure !== "unified" && !structureDetail) {
      alert("Select the section/paper breakdown.");
      return null;
    }
    return {
      title: `${session} - ${learningArea}`,
      examType: session,
      session,
      grade,
      formName,
      learningArea,
      strand,
      subStrand,
      term,
      year: parseAcademicYearStart(academicYear),
      academicYear,
      stream,
      structure,
      structureDetail,
      totalPercentage: total,
      outputMode
    };
  };

  fields.session?.addEventListener("change", ensureActivationFlow);
  fields.academicYear?.addEventListener("change", ensureActivationFlow);
  fields.term?.addEventListener("change", () => {
    refreshLearningAreas();
    ensureActivationFlow();
  });
  fields.grade?.addEventListener("change", () => {
    if (String(fields.grade?.value || "").trim() && fields.form) fields.form.value = "";
    refreshLearningAreas();
    refreshStructureFromCurriculum();
    ensureActivationFlow();
  });
  fields.form?.addEventListener("change", () => {
    if (String(fields.form?.value || "").trim() && fields.grade) fields.grade.value = "";
    refreshLearningAreas();
    refreshStructureFromCurriculum();
    ensureActivationFlow();
  });
  fields.learningArea?.addEventListener("change", refreshStructureFromCurriculum);
  fields.strand?.addEventListener("change", () => {
    const selected = String(fields.strand?.value || "");
    const subs = Array.isArray(strandMap[selected]) ? strandMap[selected] : [];
    if (fields.subStrand) {
      fields.subStrand.innerHTML = `<option value="">Select sub-strand</option>${subs
        .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
        .join("")}`;
    }
    ensureActivationFlow();
  });
  fields.subStrand?.addEventListener("change", ensureActivationFlow);
  fields.structure?.addEventListener("change", () => {
    if (fields.structure?.value === "unified" && fields.structureDetail) {
      fields.structureDetail.value = "";
    }
    ensureActivationFlow();
  });
  fields.structureDetail?.addEventListener("change", ensureActivationFlow);
  fields.percentage?.addEventListener("input", ensureActivationFlow);

  controls.generate?.addEventListener("click", async () => {
    const payload = getPayload();
    if (!payload) return;
    try {
      const generated = await request("/api/academic/exams/auto-generate", {
        method: "POST",
        body: JSON.stringify({
          title: payload.title,
          grade: payload.grade || "",
          form_name: payload.formName || "",
          stream: payload.stream,
          subject: payload.learningArea,
          learning_area: payload.learningArea,
          strand: payload.strand,
          sub_strand: payload.subStrand,
          term: payload.term,
          year: payload.year,
          academic_year: payload.academicYear,
          exam_type: payload.session,
          structure: payload.structure,
          structure_detail: payload.structureDetail,
          total_percentage: Number(payload.totalPercentage || 0)
        })
      });
      const serialAllocation = await request("/api/academic/exams/allocate-serials", {
        method: "POST",
        body: JSON.stringify({
          grade: payload.grade,
          form_name: payload.formName,
          stream: payload.stream,
          learning_area: payload.learningArea,
          exam_type: payload.session,
          term: payload.term,
          year: payload.year,
          mode: payload.outputMode === "per_learner" ? "per_learner" : "bulk_class"
        })
      });
      examPanelState.generatedExam = { id: generated?.id, payload };
      examPanelState.serials = Array.isArray(serialAllocation?.serials) ? serialAllocation.serials : [];
      const previewSerial = buildLearnerExamSerial({
        learningArea: payload.learningArea,
        gradeOrForm: payload.grade || payload.formName,
        stream: payload.stream,
        examSession: payload.session,
        learnerSerialNumber: examPanelState.serials?.[0]?.learner_serial_number || 1
      });
      if (fields.generatedText) {
        fields.generatedText.value = [
          `INSTITUTION LETTERHEAD: [Auto loaded per institution]`,
          `Learning Area: ${payload.learningArea}`,
          `Academic Year: ${payload.academicYear} | ${payload.term}`,
          `Exam Session: ${payload.session}`,
          `Coverage: ${payload.strand} -> ${payload.subStrand}`,
          `Exam Structure: ${payload.structure}${payload.structureDetail ? ` (${payload.structureDetail})` : ""}`,
          `Percentage Allocation: ${String(fields.percentage?.value || "")}`,
          `QR Code: [Auto generated on PDF export]`,
          `Distinct Serial Example: ${previewSerial}`,
          "",
          String(generated?.examText || "No exam text returned.").trim()
        ].join("\n");
        fields.generatedText.readOnly = true;
      }
      setEnabled(controls.edit, true);
      setEnabled(controls.save, true);
      renderPerLearnerActions(payload);
      if (controls.preview) {
        controls.preview.innerHTML = `Generated exam ID <strong>${escapeHtml(String(generated?.id || "-"))}</strong>. ${
          examPanelState.serials.length
        } serial record(s) prepared for marks entry.`;
      }
    } catch (error) {
      alert(`${error.message}\nExam generation uses strands/sub-strands with AI even without uploaded notes.`);
    }
  });

  controls.edit?.addEventListener("click", () => {
    if (!fields.generatedText) return;
    fields.generatedText.readOnly = false;
    fields.generatedText.focus();
  });

  controls.save?.addEventListener("click", async () => {
    const examId = Number(examPanelState.generatedExam?.id || 0);
    if (!examId) {
      alert("Generate exam first.");
      return;
    }
    try {
      await request(`/api/academic/exams/${examId}`, {
        method: "PUT",
        body: JSON.stringify({
          generated_exam_text: String(fields.generatedText?.value || "")
        })
      });
      if (fields.generatedText) fields.generatedText.readOnly = true;
      alert("Exam saved successfully.");
    } catch (error) {
      alert(error.message);
    }
  });

  controls.view?.addEventListener("click", async () => {
    try {
      const rows = await request("/api/academic/exams?limit=30");
      const list = Array.isArray(rows) ? rows : [];
      if (controls.preview) {
        controls.preview.innerHTML = list.length
          ? list
            .slice(0, 12)
            .map((row) => `#${row.id} | ${escapeHtml(row.title || "-")} | ${escapeHtml(row.grade || "-")} ${escapeHtml(row.stream || "")}`)
            .join("<br/>")
          : "No generated exams found.";
      }
    } catch (error) {
      alert(error.message);
    }
  });

  controls.download?.addEventListener("click", () => {
    const text = String(fields.generatedText?.value || "").trim();
    if (!text) {
      alert("Generate exam first.");
      return;
    }
    downloadTextFile("generated-exam-paper.txt", text);
  });

  controls.print?.addEventListener("click", () => {
    const text = String(fields.generatedText?.value || "").trim();
    if (!text) {
      alert("Generate exam first.");
      return;
    }
    const popup = window.open("", "_blank");
    if (!popup) return;
    popup.document.write(`<pre>${escapeHtml(text)}</pre>`);
    popup.document.close();
    popup.print();
  });

  controls.serials?.addEventListener("click", () => {
    if (!examPanelState.serials.length) {
      alert("No serials generated yet.");
      return;
    }
    const payload = examPanelState.generatedExam?.payload || {};
    const rows = examPanelState.serials.map((row) => ({
      learner_name: row.learner_name || "-",
      learner_id: row.learner_id || "",
      admission_number: row.admission_number || "",
      grade: row.grade || payload.grade || payload.formName || "",
      stream: row.stream || payload.stream || "",
      serial: buildLearnerExamSerial({
        learningArea: payload.learningArea || "",
        gradeOrForm: payload.grade || payload.formName || "",
        stream: row.stream || payload.stream || "",
        examSession: payload.session || "",
        learnerSerialNumber: row.learner_serial_number || row.learner_id
      })
    }));
    downloadTextFile("exam-serial-number-register.csv", rowsToCsv(rows), "text/csv;charset=utf-8");
  });

  refreshLearningAreas();
  ensureActivationFlow();
}

function renderExamMarksEntryPanel() {
  const { grades, forms } = buildExamGradeFormSelectOptions();
  const { terms, years } = buildExamTermYearOptions();
  const learningAreas = buildExamLearningAreaOptionsBySelection({});
  const sessions = [
    "Head Start",
    "CATS",
    "Midterm",
    "End Term",
    "Joint",
    "Mock",
    "KNEC",
    "Inter-Schools",
    "Inter-County",
    "Other"
  ];
  return `
    <div class="module-header-card">
      <h4>Exam Entry</h4>
      <p>Enter marks manually or through exam serial numbers. Saved marks feed Exam Scripts, Assessment Reports, and Progress Reports.</p>
    </div>
    <div class="form-grid">
      <label>Entry Format</label>
      <select id="marksEntryFormat">
        <option value="">Select entry format</option>
        <option value="manual">Manual</option>
        <option value="serial">Via serial number</option>
      </select>
      <label>Examination Session</label>
      <select id="marksEntrySession" disabled>
        <option value="">Select examination session</option>
        ${sessions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}
      </select>
      <label>Academic Year</label>
      <select id="marksEntryAcademicYear" disabled><option value="">Select academic year</option>${years}</select>
      <label>Term</label>
      <select id="marksEntryTerm" disabled><option value="">Select term</option>${terms}</select>
      <label>Learning Area</label>
      <select id="marksEntryLearningArea" disabled><option value="">Select learning area</option>${learningAreas}</select>
      <label>Grade</label>
      <select id="marksEntryGrade" disabled><option value="">Select grade</option>${grades}</select>
      <label>Form</label>
      <select id="marksEntryForm" disabled><option value="">Select form</option>${forms}</select>
      <label>Stream</label>
      <input id="marksEntryStream" placeholder="Stream where necessary" disabled />
      <label>Serial Entry Scope</label>
      <select id="marksEntrySerialScope" disabled>
        <option value="per_learner">Per learner</option>
        <option value="per_class">Per class</option>
        <option value="per_stream">Per stream</option>
      </select>
      <label>Exam Serial Number</label>
      <input id="marksEntrySerial" placeholder="e.g. 01/9/B/MT/001" disabled />
    </div>
    <div class="ax-toolbar">
      <button class="ax-btn ax-btn--refresh" id="marksEntryLoadLearnersButton" title="Load learners" disabled>Load Learners</button>
      <button class="ax-btn ax-btn--save" id="marksEntrySaveButton" title="Save marks" disabled>Save</button>
      <button class="ax-btn ax-btn--edit" id="marksEntryEditButton" title="Edit marks (HOI/Admin only)">Edit</button>
      <button class="ax-btn ax-btn--delete" id="marksEntryDeleteButton" title="Delete marks (HOI/Admin only)">Delete</button>
      <button class="ax-btn ax-btn--view" id="marksEntryViewButton" title="View marks">View</button>
      <button class="ax-btn ax-btn--export-excel" id="marksEntryDownloadExcelButton" title="Download marks">Excel</button>
      <button class="ax-btn ax-btn--print" id="marksEntryPrintButton" title="Print">Print</button>
    </div>
    <div id="marksEntryOutput" class="small-note">Select entry format first to activate marks entry.</div>
    <div id="marksEntryManualGrid" class="dashboard-section"></div>
  `;
}

function wireExamMarksEntryPanel() {
  const output = document.getElementById("marksEntryOutput");
  const formatEl = document.getElementById("marksEntryFormat");
  const sessionEl = document.getElementById("marksEntrySession");
  const yearEl = document.getElementById("marksEntryAcademicYear");
  const termEl = document.getElementById("marksEntryTerm");
  const serialScopeEl = document.getElementById("marksEntrySerialScope");
  const serialEl = document.getElementById("marksEntrySerial");
  const gradeEl = document.getElementById("marksEntryGrade");
  const formEl = document.getElementById("marksEntryForm");
  const streamEl = document.getElementById("marksEntryStream");
  const learningAreaEl = document.getElementById("marksEntryLearningArea");
  const saveBtn = document.getElementById("marksEntrySaveButton");
  const loadBtn = document.getElementById("marksEntryLoadLearnersButton");
  const manualGrid = document.getElementById("marksEntryManualGrid");
  const actorRole = normalizeRoleKey(portalContext?.role || "");
  const canModify = ["ADMIN", "HEAD_OF_INSTITUTION"].includes(actorRole);

  const learnerMap = new Map();
  const markDrafts = new Map();

  const setEnabled = (node, enabled) => {
    if (!node) return;
    node.disabled = !enabled;
  };
  const refreshLearningAreas = () => {
    if (!learningAreaEl) return;
    const selected = String(learningAreaEl.value || "");
    learningAreaEl.innerHTML = `<option value="">Select learning area</option>${buildExamLearningAreaOptionsBySelection({
      grade: gradeEl?.value || "",
      form: formEl?.value || ""
    })}`;
    if (selected && Array.from(learningAreaEl.options).some((option) => option.value === selected)) {
      learningAreaEl.value = selected;
    }
  };

  const applyActivation = () => {
    const mode = String(formatEl?.value || "");
    setEnabled(sessionEl, Boolean(mode));
    setEnabled(yearEl, Boolean(sessionEl?.value));
    setEnabled(termEl, Boolean(yearEl?.value));
    setEnabled(learningAreaEl, Boolean(termEl?.value));
    setEnabled(gradeEl, Boolean(learningAreaEl?.value && !formEl?.value));
    setEnabled(formEl, Boolean(learningAreaEl?.value && !gradeEl?.value));
    setEnabled(streamEl, Boolean((gradeEl?.value || formEl?.value) && learningAreaEl?.value));
    setEnabled(serialScopeEl, mode === "serial" && Boolean(streamEl?.value || gradeEl?.value || formEl?.value));
    setEnabled(serialEl, mode === "serial" && Boolean(serialScopeEl?.value));
    const ready = Boolean(sessionEl?.value && yearEl?.value && termEl?.value && learningAreaEl?.value && (gradeEl?.value || formEl?.value));
    setEnabled(loadBtn, ready);
    setEnabled(saveBtn, ready);
    if (mode !== "serial" && serialEl) {
      serialEl.value = "";
    }
  };

  const renderManualGrid = (rows = []) => {
    if (!manualGrid) return;
    if (!rows.length) {
      manualGrid.innerHTML = `<p class="small-note">No learners found for selected criteria.</p>`;
      return;
    }
    manualGrid.innerHTML = `
      <div class="dashboard-table-wrap">
        <table class="dashboard-table">
          <thead>
            <tr>
              <th>Learner</th>
              <th>Serial</th>
              <th>Grade/Form</th>
              <th>Stream</th>
              <th>Learning Area</th>
              <th>Marks (or X)</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              const rowId = String(row.id || "");
              const draft = markDrafts.get(rowId) || "";
              return `
                <tr>
                  <td>${escapeHtml(row.full_name || "-")}</td>
                  <td>${escapeHtml(String(row.learner_serial_number || row.id || "-"))}</td>
                  <td>${escapeHtml(row.grade || row.form_name || "-")}</td>
                  <td>${escapeHtml(row.stream || "-")}</td>
                  <td>${escapeHtml(String(learningAreaEl?.value || "-"))}</td>
                  <td><input class="marks-entry-score-input" data-learner-id="${escapeHtmlAttribute(rowId)}" value="${escapeHtmlAttribute(String(draft))}" placeholder="e.g. 78 or X" /></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
    manualGrid.querySelectorAll(".marks-entry-score-input").forEach((input) => {
      input.addEventListener("input", () => {
        const learnerId = String(input.getAttribute("data-learner-id") || "");
        markDrafts.set(learnerId, String(input.value || "").trim());
      });
    });
  };

  const loadLearners = async () => {
    const grade = String(gradeEl?.value || "");
    const formName = String(formEl?.value || "");
    const stream = String(streamEl?.value || "");
    const searchTokens = [grade, formName, stream].filter(Boolean).join(" ");
    try {
      const rows = await request(`/api/admission/learners?limit=500&search=${encodeURIComponent(searchTokens)}`);
      const list = (Array.isArray(rows) ? rows : []).filter((row) => {
        if (grade && String(row.grade || "") !== grade) return false;
        if (formName && String(row.form_name || "") !== formName) return false;
        if (stream && String(row.stream || "").toLowerCase() !== stream.toLowerCase()) return false;
        return true;
      });
      learnerMap.clear();
      list.forEach((row) => learnerMap.set(String(row.id || ""), row));
      if (String(formatEl?.value || "") === "serial" && serialEl?.value) {
        const serialValue = String(serialEl.value || "").trim();
        const serialNumberPart = serialValue.split("/").pop() || "";
        const targetSerial = Number(String(serialNumberPart).replace(/\D/g, ""));
        const matched = list.find((row) =>
          Number(row.learner_serial_number || row.id || 0) === targetSerial
        );
        if (matched) {
          learnerMap.clear();
          learnerMap.set(String(matched.id || ""), matched);
          renderManualGrid([matched]);
          if (output) output.textContent = `Serial ${serialValue} matched learner ${matched.full_name || "-"}.`;
          return;
        }
      }
      renderManualGrid(list);
      if (output) output.textContent = `Loaded ${list.length} learner(s). Enter marks then press Save.`;
    } catch (error) {
      if (output) output.textContent = `Failed loading learners: ${error.message}`;
    }
  };

  const sessionAndExamType = () => String(sessionEl?.value || "");

  loadBtn?.addEventListener("click", loadLearners);

  saveBtn?.addEventListener("click", async () => {
    const rows = Array.from(learnerMap.values());
    if (!rows.length) {
      alert("Load learners first.");
      return;
    }
    const learningArea = String(learningAreaEl?.value || "");
    const term = String(termEl?.value || "");
    const year = parseAcademicYearStart(String(yearEl?.value || ""));
    const examType = sessionAndExamType();
    const stream = String(streamEl?.value || "");
    const grade = String(gradeEl?.value || "");
    const formName = String(formEl?.value || "");
    const toSave = rows
      .map((row) => {
        const raw = String(markDrafts.get(String(row.id || "")) || "").trim().toUpperCase();
        if (!raw) return null;
        if (raw === "X") {
          return {
            learner_id: Number(row.id),
            learner_name: row.full_name || "",
            upi_number: row.upi_number || "",
            assessment_number: row.assessment_number || "",
            birth_certificate_number: row.birth_certificate_number || "",
            grade: row.grade || grade || formName || "",
            stream: row.stream || stream || "",
            exam_type: examType,
            subject: learningArea,
            marks: 0,
            percentage: 0,
            cbc_grade_band: "ABSENT",
            term,
            year
          };
        }
        const score = Number(raw);
        if (!Number.isFinite(score)) return null;
        return {
          learner_id: Number(row.id),
          learner_name: row.full_name || "",
          upi_number: row.upi_number || "",
          assessment_number: row.assessment_number || "",
          birth_certificate_number: row.birth_certificate_number || "",
          grade: row.grade || grade || formName || "",
          stream: row.stream || stream || "",
          exam_type: examType,
          subject: learningArea,
          marks: score,
          percentage: score,
          cbc_grade_band: cbcBandFromScore(score),
          term,
          year
        };
      })
      .filter(Boolean);
    if (!toSave.length) {
      alert("Enter at least one mark value (number or X).");
      return;
    }
    try {
      for (const entry of toSave) {
        await request("/api/academic/marks", {
          method: "POST",
          body: JSON.stringify(entry)
        });
      }
      if (output) {
        output.textContent = `Saved ${toSave.length} marks record(s).`;
      }
      markDrafts.clear();
      await loadLearners();
    } catch (error) {
      alert(error.message);
    }
  });

  gradeEl?.addEventListener("change", () => {
    if (String(gradeEl.value || "").trim() && formEl) formEl.value = "";
    refreshLearningAreas();
    applyActivation();
  });
  formEl?.addEventListener("change", () => {
    if (String(formEl.value || "").trim() && gradeEl) gradeEl.value = "";
    refreshLearningAreas();
    applyActivation();
  });
  [formatEl, sessionEl, yearEl, termEl, learningAreaEl, streamEl, serialScopeEl, serialEl].forEach((node) => {
    node?.addEventListener("change", applyActivation);
    node?.addEventListener("input", applyActivation);
  });

  document.getElementById("marksEntryViewButton")?.addEventListener("click", async () => {
    try {
      const search = [
        String(learningAreaEl?.value || ""),
        String(gradeEl?.value || formEl?.value || ""),
        String(streamEl?.value || ""),
        String(sessionEl?.value || "")
      ].filter(Boolean).join(" ");
      const rows = await request(`/api/academic/marks?limit=300&search=${encodeURIComponent(search)}`);
      const list = Array.isArray(rows) ? rows : [];
      examPanelState.marksRows = list.sort((a, b) => Number(b.marks || 0) - Number(a.marks || 0));
      if (output) {
        output.innerHTML = examPanelState.marksRows.length
          ? examPanelState.marksRows.slice(0, 30).map((row, index) =>
            `${index + 1}. ${escapeHtml(row.learner_name || "-")} | ${escapeHtml(row.subject || "-")} | ${escapeHtml(String(row.marks || "0"))}`
          ).join("<br/>")
          : "No marks available for selected filters.";
      }
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("marksEntryEditButton")?.addEventListener("click", async () => {
    if (!canModify) {
      alert("Only HOI/Administrator can edit saved marks.");
      return;
    }
    const targetId = Number(prompt("Enter marks record ID to edit:", "") || 0);
    if (!targetId) return;
    const nextMarks = Number(prompt("Enter new marks:", "0") || 0);
    try {
      await request(`/api/academic/marks/${targetId}`, {
        method: "PUT",
        body: JSON.stringify({
          marks: nextMarks,
          percentage: nextMarks,
          cbc_grade_band: cbcBandFromScore(nextMarks)
        })
      });
      if (output) output.textContent = `Marks record ${targetId} updated.`;
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("marksEntryDeleteButton")?.addEventListener("click", async () => {
    if (!canModify) {
      alert("Only HOI/Administrator can delete saved marks.");
      return;
    }
    const targetId = Number(prompt("Enter marks record ID to delete:", "") || 0);
    if (!targetId) return;
    if (!window.confirm(`Delete marks record #${targetId}?`)) return;
    try {
      await request(`/api/academic/marks/${targetId}`, { method: "DELETE" });
      if (output) output.textContent = `Marks record ${targetId} deleted.`;
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("marksEntryDownloadExcelButton")?.addEventListener("click", () => {
    if (!examPanelState.marksRows.length) {
      alert("View marks first.");
      return;
    }
    downloadTextFile("marks-entry-report.csv", rowsToCsv(examPanelState.marksRows), "text/csv;charset=utf-8");
  });

  document.getElementById("marksEntryPrintButton")?.addEventListener("click", () => {
    if (!examPanelState.marksRows.length) {
      alert("View marks first.");
      return;
    }
    const popup = window.open("", "_blank");
    if (!popup) return;
    popup.document.write(`<pre>${escapeHtml(JSON.stringify(examPanelState.marksRows, null, 2))}</pre>`);
    popup.document.close();
    popup.print();
  });

  refreshLearningAreas();
  applyActivation();
}

function renderExamResultScriptsPanel() {
  const { grades, forms } = buildExamGradeFormSelectOptions();
  const { terms, years } = buildExamTermYearOptions();
  const learningAreas = buildExamLearningAreaOptionsBySelection({});
  return `
    <div class="module-header-card">
      <h4>Exam Scripts</h4>
      <p>Generate result scripts per learner, stream, grade, full list, or learning area. Learner serial numbers remain constant across grades.</p>
    </div>
    <div class="form-grid">
      <label>Scope</label>
      <select id="resultScope">
        <option value="learner">Per learner</option>
        <option value="stream">Per Stream</option>
        <option value="grade">Per Grade</option>
        <option value="full">Full list</option>
        <option value="learning-area">Per Learning Area</option>
      </select>
      <label>Grade</label>
      <select id="resultGrade"><option value="">Select grade</option>${grades}</select>
      <label>Form</label>
      <select id="resultForm"><option value="">Select form</option>${forms}</select>
      <label>Stream</label>
      <input id="resultStream" placeholder="Stream (when applicable)" />
      <label>Learning Area</label>
      <select id="resultLearningArea"><option value="">Select learning area</option>${learningAreas}</select>
      <label>Learner Search</label>
      <input id="resultLearnerKey" placeholder="Learner name" />
      <label>Term</label>
      <select id="resultTerm"><option value="">Select term</option>${terms}</select>
      <label>Academic Year</label>
      <select id="resultYear"><option value="">Select academic year</option>${years}</select>
    </div>
    <div class="ax-toolbar">
      <button class="ax-btn ax-btn--generate" id="resultGenerateButton" title="Generate result script">Generate</button>
      <button class="ax-btn ax-btn--view" id="resultViewButton" title="View generated scripts">View</button>
      <button class="ax-btn ax-btn--print" id="resultPrintButton" title="Print">Print</button>
      <button class="ax-btn ax-btn--export-pdf" id="resultDownloadPdfButton" title="Download PDF">PDF</button>
      <button class="ax-btn ax-btn--export-excel" id="resultDownloadExcelButton" title="Download Excel">Excel</button>
      <button class="ax-btn ax-btn--download" id="resultDownloadTemplateButton" title="Download template">Template</button>
      <button class="ax-btn ax-btn--upload" id="resultUploadTemplateButton" title="Upload modified template">Upload Template</button>
      <input id="resultUploadInput" type="file" accept=".xlsx,.csv" style="display:none;" data-template-control="true" />
    </div>
    <div id="resultScriptsOutput" class="small-note">Generate ranked results to view scripts.</div>
  `;
}

function wireExamResultScriptsPanel() {
  const output = document.getElementById("resultScriptsOutput");
  const applyScopeFilter = (rows) => {
    const scope = String(document.getElementById("resultScope")?.value || "learner");
    const grade = String(document.getElementById("resultGrade")?.value || "");
    const form = String(document.getElementById("resultForm")?.value || "");
    const stream = String(document.getElementById("resultStream")?.value || "");
    const learningArea = String(document.getElementById("resultLearningArea")?.value || "");
    const learnerKey = String(document.getElementById("resultLearnerKey")?.value || "").toLowerCase();
    const targetGrade = grade || form;
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      if (targetGrade && String(row.grade || "").toLowerCase() !== targetGrade.toLowerCase()) return false;
      if (stream && String(row.stream || "").toLowerCase() !== stream.toLowerCase()) return false;
      if (learningArea && String(row.subject || "").toLowerCase() !== learningArea.toLowerCase()) return false;
      if (scope === "learner" && learnerKey) {
        return String(row.learner_name || "").toLowerCase().includes(learnerKey)
          || String(row.learner_id || "").toLowerCase().includes(learnerKey);
      }
      if (scope === "stream") {
        return Boolean(stream);
      }
      if (scope === "grade") {
        return Boolean(targetGrade);
      }
      if (scope === "learning-area") {
        return Boolean(learningArea);
      }
      return true;
    });
  };

  document.getElementById("resultGenerateButton")?.addEventListener("click", async () => {
    const grade = String(document.getElementById("resultGrade")?.value || "");
    const form = String(document.getElementById("resultForm")?.value || "");
    const stream = String(document.getElementById("resultStream")?.value || "");
    const term = String(document.getElementById("resultTerm")?.value || "");
    const year = parseAcademicYearStart(String(document.getElementById("resultYear")?.value || ""));
    const params = new URLSearchParams();
    if (grade || form) params.set("grade", grade || form);
    if (stream) params.set("stream", stream);
    if (term) params.set("term", term);
    if (year) params.set("year", String(year));
    try {
      const result = await request(`/api/academic/results/ranked?${params.toString()}`);
      const ranked = applyScopeFilter(result?.ranked || []);
      examPanelState.resultRows = ranked;
      if (output) {
        output.innerHTML = ranked.length
          ? ranked.slice(0, 40).map((row) => {
            const learnerSerial = String(row.learner_serial_number || row.learner_id || "").padStart(3, "0");
            return `${row.position}. ${escapeHtml(row.learner_name || "-")} | ${escapeHtml(row.grade || "-")} ${
              escapeHtml(row.stream || "-")
            } | Avg ${escapeHtml(String(row.avg_pct || "0"))}% | Serial ${escapeHtml(learnerSerial)}`;
          }).join("<br/>")
          : "No ranked results found for selected filters.";
      }
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("resultViewButton")?.addEventListener("click", () => {
    if (!examPanelState.resultRows.length) {
      alert("Generate result scripts first.");
      return;
    }
    if (output) {
      output.innerHTML = examPanelState.resultRows.slice(0, 30).map((row) =>
        `${row.position}. ${escapeHtml(row.learner_name || "-")} | Total ${escapeHtml(String(row.total_marks || "0"))} | Avg ${escapeHtml(String(row.avg_pct || "0"))}%`
      ).join("<br/>");
    }
  });

  document.getElementById("resultPrintButton")?.addEventListener("click", () => {
    if (!examPanelState.resultRows.length) {
      alert("Generate result scripts first.");
      return;
    }
    const popup = window.open("", "_blank");
    popup.document.write(`<pre>${escapeHtml(examPanelState.resultRows.map((row) =>
      `${row.position}. ${row.learner_name || "-"} | ${row.grade || "-"} ${row.stream || "-"} | ${row.avg_pct || 0}%`
    ).join("\n"))}</pre>`);
    popup.document.close();
    popup.print();
  });

  document.getElementById("resultDownloadPdfButton")?.addEventListener("click", () => {
    if (!examPanelState.resultRows.length) {
      alert("Generate result scripts first.");
      return;
    }
    downloadTextFile("result-script.txt", examPanelState.resultRows.map((row) =>
      `${row.position}. ${row.learner_name || "-"} | ${row.grade || "-"} ${row.stream || "-"} | ${row.avg_pct || 0}%`
    ).join("\n"));
  });

  document.getElementById("resultDownloadExcelButton")?.addEventListener("click", () => {
    if (!examPanelState.resultRows.length) {
      alert("Generate result scripts first.");
      return;
    }
    downloadTextFile("result-scripts.csv", rowsToCsv(examPanelState.resultRows), "text/csv;charset=utf-8");
  });

  document.getElementById("resultDownloadTemplateButton")?.addEventListener("click", () => {
    const templateRows = [
      {
        learner_name: "Sample learner",
        learner_serial_number: "001",
        grade: "Grade 7",
        stream: "Blue",
        learning_area: "Mathematics",
        total_marks: 420,
        average_percentage: 84,
        position: 1
      }
    ];
    downloadTextFile("result-script-template.csv", rowsToCsv(templateRows), "text/csv;charset=utf-8");
  });
  document.getElementById("resultUploadTemplateButton")?.addEventListener("click", () => {
    document.getElementById("resultUploadInput")?.click();
  });
  document.getElementById("resultUploadInput")?.addEventListener("change", (event) => {
    const file = event?.target?.files?.[0];
    if (file && output) {
      output.innerHTML = `Modified result script template received: ${escapeHtml(file.name)}.`;
    }
  });
}

function renderExamAssessmentReportPanel() {
  const { grades, forms } = buildExamGradeFormSelectOptions();
  const { years } = buildExamTermYearOptions();
  const examTypes = ["Head Start", "CATS", "Midterm", "End Term", "Joint", "Mock", "KNEC", "Inter-Schools", "Inter-County", "Other"];
  return `
    <div class="module-header-card">
      <h4>Assessment Report</h4>
      <p>Download learner assessment reports based on selected exam types. Use CBC template download/upload workflow.</p>
    </div>
    <div class="form-grid">
      <label>Exam Types (comma separated)</label>
      <input id="assessExamTypes" placeholder="${examTypes.join(", ")}" />
      <label>Select Learner By</label>
      <select id="assessLearnerMode">
        <option value="name">By name</option>
        <option value="grade">Per grade</option>
        <option value="stream">Per stream</option>
        <option value="class">Per class</option>
      </select>
      <label>Learner Search</label>
      <input id="assessLearnerKey" placeholder="Learner name / admission / UPI" />
      <label>Grade</label>
      <select id="assessGrade"><option value="">Select grade</option>${grades}</select>
      <label>Form</label>
      <select id="assessForm"><option value="">Select form</option>${forms}</select>
      <label>Stream</label>
      <input id="assessStream" placeholder="Stream (when applicable)" />
      <label>Academic Year</label>
      <select id="assessYear"><option value="">Select academic year</option>${years}</select>
    </div>
    <div class="ax-toolbar">
      <button class="ax-btn ax-btn--view" id="assessLoadLearnersButton" title="Load matching learners">Load Learners</button>
      <button class="ax-btn ax-btn--generate" id="assessGenerateButton" title="Generate selected learner report">Generate</button>
      <button class="ax-btn ax-btn--download" id="assessDownloadTemplateButton" title="Download CBC assessment template">Template</button>
      <button class="ax-btn ax-btn--upload" id="assessUploadTemplateButton" title="Upload modified template">Upload Template</button>
      <input id="assessUploadInput" type="file" accept=".xlsx,.csv,.pdf,.docx" style="display:none;" data-template-control="true" />
    </div>
    <div id="assessmentOutput" class="small-note">Load learners then use row actions (view, print, download).</div>
    <div id="assessmentLearnerList" class="dashboard-section"></div>
  `;
}

function wireExamAssessmentReportPanel() {
  const output = document.getElementById("assessmentOutput");
  const learnerListEl = document.getElementById("assessmentLearnerList");
  const learnerMap = new Map();
  const gradeEl = document.getElementById("assessGrade");
  const formEl = document.getElementById("assessForm");
  const streamEl = document.getElementById("assessStream");
  const learnerKeyEl = document.getElementById("assessLearnerKey");
  const modeEl = document.getElementById("assessLearnerMode");
  const examTypesEl = document.getElementById("assessExamTypes");
  const yearEl = document.getElementById("assessYear");
  const selectedLearners = [];

  const renderLearnerRows = (rows = []) => {
    if (!learnerListEl) return;
    if (!rows.length) {
      learnerListEl.innerHTML = `<p class="small-note">No learners found for selected filters.</p>`;
      return;
    }
    learnerListEl.innerHTML = `
      <div class="dashboard-table-wrap">
        <table class="dashboard-table">
          <thead>
            <tr><th>Learner</th><th>Admission</th><th>Grade</th><th>Stream</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.full_name || "-")}</td>
                <td>${escapeHtml(row.admission_number || row.upi_number || "-")}</td>
                <td>${escapeHtml(row.grade || row.form_name || "-")}</td>
                <td>${escapeHtml(row.stream || "-")}</td>
                <td>
                  <button class="ax-btn ax-btn--view ax-btn--sm assess-view" data-learner-id="${Number(row.id || 0)}">View</button>
                  <button class="ax-btn ax-btn--print ax-btn--sm assess-print" data-learner-id="${Number(row.id || 0)}">Print</button>
                  <button class="ax-btn ax-btn--download ax-btn--sm assess-download" data-learner-id="${Number(row.id || 0)}">Download</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    learnerListEl.querySelectorAll(".assess-view,.assess-print,.assess-download").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const learnerId = Number(btn.getAttribute("data-learner-id") || 0);
        if (!learnerId) return;
        try {
          const report = await request(`/api/academic/assessment-report/${learnerId}`);
          examPanelState.assessmentReport = report;
          const selectedExamTypes = String(examTypesEl?.value || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => item.toLowerCase());
          const year = parseAcademicYearStart(String(yearEl?.value || ""));
          const marks = (Array.isArray(report?.marks) ? report.marks : []).filter((mark) => {
            if (selectedExamTypes.length && !selectedExamTypes.includes(String(mark.exam_type || "").toLowerCase())) return false;
            if (year && Number(mark.year || 0) !== year) return false;
            return true;
          });
          const payload = {
            learner: report?.learner || {},
            institution: report?.institution || {},
            marks,
            performance_trend: report?.performance_trend || []
          };
          const lines = [
            `Learner: ${payload.learner.full_name || "-"}`,
            `Admission: ${payload.learner.admission_number || "-"}`,
            `Class: ${payload.learner.grade || payload.learner.form_name || "-"} ${payload.learner.stream || ""}`,
            `Exam types: ${selectedExamTypes.length ? selectedExamTypes.join(", ") : "All uploaded exams"}`,
            ""
          ].concat(marks.map((mark) =>
            `${mark.exam_type || "-"} | ${mark.subject || "-"} | ${mark.marks || 0} | ${mark.term || "-"} ${mark.year || ""}`
          ));
          if (output) output.innerHTML = lines.map((line) => escapeHtml(line)).join("<br/>");
          if (btn.classList.contains("assess-print")) {
            const popup = window.open("", "_blank");
            if (!popup) return;
            popup.document.write(`<pre>${escapeHtml(lines.join("\n"))}</pre>`);
            popup.document.close();
            popup.print();
          }
          if (btn.classList.contains("assess-download")) {
            downloadTextFile(
              `assessment-report-${learnerId}.json`,
              JSON.stringify(payload, null, 2),
              "application/json;charset=utf-8"
            );
          }
        } catch (error) {
          alert(error.message);
        }
      });
    });
  };

  const loadLearners = async () => {
    const search = String(learnerKeyEl?.value || "").trim();
    const grade = String(gradeEl?.value || "");
    const form = String(formEl?.value || "");
    const stream = String(streamEl?.value || "");
    const mode = String(modeEl?.value || "name");
    const searchTokens = [search, grade || form, stream].filter(Boolean).join(" ");
    try {
      const rows = await request(`/api/admission/learners?limit=500&search=${encodeURIComponent(searchTokens)}`);
      const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
        if (grade && String(row.grade || "") !== grade) return false;
        if (form && String(row.form_name || "") !== form) return false;
        if (stream && String(row.stream || "").toLowerCase() !== stream.toLowerCase()) return false;
        if (mode === "name" && search && !String(row.full_name || "").toLowerCase().includes(search.toLowerCase())) return false;
        if (mode === "stream" && stream && String(row.stream || "").toLowerCase() !== stream.toLowerCase()) return false;
        if (mode === "grade" && grade && String(row.grade || "").toLowerCase() !== grade.toLowerCase()) return false;
        return true;
      });
      learnerMap.clear();
      selectedLearners.splice(0, selectedLearners.length, ...filtered);
      filtered.forEach((row) => learnerMap.set(String(row.id), row));
      renderLearnerRows(filtered);
      if (output) output.textContent = `Loaded ${filtered.length} learner(s) for assessment reports.`;
    } catch (error) {
      if (output) output.textContent = `Failed to load learners: ${error.message}`;
    }
  };

  document.getElementById("assessLoadLearnersButton")?.addEventListener("click", loadLearners);
  learnerKeyEl?.addEventListener("change", loadLearners);
  gradeEl?.addEventListener("change", () => {
    if (String(gradeEl.value || "").trim() && formEl) formEl.value = "";
    loadLearners();
  });
  formEl?.addEventListener("change", () => {
    if (String(formEl.value || "").trim() && gradeEl) gradeEl.value = "";
    loadLearners();
  });
  streamEl?.addEventListener("change", loadLearners);
  document.getElementById("assessGenerateButton")?.addEventListener("click", async () => {
    if (!selectedLearners.length) {
      await loadLearners();
    }
    if (!selectedLearners.length) {
      alert("No learner selected.");
      return;
    }
    renderLearnerRows(selectedLearners);
    if (output) output.textContent = "Use row icons to view, print or download learner assessment reports.";
  });

  document.getElementById("assessDownloadTemplateButton")?.addEventListener("click", () => {
    const sample = [
      {
        learner_name: "Sample learner",
        admission_number: "001",
        grade: "Grade 7",
        stream: "Blue",
        exam_type: "Midterm",
        subject: "Mathematics",
        marks: 78,
        remarks: "Meeting expectation"
      }
    ];
    downloadTextFile("cbc-assessment-template.csv", rowsToCsv(sample), "text/csv;charset=utf-8");
  });
  document.getElementById("assessUploadTemplateButton")?.addEventListener("click", () => {
    document.getElementById("assessUploadInput")?.click();
  });
  document.getElementById("assessUploadInput")?.addEventListener("change", (event) => {
    const file = event?.target?.files?.[0];
    if (file && output) {
      output.textContent = `Assessment template uploaded: ${file.name}. This template will be used with institution letterhead context.`;
    }
  });
  loadLearners();
}

function renderExamLearnerPerformancePanel() {
  const { grades, forms } = buildExamGradeFormSelectOptions();
  return `
    <div class="module-header-card">
      <h4>Progress Reports Sub-Module</h4>
      <p>Search one learner and view full performance history grouped by grade, term, and exam session.</p>
    </div>
    <div class="form-grid">
      <label>Search Learner (Name / Adm / UPI)</label>
      <input id="perfLearnerSearch" placeholder="Type learner name or admission number" />
      <label>Grade</label>
      <select id="perfGrade">
        <option value="">Select grade</option>${grades}
      </select>
      <label>Form</label>
      <select id="perfForm">
        <option value="">Select form</option>${forms}
      </select>
      <label>Stream</label>
      <input id="perfStream" placeholder="Stream (optional)" />
      <label>Matched Learner</label>
      <select id="perfLearnerSelect"><option value="">Select learner</option></select>
    </div>
    <div class="ax-toolbar">
      <button class="ax-btn ax-btn--view" id="perfLoadButton" title="Load performance record">Load</button>
      <button class="ax-btn ax-btn--print" id="perfPrintButton" title="Print learner performance">Print</button>
      <button class="ax-btn ax-btn--export-pdf" id="perfDownloadButton" title="Download learner performance">Download</button>
    </div>
    <div id="perfOutput" class="small-note">Select a learner to load the record.</div>
  `;
}

function wireExamLearnerPerformancePanel() {
  const output = document.getElementById("perfOutput");
  const learnerSelect = document.getElementById("perfLearnerSelect");
  const learnerSearch = document.getElementById("perfLearnerSearch");
  const gradeEl = document.getElementById("perfGrade");
  const formEl = document.getElementById("perfForm");
  const streamEl = document.getElementById("perfStream");
  const learnerMap = new Map();
  const loadLearners = async () => {
    const searchTokens = [
      String(learnerSearch?.value || "").trim(),
      String(gradeEl?.value || "").trim(),
      String(formEl?.value || "").trim(),
      String(streamEl?.value || "").trim()
    ]
      .filter(Boolean)
      .join(" ");
    try {
      const rows = await request(`/api/admission/learners?limit=500&search=${encodeURIComponent(searchTokens)}`);
      const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
        if (gradeEl?.value && String(row.grade || "") !== String(gradeEl.value || "")) return false;
        if (formEl?.value && String(row.form_name || "") !== String(formEl.value || "")) return false;
        if (streamEl?.value && String(row.stream || "").toLowerCase() !== String(streamEl.value || "").toLowerCase()) return false;
        return true;
      });
      learnerMap.clear();
      learnerSelect.innerHTML = `<option value="">Select learner</option>${filtered
        .map((row) => {
          const id = String(row.id || "");
          learnerMap.set(id, row);
          const learnerCode = formatLearnerCode(row.learner_serial_number || row.id) || "-";
          return `<option value="${escapeHtml(id)}">${escapeHtml(row.full_name || "-")} (${escapeHtml(
            row.admission_number || row.upi_number || id
          )}) • ${escapeHtml(learnerCode)}</option>`;
        })
        .join("")}`;
      if (output) output.textContent = `Loaded ${filtered.length} learner(s).`;
    } catch (error) {
      if (output) output.textContent = `Failed loading learners: ${error.message}`;
    }
  };
  learnerSearch?.addEventListener("change", loadLearners);
  gradeEl?.addEventListener("change", () => {
    if (gradeEl?.value && formEl) formEl.value = "";
    loadLearners();
  });
  formEl?.addEventListener("change", () => {
    if (formEl?.value && gradeEl) gradeEl.value = "";
    loadLearners();
  });
  streamEl?.addEventListener("change", loadLearners);
  loadLearners();

  const renderPerformance = (report) => {
    const learner = report?.learner || {};
    const marks = Array.isArray(report?.marks) ? report.marks : [];
    const trend = Array.isArray(report?.performance_trend) ? report.performance_trend : [];
    const byTerm = marks.reduce((acc, row) => {
      const key = `${row.year || "Year"} ${row.term || "Term"} ${row.exam_type || "Exam"}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
    const sections = Object.entries(byTerm).map(([term, rows]) => {
      const lines = rows
        .map((row) => `• ${row.subject || "-"}: ${row.marks ?? "-"} (${row.percentage ?? "-"}%)`)
        .join("<br/>");
      return `<div><strong>${escapeHtml(term)}</strong><br/>${lines}</div>`;
    });
    return [
      `<strong>Learner:</strong> ${escapeHtml(learner.full_name || "-")} (${escapeHtml(learner.admission_number || "-")})`,
      `<strong>Current Class:</strong> ${escapeHtml(learner.grade || learner.form_name || "-")} ${escapeHtml(learner.stream || "")}`,
      `<strong>Records:</strong> ${escapeHtml(String(marks.length))}`,
      `<strong>Trend Points:</strong> ${escapeHtml(String(trend.length))}`,
      sections.join("<hr/>")
    ].join("<br/>");
  };

  let currentReport = null;
  document.getElementById("perfLoadButton")?.addEventListener("click", async () => {
    const learnerId = Number(learnerSelect?.value || 0);
    if (!learnerId) {
      alert("Select learner first.");
      return;
    }
    try {
      const report = await request(`/api/academic/assessment-report/${learnerId}`);
      currentReport = report;
      if (output) output.innerHTML = renderPerformance(report);
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("perfPrintButton")?.addEventListener("click", () => {
    if (!currentReport) {
      alert("Load a learner record first.");
      return;
    }
    const popup = window.open("", "_blank");
    popup.document.write(`<pre>${escapeHtml(JSON.stringify(currentReport, null, 2))}</pre>`);
    popup.document.close();
    popup.print();
  });
  document.getElementById("perfDownloadButton")?.addEventListener("click", () => {
    if (!currentReport) {
      alert("Load a learner record first.");
      return;
    }
    downloadTextFile("learner-performance-record.json", JSON.stringify(currentReport, null, 2), "application/json;charset=utf-8");
  });
}

function normalizeExamTabKey(tab = "") {
  const value = String(tab || "").trim().toLowerCase();
  const aliases = {
    "marks-entry": "exam-entry",
    "result-scripts": "exam-scripts",
    "assessment-report": "assessment-reports",
    "learner-performance": "progress-reports",
    "grade-book": "gradebook",
    "assessment-tracker": "assessment-tracking",
    "portal": "portal-insights",
    "compliance-reporting": "compliance",
    "academic-lifecycle": "lifecycle",
    "copilot": "ai-copilot",
    "ai-assistant": "ai-copilot"
  };
  return aliases[value] || value || "curriculum";
}

function examTemplatePresetContent(templateKey = "exam-paper") {
  const presets = {
    "exam-paper": [
      "Institution: {{INSTITUTION_NAME}}",
      "Learning Area: {{LEARNING_AREA}}",
      "Level: {{GRADE_OR_FORM}}",
      "Exam Session: {{EXAM_SESSION}}",
      "Structure: {{STRUCTURE}}",
      "Serial: {{SERIAL}}",
      "",
      "Section A",
      "1. ...",
      "2. ...",
      "",
      "Section B",
      "3. ...",
      "4. ..."
    ],
    "mark-sheet": [
      "Learner Name,Admission Number,Learning Area,Exam Session,Marks,Percentage,Band,Remarks"
    ],
    "assessment-report": [
      "Learner Name: {{LEARNER_NAME}}",
      "Admission Number: {{ADMISSION_NUMBER}}",
      "Grade/Form: {{GRADE_OR_FORM}}",
      "Stream: {{STREAM}}",
      "",
      "Assessment Summary",
      "- Learning Area: {{LEARNING_AREA}}",
      "- Mean Score: {{MEAN_SCORE}}",
      "- Competency Band: {{COMPETENCY_BAND}}",
      "",
      "Teacher Remark:",
      "{{TEACHER_REMARK}}"
    ],
    "progress-report": [
      "Learner: {{LEARNER_NAME}} ({{ADMISSION_NUMBER}})",
      "Academic Year: {{ACADEMIC_YEAR}}",
      "",
      "Term Performance",
      "Term,Learning Area,Marks,Percentage,Band,Position",
      "",
      "Overall Progression Summary",
      "- Strengths: ",
      "- Improvement Areas: ",
      "- Recommended Support: "
    ],
    "teacher-notes": [
      "Learning Area: {{LEARNING_AREA}}",
      "Strand: {{STRAND}}",
      "Sub-Strand: {{SUB_STRAND}}",
      "",
      "Learning Outcomes",
      "- ...",
      "",
      "Learning Activities",
      "- ...",
      "",
      "Assessment Checkpoints",
      "- ..."
    ]
  };
  return (presets[templateKey] || presets["exam-paper"]).join("\n");
}

function renderExamAnalyticsPanel() {
  return `
    <div class="module-header-card">
      <h4>Examination Analytics Engine</h4>
      <p>Real-time snapshots for curriculum depth, exam throughput, learner mark flow and CBC performance patterns.</p>
    </div>
    <div class="actions-row exam-icon-group">
      <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examAnalyticsRefreshBtn" title="Refresh analytics">Refresh</button>
      <button class="ax-btn ax-btn--download ax-btn--sm" id="examAnalyticsDownloadBtn" title="Download analytics">Download</button>
      <button class="ax-btn ax-btn--print ax-btn--sm" id="examAnalyticsPrintBtn" title="Print analytics">Print</button>
    </div>
    <div id="examAnalyticsCards" class="exam-analytics-grid"></div>
    <div class="dashboard-table-wrap">
      <table class="dashboard-table">
        <thead>
          <tr><th>Learning Area</th><th>Entries</th><th>Avg Marks</th><th>Avg Percentage</th></tr>
        </thead>
        <tbody id="examAnalyticsBody"></tbody>
      </table>
    </div>
    <div id="examAnalyticsStatus" class="small-note">Loading analytics...</div>
  `;
}

async function wireExamAnalyticsPanel() {
  const cardsEl = document.getElementById("examAnalyticsCards");
  const bodyEl = document.getElementById("examAnalyticsBody");
  const statusEl = document.getElementById("examAnalyticsStatus");

  const renderAnalytics = (payload = {}) => {
    const counters = payload?.counters || {};
    const byLearningArea = Array.isArray(payload?.by_learning_area) ? payload.by_learning_area : [];
    if (cardsEl) {
      cardsEl.innerHTML = `
        <article class="exam-analytics-card"><h5>Curriculum Rows</h5><p>${formatNumber(counters.curriculum_rows || 0)}</p></article>
        <article class="exam-analytics-card"><h5>Materials</h5><p>${formatNumber(counters.learning_materials || 0)}</p></article>
        <article class="exam-analytics-card"><h5>Generated Exams</h5><p>${formatNumber(counters.generated_exams || 0)}</p></article>
        <article class="exam-analytics-card"><h5>Marks Records</h5><p>${formatNumber(counters.marks_records || 0)}</p></article>
        <article class="exam-analytics-card"><h5>Learners Assessed</h5><p>${formatNumber(counters.assessed_learners || 0)}</p></article>
        <article class="exam-analytics-card"><h5>Mean Score</h5><p>${escapeHtml(String(counters.mean_marks ?? 0))}</p></article>
      `;
    }
    if (bodyEl) {
      bodyEl.innerHTML = byLearningArea.length
        ? byLearningArea.map((row) => `
          <tr>
            <td>${escapeHtml(row.learning_area || "-")}</td>
            <td>${escapeHtml(String(row.entry_count || 0))}</td>
            <td>${escapeHtml(String(row.avg_marks || 0))}</td>
            <td>${escapeHtml(String(row.avg_percentage || 0))}</td>
          </tr>
        `).join("")
        : `<tr><td colspan="4">No analytics rows available.</td></tr>`;
    }
  };

  const load = async () => {
    try {
      const payload = await request("/api/examinations/analytics/overview");
      renderAnalytics(payload);
      if (statusEl) statusEl.textContent = `Last sync: ${formatDateTime(new Date().toISOString())}`;
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message;
      if (bodyEl) bodyEl.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
    }
  };

  document.getElementById("examAnalyticsRefreshBtn")?.addEventListener("click", load);
  document.getElementById("examAnalyticsDownloadBtn")?.addEventListener("click", () => {
    const rows = Array.from((bodyEl?.querySelectorAll("tr") || [])).map((row) =>
      Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent || "")
    );
    if (!rows.length) {
      alert("No analytics rows to download.");
      return;
    }
    const csv = rowsToCsv(rows.map((columns) => ({
      learning_area: columns[0] || "",
      entries: columns[1] || "",
      avg_marks: columns[2] || "",
      avg_percentage: columns[3] || ""
    })));
    downloadTextFile("exam-analytics.csv", csv, "text/csv;charset=utf-8");
  });
  document.getElementById("examAnalyticsPrintBtn")?.addEventListener("click", () => window.print());
  await load();
}

function renderExamAiCopilotPanel({ gradeOptions = [], formOptions = [], learningAreas = [] } = {}) {
  return `
    <div class="module-header-card">
      <h4>AI Copilot - Examination Hardening Assistant</h4>
      <p>Generate automated recommendations using curriculum depth, generated exams, marks flow, and intervention signals.</p>
    </div>
    <div class="form-grid">
      <label>Grade (optional)</label>
      <select id="examAiCopilotGrade"><option value="">All grades</option>${gradeOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}</select>
      <label>Form (optional)</label>
      <select id="examAiCopilotForm"><option value="">All forms</option>${formOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}</select>
      <label>Learning Area (optional)</label>
      <select id="examAiCopilotLearningArea"><option value="">All learning areas</option>${learningAreas.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}</select>
    </div>
    <div class="actions-row exam-icon-group">
      <button class="ax-btn ax-btn--generate ax-btn--sm" id="examAiCopilotRunBtn" title="Run AI recommendations">AI Generate</button>
      <button class="ax-btn ax-btn--download ax-btn--sm" id="examAiCopilotDownloadBtn" title="Download AI report">Download</button>
      <button class="ax-btn ax-btn--print ax-btn--sm" id="examAiCopilotPrintBtn" title="Print AI report">Print</button>
    </div>
    <div id="examAiCopilotMetrics" class="exam-analytics-grid"></div>
    <div id="examAiCopilotActions" class="module-header-card"><p class="small-note">Run AI analysis to get recommendations.</p></div>
    <div class="dashboard-table-wrap">
      <table class="dashboard-table">
        <thead><tr><th>Subject</th><th>Low Band Cases</th></tr></thead>
        <tbody id="examAiCopilotSubjects"><tr><td colspan="2">No subject interventions yet.</td></tr></tbody>
      </table>
    </div>
  `;
}

async function wireExamAiCopilotPanel() {
  const metricsEl = document.getElementById("examAiCopilotMetrics");
  const actionsEl = document.getElementById("examAiCopilotActions");
  const subjectsEl = document.getElementById("examAiCopilotSubjects");
  const gradeEl = document.getElementById("examAiCopilotGrade");
  const formEl = document.getElementById("examAiCopilotForm");
  const areaEl = document.getElementById("examAiCopilotLearningArea");
  let lastPayload = null;
  const renderPayload = (payload = null) => {
    const metrics = payload?.metrics || {};
    const actions = Array.isArray(payload?.ai_actions) ? payload.ai_actions : [];
    const subjects = Array.isArray(payload?.intervention_subjects) ? payload.intervention_subjects : [];
    if (metricsEl) {
      metricsEl.innerHTML = `
        <article class="exam-analytics-card"><h5>Curriculum Rows</h5><p>${formatNumber(metrics.curriculum_rows || 0)}</p></article>
        <article class="exam-analytics-card"><h5>Generated Exams</h5><p>${formatNumber(metrics.generated_exams || 0)}</p></article>
        <article class="exam-analytics-card"><h5>Marks Rows</h5><p>${formatNumber(metrics.marks_rows || 0)}</p></article>
        <article class="exam-analytics-card"><h5>Average %</h5><p>${escapeHtml(String(metrics.avg_percentage ?? 0))}</p></article>
      `;
    }
    if (actionsEl) {
      actionsEl.innerHTML = `
        <h4>AI Recommendations</h4>
        <p class="small-note">${actions.length ? actions.map((item) => `- ${escapeHtml(item)}`).join("<br/>") : "No recommendation generated."}</p>
      `;
    }
    if (subjectsEl) {
      subjectsEl.innerHTML = subjects.length
        ? subjects.map((row) => `<tr><td>${escapeHtml(row.subject || "-")}</td><td>${escapeHtml(String(row.total || 0))}</td></tr>`).join("")
        : `<tr><td colspan="2">No low-band intervention subjects detected.</td></tr>`;
    }
  };
  const run = async () => {
    try {
      const payload = await request("/api/examinations/ai-copilot/recommendations", {
        method: "POST",
        body: JSON.stringify({
          grade: String(gradeEl?.value || "").trim() || null,
          form_name: String(formEl?.value || "").trim() || null,
          learning_area: String(areaEl?.value || "").trim() || null
        })
      });
      lastPayload = payload;
      renderPayload(payload);
    } catch (error) {
      alert(error.message);
    }
  };
  document.getElementById("examAiCopilotRunBtn")?.addEventListener("click", run);
  document.getElementById("examAiCopilotDownloadBtn")?.addEventListener("click", () => {
    if (!lastPayload) {
      alert("Generate AI recommendations first.");
      return;
    }
    downloadTextFile("exam-ai-copilot-report.json", JSON.stringify(lastPayload, null, 2), "application/json;charset=utf-8");
  });
  document.getElementById("examAiCopilotPrintBtn")?.addEventListener("click", () => window.print());
  await run();
}

function renderExamTemplateManagerPanel() {
  return `
    <div class="module-header-card">
      <h4>Template Orchestration</h4>
      <p>Create, clone, preview and archive dynamic templates for exams, scripts, assessment and progress workflows.</p>
    </div>
    <div class="form-grid">
      <label>Template Type</label>
      <select id="examTplType">
        <option value="exam-paper">Exam Paper</option>
        <option value="mark-sheet">Mark Sheet</option>
        <option value="assessment-report">Assessment Report</option>
        <option value="progress-report">Progress Report</option>
        <option value="teacher-notes">Teacher Notes</option>
      </select>
      <label>Template Name</label>
      <input id="examTplName" placeholder="e.g. Grade 9 Social Studies Paper 1" />
      <label>Version Tag</label>
      <input id="examTplVersionTag" placeholder="e.g. v1.0" />
      <label>Template Body</label>
      <textarea id="examTplBody" rows="14" class="template-spacious" placeholder="Template body..."></textarea>
    </div>
    <div class="actions-row exam-icon-group">
      <button class="ax-btn ax-btn--generate ax-btn--sm" id="examTplPresetBtn" title="Generate preset">AI Generate</button>
      <button class="ax-btn ax-btn--save ax-btn--sm" id="examTplSaveBtn" title="Save template">Save</button>
      <button class="ax-btn ax-btn--edit ax-btn--sm" id="examTplUpdateBtn" title="Update template">Edit</button>
      <button class="ax-btn ax-btn--view ax-btn--sm" id="examTplViewBtn" title="Preview template">Preview</button>
      <button class="ax-btn ax-btn--clone ax-btn--sm" id="examTplCloneBtn" title="Clone template">Clone</button>
      <button class="ax-btn ax-btn--delete ax-btn--sm" id="examTplDeleteBtn" title="Delete template">Delete</button>
      <button class="ax-btn ax-btn--download ax-btn--sm" id="examTplDownloadBtn" title="Download template">Download</button>
      <button class="ax-btn ax-btn--upload ax-btn--sm" id="examTplUploadBtn" title="Upload template">Upload</button>
      <input id="examTplUploadInput" type="file" accept=".txt,.csv,.doc,.docx,.md" style="display:none;" />
      <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examTplRefreshBtn" title="Refresh templates">Refresh</button>
    </div>
    <div id="examTplStatus" class="small-note">Ready.</div>
    <div class="dashboard-table-wrap">
      <table class="dashboard-table">
        <thead><tr><th>ID</th><th>Type</th><th>Name</th><th>Version</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody id="examTplBodyRows"></tbody>
      </table>
    </div>
  `;
}

async function wireExamTemplateManagerPanel() {
  const typeEl = document.getElementById("examTplType");
  const nameEl = document.getElementById("examTplName");
  const versionTagEl = document.getElementById("examTplVersionTag");
  const bodyEl = document.getElementById("examTplBody");
  const rowsEl = document.getElementById("examTplBodyRows");
  const statusEl = document.getElementById("examTplStatus");
  let selectedTemplateId = null;
  let rowsCache = [];

  const setStatus = (message) => {
    if (statusEl) statusEl.textContent = message || "";
  };

  const bindSelected = (row = null) => {
    selectedTemplateId = Number(row?.id || 0) || null;
    if (row) {
      if (typeEl) typeEl.value = String(row.template_key || "exam-paper");
      if (nameEl) nameEl.value = String(row.template_name || "");
      if (versionTagEl) versionTagEl.value = String(row.version_tag || "");
      if (bodyEl) bodyEl.value = String(row.content || "");
      setStatus(`Selected template #${row.id}`);
    }
  };

  const renderRows = () => {
    if (!rowsEl) return;
    rowsEl.innerHTML = rowsCache.length
      ? rowsCache.map((row) => `
        <tr>
          <td>${escapeHtml(String(row.id || "-"))}</td>
          <td>${escapeHtml(row.template_key || "-")}</td>
          <td>${escapeHtml(row.template_name || "-")}</td>
          <td>${escapeHtml(row.version_tag || "-")}</td>
          <td>${escapeHtml(formatDateTime(row.updated_at || row.created_at))}</td>
          <td class="table-actions-cell">
            <button class="ax-btn ax-btn--view ax-btn--sm" data-tpl-action="select" data-id="${Number(row.id || 0)}">View</button>
            <button class="ax-btn ax-btn--clone ax-btn--sm" data-tpl-action="clone" data-id="${Number(row.id || 0)}">Clone</button>
            <button class="ax-btn ax-btn--archive ax-btn--sm" data-tpl-action="archive" data-id="${Number(row.id || 0)}">Archive</button>
          </td>
        </tr>
      `).join("")
      : `<tr><td colspan="6">No templates saved.</td></tr>`;
    rowsEl.querySelectorAll("[data-tpl-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = String(btn.getAttribute("data-tpl-action") || "");
        const id = Number(btn.getAttribute("data-id") || 0);
        const row = rowsCache.find((item) => Number(item.id || 0) === id) || null;
        if (!id || !action) return;
        if (action === "select") {
          bindSelected(row);
          return;
        }
        if (action === "clone") {
          try {
            await request(`/api/examinations/templates/${id}/clone`, { method: "POST" });
            await loadRows();
          } catch (error) {
            alert(error.message);
          }
          return;
        }
        if (action === "archive") {
          try {
            await request("/api/examinations/archives", {
              method: "POST",
              body: JSON.stringify({
                archive_type: "template",
                title: row?.template_name || `Template ${id}`,
                reference_id: id,
                payload_json: { template: row || null }
              })
            });
            setStatus(`Template #${id} archived.`);
          } catch (error) {
            alert(error.message);
          }
        }
      });
    });
  };

  const loadRows = async () => {
    try {
      const rows = await request("/api/examinations/templates");
      rowsCache = Array.isArray(rows) ? rows : [];
      renderRows();
      setStatus(`Loaded ${rowsCache.length} template(s).`);
    } catch (error) {
      setStatus(error.message);
      rowsCache = [];
      renderRows();
    }
  };

  document.getElementById("examTplPresetBtn")?.addEventListener("click", () => {
    if (bodyEl) bodyEl.value = examTemplatePresetContent(String(typeEl?.value || "exam-paper"));
    setStatus("Preset loaded. Review and save.");
  });
  document.getElementById("examTplSaveBtn")?.addEventListener("click", async () => {
    const payload = {
      template_key: String(typeEl?.value || "exam-paper"),
      template_name: String(nameEl?.value || "").trim(),
      version_tag: String(versionTagEl?.value || "").trim(),
      content: String(bodyEl?.value || "").trim()
    };
    if (!payload.template_name || !payload.content) {
      alert("Template name and body are required.");
      return;
    }
    try {
      await request("/api/examinations/templates", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await loadRows();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("examTplUpdateBtn")?.addEventListener("click", async () => {
    if (!selectedTemplateId) {
      alert("Select a template first.");
      return;
    }
    try {
      await request(`/api/examinations/templates/${selectedTemplateId}`, {
        method: "PUT",
        body: JSON.stringify({
          template_key: String(typeEl?.value || "exam-paper"),
          template_name: String(nameEl?.value || "").trim(),
          version_tag: String(versionTagEl?.value || "").trim(),
          content: String(bodyEl?.value || "").trim()
        })
      });
      await loadRows();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("examTplViewBtn")?.addEventListener("click", () => {
    const content = String(bodyEl?.value || "").trim();
    if (!content) {
      alert("No template body to preview.");
      return;
    }
    const popup = window.open("", "_blank");
    if (!popup) return;
    popup.document.write(`<pre>${escapeHtml(content)}</pre>`);
    popup.document.close();
  });
  document.getElementById("examTplCloneBtn")?.addEventListener("click", async () => {
    if (!selectedTemplateId) {
      alert("Select a template first.");
      return;
    }
    try {
      await request(`/api/examinations/templates/${selectedTemplateId}/clone`, { method: "POST" });
      await loadRows();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("examTplDeleteBtn")?.addEventListener("click", async () => {
    if (!selectedTemplateId) {
      alert("Select a template first.");
      return;
    }
    if (!window.confirm(`Delete template #${selectedTemplateId}?`)) return;
    try {
      await request(`/api/examinations/templates/${selectedTemplateId}`, { method: "DELETE" });
      selectedTemplateId = null;
      await loadRows();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("examTplDownloadBtn")?.addEventListener("click", () => {
    const content = String(bodyEl?.value || "").trim();
    if (!content) {
      alert("No template body to download.");
      return;
    }
    const name = String(nameEl?.value || "exam-template").trim().replace(/\s+/g, "-").toLowerCase();
    downloadTextFile(`${name || "exam-template"}.txt`, content);
  });
  document.getElementById("examTplUploadBtn")?.addEventListener("click", () => {
    document.getElementById("examTplUploadInput")?.click();
  });
  document.getElementById("examTplUploadInput")?.addEventListener("change", async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const text = await file.text();
    if (bodyEl) bodyEl.value = text;
    if (nameEl && !nameEl.value) nameEl.value = file.name.replace(/\.[^.]+$/, "");
    setStatus(`Loaded file: ${file.name}`);
    event.target.value = "";
  });
  document.getElementById("examTplRefreshBtn")?.addEventListener("click", loadRows);
  await loadRows();
}

function renderExamArchivePanel() {
  return `
    <div class="module-header-card">
      <h4>Archives & Lifecycle</h4>
      <p>Archive generated exams, scripts and reports for retrieval, traceability and institutional compliance.</p>
    </div>
    <div class="form-grid">
      <label>Archive Type</label>
      <select id="examArchiveType">
        <option value="exam-paper">Exam Paper</option>
        <option value="exam-script">Exam Script</option>
        <option value="assessment-report">Assessment Report</option>
        <option value="progress-report">Progress Report</option>
        <option value="template">Template</option>
      </select>
      <label>Archive Title</label>
      <input id="examArchiveTitle" placeholder="Archive title" />
      <label>Reference ID</label>
      <input id="examArchiveRefId" type="number" placeholder="Optional source ID" />
      <label>Payload / Notes</label>
      <textarea id="examArchivePayload" rows="8" class="template-spacious" placeholder="Archived payload or notes..."></textarea>
      <label>Status Filter</label>
      <select id="examArchiveStatusFilter">
        <option value="">All</option>
        <option value="ACTIVE">Active</option>
        <option value="ARCHIVED">Archived</option>
      </select>
    </div>
    <div class="actions-row exam-icon-group">
      <button class="ax-btn ax-btn--archive ax-btn--sm" id="examArchiveSaveBtn" title="Archive item">Archive</button>
      <button class="ax-btn ax-btn--view ax-btn--sm" id="examArchiveViewBtn" title="View archive">View</button>
      <button class="ax-btn ax-btn--approve ax-btn--sm" id="examArchiveRestoreBtn" title="Restore archive">Restore</button>
      <button class="ax-btn ax-btn--download ax-btn--sm" id="examArchiveDownloadBtn" title="Download archive">Download</button>
      <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examArchiveRefreshBtn" title="Refresh archive">Refresh</button>
    </div>
    <div id="examArchiveStatus" class="small-note">Ready.</div>
    <div class="dashboard-table-wrap">
      <table class="dashboard-table">
        <thead><tr><th>ID</th><th>Type</th><th>Title</th><th>Status</th><th>Archived At</th><th>Actions</th></tr></thead>
        <tbody id="examArchiveRows"></tbody>
      </table>
    </div>
  `;
}

async function wireExamArchivePanel() {
  const typeEl = document.getElementById("examArchiveType");
  const titleEl = document.getElementById("examArchiveTitle");
  const refEl = document.getElementById("examArchiveRefId");
  const payloadEl = document.getElementById("examArchivePayload");
  const filterEl = document.getElementById("examArchiveStatusFilter");
  const rowsEl = document.getElementById("examArchiveRows");
  const statusEl = document.getElementById("examArchiveStatus");
  let rowsCache = [];
  let selectedArchiveId = null;

  const setStatus = (message) => {
    if (statusEl) statusEl.textContent = message || "";
  };

  const renderRows = () => {
    if (!rowsEl) return;
    rowsEl.innerHTML = rowsCache.length
      ? rowsCache.map((row) => `
        <tr>
          <td>${escapeHtml(String(row.id || "-"))}</td>
          <td>${escapeHtml(row.archive_type || "-")}</td>
          <td>${escapeHtml(row.title || "-")}</td>
          <td>${escapeHtml(row.status || "-")}</td>
          <td>${escapeHtml(formatDateTime(row.archived_at || row.created_at))}</td>
          <td class="table-actions-cell">
            <button class="ax-btn ax-btn--view ax-btn--sm" data-archive-action="view" data-id="${Number(row.id || 0)}">View</button>
            <button class="ax-btn ax-btn--approve ax-btn--sm" data-archive-action="restore" data-id="${Number(row.id || 0)}">Restore</button>
          </td>
        </tr>
      `).join("")
      : `<tr><td colspan="6">No archive rows yet.</td></tr>`;
    rowsEl.querySelectorAll("[data-archive-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = String(btn.getAttribute("data-archive-action") || "");
        const id = Number(btn.getAttribute("data-id") || 0);
        const row = rowsCache.find((item) => Number(item.id || 0) === id) || null;
        if (!id) return;
        selectedArchiveId = id;
        if (action === "view" && row) {
          if (typeEl) typeEl.value = String(row.archive_type || "exam-paper");
          if (titleEl) titleEl.value = String(row.title || "");
          if (refEl) refEl.value = String(row.reference_id || "");
          if (payloadEl) payloadEl.value = typeof row.payload_json === "string"
            ? row.payload_json
            : JSON.stringify(row.payload_json || {}, null, 2);
          setStatus(`Loaded archive #${id}.`);
          return;
        }
        if (action === "restore") {
          try {
            await request(`/api/examinations/archives/${id}`, {
              method: "PATCH",
              body: JSON.stringify({ status: "ACTIVE" })
            });
            await loadRows();
          } catch (error) {
            alert(error.message);
          }
        }
      });
    });
  };

  const loadRows = async () => {
    const params = new URLSearchParams();
    const statusFilter = String(filterEl?.value || "").trim();
    if (statusFilter) params.set("status", statusFilter);
    try {
      const rows = await request(`/api/examinations/archives?${params.toString()}`);
      rowsCache = Array.isArray(rows) ? rows : [];
      renderRows();
      setStatus(`Loaded ${rowsCache.length} archive row(s).`);
    } catch (error) {
      setStatus(error.message);
      rowsCache = [];
      renderRows();
    }
  };

  document.getElementById("examArchiveSaveBtn")?.addEventListener("click", async () => {
    const payloadText = String(payloadEl?.value || "").trim();
    const payloadJson = payloadText
      ? (() => {
        try {
          return JSON.parse(payloadText);
        } catch (_) {
          return { text: payloadText };
        }
      })()
      : null;
    try {
      await request("/api/examinations/archives", {
        method: "POST",
        body: JSON.stringify({
          archive_type: String(typeEl?.value || "exam-paper"),
          title: String(titleEl?.value || "").trim() || "Exam Archive",
          reference_id: Number(refEl?.value || 0) || null,
          payload_json: payloadJson
        })
      });
      await loadRows();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("examArchiveViewBtn")?.addEventListener("click", () => {
    if (!selectedArchiveId) {
      alert("Select an archive row first.");
      return;
    }
    const row = rowsCache.find((item) => Number(item.id || 0) === selectedArchiveId) || null;
    if (!row) return;
    const popup = window.open("", "_blank");
    if (!popup) return;
    popup.document.write(`<pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre>`);
    popup.document.close();
  });
  document.getElementById("examArchiveRestoreBtn")?.addEventListener("click", async () => {
    if (!selectedArchiveId) {
      alert("Select an archive row first.");
      return;
    }
    try {
      await request(`/api/examinations/archives/${selectedArchiveId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ACTIVE" })
      });
      await loadRows();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("examArchiveDownloadBtn")?.addEventListener("click", () => {
    if (!selectedArchiveId) {
      alert("Select an archive row first.");
      return;
    }
    const row = rowsCache.find((item) => Number(item.id || 0) === selectedArchiveId) || null;
    if (!row) return;
    downloadTextFile(
      `exam-archive-${selectedArchiveId}.json`,
      JSON.stringify(row, null, 2),
      "application/json;charset=utf-8"
    );
  });
  document.getElementById("examArchiveRefreshBtn")?.addEventListener("click", loadRows);
  filterEl?.addEventListener("change", loadRows);
  await loadRows();
}

function renderExamSettingsPanel() {
  return `
    <div class="module-header-card">
      <h4>Examination Settings</h4>
      <p>Configure module automation, validation and orchestration defaults for secure enterprise operation.</p>
    </div>
    <div class="form-grid">
      <label>Auto Save Enabled</label>
      <select id="examSettingsAutoSave"><option value="1">Enabled</option><option value="0">Disabled</option></select>
      <label>Auto Save Interval (sec)</label>
      <input id="examSettingsAutoSaveInterval" type="number" min="10" max="900" value="90" />
      <label>Strict CBC Validation</label>
      <select id="examSettingsCbcValidation"><option value="1">Enabled</option><option value="0">Disabled</option></select>
      <label>Background Processing</label>
      <select id="examSettingsBackground"><option value="1">Enabled</option><option value="0">Disabled</option></select>
      <label>Real-time Sync (WebSocket Ready)</label>
      <select id="examSettingsRealtime"><option value="1">Enabled</option><option value="0">Disabled</option></select>
      <label>Offline Cache</label>
      <select id="examSettingsCache"><option value="1">Enabled</option><option value="0">Disabled</option></select>
    </div>
    <div class="actions-row exam-icon-group">
      <button class="ax-btn ax-btn--save ax-btn--sm" id="examSettingsSaveBtn" title="Save settings">Save</button>
      <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examSettingsReloadBtn" title="Reload settings">Refresh</button>
      <button class="ax-btn ax-btn--view ax-btn--sm" id="examSettingsPreviewBtn" title="Preview settings">Preview</button>
    </div>
    <pre id="examSettingsPreview" class="small-note" style="max-height:260px;overflow:auto;"></pre>
  `;
}

async function wireExamSettingsPanel() {
  const readForm = () => ({
    auto_save_enabled: Number(document.getElementById("examSettingsAutoSave")?.value || 0) === 1,
    auto_save_interval_sec: Number(document.getElementById("examSettingsAutoSaveInterval")?.value || 90),
    strict_cbc_validation: Number(document.getElementById("examSettingsCbcValidation")?.value || 0) === 1,
    background_processing_enabled: Number(document.getElementById("examSettingsBackground")?.value || 0) === 1,
    realtime_sync_enabled: Number(document.getElementById("examSettingsRealtime")?.value || 0) === 1,
    offline_cache_enabled: Number(document.getElementById("examSettingsCache")?.value || 0) === 1
  });
  const applyForm = (settings = {}) => {
    const pick = (key, fallback) => Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
    document.getElementById("examSettingsAutoSave").value = pick("auto_save_enabled", true) ? "1" : "0";
    document.getElementById("examSettingsAutoSaveInterval").value = String(pick("auto_save_interval_sec", 90));
    document.getElementById("examSettingsCbcValidation").value = pick("strict_cbc_validation", true) ? "1" : "0";
    document.getElementById("examSettingsBackground").value = pick("background_processing_enabled", true) ? "1" : "0";
    document.getElementById("examSettingsRealtime").value = pick("realtime_sync_enabled", false) ? "1" : "0";
    document.getElementById("examSettingsCache").value = pick("offline_cache_enabled", true) ? "1" : "0";
  };
  const preview = () => {
    const pre = document.getElementById("examSettingsPreview");
    if (!pre) return;
    pre.textContent = JSON.stringify(readForm(), null, 2);
  };
  const load = async () => {
    try {
      const result = await request("/api/examinations/settings");
      applyForm(result?.settings || {});
      preview();
    } catch (error) {
      const pre = document.getElementById("examSettingsPreview");
      if (pre) pre.textContent = error.message;
    }
  };
  document.getElementById("examSettingsSaveBtn")?.addEventListener("click", async () => {
    const payload = readForm();
    try {
      await request("/api/examinations/settings", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      preview();
      alert("Examination settings saved.");
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("examSettingsReloadBtn")?.addEventListener("click", load);
  document.getElementById("examSettingsPreviewBtn")?.addEventListener("click", preview);
  await load();
}

async function renderCbcCurriculumEditor(options = {}) {
  setActiveSidebarButton("system-cbc-editor");
  document.getElementById("moduleTitle").textContent = "Examination Management";
  currentModule = "system-cbc-editor";
  stopDashboardAutoRefresh();

  const actorRole = normalizeRoleKey(portalContext?.role || "");
  const isSuperSystemDeveloper = actorRole === "SUPER_SYSTEM_DEVELOPER";
  if (!isSuperSystemDeveloper) {
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis"><h4>Examination Management</h4><p>Restricted</p></div>
      <div class="card stats-card"><h4>Allowed Role</h4><p>SUPER SYSTEM DEVELOPER</p></div>
      <div class="card stats-card"><h4>Current Role</h4><p>${escapeHtml(actorRole || "-")}</p></div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Examination Management Module</h3>
        <p>This redesigned module is available only to <strong>SUPER SYSTEM DEVELOPER</strong>.</p>
      </div>
    `;
    resetDataTable("Examination module access restricted.");
    return;
  }

  const initialTab = normalizeExamTabKey(options?.examTab || "curriculum");
  const canonicalGrades = [
    "PP1",
    "PP2",
    "PP3",
    "Grade 1",
    "Grade 2",
    "Grade 3",
    "Grade 4",
    "Grade 5",
    "Grade 6",
    "Grade 7",
    "Grade 8",
    "Grade 9",
    "Grade 10",
    "Grade 11",
    "Grade 12"
  ];
  const canonicalForms = ["Form 3", "Form 4"];
  const gradeOptions = Array.from(
    new Set([...(Array.isArray(meta?.gradeOptions) ? meta.gradeOptions : []), ...canonicalGrades].filter(Boolean))
  );
  const formOptions = Array.from(
    new Set([...(Array.isArray(meta?.formOptions) ? meta.formOptions : []), ...canonicalForms].filter(Boolean))
  );
  const learningAreas = Array.from(
    new Set(
      [
        ...collectAllCbcLearningAreas(),
        ...(Array.isArray(meta?.subjectOptions) ? meta.subjectOptions : [])
      ].filter(Boolean)
    )
  );
  const termOptions = Array.isArray(meta?.termOptions) ? meta.termOptions : ["Term One", "Term Two", "Term Three"];
  const examSessions = ["Head Start", "CATS", "Midterm", "End Term", "Joint", "Mock", "KNEC", "Inter-Schools", "Inter-County", "Other"];
  const tabDefs = [
    { id: "curriculum", label: "Curriculum" },
    { id: "exam-generation", label: "Exam Generation" },
    { id: "exam-entry", label: "Exam Entry" },
    { id: "exam-scripts", label: "Exam Scripts" },
    { id: "assessment-reports", label: "Assessment Reports" },
    { id: "progress-reports", label: "Progress Reports" },
    { id: "gradebook", label: "Gradebook" },
    { id: "assessment-tracking", label: "Assessment Tracking" },
    { id: "portal-insights", label: "Portal Insights" },
    { id: "compliance", label: "Compliance" },
    { id: "lifecycle", label: "Lifecycle" },
    { id: "analytics", label: "Analytics" },
    { id: "ai-copilot", label: "AI Copilot" },
    { id: "templates", label: "Templates" },
    { id: "archives", label: "Archives" },
    { id: "settings", label: "Settings" }
  ];

  const renderExamCards = async () => {
    try {
      const [curriculum, materials, exams, marks] = await Promise.all([
        request("/api/cbc/curriculum?limit=400"),
        request("/api/cbc/curriculum/materials"),
        request("/api/academic/exams?limit=400"),
        request("/api/academic/marks?limit=400")
      ]);
      document.getElementById("cards").innerHTML = `
        <div class="card stats-card metric-emphasis"><h4>Curriculum Engine</h4><p>${formatNumber(Array.isArray(curriculum) ? curriculum.length : 0)} rows</p></div>
        <div class="card stats-card"><h4>Exam Intelligence</h4><p>${formatNumber(Array.isArray(exams) ? exams.length : 0)} generated exams</p></div>
        <div class="card stats-card"><h4>Learner Assessment</h4><p>${formatNumber(Array.isArray(marks) ? marks.length : 0)} marks records</p></div>
        <div class="card stats-card"><h4>Learning Materials</h4><p>${formatNumber(Array.isArray(materials) ? materials.length : 0)} uploads</p></div>
      `;
    } catch (_) {
      document.getElementById("cards").innerHTML = `
        <div class="card stats-card metric-emphasis"><h4>Examination Engine</h4><p>Ready</p></div>
        <div class="card stats-card"><h4>Mode</h4><p>Dynamic</p></div>
        <div class="card stats-card"><h4>Access</h4><p>SSD only</p></div>
      `;
    }
  };
  await renderExamCards();

  document.getElementById("formArea").innerHTML = `
    <div class="module-header-card exam-v2-header exam-module-compact-header">
      <h3>Examination Management</h3>
      <p class="exam-tight-note">CBC-aligned examinations: curriculum, generation, entry, scripts, analytics, templates, archives.</p>
    </div>
    <nav id="examTopNav" class="exam-top-nav exam-nav-compact" aria-label="Examination submodules"></nav>
    <section id="examMgmtSubmodulePanel" class="dashboard-section exam-module-compact-max"></section>
    <div id="examV2Status" class="small-note"></div>
  `;

  const navEl = document.getElementById("examTopNav");
  const panel = document.getElementById("examMgmtSubmodulePanel");
  const statusEl = document.getElementById("examV2Status");
  const setStatus = (message) => {
    if (statusEl) statusEl.textContent = message || "";
  };
  const stylePanel = () => {
    applyCompactIconButtons(panel);
    applyTemplateVisibility(panel);
    styleExamModuleButtonsAsNamedIcons(panel);
  };

  const fetchStructureSuggestions = async ({ grade, form_name, learning_area }) => {
    if ((!grade && !form_name) || !learning_area) {
      return { strand_options: [], sub_strand_options_by_strand: {} };
    }
    try {
      const result = await request("/api/cbc/curriculum/ai-suggest-structure", {
        method: "POST",
        body: JSON.stringify({ grade, form_name, learning_area })
      });
      return {
        strand_options: Array.isArray(result?.strand_options) ? result.strand_options : [],
        sub_strand_options_by_strand: result?.sub_strand_options_by_strand || {}
      };
    } catch (_) {
      return { strand_options: [], sub_strand_options_by_strand: {} };
    }
  };

  const renderNav = (activeTab = "curriculum") => {
    if (!navEl) return;
    navEl.innerHTML = tabDefs.map((tab) => `
      <button type="button" class="ax-btn ax-btn--view ax-btn--sm exam-nav-btn${activeTab === tab.id ? " active" : ""}" data-exam-tab="${tab.id}" title="${escapeHtmlAttribute(tab.label)}">
        ${escapeHtml(tab.label)}
      </button>
    `).join("");
    styleExamModuleButtonsAsNamedIcons(navEl);
  };

  const renderCurriculumTab = async () => {
    const [curriculumRows, materialRows] = await Promise.all([
      request("/api/cbc/curriculum?limit=600").catch(() => []),
      request("/api/cbc/curriculum/materials").catch(() => [])
    ]);
    const rows = Array.isArray(curriculumRows) ? curriculumRows : [];
    const materials = Array.isArray(materialRows) ? materialRows : [];
    const draftRows = [];
    panel.innerHTML = `
      <div class="exam-v2-layout exam-module-compact">
        <div class="exam-v2-pane">
          <h4>Curriculum Engine</h4>
          <p class="small-note exam-tight-note">New = build strands/sub-strands; Edit = update saved curriculum rows by ID.</p>
          <div class="form-grid form-grid--exam-tight">
            <label>Mode</label>
            <select id="examV2CurrMode"><option value="new">New entries</option><option value="edit">Edit saved row</option></select>
            <label>Grade/Form</label>
            <select id="examV2CurrLevel"><option value="">Select grade or form</option>${[...gradeOptions, ...formOptions].map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Learning Area</label>
            <select id="examV2CurrLearningArea"><option value="">Select learning area</option>${learningAreas.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>CBC Level</label>
            <select id="examV2CurrCbcLevel">
              <option value="">Select level</option>
              <option value="Pre-primary">Pre-primary</option>
              <option value="Lower Primary">Lower Primary</option>
              <option value="Upper Primary">Upper Primary</option>
              <option value="Junior Secondary">Junior Secondary</option>
              <option value="Senior Secondary">Senior Secondary</option>
            </select>
            <label>Strand slots (quick add)</label>
            <input id="examV2CurrStrandSlots" type="number" min="1" max="40" value="1" />
          </div>
          <div class="form-grid form-grid--exam-tight">
            <label>Strand</label>
            <input id="examV2CurrStrand" placeholder="Enter strand" />
            <label>Strand Description</label>
            <textarea id="examV2CurrStrandDesc" rows="2" placeholder="Strand scope"></textarea>
            <label>Sub-strand</label>
            <input id="examV2CurrSubStrand" placeholder="Enter sub-strand" />
            <label>Sub-strand Description</label>
            <textarea id="examV2CurrSubStrandDesc" rows="2" placeholder="Sub-strand detail"></textarea>
            <label>Learning Outcome / Notes</label>
            <textarea id="examV2CurrNotes" rows="3" placeholder="Optional notes/outcomes"></textarea>
          </div>
          <div class="actions-row exam-icon-group exam-actions-tight">
            <button class="ax-btn ax-btn--add ax-btn--sm" id="examV2CurrAddRowBtn" title="Add row">Add</button>
            <button class="ax-btn ax-btn--generate ax-btn--sm" id="examV2CurrPrepareSlotsBtn" title="Prepare strand slots">Slots</button>
            <button class="ax-btn ax-btn--save ax-btn--sm" id="examV2CurrSaveBtn" title="Save all rows">Save</button>
            <button class="ax-btn ax-btn--edit ax-btn--sm" id="examV2CurrEditBtn" title="Edit row by ID">Edit</button>
            <button class="ax-btn ax-btn--delete ax-btn--sm" id="examV2CurrDeleteBtn" title="Delete row by ID">Delete</button>
            <button class="ax-btn ax-btn--generate ax-btn--sm" id="examV2CurrSeedJssBtn" title="Load Grade 7-9 Pre-Tech + Social">Seed G7-9</button>
            <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2CurrRefreshBtn" title="Refresh">Refresh</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2CurrTemplateBtn" title="Download import template">Template</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2CurrDownloadBtn" title="Download rows">Download</button>
          </div>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>#</th><th>Level</th><th>Learning Area</th><th>Strand</th><th>Strand Desc</th><th>Sub-strand</th><th>Sub Desc</th></tr></thead>
              <tbody id="examV2CurrDraftRows"><tr><td colspan="7">No draft rows yet.</td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="exam-v2-pane">
          <h4>Learning Materials & AI Notes</h4>
          <p class="small-note exam-tight-note">Select grade/form and learning area first, then upload notes or paste text; materials are available immediately after save.</p>
          <div class="form-grid form-grid--exam-tight">
            <label>Grade/Form</label>
            <select id="examV2MatLevel"><option value="">Select grade or form</option>${[...gradeOptions, ...formOptions].map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Learning Area</label>
            <select id="examV2MatLearningArea"><option value="">Select learning area</option>${learningAreas.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Material Type</label>
            <select id="examV2MaterialType"><option value="notes">Notes</option><option value="past_papers">Past Papers</option><option value="sample_exams">Sample Exams</option><option value="other">Other</option></select>
            <label>Strand (Optional)</label>
            <input id="examV2MatStrand" placeholder="Strand for this upload" />
            <label>Sub-strand (Optional)</label>
            <input id="examV2MatSubStrand" placeholder="Sub-strand for this upload" />
            <label>Material Title</label>
            <input id="examV2MaterialTitle" placeholder="Material title" />
            <label>Upload File</label>
            <input id="examV2MaterialFile" type="file" />
            <label>Paste Notes / Exam Text</label>
            <textarea id="examV2MaterialPaste" rows="6" placeholder="Paste content here when PDF upload is not available..."></textarea>
            <label>Notes Output</label>
            <textarea id="examV2NotesOutput" rows="8" placeholder="Generated notes appear here..."></textarea>
          </div>
          <div class="actions-row exam-icon-group">
            <button class="ax-btn ax-btn--upload ax-btn--sm" id="examV2MaterialUploadBtn" title="Upload material">Upload</button>
            <button class="ax-btn ax-btn--save ax-btn--sm" id="examV2MaterialPasteSaveBtn" title="Save pasted notes">Save Paste</button>
            <button class="ax-btn ax-btn--generate ax-btn--sm" id="examV2NotesGenerateBtn" title="AI generate notes">AI Generate</button>
            <button class="ax-btn ax-btn--print ax-btn--sm" id="examV2NotesPrintBtn" title="Print notes">Print</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2NotesDownloadBtn" title="Download notes">Download</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2NotesTemplateBtn" title="Download notes template">Notes Template</button>
            <label for="examV2NotesTemplateUploadInput" class="ax-btn ax-btn--upload ax-btn--sm exam-stack-top">Upload Notes Template</label>
            <input id="examV2NotesTemplateUploadInput" type="file" accept=".txt,.md,.csv" hidden />
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2LessonPlanTemplateBtn" title="Lesson plan template">Lesson Plan</button>
            <button class="ax-btn ax-btn--view ax-btn--sm" id="examV2MaterialViewBtn" title="View materials">View</button>
          </div>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>ID</th><th>Type</th><th>Title</th><th>Grade/Form</th><th>Path</th><th>Actions</th></tr></thead>
              <tbody id="examV2MaterialRows">
                ${materials.length
                  ? materials.slice(0, 120).map((row) => `
                    <tr>
                      <td>${escapeHtml(String(row.id || "-"))}</td>
                      <td>${escapeHtml(row.resource_type || "-")}</td>
                      <td>${escapeHtml(row.title || "-")}</td>
                      <td>${escapeHtml(row.grade || row.form_name || "-")}</td>
                      <td>${escapeHtml(row.file_path || "-")}</td>
                      <td>
                        <button class="ax-btn ax-btn--delete ax-btn--sm" data-material-delete="${Number(row.id || 0)}" title="Delete uploaded material">Delete</button>
                      </td>
                    </tr>
                  `).join("")
                  : `<tr><td colspan="6">No materials uploaded yet.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <h4>Registered Curriculum Rows</h4>
      <div class="dashboard-table-wrap">
        <table class="dashboard-table">
          <thead><tr><th>ID</th><th>Level</th><th>Learning Area</th><th>Strand</th><th>Strand Desc</th><th>Sub-strand</th><th>Sub Desc</th><th>Created</th></tr></thead>
          <tbody id="examV2CurrSavedRows">
            ${rows.length
              ? rows.slice(0, 200).map((row) => `
                <tr>
                  <td>${escapeHtml(String(row.id || "-"))}</td>
                  <td>${escapeHtml(row.grade || row.form_name || "-")}</td>
                  <td>${escapeHtml(row.learning_area || "-")}</td>
                  <td>${escapeHtml(row.strand || "-")}</td>
                  <td>${escapeHtml(row.suggested_assessment_rubric || "-")}</td>
                  <td>${escapeHtml(row.sub_strand || "-")}</td>
                  <td>${escapeHtml(row.specific_learning_outcomes || "-")}</td>
                  <td>${escapeHtml(formatDateTime(row.created_at))}</td>
                </tr>
              `).join("")
              : `<tr><td colspan="8">No curriculum rows found.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;
    stylePanel();

    const levelEl = document.getElementById("examV2CurrLevel");
    const areaEl = document.getElementById("examV2CurrLearningArea");
    const strandEl = document.getElementById("examV2CurrStrand");
    const strandDescEl = document.getElementById("examV2CurrStrandDesc");
    const subEl = document.getElementById("examV2CurrSubStrand");
    const subDescEl = document.getElementById("examV2CurrSubStrandDesc");
    const notesEl = document.getElementById("examV2CurrNotes");
    const cbcLevelEl = document.getElementById("examV2CurrCbcLevel");
    const matLevelEl = document.getElementById("examV2MatLevel");
    const matAreaEl = document.getElementById("examV2MatLearningArea");
    const matStrandEl = document.getElementById("examV2MatStrand");
    const matSubEl = document.getElementById("examV2MatSubStrand");
    const draftBody = document.getElementById("examV2CurrDraftRows");
    const notesOutEl = document.getElementById("examV2NotesOutput");
    const materialRowsEl = document.getElementById("examV2MaterialRows");

    const parseLevelChoice = (value = "") => {
      const label = String(value || "").trim();
      if (!label) return { grade: "", form_name: "" };
      if (/^form/i.test(label)) return { grade: "", form_name: label };
      return { grade: label, form_name: "" };
    };
    const parseLevelToken = (label = "") => {
      const raw = String(label || "").trim();
      const pp = raw.match(/^pp\s*(\d+)/i);
      if (pp) return { kind: "pp", level: Number(pp[1]) };
      const grade = raw.match(/^grade\s*(\d+)/i);
      if (grade) return { kind: "grade", level: Number(grade[1]) };
      const form = raw.match(/^form\s*(\d+)/i);
      if (form) return { kind: "form", level: Number(form[1]) };
      return { kind: "unknown", level: null };
    };
    const minLevelByBand = ({ kind, level }) => {
      if (kind === "pp") return 1;
      if (kind === "form") return 3;
      if (kind !== "grade") return null;
      if (level <= 3) return 1;
      if (level <= 6) return 4;
      if (level <= 9) return 7;
      return 10;
    };
    const withinCurriculumRange = (rowLevel = "", selectedLevel = "") => {
      const rowMeta = parseLevelToken(rowLevel);
      const selectedMeta = parseLevelToken(selectedLevel);
      if (selectedMeta.kind === "unknown" || rowMeta.kind === "unknown") return false;
      if (selectedMeta.kind !== rowMeta.kind) return false;
      const floor = minLevelByBand(selectedMeta);
      if (floor === null) return String(rowLevel).trim().toLowerCase() === String(selectedLevel).trim().toLowerCase();
      return Number(rowMeta.level) >= Number(floor) && Number(rowMeta.level) <= Number(selectedMeta.level);
    };
    const buildNotesTemplateText = () => {
      const selectedLevel = String(matLevelEl?.value || "").trim();
      const selectedArea = String(matAreaEl?.value || "").trim();
      if (!selectedLevel || !selectedArea) {
        return [
          "NOTES TEMPLATE",
          "Select Grade/Form and Learning Area before downloading template.",
          "",
          "Fields:",
          "- Strand",
          "- Sub-strand",
          "- Lesson Objectives",
          "- Content Notes",
          "- Activities",
          "- Assessment",
          "- Missing Gaps To Cover"
        ].join("\n");
      }
      const scopedRows = rows
        .filter((row) => String(row.learning_area || "").trim().toLowerCase() === selectedArea.toLowerCase())
        .filter((row) => withinCurriculumRange(String(row.grade || row.form_name || "").trim(), selectedLevel));
      const grouped = new Map();
      scopedRows.forEach((row) => {
        const strand = String(row.strand || "").trim();
        const sub = String(row.sub_strand || "").trim();
        if (!strand) return;
        if (!grouped.has(strand)) grouped.set(strand, []);
        if (sub) grouped.get(strand).push(sub);
      });
      const sections = Array.from(grouped.entries()).map(([strand, subs], index) => [
        `${index + 1}. STRAND: ${strand}`,
        `   GRADE/FORM SCOPE: ${selectedLevel}`,
        `   SUB-STRANDS: ${subs.length ? subs.join(" | ") : "-"}`,
        "   LESSON OBJECTIVES:",
        "   CONTENT NOTES:",
        "   CLASS ACTIVITIES:",
        "   ASSESSMENT TASKS:",
        "   MISSING GAPS TO ADD:"
      ].join("\n"));
      return [
        "ADVANCED NOTES TEMPLATE",
        `LEARNING AREA: ${selectedArea}`,
        `GRADE/FORM: ${selectedLevel}`,
        "INSTRUCTIONS: Edit this template, then upload via Upload Notes Template button.",
        "",
        sections.length ? sections.join("\n\n") : "No curriculum rows found yet for this level/learning area."
      ].join("\n");
    };

    const renderDraftRows = () => {
      if (!draftBody) return;
      draftBody.innerHTML = draftRows.length
        ? draftRows.map((row, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(row.grade || row.form_name || "-")}</td>
            <td>${escapeHtml(row.learning_area || "-")}</td>
            <td>${escapeHtml(row.strand || "-")}</td>
            <td>${escapeHtml(row.strand_description || "-")}</td>
            <td>${escapeHtml(row.sub_strand || "-")}</td>
            <td>${escapeHtml(row.sub_strand_description || "-")}</td>
          </tr>
        `).join("")
        : `<tr><td colspan="7">No draft rows yet.</td></tr>`;
    };

    document.getElementById("examV2CurrAddRowBtn")?.addEventListener("click", async () => {
      const levelPayload = parseLevelChoice(String(levelEl?.value || ""));
      const grade = levelPayload.grade;
      const form_name = levelPayload.form_name;
      const learning_area = String(areaEl?.value || "");
      const strand = String(strandEl?.value || "").trim();
      const strand_description = String(strandDescEl?.value || "").trim();
      const sub_strand = String(subEl?.value || "").trim();
      const sub_strand_description = String(subDescEl?.value || "").trim();
      if ((!grade && !form_name) || !learning_area || !strand) {
        alert("Select level, learning area and strand.");
        return;
      }
      const cbcLevel = String(cbcLevelEl?.value || "").trim();
      const notes = String(notesEl?.value || "").trim();
      draftRows.push({
        grade,
        form_name,
        learning_area,
        strand,
        strand_description,
        sub_strand,
        sub_strand_description,
        notes,
        specific_learning_outcomes: sub_strand_description || notes,
        learning_experiences: "",
        suggested_assessment_rubric: [cbcLevel ? `CBC Level: ${cbcLevel}` : "", strand_description].filter(Boolean).join(" | "),
        term: "Term One",
        year: new Date().getFullYear()
      });
      renderDraftRows();
      setStatus(`Draft rows: ${draftRows.length}`);
    });

    document.getElementById("examV2CurrPrepareSlotsBtn")?.addEventListener("click", () => {
      const mode = String(document.getElementById("examV2CurrMode")?.value || "new");
      if (mode !== "new") {
        alert('Set mode to "New entries" to prepare strand slots.');
        return;
      }
      const slots = Number(document.getElementById("examV2CurrStrandSlots")?.value || 1);
      if (!Number.isFinite(slots) || slots < 1 || slots > 40) {
        alert("Enter a strand slot count between 1 and 40.");
        return;
      }
      const levelPayload = parseLevelChoice(String(levelEl?.value || ""));
      const grade = levelPayload.grade;
      const form_name = levelPayload.form_name;
      const learning_area = String(areaEl?.value || "");
      const cbcLevel = String(cbcLevelEl?.value || "").trim();
      if ((!grade && !form_name) || !learning_area) {
        alert("Select grade/form and learning area first.");
        return;
      }
      for (let i = 1; i <= slots; i += 1) {
        draftRows.push({
          grade,
          form_name,
          learning_area,
          strand: `Strand ${i} (rename)`,
          strand_description: "",
          sub_strand: `Sub-strand ${i} (rename)`,
          sub_strand_description: "",
          notes: "",
          specific_learning_outcomes: "",
          learning_experiences: "",
          suggested_assessment_rubric: cbcLevel ? `CBC Level: ${cbcLevel}` : "",
          term: "Term One",
          year: new Date().getFullYear()
        });
      }
      renderDraftRows();
      setStatus(`Prepared ${slots} strand slot row(s). Edit names then Save.`);
    });

    document.getElementById("examV2CurrSaveBtn")?.addEventListener("click", async () => {
      if (!draftRows.length) {
        alert("Add at least one draft row first.");
        return;
      }
      try {
        for (const row of draftRows) {
          await request("/api/cbc/curriculum", { method: "POST", body: JSON.stringify(row) });
          await request("/api/cbc/curriculum/structure-mappings", {
            method: "POST",
            body: JSON.stringify({
              learning_area: row.learning_area,
              grade: row.grade || null,
              form_name: row.form_name || null,
              strand: row.strand,
              sub_strand: row.sub_strand || "",
              source_label: "EXAM_V2_CURRICULUM",
              notes: [row.strand_description ? `Strand Description: ${row.strand_description}` : "", row.sub_strand_description ? `Sub-strand Description: ${row.sub_strand_description}` : "", row.notes || ""].filter(Boolean).join("\n")
            })
          });
        }
        setStatus(`${draftRows.length} curriculum row(s) saved.`);
        await renderCurriculumTab();
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("examV2CurrEditBtn")?.addEventListener("click", async () => {
      const id = Number(prompt("Enter curriculum row ID to edit:", "") || 0);
      if (!id) return;
      const nextStrand = prompt("New strand:", "") || "";
      const nextStrandDesc = prompt("New strand description:", "") || "";
      const nextSub = prompt("New sub-strand:", "") || "";
      const nextSubDesc = prompt("New sub-strand description:", "") || "";
      const nextNotes = prompt("New notes (optional):", "") || "";
      try {
        await request(`/api/cbc/curriculum/${id}`, {
          method: "PUT",
          body: JSON.stringify({
            strand: nextStrand,
            sub_strand: nextSub,
            suggested_assessment_rubric: nextStrandDesc,
            specific_learning_outcomes: nextSubDesc,
            notes: nextNotes
          })
        });
        setStatus(`Curriculum row ${id} updated.`);
        await renderCurriculumTab();
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("examV2CurrDeleteBtn")?.addEventListener("click", async () => {
      const id = Number(prompt("Enter curriculum row ID to delete:", "") || 0);
      if (!id) return;
      if (!window.confirm(`Delete curriculum row #${id}?`)) return;
      try {
        await request(`/api/cbc/curriculum/${id}`, { method: "DELETE" });
        setStatus(`Curriculum row ${id} deleted.`);
        await renderCurriculumTab();
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("examV2CurrRefreshBtn")?.addEventListener("click", renderCurriculumTab);
    document.getElementById("examV2CurrTemplateBtn")?.addEventListener("click", async () => {
      await downloadWithAuth("/api/cbc/curriculum/structure-mappings/template", "cbc-structure-mappings-template.csv");
    });
    document.getElementById("examV2CurrSeedJssBtn")?.addEventListener("click", async () => {
      if (!window.confirm("Load Grade 7-9 Pre-Technical + Social Studies strands/sub-strands with descriptions?")) return;
      try {
        const result = await request("/api/cbc/curriculum/pretechnical-seed", {
          method: "POST",
          body: JSON.stringify({ replace_existing: false, refresh_descriptions: true })
        });
        setStatus(result?.message || "JSS seed loaded.");
        await renderCurriculumTab();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("examV2CurrDownloadBtn")?.addEventListener("click", () => {
      if (!rows.length) {
        alert("No rows to download.");
        return;
      }
      const csv = rowsToCsv(rows.map((row) => ({
        id: row.id,
        level: row.grade || row.form_name || "",
        learning_area: row.learning_area || "",
        strand: row.strand || "",
        strand_description: row.suggested_assessment_rubric || "",
        sub_strand: row.sub_strand || "",
        sub_strand_description: row.specific_learning_outcomes || ""
      })));
      downloadTextFile("exam-curriculum-rows.csv", csv, "text/csv;charset=utf-8");
    });

    document.getElementById("examV2MaterialUploadBtn")?.addEventListener("click", async () => {
      const file = document.getElementById("examV2MaterialFile")?.files?.[0];
      if (!file) {
        alert("Choose a file first.");
        return;
      }
      const levelPayload = parseLevelChoice(String(matLevelEl?.value || ""));
      const grade = levelPayload.grade;
      const form_name = levelPayload.form_name;
      const learning_area = String(matAreaEl?.value || "");
      if ((!grade && !form_name) || !learning_area) {
        alert("Select grade/form and learning area in Learning Materials section before upload.");
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("resource_type", String(document.getElementById("examV2MaterialType")?.value || "notes"));
      formData.append("title", String(document.getElementById("examV2MaterialTitle")?.value || file.name));
      formData.append("description", `Exam V2 upload: ${learning_area}`);
      formData.append("grade", grade);
      formData.append("form_name", form_name);
      formData.append("learning_area", learning_area);
      formData.append("strand", String(matStrandEl?.value || "").trim());
      formData.append("sub_strand", String(matSubEl?.value || "").trim());
      formData.append("term", "Term One");
      const response = await fetch("/api/cbc/curriculum/materials/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Upload failed.");
        return;
      }
      setStatus(result.message || "Material uploaded.");
      await renderCurriculumTab();
    });
    document.getElementById("examV2MaterialPasteSaveBtn")?.addEventListener("click", async () => {
      const pastedText = String(document.getElementById("examV2MaterialPaste")?.value || "").trim();
      if (!pastedText) {
        alert("Paste notes/exam text first.");
        return;
      }
      const levelPayload = parseLevelChoice(String(matLevelEl?.value || ""));
      const grade = levelPayload.grade;
      const form_name = levelPayload.form_name;
      const learning_area = String(matAreaEl?.value || "");
      if ((!grade && !form_name) || !learning_area) {
        alert("Select grade/form and learning area in Learning Materials section before saving pasted text.");
        return;
      }
      const titleValue = String(document.getElementById("examV2MaterialTitle")?.value || "").trim();
      const fileStem = (titleValue || `${learning_area}-${grade || form_name}-notes`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "pasted-notes";
      const textFile = new File([pastedText], `${fileStem}.txt`, { type: "text/plain;charset=utf-8" });
      const formData = new FormData();
      formData.append("file", textFile);
      formData.append("resource_type", String(document.getElementById("examV2MaterialType")?.value || "notes"));
      formData.append("title", titleValue || `${learning_area} pasted notes`);
      formData.append("description", `Exam V2 pasted text: ${learning_area}`);
      formData.append("grade", grade);
      formData.append("form_name", form_name);
      formData.append("learning_area", learning_area);
      formData.append("strand", String(matStrandEl?.value || "").trim());
      formData.append("sub_strand", String(matSubEl?.value || "").trim());
      formData.append("term", "Term One");
      const response = await fetch("/api/cbc/curriculum/materials/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Saving pasted notes failed.");
        return;
      }
      setStatus(result.message || "Pasted notes saved.");
      await renderCurriculumTab();
    });

    document.getElementById("examV2NotesGenerateBtn")?.addEventListener("click", async () => {
      const payload = {
        grade: parseLevelChoice(String(matLevelEl?.value || levelEl?.value || "")).grade,
        form_name: parseLevelChoice(String(matLevelEl?.value || levelEl?.value || "")).form_name,
        learning_area: String(matAreaEl?.value || areaEl?.value || ""),
        strand: String(matStrandEl?.value || strandEl?.value || "").trim(),
        sub_strand: String(matSubEl?.value || subEl?.value || "").trim()
      };
      if ((!payload.grade && !payload.form_name) || !payload.learning_area || !payload.strand) {
        alert("Select grade/form, learning area and strand before note generation.");
        return;
      }
      try {
        const generated = await request("/api/cbc/curriculum/ai-generate-notes", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        if (notesOutEl) notesOutEl.value = String(generated?.generated_notes || "").trim();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("examV2NotesPrintBtn")?.addEventListener("click", () => {
      const text = String(notesOutEl?.value || "").trim();
      if (!text) {
        alert("Generate notes first.");
        return;
      }
      const popup = window.open("", "_blank");
      if (!popup) return;
      popup.document.write(`<pre>${escapeHtml(text)}</pre>`);
      popup.document.close();
      popup.print();
    });
    document.getElementById("examV2NotesDownloadBtn")?.addEventListener("click", () => {
      const text = String(notesOutEl?.value || "").trim();
      if (!text) {
        alert("Generate notes first.");
        return;
      }
      downloadTextFile("exam-engine-notes.txt", text);
    });
    document.getElementById("examV2NotesTemplateBtn")?.addEventListener("click", () => {
      const templateText = buildNotesTemplateText();
      const areaToken = String(matAreaEl?.value || "learning-area")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "learning-area";
      const levelToken = String(matLevelEl?.value || "level")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "level";
      downloadTextFile(`notes-template-${areaToken}-${levelToken}.txt`, templateText);
      if (notesOutEl) notesOutEl.value = templateText;
    });
    document.getElementById("examV2NotesTemplateUploadInput")?.addEventListener("change", async (event) => {
      const file = event?.target?.files?.[0];
      if (!file) return;
      const levelPayload = parseLevelChoice(String(matLevelEl?.value || ""));
      const grade = levelPayload.grade;
      const form_name = levelPayload.form_name;
      const learning_area = String(matAreaEl?.value || "");
      if ((!grade && !form_name) || !learning_area) {
        alert("Select grade/form and learning area before uploading notes template.");
        event.target.value = "";
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("resource_type", "notes_template");
      formData.append("title", `${learning_area} Notes Template ${grade || form_name}`);
      formData.append("description", `Learning Area: ${learning_area}\nTemplate Kind: NOTES_TEMPLATE`);
      formData.append("grade", grade);
      formData.append("form_name", form_name);
      formData.append("learning_area", learning_area);
      formData.append("strand", String(matStrandEl?.value || "").trim());
      formData.append("sub_strand", String(matSubEl?.value || "").trim());
      formData.append("term", "Term One");
      const response = await fetch("/api/cbc/curriculum/materials/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Template upload failed.");
        event.target.value = "";
        return;
      }
      setStatus(result.message || "Notes template uploaded.");
      event.target.value = "";
      await renderCurriculumTab();
    });
    document.getElementById("examV2LessonPlanTemplateBtn")?.addEventListener("click", async () => {
      await downloadWithAuth("/api/templates/lesson-plan.csv", "lesson-plan-template.csv");
    });
    materialRowsEl?.addEventListener("click", async (event) => {
      const targetBtn = event.target?.closest?.("[data-material-delete]");
      if (!targetBtn) return;
      const materialId = Number(targetBtn.getAttribute("data-material-delete") || 0);
      if (!materialId) return;
      if (!window.confirm(`Delete uploaded material #${materialId}?`)) return;
      try {
        await request(`/api/cbc/curriculum/materials/${materialId}`, { method: "DELETE" });
        setStatus(`Material #${materialId} deleted.`);
        await renderCurriculumTab();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("examV2MaterialViewBtn")?.addEventListener("click", renderCurriculumTab);
  };

  const renderExamGenerationTab = async () => {
    const gradeFormOptions = [...gradeOptions, ...formOptions];
    panel.innerHTML = `
      <div class="exam-v2-layout exam-module-compact">
        <div class="exam-v2-pane">
          <h4>Exam Generation</h4>
          <p class="small-note exam-tight-note">Session → Year → Term → Grade/Form → Stream → Area → strands/sub-strands → structure → output.</p>
          <div class="form-grid form-grid--exam-tight">
            <label>Examination Session</label>
            <select id="examV2GenSession"><option value="">Select session</option>${examSessions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Academic Year</label>
            <input id="examV2GenYear" value="${new Date().getFullYear()}/${new Date().getFullYear() + 1}" disabled />
            <label>Term</label>
            <select id="examV2GenTerm" disabled><option value="">Select term</option>${termOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Grade/Form</label>
            <select id="examV2GenLevel" disabled><option value="">Select Grade/Form</option>${gradeFormOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Stream</label>
            <select id="examV2GenStreamSelect" disabled><option value="">Select stream</option><option value="N/A">N/A</option></select>
            <label>Stream (manual)</label>
            <input id="examV2GenStreamManual" placeholder="If missing" disabled />
            <label>Learning Area</label>
            <select id="examV2GenArea" disabled><option value="">Select learning area</option>${learningAreas.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Exam duration (hours)</label>
            <select id="examV2GenDurH" disabled>${[0, 1, 2, 3].map((h) => `<option value="${h}"${h === 1 ? " selected" : ""}>${h}</option>`).join("")}</select>
            <label>Exam duration (minutes)</label>
            <select id="examV2GenDurM" disabled>${[0, 15, 30, 45].map((m) => `<option value="${m}"${m === 30 ? " selected" : ""}>${m}</option>`).join("")}</select>
            <label>Strands</label>
            <div id="examV2GenStrandsPanel" class="exam-strand-panel"></div>
            <div class="actions-row exam-icon-group exam-actions-tight" style="grid-column:1/-1;">
              <button class="ax-btn ax-btn--view ax-btn--sm" id="examV2GenSelectAllStrandsBtn" title="Select all strands" disabled>Select All</button>
              <button class="ax-btn ax-btn--delete ax-btn--sm" id="examV2GenDeselectStrandsBtn" title="Deselect all strands" disabled>Deselect</button>
              <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2GenInvertStrandsBtn" title="Invert strand selection" disabled>Invert</button>
              <button class="ax-btn ax-btn--delete ax-btn--sm" id="examV2GenClearStrandsBtn" title="Delete strand selections" disabled>Clear</button>
            </div>
            <div id="examV2GenSelectedStrands" class="small-note" style="grid-column:1/-1;">No strand selected.</div>
            <label>Sub-strands</label>
            <div id="examV2GenSubsPanel" class="exam-strand-panel"></div>
            <div class="actions-row exam-icon-group exam-actions-tight" style="grid-column:1/-1;">
              <button class="ax-btn ax-btn--view ax-btn--sm" id="examV2GenSelectAllSubsBtn" title="Select all sub-strands" disabled>Select All</button>
              <button class="ax-btn ax-btn--delete ax-btn--sm" id="examV2GenDeselectSubsBtn" title="Deselect all sub-strands" disabled>Deselect</button>
              <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2GenInvertSubsBtn" title="Invert sub-strand selection" disabled>Invert</button>
              <button class="ax-btn ax-btn--delete ax-btn--sm" id="examV2GenClearSubsBtn" title="Delete sub-strand selections" disabled>Clear</button>
            </div>
            <div id="examV2GenSelectedSubs" class="small-note" style="grid-column:1/-1;">No sub-strand selected.</div>
            <label>Exam Structure</label>
            <select id="examV2GenStructure" disabled><option value="unified">Unified</option><option value="structured">Structured</option><option value="multi-section">Multi-section</option></select>
            <label>Structure Details</label>
            <select id="examV2GenStructureDetail" disabled><option value="">Select details</option></select>
            <label>Unified Allocation Mode</label>
            <select id="examV2GenAllocMode" disabled><option value="manual">Manual Entry</option><option value="automated">Automated</option></select>
            <label>Unified Automated %</label>
            <select id="examV2GenAutoPercent" disabled><option value="">Select %</option>${[100, 90, 80, 70, 60, 50, 40, 30, 20, 10].map((v) => `<option value="${v}">${v}</option>`).join("")}</select>
            <label>Unified Manual %</label>
            <input id="examV2GenManualPercent" type="number" min="10" max="100" step="1" value="100" disabled />
            <label id="examV2GenSectionALabel">Section/Paper A %</label>
            <input id="examV2GenSectionA" type="number" min="0" max="100" step="1" value="0" disabled />
            <label id="examV2GenSectionBLabel">Section/Paper B %</label>
            <input id="examV2GenSectionB" type="number" min="0" max="100" step="1" value="0" disabled />
            <label id="examV2GenSectionCLabel">Section/Paper C %</label>
            <input id="examV2GenSectionC" type="number" min="0" max="100" step="1" value="0" disabled />
            <label>Output Mode</label>
            <select id="examV2GenMode" disabled><option value="">Select output mode</option><option value="per_learner">Per Learner</option><option value="per_stream">Per Stream</option><option value="per_class">Per Class</option></select>
            <label>Edit Generated Exam?</label>
            <select id="examV2GenEditChoice" disabled><option value="no">No</option><option value="yes">Yes</option></select>
            <label>Download Output Mode</label>
            <select id="examV2GenDeliveryMode" disabled><option value="">Select mode</option><option value="download">Download</option><option value="print">Print</option></select>
          </div>
          <div class="actions-row exam-icon-group">
            <button class="ax-btn ax-btn--generate ax-btn--sm" id="examV2GenGenerateBtn" title="Generate exam with selected scope" disabled>Generate</button>
            <button class="ax-btn ax-btn--save ax-btn--sm" id="examV2GenSaveEditedBtn" title="Save edited exam" disabled>Save Edit</button>
            <button class="ax-btn ax-btn--process ax-btn--sm" id="examV2GenProcessBtn" title="Process output" disabled>Process</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2GenRunDeliveryBtn" title="Run output mode" disabled>Output</button>
            <button class="ax-btn ax-btn--view ax-btn--sm" id="examV2GenViewBtn" title="View recent exams">View</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2GenSampleBtn" title="Download sample paper">Sample</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2GenTemplateDownloadBtn" title="Download structure template" disabled>Tpl Download</button>
            <label for="examV2GenTemplateUploadFile" class="ax-btn ax-btn--upload ax-btn--sm exam-stack-top">Tpl Upload</label>
            <input id="examV2GenTemplateUploadFile" type="file" accept=".txt,.md,.csv,.doc,.docx" hidden />
          </div>
          <textarea id="examV2GenOutput" rows="16" class="template-spacious" placeholder="Generated exam text appears here..." readonly></textarea>
          <details class="exam-v2-collapse" open>
            <summary>Teacher Marking Scheme Center</summary>
            <p class="small-note">After processing the exam, generate a fully aligned marking scheme with correct answers, then review/edit/print/download.</p>
            <div class="actions-row exam-icon-group">
              <button class="ax-btn ax-btn--generate ax-btn--sm" id="examV2GenSchemeGenerateBtn" title="Generate marking scheme" disabled>Generate Scheme</button>
              <button class="ax-btn ax-btn--view ax-btn--sm" id="examV2GenSchemeViewBtn" title="View marking scheme" disabled>View</button>
              <button class="ax-btn ax-btn--save ax-btn--sm" id="examV2GenSchemeSaveBtn" title="Save marking scheme" disabled>Save</button>
              <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2GenSchemeDownloadBtn" title="Download marking scheme" disabled>Download</button>
              <button class="ax-btn ax-btn--print ax-btn--sm" id="examV2GenSchemePrintBtn" title="Print marking scheme" disabled>Print</button>
            </div>
            <textarea id="examV2GenSchemeOutput" rows="14" class="template-spacious" placeholder="Generated teacher marking scheme appears here..." readonly></textarea>
            <div id="examV2GenSchemeStatus" class="small-note">Marking scheme will activate after Process.</div>
          </details>
          <details class="exam-v2-collapse">
            <summary>Serial Number Generation Center</summary>
            <p class="small-note">Serials are generated per institution, grade/form, learning area, stream and learner after Process.</p>
            <div class="dashboard-table-wrap">
              <table class="dashboard-table">
                <thead><tr><th>Institution</th><th>Grade/Form</th><th>Learning Area</th><th>Stream</th><th>Learner</th><th>Admission</th><th>Serial</th><th>QR</th></tr></thead>
                <tbody id="examV2GenSerialRows"><tr><td colspan="8">No serials generated yet.</td></tr></tbody>
              </table>
            </div>
          </details>
          <details class="exam-v2-collapse">
            <summary>Sample Template Factory (All Structures)</summary>
            <p class="small-note">Generate editable samples per structure, download in Word format, modify, and upload final template.</p>
            <div class="form-grid">
              <label>Sample Grade/Form</label>
              <select id="examV2SampleLevel">${gradeFormOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
              <label>Sample Learning Area</label>
              <select id="examV2SampleArea">${learningAreas.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
              <label>Sample Structure</label>
              <select id="examV2SampleStructure"><option value="unified">Unified</option><option value="structured">Structured</option><option value="multi-section">Multi-section</option></select>
              <label>Sample Detail</label>
              <select id="examV2SampleDetail"><option value="">Default</option></select>
              <label>Sample Exam Session</label>
              <select id="examV2SampleSession">${examSessions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
              <label>Sample Academic Year</label>
              <input id="examV2SampleAcademicYear" value="${new Date().getFullYear()}/${new Date().getFullYear() + 1}" />
              <label>Sample Term</label>
              <select id="examV2SampleTerm">${termOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            </div>
            <div class="actions-row exam-icon-group">
              <button class="ax-btn ax-btn--generate ax-btn--sm" id="examV2SampleGenerateBtn" title="Generate sample">Generate Sample</button>
              <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2SampleWordBtn" title="Download Word template">Word</button>
              <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2SampleTextBtn" title="Download text template">Text</button>
              <button class="ax-btn ax-btn--save ax-btn--sm" id="examV2SampleSaveBtn" title="Save sample as template">Save Template</button>
              <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2SamplePackBtn" title="Generate all JSS sample pack">JSS Pack</button>
              <label for="examV2SampleUploadInput" class="ax-btn ax-btn--upload ax-btn--sm exam-stack-top">Upload Final</label>
              <input id="examV2SampleUploadInput" type="file" accept=".txt,.md,.csv,.doc,.docx,.html" hidden />
            </div>
            <textarea id="examV2SamplePreview" rows="12" class="template-spacious" placeholder="Generated sample preview appears here..."></textarea>
          </details>
          <div id="examV2GenStatus" class="small-note">Select examination session to activate workflow.</div>
        </div>
      </div>
    `;
    stylePanel();

    const sessionEl = document.getElementById("examV2GenSession");
    const yearEl = document.getElementById("examV2GenYear");
    const termEl = document.getElementById("examV2GenTerm");
    const levelEl = document.getElementById("examV2GenLevel");
    const streamSelectEl = document.getElementById("examV2GenStreamSelect");
    const streamManualEl = document.getElementById("examV2GenStreamManual");
    const durHEl = document.getElementById("examV2GenDurH");
    const durMEl = document.getElementById("examV2GenDurM");
    const areaEl = document.getElementById("examV2GenArea");
    const strandsPanelEl = document.getElementById("examV2GenStrandsPanel");
    const subsPanelEl = document.getElementById("examV2GenSubsPanel");
    const clearStrandsBtn = document.getElementById("examV2GenClearStrandsBtn");
    const clearSubsBtn = document.getElementById("examV2GenClearSubsBtn");
    const selectAllStrandsBtn = document.getElementById("examV2GenSelectAllStrandsBtn");
    const deselectStrandsBtn = document.getElementById("examV2GenDeselectStrandsBtn");
    const invertStrandsBtn = document.getElementById("examV2GenInvertStrandsBtn");
    const selectAllSubsBtn = document.getElementById("examV2GenSelectAllSubsBtn");
    const deselectSubsBtn = document.getElementById("examV2GenDeselectSubsBtn");
    const invertSubsBtn = document.getElementById("examV2GenInvertSubsBtn");
    const selectedStrandsInfoEl = document.getElementById("examV2GenSelectedStrands");
    const selectedSubsInfoEl = document.getElementById("examV2GenSelectedSubs");
    const structureEl = document.getElementById("examV2GenStructure");
    const structureDetailEl = document.getElementById("examV2GenStructureDetail");
    const allocModeEl = document.getElementById("examV2GenAllocMode");
    const autoPercentEl = document.getElementById("examV2GenAutoPercent");
    const manualPercentEl = document.getElementById("examV2GenManualPercent");
    const sectionALabelEl = document.getElementById("examV2GenSectionALabel");
    const sectionBLabelEl = document.getElementById("examV2GenSectionBLabel");
    const sectionCLabelEl = document.getElementById("examV2GenSectionCLabel");
    const sectionAEl = document.getElementById("examV2GenSectionA");
    const sectionBEl = document.getElementById("examV2GenSectionB");
    const sectionCEl = document.getElementById("examV2GenSectionC");
    const outputModeEl = document.getElementById("examV2GenMode");
    const editChoiceEl = document.getElementById("examV2GenEditChoice");
    const deliveryModeEl = document.getElementById("examV2GenDeliveryMode");
    const outputEl = document.getElementById("examV2GenOutput");
    const schemeOutputEl = document.getElementById("examV2GenSchemeOutput");
    const schemeStatusNode = document.getElementById("examV2GenSchemeStatus");
    const schemeGenerateBtn = document.getElementById("examV2GenSchemeGenerateBtn");
    const schemeViewBtn = document.getElementById("examV2GenSchemeViewBtn");
    const schemeSaveBtn = document.getElementById("examV2GenSchemeSaveBtn");
    const schemeDownloadBtn = document.getElementById("examV2GenSchemeDownloadBtn");
    const schemePrintBtn = document.getElementById("examV2GenSchemePrintBtn");
    const serialRowsEl = document.getElementById("examV2GenSerialRows");
    const statusNode = document.getElementById("examV2GenStatus");
    const generateBtn = document.getElementById("examV2GenGenerateBtn");
    const saveEditedBtn = document.getElementById("examV2GenSaveEditedBtn");
    const processBtn = document.getElementById("examV2GenProcessBtn");
    const runDeliveryBtn = document.getElementById("examV2GenRunDeliveryBtn");
    const templateDownloadBtn = document.getElementById("examV2GenTemplateDownloadBtn");
    const sampleBtn = document.getElementById("examV2GenSampleBtn");
    const templateUploadInput = document.getElementById("examV2GenTemplateUploadFile");
    const sampleLevelEl = document.getElementById("examV2SampleLevel");
    const sampleAreaEl = document.getElementById("examV2SampleArea");
    const sampleStructureEl = document.getElementById("examV2SampleStructure");
    const sampleDetailEl = document.getElementById("examV2SampleDetail");
    const sampleSessionEl = document.getElementById("examV2SampleSession");
    const sampleAcademicYearEl = document.getElementById("examV2SampleAcademicYear");
    const sampleTermEl = document.getElementById("examV2SampleTerm");
    const samplePreviewEl = document.getElementById("examV2SamplePreview");
    const sampleGenerateBtn = document.getElementById("examV2SampleGenerateBtn");
    const sampleWordBtn = document.getElementById("examV2SampleWordBtn");
    const sampleTextBtn = document.getElementById("examV2SampleTextBtn");
    const sampleSaveBtn = document.getElementById("examV2SampleSaveBtn");
    const samplePackBtn = document.getElementById("examV2SamplePackBtn");
    const sampleUploadInput = document.getElementById("examV2SampleUploadInput");
    let curriculumRows = [];
    let mappingRows = [];
    let generatedExamId = null;
    let allocatedSerials = [];
    let processed = false;
    const institutionCode = String(portalContext?.institution_code || portalContext?.institutionCode || "-");
    let latestSampleText = "";
    const selectedStrandsState = new Set();
    const selectedSubsState = new Set();
    let availableStrands = [];
    let availableSubs = [];
    let availableStrandOptions = [];
    let availableSubOptions = [];

    const setGenStatus = (message) => {
      if (statusNode) statusNode.textContent = message || "";
    };
    const setSchemeStatus = (message) => {
      if (schemeStatusNode) schemeStatusNode.textContent = message || "";
    };
    let latestMarkingSchemeText = String(examPanelState.markingScheme || "");
    const countTokenFromQuestion = (questionText = "") => {
      const direct = String(questionText || "").match(/\b(\d+)\b/);
      if (direct) return Number(direct[1]);
      const words = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10
      };
      const lowered = String(questionText || "").toLowerCase();
      const matched = Object.entries(words).find(([word]) => lowered.includes(word));
      return matched ? matched[1] : null;
    };
    const buildModelAnswer = (questionText = "") => {
      const text = String(questionText || "").trim();
      const lowered = text.toLowerCase();
      const whatIs = lowered.match(/what is ([^?]+)/i);
      if (whatIs?.[1]) {
        const topic = whatIs[1].trim();
        return `${topic.charAt(0).toUpperCase()}${topic.slice(1)} is the correctly defined concept according to the selected strand/sub-strand.`;
      }
      if (lowered.startsWith("define ")) {
        const topic = text.replace(/^define\s+/i, "").replace(/\?+$/, "");
        return `${topic} should be defined accurately using curriculum language and one clear example.`;
      }
      if (lowered.startsWith("explain ")) {
        return "Expected answer should explain the concept clearly and include one practical school/community application.";
      }
      if (lowered.includes("state")) {
        const count = countTokenFromQuestion(text);
        return `Award marks for any ${count || 2} valid point(s) that are technically correct and relevant to the question.`;
      }
      if (lowered.includes("identify") || lowered.includes("choose")) {
        return "Expected response is the most accurate option/statement aligned to curriculum facts.";
      }
      if (lowered.includes("apply")) {
        return "Expected answer should show practical application steps and include safety/quality considerations.";
      }
      return "Provide the correct curriculum-aligned response and award marks based on key content points.";
    };
    const parseImisMcqKeyMap = (examText = "") => {
      const map = new Map();
      const block = String(examText || "").match(/IMIS_MCQ_KEY\n([\s\S]*?)IMIS_MCQ_KEY_END/);
      if (!block) return map;
      String(block[1] || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          const match = line.match(/^(\d+):([A-D])$/i);
          if (match) map.set(Number(match[1]), match[2].toUpperCase());
        });
      return map;
    };
    const extractQuestionsFromExam = (examText = "") => {
      const source = String(examText || "").split("==== GENERATED SERIAL & EXAM METADATA ====")[0] || "";
      const keyMap = parseImisMcqKeyMap(source);
      const lines = source.split(/\r?\n/);
      const questions = [];
      let currentSection = "GENERAL";
      lines.forEach((rawLine) => {
        const line = String(rawLine || "").trim();
        if (!line) return;
        if (/^(SECTION|PAPER)\b/i.test(line)) {
          currentSection = line;
          return;
        }
        const questionMatch = line.match(/^(\d+)\.\s+(.+)$/);
        if (questionMatch) {
          questions.push({
            number: Number(questionMatch[1]),
            question: questionMatch[2].trim(),
            section: currentSection,
            options: [],
            answerKey: keyMap.get(Number(questionMatch[1])) || null
          });
          return;
        }
        const optionMatch = line.match(/^([A-D])[\.\)]\s*(.+)$/i);
        if (optionMatch && questions.length) {
          questions[questions.length - 1].options.push({
            label: optionMatch[1].toUpperCase(),
            text: optionMatch[2].trim()
          });
        }
      });
      return questions;
    };
    const resolveObjectiveAnswer = ({ questionText = "", options = [], answerKey = null } = {}) => {
      if (answerKey && Array.isArray(options) && options.length) {
        const direct = options.find((opt) => String(opt.label || "").toUpperCase() === String(answerKey).toUpperCase());
        if (direct) {
          return {
            ...direct,
            reason: "Aligned to IMIS_MCQ_KEY answer mapping for this examination paper."
          };
        }
      }
      if (!Array.isArray(options) || !options.length) return null;
      const ranked = options.map((option) => ({
        ...option,
        weight: [
          /\bcorrect\b/i.test(option.text) ? 5 : 0,
          /\btrue\b/i.test(option.text) ? 3 : 0,
          /\bbest\b/i.test(option.text) ? 2 : 0,
          /\baccurate\b/i.test(option.text) ? 2 : 0,
          /\bappropriate\b/i.test(option.text) ? 2 : 0
        ].reduce((sum, n) => sum + n, 0)
      }));
      ranked.sort((a, b) => b.weight - a.weight);
      const chosen = ranked[0]?.weight > 0
        ? ranked[0]
        : options[0];
      return {
        ...chosen,
        reason: `Selected as best-fit answer for "${questionText}" under generated objective options.`
      };
    };
    const buildMarkingSchemeText = (examText = "") => {
      const questions = extractQuestionsFromExam(examText);
      if (!questions.length) return "No questions found in generated exam. Generate/process exam first.";
      const metaHeader = [
        "TEACHER MARKING SCHEME (AUTO GENERATED)",
        `Institution: ${institutionCode || "-"}`,
        `Exam Session: ${String(sessionEl?.value || "-")}`,
        `Academic Year: ${String(yearEl?.value || "-")}`,
        `Term: ${String(termEl?.value || "-")}`,
        `Grade/Form: ${String(levelEl?.value || "-")}`,
        `Learning Area: ${String(areaEl?.value || "-")}`,
        `Aligned Questions: ${questions.length}`,
        ""
      ];
      const answerLines = questions.map((row, index) => {
        const header = `${index + 1}. Q${row.number} [${row.section}] ${row.question}`;
        if (row.options.length) {
          const answer = resolveObjectiveAnswer({ questionText: row.question, options: row.options, answerKey: row.answerKey });
          return [
            header,
            `   Correct Answer: ${answer?.label || "A"}. ${answer?.text || ""}`,
            `   Rationale: ${answer?.reason || "Best aligned option for generated question."}`,
            ""
          ].join("\n");
        }
        return [
          header,
          `   Model Answer: ${buildModelAnswer(row.question)}`,
          "   Marking Guide: award marks for accuracy, relevance, and key curriculum terms.",
          ""
        ].join("\n");
      });
      return [...metaHeader, ...answerLines].join("\n");
    };
    const downloadWordDocument = (filename, text) => {
      const body = escapeHtml(text).replace(/\n/g, "<br/>");
      const html = `
        <html>
          <head>
            <meta charset="utf-8">
            <title>${escapeHtml(filename)}</title>
            <style>body{font-family:'Times New Roman',Times,serif;font-size:11pt;line-height:1.35;color:#111;margin:12px;}</style>
          </head>
          <body><div>${body}</div></body>
        </html>
      `;
      downloadTextFile(filename.endsWith(".doc") ? filename : `${filename}.doc`, html, "application/msword;charset=utf-8");
    };
    const slugToken = (value = "") =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const templateKeyForSample = ({
      structure = "unified",
      detail = "default",
      level = "",
      learningArea = ""
    } = {}) => {
      const struct = slugToken(structure) || "unified";
      const detailToken = struct === "unified" ? "default" : (slugToken(detail) || "default");
      const levelToken = slugToken(level) || "general";
      const areaToken = slugToken(learningArea) || "general";
      return `exam-structure-${struct}-${detailToken}-${levelToken}-${areaToken}`;
    };
    const structureDetailsFor = (structure = "unified") => {
      if (structure === "structured") {
        return [
          { value: "A_B", label: "A & B" },
          { value: "A_B_C", label: "A, B & C" }
        ];
      }
      if (structure === "multi-section") {
        return [
          { value: "PAPER_1_2", label: "Paper 1 & 2" },
          { value: "PAPER_1_2_3", label: "Paper 1, 2 & 3" }
        ];
      }
      return [{ value: "", label: "Default" }];
    };
    const refreshSampleDetailChoices = () => {
      if (!sampleStructureEl || !sampleDetailEl) return;
      const structure = String(sampleStructureEl?.value || "unified");
      const rows = structureDetailsFor(structure);
      const current = String(sampleDetailEl?.value || "");
      sampleDetailEl.innerHTML = rows.map((row) => `<option value="${escapeHtmlAttribute(row.value)}">${escapeHtml(row.label)}</option>`).join("");
      if (rows.some((row) => row.value === current)) {
        sampleDetailEl.value = current;
      }
    };
    const buildSamplePaperText = ({
      structure = String(structureEl?.value || "unified"),
      detail = String(structureDetailEl?.value || ""),
      learningArea = String(areaEl?.value || "Pre-Technical Studies"),
      level = String(levelEl?.value || "Grade 7"),
      examSession = String(sessionEl?.value || "Midterm"),
      academicYear = String(yearEl?.value || `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`),
      term = String(termEl?.value || "Term One")
    } = {}) => {
      const examType = examSession;
      const lowerArea = String(learningArea || "").toLowerCase();
      const isSocial = lowerArea.includes("social studies");
      const isPreTechnical = lowerArea.includes("pre-technical");
      const objectiveBlock = ({ count = 10, start = 1 }) =>
        Array.from({ length: count }).map((_, index) => [
          `${start + index}. Choose the correct answer.`,
          "   A. ...  B. ...  C. ...  D. ..."
        ].join("\n"));
      const lines = [
        `SCHOOL BASED ASSESSMENT`,
        `${learningArea.toUpperCase()}`,
        `${level.toUpperCase()} SAMPLE PAPER`,
        `EXAM SESSION: ${examSession}`,
        `EXAM TYPE: ${examType}`,
        `ACADEMIC YEAR: ${academicYear}`,
        `TERM: ${term}`,
        `STRUCTURE: ${structure}${detail ? ` (${detail})` : ""}`,
        `INSTITUTION CODE: ${institutionCode || "-"}`,
        `SERIAL NUMBER: [AUTO GENERATED PER INSTITUTION / LEVEL / LEARNING AREA / STREAM / LEARNER]`,
        "",
        "QR CODE: [AUTO GENERATED FROM SERIAL DETAILS]"
      ];
      if (isSocial) {
        lines.push("", "SECTION A (20 Marks) - Objective (A, B, C, D)", ...objectiveBlock({ count: 20, start: 1 }));
      } else if (isPreTechnical) {
        lines.push(
          "",
          "SECTION A (30 Marks) - Objective (A, B, C, D)",
          ...objectiveBlock({ count: 30, start: 1 }),
          "",
          "SECTION B (60 Marks) - Structured Questions",
          ...Array.from({ length: 12 }).map((_, index) => `${index + 31}. Explain and apply the selected competency in context. (5 marks)`),
          "",
          "TOTAL = 80 MARKS"
        );
      } else if (structure === "structured") {
        lines.push(
          "SECTION B (OBJECTIVE QUESTIONS)",
          "6. Which of the following is correct in relation to the topic above?",
          "   A. ...  B. ...  C. ...  D. ...",
          "7. Choose the best definition from the alternatives given.",
          "   A. ...  B. ...  C. ...  D. ...",
          "8. Identify the correct tool/device/symbol from the options.",
          "   A. ...  B. ...  C. ...  D. ..."
        );
        if (detail === "A_B_C") {
          lines.push(
            "",
            "SECTION C (OBJECTIVE / APPLICATION)",
            "9. Which statement best applies to the given scenario?",
            "   A. ...  B. ...  C. ...  D. ...",
            "10. Choose the correct response.",
            "   A. ...  B. ...  C. ...  D. ..."
          );
        }
      } else if (structure === "multi-section") {
        lines.push(
          "PAPER 2 (OBJECTIVE)",
          "6. Which of the following statements is true?",
          "   A. ...  B. ...  C. ...  D. ...",
          "7. Choose the correct option.",
          "   A. ...  B. ...  C. ...  D. ..."
        );
        if (detail === "PAPER_1_2_3") {
          lines.push(
            "",
            "PAPER 3 (OBJECTIVE / COMPREHENSION)",
            "8. Read the passage/map/image and answer by selecting the best alternative.",
            "   A. ...  B. ...  C. ...  D. ...",
            "9. Identify the best response.",
            "   A. ...  B. ...  C. ...  D. ..."
          );
        }
      } else {
        lines.push(
          "SECTION B (OBJECTIVE QUESTIONS)",
          "6. Which is the most accurate answer?",
          "   A. ...  B. ...  C. ...  D. ...",
          "7. Choose the correct statement.",
          "   A. ...  B. ...  C. ...  D. ..."
        );
      }
      lines.push("", "Use this sample as editable template.");
      return lines.join("\n");
    };
    const renderSerialRows = (rows = []) => {
      if (!serialRowsEl) return;
      serialRowsEl.innerHTML = rows.length
        ? rows.map((row, index) => `
          <tr>
            <td>${escapeHtml(row.institution_code || institutionCode || "-")}</td>
            <td>${escapeHtml(row.grade || "-")}</td>
            <td>${escapeHtml(row.learning_area || "-")}</td>
            <td>${escapeHtml(row.stream || "-")}</td>
            <td>${escapeHtml(row.learner_name || "-")}</td>
            <td>${escapeHtml(row.admission_number || "-")}</td>
            <td>${escapeHtml(row.serial || "-")}</td>
            <td><button class="ax-btn ax-btn--view ax-btn--sm" data-qr-index="${escapeHtmlAttribute(String(index))}" title="View QR">QR</button></td>
          </tr>
        `).join("")
        : `<tr><td colspan="8">No serials generated yet.</td></tr>`;
    };
    const showSerialQrPreview = async (serialRow) => {
      const payload = String(serialRow?.qr_payload || "").trim();
      if (!payload) {
        alert("QR payload is not available for this serial.");
        return;
      }
      try {
        const response = await fetch("/api/academic/exams/serials/qr.png", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ payload })
        });
        if (!response.ok) {
          const raw = await response.text();
          throw new Error(raw || `QR request failed (${response.status})`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const popup = window.open("", "_blank");
        if (!popup) {
          URL.revokeObjectURL(url);
          throw new Error("Popup blocked. Allow popups to preview QR code.");
        }
        popup.document.write(`
          <html>
            <head><title>Exam QR - ${escapeHtml(serialRow?.serial || "Serial")}</title></head>
            <body style="font-family: Arial, sans-serif; padding: 16px;">
              <h3>Exam QR Code</h3>
              <p><strong>Serial:</strong> ${escapeHtml(serialRow?.serial || "-")}</p>
              <img alt="Exam QR code" src="${url}" style="width:260px;height:260px;border:1px solid #d1d5db;padding:6px;" />
              <p style="margin-top:12px;"><strong>Payload:</strong></p>
              <pre style="white-space:pre-wrap;border:1px solid #d1d5db;padding:8px;">${escapeHtml(payload)}</pre>
              <button onclick="window.print()">Print QR</button>
            </body>
          </html>
        `);
        popup.document.close();
      } catch (error) {
        alert(error.message);
      }
    };
    serialRowsEl?.addEventListener("click", (event) => {
      const target = event.target?.closest?.("[data-qr-index]");
      if (!target) return;
      const index = Number(target.getAttribute("data-qr-index") || -1);
      if (!Number.isInteger(index) || index < 0) return;
      const row = allocatedSerials[index];
      if (!row) return;
      showSerialQrPreview(row);
    });
    const setEnabled = (node, state) => {
      if (!node) return;
      node.disabled = !state;
    };
    const parseLevel = (label = "") => {
      const raw = String(label || "").trim();
      const pp = raw.match(/^pp\s*(\d+)/i);
      if (pp) return { type: "pp", num: Number(pp[1]) };
      const grade = raw.match(/^grade\s*(\d+)/i);
      if (grade) return { type: "grade", num: Number(grade[1]) };
      const form = raw.match(/^form\s*(\d+)/i);
      if (form) return { type: "form", num: Number(form[1]) };
      return { type: "unknown", num: null };
    };
    const minByGroup = (type, num) => {
      if (type === "pp") return 1;
      if (type === "form") return 3;
      if (type !== "grade") return null;
      if (num <= 3) return 1;
      if (num <= 6) return 4;
      if (num <= 9) return 7;
      return 10;
    };
    const inSelectedRange = (rowLevelLabel, selectedLevelLabel) => {
      const selected = parseLevel(selectedLevelLabel);
      const row = parseLevel(rowLevelLabel);
      if (selected.type === "unknown") return false;
      if (row.type === "unknown") return false;
      if (row.type !== selected.type) return false;
      const floor = minByGroup(selected.type, Number(selected.num || 0));
      if (!Number.isFinite(Number(floor)) || !Number.isFinite(Number(row.num)) || !Number.isFinite(Number(selected.num))) return false;
      return Number(row.num) >= Number(floor) && Number(row.num) <= Number(selected.num);
    };
    const selectedStrands = () => Array.from(selectedStrandsState.values());
    const selectedSubs = () => Array.from(selectedSubsState.values());
    const levelPayload = () => {
      const selected = String(levelEl?.value || "").trim();
      if (!selected) return { grade: "", form_name: "" };
      if (/^form/i.test(selected)) return { grade: "", form_name: selected };
      return { grade: selected, form_name: "" };
    };
    const selectedStream = () => {
      const manual = String(streamManualEl?.value || "").trim();
      if (manual) return manual;
      const selected = String(streamSelectEl?.value || "").trim();
      return selected || "N/A";
    };
    const templateKeysForCurrentStructure = () => {
      const structure = String(structureEl?.value || "unified").toLowerCase();
      const detail = structure !== "unified"
        ? String(structureDetailEl?.value || "default").toLowerCase()
        : "default";
      const level = String(levelEl?.value || "general");
      const learningArea = String(areaEl?.value || "general");
      const specific = templateKeyForSample({
        structure,
        detail,
        level,
        learningArea
      });
      const generic = `exam-structure-${slugToken(structure)}-${slugToken(detail) || "default"}`;
      return [specific, generic];
    };
    const refreshStructureDetailChoices = () => {
      const structure = String(structureEl?.value || "unified");
      const current = String(structureDetailEl?.value || "");
      let options = [`<option value="">Select details</option>`];
      if (structure === "structured") {
        options = [
          `<option value="">Select details</option>`,
          `<option value="A_B">A & B</option>`,
          `<option value="A_B_C">A, B & C</option>`
        ];
        if (sectionALabelEl) sectionALabelEl.textContent = "Section A %";
        if (sectionBLabelEl) sectionBLabelEl.textContent = "Section B %";
        if (sectionCLabelEl) sectionCLabelEl.textContent = "Section C %";
      } else if (structure === "multi-section") {
        options = [
          `<option value="">Select details</option>`,
          `<option value="PAPER_1_2">Paper 1 & 2</option>`,
          `<option value="PAPER_1_2_3">Paper 1, 2 & 3</option>`
        ];
        if (sectionALabelEl) sectionALabelEl.textContent = "Paper 1 %";
        if (sectionBLabelEl) sectionBLabelEl.textContent = "Paper 2 %";
        if (sectionCLabelEl) sectionCLabelEl.textContent = "Paper 3 %";
      } else {
        if (sectionALabelEl) sectionALabelEl.textContent = "Section/Paper A %";
        if (sectionBLabelEl) sectionBLabelEl.textContent = "Section/Paper B %";
        if (sectionCLabelEl) sectionCLabelEl.textContent = "Section/Paper C %";
      }
      structureDetailEl.innerHTML = options.join("");
      if (current && options.some((row) => row.includes(`value="${current}"`))) {
        structureDetailEl.value = current;
      }
    };
    const loadCurriculumPools = async () => {
      if (curriculumRows.length || mappingRows.length) return;
      const [currRows, mapRows] = await Promise.all([
        request("/api/cbc/curriculum?limit=1000").catch(() => []),
        request("/api/cbc/curriculum/structure-mappings").catch(() => [])
      ]);
      curriculumRows = Array.isArray(currRows) ? currRows : [];
      mappingRows = Array.isArray(mapRows) ? mapRows : [];
    };
    const renderSelectionInfo = () => {
      const strandLabelMap = new Map(availableStrandOptions.map((row) => [row.value, row.label]));
      const subLabelMap = new Map(availableSubOptions.map((row) => [row.value, row.label]));
      if (selectedStrandsInfoEl) {
        selectedStrandsInfoEl.textContent = selectedStrandsState.size
          ? `${selectedStrandsState.size} strand(s) selected (details stored in curriculum engine).`
          : "No strand selected.";
      }
      if (selectedSubsInfoEl) {
        selectedSubsInfoEl.textContent = selectedSubsState.size
          ? `${selectedSubsState.size} sub-strand(s) selected (details stored in curriculum engine).`
          : "No sub-strand selected.";
      }
    };
    const renderChecklist = ({ panelEl, values = [], selectedSet, name, disabled = false, onChange }) => {
      if (!panelEl) return;
      const normalizedValues = (Array.isArray(values) ? values : [])
        .map((value) => {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            const rawValue = String(value.value || "").trim();
            if (!rawValue) return null;
            return {
              value: rawValue,
              label: String(value.label || rawValue)
            };
          }
          const rawValue = String(value || "").trim();
          if (!rawValue) return null;
          return { value: rawValue, label: rawValue };
        })
        .filter(Boolean);
      if (!normalizedValues.length) {
        panelEl.innerHTML = `<p class="small-note">No ${name} found for this level/learning area.</p>`;
        return;
      }
      panelEl.innerHTML = `
        <table class="exam-checklist-table" style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead><tr><th style="width:28px;"></th><th>Item</th></tr></thead>
          <tbody>
        ${normalizedValues
          .map((valueRow, idx) => {
            const id = `examV2Gen${name}${idx}`.replace(/[^a-zA-Z0-9_-]/g, "");
            return `
              <tr>
                <td style="padding:2px 4px;">
                  <input id="${id}" type="checkbox" value="${escapeHtmlAttribute(valueRow.value)}" ${selectedSet.has(valueRow.value) ? "checked" : ""} ${disabled ? "disabled" : ""} />
                </td>
                <td style="padding:2px 4px;"><label for="${id}" style="margin:0;font-weight:500;">${escapeHtml(valueRow.label)}</label></td>
              </tr>`;
          })
          .join("")}
          </tbody>
        </table>`;
      panelEl.querySelectorAll("input[type='checkbox']").forEach((node) => {
        node.addEventListener("change", () => {
          const value = String(node.value || "").trim();
          if (!value) return;
          if (node.checked) selectedSet.add(value);
          else selectedSet.delete(value);
          onChange?.();
        });
      });
    };
    const setChecklistEnabled = (panelEl, enabled) => {
      panelEl?.querySelectorAll("input[type='checkbox']").forEach((input) => {
        input.disabled = !enabled;
      });
    };
    const refreshStreamOptions = async () => {
      const { grade, form_name } = levelPayload();
      if (!grade && !form_name) {
        streamSelectEl.innerHTML = `<option value="">Select stream</option><option value="N/A">N/A</option>`;
        return;
      }
      const rows = await request(`/api/admission/learners?limit=700&search=${encodeURIComponent(grade || form_name)}`).catch(() => []);
      const streams = Array.from(
        new Set(
          (Array.isArray(rows) ? rows : [])
            .filter((row) => (grade ? String(row.grade || "").trim() === grade : String(row.form_name || "").trim() === form_name))
            .map((row) => String(row.stream || "").trim())
            .filter(Boolean)
        )
      );
      streamSelectEl.innerHTML = `<option value="">Select stream</option><option value="N/A">N/A</option>${streams.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
    };
    const refreshStrandOptions = async () => {
      await loadCurriculumPools();
      const learningArea = String(areaEl?.value || "").trim().toLowerCase();
      const selectedLevel = String(levelEl?.value || "").trim();
      if (!learningArea || !selectedLevel) {
        availableStrands = [];
        availableSubs = [];
        availableStrandOptions = [];
        availableSubOptions = [];
        selectedStrandsState.clear();
        selectedSubsState.clear();
        renderChecklist({ panelEl: strandsPanelEl, values: [], selectedSet: selectedStrandsState, name: "Strand" });
        renderChecklist({ panelEl: subsPanelEl, values: [], selectedSet: selectedSubsState, name: "SubStrand" });
        renderSelectionInfo();
        return;
      }
      const pool = [...curriculumRows, ...mappingRows];
      const strandCoverageMap = new Map();
      pool
        .filter((row) => String(row.learning_area || "").trim().toLowerCase() === learningArea)
        .filter((row) => inSelectedRange(String(row.grade || row.form_name || "").trim(), selectedLevel))
        .forEach((row) => {
          const strandValue = String(row.strand || "").trim();
          if (!strandValue) return;
          if (!strandCoverageMap.has(strandValue)) {
            strandCoverageMap.set(strandValue, new Set());
          }
          const rowLevel = String(row.grade || row.form_name || "").trim();
          if (rowLevel) strandCoverageMap.get(strandValue).add(rowLevel);
        });
      availableStrandOptions = Array.from(strandCoverageMap.entries())
        .map(([value, levels]) => {
          const levelLabel = Array.from(levels.values()).sort((a, b) => a.localeCompare(b)).join(", ");
          return {
            value,
            label: `${value} [${levelLabel || "No Grade"}]`
          };
        })
        .sort((a, b) => a.value.localeCompare(b.value));
      availableStrands = availableStrandOptions.map((row) => row.value);
      Array.from(selectedStrandsState.values()).forEach((value) => {
        if (!availableStrands.includes(value)) selectedStrandsState.delete(value);
      });
      selectedSubsState.clear();
      availableSubs = [];
      availableSubOptions = [];
      renderChecklist({
        panelEl: strandsPanelEl,
        values: availableStrandOptions,
        selectedSet: selectedStrandsState,
        name: "Strand",
        onChange: async () => {
          await refreshSubStrandOptions();
          renderSelectionInfo();
          updateActivation();
        }
      });
      renderChecklist({ panelEl: subsPanelEl, values: [], selectedSet: selectedSubsState, name: "SubStrand" });
      renderSelectionInfo();
    };
    const refreshSubStrandOptions = async () => {
      await loadCurriculumPools();
      const learningArea = String(areaEl?.value || "").trim().toLowerCase();
      const selectedLevel = String(levelEl?.value || "").trim();
      const selectedStrandValues = selectedStrands();
      if (!learningArea || !selectedLevel || !selectedStrandValues.length) {
        availableSubs = [];
        availableSubOptions = [];
        selectedSubsState.clear();
        renderChecklist({ panelEl: subsPanelEl, values: [], selectedSet: selectedSubsState, name: "SubStrand" });
        renderSelectionInfo();
        return;
      }
      const selectedStrandSet = new Set(selectedStrandValues.map((item) => item.toLowerCase()));
      const pool = [...curriculumRows, ...mappingRows];
      const subCoverageMap = new Map();
      pool
        .filter((row) => String(row.learning_area || "").trim().toLowerCase() === learningArea)
        .filter((row) => inSelectedRange(String(row.grade || row.form_name || "").trim(), selectedLevel))
        .filter((row) => selectedStrandSet.has(String(row.strand || "").trim().toLowerCase()))
        .forEach((row) => {
          const subValue = String(row.sub_strand || "").trim();
          if (!subValue) return;
          if (!subCoverageMap.has(subValue)) {
            subCoverageMap.set(subValue, {
              levels: new Set(),
              strands: new Set()
            });
          }
          const levelValue = String(row.grade || row.form_name || "").trim();
          if (levelValue) subCoverageMap.get(subValue).levels.add(levelValue);
          const strandValue = String(row.strand || "").trim();
          if (strandValue) subCoverageMap.get(subValue).strands.add(strandValue);
        });
      availableSubOptions = Array.from(subCoverageMap.entries())
        .map(([value, meta]) => {
          const levelLabel = Array.from(meta.levels.values()).sort((a, b) => a.localeCompare(b)).join(", ");
          const strandLabel = Array.from(meta.strands.values()).sort((a, b) => a.localeCompare(b)).join(" / ");
          return {
            value,
            label: `${value} [${levelLabel || "No Grade"}${strandLabel ? ` | ${strandLabel}` : ""}]`
          };
        })
        .sort((a, b) => a.value.localeCompare(b.value));
      availableSubs = availableSubOptions.map((row) => row.value);
      Array.from(selectedSubsState.values()).forEach((value) => {
        if (!availableSubs.includes(value)) selectedSubsState.delete(value);
      });
      renderChecklist({
        panelEl: subsPanelEl,
        values: availableSubOptions,
        selectedSet: selectedSubsState,
        name: "SubStrand",
        onChange: () => {
          renderSelectionInfo();
          updateActivation();
        }
      });
      renderSelectionInfo();
    };
    const structuredTotal = () =>
      Number(sectionAEl?.value || 0) + Number(sectionBEl?.value || 0) + Number(sectionCEl?.value || 0);
    const updateActivation = () => {
      const sessionOk = Boolean(String(sessionEl?.value || "").trim());
      const yearOk = sessionOk && Boolean(String(yearEl?.value || "").trim());
      const termOk = yearOk && Boolean(String(termEl?.value || "").trim());
      const levelOk = termOk && Boolean(String(levelEl?.value || "").trim());
      const streamOk = levelOk && Boolean(selectedStream());
      const areaOk = streamOk && Boolean(String(areaEl?.value || "").trim());
      const strandsOk = areaOk && selectedStrands().length > 0;
      const subsOk = strandsOk && selectedSubs().length > 0;
      const structureOk = subsOk && Boolean(String(structureEl?.value || "").trim());
      const isStructured = String(structureEl?.value || "") === "structured";
      const isMultiSection = String(structureEl?.value || "") === "multi-section";
      const nonUnified = isStructured || isMultiSection;
      const detailValue = String(structureDetailEl?.value || "").trim();
      const needsThreeSections = detailValue === "A_B_C" || detailValue === "PAPER_1_2_3";
      const structuredDetailOk = nonUnified ? Boolean(detailValue) : true;
      const structuredMarksOk = nonUnified
        ? (Number(sectionAEl?.value || 0) > 0
          && Number(sectionBEl?.value || 0) > 0
          && (!needsThreeSections || Number(sectionCEl?.value || 0) > 0)
          && structuredTotal() <= 100)
        : true;
      const unifiedPercentOk = !nonUnified
        ? (String(allocModeEl?.value || "manual") === "automated"
          ? Boolean(String(autoPercentEl?.value || "").trim())
          : Number(manualPercentEl?.value || 0) >= 10 && Number(manualPercentEl?.value || 0) <= 100)
        : true;
      const outputOk = structureOk && structuredDetailOk && structuredMarksOk && unifiedPercentOk && Boolean(String(outputModeEl?.value || "").trim());
      setEnabled(yearEl, sessionOk);
      setEnabled(termEl, yearOk);
      setEnabled(levelEl, termOk);
      setEnabled(streamSelectEl, levelOk);
      setEnabled(streamManualEl, levelOk);
      setEnabled(durHEl, termOk);
      setEnabled(durMEl, termOk);
      setEnabled(areaEl, streamOk);
      setEnabled(clearStrandsBtn, areaOk && selectedStrands().length > 0);
      setEnabled(clearSubsBtn, strandsOk && selectedSubs().length > 0);
      setEnabled(selectAllStrandsBtn, areaOk && availableStrands.length > 0);
      setEnabled(deselectStrandsBtn, areaOk && selectedStrands().length > 0);
      setEnabled(invertStrandsBtn, areaOk && availableStrands.length > 0);
      setEnabled(selectAllSubsBtn, strandsOk && availableSubs.length > 0);
      setEnabled(deselectSubsBtn, strandsOk && selectedSubs().length > 0);
      setEnabled(invertSubsBtn, strandsOk && availableSubs.length > 0);
      setChecklistEnabled(strandsPanelEl, areaOk);
      setChecklistEnabled(subsPanelEl, strandsOk);
      setEnabled(structureEl, subsOk);
      setEnabled(structureDetailEl, structureOk && nonUnified);
      setEnabled(allocModeEl, structureOk && !nonUnified);
      setEnabled(autoPercentEl, structureOk && !nonUnified && String(allocModeEl?.value || "manual") === "automated");
      setEnabled(manualPercentEl, structureOk && !nonUnified && String(allocModeEl?.value || "manual") !== "automated");
      setEnabled(sectionAEl, structureOk && nonUnified);
      setEnabled(sectionBEl, structureOk && nonUnified);
      setEnabled(sectionCEl, structureOk && nonUnified && needsThreeSections);
      setEnabled(outputModeEl, structureOk && structuredDetailOk && structuredMarksOk && unifiedPercentOk);
      setEnabled(generateBtn, outputOk);
      setEnabled(templateDownloadBtn, structureOk);
      setEnabled(editChoiceEl, Boolean(generatedExamId));
      const editing = String(editChoiceEl?.value || "no") === "yes";
      if (outputEl) outputEl.readOnly = !editing;
      setEnabled(saveEditedBtn, Boolean(generatedExamId) && editing);
      setEnabled(processBtn, Boolean(generatedExamId) && (!editing || processed));
      setEnabled(deliveryModeEl, Boolean(generatedExamId) && processed);
      setEnabled(runDeliveryBtn, Boolean(generatedExamId) && processed && Boolean(String(deliveryModeEl?.value || "").trim()));
      const schemeReady = Boolean(String(schemeOutputEl?.value || "").trim());
      setEnabled(schemeGenerateBtn, Boolean(generatedExamId) && processed && Boolean(String(outputEl?.value || "").trim()));
      setEnabled(schemeViewBtn, Boolean(generatedExamId) && schemeReady);
      setEnabled(schemeSaveBtn, Boolean(generatedExamId) && schemeReady);
      setEnabled(schemeDownloadBtn, schemeReady);
      setEnabled(schemePrintBtn, schemeReady);
      if (schemeOutputEl) schemeOutputEl.readOnly = !processed;
      if (nonUnified && structuredTotal() > 100) {
        setGenStatus("Structured section marks cannot exceed total 100.");
      }
    };
    sessionEl?.addEventListener("change", updateActivation);
    yearEl?.addEventListener("input", updateActivation);
    termEl?.addEventListener("change", updateActivation);
    levelEl?.addEventListener("change", async () => {
      await refreshStreamOptions();
      await refreshStrandOptions();
      if (sampleLevelEl && levelEl?.value) sampleLevelEl.value = levelEl.value;
      updateActivation();
    });
    streamSelectEl?.addEventListener("change", updateActivation);
    streamManualEl?.addEventListener("input", updateActivation);
    areaEl?.addEventListener("change", async () => {
      await refreshStrandOptions();
      if (sampleAreaEl && areaEl?.value) sampleAreaEl.value = areaEl.value;
      updateActivation();
    });
    clearStrandsBtn?.addEventListener("click", async () => {
      selectedStrandsState.clear();
      selectedSubsState.clear();
      await refreshStrandOptions();
      renderSelectionInfo();
      updateActivation();
    });
    selectAllStrandsBtn?.addEventListener("click", async () => {
      availableStrands.forEach((value) => selectedStrandsState.add(value));
      await refreshSubStrandOptions();
      renderChecklist({
        panelEl: strandsPanelEl,
        values: availableStrandOptions,
        selectedSet: selectedStrandsState,
        name: "Strand",
        onChange: async () => {
          await refreshSubStrandOptions();
          renderSelectionInfo();
          updateActivation();
        }
      });
      renderSelectionInfo();
      updateActivation();
    });
    deselectStrandsBtn?.addEventListener("click", async () => {
      selectedStrandsState.clear();
      selectedSubsState.clear();
      await refreshSubStrandOptions();
      renderChecklist({
        panelEl: strandsPanelEl,
        values: availableStrandOptions,
        selectedSet: selectedStrandsState,
        name: "Strand",
        onChange: async () => {
          await refreshSubStrandOptions();
          renderSelectionInfo();
          updateActivation();
        }
      });
      renderSelectionInfo();
      updateActivation();
    });
    invertStrandsBtn?.addEventListener("click", async () => {
      const next = new Set(availableStrands.filter((value) => !selectedStrandsState.has(value)));
      selectedStrandsState.clear();
      next.forEach((value) => selectedStrandsState.add(value));
      await refreshSubStrandOptions();
      renderChecklist({
        panelEl: strandsPanelEl,
        values: availableStrandOptions,
        selectedSet: selectedStrandsState,
        name: "Strand",
        onChange: async () => {
          await refreshSubStrandOptions();
          renderSelectionInfo();
          updateActivation();
        }
      });
      renderSelectionInfo();
      updateActivation();
    });
    clearSubsBtn?.addEventListener("click", () => {
      selectedSubsState.clear();
      renderChecklist({
        panelEl: subsPanelEl,
        values: availableSubOptions,
        selectedSet: selectedSubsState,
        name: "SubStrand",
        onChange: () => {
          renderSelectionInfo();
          updateActivation();
        }
      });
      renderSelectionInfo();
      updateActivation();
    });
    selectAllSubsBtn?.addEventListener("click", () => {
      availableSubs.forEach((value) => selectedSubsState.add(value));
      renderChecklist({
        panelEl: subsPanelEl,
        values: availableSubOptions,
        selectedSet: selectedSubsState,
        name: "SubStrand",
        onChange: () => {
          renderSelectionInfo();
          updateActivation();
        }
      });
      renderSelectionInfo();
      updateActivation();
    });
    deselectSubsBtn?.addEventListener("click", () => {
      selectedSubsState.clear();
      renderChecklist({
        panelEl: subsPanelEl,
        values: availableSubOptions,
        selectedSet: selectedSubsState,
        name: "SubStrand",
        onChange: () => {
          renderSelectionInfo();
          updateActivation();
        }
      });
      renderSelectionInfo();
      updateActivation();
    });
    invertSubsBtn?.addEventListener("click", () => {
      const next = new Set(availableSubs.filter((value) => !selectedSubsState.has(value)));
      selectedSubsState.clear();
      next.forEach((value) => selectedSubsState.add(value));
      renderChecklist({
        panelEl: subsPanelEl,
        values: availableSubOptions,
        selectedSet: selectedSubsState,
        name: "SubStrand",
        onChange: () => {
          renderSelectionInfo();
          updateActivation();
        }
      });
      renderSelectionInfo();
      updateActivation();
    });
    structureEl?.addEventListener("change", () => {
      refreshStructureDetailChoices();
      updateActivation();
    });
    structureDetailEl?.addEventListener("change", updateActivation);
    allocModeEl?.addEventListener("change", updateActivation);
    autoPercentEl?.addEventListener("change", updateActivation);
    manualPercentEl?.addEventListener("input", updateActivation);
    sectionAEl?.addEventListener("input", updateActivation);
    sectionBEl?.addEventListener("input", updateActivation);
    sectionCEl?.addEventListener("input", updateActivation);
    outputModeEl?.addEventListener("change", updateActivation);
    editChoiceEl?.addEventListener("change", () => {
      processed = String(editChoiceEl?.value || "no") === "no";
      updateActivation();
    });
    deliveryModeEl?.addEventListener("change", updateActivation);

    generateBtn?.addEventListener("click", async () => {
      const { grade, form_name } = levelPayload();
      const selectedStrandsList = selectedStrands();
      const selectedSubsList = selectedSubs();
      const structure = String(structureEl?.value || "unified");
      const payload = {
        title: `${String(sessionEl?.value || "Exam")} - ${String(areaEl?.value || "Learning Area")}`,
        exam_type: String(sessionEl?.value || ""),
        grade,
        form_name,
        stream: selectedStream(),
        learning_area: String(areaEl?.value || ""),
        subject: String(areaEl?.value || ""),
        selected_strands: selectedStrandsList,
        selected_sub_strands: selectedSubsList,
        strand: selectedStrandsList[0] || "",
        sub_strand: selectedSubsList[0] || "",
        term: String(termEl?.value || ""),
        academic_year: String(yearEl?.value || ""),
        year: parseAcademicYearStart(String(yearEl?.value || "")),
        exam_duration_minutes: Number(durHEl?.value || 0) * 60 + Number(durMEl?.value || 0),
        structure,
        structure_detail: structure !== "unified" ? String(structureDetailEl?.value || "") : null,
        allocation_mode: String(allocModeEl?.value || "manual"),
        automated_percentage: String(autoPercentEl?.value || ""),
        manual_percentage: String(manualPercentEl?.value || "100"),
        output_mode: String(outputModeEl?.value || "per_learner"),
        section_allocations: {
          A: Number(sectionAEl?.value || 0),
          B: Number(sectionBEl?.value || 0),
          C: Number(sectionCEl?.value || 0)
        }
      };
      try {
        const generated = await request("/api/academic/exams/auto-generate", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        generatedExamId = Number(generated?.id || 0) || null;
        processed = false;
        allocatedSerials = [];
        renderSerialRows([]);
        if (outputEl) outputEl.value = String(generated?.examText || "").trim();
        if (schemeOutputEl) schemeOutputEl.value = "";
        latestMarkingSchemeText = "";
        examPanelState.markingScheme = "";
        setSchemeStatus("Marking scheme will activate after Process.");
        examPanelState.generatedExam = { id: generatedExamId, payload };
        examPanelState.serials = [];
        setGenStatus(`Generated exam #${generatedExamId || "-"} using ${selectedStrandsList.length} strand(s) and ${selectedSubsList.length} sub-strand(s).`);
        updateActivation();
      } catch (error) {
        alert(error.message);
      }
    });
    saveEditedBtn?.addEventListener("click", async () => {
      if (!generatedExamId) {
        alert("Generate exam first.");
        return;
      }
      try {
        await request(`/api/academic/exams/${generatedExamId}`, {
          method: "PUT",
          body: JSON.stringify({ generated_exam_text: String(outputEl?.value || "") })
        });
        processed = true;
        if (schemeOutputEl) schemeOutputEl.value = "";
        latestMarkingSchemeText = "";
        examPanelState.markingScheme = "";
        setSchemeStatus("Exam text updated. Generate marking scheme to align with final exam.");
        setGenStatus(`Edited exam #${generatedExamId} saved. You can now process output.`);
        updateActivation();
      } catch (error) {
        alert(error.message);
      }
    });
    processBtn?.addEventListener("click", async () => {
      if (!generatedExamId) {
        alert("Generate exam first.");
        return;
      }
      const { grade, form_name } = levelPayload();
      try {
        const serialResponse = await request("/api/academic/exams/allocate-serials", {
          method: "POST",
          body: JSON.stringify({
            grade,
            form_name,
            stream: selectedStream(),
            learning_area: String(areaEl?.value || ""),
            exam_type: String(sessionEl?.value || ""),
            term: String(termEl?.value || ""),
            year: parseAcademicYearStart(String(yearEl?.value || "")),
            mode: String(outputModeEl?.value || "per_learner")
          })
        });
        allocatedSerials = (Array.isArray(serialResponse?.serials) ? serialResponse.serials : []).map((row) => ({
          ...row,
          institution_code: row.institution_code || institutionCode || "-",
          learning_area: String(areaEl?.value || "")
        }));
        const serialLines = allocatedSerials.length
          ? allocatedSerials.slice(0, 30).map((row, index) =>
            `${index + 1}. ${row.learner_name || "-"} | Adm ${row.admission_number || "-"} | ${row.grade || "-"} ${row.stream || "-"} | Serial ${row.serial || "-"}`
          )
          : ["No learner serials generated."];
        const metaBlock = [
          "",
          "==== GENERATED SERIAL & EXAM METADATA ====",
          `Institution: ${institutionCode || "-"}`,
          `Academic Year: ${String(yearEl?.value || "-")}`,
          `Term: ${String(termEl?.value || "-")}`,
          `Exam Type: ${String(sessionEl?.value || "-")}`,
          `Exam Session: ${String(sessionEl?.value || "-")}`,
          `Grade/Form: ${grade || form_name || "-"}`,
          `Learning Area: ${String(areaEl?.value || "-")}`,
          `Output Mode: ${String(outputModeEl?.value || "-")}`,
          "QR PAYLOAD: Included per serial row in Serial Number Generation Center.",
          "Serials:",
          ...serialLines
        ].join("\n");
        if (outputEl) {
          const existing = String(outputEl.value || "");
          outputEl.value = existing.includes("==== GENERATED SERIAL & EXAM METADATA ====")
            ? existing.replace(/==== GENERATED SERIAL & EXAM METADATA ====([\s\S]*)$/m, metaBlock.trim())
            : `${existing}\n${metaBlock}`;
        }
        examPanelState.serials = allocatedSerials;
        const schemeText = buildMarkingSchemeText(String(outputEl?.value || ""));
        latestMarkingSchemeText = schemeText;
        examPanelState.markingScheme = schemeText;
        if (schemeOutputEl) schemeOutputEl.value = schemeText;
        setSchemeStatus(`Marking scheme generated and aligned to ${allocatedSerials.length ? `${allocatedSerials.length} processed serial record(s)` : "current exam questions"}.`);
        renderSerialRows(allocatedSerials);
        processed = true;
        setGenStatus(`Processed output mode ${String(outputModeEl?.value || "")}. Generated ${allocatedSerials.length} serial records.`);
        updateActivation();
      } catch (error) {
        alert(error.message);
      }
    });
    const stripLearnerExamExport = (txt = "") =>
      String(txt || "")
        .replace(/\r\n/g, "\n")
        .replace(/\nIMIS_MCQ_KEY\n[\s\S]*?\nIMIS_MCQ_KEY_END/, "");

    runDeliveryBtn?.addEventListener("click", () => {
      const mode = String(deliveryModeEl?.value || "");
      const text = String(outputEl?.value || "").trim();
      if (!text) {
        alert("Generate exam first.");
        return;
      }
      if (mode === "download") {
        const publicText = stripLearnerExamExport(text);
        downloadTextFile("generated-exam-paper.txt", publicText);
        downloadWordDocument("generated-exam-paper.doc", publicText);
        if (allocatedSerials.length) {
          const csv = rowsToCsv(allocatedSerials.map((row) => ({
            learner_name: row.learner_name || "",
            admission_number: row.admission_number || "",
            grade: row.grade || "",
            stream: row.stream || "",
            serial: row.serial || "",
            qr_payload: row.qr_payload || ""
          })));
          downloadTextFile("exam-serials.csv", csv, "text/csv;charset=utf-8");
        }
        return;
      }
      if (mode === "print") {
        const popup = window.open("", "_blank");
        if (!popup) return;
        popup.document.write(`<pre>${escapeHtml(text)}</pre>`);
        popup.document.close();
        popup.print();
      }
    });
    schemeGenerateBtn?.addEventListener("click", () => {
      if (!processed) {
        alert("Process exam first to activate marking scheme generation.");
        return;
      }
      const examText = String(outputEl?.value || "").trim();
      if (!examText) {
        alert("No generated exam found.");
        return;
      }
      const schemeText = buildMarkingSchemeText(examText);
      latestMarkingSchemeText = schemeText;
      examPanelState.markingScheme = schemeText;
      if (schemeOutputEl) schemeOutputEl.value = schemeText;
      setSchemeStatus("Teacher marking scheme generated from final exam questions.");
      updateActivation();
    });
    schemeViewBtn?.addEventListener("click", () => {
      const text = String(schemeOutputEl?.value || "").trim();
      if (!text) {
        alert("Generate marking scheme first.");
        return;
      }
      const popup = window.open("", "_blank");
      if (!popup) return;
      popup.document.write(`<pre>${escapeHtml(text)}</pre>`);
      popup.document.close();
    });
    schemeSaveBtn?.addEventListener("click", async () => {
      const text = String(schemeOutputEl?.value || "").trim();
      if (!generatedExamId || !text) {
        alert("Generate marking scheme first.");
        return;
      }
      try {
        const examText = String(outputEl?.value || "").split("==== TEACHER MARKING SCHEME START ====")[0].trimEnd();
        const merged = [
          examText,
          "",
          "==== TEACHER MARKING SCHEME START ====",
          text,
          "==== TEACHER MARKING SCHEME END ===="
        ].join("\n");
        await request(`/api/academic/exams/${generatedExamId}`, {
          method: "PUT",
          body: JSON.stringify({ generated_exam_text: merged })
        });
        latestMarkingSchemeText = text;
        examPanelState.markingScheme = text;
        setSchemeStatus(`Marking scheme saved with exam #${generatedExamId}.`);
      } catch (error) {
        alert(error.message);
      }
    });
    schemeDownloadBtn?.addEventListener("click", () => {
      const text = String(schemeOutputEl?.value || "").trim();
      if (!text) {
        alert("Generate marking scheme first.");
        return;
      }
      downloadTextFile("teacher-marking-scheme.txt", text);
      downloadWordDocument("teacher-marking-scheme.doc", text);
    });
    schemePrintBtn?.addEventListener("click", () => {
      const text = String(schemeOutputEl?.value || "").trim();
      if (!text) {
        alert("Generate marking scheme first.");
        return;
      }
      const popup = window.open("", "_blank");
      if (!popup) return;
      popup.document.write(`<pre>${escapeHtml(text)}</pre>`);
      popup.document.close();
      popup.print();
    });
    document.getElementById("examV2GenViewBtn")?.addEventListener("click", async () => {
      try {
        const rows = await request("/api/academic/exams?limit=80");
        const list = Array.isArray(rows) ? rows : [];
        setGenStatus(list.length ? `Recent: ${list.slice(0, 6).map((row) => `#${row.id} ${row.title}`).join(" | ")}` : "No generated exams yet.");
      } catch (error) {
        alert(error.message);
      }
    });
    sampleBtn?.addEventListener("click", () => {
      const sampleText = buildSamplePaperText();
      downloadTextFile("exam-sample-paper-template.txt", sampleText);
    });
    const saveTemplateByKey = async ({ key, content, versionTag = "v1" }) => {
      const rows = await request("/api/examinations/templates");
      const existing = (Array.isArray(rows) ? rows : []).find((row) => String(row.template_key || "").toLowerCase() === String(key || "").toLowerCase());
      if (existing?.id) {
        await request(`/api/examinations/templates/${existing.id}`, {
          method: "PUT",
          body: JSON.stringify({
            template_key: key,
            template_name: `Exam Structure Template - ${key}`,
            version_tag: versionTag,
            content
          })
        });
      } else {
        await request("/api/examinations/templates", {
          method: "POST",
          body: JSON.stringify({
            template_key: key,
            template_name: `Exam Structure Template - ${key}`,
            version_tag: versionTag,
            content
          })
        });
      }
    };
    templateDownloadBtn?.addEventListener("click", async () => {
      try {
        const [specificKey, genericKey] = templateKeysForCurrentStructure();
        const key = specificKey || genericKey;
        const templates = await request("/api/examinations/templates");
        const rows = Array.isArray(templates) ? templates : [];
        const selected =
          rows.find((row) => String(row.template_key || "").toLowerCase() === String(specificKey || "").toLowerCase()) ||
          rows.find((row) => String(row.template_key || "").toLowerCase() === String(genericKey || "").toLowerCase());
        if (selected?.content) {
          downloadTextFile(`${key}.txt`, selected.content);
          return;
        }
        const fallback = [buildSamplePaperText(), "", `Template Key: ${key}`].join("\n");
        downloadTextFile(`${key}.txt`, fallback);
      } catch (error) {
        alert(error.message);
      }
    });
    templateUploadInput?.addEventListener("change", async () => {
      const file = templateUploadInput.files?.[0];
      if (!file) return;
      try {
        const content = await file.text();
        const [key] = templateKeysForCurrentStructure();
        await saveTemplateByKey({ key, content, versionTag: "v2" });
        setGenStatus(`Template sample uploaded for ${key}.`);
      } catch (error) {
        alert(error.message);
      } finally {
        templateUploadInput.value = "";
      }
    });
    const buildSampleFromFactory = () => {
      const text = buildSamplePaperText({
        structure: String(sampleStructureEl?.value || "unified"),
        detail: String(sampleDetailEl?.value || ""),
        learningArea: String(sampleAreaEl?.value || ""),
        level: String(sampleLevelEl?.value || ""),
        examSession: String(sampleSessionEl?.value || ""),
        academicYear: String(sampleAcademicYearEl?.value || ""),
        term: String(sampleTermEl?.value || "")
      });
      latestSampleText = text;
      if (samplePreviewEl) samplePreviewEl.value = text;
      return text;
    };
    sampleStructureEl?.addEventListener("change", () => {
      refreshSampleDetailChoices();
      buildSampleFromFactory();
    });
    sampleDetailEl?.addEventListener("change", buildSampleFromFactory);
    sampleAreaEl?.addEventListener("change", buildSampleFromFactory);
    sampleLevelEl?.addEventListener("change", buildSampleFromFactory);
    sampleSessionEl?.addEventListener("change", buildSampleFromFactory);
    sampleTermEl?.addEventListener("change", buildSampleFromFactory);
    sampleAcademicYearEl?.addEventListener("input", buildSampleFromFactory);
    sampleGenerateBtn?.addEventListener("click", () => {
      buildSampleFromFactory();
      setGenStatus("Sample generated from factory settings.");
    });
    sampleTextBtn?.addEventListener("click", () => {
      const sampleText = latestSampleText || buildSampleFromFactory();
      downloadTextFile("exam-sample-template.txt", sampleText);
    });
    sampleWordBtn?.addEventListener("click", () => {
      const sampleText = latestSampleText || buildSampleFromFactory();
      downloadWordDocument("exam-sample-template.doc", sampleText);
    });
    sampleSaveBtn?.addEventListener("click", async () => {
      const sampleText = latestSampleText || buildSampleFromFactory();
      const key = templateKeyForSample({
        structure: String(sampleStructureEl?.value || "unified"),
        detail: String(sampleDetailEl?.value || ""),
        level: String(sampleLevelEl?.value || ""),
        learningArea: String(sampleAreaEl?.value || "")
      });
      try {
        await saveTemplateByKey({ key, content: sampleText, versionTag: "v1" });
        setGenStatus(`Sample template saved as ${key}.`);
      } catch (error) {
        alert(error.message);
      }
    });
    samplePackBtn?.addEventListener("click", () => {
      const selectedLevel = String(sampleLevelEl?.value || "Grade 7");
      const selectedSession = String(sampleSessionEl?.value || "Midterm");
      const selectedYear = String(sampleAcademicYearEl?.value || `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`);
      const selectedTerm = String(sampleTermEl?.value || "Term One");
      const structures = [
        { structure: "unified", detail: "" },
        { structure: "structured", detail: "A_B_C" },
        { structure: "multi-section", detail: "PAPER_1_2_3" }
      ];
      const sections = [];
      learningAreas.forEach((area) => {
        structures.forEach((item) => {
          sections.push(
            `====================================================`,
            `LEARNING AREA: ${area} | STRUCTURE: ${item.structure}${item.detail ? ` (${item.detail})` : ""}`,
            `====================================================`,
            buildSamplePaperText({
              structure: item.structure,
              detail: item.detail,
              learningArea: area,
              level: selectedLevel,
              examSession: selectedSession,
              academicYear: selectedYear,
              term: selectedTerm
            }),
            ""
          );
        });
      });
      const packText = sections.join("\n");
      downloadWordDocument("jss-learning-areas-sample-pack.doc", packText);
    });
    sampleUploadInput?.addEventListener("change", async () => {
      const file = sampleUploadInput.files?.[0];
      if (!file) return;
      try {
        const content = await file.text();
        const key = templateKeyForSample({
          structure: String(sampleStructureEl?.value || "unified"),
          detail: String(sampleDetailEl?.value || ""),
          level: String(sampleLevelEl?.value || ""),
          learningArea: String(sampleAreaEl?.value || "")
        });
        await saveTemplateByKey({ key, content, versionTag: "v2" });
        latestSampleText = content;
        if (samplePreviewEl) samplePreviewEl.value = content;
        setGenStatus(`Uploaded final sample for ${key}.`);
      } catch (error) {
        alert(error.message);
      } finally {
        sampleUploadInput.value = "";
      }
    });
    if (schemeOutputEl && latestMarkingSchemeText) {
      schemeOutputEl.value = latestMarkingSchemeText;
      setSchemeStatus("Loaded last generated marking scheme. Review and edit as needed.");
    } else {
      setSchemeStatus("Marking scheme will activate after Process.");
    }
    renderSerialRows([]);
    refreshStructureDetailChoices();
    refreshSampleDetailChoices();
    buildSampleFromFactory();
    updateActivation();
  };

  const renderExamEntryTab = async () => {
    panel.innerHTML = `
      <div class="exam-v2-layout exam-module-compact">
        <div class="exam-v2-pane">
          <h4>Exam Entry</h4>
          <p class="small-note exam-tight-note">Choose method, confirm learner context, enter marks, verify, then save.</p>
          <div class="form-grid form-grid--exam-tight">
            <label>Entry Method</label>
            <select id="examV2EntryMethod">
              <option value="manual">Manual filters</option>
              <option value="serial">Serial number</option>
              <option value="qr">QR scan</option>
            </select>
            <div id="examV2EntrySerialPanel" style="display:none;grid-column:1/-1;" class="form-grid form-grid--exam-tight">
              <label>Serial</label>
              <input id="examV2EntrySerialInput" placeholder="Paste allocated exam serial" />
              <label></label>
              <button type="button" class="ax-btn ax-btn--save ax-btn--sm" id="examV2EntrySerialOkBtn" title="Resolve serial">OK</button>
            </div>
            <label>Exam Session</label>
            <select id="examV2EntrySession">${examSessions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Academic Year</label>
            <input id="examV2EntryYear" value="${new Date().getFullYear()}/${new Date().getFullYear() + 1}" />
            <label>Term</label>
            <select id="examV2EntryTerm">${termOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Grade</label>
            <select id="examV2EntryGrade"><option value="">Select grade</option>${gradeOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Form</label>
            <select id="examV2EntryForm"><option value="">Select form</option>${formOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Stream</label>
            <input id="examV2EntryStream" placeholder="Optional stream" />
            <label>Learning Area</label>
            <select id="examV2EntryArea"><option value="">Select learning area</option>${learningAreas.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
          </div>
          <details class="exam-v2-collapse" open>
            <summary>QR / code payload (optional)</summary>
            <div class="form-grid form-grid--exam-tight" style="margin-top:6px;">
              <label>Code / QR payload paste</label>
              <textarea id="examV2EntryPayloadInput" rows="2" placeholder="Paste IMIS_EXAM_QR_V1 payload"></textarea>
            </div>
            <div class="actions-row exam-icon-group exam-actions-tight" style="margin-top:6px;">
              <button class="ax-btn ax-btn--save ax-btn--sm" id="examV2EntryApplyPayloadBtn" title="Apply code payload">Apply Code</button>
              <button class="ax-btn ax-btn--generate ax-btn--sm" id="examV2EntryStartQrBtn" title="Open camera and scan QR">Scan QR</button>
              <button class="ax-btn ax-btn--delete ax-btn--sm" id="examV2EntryStopQrBtn" title="Stop camera">Stop Camera</button>
            </div>
            <video id="examV2EntryQrVideo" style="display:none;width:100%;max-width:320px;border:1px solid #d1d5db;border-radius:8px;margin-top:6px;" autoplay playsinline muted></video>
            <canvas id="examV2EntryQrCanvas" style="display:none;"></canvas>
            <div id="examV2EntryQrStatus" class="small-note">QR uses BarcodeDetector where supported.</div>
          </details>
          <div class="actions-row exam-icon-group exam-actions-tight">
            <button class="ax-btn ax-btn--view ax-btn--sm" id="examV2EntryConfirmBtn" title="Confirm selection">Confirm</button>
            <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2EntryVerifyBtn" title="Verify filters">Verify</button>
            <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2EntryLoadBtn" title="Load learners">Load</button>
            <button class="ax-btn ax-btn--save ax-btn--sm" id="examV2EntrySaveBtn" title="Save marks">Save</button>
            <button class="ax-btn ax-btn--view ax-btn--sm" id="examV2EntryViewBtn" title="View saved marks">View</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2EntryDownloadBtn" title="Download marks">Download</button>
            <button class="ax-btn ax-btn--print ax-btn--sm" id="examV2EntryPrintBtn" title="Print marks">Print</button>
          </div>
          <div id="examV2EntryStatus" class="small-note">Ready.</div>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>Learner</th><th>Admission</th><th>Grade/Form</th><th>Stream</th><th>Marks</th></tr></thead>
              <tbody id="examV2EntryRows"><tr><td colspan="5">Load learners first.</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    stylePanel();

    const gradeEl = document.getElementById("examV2EntryGrade");
    const formEl = document.getElementById("examV2EntryForm");
    const streamEl = document.getElementById("examV2EntryStream");
    const areaEl = document.getElementById("examV2EntryArea");
    const sessionEl = document.getElementById("examV2EntrySession");
    const termEl = document.getElementById("examV2EntryTerm");
    const yearEl = document.getElementById("examV2EntryYear");
    const rowsEl = document.getElementById("examV2EntryRows");
    const statusNode = document.getElementById("examV2EntryStatus");
    const methodEl = document.getElementById("examV2EntryMethod");
    const serialPanelEl = document.getElementById("examV2EntrySerialPanel");
    const serialInputEl = document.getElementById("examV2EntrySerialInput");
    const payloadInputEl = document.getElementById("examV2EntryPayloadInput");
    const qrStatusEl = document.getElementById("examV2EntryQrStatus");
    const qrVideoEl = document.getElementById("examV2EntryQrVideo");
    const qrCanvasEl = document.getElementById("examV2EntryQrCanvas");
    const generatedPayload = examPanelState.generatedExam?.payload || {};
    if (sessionEl && generatedPayload.exam_type) sessionEl.value = String(generatedPayload.exam_type);
    if (termEl && generatedPayload.term) termEl.value = String(generatedPayload.term);
    if (yearEl && generatedPayload.year) {
      const start = Number(generatedPayload.year);
      if (Number.isFinite(start) && start > 2000) yearEl.value = `${start}/${start + 1}`;
    }
    if (gradeEl && generatedPayload.grade) gradeEl.value = String(generatedPayload.grade);
    if (formEl && generatedPayload.form_name) formEl.value = String(generatedPayload.form_name);
    if (streamEl && generatedPayload.stream) streamEl.value = String(generatedPayload.stream);
    if (areaEl && generatedPayload.learning_area) areaEl.value = String(generatedPayload.learning_area);
    let loadedRows = [];
    let qrStream = null;
    let qrLoopHandle = null;
    const setQrStatus = (message) => {
      if (qrStatusEl) qrStatusEl.textContent = message || "";
    };
    const setEntryStatus = (message) => {
      if (statusNode) statusNode.textContent = message || "";
    };
    const renderRows = () => {
      if (!rowsEl) return;
      rowsEl.innerHTML = loadedRows.length
        ? loadedRows.map((row) => `
          <tr>
            <td>${escapeHtml(row.full_name || "-")}</td>
            <td>${escapeHtml(row.admission_number || "-")}</td>
            <td>${escapeHtml(row.grade || row.form_name || "-")}</td>
            <td>${escapeHtml(row.stream || "-")}</td>
            <td><input class="exam-v2-entry-mark" data-learner-id="${Number(row.id || 0)}" placeholder="e.g. 72 or X" /></td>
          </tr>
        `).join("")
        : `<tr><td colspan="5">No learners found for current filters.</td></tr>`;
    };
    const stopQrScan = () => {
      if (qrLoopHandle) {
        cancelAnimationFrame(qrLoopHandle);
        qrLoopHandle = null;
      }
      if (qrStream) {
        qrStream.getTracks().forEach((track) => track.stop());
        qrStream = null;
      }
      if (qrVideoEl) {
        qrVideoEl.pause();
        qrVideoEl.srcObject = null;
        qrVideoEl.style.display = "none";
      }
    };
    const parseUploadedPayload = (rawValue) => {
      const raw = String(rawValue || "").trim();
      if (!raw) return null;
      const parseLineBased = () => {
        const map = {};
        raw.split(/\r?\n/).forEach((line) => {
          const idx = line.indexOf(":");
          if (idx <= 0) return;
          const key = line.slice(0, idx).trim().toLowerCase().replace(/\s+/g, "_");
          const value = line.slice(idx + 1).trim();
          if (key) map[key] = value;
        });
        if (!Object.keys(map).length) return null;
        return {
          grade: map.grade_form || map.grade || "",
          form_name: map.form_name || "",
          stream: map.stream || "",
          learning_area: map.learning_area || "",
          exam_type: map.exam_session || map.exam_type || "",
          term: map.term || "",
          year: map.academic_year || map.year || "",
          admission_number: map.admission || map.admission_number || "",
          serial: map.serial || map.serial_number || ""
        };
      };
      try {
        if (raw.startsWith("IMIS_EXAM_QR_V1|")) {
          const jsonText = raw.split("|").slice(1).join("|");
          return JSON.parse(jsonText);
        }
        if (raw.startsWith("{")) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            if (String(parsed.schema || "").toUpperCase() === "IMIS_EXAM_QR_V1") return parsed;
            return parsed;
          }
        }
      } catch (_error) {
        // fall through to line parser
      }
      return parseLineBased();
    };
    const parseYearToken = (value) => {
      const match = String(value || "").match(/(\d{4})/);
      return match ? Number(match[1]) : null;
    };
    const applyUploadedDetails = async (details) => {
      if (!details || typeof details !== "object") throw new Error("Unable to parse code/QR details.");
      const gradeValue = String(details.grade || "").trim();
      const formValue = String(details.form_name || "").trim();
      if (gradeValue) {
        if (/^form/i.test(gradeValue)) {
          if (formEl) formEl.value = gradeValue;
          if (gradeEl) gradeEl.value = "";
        } else if (gradeEl) {
          gradeEl.value = gradeValue;
          if (formEl) formEl.value = "";
        }
      }
      if (formValue) {
        if (formEl) formEl.value = formValue;
        if (gradeEl) gradeEl.value = "";
      }
      if (streamEl && details.stream) streamEl.value = String(details.stream);
      if (areaEl && details.learning_area) areaEl.value = String(details.learning_area);
      if (sessionEl && details.exam_type) sessionEl.value = String(details.exam_type);
      if (termEl && details.term) termEl.value = String(details.term);
      const year = parseYearToken(details.year);
      if (yearEl && Number.isFinite(year) && year > 2000) yearEl.value = `${year}/${year + 1}`;
      await loadLearners();
      const admission = String(details.admission_number || "").trim().toLowerCase();
      const learnerId = Number(details.learner_id || 0);
      const matched = loadedRows.find((row) => {
        if (learnerId && Number(row.id || 0) === learnerId) return true;
        if (admission && String(row.admission_number || "").trim().toLowerCase() === admission) return true;
        return false;
      });
      if (matched) {
        setEntryStatus(`Loaded learner from QR/code: ${matched.full_name || "-"} (${matched.admission_number || "-"}) with exam details prefilled. Marks remain blank.`);
      } else {
        setEntryStatus("Exam details filled from QR/code. Learner marks remain blank as requested.");
      }
    };
    const runQrDetectorLoop = async () => {
      if (!qrVideoEl || !qrCanvasEl) return;
      if (!("BarcodeDetector" in window)) {
        setQrStatus("QR scanning via camera is unsupported in this browser. Paste payload manually or use code mode.");
        return;
      }
      let detector;
      try {
        detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch (_error) {
        setQrStatus("This device cannot initialize QR detector. Use manual/code upload mode.");
        return;
      }
      const tick = async () => {
        if (!qrVideoEl || !qrStream) return;
        try {
          const barcodes = await detector.detect(qrVideoEl);
          const match = Array.isArray(barcodes) ? barcodes.find((item) => String(item.rawValue || "").trim()) : null;
          if (match?.rawValue) {
            if (payloadInputEl) payloadInputEl.value = String(match.rawValue);
            await applyUploadedDetails(parseUploadedPayload(match.rawValue));
            setQrStatus("QR scanned successfully and learner exam details updated (marks unchanged).");
            stopQrScan();
            return;
          }
        } catch (_error) {
          // keep scanning
        }
        qrLoopHandle = requestAnimationFrame(tick);
      };
      qrLoopHandle = requestAnimationFrame(tick);
    };

    const loadLearners = async () => {
      const grade = String(gradeEl?.value || "");
      const form = String(formEl?.value || "");
      const stream = String(streamEl?.value || "").trim().toLowerCase();
      const tokens = [grade, form, stream].filter(Boolean).join(" ");
      try {
        const rows = await request(`/api/admission/learners?limit=500&search=${encodeURIComponent(tokens)}`);
        loadedRows = (Array.isArray(rows) ? rows : []).filter((row) => {
          if (grade && String(row.grade || "") !== grade) return false;
          if (form && String(row.form_name || "") !== form) return false;
          if (stream && String(row.stream || "").toLowerCase() !== stream) return false;
          return true;
        });
        renderRows();
        setEntryStatus(`Loaded ${loadedRows.length} learner(s).`);
      } catch (error) {
        setEntryStatus(error.message);
      }
    };
    const refreshEntryMethodUi = () => {
      const mode = String(methodEl?.value || "manual");
      if (serialPanelEl) serialPanelEl.style.display = mode === "serial" ? "grid" : "none";
    };
    methodEl?.addEventListener("change", refreshEntryMethodUi);
    refreshEntryMethodUi();

    document.getElementById("examV2EntrySerialOkBtn")?.addEventListener("click", async () => {
      const serial = String(serialInputEl?.value || "").trim();
      if (!serial) {
        alert("Enter serial first.");
        return;
      }
      const grade = String(gradeEl?.value || "");
      const form = String(formEl?.value || "");
      const learning_area = String(areaEl?.value || "");
      const exam_type = String(sessionEl?.value || "");
      const term = String(termEl?.value || "");
      const year = parseAcademicYearStart(String(yearEl?.value || ""));
      const stream = String(streamEl?.value || "");
      if (!(grade || form) || !learning_area || !exam_type || !year) {
        alert("Select grade/form, learning area, session, term and year before resolving serial.");
        return;
      }
      try {
        const result = await request("/api/academic/exams/resolve-serial", {
          method: "POST",
          body: JSON.stringify({
            serial,
            grade,
            form_name: form,
            learning_area,
            exam_type,
            term,
            year,
            stream
          })
        });
        if (result?.match && result.learner?.id) {
          try {
            const rows = await request(
              `/api/admission/learners?limit=50&search=${encodeURIComponent(String(result.learner.admission_number || result.learner.id || ""))}`
            );
            const pool = Array.isArray(rows) ? rows : [];
            loadedRows = pool.filter((row) => Number(row.id || 0) === Number(result.learner.id));
            if (!loadedRows.length) loadedRows = [result.learner];
          } catch (_e) {
            loadedRows = [result.learner];
          }
          renderRows();
          setEntryStatus(`Serial matched — enter marks only for ${result.learner.full_name || "learner"}.`);
        }
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("examV2EntryConfirmBtn")?.addEventListener("click", () => {
      setEntryStatus(
        `Confirmed exam context: ${String(sessionEl?.value || "-")} | ${String(yearEl?.value || "-")} | ${String(termEl?.value || "-")} | ${String(gradeEl?.value || formEl?.value || "-")} | ${String(areaEl?.value || "-")} | stream ${String(streamEl?.value || "N/A")}`
      );
    });
    document.getElementById("examV2EntryVerifyBtn")?.addEventListener("click", () => {
      setEntryStatus("Verified: filters are internally consistent. Load when ready to enter marks.");
    });

    gradeEl?.addEventListener("change", () => { if (gradeEl.value && formEl) formEl.value = ""; });
    formEl?.addEventListener("change", () => { if (formEl.value && gradeEl) gradeEl.value = ""; });
    document.getElementById("examV2EntryLoadBtn")?.addEventListener("click", loadLearners);
    document.getElementById("examV2EntryApplyPayloadBtn")?.addEventListener("click", async () => {
      try {
        const parsed = parseUploadedPayload(String(payloadInputEl?.value || ""));
        await applyUploadedDetails(parsed);
        setQrStatus(`Applied payload (${String(methodEl?.value || "manual")}).`);
      } catch (error) {
        setQrStatus(error.message);
      }
    });
    document.getElementById("examV2EntryStartQrBtn")?.addEventListener("click", async () => {
      try {
        stopQrScan();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        qrStream = stream;
        if (qrVideoEl) {
          qrVideoEl.srcObject = stream;
          qrVideoEl.style.display = "block";
          await qrVideoEl.play();
        }
        setQrStatus("Camera opened. Position the QR code inside the frame.");
        runQrDetectorLoop();
      } catch (error) {
        setQrStatus(`Unable to open camera for QR scanning: ${error.message}`);
      }
    });
    document.getElementById("examV2EntryStopQrBtn")?.addEventListener("click", () => {
      stopQrScan();
      setQrStatus("Camera stopped.");
    });

    document.getElementById("examV2EntrySaveBtn")?.addEventListener("click", async () => {
      if (!loadedRows.length) {
        alert("Load learners first.");
        return;
      }
      const markMap = new Map();
      panel.querySelectorAll(".exam-v2-entry-mark").forEach((input) => {
        markMap.set(String(input.getAttribute("data-learner-id") || ""), String(input.value || "").trim().toUpperCase());
      });
      const payloadRows = loadedRows
        .map((row) => {
          const raw = markMap.get(String(row.id || "")) || "";
          if (!raw) return null;
          if (raw === "X") {
            return {
              learner_id: Number(row.id || 0),
              learner_name: row.full_name || "",
              upi_number: row.upi_number || "",
              assessment_number: row.assessment_number || "",
              birth_certificate_number: row.birth_certificate_number || "",
              grade: row.grade || String(gradeEl?.value || formEl?.value || ""),
              stream: row.stream || String(streamEl?.value || ""),
              exam_type: String(sessionEl?.value || ""),
              subject: String(areaEl?.value || ""),
              marks: 0,
              percentage: 0,
              cbc_grade_band: "ABSENT",
              term: String(termEl?.value || ""),
              year: parseAcademicYearStart(String(yearEl?.value || ""))
            };
          }
          const marks = Number(raw);
          if (!Number.isFinite(marks)) return null;
          return {
            learner_id: Number(row.id || 0),
            learner_name: row.full_name || "",
            upi_number: row.upi_number || "",
            assessment_number: row.assessment_number || "",
            birth_certificate_number: row.birth_certificate_number || "",
            grade: row.grade || String(gradeEl?.value || formEl?.value || ""),
            stream: row.stream || String(streamEl?.value || ""),
            exam_type: String(sessionEl?.value || ""),
            subject: String(areaEl?.value || ""),
            marks,
            percentage: marks,
            cbc_grade_band: cbcBandFromScore(marks),
            term: String(termEl?.value || ""),
            year: parseAcademicYearStart(String(yearEl?.value || ""))
          };
        })
        .filter(Boolean);
      if (!payloadRows.length) {
        alert("Enter at least one mark value.");
        return;
      }
      try {
        for (const row of payloadRows) {
          await request("/api/academic/marks", { method: "POST", body: JSON.stringify(row) });
        }
        setEntryStatus(`Saved ${payloadRows.length} marks record(s).`);
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("examV2EntryViewBtn")?.addEventListener("click", async () => {
      try {
        const rows = await request("/api/academic/marks?limit=260");
        const grade = String(gradeEl?.value || formEl?.value || "");
        const stream = String(streamEl?.value || "").trim().toLowerCase();
        const area = String(areaEl?.value || "").trim().toLowerCase();
        const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
          if (grade && String(row.grade || "").trim() !== grade) return false;
          if (stream && String(row.stream || "").trim().toLowerCase() !== stream) return false;
          if (area && String(row.subject || "").trim().toLowerCase() !== area) return false;
          return true;
        });
        setEntryStatus(filtered.length
          ? `Saved rows: ${filtered.slice(0, 8).map((row) => `${row.learner_name}:${row.marks}`).join(" | ")}`
          : "No saved marks found for filters.");
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("examV2EntryDownloadBtn")?.addEventListener("click", async () => {
      try {
        const rows = await request("/api/academic/marks?limit=500");
        const csv = rowsToCsv((Array.isArray(rows) ? rows : []).map((row) => ({
          learner_name: row.learner_name || "",
          grade: row.grade || "",
          stream: row.stream || "",
          exam_type: row.exam_type || "",
          subject: row.subject || "",
          marks: row.marks || "",
          percentage: row.percentage || "",
          band: row.cbc_grade_band || ""
        })));
        downloadTextFile("exam-entry-marks.csv", csv, "text/csv;charset=utf-8");
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("examV2EntryPrintBtn")?.addEventListener("click", () => window.print());
  };

  const renderExamScriptsTab = async () => {
    panel.innerHTML = `
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Exam Scripts</h4>
          <p class="small-note">Generate ranked scripts by class, stream, term and year from marks records.</p>
          <div class="form-grid">
            <label>Grade</label>
            <select id="examV2ScriptGrade"><option value="">Select grade</option>${gradeOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Form</label>
            <select id="examV2ScriptForm"><option value="">Select form</option>${formOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Stream</label><input id="examV2ScriptStream" placeholder="Optional stream" />
            <label>Term</label><select id="examV2ScriptTerm">${termOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Year</label><input id="examV2ScriptYear" type="number" value="${new Date().getFullYear()}" />
          </div>
          <div class="actions-row exam-icon-group">
            <button class="ax-btn ax-btn--generate ax-btn--sm" id="examV2ScriptGenerateBtn" title="Generate scripts">Generate</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2ScriptDownloadBtn" title="Download scripts">Download</button>
            <button class="ax-btn ax-btn--print ax-btn--sm" id="examV2ScriptPrintBtn" title="Print scripts">Print</button>
          </div>
          <div id="examV2ScriptStatus" class="small-note">No scripts generated yet.</div>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>Position</th><th>Learner</th><th>Grade</th><th>Stream</th><th>Avg %</th><th>Total</th></tr></thead>
              <tbody id="examV2ScriptRows"><tr><td colspan="6">Generate scripts to view rows.</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    stylePanel();

    const gradeEl = document.getElementById("examV2ScriptGrade");
    const formEl = document.getElementById("examV2ScriptForm");
    const streamEl = document.getElementById("examV2ScriptStream");
    const termEl = document.getElementById("examV2ScriptTerm");
    const yearEl = document.getElementById("examV2ScriptYear");
    const rowsEl = document.getElementById("examV2ScriptRows");
    const statusNode = document.getElementById("examV2ScriptStatus");
    let rankedRows = [];
    const setScriptStatus = (message) => {
      if (statusNode) statusNode.textContent = message || "";
    };
    const renderRows = () => {
      rowsEl.innerHTML = rankedRows.length
        ? rankedRows.map((row) => `
          <tr>
            <td>${escapeHtml(String(row.position || "-"))}</td>
            <td>${escapeHtml(row.learner_name || "-")}</td>
            <td>${escapeHtml(row.grade || "-")}</td>
            <td>${escapeHtml(row.stream || "-")}</td>
            <td>${escapeHtml(String(row.avg_pct || "0"))}</td>
            <td>${escapeHtml(String(row.total_marks || "0"))}</td>
          </tr>
        `).join("")
        : `<tr><td colspan="6">No ranked rows returned.</td></tr>`;
    };
    gradeEl?.addEventListener("change", () => { if (gradeEl.value && formEl) formEl.value = ""; });
    formEl?.addEventListener("change", () => { if (formEl.value && gradeEl) gradeEl.value = ""; });
    document.getElementById("examV2ScriptGenerateBtn")?.addEventListener("click", async () => {
      const grade = String(gradeEl?.value || formEl?.value || "");
      const stream = String(streamEl?.value || "").trim();
      const term = String(termEl?.value || "");
      const year = Number(yearEl?.value || new Date().getFullYear());
      try {
        const result = await request(`/api/academic/results/ranked?grade=${encodeURIComponent(grade)}&stream=${encodeURIComponent(stream)}&term=${encodeURIComponent(term)}&year=${encodeURIComponent(String(year))}`);
        rankedRows = Array.isArray(result?.ranked) ? result.ranked : [];
        renderRows();
        setScriptStatus(`Ranked ${rankedRows.length} learner(s).`);
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("examV2ScriptDownloadBtn")?.addEventListener("click", () => {
      if (!rankedRows.length) {
        alert("Generate scripts first.");
        return;
      }
      downloadTextFile("exam-scripts-ranked.csv", rowsToCsv(rankedRows), "text/csv;charset=utf-8");
    });
    document.getElementById("examV2ScriptPrintBtn")?.addEventListener("click", () => window.print());
  };

  const renderAssessmentReportsTab = async () => {
    panel.innerHTML = `
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Assessment Reports</h4>
          <p class="small-note">Generate learner-level assessment report from exams and CBC-aligned records.</p>
          <div class="form-grid">
            <label>Search Learner</label>
            <input id="examV2AssessSearch" placeholder="Name, admission number, stream..." />
            <label>Learner</label>
            <select id="examV2AssessLearner"><option value="">Select learner</option></select>
          </div>
          <div class="actions-row exam-icon-group">
            <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2AssessLoadBtn" title="Load learners">Refresh</button>
            <button class="ax-btn ax-btn--generate ax-btn--sm" id="examV2AssessGenerateBtn" title="Generate report">Generate</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2AssessDownloadBtn" title="Download report">Download</button>
            <button class="ax-btn ax-btn--print ax-btn--sm" id="examV2AssessPrintBtn" title="Print report">Print</button>
          </div>
          <div id="examV2AssessOutput" class="small-note">Select learner then generate report.</div>
        </div>
      </div>
    `;
    stylePanel();
    let currentReport = null;
    const searchEl = document.getElementById("examV2AssessSearch");
    const learnerEl = document.getElementById("examV2AssessLearner");
    const outputEl = document.getElementById("examV2AssessOutput");
    const loadLearners = async () => {
      const queryText = String(searchEl?.value || "").trim();
      try {
        const rows = await request(`/api/admission/learners?limit=500&search=${encodeURIComponent(queryText)}`);
        const list = Array.isArray(rows) ? rows : [];
        learnerEl.innerHTML = `<option value="">Select learner</option>${list.map((row) => `<option value="${Number(row.id || 0)}">${escapeHtml(row.full_name || "-")} (${escapeHtml(row.admission_number || "-")})</option>`).join("")}`;
      } catch (error) {
        outputEl.textContent = error.message;
      }
    };
    document.getElementById("examV2AssessLoadBtn")?.addEventListener("click", loadLearners);
    document.getElementById("examV2AssessGenerateBtn")?.addEventListener("click", async () => {
      const learnerId = Number(learnerEl?.value || 0);
      if (!learnerId) {
        alert("Select learner first.");
        return;
      }
      try {
        const report = await request(`/api/academic/assessment-report/${learnerId}`);
        currentReport = report;
        const marks = Array.isArray(report?.marks) ? report.marks : [];
        outputEl.innerHTML = `
          <strong>Learner:</strong> ${escapeHtml(report?.learner?.full_name || "-")}<br/>
          <strong>Admission:</strong> ${escapeHtml(report?.learner?.admission_number || "-")}<br/>
          <strong>Current Class:</strong> ${escapeHtml(report?.learner?.grade || "-")} ${escapeHtml(report?.learner?.stream || "")}<br/>
          <strong>Total Records:</strong> ${escapeHtml(String(marks.length))}<br/><br/>
          ${marks.slice(0, 80).map((row) => `${escapeHtml(row.year || "-")} ${escapeHtml(row.term || "-")} | ${escapeHtml(row.subject || "-")} | ${escapeHtml(String(row.marks || 0))} (${escapeHtml(String(row.percentage || 0))}%)`).join("<br/>")}
        `;
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("examV2AssessDownloadBtn")?.addEventListener("click", () => {
      if (!currentReport) {
        alert("Generate report first.");
        return;
      }
      downloadTextFile("assessment-report.json", JSON.stringify(currentReport, null, 2), "application/json;charset=utf-8");
    });
    document.getElementById("examV2AssessPrintBtn")?.addEventListener("click", () => {
      if (!currentReport) {
        alert("Generate report first.");
        return;
      }
      const popup = window.open("", "_blank");
      if (!popup) return;
      popup.document.write(`<pre>${escapeHtml(JSON.stringify(currentReport, null, 2))}</pre>`);
      popup.document.close();
      popup.print();
    });
    await loadLearners();
  };

  const renderProgressReportsTab = async () => {
    panel.innerHTML = `
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Progress Reports</h4>
          <p class="small-note">Display learner progression across all exams and academic years since admission.</p>
          <div class="form-grid">
            <label>Search Learner</label>
            <input id="examV2ProgressSearch" placeholder="Name, admission number..." />
            <label>Learner</label>
            <select id="examV2ProgressLearner"><option value="">Select learner</option></select>
          </div>
          <div class="actions-row exam-icon-group">
            <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2ProgressLoadBtn" title="Load learners">Refresh</button>
            <button class="ax-btn ax-btn--generate ax-btn--sm" id="examV2ProgressGenerateBtn" title="Generate progression">Generate</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2ProgressDownloadBtn" title="Download progression">Download</button>
            <button class="ax-btn ax-btn--print ax-btn--sm" id="examV2ProgressPrintBtn" title="Print progression">Print</button>
          </div>
          <div id="examV2ProgressOutput" class="small-note">Generate learner progression to view timeline.</div>
        </div>
      </div>
    `;
    stylePanel();
    let currentReport = null;
    const searchEl = document.getElementById("examV2ProgressSearch");
    const learnerEl = document.getElementById("examV2ProgressLearner");
    const outputEl = document.getElementById("examV2ProgressOutput");
    const loadLearners = async () => {
      const queryText = String(searchEl?.value || "").trim();
      try {
        const rows = await request(`/api/admission/learners?limit=500&search=${encodeURIComponent(queryText)}`);
        const list = Array.isArray(rows) ? rows : [];
        learnerEl.innerHTML = `<option value="">Select learner</option>${list.map((row) => `<option value="${Number(row.id || 0)}">${escapeHtml(row.full_name || "-")} (${escapeHtml(row.admission_number || "-")})</option>`).join("")}`;
      } catch (error) {
        outputEl.textContent = error.message;
      }
    };
    document.getElementById("examV2ProgressLoadBtn")?.addEventListener("click", loadLearners);
    document.getElementById("examV2ProgressGenerateBtn")?.addEventListener("click", async () => {
      const learnerId = Number(learnerEl?.value || 0);
      if (!learnerId) {
        alert("Select learner first.");
        return;
      }
      try {
        const report = await request(`/api/academic/assessment-report/${learnerId}`);
        currentReport = report;
        const trend = Array.isArray(report?.performance_trend) ? report.performance_trend : [];
        outputEl.innerHTML = trend.length
          ? trend.map((point) => `${escapeHtml(String(point.year || "-"))} ${escapeHtml(String(point.term || "-"))} -> Avg ${escapeHtml(String(point.avg || 0))}% (${escapeHtml(String(point.count || 0))} subjects)`).join("<br/>")
          : "No performance trend points found.";
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("examV2ProgressDownloadBtn")?.addEventListener("click", () => {
      if (!currentReport) {
        alert("Generate progression first.");
        return;
      }
      downloadTextFile("progress-report.json", JSON.stringify(currentReport, null, 2), "application/json;charset=utf-8");
    });
    document.getElementById("examV2ProgressPrintBtn")?.addEventListener("click", () => {
      if (!currentReport) {
        alert("Generate progression first.");
        return;
      }
      const popup = window.open("", "_blank");
      if (!popup) return;
      popup.document.write(`<pre>${escapeHtml(JSON.stringify(currentReport, null, 2))}</pre>`);
      popup.document.close();
      popup.print();
    });
    await loadLearners();
  };

  const renderGradebookTab = async () => {
    panel.innerHTML = `
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Gradebook Intelligence</h4>
          <p class="small-note">SIS-style gradebook by subject, learner and competency distribution with class filters.</p>
          <div class="form-grid">
            <label>Grade</label>
            <select id="examV2GradebookGrade"><option value="">All grades</option>${gradeOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Form</label>
            <select id="examV2GradebookForm"><option value="">All forms</option>${formOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Stream</label>
            <input id="examV2GradebookStream" placeholder="Optional stream" />
            <label>Term</label>
            <select id="examV2GradebookTerm"><option value="">All terms</option>${termOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Year</label>
            <input id="examV2GradebookYear" type="number" value="${new Date().getFullYear()}" />
          </div>
          <div class="actions-row exam-icon-group">
            <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2GradebookLoadBtn" title="Refresh gradebook">Refresh</button>
            <button class="ax-btn ax-btn--view ax-btn--sm" id="examV2GradebookViewBtn" title="View gradebook">View</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2GradebookDownloadBtn" title="Download gradebook">Download</button>
            <button class="ax-btn ax-btn--print ax-btn--sm" id="examV2GradebookPrintBtn" title="Print gradebook">Print</button>
          </div>
          <div id="examV2GradebookCards" class="exam-analytics-grid"></div>
          <div id="examV2GradebookStatus" class="small-note">Loading gradebook...</div>
        </div>
      </div>
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Subject Performance</h4>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>Subject</th><th>Entries</th><th>Avg Marks</th><th>Avg %</th></tr></thead>
              <tbody id="examV2GradebookSubjectRows"><tr><td colspan="4">No rows loaded yet.</td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="exam-v2-pane">
          <h4>Learner Gradebook (Top)</h4>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>Learner</th><th>Grade</th><th>Stream</th><th>Mean %</th><th>Subjects</th></tr></thead>
              <tbody id="examV2GradebookLearnerRows"><tr><td colspan="5">No rows loaded yet.</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    stylePanel();
    const gradeEl = document.getElementById("examV2GradebookGrade");
    const formEl = document.getElementById("examV2GradebookForm");
    const streamEl = document.getElementById("examV2GradebookStream");
    const termEl = document.getElementById("examV2GradebookTerm");
    const yearEl = document.getElementById("examV2GradebookYear");
    const cardsEl = document.getElementById("examV2GradebookCards");
    const statusEl = document.getElementById("examV2GradebookStatus");
    const subjectRowsEl = document.getElementById("examV2GradebookSubjectRows");
    const learnerRowsEl = document.getElementById("examV2GradebookLearnerRows");
    let lastPayload = null;
    const setStatus = (message) => {
      if (statusEl) statusEl.textContent = message || "";
    };
    const load = async () => {
      const params = new URLSearchParams();
      const grade = String(gradeEl?.value || "");
      const form_name = String(formEl?.value || "");
      const stream = String(streamEl?.value || "").trim();
      const term = String(termEl?.value || "");
      const year = String(yearEl?.value || "").trim();
      if (grade) params.set("grade", grade);
      if (!grade && form_name) params.set("form_name", form_name);
      if (stream) params.set("stream", stream);
      if (term) params.set("term", term);
      if (year) params.set("year", year);
      try {
        const payload = await request(`/api/examinations/gradebook/overview?${params.toString()}`);
        lastPayload = payload;
        const subjects = Array.isArray(payload?.by_subject) ? payload.by_subject : [];
        const learners = Array.isArray(payload?.learner_gradebook) ? payload.learner_gradebook : [];
        const bands = Array.isArray(payload?.competency_distribution) ? payload.competency_distribution : [];
        if (cardsEl) {
          cardsEl.innerHTML = `
            <article class="exam-analytics-card"><h5>Subjects</h5><p>${formatNumber(payload?.totals?.subjects || 0)}</p></article>
            <article class="exam-analytics-card"><h5>Learners</h5><p>${formatNumber(payload?.totals?.learners || 0)}</p></article>
            <article class="exam-analytics-card"><h5>Rows</h5><p>${formatNumber(payload?.totals?.marks_rows || 0)}</p></article>
            <article class="exam-analytics-card"><h5>Competency Bands</h5><p>${bands.map((row) => `${escapeHtml(row.cbc_grade_band)}:${formatNumber(row.total || 0)}`).join(" · ") || "N/A"}</p></article>
          `;
        }
        if (subjectRowsEl) {
          subjectRowsEl.innerHTML = subjects.length
            ? subjects.map((row) => `
              <tr>
                <td>${escapeHtml(row.subject || "-")}</td>
                <td>${escapeHtml(String(row.total_entries || 0))}</td>
                <td>${escapeHtml(String(row.avg_marks || 0))}</td>
                <td>${escapeHtml(String(row.avg_percentage || 0))}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="4">No gradebook subject rows found.</td></tr>`;
        }
        if (learnerRowsEl) {
          learnerRowsEl.innerHTML = learners.length
            ? learners.slice(0, 120).map((row) => `
              <tr>
                <td>${escapeHtml(row.learner_name || "-")}</td>
                <td>${escapeHtml(row.grade || "-")}</td>
                <td>${escapeHtml(row.stream || "-")}</td>
                <td>${escapeHtml(String(row.mean_percentage || 0))}</td>
                <td>${escapeHtml(String(row.subject_count || 0))}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="5">No learner gradebook rows found.</td></tr>`;
        }
        setStatus(`Gradebook loaded: ${subjects.length} subjects and ${learners.length} learner summaries.`);
      } catch (error) {
        setStatus(error.message);
      }
    };
    gradeEl?.addEventListener("change", () => { if (gradeEl.value && formEl) formEl.value = ""; });
    formEl?.addEventListener("change", () => { if (formEl.value && gradeEl) gradeEl.value = ""; });
    document.getElementById("examV2GradebookLoadBtn")?.addEventListener("click", load);
    document.getElementById("examV2GradebookViewBtn")?.addEventListener("click", load);
    document.getElementById("examV2GradebookDownloadBtn")?.addEventListener("click", () => {
      const payload = lastPayload || {};
      const subjects = Array.isArray(payload?.by_subject) ? payload.by_subject : [];
      const learners = Array.isArray(payload?.learner_gradebook) ? payload.learner_gradebook : [];
      if (!subjects.length && !learners.length) {
        alert("Load gradebook first.");
        return;
      }
      const csv = rowsToCsv([
        ...subjects.map((row) => ({ section: "subject", ...row })),
        ...learners.map((row) => ({ section: "learner", ...row }))
      ]);
      downloadTextFile("exam-gradebook-overview.csv", csv, "text/csv;charset=utf-8");
    });
    document.getElementById("examV2GradebookPrintBtn")?.addEventListener("click", () => window.print());
    await load();
  };

  const renderAssessmentTrackingTab = async () => {
    panel.innerHTML = `
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Assessment Tracking Engine</h4>
          <p class="small-note">Track performance movement, subject competency coverage and intervention watchlist in real time.</p>
          <div class="form-grid">
            <label>Grade</label>
            <select id="examV2TrackGrade"><option value="">All grades</option>${gradeOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Form</label>
            <select id="examV2TrackForm"><option value="">All forms</option>${formOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Stream</label>
            <input id="examV2TrackStream" placeholder="Optional stream" />
            <label>Term</label>
            <select id="examV2TrackTerm"><option value="">All terms</option>${termOptions.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}</select>
            <label>Year</label>
            <input id="examV2TrackYear" type="number" value="${new Date().getFullYear()}" />
          </div>
          <div class="actions-row exam-icon-group">
            <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2TrackLoadBtn" title="Refresh tracking">Refresh</button>
            <button class="ax-btn ax-btn--view ax-btn--sm" id="examV2TrackViewBtn" title="View tracking">View</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2TrackDownloadBtn" title="Download tracking">Download</button>
            <button class="ax-btn ax-btn--print ax-btn--sm" id="examV2TrackPrintBtn" title="Print tracking">Print</button>
          </div>
          <div id="examV2TrackCards" class="exam-analytics-grid"></div>
          <div id="examV2TrackStatus" class="small-note">Loading assessment tracking...</div>
        </div>
      </div>
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Subject Tracking</h4>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>Subject</th><th>Assessments</th><th>Avg %</th><th>Proficient</th><th>Intervention</th></tr></thead>
              <tbody id="examV2TrackSubjectRows"><tr><td colspan="5">No rows loaded yet.</td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="exam-v2-pane">
          <h4>Intervention Watchlist</h4>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>Learner</th><th>Grade</th><th>Stream</th><th>Avg %</th><th>Rows</th></tr></thead>
              <tbody id="examV2TrackRiskRows"><tr><td colspan="5">No learner needs intervention yet.</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    stylePanel();
    const gradeEl = document.getElementById("examV2TrackGrade");
    const formEl = document.getElementById("examV2TrackForm");
    const streamEl = document.getElementById("examV2TrackStream");
    const termEl = document.getElementById("examV2TrackTerm");
    const yearEl = document.getElementById("examV2TrackYear");
    const cardsEl = document.getElementById("examV2TrackCards");
    const statusEl = document.getElementById("examV2TrackStatus");
    const subjectRowsEl = document.getElementById("examV2TrackSubjectRows");
    const riskRowsEl = document.getElementById("examV2TrackRiskRows");
    let lastPayload = null;
    const setStatus = (message) => {
      if (statusEl) statusEl.textContent = message || "";
    };
    const load = async () => {
      const params = new URLSearchParams();
      const grade = String(gradeEl?.value || "");
      const form_name = String(formEl?.value || "");
      const stream = String(streamEl?.value || "").trim();
      const term = String(termEl?.value || "");
      const year = String(yearEl?.value || "").trim();
      if (grade) params.set("grade", grade);
      if (!grade && form_name) params.set("form_name", form_name);
      if (stream) params.set("stream", stream);
      if (term) params.set("term", term);
      if (year) params.set("year", year);
      try {
        const payload = await request(`/api/examinations/assessment-tracking/overview?${params.toString()}`);
        lastPayload = payload;
        const bySubject = Array.isArray(payload?.by_subject) ? payload.by_subject : [];
        const risk = Array.isArray(payload?.intervention_watchlist) ? payload.intervention_watchlist : [];
        const byLearner = Array.isArray(payload?.learner_tracking) ? payload.learner_tracking : [];
        if (cardsEl) {
          cardsEl.innerHTML = `
            <article class="exam-analytics-card"><h5>Learners Tracked</h5><p>${formatNumber(byLearner.length)}</p></article>
            <article class="exam-analytics-card"><h5>Subjects Tracked</h5><p>${formatNumber(bySubject.length)}</p></article>
            <article class="exam-analytics-card"><h5>Watchlist</h5><p>${formatNumber(risk.length)}</p></article>
          `;
        }
        if (subjectRowsEl) {
          subjectRowsEl.innerHTML = bySubject.length
            ? bySubject.map((row) => `
              <tr>
                <td>${escapeHtml(row.subject || "-")}</td>
                <td>${escapeHtml(String(row.total_assessments || 0))}</td>
                <td>${escapeHtml(String(row.avg_percentage || 0))}</td>
                <td>${escapeHtml(String(row.proficient_count || 0))}</td>
                <td>${escapeHtml(String(row.intervention_count || 0))}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="5">No subject tracking rows found.</td></tr>`;
        }
        if (riskRowsEl) {
          riskRowsEl.innerHTML = risk.length
            ? risk.map((row) => `
              <tr>
                <td>${escapeHtml(row.learner_name || "-")}</td>
                <td>${escapeHtml(row.grade || "-")}</td>
                <td>${escapeHtml(row.stream || "-")}</td>
                <td>${escapeHtml(String(row.avg_percentage || 0))}</td>
                <td>${escapeHtml(String(row.rows_count || 0))}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="5">No learners in intervention watchlist.</td></tr>`;
        }
        setStatus(`Assessment tracking loaded for ${byLearner.length} learner profile(s).`);
      } catch (error) {
        setStatus(error.message);
      }
    };
    gradeEl?.addEventListener("change", () => { if (gradeEl.value && formEl) formEl.value = ""; });
    formEl?.addEventListener("change", () => { if (formEl.value && gradeEl) gradeEl.value = ""; });
    document.getElementById("examV2TrackLoadBtn")?.addEventListener("click", load);
    document.getElementById("examV2TrackViewBtn")?.addEventListener("click", load);
    document.getElementById("examV2TrackDownloadBtn")?.addEventListener("click", () => {
      const payload = lastPayload || {};
      const rows = [
        ...(Array.isArray(payload?.by_subject) ? payload.by_subject.map((row) => ({ section: "subject", ...row })) : []),
        ...(Array.isArray(payload?.intervention_watchlist) ? payload.intervention_watchlist.map((row) => ({ section: "watchlist", ...row })) : []),
        ...(Array.isArray(payload?.learner_tracking) ? payload.learner_tracking.map((row) => ({ section: "learner", ...row })) : [])
      ];
      if (!rows.length) {
        alert("Load tracking data first.");
        return;
      }
      downloadTextFile("exam-assessment-tracking.csv", rowsToCsv(rows), "text/csv;charset=utf-8");
    });
    document.getElementById("examV2TrackPrintBtn")?.addEventListener("click", () => window.print());
    await load();
  };

  const renderPortalInsightsTab = async () => {
    panel.innerHTML = `
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Parent & Learner Portal Insights</h4>
          <p class="small-note">Parent engagement, learner portal readiness, communication outcomes and high performers feed.</p>
          <div class="actions-row exam-icon-group">
            <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2PortalLoadBtn" title="Refresh insights">Refresh</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2PortalDownloadBtn" title="Download insights">Download</button>
            <button class="ax-btn ax-btn--print ax-btn--sm" id="examV2PortalPrintBtn" title="Print insights">Print</button>
          </div>
          <div id="examV2PortalCards" class="exam-analytics-grid"></div>
          <div id="examV2PortalStatus" class="small-note">Loading portal insights...</div>
        </div>
      </div>
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Parent/Learner Communication Status</h4>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>Status</th><th>Total</th></tr></thead>
              <tbody id="examV2PortalCommRows"><tr><td colspan="2">No rows available yet.</td></tr></tbody>
            </table>
          </div>
        </div>
        <div class="exam-v2-pane">
          <h4>Learner Portal Feed (Top Performance)</h4>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>Learner</th><th>Admission</th><th>Grade</th><th>Stream</th><th>Avg %</th><th>Exams</th></tr></thead>
              <tbody id="examV2PortalFeedRows"><tr><td colspan="6">No rows available yet.</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    stylePanel();
    const cardsEl = document.getElementById("examV2PortalCards");
    const statusEl = document.getElementById("examV2PortalStatus");
    const commRowsEl = document.getElementById("examV2PortalCommRows");
    const feedRowsEl = document.getElementById("examV2PortalFeedRows");
    let lastPayload = null;
    const setStatus = (message) => {
      if (statusEl) statusEl.textContent = message || "";
    };
    const load = async () => {
      try {
        const payload = await request("/api/examinations/portals/overview");
        lastPayload = payload;
        const counters = payload?.counters || {};
        const commRows = Array.isArray(payload?.communication_status) ? payload.communication_status : [];
        const feedRows = Array.isArray(payload?.learner_portal_feed) ? payload.learner_portal_feed : [];
        if (cardsEl) {
          cardsEl.innerHTML = `
            <article class="exam-analytics-card"><h5>Total Learners</h5><p>${formatNumber(counters.total_learners || 0)}</p></article>
            <article class="exam-analytics-card"><h5>With Parent Profile</h5><p>${formatNumber(counters.learners_with_parent_profile || 0)}</p></article>
            <article class="exam-analytics-card"><h5>Assessed Learners</h5><p>${formatNumber(counters.assessed_learners || 0)}</p></article>
            <article class="exam-analytics-card"><h5>Parent Engagement %</h5><p>${escapeHtml(String(counters.parent_engagement_rate_pct || 0))}</p></article>
            <article class="exam-analytics-card"><h5>Learner Portal Coverage %</h5><p>${escapeHtml(String(counters.learner_portal_coverage_rate_pct || 0))}</p></article>
          `;
        }
        if (commRowsEl) {
          commRowsEl.innerHTML = commRows.length
            ? commRows.map((row) => `<tr><td>${escapeHtml(row.status || "-")}</td><td>${escapeHtml(String(row.total || 0))}</td></tr>`).join("")
            : `<tr><td colspan="2">No communication status rows found.</td></tr>`;
        }
        if (feedRowsEl) {
          feedRowsEl.innerHTML = feedRows.length
            ? feedRows.map((row) => `
              <tr>
                <td>${escapeHtml(row.learner_name || "-")}</td>
                <td>${escapeHtml(row.admission_number || "-")}</td>
                <td>${escapeHtml(row.grade || "-")}</td>
                <td>${escapeHtml(row.stream || "-")}</td>
                <td>${escapeHtml(String(row.avg_percentage || 0))}</td>
                <td>${escapeHtml(String(row.exams_done || 0))}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="6">No portal feed rows found.</td></tr>`;
        }
        setStatus("Portal insights refreshed.");
      } catch (error) {
        setStatus(error.message);
      }
    };
    document.getElementById("examV2PortalLoadBtn")?.addEventListener("click", load);
    document.getElementById("examV2PortalDownloadBtn")?.addEventListener("click", () => {
      const payload = lastPayload || {};
      const rows = [
        ...(Array.isArray(payload?.communication_status) ? payload.communication_status.map((row) => ({ section: "communication_status", ...row })) : []),
        ...(Array.isArray(payload?.learner_portal_feed) ? payload.learner_portal_feed.map((row) => ({ section: "learner_portal_feed", ...row })) : [])
      ];
      if (!rows.length) {
        alert("Load portal insights first.");
        return;
      }
      downloadTextFile("exam-portal-insights.csv", rowsToCsv(rows), "text/csv;charset=utf-8");
    });
    document.getElementById("examV2PortalPrintBtn")?.addEventListener("click", () => window.print());
    await load();
  };

  const renderComplianceTab = async () => {
    panel.innerHTML = `
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Compliance Reporting Hub</h4>
          <p class="small-note">Institutional, CBC and learner-record completeness metrics for national/state-style reporting.</p>
          <div class="actions-row exam-icon-group">
            <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2ComplianceLoadBtn" title="Refresh compliance">Refresh</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2ComplianceDownloadBtn" title="Download compliance">Download</button>
            <button class="ax-btn ax-btn--print ax-btn--sm" id="examV2CompliancePrintBtn" title="Print compliance">Print</button>
          </div>
          <div id="examV2ComplianceCards" class="exam-analytics-grid"></div>
          <div id="examV2ComplianceStatus" class="small-note">Loading compliance indicators...</div>
        </div>
      </div>
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Learners Missing Assessment Records</h4>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>Learner</th><th>Admission</th><th>Grade</th><th>Stream</th></tr></thead>
              <tbody id="examV2ComplianceMissingRows"><tr><td colspan="4">No rows loaded yet.</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    stylePanel();
    const cardsEl = document.getElementById("examV2ComplianceCards");
    const statusEl = document.getElementById("examV2ComplianceStatus");
    const missingRowsEl = document.getElementById("examV2ComplianceMissingRows");
    let lastPayload = null;
    const setStatus = (message) => {
      if (statusEl) statusEl.textContent = message || "";
    };
    const load = async () => {
      try {
        const payload = await request("/api/examinations/compliance/overview");
        lastPayload = payload;
        const coverage = payload?.coverage || {};
        const learner = coverage?.learner_registry || {};
        const marks = coverage?.marks_registry || {};
        const curriculum = coverage?.curriculum_registry || {};
        if (cardsEl) {
          cardsEl.innerHTML = `
            <article class="exam-analytics-card"><h5>Learner Admission Ready %</h5><p>${escapeHtml(String(learner.admission_ready_pct || 0))}</p></article>
            <article class="exam-analytics-card"><h5>Learner Contact Ready %</h5><p>${escapeHtml(String(learner.contact_ready_pct || 0))}</p></article>
            <article class="exam-analytics-card"><h5>Marks Metadata Ready %</h5><p>${escapeHtml(String(marks.exam_type_ready_pct || 0))}</p></article>
            <article class="exam-analytics-card"><h5>Competency Ready %</h5><p>${escapeHtml(String(marks.competency_ready_pct || 0))}</p></article>
            <article class="exam-analytics-card"><h5>Curriculum Rows</h5><p>${formatNumber(curriculum.curriculum_rows || 0)}</p></article>
            <article class="exam-analytics-card"><h5>Mapped Learning Areas</h5><p>${formatNumber(curriculum.mapped_learning_areas || 0)}</p></article>
          `;
        }
        const missing = Array.isArray(payload?.learners_without_assessment) ? payload.learners_without_assessment : [];
        if (missingRowsEl) {
          missingRowsEl.innerHTML = missing.length
            ? missing.map((row) => `
              <tr>
                <td>${escapeHtml(row.full_name || "-")}</td>
                <td>${escapeHtml(row.admission_number || "-")}</td>
                <td>${escapeHtml(row.grade || "-")}</td>
                <td>${escapeHtml(row.stream || "-")}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="4">All learners have at least one assessment record.</td></tr>`;
        }
        setStatus(`Compliance report ready. Learners without assessments: ${missing.length}.`);
      } catch (error) {
        setStatus(error.message);
      }
    };
    document.getElementById("examV2ComplianceLoadBtn")?.addEventListener("click", load);
    document.getElementById("examV2ComplianceDownloadBtn")?.addEventListener("click", () => {
      const payload = lastPayload || {};
      const learner = payload?.coverage?.learner_registry || {};
      const marks = payload?.coverage?.marks_registry || {};
      const curriculum = payload?.coverage?.curriculum_registry || {};
      const rows = [
        {
          section: "learner_registry",
          total: learner.total || 0,
          admission_ready_pct: learner.admission_ready_pct || 0,
          upi_ready_pct: learner.upi_ready_pct || 0,
          birth_cert_ready_pct: learner.birth_cert_ready_pct || 0,
          contact_ready_pct: learner.contact_ready_pct || 0
        },
        {
          section: "marks_registry",
          total: marks.total || 0,
          exam_type_ready_pct: marks.exam_type_ready_pct || 0,
          term_ready_pct: marks.term_ready_pct || 0,
          year_ready_pct: marks.year_ready_pct || 0,
          competency_ready_pct: marks.competency_ready_pct || 0
        },
        {
          section: "curriculum_registry",
          curriculum_rows: curriculum.curriculum_rows || 0,
          mapped_learning_areas: curriculum.mapped_learning_areas || 0,
          mapped_grades: curriculum.mapped_grades || 0
        },
        ...(Array.isArray(payload?.learners_without_assessment) ? payload.learners_without_assessment.map((row) => ({ section: "missing_assessment", ...row })) : [])
      ];
      if (!rows.length) {
        alert("Load compliance report first.");
        return;
      }
      downloadTextFile("exam-compliance-report.csv", rowsToCsv(rows), "text/csv;charset=utf-8");
    });
    document.getElementById("examV2CompliancePrintBtn")?.addEventListener("click", () => window.print());
    await load();
  };

  const renderLifecycleTab = async () => {
    panel.innerHTML = `
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Academic Lifecycle Tracking</h4>
          <p class="small-note">Examination lifecycle timeline from curriculum setup to generated exams, marks, archives and template updates.</p>
          <div class="form-grid">
            <label>Learner ID (Optional)</label>
            <input id="examV2LifecycleLearnerId" type="number" placeholder="Filter by learner id" />
          </div>
          <div class="actions-row exam-icon-group">
            <button class="ax-btn ax-btn--refresh ax-btn--sm" id="examV2LifecycleLoadBtn" title="Refresh lifecycle">Refresh</button>
            <button class="ax-btn ax-btn--download ax-btn--sm" id="examV2LifecycleDownloadBtn" title="Download lifecycle">Download</button>
            <button class="ax-btn ax-btn--print ax-btn--sm" id="examV2LifecyclePrintBtn" title="Print lifecycle">Print</button>
          </div>
          <div id="examV2LifecycleCards" class="exam-analytics-grid"></div>
          <div id="examV2LifecycleRecommendations" class="small-note"></div>
          <div id="examV2LifecycleStatus" class="small-note">Loading lifecycle timeline...</div>
        </div>
      </div>
      <div class="exam-v2-layout">
        <div class="exam-v2-pane">
          <h4>Timeline Events</h4>
          <div class="dashboard-table-wrap">
            <table class="dashboard-table">
              <thead><tr><th>Date</th><th>Event</th><th>Entity</th><th>Title</th><th>Details</th></tr></thead>
              <tbody id="examV2LifecycleRows"><tr><td colspan="5">No timeline rows loaded yet.</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    stylePanel();
    const learnerIdEl = document.getElementById("examV2LifecycleLearnerId");
    const cardsEl = document.getElementById("examV2LifecycleCards");
    const recEl = document.getElementById("examV2LifecycleRecommendations");
    const statusEl = document.getElementById("examV2LifecycleStatus");
    const rowsEl = document.getElementById("examV2LifecycleRows");
    let lastPayload = null;
    const setStatus = (message) => {
      if (statusEl) statusEl.textContent = message || "";
    };
    const load = async () => {
      const params = new URLSearchParams();
      const learnerId = Number(learnerIdEl?.value || 0);
      if (learnerId > 0) params.set("learner_id", String(learnerId));
      try {
        const payload = await request(`/api/examinations/lifecycle/timeline?${params.toString()}`);
        lastPayload = payload;
        const counters = payload?.counters || {};
        const recommendations = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
        const rows = Array.isArray(payload?.timeline) ? payload.timeline : [];
        if (cardsEl) {
          cardsEl.innerHTML = `
            <article class="exam-analytics-card"><h5>Curriculum Rows</h5><p>${formatNumber(counters.curriculum_rows || 0)}</p></article>
            <article class="exam-analytics-card"><h5>Generated Exams</h5><p>${formatNumber(counters.generated_exams || 0)}</p></article>
            <article class="exam-analytics-card"><h5>Marks Rows</h5><p>${formatNumber(counters.marks_rows || 0)}</p></article>
            <article class="exam-analytics-card"><h5>Archive Rows</h5><p>${formatNumber(counters.archived_rows || 0)}</p></article>
          `;
        }
        if (recEl) {
          recEl.innerHTML = recommendations.length
            ? `<strong>Workflow Recommendations:</strong><br/>${recommendations.map((item) => `- ${escapeHtml(item)}`).join("<br/>")}`
            : "Workflow recommendations: No immediate blockers detected.";
        }
        if (rowsEl) {
          rowsEl.innerHTML = rows.length
            ? rows.slice(0, 300).map((row) => `
              <tr>
                <td>${escapeHtml(formatDateTime(row.occurred_at))}</td>
                <td>${escapeHtml(row.event_type || "-")}</td>
                <td>${escapeHtml(row.entity_type || "-")} #${escapeHtml(String(row.entity_id || "-"))}</td>
                <td>${escapeHtml(row.title || "-")}</td>
                <td>${escapeHtml(JSON.stringify(row.details || {}))}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="5">No timeline events found.</td></tr>`;
        }
        setStatus(`Lifecycle timeline loaded with ${rows.length} event(s).`);
      } catch (error) {
        setStatus(error.message);
      }
    };
    document.getElementById("examV2LifecycleLoadBtn")?.addEventListener("click", load);
    document.getElementById("examV2LifecycleDownloadBtn")?.addEventListener("click", () => {
      const rows = Array.isArray(lastPayload?.timeline) ? lastPayload.timeline : [];
      if (!rows.length) {
        alert("Load lifecycle timeline first.");
        return;
      }
      downloadTextFile("exam-lifecycle-timeline.csv", rowsToCsv(rows), "text/csv;charset=utf-8");
    });
    document.getElementById("examV2LifecyclePrintBtn")?.addEventListener("click", () => window.print());
    await load();
  };

  const activateTab = async (targetTab = "curriculum") => {
    const tab = normalizeExamTabKey(targetTab || "curriculum");
    renderNav(tab);
    navEl?.querySelectorAll("[data-exam-tab]").forEach((btn) => {
      btn.addEventListener("click", () => activateTab(String(btn.getAttribute("data-exam-tab") || "curriculum")));
    });
    setStatus(`Loading ${tabDefs.find((item) => item.id === tab)?.label || "module"}...`);
    if (tab === "curriculum") await renderCurriculumTab();
    else if (tab === "exam-generation") await renderExamGenerationTab();
    else if (tab === "exam-entry" || tab === "marks-entry") await renderExamEntryTab();
    else if (tab === "exam-scripts" || tab === "result-scripts") await renderExamScriptsTab();
    else if (tab === "assessment-reports" || tab === "assessment-report") await renderAssessmentReportsTab();
    else if (tab === "progress-reports" || tab === "learner-performance") await renderProgressReportsTab();
    else if (tab === "gradebook" || tab === "grade-book") await renderGradebookTab();
    else if (tab === "assessment-tracking" || tab === "assessment-tracker") await renderAssessmentTrackingTab();
    else if (tab === "portal-insights" || tab === "portal") await renderPortalInsightsTab();
    else if (tab === "compliance" || tab === "compliance-reporting") await renderComplianceTab();
    else if (tab === "lifecycle" || tab === "academic-lifecycle") await renderLifecycleTab();
    else if (tab === "analytics") {
      panel.innerHTML = renderExamAnalyticsPanel();
      await wireExamAnalyticsPanel();
      stylePanel();
    } else if (tab === "ai-copilot") {
      panel.innerHTML = renderExamAiCopilotPanel({ gradeOptions, formOptions, learningAreas });
      await wireExamAiCopilotPanel();
      stylePanel();
    } else if (tab === "templates") {
      panel.innerHTML = renderExamTemplateManagerPanel();
      await wireExamTemplateManagerPanel();
      stylePanel();
    } else if (tab === "archives") {
      panel.innerHTML = renderExamArchivePanel();
      await wireExamArchivePanel();
      stylePanel();
    } else if (tab === "settings") {
      panel.innerHTML = renderExamSettingsPanel();
      await wireExamSettingsPanel();
      stylePanel();
    } else {
      await renderCurriculumTab();
    }
    setStatus(`${tabDefs.find((item) => item.id === tab)?.label || "Module"} ready.`);
  };

  await activateTab(initialTab);
}

const moduleConfigs = {
  admission: {
    title: "Admission Module - Learners Registration",
    endpoint: "/api/admission/learners",
    fields: [
      { name: "first_name", label: "Learner First Name *" },
      { name: "middle_name", label: "Middle Name" },
      { name: "last_name", label: "Last Name *" },
      { name: "other_names", label: "Other Names" },
      { name: "full_name", label: "Full Name (auto-fills from at least 2 names)" },
      {
        name: "admission_number_mode",
        label: "Admission Number Mode",
        type: "select",
        options: ["System auto generation", "Manual generation", "Feed serial for next auto generation"]
      },
      { name: "admission_number_seed", label: "Admission Serial Seed (for next auto generation)" },
      { name: "admission_number", label: "Admission Number *" },
      { name: "learner_serial_number", label: "Permanent Learner Serial (system generated)" },
      { name: "date_of_admission", label: "Date of Admission", type: "date" },
      { name: "age_display", label: "Age (Auto: years and months)" },
      { name: "grade", label: "Grade (CBC / Primary / Junior)", type: "select", optionsKey: "gradeOptions" },
      { name: "form_name", label: "Form (Secondary 3–4)", type: "select", optionsKey: "formOptions" },
      { name: "stream", label: "Stream" },
      { name: "assessment_number", label: "Assessment Number" },
      { name: "upi_number", label: "UPI Number" },
      { name: "birth_certificate_number", label: "Birth Certificate Number *" },
      { name: "date_of_birth", label: "Date of Birth", type: "date" },
      { name: "gender", label: "Gender", type: "select", optionsKey: "genderOptions" },
      { name: "passport_photo_path", label: "Photo path (upload or type /uploads/...)", type: "photoPath" },
      { name: "religion", label: "Religion", type: "select", optionsKey: "religionOptions" },
      { name: "nationality", label: "Nationality", type: "select", optionsKey: "nationalityOptions" },
      { name: "county", label: "County", type: "select", optionsKey: "kenyaCountyOptions" },
      { name: "sub_county", label: "Sub County (manual)" },
      { name: "location", label: "Location" },
      { name: "sub_location", label: "Sub-location" },
      { name: "village", label: "Village" },
      { name: "postal_address", label: "Postal address" },
      { name: "town", label: "Town" },
      { name: "postal_code", label: "Postal Code", type: "select", optionsKey: "kenyaPostalCodeSelectOptions" },
      { name: "year_joined", label: "Year Joined", type: "select", optionsKey: "yearJoinedWideOptions" },
      { name: "term_joined", label: "Term", type: "select", optionsKey: "termOptions" },
      { name: "learner_condition", label: "Does the learner has disability?", type: "select", options: ["No", "Yes"] },
      { name: "disability_type", label: "Disability Type", type: "select", optionsKey: "disabilityTypes" },
      { name: "biological_parental_status", label: "Biological parental status", type: "select", options: ["Both parents alive", "Partial orphan", "Total orphan", "Others"] },
      { name: "has_medical_condition", label: "Does the learner has any medical condition?", type: "select", options: ["No", "Yes"] },
      { name: "medical_condition_notes", label: "Medical Condition Description", type: "textarea" },
      { name: "status", label: "Learner Status", type: "select", optionsKey: "admissionStatus" },
      { name: "parent_full_name", label: "Parent/Guardian 1 Full Name *" },
      { name: "parent_relationship", label: "Parent/Guardian 1 Relationship", type: "select", optionsKey: "relationshipOptions" },
      { name: "parent_id_number", label: "Parent/Guardian 1 ID Number" },
      { name: "parent_phone", label: "Parent/Guardian 1 Mobile *" },
      { name: "parent_phone_secondary", label: "Parent/Guardian 1 Mobile 2" },
      { name: "parent_email", label: "Parent/Guardian 1 Email" },
      { name: "parent_nationality", label: "Parent/Guardian 1 Nationality *", type: "select", optionsKey: "nationalityOptions" },
      { name: "parent_residence", label: "Parent/Guardian 1 Residence *" },
      { name: "parent_occupation", label: "Parent/Guardian 1 Occupation *" },
      { name: "parent2_full_name", label: "Parent/Guardian 2 Full Name" },
      { name: "parent2_relationship", label: "Parent/Guardian 2 Relationship", type: "select", optionsKey: "relationshipOptions" },
      { name: "parent2_id_number", label: "Parent/Guardian 2 ID Number" },
      { name: "parent2_phone_primary", label: "Parent/Guardian 2 Mobile" },
      { name: "parent2_phone_secondary", label: "Parent/Guardian 2 Mobile 2" },
      { name: "parent2_email", label: "Parent/Guardian 2 Email" },
      { name: "parent2_nationality", label: "Parent/Guardian 2 Nationality", type: "select", optionsKey: "nationalityOptions" },
      { name: "parent2_residence", label: "Parent/Guardian 2 Residence" },
      { name: "parent2_occupation", label: "Parent/Guardian 2 Occupation" },
      { name: "conduct_status", label: "Conduct Status" },
      { name: "learner_code", label: "Learners Code (auto generated)" },
      { name: "learner_password_hash", label: "Learner password hash (technical)" }
    ]
  },
  "management-teachers": {
    title: "Teachers Profile",
    endpoint: "/api/management/teachers",
    fields: [
      { name: "full_name", label: "Full Name *" },
      { name: "tsc_number", label: "TSC Number" },
      { name: "id_number", label: "ID Number" },
      { name: "postal_address", label: "Postal Address" },
      { name: "postal_code", label: "Postal Code (Kenya)" },
      { name: "town", label: "Town" },
      {
        name: "postal_code_lookup",
        label: "Postal code → town helper",
        type: "select",
        optionsKey: "postalCodeTownOptions"
      },
      { name: "phone_number", label: "Mobile Number *" },
      { name: "email_address", label: "Email Address" },
      { name: "category", label: "Category", type: "select", optionsKey: "staffCategories" },
      { name: "major_subject", label: "Major Subject", type: "select", optionsKey: "subjectOptions" },
      { name: "other_subject", label: "Other Subject", type: "select", optionsKey: "subjectOptions" },
      { name: "next_of_kin_name", label: "Next of Kin Name" },
      { name: "next_of_kin_relationship", label: "Next of Kin Relationship" },
      { name: "next_of_kin_mobile", label: "Next of Kin Mobile" },
      { name: "next_of_kin_email", label: "Next of Kin Email" },
      { name: "passport_photo_path", label: "Photo path (/uploads/...)" },
      { name: "employment_status", label: "Employment Status", type: "select", options: ["Active", "Suspended", "Inactive"] }
    ]
  },
  "management-non-teaching": {
    title: "Support Staff Profile",
    endpoint: "/api/management/non-teaching-staff",
    fields: [
      { name: "full_name", label: "Full Name *" },
      { name: "staff_number", label: "Service Number *" },
      { name: "id_number", label: "ID Number *" },
      { name: "postal_address", label: "Postal Address" },
      { name: "postal_code", label: "Postal Code" },
      { name: "town", label: "Town" },
      {
        name: "postal_code_lookup",
        label: "Postal code → town helper",
        type: "select",
        optionsKey: "postalCodeTownOptions"
      },
      { name: "phone_number", label: "Mobile Number *" },
      { name: "email_address", label: "Email Address" },
      { name: "position_department", label: "Position/Department" },
      { name: "next_of_kin_name", label: "Next of Kin Name" },
      { name: "next_of_kin_relationship", label: "Next of Kin Relationship" },
      { name: "next_of_kin_mobile", label: "Next of Kin Mobile" },
      { name: "next_of_kin_email", label: "Next of Kin Email" },
      { name: "next_of_kin_contact", label: "Next of Kin Contact (legacy)" },
      { name: "passport_photo_path", label: "Photo path (/uploads/...)" }
    ]
  },
  "management-service-providers": {
    title: "Service Providers Profile",
    endpoint: "/api/management/service-providers",
    fields: [
      { name: "full_name", label: "Full Name *" },
      { name: "company_name", label: "Entity / Company Name" },
      { name: "id_number", label: "ID Number" },
      { name: "service_rendered", label: "Service Being Rendered" },
      { name: "postal_address", label: "Postal Address" },
      { name: "postal_code", label: "Postal Code" },
      { name: "town", label: "Town" },
      {
        name: "postal_code_lookup",
        label: "Postal code → town helper",
        type: "select",
        optionsKey: "postalCodeTownOptions"
      },
      { name: "phone_number", label: "Mobile Number *" },
      { name: "email_address", label: "Email Address" },
      { name: "next_of_kin_name", label: "Next of Kin Name" },
      { name: "next_of_kin_relationship", label: "Relationship" },
      { name: "next_of_kin_mobile", label: "Next of Kin Mobile" },
      { name: "next_of_kin_email", label: "Next of Kin Email" },
      { name: "passport_photo_path", label: "Photo path (/uploads/...)" },
      { name: "employment_status", label: "Status", type: "select", options: ["Active", "Suspended", "Inactive"] }
    ]
  },
  "management-bom": {
    title: "Board of Management (BoM)",
    endpoint: "/api/management/bom",
    fields: [
      { name: "full_name", label: "BoM Member Full Name *" },
      { name: "id_number", label: "ID Number" },
      { name: "postal_address", label: "Postal Address" },
      { name: "postal_code", label: "Postal Code" },
      { name: "town", label: "Town" },
      {
        name: "postal_code_lookup",
        label: "Postal code → town helper",
        type: "select",
        optionsKey: "postalCodeTownOptions"
      },
      { name: "phone_number", label: "Mobile Number *" },
      { name: "email_address", label: "Email Address" },
      { name: "passport_photo_path", label: "Photo path (/uploads/...)" },
      { name: "employment_status", label: "Status", type: "select", options: ["Active", "Suspended", "Inactive"] }
    ]
  },
  "management-teacher-resources": {
    title: "Teacher Resource Module",
    endpoint: "/api/management/teacher-resources",
    fields: [
      { name: "teacher_profile_id", label: "Teacher Profile ID", type: "number" },
      { name: "resource_type", label: "Resource Type", type: "select", optionsKey: "teacherResourceTypes" },
      { name: "title", label: "Title" },
      { name: "description", label: "Description", type: "textarea" },
      { name: "grade", label: "Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "term", label: "Term", type: "select", optionsKey: "termOptions" },
      { name: "strand", label: "Strand" },
      { name: "sub_strand", label: "Sub Strand" },
      { name: "file_path", label: "File Path (/uploads/...)" }
    ]
  },
  attendance: {
    title: "Attendance Management",
    endpoint: "/api/attendance/records",
    fields: [
      { name: "attendance_type", label: "Attendance Type", type: "select", options: ["Teacher", "Learner", "Support Staff"] },
      { name: "person_id", label: "Person ID" },
      { name: "person_name", label: "Person Name" },
      { name: "grade", label: "Class/Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "attendance_date", label: "Attendance Date/Time", type: "datetime-local" },
      { name: "time_in", label: "Time In", type: "datetime-local" },
      { name: "time_out", label: "Time Out", type: "datetime-local" },
      { name: "status", label: "Status", type: "select", options: ["Present", "Absent", "Late", "Official Duty", "Absent with Apology", "Absent with No Apology"] },
      { name: "reason", label: "Reason for Absence" },
      { name: "comments", label: "Comment", type: "textarea" }
    ]
  },
  "academic-exams": {
    title: "Exam Management",
    endpoint: "/api/academic/exams",
    fields: [
      { name: "title", label: "Exam Title" },
      { name: "grade", label: "Class/Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "subject", label: "Subject", type: "select", optionsKey: "subjectOptions" },
      { name: "strand", label: "Strand Covered" },
      { name: "sub_strand", label: "Sub-Strand Covered" },
      { name: "notes_file_path", label: "Notes File Path" },
      { name: "generated_exam_text", label: "Generated Exam Text", type: "textarea" },
      { name: "exam_file_path", label: "Exam File Path" },
      { name: "term", label: "Term", type: "select", optionsKey: "termOptions" },
      { name: "year", label: "Year", type: "number" }
    ]
  },
  "academic-marks": {
    title: "Marks Entry",
    endpoint: "/api/academic/marks",
    fields: [
      { name: "learner_id", label: "Learner ID", type: "number" },
      { name: "learner_name", label: "Learner Name" },
      { name: "upi_number", label: "UPI Number" },
      { name: "assessment_number", label: "Assessment Number" },
      { name: "birth_certificate_number", label: "Birth Certificate Number" },
      { name: "grade", label: "Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "exam_type", label: "Exam Type", type: "select", optionsKey: "examTypes" },
      { name: "subject", label: "Subject", type: "select", optionsKey: "subjectOptions" },
      { name: "marks", label: "Marks", type: "number" },
      { name: "percentage", label: "Percentage", type: "number" },
      { name: "cbc_grade_band", label: "CBC Grade Band" },
      { name: "term", label: "Term", type: "select", optionsKey: "termOptions" },
      { name: "year", label: "Year", type: "number" }
    ]
  },
  "hr-leave": {
    title: "HR - Leave Management",
    endpoint: "/api/hr/leave-requests",
    fields: [
      { name: "staff_profile_type", label: "Staff Profile Type", type: "select", options: ["Teacher", "Support Staff"] },
      { name: "staff_profile_id", label: "Staff Profile ID", type: "number" },
      { name: "staff_name", label: "Staff Name" },
      { name: "leave_type", label: "Leave Type", type: "select", optionsKey: "leaveTypes" },
      { name: "start_date", label: "Start Date", type: "date" },
      { name: "end_date", label: "End Date", type: "date" },
      { name: "reason", label: "Reason", type: "textarea" },
      { name: "status", label: "Status", type: "select", options: ["Pending", "Approved", "Rejected"] },
      { name: "approval_stage", label: "Approval Stage", type: "select", options: ["Member", "Loan Officer", "Principal", "Final"] }
    ]
  },
  "hr-recruitment": {
    title: "HR - Recruitment and Letters",
    endpoint: "/api/hr/recruitment-records",
    fields: [
      { name: "record_type", label: "Record Type", type: "select", options: ["Job Vacancy", "Shortlisting", "Appointment Letter", "Promotion Letter", "Suspension Letter", "Warning Letter", "Show Cause Letter", "Dismissal Letter", "Early Retirement"] },
      { name: "position_name", label: "Job/Position" },
      { name: "candidate_name", label: "Name" },
      { name: "candidate_id_number", label: "ID Number" },
      { name: "candidate_mobile", label: "Mobile" },
      { name: "terms_of_service", label: "Terms of Service", type: "select", optionsKey: "termsOfService" },
      { name: "job_description", label: "Job Description", type: "textarea" },
      { name: "comments", label: "Comments", type: "textarea" },
      { name: "upload_file_path", label: "File Path" },
      { name: "deadline_date", label: "Deadline", type: "date" },
      { name: "status", label: "Status", type: "select", options: ["Pending", "Approved", "Rejected", "Issued"] }
    ]
  },
  "finance-fee-structure": {
    title: "Finance - Fee Structure",
    endpoint: "/api/finance/fee-structures",
    fields: [
      { name: "grade", label: "Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "term", label: "Term", type: "select", optionsKey: "termOptions" },
      { name: "year", label: "Year", type: "number" },
      { name: "amount_required", label: "Amount Required", type: "number" },
      { name: "description", label: "Description", type: "textarea" }
    ]
  },
  "finance-fee-payments": {
    title: "Finance - Fee Payments",
    endpoint: "/api/finance/fee-payments",
    fields: [
      { name: "learner_id", label: "Learner ID", type: "number" },
      { name: "learner_name", label: "Learner Name" },
      { name: "admission_number", label: "Admission Number" },
      { name: "grade", label: "Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "stream", label: "Stream" },
      { name: "amount_paid", label: "Amount Paid", type: "number" },
      { name: "payment_method", label: "Payment Method", type: "select", options: ["Cash", "Bank", "Mpesa", "Cheque", "Other"] },
      { name: "receipt_number", label: "Receipt Number" },
      { name: "payment_date", label: "Payment Date", type: "datetime-local" },
      { name: "balance_after_payment", label: "Balance After Payment", type: "number" }
    ]
  },
  "finance-payroll": {
    title: "Finance - Staff Payroll",
    endpoint: "/api/finance/payroll",
    fields: [
      { name: "staff_profile_type", label: "Staff Type", type: "select", options: ["Teacher", "Support Staff"] },
      { name: "staff_profile_id", label: "Staff Profile ID", type: "number" },
      { name: "staff_name", label: "Staff Name" },
      { name: "staff_number", label: "Staff Number" },
      { name: "id_number", label: "ID Number" },
      { name: "payroll_month", label: "Payroll Month" },
      { name: "payroll_year", label: "Payroll Year", type: "number" },
      { name: "basic_salary", label: "Basic Salary", type: "number" },
      { name: "allowances", label: "Allowances", type: "number" },
      { name: "deductions", label: "Deductions", type: "number" },
      { name: "net_salary", label: "Net Salary", type: "number" },
      { name: "payment_status", label: "Payment Status", type: "select", options: ["Pending", "Processed", "Paid", "On Hold"] },
      { name: "payment_date", label: "Payment Date", type: "datetime-local" },
      { name: "remarks", label: "Remarks", type: "textarea" }
    ]
  },
  "finance-salary-advance": {
    title: "Finance - Salary Advances",
    endpoint: "/api/finance/salary-advances",
    fields: [
      { name: "staff_profile_type", label: "Staff Type", type: "select", options: ["Teacher", "Support Staff"] },
      { name: "staff_profile_id", label: "Staff Profile ID", type: "number" },
      { name: "staff_name", label: "Staff Name" },
      { name: "staff_number", label: "Staff Number" },
      { name: "amount_requested", label: "Amount Requested", type: "number" },
      { name: "request_date", label: "Request Date", type: "date" },
      { name: "reason", label: "Reason", type: "textarea" },
      { name: "approval_status", label: "Approval Status", type: "select", options: ["Pending", "Approved", "Rejected"] },
      { name: "amount_approved", label: "Amount Approved", type: "number" },
      { name: "processing_status", label: "Processing Status", type: "select", options: ["Pending", "Processed", "Declined"] },
      { name: "repayment_status", label: "Repayment Status", type: "select", options: ["Pending", "In Progress", "Completed", "Not Applicable"] },
      { name: "deduction_plan", label: "Deduction Plan", type: "textarea" }
    ]
  },
  "finance-procurement": {
    title: "Finance - Procurement (LPO/LSO/Vouchers/Award)",
    endpoint: "/api/finance/procurement",
    fields: [
      { name: "document_type", label: "Document Type", type: "select", optionsKey: "procurementDocumentTypes" },
      { name: "document_number", label: "Document Number (auto/reference)" },
      { name: "supplier_name", label: "Supplier Name" },
      { name: "item_name", label: "Item/Service Name" },
      { name: "description", label: "Description", type: "textarea" },
      { name: "quantity", label: "Quantity", type: "number" },
      { name: "amount", label: "Amount", type: "number" },
      { name: "document_date", label: "Document Date", type: "date" },
      { name: "due_date", label: "Due Date", type: "date" },
      { name: "status", label: "Status", type: "select", options: ["Draft", "Approved", "Issued", "Closed"] },
      { name: "file_path", label: "File Path" },
      { name: "qr_code_text", label: "QR Code Value/Text" }
    ]
  },
  "communication-announcements": {
    title: "Communication - Announcements",
    endpoint: "/api/communication/announcements",
    fields: [
      { name: "title", label: "Title" },
      { name: "message", label: "Announcement Message", type: "textarea" },
      { name: "audience", label: "Audience", type: "select", options: ["All", "Teachers", "Parents", "Learners", "Support Staff", "BOM"] },
      { name: "start_date", label: "Start Date", type: "date" },
      { name: "end_date", label: "End Date", type: "date" }
    ]
  },
  "communication-messages": {
    title: "Communication - SMS and Notifications",
    endpoint: "/api/communication/messages",
    fields: [
      { name: "message_type", label: "Message Type", type: "select", options: ["SMS", "Email", "Push", "Parent Result Notice", "Fee Reminder"] },
      { name: "recipient_role", label: "Recipient Role", type: "select", options: ["Parent", "Teacher", "Head", "Admin", "BOM", "Learner", "Support Staff"] },
      { name: "recipient_contact", label: "Recipient Contact (Phone/Email)" },
      { name: "message_body", label: "Message Body", type: "textarea" },
      { name: "status", label: "Status", type: "select", options: ["Queued", "Sent", "Failed"] },
      { name: "sent_at", label: "Sent At", type: "datetime-local" }
    ]
  },
  "welfare-members": {
    title: "Staff Welfare - Members",
    endpoint: "/api/welfare/members",
    fields: [
      { name: "member_name", label: "Member Name" },
      { name: "member_role", label: "Member Role", type: "select", options: ["Teacher", "Support Staff", "Head", "Other"] },
      { name: "phone_number", label: "Phone Number" },
      { name: "email", label: "Email" },
      { name: "joined_date", label: "Joined Date", type: "date" },
      { name: "status", label: "Status", type: "select", options: ["Active", "Inactive"] }
    ]
  },
  "welfare-contributions": {
    title: "Staff Welfare - Contributions",
    endpoint: "/api/welfare/contributions",
    fields: [
      { name: "member_id", label: "Member ID", type: "number" },
      { name: "member_name", label: "Member Name" },
      { name: "contribution_period", label: "Contribution Period (Month/Term)" },
      { name: "amount", label: "Amount", type: "number" },
      { name: "payment_mode", label: "Payment Mode", type: "select", options: ["Cash", "Bank", "Mpesa", "Payroll Deduction", "Other"] },
      { name: "payment_date", label: "Payment Date", type: "date" }
    ]
  },
  "welfare-loans": {
    title: "Staff Welfare - Loans Workflow",
    endpoint: "/api/welfare/loans",
    fields: [
      { name: "member_id", label: "Member ID", type: "number" },
      { name: "member_name", label: "Member Name" },
      { name: "amount", label: "Loan Amount", type: "number" },
      { name: "application_date", label: "Application Date", type: "date" },
      { name: "return_date", label: "Return Date", type: "date" },
      { name: "status", label: "Overall Status", type: "select", options: ["Pending", "Approved", "Rejected", "Disbursed", "Closed"] },
      { name: "loan_officer_approval", label: "Loan Officer Approval", type: "select", options: ["Pending", "Approved", "Rejected"] },
      { name: "principal_approval", label: "Principal Approval", type: "select", options: ["Pending", "Approved", "Rejected"] },
      { name: "repayment_status", label: "Repayment Tracking", type: "select", options: ["Not Started", "In Progress", "Completed", "Defaulted"] }
    ]
  },
  laws: {
    title: "Laws, Regulations and Policies",
    endpoint: "/api/laws/documents",
    fields: [
      { name: "document_category", label: "Category", type: "select", optionsKey: "legalDocumentCategories" },
      { name: "title", label: "Title" },
      { name: "description", label: "Description", type: "textarea" },
      { name: "file_path", label: "File Path" },
      { name: "effective_date", label: "Effective Date", type: "date" }
    ]
  }
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 401) {
    localStorage.clear();
    window.location.href = "/";
    return null;
  }

  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (_) {
    data = null;
  }
  if (!response.ok) {
    let message =
      (data && typeof data === "object" && data.error) ||
      (rawText && rawText.length < 400 ? rawText.trim() : "") ||
      `Request failed (${response.status})`;
    if (
      data &&
      typeof data === "object" &&
      data.details &&
      !String(message).includes(String(data.details))
    ) {
      message += `: ${data.details}`;
    }
    throw new Error(message);
  }
  return data;
}

async function downloadWithAuth(path, filename) {
  const response = await fetch(path, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (response.status === 401) {
    localStorage.clear();
    window.location.href = "/";
    return;
  }
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(raw || `Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "download";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function uploadFileWithAuth(file) {
  if (!file) throw new Error("Select a file first.");
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Upload failed.");
  }
  return data;
}

async function uploadHeroImage(file) {
  if (!file) {
    throw new Error("Select an image file first.");
  }
  const formData = new FormData();
  formData.append("hero_image", file);
  const response = await fetch("/api/system/branding/hero-image", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Hero image upload failed.");
  }
  return data;
}

function resetDataTable(message = "No records found.") {
  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");
  if (!head || !body) return;
  head.innerHTML = "";
  body.innerHTML = `<tr><td>${escapeHtml(message)}</td></tr>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toLabel(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCellValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return escapeHtml(JSON.stringify(value));
  return escapeHtml(value);
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toLocaleString();
}

function formatNumber(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toLocaleString() : "0";
}

function formatLearnerCode(serialLike) {
  const parsed = Number(serialLike || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return `LC-${String(Math.trunc(parsed)).padStart(3, "0")}`;
}

function formatMoney(value) {
  const amount = Number(value ?? 0);
  const safe = Number.isFinite(amount) ? amount : 0;
  return `KES ${safe.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function toFlagLabel(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return "Unknown";
  return String(value);
}

function inferAuditSeverity(row) {
  const action = String(row?.action || "").toUpperCase();
  const activity = String(row?.activity_done || "").toUpperCase();
  if (action.includes("FAILED") || action.includes("LOCKED") || action.includes("DENY")) return "danger";
  if (action.includes("LOGOUT")) return "muted";
  if (action.includes("LOGIN") || action.includes("OTP")) return "success";
  if (activity.includes("DELETE") || activity.includes("PURGE")) return "warning";
  return "info";
}

function toAuditStripMarkup(row) {
  const severity = inferAuditSeverity(row);
  const username = row.username || row.user_name || "-";
  const passwordCorrect = toFlagLabel(row.password_correct);
  const otpCorrect = toFlagLabel(row.otp_correct);
  const inferredFailed =
    passwordCorrect === "No" ||
    otpCorrect === "No" ||
    String(row.activity_done || "").toUpperCase().includes("FAILED") ||
    String(row.action || "").toUpperCase().includes("FAILED");
  const loggingStatus =
    row.logging_status || (inferredFailed ? "NOT SUCCESSFUL" : "SUCCESSFUL");
  const ipAddress = row.ip_address || "-";
  const machineName = row.machine_name || "-";
  const serialLabel = machineName;
  const loginTime = formatDateTime(row.login_time || row.created_at);
  const logoutTime = formatDateTime(row.logout_time);
  const activityDone = row.activity_done || row.action || "-";
  const actorRole = row.actor_role || "-";
  const institutionCode = row.institution_code || row.joined_institution_code || "-";
  const institutionId = row.institution_id || "-";
  const title = `${activityDone} • ${actorRole}`;
  const rawDetails = row?.details_json && typeof row.details_json === "object"
    ? JSON.stringify(row.details_json)
    : row?.details_json || "";
  return `
    <div class="audit-strip severity-${escapeHtmlAttribute(severity)}" title="${escapeHtmlAttribute(rawDetails)}">
      <div class="audit-strip-title">${escapeHtml(title)}</div>
      <div class="audit-strip-line">
        <span class="audit-chip">User: ${escapeHtml(username)}</span>
        <span class="audit-chip">Institution Code: ${escapeHtml(String(institutionCode))}</span>
        <span class="audit-chip">Institution ID: ${escapeHtml(String(institutionId))}</span>
        <span class="audit-chip">Logging Status: ${escapeHtml(String(loggingStatus))}</span>
        <span class="audit-chip">Password Correct: ${escapeHtml(passwordCorrect)}</span>
        <span class="audit-chip">OTP Correct: ${escapeHtml(otpCorrect)}</span>
        <span class="audit-chip">IP Address: ${escapeHtml(ipAddress)}</span>
        <span class="audit-chip">Machine / Serial: ${escapeHtml(serialLabel)}</span>
        <span class="audit-chip">Login Time: ${escapeHtml(loginTime)}</span>
        <span class="audit-chip">Logout Time: ${escapeHtml(logoutTime)}</span>
        <span class="audit-chip">Activity: ${escapeHtml(activityDone)}</span>
        <span class="audit-chip">Role: ${escapeHtml(actorRole)}</span>
      </div>
    </div>
  `;
}

function buildDashboardTable(headers, rows) {
  if (!rows.length) {
    return '<p class="small-note">No records available.</p>';
  }
  return `
    <div class="dashboard-table-wrap">
      <table class="dashboard-table">
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows
            .map((row) =>
              `<tr>${row
                .map((cell) => {
                  const value = String(cell ?? "");
                  const isTrustedHtml =
                    value.includes('class="search-inline-actions"') ||
                    value.includes("class='search-inline-actions'");
                  return `<td>${isTrustedHtml ? value : escapeHtml(value)}</td>`;
                })
                .join("")}</tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function isModuleAllowed(moduleKey) {
  if (!moduleKey) return true;
  if (!Array.isArray(allowedModules) || !allowedModules.length) return true;
  return allowedModules.includes(moduleKey);
}

function isSidebarModuleAllowed(moduleId) {
  return isModuleAllowed(MODULE_KEY_BY_ID[moduleId] || moduleId);
}

function isDashboardWidgetVisible(widgetKey) {
  const role = String(portalContext?.role || "").toUpperCase();
  if (["SYSTEM_DEVELOPER", "ADMIN", "HEAD_OF_INSTITUTION"].includes(role)) {
    return true;
  }
  if (!Array.isArray(allowedModules) || !allowedModules.length) return true;
  if (allowedModules.includes("dashboard")) return true;
  return allowedModules.includes(widgetKey);
}

async function mergeDashboardWidgetOverrides(userId) {
  const uid = Number(userId || 0);
  if (!uid) return;
  try {
    const res = await request(`/api/system/module-access/overrides?user_id=${uid}`);
    const overrides = Array.isArray(res?.overrides) ? res.overrides : [];
    const next = new Set(allowedModules || []);
    overrides.forEach((row) => {
      const mk = String(row.module_key || "");
      if (!DASHBOARD_WIDGET_KEYS.includes(mk)) return;
      if (Number(row.can_access) === 1) next.add(mk);
    });
    allowedModules = Array.from(next);
  } catch (_) {
    /* keep portal defaults if overrides unavailable */
  }
}

function setActiveSidebarButton(moduleId) {
  const parentFromSubmodule = sidebarSubmoduleParent(currentSidebarSubmoduleId);
  const activeModuleId = moduleId || parentFromSubmodule || null;
  document.querySelectorAll(".sidebar button[data-module]").forEach((button) => {
    button.classList.toggle("active", Boolean(activeModuleId) && button.dataset.module === activeModuleId);
  });
  document.querySelectorAll(".quick-action-card[data-module]").forEach((card) => {
    card.classList.toggle("active", Boolean(activeModuleId) && card.getAttribute("data-module") === activeModuleId);
  });
  document.querySelectorAll(".sidebar-submodule-btn[data-submodule-id]").forEach((button) => {
    button.classList.toggle("active", Boolean(currentSidebarSubmoduleId) && button.dataset.submoduleId === currentSidebarSubmoduleId);
  });
  if (activeModuleId) {
    const list = document.querySelector(`.sidebar-submodule-list[data-parent-module="${activeModuleId}"]`);
    if (list) {
      list.hidden = false;
    }
  }
  applyThemeAccentByModule(activeModuleId || "dashboard");
}

function applyThemeAccentByModule(moduleId) {
  const accentByModule = {
    dashboard: "#22b6ff",
    admission: "#2b8ce6",
    attendance: "#20b875",
    "academic-exams": "#9b59ff",
    "academic-marks": "#00a7d1",
    "finance-fee-structure": "#2b8ce6",
    "finance-fee-payments": "#0ea5e9",
    "finance-payroll": "#1d4ed8",
    "finance-salary-advance": "#2563eb",
    "finance-procurement": "#4f46e5",
    "communication-messages": "#10b981",
    "communication-announcements": "#0ea5e9",
    "welfare-members": "#9b59ff",
    "welfare-contributions": "#7c3aed",
    "welfare-loans": "#8b5cf6",
    laws: "#1f6ca7"
  };
  const accent = accentByModule[moduleId] || "#22b6ff";
  document.documentElement.style.setProperty("--accent-500", accent);
}

function buildInput(field) {
  const id = `field-${field.name}`;
  const value = "";
  if (field.name === "learner_serial_number" || field.name === "learner_code") {
    return `<label>${field.label}</label><input id="${id}" type="text" placeholder="${field.label}" value="${value}" readonly />`;
  }
  if (field.type === "textarea") {
    return `<label>${field.label}</label><textarea id="${id}" rows="3" placeholder="${field.label}">${value}</textarea>`;
  }
  if (field.type === "photoPath") {
    return `<label>${escapeHtml(field.label)}</label>
<div class="photo-path-upload-row">
<input id="${id}" type="text" placeholder="/uploads/..." value="${escapeHtml(value)}" />
<input id="${id}-file" type="file" accept="image/*,.heic,.heif,.tif,.tiff,.bmp" />
<button type="button" class="ax-btn ax-btn--upload ax-btn--sm" id="${id}-upload">Upload</button>
<input id="${id}-camera" type="file" accept="image/*" capture="environment" hidden />
<button type="button" class="ax-btn ax-btn--view ax-btn--sm" id="${id}-camera-open">Take Photo</button>
</div>`;
  }
  if (field.type === "select") {
    const options = field.options || meta[field.optionsKey] || [];
    if (options.length && typeof options[0] === "object" && options[0] && "value" in options[0]) {
      const optionHtml = ['<option value="">Select...</option>']
        .concat(
          options.map(
            (option) =>
              `<option value="${escapeHtmlAttribute(String(option.value))}">${escapeHtml(
                option.label != null ? option.label : String(option.value)
              )}</option>`
          )
        )
        .join("");
      return `<label>${field.label}</label><select id="${id}">${optionHtml}</select>`;
    }
    const optionHtml = ['<option value="">Select...</option>']
      .concat(options.map((option) => `<option value="${option}">${option}</option>`))
      .join("");
    return `<label>${field.label}</label><select id="${id}">${optionHtml}</select>`;
  }
  return `<label>${field.label}</label><input id="${id}" type="${field.type || "text"}" placeholder="${field.label}" value="${value}"/>`;
}

function getFieldValue(field) {
  const el = document.getElementById(`field-${field.name}`);
  if (!el) return null;
  if (field.type === "number") {
    return el.value === "" ? null : Number(el.value);
  }
  return el.value || null;
}

function setFieldValue(field, value) {
  const el = document.getElementById(`field-${field.name}`);
  if (!el) return;
  el.value = value ?? "";
}

function clearForm(config) {
  currentEditId = null;
  config.fields.forEach((field) => setFieldValue(field, ""));
  if (currentModule === "admission") {
    const bio = document.querySelector(".admission-bio-panel");
    if (bio) {
      refreshAdmissionGradeFormExclusiveState(bio);
      syncAdmissionDisabilityField(bio);
      syncAdmissionMedicalField(bio);
      syncAdmissionAgeField(bio);
    }
  }
}

function cbcBandFromScore(score) {
  const mark = Number(score);
  if (mark >= 75) return "EE";
  if (mark >= 50) return "ME";
  if (mark >= 25) return "AE";
  return "BE";
}

async function saveCurrentModule() {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  if (!isModuleAllowed(currentModule)) {
    alert("Your role does not have access to this module.");
    return;
  }

  const payload = {};
  config.fields.forEach((field) => {
    payload[field.name] = getFieldValue(field);
  });
  delete payload.postal_code_lookup;

  if (currentModule === "admission") {
    const admissionMode = String(payload.admission_number_mode || "").trim().toLowerCase();
    if (admissionMode.includes("feed serial")) {
      const seed = String(payload.admission_number_seed || "").trim().replace(/\s+/g, "");
      if (!seed) {
        alert("Enter the serial seed before using 'Feed serial for next auto generation'.");
        return;
      }
      try {
        const serial = await request("/api/admission/learners/next-admission-number", {
          method: "POST",
          body: JSON.stringify({ mode: "seed", seed })
        });
        payload.admission_number = String(serial?.admission_number || "").trim();
      } catch (error) {
        alert(error.message);
        return;
      }
    } else if (admissionMode.includes("system auto")) {
      try {
        const serial = await request("/api/admission/learners/next-admission-number", {
          method: "POST",
          body: JSON.stringify({ mode: "auto" })
        });
        payload.admission_number = String(serial?.admission_number || "").trim();
      } catch (error) {
        alert(error.message);
        return;
      }
    } else if (!String(payload.admission_number || "").trim()) {
      alert("Admission number is required when manual generation is selected.");
      return;
    }
    const first = String(payload.first_name || "").trim();
    const last = String(payload.last_name || "").trim();
    let gradeVal = String(payload.grade || "").trim();
    let formVal = String(payload.form_name || "").trim();
    if (gradeVal && formVal) {
      alert("Choose either a Grade or a Form—not both.");
      return;
    }
    if (!gradeVal && !formVal) {
      alert("Select either a Grade or a Form for the learner.");
      return;
    }
    if (formVal) {
      payload.grade = "";
      payload.form_name = formVal;
    } else {
      payload.form_name = "";
      payload.grade = gradeVal;
    }
    const parentName = String(payload.parent_full_name || "").trim();
    const parentNationality = String(payload.parent_nationality || "").trim();
    const parentResidence = String(payload.parent_residence || "").trim();
    const parentOccupation = String(payload.parent_occupation || "").trim();
    const parentMobile = String(payload.parent_phone || "").trim();
    if (!first || !parentName || !parentNationality || !parentResidence || !parentOccupation || !parentMobile) {
      alert(
        "Mandatory fields missing: learner first name, parent/guardian full name, nationality, residence, occupation, and mobile (and either grade or form)."
      );
      return;
    }
    if (!(String(payload.birth_certificate_number || "").trim() || "").length) {
      alert("Birth certificate number is mandatory.");
      return;
    }
    payload.full_name = String(payload.full_name || "").trim() || `${first} ${last}`.trim();
    if (String(payload.learner_condition || "").trim().toLowerCase() !== "yes") {
      payload.disability_type = "";
    }
    if (String(payload.has_medical_condition || "").trim().toLowerCase() !== "yes") {
      payload.medical_condition_notes = "";
    }
    delete payload.age_display;
    delete payload.admission_number_mode;
    delete payload.admission_number_seed;
  }

  const staffMandatoryModules = [
    "management-teachers",
    "management-non-teaching",
    "management-service-providers",
    "management-bom"
  ];
  if (staffMandatoryModules.includes(currentModule)) {
    const nameVal = String(payload.full_name || "").trim();
    const phoneVal = String(payload.phone_number || "").trim();
    const emailVal = String(payload.email_address || "").trim();
    const tsc = String(payload.tsc_number || "").trim();
    const idNo = String(payload.id_number || "").trim();
    if (!nameVal) {
      alert("Full name is required.");
      return;
    }
    if (!phoneVal && !emailVal) {
      alert("Either mobile number or email is required.");
      return;
    }
    if (currentModule === "management-teachers" && !(tsc || idNo)) {
      alert("Either TSC number or ID number is required for teachers.");
      return;
    }
    if (currentModule === "management-non-teaching" && !idNo) {
      alert("ID number is required for support staff profile.");
      return;
    }
  }

  if (currentModule === "academic-marks" && payload.marks !== null) {
    payload.percentage = payload.percentage ?? payload.marks;
    payload.cbc_grade_band = payload.cbc_grade_band || cbcBandFromScore(payload.marks);
  }

  try {
    if (currentEditId) {
      await request(`${config.endpoint}/${currentEditId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      alert("Record updated successfully.");
    } else {
      await request(config.endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      alert("Record saved successfully.");
    }
    clearForm(config);
    await loadModuleData(config);
    if (currentModule === "admission") {
      const panel = document.querySelector(".admission-bio-panel");
      if (panel) {
        await refreshAdmissionLearnerCodePreview(panel);
      }
    }
  } catch (error) {
    alert(error.message);
  }
}

async function editRow(id) {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  if (!isModuleAllowed(currentModule)) {
    alert("Your role does not have access to this module.");
    return;
  }
  try {
    const row = await request(`${config.endpoint}/${id}`);
    currentEditId = row.id;
    config.fields.forEach((field) => setFieldValue(field, row[field.name]));
    if (currentModule === "admission") {
      const learnerCodeEl = document.getElementById("field-learner_code");
      if (learnerCodeEl) {
        learnerCodeEl.value = formatLearnerCode(row.learner_serial_number || row.id);
      }
      const bio = document.querySelector(".admission-bio-panel");
      if (bio) {
        refreshAdmissionGradeFormExclusiveState(bio);
        syncAdmissionDisabilityField(bio);
        syncAdmissionMedicalField(bio);
        syncAdmissionAgeField(bio);
      }
    }
  } catch (error) {
    alert(error.message);
  }
}

async function confirmSoftDeletePrompts() {
  if (isSystemDeveloperRole(portalContext?.role || "")) {
    const ok = window.confirm("Move this record to the Recycle Bin?");
    return Boolean(ok);
  }
  const first = window.confirm("Delete this record? It will move to the Recycle Bin.");
  if (!first) return false;
  const second = window.confirm("Permanently remove from active lists and send to recycle bin?");
  return Boolean(second);
}

async function deleteRow(id) {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  if (!isModuleAllowed(currentModule)) {
    alert("Your role does not have access to this module.");
    return;
  }
  const ok = await confirmSoftDeletePrompts();
  if (!ok) return;
  try {
    await request(`${config.endpoint}/${id}`, { method: "DELETE" });
    await loadModuleData(config);
  } catch (error) {
    alert(error.message);
  }
}

async function exportPdf() {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  if (!isModuleAllowed(currentModule)) {
    alert("Your role does not have access to this module.");
    return;
  }
  window.open(`${config.endpoint}/export/pdf`, "_blank");
}

async function exportExcel() {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  if (!isModuleAllowed(currentModule)) {
    alert("Your role does not have access to this module.");
    return;
  }
  window.open(`${config.endpoint}/export/excel`, "_blank");
}

function renderTable(rows) {
  const head = document.getElementById("tableHead");
  const body = document.getElementById("tableBody");

  if (!rows.length) {
    head.innerHTML = "";
    body.innerHTML = '<tr><td class="table-empty-state">No records found.</td></tr>';
    applyCompactIconButtons(document.querySelector(".table-area"));
    return;
  }

  const allKeys = Object.keys(rows[0]).filter((key) => !["details_json", "generated_exam_text"].includes(key));
  const shownKeys = allKeys.slice(0, 10);
  head.innerHTML = `<tr>${shownKeys.map((key) => `<th>${toLabel(key)}</th>`).join("")}<th>Actions</th></tr>`;
  const canDispatch = currentModule === "communication-messages";

  body.innerHTML = rows
    .map(
      (row) => `
      <tr>
        ${shownKeys.map((key) => `<td>${formatCellValue(row[key])}</td>`).join("")}
        <td class="table-actions-cell">
          <button class="table-action-btn ax-btn ax-btn--edit ax-btn--sm" onclick="editRow(${row.id})">Edit</button>
          <button class="table-action-btn danger ax-btn ax-btn--delete ax-btn--sm" onclick="deleteRow(${row.id})">Delete</button>
          ${canDispatch ? `<button class="table-action-btn ax-btn ax-btn--process ax-btn--sm" onclick="dispatchCommunicationMessage(${row.id})">Dispatch</button>` : ""}
        </td>
      </tr>
    `
    )
    .join("");
  applyCompactIconButtons(document.querySelector(".table-area"));
}

function renderModuleSummary(config, rows = []) {
  const cards = document.getElementById("cards");
  if (!cards || !config) return;
  cards.innerHTML = `
    <div class="card stats-card metric-emphasis">
      <h4>Module</h4>
      <p>${escapeHtml(config.title)}</p>
    </div>
    <div class="card stats-card">
      <h4>Records Loaded</h4>
      <p>${formatNumber(rows.length)}</p>
    </div>
    <div class="card stats-card">
      <h4>Data Endpoint</h4>
      <p>${escapeHtml(config.endpoint)}</p>
    </div>
  `;
}

async function loadModuleData(config) {
  try {
    const rows = await request(config.endpoint);
    renderModuleSummary(config, rows || []);
    if (currentModule === "admission") {
      admissionRegisterRows = rows || [];
      renderAdmissionRegisterTable();
      renderAdmissionParentGuardianTable();
      resetDataTable(
        "The admission register is shown in the Admission Module form (scroll to “Admission Register”)."
      );
      return;
    }
    renderTable(rows || []);
  } catch (error) {
    alert(error.message);
  }
}

function admissionStatusClass(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (normalized === "in session") return "adm-status--in-session";
  if (normalized === "not in session") return "adm-status--not-in-session";
  if (normalized.includes("transferred")) return "adm-status--transferred";
  if (normalized.includes("alumni")) return "adm-status--alumni";
  if (normalized.includes("deceased")) return "adm-status--deceased";
  return "adm-status--default";
}

function filterAdmissionRegisterRows() {
  const raw = admissionRegisterRows || [];
  const scopeEl = document.getElementById("admissionRegisterScope");
  const streamEl = document.getElementById("admissionRegisterStream");
  const gfEl = document.getElementById("admissionRegisterGradeFormFilter");
  const qEl = document.getElementById("admissionRegisterSearch");
  const scope = scopeEl ? scopeEl.value : "whole";
  const streamNeedle = String(streamEl?.value || "")
    .trim()
    .toLowerCase();
  const gradeFormVal = String(gfEl?.value || "").trim();
  const q = String(qEl?.value || "")
    .trim()
    .toLowerCase();

  return raw.filter((row) => {
    if (scope === "stream" && streamNeedle) {
      const s = String(row.stream || "")
        .trim()
        .toLowerCase();
      if (!s || s !== streamNeedle) return false;
    }
    if (scope === "gradeform" && gradeFormVal) {
      const g = String(row.grade || "").trim();
      const f = String(row.form_name || "").trim();
      if (g !== gradeFormVal && f !== gradeFormVal) return false;
    }
    if (q) {
      const blob = [
        row.full_name,
        row.admission_number,
        row.stream,
        row.grade,
        row.form_name,
        row.upi_number
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}

function renderAdmissionRegisterTable() {
  const head = document.getElementById("admissionRegisterHead");
  const body = document.getElementById("admissionRegisterBody");
  if (!head || !body) return;
  const rows = filterAdmissionRegisterRows();
  head.innerHTML = `<tr>
    <th>#</th>
    <th>Admission No.</th>
    <th>Learners Code</th>
    <th>Full name</th>
    <th>Grade</th>
    <th>Form</th>
    <th>Stream</th>
    <th>Status</th>
    <th>Parent mobile</th>
    <th>Actions</th>
  </tr>`;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="10" class="table-empty-state">No learners match the current filters.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((row, idx) => {
      const st = row.status || "-";
      const stClass = admissionStatusClass(st);
      return `<tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(row.admission_number || "-")}</td>
        <td>${escapeHtml(formatLearnerCode(row.learner_serial_number || row.id) || "-")}</td>
        <td>${escapeHtml(row.full_name || "-")}</td>
        <td>${escapeHtml(row.grade || "-")}</td>
        <td>${escapeHtml(row.form_name || "-")}</td>
        <td>${escapeHtml(row.stream || "-")}</td>
        <td><span class="adm-status-pill ${stClass}">${escapeHtml(st)}</span></td>
        <td>${escapeHtml(row.parent_phone || "-")}</td>
        <td class="table-actions-cell admission-register-actions">
          <button type="button" class="ax-btn ax-btn--view ax-btn--sm" onclick="admissionRegisterView(${row.id})">View</button>
          <button type="button" class="ax-btn ax-btn--edit ax-btn--sm" onclick="admissionRegisterEdit(${row.id})">Edit</button>
          <button type="button" class="ax-btn ax-btn--save ax-btn--sm" onclick="admissionRegisterSaveRow(${row.id})">Save</button>
          <button type="button" class="ax-btn ax-btn--delete ax-btn--sm" onclick="admissionRegisterDelete(${row.id})">Delete</button>
        </td>
      </tr>`;
    })
    .join("");
}

function getAdmissionParentRows() {
  const learners = Array.isArray(admissionRegisterRows) ? admissionRegisterRows : [];
  const rows = [];
  learners.forEach((learner) => {
    const base = {
      learner_id: learner.id,
      learner_name: learner.full_name || "-",
      learner_grade: learner.grade || learner.form_name || "-",
      learner_stream: learner.stream || "-"
    };
    if (learner.parent_full_name || learner.parent_phone || learner.parent_id_number) {
      rows.push({
        ...base,
        parent_slot: 1,
        parent_name: learner.parent_full_name || "-",
        parent_id: learner.parent_id_number || "-",
        parent_mobile: learner.parent_phone || "-",
        parent_mobile_2: learner.parent_phone_secondary || "-"
      });
    }
    if (learner.parent2_full_name || learner.parent2_phone_primary || learner.parent2_id_number) {
      rows.push({
        ...base,
        parent_slot: 2,
        parent_name: learner.parent2_full_name || "-",
        parent_id: learner.parent2_id_number || "-",
        parent_mobile: learner.parent2_phone_primary || "-",
        parent_mobile_2: learner.parent2_phone_secondary || "-"
      });
    }
  });
  return rows;
}

function filterAdmissionParentRows() {
  const category = String(document.getElementById("admissionParentCategory")?.value || "full");
  const gradeForm = String(document.getElementById("admissionParentGradeForm")?.value || "").trim().toLowerCase();
  const stream = String(document.getElementById("admissionParentStream")?.value || "").trim().toLowerCase();
  const q = String(document.getElementById("admissionParentSearch")?.value || "").trim().toLowerCase();
  return getAdmissionParentRows().filter((row) => {
    if (category === "gradeform" && gradeForm) {
      if (!String(row.learner_grade || "").toLowerCase().includes(gradeForm)) return false;
    }
    if (category === "stream" && stream) {
      if (!String(row.learner_stream || "").toLowerCase().includes(stream)) return false;
    }
    if (q) {
      const blob = [
        row.parent_name,
        row.parent_id,
        row.parent_mobile,
        row.learner_name,
        row.learner_grade,
        row.learner_stream
      ].map((item) => String(item || "").toLowerCase()).join(" ");
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}

function renderAdmissionParentGuardianTable() {
  const head = document.getElementById("admissionParentHead");
  const body = document.getElementById("admissionParentBody");
  if (!head || !body) return;
  const rows = filterAdmissionParentRows();
  head.innerHTML = `
    <tr>
      <th>#</th>
      <th>Parent/Guardian</th>
      <th>ID Number</th>
      <th>Mobile</th>
      <th>Learner</th>
      <th>Grade/Form</th>
      <th>Stream</th>
      <th>Actions</th>
    </tr>
  `;
  body.innerHTML = rows.length
    ? rows.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.parent_name || "-")}</td>
        <td>${escapeHtml(row.parent_id || "-")}</td>
        <td>${escapeHtml(row.parent_mobile || "-")}</td>
        <td>${escapeHtml(row.learner_name || "-")}</td>
        <td>${escapeHtml(row.learner_grade || "-")}</td>
        <td>${escapeHtml(row.learner_stream || "-")}</td>
        <td class="table-actions-cell">
          <button type="button" class="ax-btn ax-btn--view ax-btn--sm" onclick="admissionParentGuardianView(${Number(row.learner_id || 0)}, ${Number(row.parent_slot || 1)})">View</button>
          <button type="button" class="ax-btn ax-btn--edit ax-btn--sm" onclick="admissionParentGuardianEdit(${Number(row.learner_id || 0)}, ${Number(row.parent_slot || 1)})">Edit</button>
          <button type="button" class="ax-btn ax-btn--save ax-btn--sm" onclick="admissionParentGuardianSave(${Number(row.learner_id || 0)}, ${Number(row.parent_slot || 1)})">Save</button>
          <button type="button" class="ax-btn ax-btn--delete ax-btn--sm" onclick="admissionParentGuardianDelete(${Number(row.learner_id || 0)}, ${Number(row.parent_slot || 1)})">Delete</button>
          <button type="button" class="ax-btn ax-btn--print ax-btn--sm" onclick="admissionParentGuardianPrint(${Number(row.learner_id || 0)}, ${Number(row.parent_slot || 1)})">Print</button>
          <button type="button" class="ax-btn ax-btn--download ax-btn--sm" onclick="admissionParentGuardianDownload(${Number(row.learner_id || 0)}, ${Number(row.parent_slot || 1)})">Download</button>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="8">No parents/guardians found for selected category.</td></tr>`;
}

function refreshAdmissionGradeFormExclusiveState(scopeEl) {
  const gradeEl = scopeEl.querySelector("#field-grade");
  const formEl = scopeEl.querySelector("#field-form_name");
  if (!gradeEl || !formEl) return;
  const g = String(gradeEl.value || "").trim();
  const f = String(formEl.value || "").trim();
  if (g) {
    formEl.value = "";
    formEl.disabled = true;
    gradeEl.disabled = false;
  } else if (f) {
    gradeEl.value = "";
    gradeEl.disabled = true;
    formEl.disabled = false;
  } else {
    gradeEl.disabled = false;
    formEl.disabled = false;
  }
}

function wireAdmissionGradeFormExclusive(scopeEl) {
  const gradeEl = scopeEl.querySelector("#field-grade");
  const formEl = scopeEl.querySelector("#field-form_name");
  if (!gradeEl || !formEl || gradeEl.dataset.gfBound === "1") return;
  gradeEl.dataset.gfBound = "1";
  formEl.dataset.gfBound = "1";
  const onChange = () => refreshAdmissionGradeFormExclusiveState(scopeEl);
  gradeEl.addEventListener("change", onChange);
  formEl.addEventListener("change", onChange);
  refreshAdmissionGradeFormExclusiveState(scopeEl);
}

function syncAdmissionDisabilityField(scopeEl) {
  const cond = scopeEl.querySelector("#field-learner_condition");
  const dis = scopeEl.querySelector("#field-disability_type");
  if (!cond || !dis) return;
  const on = String(cond.value || "").trim().toLowerCase() === "yes";
  dis.disabled = !on;
  if (!on) {
    dis.value = "";
  }
}

function wireAdmissionDisabilityToggle(scopeEl) {
  const cond = scopeEl.querySelector("#field-learner_condition");
  if (!cond || cond.dataset.disabilityBound === "1") return;
  cond.dataset.disabilityBound = "1";
  cond.addEventListener("change", () => syncAdmissionDisabilityField(scopeEl));
  syncAdmissionDisabilityField(scopeEl);
}

function syncAdmissionMedicalField(scopeEl) {
  const flag = scopeEl.querySelector("#field-has_medical_condition");
  const notes = scopeEl.querySelector("#field-medical_condition_notes");
  if (!flag || !notes) return;
  const enabled = String(flag.value || "").trim().toLowerCase() === "yes";
  notes.disabled = !enabled;
  if (!enabled) {
    notes.value = "";
  }
}

function wireAdmissionMedicalToggle(scopeEl) {
  const flag = scopeEl.querySelector("#field-has_medical_condition");
  if (!flag || flag.dataset.medBound === "1") return;
  flag.dataset.medBound = "1";
  flag.addEventListener("change", () => syncAdmissionMedicalField(scopeEl));
  syncAdmissionMedicalField(scopeEl);
}

function calculateAdmissionAgeDisplay(dateOfBirth, dateOfAdmission) {
  if (!dateOfBirth || !dateOfAdmission) return "";
  const birth = new Date(dateOfBirth);
  const admission = new Date(dateOfAdmission);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(admission.getTime()) || admission < birth) {
    return "";
  }
  let years = admission.getFullYear() - birth.getFullYear();
  let months = admission.getMonth() - birth.getMonth();
  const dayDiff = admission.getDate() - birth.getDate();
  if (dayDiff < 0) {
    months -= 1;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const safeYears = Math.max(years, 0);
  const safeMonths = Math.max(months, 0);
  return `${safeYears} year${safeYears === 1 ? "" : "s"} ${safeMonths} month${safeMonths === 1 ? "" : "s"}`;
}

function syncAdmissionAgeField(scopeEl) {
  const dob = scopeEl.querySelector("#field-date_of_birth");
  const doa = scopeEl.querySelector("#field-date_of_admission");
  const age = scopeEl.querySelector("#field-age_display");
  if (!dob || !doa || !age) return;
  age.value = calculateAdmissionAgeDisplay(dob.value, doa.value);
}

function wireAdmissionAgeField(scopeEl) {
  const dob = scopeEl.querySelector("#field-date_of_birth");
  const doa = scopeEl.querySelector("#field-date_of_admission");
  const age = scopeEl.querySelector("#field-age_display");
  if (!dob || !doa || !age || age.dataset.ageBound === "1") return;
  age.dataset.ageBound = "1";
  age.readOnly = true;
  age.placeholder = "Auto-calculated";
  dob.addEventListener("change", () => syncAdmissionAgeField(scopeEl));
  doa.addEventListener("change", () => syncAdmissionAgeField(scopeEl));
  syncAdmissionAgeField(scopeEl);
}

function wireAdmissionNameAutoFill(scopeEl) {
  const firstNameEl = scopeEl.querySelector("#field-first_name");
  const middleNameEl = scopeEl.querySelector("#field-middle_name");
  const lastNameEl = scopeEl.querySelector("#field-last_name");
  const otherNameEl = scopeEl.querySelector("#field-other_names");
  const fullNameEl = scopeEl.querySelector("#field-full_name");
  if (!fullNameEl || fullNameEl.dataset.autoFullNameBound === "1") return;
  fullNameEl.dataset.autoFullNameBound = "1";
  const sourceEls = [firstNameEl, middleNameEl, lastNameEl, otherNameEl].filter(Boolean);
  const refreshFullName = () => {
    const values = sourceEls.map((el) => String(el.value || "").trim()).filter(Boolean);
    if (values.length >= 2) {
      fullNameEl.value = values.join(" ");
    }
  };
  sourceEls.forEach((el) => el.addEventListener("input", refreshFullName));
  refreshFullName();
}

function attachAdmissionPostalFromSelect(scopeEl) {
  const pc = scopeEl.querySelector("#field-postal_code");
  const town = scopeEl.querySelector("#field-town");
  if (!pc || !town || pc.dataset.postalSync === "1") return;
  pc.dataset.postalSync = "1";
  pc.addEventListener("change", () => {
    const code = String(pc.value || "").trim();
    if (!code) return;
    const list = meta.kenyaPostalCodeSelectOptions || [];
    const hit = list.find((row) => String(row.value) === code);
    if (hit && hit.town) {
      town.value = hit.town;
    }
  });
}

function wireAdmissionLearnerPhotoUpload(scopeEl) {
  const btn = scopeEl.querySelector("#field-passport_photo_path-upload");
  const fileEl = scopeEl.querySelector("#field-passport_photo_path-file");
  const cameraInput = scopeEl.querySelector("#field-passport_photo_path-camera");
  const cameraOpenBtn = scopeEl.querySelector("#field-passport_photo_path-camera-open");
  const pathInput = scopeEl.querySelector("#field-passport_photo_path");
  if (!btn || !fileEl || !pathInput || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  const uploadSelectedFile = async (file) => {
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Upload failed.");
      }
      pathInput.value = data.filePath || "";
      alert(data.message || "Photo uploaded.");
    } catch (error) {
      alert(error.message || "Upload failed.");
    }
  };
  btn.addEventListener("click", async () => {
    const file = fileEl.files?.[0];
    if (!file) {
      alert("Choose a photo file first.");
      return;
    }
    await uploadSelectedFile(file);
  });
  cameraOpenBtn?.addEventListener("click", async () => {
    const canUseLiveCamera = Boolean(navigator?.mediaDevices?.getUserMedia);
    if (!canUseLiveCamera) {
      cameraInput?.click();
      return;
    }
    let stream = null;
    const overlay = document.createElement("div");
    overlay.className = "camera-capture-overlay";
    overlay.innerHTML = `
      <div class="camera-capture-card">
        <h4>Capture Learner Photo</h4>
        <video id="cameraCaptureVideo" autoplay playsinline></video>
        <div class="actions-row">
          <button type="button" id="cameraCaptureTakeBtn">Capture</button>
          <button type="button" id="cameraCaptureCloseBtn">Close</button>
        </div>
      </div>
    `;
    const stopStream = () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      overlay.remove();
    };
    try {
      document.body.appendChild(overlay);
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      const videoEl = overlay.querySelector("#cameraCaptureVideo");
      if (!videoEl) throw new Error("Camera preview not available.");
      videoEl.srcObject = stream;
      overlay.querySelector("#cameraCaptureCloseBtn")?.addEventListener("click", stopStream);
      overlay.querySelector("#cameraCaptureTakeBtn")?.addEventListener("click", async () => {
        try {
          const canvas = document.createElement("canvas");
          const width = Number(videoEl.videoWidth || 640);
          const height = Number(videoEl.videoHeight || 480);
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(videoEl, 0, 0, width, height);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
          if (!blob) {
            alert("Failed to capture camera photo.");
            return;
          }
          const capturedFile = new File([blob], `learner-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
          await uploadSelectedFile(capturedFile);
          stopStream();
        } catch (error) {
          alert(error.message || "Camera capture failed.");
        }
      });
    } catch (error) {
      stopStream();
      alert(`Live camera not available (${error.message || "Unknown error"}). Falling back to file picker.`);
      cameraInput?.click();
    }
  });
  cameraInput?.addEventListener("change", async () => {
    const captured = cameraInput.files?.[0];
    if (!captured) return;
    await uploadSelectedFile(captured);
  });
}

async function refreshAdmissionLearnerCodePreview(scopeEl) {
  const codeEl = scopeEl?.querySelector?.("#field-learner_code");
  if (!codeEl) return;
  try {
    const preview = await request("/api/admission/learners/next-learner-code");
    codeEl.value = String(preview?.learner_code || "");
  } catch (_) {
    codeEl.value = "";
  }
}

function wireAdmissionLearnerCodeField(scopeEl) {
  const codeEl = scopeEl?.querySelector?.("#field-learner_code");
  const serialEl = scopeEl?.querySelector?.("#field-learner_serial_number");
  if (!codeEl || codeEl.dataset.bound === "1") return;
  codeEl.dataset.bound = "1";
  const syncFromSerial = () => {
    const serialVal = Number(serialEl?.value || 0);
    if (serialVal > 0) {
      codeEl.value = formatLearnerCode(serialVal);
    }
  };
  serialEl?.addEventListener("input", syncFromSerial);
  syncFromSerial();
  if (!codeEl.value) {
    refreshAdmissionLearnerCodePreview(scopeEl).catch(() => {});
  }
}

function populateAdmissionGradeFormFilterOptions() {
  const sel = document.getElementById("admissionRegisterGradeFormFilter");
  if (!sel) return;
  const grades = Array.isArray(meta.gradeOptions) ? meta.gradeOptions : [];
  const forms = Array.isArray(meta.formOptions) ? meta.formOptions : [];
  const parts = [
    ...grades.map((g) => ({ v: g, l: `Grade: ${g}` })),
    ...forms.map((f) => ({ v: f, l: `Form: ${f}` }))
  ];
  sel.innerHTML = ['<option value="">All grades / forms</option>']
    .concat(parts.map((p) => `<option value="${escapeHtmlAttribute(p.v)}">${escapeHtml(p.l)}</option>`))
    .join("");
}

function wireAdmissionRegisterToolbar(config) {
  populateAdmissionGradeFormFilterOptions();
  document.getElementById("admissionRegisterApply")?.addEventListener("click", () => renderAdmissionRegisterTable());
  document.getElementById("admissionRegisterPrint")?.addEventListener("click", () => window.print());
  document.getElementById("admissionRegisterPdf")?.addEventListener("click", () => exportPdf());
  document.getElementById("admissionRegisterXls")?.addEventListener("click", () => exportExcel());
  ["admissionRegisterScope", "admissionRegisterStream", "admissionRegisterGradeFormFilter", "admissionRegisterSearch"].forEach(
    (id) => {
      document.getElementById(id)?.addEventListener("input", () => renderAdmissionRegisterTable());
      document.getElementById(id)?.addEventListener("change", () => renderAdmissionRegisterTable());
    }
  );
}

function parseSimpleCsvRows(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((item) => item.trim().replace(/^"|"$/g, "")));
}

function wireAdmissionExtendedActions() {
  (async () => {
    try {
      const settings = await request("/api/institutions/letterhead");
      const letterheadPathEl = document.getElementById("admissionLetterheadPath");
      const templateTextEl = document.getElementById("admissionLetterTemplateText");
      if (letterheadPathEl) letterheadPathEl.value = settings?.letterhead_file_path || "";
      if (templateTextEl) templateTextEl.value = settings?.admission_letter_template_text || "";
    } catch (_) {
      // Ignore when role is not allowed or endpoint unavailable.
    }
  })();
  document.getElementById("admissionDownloadBioTemplateBtn")?.addEventListener("click", async () => {
    await downloadWithAuth("/api/templates/admission-bio-data.csv", "admission-bio-data-template.csv");
  });
  document.getElementById("admissionDownloadStreamTemplateBtn")?.addEventListener("click", async () => {
    await downloadWithAuth("/api/templates/institution-streams.csv", "institution-streams-template.csv");
  });
  document.getElementById("admissionStreamTemplateUpload")?.addEventListener("change", async (event) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const rows = parseSimpleCsvRows(text);
      const [header, ...body] = rows;
      if (!header || header.length < 2) {
        throw new Error("CSV requires columns grade_or_form,stream_name.");
      }
      const entries = body
        .map((cols) => ({ grade_or_form: cols[0] || null, stream_name: cols[1] || "" }))
        .filter((entry) => entry.stream_name);
      const result = await request("/api/institutions/streams/bulk", {
        method: "POST",
        body: JSON.stringify({ entries })
      });
      alert(result.message || "Stream template uploaded.");
    } catch (error) {
      alert(error.message);
    } finally {
      event.target.value = "";
    }
  });
  document.getElementById("admissionLetterTemplateFileUpload")?.addEventListener("change", async (event) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const uploaded = await uploadFileWithAuth(file);
      const pathInput = document.getElementById("admissionLetterheadPath");
      if (pathInput && !pathInput.value) {
        pathInput.value = uploaded.filePath || "";
      }
      event.target.setAttribute("data-upload-path", uploaded.filePath || "");
      alert("Template file uploaded.");
    } catch (error) {
      alert(error.message);
    } finally {
      event.target.value = "";
    }
  });
  document.getElementById("admissionSaveLetterheadBtn")?.addEventListener("click", async () => {
    try {
      const letterheadPath = document.getElementById("admissionLetterheadPath")?.value || "";
      const templateText = document.getElementById("admissionLetterTemplateText")?.value || "";
      const templateFileInput = document.getElementById("admissionLetterTemplateFileUpload");
      const templateFilePath = templateFileInput?.getAttribute("data-upload-path") || "";
      const result = await request("/api/institutions/letterhead", {
        method: "PATCH",
        body: JSON.stringify({
          letterhead_file_path: letterheadPath || null,
          admission_letter_template_text: templateText || null,
          admission_letter_template_file_url: templateFilePath || null
        })
      });
      alert(result.message || "Letterhead saved.");
    } catch (error) {
      alert(error.message);
    }
  });
  const searchLearnersForAdmissionDocs = async () => {
    const mode = String(document.getElementById("admissionDocSearchMode")?.value || "learner");
    const value = String(document.getElementById("admissionDocSearchValue")?.value || "").trim();
    const query = value;
    const learnerSelect = document.getElementById("admissionDocLearnerSelect");
    if (!learnerSelect) return [];
    const rows = await request(`/api/admission/learners?limit=500&search=${encodeURIComponent(query)}`);
    let filtered = Array.isArray(rows) ? rows : [];
    if (mode === "gradeform") {
      filtered = filtered.filter((row) => {
        const grade = String(row.grade || "").toLowerCase();
        const form = String(row.form_name || "").toLowerCase();
        return !value || grade.includes(value.toLowerCase()) || form.includes(value.toLowerCase());
      });
    } else if (mode === "stream") {
      filtered = filtered.filter((row) => !value || String(row.stream || "").toLowerCase().includes(value.toLowerCase()));
    } else if (mode === "name") {
      filtered = filtered.filter((row) => !value || String(row.full_name || "").toLowerCase().includes(value.toLowerCase()));
    } else if (mode === "learner") {
      filtered = filtered.filter((row) =>
        !value ||
        String(row.id || "").includes(value) ||
        String(row.admission_number || "").toLowerCase().includes(value.toLowerCase()) ||
        String(row.upi_number || "").toLowerCase().includes(value.toLowerCase())
      );
    }
    learnerSelect.innerHTML = `<option value="">Select learner</option>${filtered
      .map((row) => `<option value="${Number(row.id || 0)}">${escapeHtml(row.full_name || "-")} (${escapeHtml(
        row.admission_number || row.upi_number || String(row.id || "-")
      )}) • ${escapeHtml(formatLearnerCode(row.learner_serial_number || row.id) || "-")}</option>`)
      .join("")}`;
    return filtered;
  };
  document.getElementById("admissionDocSearchBtn")?.addEventListener("click", async () => {
    try {
      const rows = await searchLearnersForAdmissionDocs();
      if (!rows.length) alert("No learner matched the selected search.");
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("admissionGenerateFormBtn")?.addEventListener("click", async () => {
    try {
      const learnerId = Number(document.getElementById("admissionDocLearnerSelect")?.value || 0);
      if (!learnerId) {
        alert("Select learner first.");
        return;
      }
      const result = await request(`/api/admission/learners/${learnerId}/admission-form`);
      const outputEl = document.getElementById("admissionGeneratedOutput");
      if (outputEl) outputEl.textContent = JSON.stringify(result, null, 2);
      const mode = (prompt("Choose output mode: PRINT or DOWNLOAD", "PRINT") || "").trim().toUpperCase();
      if (mode === "PRINT") window.print();
      if (mode === "DOWNLOAD") {
        downloadTextFile(`admission-form-${learnerId}.json`, JSON.stringify(result, null, 2), "application/json;charset=utf-8");
      }
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("admissionGenerateLetterBtn")?.addEventListener("click", async () => {
    try {
      const learnerId = Number(document.getElementById("admissionDocLearnerSelect")?.value || 0);
      if (!learnerId) {
        alert("Select learner first.");
        return;
      }
      const result = await request(`/api/admission/learners/${learnerId}/admission-letter`);
      const outputEl = document.getElementById("admissionGeneratedOutput");
      if (outputEl) outputEl.textContent = result?.letter_text || JSON.stringify(result, null, 2);
      const mode = (prompt("Choose output mode: PRINT or DOWNLOAD", "PRINT") || "").trim().toUpperCase();
      if (mode === "PRINT") window.print();
      if (mode === "DOWNLOAD") {
        downloadTextFile(
          `admission-letter-${learnerId}.txt`,
          String(result?.letter_text || JSON.stringify(result, null, 2)),
          "text/plain;charset=utf-8"
        );
      }
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("admissionDocPrintBtn")?.addEventListener("click", () => window.print());
  document.getElementById("admissionDocDownloadBtn")?.addEventListener("click", () => {
    const content = document.getElementById("admissionGeneratedOutput")?.textContent || "";
    if (!content.trim()) {
      alert("Generate form or letter first.");
      return;
    }
    downloadTextFile("admission-generated-output.txt", content, "text/plain;charset=utf-8");
  });
  document.getElementById("admissionPreviewOutputBtn")?.addEventListener("click", () => {
    const content = document.getElementById("admissionGeneratedOutput")?.textContent || "";
    if (!content.trim()) {
      alert("No generated output to preview.");
      return;
    }
    const popup = window.open("", "_blank");
    if (!popup) return;
    popup.document.write(`<html><head><title>Admission Preview</title></head><body><pre>${escapeHtml(content)}</pre></body></html>`);
    popup.document.close();
  });
}

function wireAdmissionModuleUi(container, config) {
  wireAdmissionGradeFormExclusive(container);
  wireAdmissionDisabilityToggle(container);
  wireAdmissionMedicalToggle(container);
  wireAdmissionAgeField(container);
  wireAdmissionNameAutoFill(container);
  wireAdmissionLearnerCodeField(container);
  attachAdmissionPostalFromSelect(container);
  wireAdmissionLearnerPhotoUpload(container);
  wireAdmissionRegisterToolbar(config);
  wireAdmissionExtendedActions();
  renderAdmissionRegisterTable();
  wireAdmissionParentGuardianRegister();
  renderAdmissionParentGuardianTable();
}

function wireAdmissionParentGuardianRegister() {
  ["admissionParentCategory", "admissionParentGradeForm", "admissionParentStream", "admissionParentSearch"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => renderAdmissionParentGuardianTable());
    document.getElementById(id)?.addEventListener("change", () => renderAdmissionParentGuardianTable());
  });
  document.getElementById("admissionParentApplyBtn")?.addEventListener("click", () => renderAdmissionParentGuardianTable());
  document.getElementById("admissionParentPrintBtn")?.addEventListener("click", () => window.print());
  document.getElementById("admissionParentDownloadBtn")?.addEventListener("click", () => {
    const rows = filterAdmissionParentRows();
    if (!rows.length) {
      alert("No parent/guardian records to download.");
      return;
    }
    downloadTextFile("parent-guardian-register.csv", rowsToCsv(rows), "text/csv;charset=utf-8");
  });
}

function admissionParentGuardianRecord(learnerId, slot) {
  const rows = getAdmissionParentRows();
  return rows.find((row) => Number(row.learner_id || 0) === Number(learnerId || 0) && Number(row.parent_slot || 1) === Number(slot || 1));
}

async function admissionParentGuardianView(learnerId, slot) {
  const row = admissionParentGuardianRecord(learnerId, slot);
  if (!row) {
    alert("Parent/guardian record not found.");
    return;
  }
  alert(
    [
      `Parent/Guardian: ${row.parent_name || "-"}`,
      `ID Number: ${row.parent_id || "-"}`,
      `Mobile: ${row.parent_mobile || "-"}`,
      `Learner: ${row.learner_name || "-"}`,
      `Grade/Form: ${row.learner_grade || "-"}`,
      `Stream: ${row.learner_stream || "-"}`
    ].join("\n")
  );
}

async function admissionParentGuardianEdit(learnerId, slot) {
  await admissionParentGuardianView(learnerId, slot);
}

async function admissionParentGuardianSave(learnerId, slot) {
  const row = admissionParentGuardianRecord(learnerId, slot);
  if (!row) {
    alert("Parent/guardian record not found.");
    return;
  }
  const nextName = prompt("Parent/guardian name:", row.parent_name || "") || "";
  const nextId = prompt("Parent ID number:", row.parent_id || "") || "";
  const nextMobile = prompt("Parent mobile:", row.parent_mobile || "") || "";
  if (!nextName.trim() && !nextMobile.trim()) {
    alert("Provide at least parent name or mobile.");
    return;
  }
  try {
    const payload = Number(slot || 1) === 2
      ? {
        parent2_full_name: nextName.trim(),
        parent2_id_number: nextId.trim(),
        parent2_phone_primary: nextMobile.trim()
      }
      : {
        parent_full_name: nextName.trim(),
        parent_id_number: nextId.trim(),
        parent_phone: nextMobile.trim()
      };
    await request(`/api/admission/learners/${Number(learnerId || 0)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    const rows = await request("/api/admission/learners");
    admissionRegisterRows = Array.isArray(rows) ? rows : [];
    renderAdmissionParentGuardianTable();
    renderAdmissionRegisterTable();
    alert("Parent/guardian record saved.");
  } catch (error) {
    alert(error.message);
  }
}

async function admissionParentGuardianDelete(learnerId, slot) {
  if (!window.confirm("Clear this parent/guardian record from learner bio-data?")) return;
  try {
    const payload = Number(slot || 1) === 2
      ? {
        parent2_full_name: "",
        parent2_id_number: "",
        parent2_phone_primary: "",
        parent2_phone_secondary: "",
        parent2_email: ""
      }
      : {
        parent_full_name: "",
        parent_id_number: "",
        parent_phone: "",
        parent_phone_secondary: "",
        parent_email: ""
      };
    await request(`/api/admission/learners/${Number(learnerId || 0)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    const rows = await request("/api/admission/learners");
    admissionRegisterRows = Array.isArray(rows) ? rows : [];
    renderAdmissionParentGuardianTable();
    renderAdmissionRegisterTable();
  } catch (error) {
    alert(error.message);
  }
}

function admissionParentGuardianPrint(learnerId, slot) {
  const row = admissionParentGuardianRecord(learnerId, slot);
  if (!row) {
    alert("Parent/guardian record not found.");
    return;
  }
  const popup = window.open("", "_blank");
  if (!popup) return;
  popup.document.write(`<pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre>`);
  popup.document.close();
  popup.print();
}

function admissionParentGuardianDownload(learnerId, slot) {
  const row = admissionParentGuardianRecord(learnerId, slot);
  if (!row) {
    alert("Parent/guardian record not found.");
    return;
  }
  downloadTextFile(
    `parent-guardian-${Number(learnerId || 0)}-${Number(slot || 1)}.json`,
    JSON.stringify(row, null, 2),
    "application/json;charset=utf-8"
  );
}

async function admissionRegisterView(id) {
  await editRow(id);
  document.querySelector(".admission-bio-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function admissionRegisterEdit(id) {
  await admissionRegisterView(id);
}

async function admissionRegisterSaveRow(id) {
  if (Number(currentEditId) !== Number(id)) {
    await editRow(id);
  }
  await saveCurrentModule();
}

async function admissionRegisterDelete(id) {
  await deleteRow(id);
}

async function dispatchCommunicationMessage(id) {
  if (!id) return;
  try {
    await request(`/api/communication/messages/${id}/dispatch`, { method: "POST" });
    alert("Message dispatched successfully.");
    if (currentModule === "communication-messages") {
      await loadModuleData(moduleConfigs["communication-messages"]);
    }
  } catch (error) {
    alert(error.message);
  }
}

async function dispatchQueuedMessages() {
  const limitInput = prompt("Dispatch how many queued messages? (default 50)", "50");
  if (limitInput === null) return;
  const parsedLimit = Number(limitInput);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50;
  try {
    const result = await request("/api/communication/messages/dispatch-queued", {
      method: "POST",
      body: JSON.stringify({ limit })
    });
    alert(
      `Queued dispatch complete. Sent: ${result.dispatched || 0}, Failed: ${result.failed || 0}, Processed: ${result.processed || 0}.`
    );
    if (currentModule === "communication-messages") {
      await loadModuleData(moduleConfigs["communication-messages"]);
    }
  } catch (error) {
    alert(error.message);
  }
}

async function openCommunicationChat() {
  setActiveSidebarButton("communication-messages");
  currentModule = "communication-messages";
  try {
    const rooms = await request("/api/communication/chat/rooms");
    const roomRows = Array.isArray(rooms?.rooms)
      ? rooms.rooms.map((room) => [
        room.room_key || "-",
        room.participants_count ?? "-",
        room.messages_count ?? "-",
        formatDateTime(room.last_message_at || room.created_at),
        room.preview_message || "-"
      ])
      : [];
    document.getElementById("moduleTitle").textContent = "Communication Chat";
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>Chat Rooms</h4>
        <p>${formatNumber(roomRows.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Communication Mode</h4>
        <p>Parent • Teacher • Admin</p>
      </div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Parent/Teacher Chat Rooms</h3>
        <p>Create structured chat rooms, send secure messages, and monitor conversation activity.</p>
      </div>
      <h3>Parent/Teacher Chat Rooms</h3>
      <div class="actions-row">
        <button id="createChatRoomButton">Create Room</button>
        <button id="sendChatMessageButton">Send Message</button>
        <button id="refreshChatRoomsButton">Refresh</button>
      </div>
      <p class="small-note">Use room key format like: learner-123, class-grade7-blue, or parent-teacher-briefing.</p>
      ${buildDashboardTable(
        ["Room Key", "Participants", "Messages", "Last Activity", "Latest Message"],
        roomRows
      )}
    `;
    resetDataTable("Select a chat room and use the buttons above.");
    document.getElementById("refreshChatRoomsButton")?.addEventListener("click", openCommunicationChat);
    document.getElementById("createChatRoomButton")?.addEventListener("click", async () => {
      const roomKey = prompt("Enter room key:", "parent-teacher-general");
      if (!roomKey) return;
      const participantRoles = prompt(
        "Enter participant roles (comma separated):",
        "PARENT,TEACHER,HEAD_OF_INSTITUTION"
      );
      if (!participantRoles) return;
      try {
        const created = await request("/api/communication/chat/rooms", {
          method: "POST",
          body: JSON.stringify({
            room_key: roomKey,
            participant_roles: participantRoles
              .split(",")
              .map((role) => role.trim())
              .filter(Boolean)
          })
        });
        alert(`Room ready: ${created.room?.room_key || roomKey}`);
        await openCommunicationChat();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("sendChatMessageButton")?.addEventListener("click", async () => {
      const roomKey = prompt("Enter target room key:");
      if (!roomKey) return;
      const messageBody = prompt("Enter message:");
      if (!messageBody) return;
      try {
        await request(`/api/communication/chat/rooms/${encodeURIComponent(roomKey)}/messages`, {
          method: "POST",
          body: JSON.stringify({ message_body: messageBody })
        });
        alert("Chat message sent.");
        const messages = await request(
          `/api/communication/chat/rooms/${encodeURIComponent(roomKey)}/messages?limit=80`
        );
        const messageRows = Array.isArray(messages?.messages)
          ? messages.messages.map((message) => [
            formatDateTime(message.created_at),
            message.sender_role || "-",
            message.sender_name || "-",
            message.message_body || "-"
          ])
          : [];
        resetDataTable("No chat messages in this room yet.");
        if (messageRows.length) {
          const head = document.getElementById("tableHead");
          const body = document.getElementById("tableBody");
          if (head && body) {
            head.innerHTML = `<tr><th>When</th><th>Sender Role</th><th>Sender</th><th>Message</th></tr>`;
            body.innerHTML = messageRows
              .map(
                (row) =>
                  `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`
              )
              .join("");
          }
        }
      } catch (error) {
        alert(error.message);
      }
    });
  } catch (error) {
    alert(error.message);
  }
}

function renderCrudModule(moduleKey, options = {}) {
  const config = moduleConfigs[moduleKey];
  const container = options.container || document.getElementById("formArea");
  const preserveCards = Boolean(options.preserveCards);
  const btnPrefix = `${moduleKey.replace(/[^a-z0-9_-]/gi, "-")}-${Date.now().toString(36)}`;
  const saveId = `${btnPrefix}-save`;
  const clearId = `${btnPrefix}-clear`;
  const procId = `${btnPrefix}-process`;
  const pdfId = `${btnPrefix}-pdf`;
  const xlsId = `${btnPrefix}-xls`;
  const printId = `${btnPrefix}-print`;
  const viewId = `${btnPrefix}-view`;
  if (!container || !config) return;
  setActiveSidebarButton(moduleKey);
  document.getElementById("moduleTitle").textContent = config.title;
  if (!preserveCards) {
    document.getElementById("cards").innerHTML = `
    <div class="card stats-card metric-emphasis">
      <h4>Active Module</h4>
      <p>${escapeHtml(config.title)}</p>
    </div>
    <div class="card stats-card">
      <h4>Operations</h4>
      <p>Create • Update • Export</p>
    </div>
    <div class="card stats-card">
      <h4>Access</h4>
      <p>Role-based controlled</p>
    </div>
  `;
  }
  const admissionRegisterMarkup =
    moduleKey === "admission"
      ? `
      <section id="admissionRegisterPanel" class="admission-register-panel" aria-label="Admission register">
        <h3 class="admission-register-title">Admission Register</h3>
        <p class="small-note admission-register-note">
          Filter learners by institution scope, stream, grade/form, or keyword search (name, admission number). Use row actions or the toolbar below.
        </p>
        <div class="admission-register-toolbar">
          <label class="admission-reg-field">
            Scope
            <select id="admissionRegisterScope">
              <option value="whole">Entire institution</option>
              <option value="stream">Single stream</option>
              <option value="gradeform">Grade or Form only</option>
            </select>
          </label>
          <label class="admission-reg-field">
            Stream
            <input id="admissionRegisterStream" placeholder="required when scoped to stream" />
          </label>
          <label class="admission-reg-field">
            Grade / Form filter
            <select id="admissionRegisterGradeFormFilter"></select>
          </label>
          <label class="admission-reg-field admission-reg-search">
            Search learner
            <input id="admissionRegisterSearch" placeholder="name • admission no • stream" />
          </label>
          <div class="admission-register-toolbar-actions">
            <button type="button" id="admissionRegisterApply" class="ax-btn ax-btn--view ax-btn--sm">Apply</button>
            <button type="button" id="admissionRegisterPrint" class="ax-btn ax-btn--print ax-btn--sm">Print</button>
            <button type="button" id="admissionRegisterPdf" class="ax-btn ax-btn--download ax-btn--sm">PDF</button>
            <button type="button" id="admissionRegisterXls" class="ax-btn ax-btn--download ax-btn--sm">Excel</button>
          </div>
        </div>
        <div class="dashboard-table-wrap admission-register-table-wrap">
          <table class="dashboard-table admission-register-table" id="admissionRegisterTable">
            <thead id="admissionRegisterHead"></thead>
            <tbody id="admissionRegisterBody"></tbody>
          </table>
        </div>
      </section>`
      : "";

  if (moduleKey === "admission") {
    const focusMode = String(options?.admissionFocus || "").toLowerCase();
    const showBio = !focusMode || focusMode === "bio";
    const showRegister = !focusMode || focusMode === "register";
    const showFormLetter = !focusMode || focusMode === "form" || focusMode === "letter";
    const showParentGuardian = !focusMode || focusMode === "parent-guardian";
    const showFormAction = !focusMode || focusMode === "form";
    const showLetterAction = !focusMode || focusMode === "letter";
    container.innerHTML = `
    <div class="section-card-header">
      <h3>${escapeHtml(config.title)}</h3>
      <p class="small-note">${escapeHtml(MODULE_DESCRIPTIONS[moduleKey] || "Manage records and actions for this module.")}</p>
    </div>
    <div id="admissionLearnersRegistrationPanel" class="admission-bio-panel" style="${showBio ? "" : "display:none;"}">
      <h4 class="admission-bio-title">Learners Registration</h4>
      <p class="small-note admission-mutual-note">Select <strong>either</strong> Grade <strong>or</strong> Form (not both). Postal code fills the town automatically.</p>
      <div class="form-grid form-grid-admission">
        ${config.fields.map(buildInput).join("")}
      </div>
      <div class="actions-row actions-row--compact">
        <button id="${saveId}" type="button" class="ax-btn ax-btn--save ax-btn--sm">Save</button>
        <button id="${clearId}" type="button" class="ax-btn ax-btn--reset ax-btn--sm">Clear</button>
        <button id="${pdfId}" type="button" class="ax-btn ax-btn--download ax-btn--sm">PDF</button>
        <button id="${xlsId}" type="button" class="ax-btn ax-btn--download ax-btn--sm">Excel</button>
        <button id="${printId}" type="button" class="ax-btn ax-btn--print ax-btn--sm">Print</button>
        <button id="${viewId}" type="button" class="ax-btn ax-btn--refresh ax-btn--sm">Refresh</button>
      </div>
    </div>
    ${admissionRegisterMarkup.replace('class="admission-register-panel"', `class="admission-register-panel" style="${showRegister ? "" : "display:none;"}"`)}
    <section id="admissionParentGuardianSection" class="dashboard-section" style="${showParentGuardian ? "" : "display:none;"}">
      <h4>Parent/Guardian Register</h4>
      <p class="small-note">Automatically sorted from learner bio-data. Filter by grade/form, stream or full list.</p>
      <div class="form-grid">
        <label>Category</label>
        <select id="admissionParentCategory">
          <option value="full">Full list</option>
          <option value="gradeform">Grade/Form</option>
          <option value="stream">Stream</option>
        </select>
        <label>Grade/Form</label>
        <input id="admissionParentGradeForm" placeholder="Grade or form" />
        <label>Stream</label>
        <input id="admissionParentStream" placeholder="Stream" />
        <label>Search Parent</label>
        <input id="admissionParentSearch" placeholder="Parent name, ID, or mobile" />
      </div>
      <div class="actions-row">
        <button type="button" id="admissionParentApplyBtn" class="ax-btn ax-btn--view ax-btn--sm">Apply</button>
        <button type="button" id="admissionParentPrintBtn" class="ax-btn ax-btn--print ax-btn--sm">Print</button>
        <button type="button" id="admissionParentDownloadBtn" class="ax-btn ax-btn--download ax-btn--sm">Download</button>
      </div>
      <div class="dashboard-table-wrap">
        <table class="dashboard-table">
          <thead id="admissionParentHead"></thead>
          <tbody id="admissionParentBody"></tbody>
        </table>
      </div>
    </section>
    <section id="admissionFormLetterSection" class="dashboard-section" style="${showFormLetter ? "" : "display:none;"}">
      <h4 id="admissionFormLetterPanel">${showFormAction && !showLetterAction ? "Admission Form" : showLetterAction && !showFormAction ? "Admission Letter" : "Admission Form & Letter"}</h4>
      <p class="small-note">Search learners by learner ID, name, grade/form, or stream. Select learner first, then generate, print, or download.</p>
      <div class="form-grid">
        <label>Search Mode</label>
        <select id="admissionDocSearchMode">
          <option value="learner">Per Learner</option>
          <option value="name">By Name</option>
          <option value="gradeform">By Grade/Form</option>
          <option value="stream">By Stream</option>
        </select>
        <label>Search Value</label>
        <input id="admissionDocSearchValue" placeholder="Learner ID, name, grade/form, or stream" />
        <label>Matched Learners</label>
        <select id="admissionDocLearnerSelect">
          <option value="">Select learner</option>
        </select>
      </div>
      <div class="actions-row">
        <button type="button" id="admissionDocSearchBtn" class="ax-btn ax-btn--view ax-btn--sm">Search Learner</button>
        <button type="button" id="admissionGenerateFormBtn" class="ax-btn ax-btn--process ax-btn--sm" style="${showFormAction ? "" : "display:none;"}">Generate Admission Form</button>
        <button type="button" id="admissionGenerateLetterBtn" class="ax-btn ax-btn--process ax-btn--sm" style="${showLetterAction ? "" : "display:none;"}">Generate Admission Letter</button>
        <button type="button" id="admissionDocPrintBtn" class="ax-btn ax-btn--print ax-btn--sm">Print Output</button>
        <button type="button" id="admissionDocDownloadBtn" class="ax-btn ax-btn--download ax-btn--sm">Download Output</button>
        <button type="button" id="admissionPreviewOutputBtn" class="ax-btn ax-btn--view ax-btn--sm">Preview Last Output</button>
      </div>
      <pre id="admissionGeneratedOutput" class="small-note" style="max-height:240px;overflow:auto;white-space:pre-wrap;"></pre>
    </section>
    <section id="admissionTemplatesSection" class="dashboard-section" data-template-control="true" style="${showFormLetter ? "" : "display:none;"}">
      <h4>Templates & Letterhead</h4>
      <div class="actions-row">
        <button type="button" id="admissionDownloadBioTemplateBtn" class="ax-btn ax-btn--download ax-btn--sm">Download Bio Data Template</button>
        <button type="button" id="admissionDownloadStreamTemplateBtn" class="ax-btn ax-btn--download ax-btn--sm">Download Stream Template</button>
        <label class="ax-btn ax-btn--view ax-btn--sm" for="admissionStreamTemplateUpload">Upload Stream CSV</label>
        <input id="admissionStreamTemplateUpload" type="file" accept=".csv,text/csv" style="display:none;" />
      </div>
      <div class="form-grid">
        <label>Institution Letterhead File Path</label>
        <input id="admissionLetterheadPath" placeholder="/uploads/....png" />
        <label>Admission Letter Template (optional text)</label>
        <textarea id="admissionLetterTemplateText" class="template-spacious" rows="12" placeholder="Use placeholders {{LEARNER_NAME}}, {{INSTITUTION_NAME}}, {{ADMISSION_NUMBER}}, {{GRADE_FORM}}, {{STREAM}}, {{REPORTING_DATE}}"></textarea>
      </div>
      <div class="actions-row">
        <label class="ax-btn ax-btn--view ax-btn--sm" for="admissionLetterTemplateFileUpload">Upload Letter Template File</label>
        <input id="admissionLetterTemplateFileUpload" type="file" accept=".pdf,.doc,.docx,.txt" style="display:none;" />
        <button type="button" id="admissionSaveLetterheadBtn" class="ax-btn ax-btn--save ax-btn--sm">Save Letterhead/Template</button>
      </div>
    </section>
  `;
  } else {
  container.innerHTML = `
    <div class="section-card-header">
      <h3>${config.title}</h3>
      <p class="small-note">${escapeHtml(MODULE_DESCRIPTIONS[moduleKey] || "Manage records and actions for this module.")}</p>
    </div>
    ${moduleKey === "management-teacher-resources" ? `
      <div class="module-header-card">
        <h4>Teacher Resource Instructions</h4>
        <p class="small-note">1) Select grade/form, learning area strand/sub-strand, and resource type. 2) Download Lesson Plan/Scheme/Record templates. 3) Generate from curriculum or upload your customized file. 4) Save so each institution keeps distinct, role-scoped resources.</p>
      </div>
    ` : ""}
    <div class="form-grid">
      ${config.fields.map(buildInput).join("")}
    </div>
    <div class="actions-row">
      <button id="${saveId}" type="button" class="ax-btn ax-btn--save ax-btn--sm">Save</button>
      <button id="${clearId}" type="button" class="ax-btn ax-btn--reset ax-btn--sm">Clear</button>
      <button id="${procId}" type="button" class="ax-btn ax-btn--process ax-btn--sm">Process</button>
      <button id="${pdfId}" type="button" class="ax-btn ax-btn--download ax-btn--sm">Download PDF</button>
      <button id="${xlsId}" type="button" class="ax-btn ax-btn--download ax-btn--sm">Download Excel</button>
      <button id="${printId}" type="button" class="ax-btn ax-btn--print ax-btn--sm">Print</button>
      <button id="${viewId}" type="button" class="ax-btn ax-btn--view ax-btn--sm">View</button>
      ${moduleKey === "finance-payroll" ? `<button id="${btnPrefix}-auto-payroll" type="button" class="ax-btn ax-btn--process ax-btn--sm">Auto Generate Payroll</button>` : ""}
      ${moduleKey === "finance-salary-advance" ? `<button id="${btnPrefix}-advance" type="button" class="ax-btn ax-btn--process ax-btn--sm">Process Selected Advance</button>` : ""}
      ${moduleKey === "communication-messages" ? `<button id="${btnPrefix}-dispatch" type="button" class="ax-btn ax-btn--process ax-btn--sm">Dispatch Queued</button>` : ""}
      ${moduleKey === "communication-messages" ? `<button id="${btnPrefix}-chat" type="button" class="ax-btn ax-btn--view ax-btn--sm">Open Chat</button>` : ""}
      ${moduleKey === "management-teacher-resources" ? `<button id="${btnPrefix}-resource-generate" type="button" class="ax-btn ax-btn--process ax-btn--sm">Generate from Curriculum</button>` : ""}
      ${moduleKey === "management-teacher-resources" ? `<button id="${btnPrefix}-resource-template-download" type="button" class="ax-btn ax-btn--download ax-btn--sm" data-template-control="true">Template</button>` : ""}
      ${moduleKey === "management-teacher-resources" ? `<button id="${btnPrefix}-lesson-plan-template-download" type="button" class="ax-btn ax-btn--download ax-btn--sm">Lesson Plan</button>` : ""}
      ${moduleKey === "management-teacher-resources" ? `<button id="${btnPrefix}-scheme-template-download" type="button" class="ax-btn ax-btn--download ax-btn--sm">Scheme</button>` : ""}
      ${moduleKey === "management-teacher-resources" ? `<button id="${btnPrefix}-record-template-download" type="button" class="ax-btn ax-btn--download ax-btn--sm">Record</button>` : ""}
      ${moduleKey === "management-teacher-resources" ? `<button id="${btnPrefix}-resource-template-upload" type="button" class="ax-btn ax-btn--upload ax-btn--sm" data-template-control="true">Upload Template</button>` : ""}
      ${moduleKey === "management-teacher-resources" ? `<input id="${btnPrefix}-resource-template-file" type="file" accept=".txt,.csv,.doc,.docx,.pdf" style="display:none;" data-template-control="true" />` : ""}
    </div>
  `;
  }
  document.getElementById(saveId).onclick = saveCurrentModule;
  document.getElementById(clearId).onclick = () => clearForm(config);
  const tableAreaMain = document.querySelector(".main-content .table-area");
  if (moduleKey === "admission") {
    if (tableAreaMain) tableAreaMain.style.display = "none";
    wireAdmissionModuleUi(container, config);
    if (!isSuperSystemDeveloperPortal()) {
      const templateSection = document.getElementById("admissionTemplatesSection");
      if (templateSection) templateSection.style.display = "none";
    }
  } else {
    if (tableAreaMain) tableAreaMain.style.display = "";
    document.getElementById(procId).onclick = () => alert("Processing completed for this module.");
  }
  document.getElementById(pdfId).onclick = exportPdf;
  document.getElementById(xlsId).onclick = exportExcel;
  document.getElementById(printId).onclick = () => window.print();
  document.getElementById(viewId).onclick = () => loadModuleData(config);
  if (moduleKey === "finance-payroll") {
    document.getElementById(`${btnPrefix}-auto-payroll`)?.addEventListener("click", async () => {
      const payrollMonth = prompt("Payroll month (e.g. April):", "");
      if (payrollMonth === null) return;
      const payrollYearInput = prompt("Payroll year (e.g. 2026):", String(new Date().getFullYear()));
      if (payrollYearInput === null) return;
      const basicSalaryInput = prompt("Default basic salary for auto-generation:", "0");
      if (basicSalaryInput === null) return;
      const allowancesInput = prompt("Default allowances:", "0");
      if (allowancesInput === null) return;
      const deductionsInput = prompt("Default deductions:", "0");
      if (deductionsInput === null) return;
      try {
        const result = await request("/api/finance/payroll/auto-generate", {
          method: "POST",
          body: JSON.stringify({
            payroll_month: payrollMonth,
            payroll_year: Number(payrollYearInput),
            basic_salary: Number(basicSalaryInput),
            allowances: Number(allowancesInput),
            deductions: Number(deductionsInput)
          })
        });
        alert(result.message || "Payroll auto-generation complete.");
        await loadModuleData(config);
      } catch (error) {
        alert(error.message);
      }
    });
  }
  if (moduleKey === "finance-salary-advance") {
    document.getElementById(`${btnPrefix}-advance`)?.addEventListener("click", async () => {
      const requestIdInput = prompt("Enter Salary Advance Request ID to process:");
      if (!requestIdInput) return;
      const decisionInput = (prompt("Decision (approve/reject):", "approve") || "").trim().toLowerCase();
      if (!decisionInput) return;
      if (!["approve", "reject"].includes(decisionInput)) {
        alert("Decision must be 'approve' or 'reject'.");
        return;
      }
      const approvedAmountInput =
        decisionInput === "approve"
          ? prompt("Approved amount (leave blank to use requested amount):", "")
          : "";
      const deductionPlanInput =
        decisionInput === "approve"
          ? prompt("Deduction plan details:", "")
          : "";
      try {
        const payload = {
          request_id: Number(requestIdInput),
          decision: decisionInput
        };
        if (approvedAmountInput) {
          payload.amount_approved = Number(approvedAmountInput);
        }
        if (deductionPlanInput) {
          payload.deduction_plan = deductionPlanInput;
        }
        const result = await request("/api/finance/salary-advances/auto-process", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        alert(result.message || "Salary advance processed.");
        await loadModuleData(config);
      } catch (error) {
        alert(error.message);
      }
    });
  }
  if (moduleKey === "communication-messages") {
    document.getElementById(`${btnPrefix}-dispatch`)?.addEventListener("click", dispatchQueuedMessages);
    document.getElementById(`${btnPrefix}-chat`)?.addEventListener("click", openCommunicationChat);
    const recipientRoleEl = document.getElementById("field-recipient_role");
    const messageTypeEl = document.getElementById("field-message_type");
    const recipientContactEl = document.getElementById("field-recipient_contact");
    const autoFillRecipientContact = async () => {
      const role = String(recipientRoleEl.value || "").trim();
      const messageType = String(messageTypeEl?.value || "").trim();
      if (!role || !messageType || !recipientContactEl) return;
      try {
        const info = await request(`/api/communication/messages/recipient-preview?recipient_role=${encodeURIComponent(role)}`);
        recipientContactEl.value = info?.first_contact || "";
        recipientContactEl.placeholder = info?.total_contacts
          ? `${info.total_contacts} contact(s) matched`
          : "No contacts found for this role";
      } catch (_) {
        /* ignore preview lookup failure and allow manual entry */
      }
    };
    recipientRoleEl?.addEventListener("change", autoFillRecipientContact);
    messageTypeEl?.addEventListener("change", autoFillRecipientContact);
  }
  if (moduleKey === "management-teacher-resources") {
    const generateBtn = document.getElementById(`${btnPrefix}-resource-generate`);
    const templateDownloadBtn = document.getElementById(`${btnPrefix}-resource-template-download`);
    const lessonPlanTemplateBtn = document.getElementById(`${btnPrefix}-lesson-plan-template-download`);
    const schemeTemplateBtn = document.getElementById(`${btnPrefix}-scheme-template-download`);
    const recordTemplateBtn = document.getElementById(`${btnPrefix}-record-template-download`);
    const templateUploadBtn = document.getElementById(`${btnPrefix}-resource-template-upload`);
    const templateFileInput = document.getElementById(`${btnPrefix}-resource-template-file`);
    generateBtn?.addEventListener("click", async () => {
      try {
        const teacherProfileId = Number(document.getElementById("field-teacher_profile_id")?.value || 0) || null;
        const resourceType = String(document.getElementById("field-resource_type")?.value || "Lesson Plan");
        const grade = String(document.getElementById("field-grade")?.value || "");
        const term = String(document.getElementById("field-term")?.value || "");
        const strand = String(document.getElementById("field-strand")?.value || "");
        const subStrand = String(document.getElementById("field-sub_strand")?.value || "");
        const generated = await request("/api/management/teacher-resources/auto-generate", {
          method: "POST",
          body: JSON.stringify({
            teacher_profile_id: teacherProfileId,
            resource_type: resourceType,
            grade,
            term,
            strand,
            sub_strand: subStrand
          })
        });
        const descriptionEl = document.getElementById("field-description");
        if (descriptionEl) descriptionEl.value = String(generated?.generatedDocument || "");
        alert("Teacher resource generated from curriculum.");
      } catch (error) {
        alert(error.message);
      }
    });
    templateDownloadBtn?.addEventListener("click", () => {
      const profileName = String(portalContext?.name || portalContext?.full_name || portalContext?.username || "User");
      const role = String(portalContext?.role || "-");
      const institution = String(portalContext?.institution_name || "Institution");
      const template = [
        `Institution: ${institution}`,
        `Prepared by: ${profileName}`,
        `Role: ${role}`,
        "Resource Type: Lesson Plan / Scheme of Work / Record of Work",
        "Learning Area:",
        "Grade/Form:",
        "Term:",
        "Strand:",
        "Sub-strand:",
        "",
        "Objectives:",
        "Learning Activities:",
        "Assessment Strategy:",
        "Record of Work Covered:"
      ].join("\n");
      downloadTextFile("teacher-resource-template.txt", template, "text/plain;charset=utf-8");
    });
    lessonPlanTemplateBtn?.addEventListener("click", async () => {
      await downloadWithAuth("/api/templates/lesson-plan.csv", "lesson-plan-template.csv");
    });
    schemeTemplateBtn?.addEventListener("click", async () => {
      await downloadWithAuth("/api/templates/scheme-of-work.csv", "scheme-of-work-template.csv");
    });
    recordTemplateBtn?.addEventListener("click", async () => {
      await downloadWithAuth("/api/templates/record-of-work.csv", "record-of-work-template.csv");
    });
    templateUploadBtn?.addEventListener("click", () => templateFileInput?.click());
    templateFileInput?.addEventListener("change", async (event) => {
      const file = event?.target?.files?.[0];
      if (!file) return;
      try {
        const uploaded = await uploadFileWithAuth(file);
        const filePathEl = document.getElementById("field-file_path");
        if (filePathEl) filePathEl.value = String(uploaded?.filePath || "");
        const text = await file.text().catch(() => "");
        const descriptionEl = document.getElementById("field-description");
        if (descriptionEl && text) descriptionEl.value = text;
        alert("Modified teacher resource template uploaded.");
      } catch (error) {
        alert(error.message);
      } finally {
        event.target.value = "";
      }
    });
  }
  if (moduleKey === "admission") {
    const focusMode = String(options?.admissionFocus || "").toLowerCase();
    if (focusMode === "form" || focusMode === "letter") {
      document.getElementById("admissionFormLetterPanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (focusMode === "register") {
      document.getElementById("admissionRegisterPanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (focusMode === "parent-guardian") {
      document.getElementById("admissionParentGuardianSection")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (focusMode === "bio") {
      document.getElementById("admissionLearnersRegistrationPanel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  applyCompactIconButtons(container);
  applyTemplateVisibility(container);
  loadModuleData(config);
  setTimeout(() => attachPostalCodeTownHelper(container), 0);
}

function renderDashboardCards(stats) {
  const feeCardKeys = new Set([
    "totalFeesCollectedToday",
    "totalFeesCollectedMonth",
    "totalFeesCollectedYear",
    "totalFeesExpectedYear",
    "totalFeesVarianceYear"
  ]);
  const outstandingCardKeys = new Set([
    "outstandingBalanceTotal",
    "learnersWithOutstandingBalance",
    "totalOutstandingBalance"
  ]);
  const attendanceCardKeys = new Set([
    "totalPresent",
    "totalAbsent",
    "totalLate",
    "totalTeachersPresent",
    "totalTeachersOfficialLeave",
    "totalTeachersAbsentWithApology",
    "totalTeachersAbsentWithoutApology",
    "totalTeachersDeserter",
    "totalTeachersTransferred",
    "totalTeachersSuspended",
    "totalTeachersInterdicted",
    "totalTeachersRetired"
  ]);
  const performanceCardKeys = new Set(["totalTeachers"]);
  const populationCardKeys = new Set([
    "totalLearners",
    "totalActiveLearners",
    "totalBoys",
    "totalGirls",
    "totalSuspended",
    "totalExpelled",
    "totalDropOut",
    "totalTransferred",
    "totalCompletion"
  ]);

  function cardAllowedForStat(key) {
    if (feeCardKeys.has(key)) return isDashboardWidgetVisible("dashboard-fee-collection");
    if (outstandingCardKeys.has(key)) return isDashboardWidgetVisible("dashboard-outstanding-balances");
    if (attendanceCardKeys.has(key)) return isDashboardWidgetVisible("dashboard-attendance-list");
    if (performanceCardKeys.has(key)) return isDashboardWidgetVisible("dashboard-performance");
    if (populationCardKeys.has(key)) return isDashboardWidgetVisible("dashboard-performance");
    return true;
  }

  const allEntries = Object.entries(stats || {});
  const entries = allEntries.filter(([key]) => cardAllowedForStat(key));
  const cardsHost = document.getElementById("cards");
  if (!cardsHost) return;
  if (entries.length) {
    cardsHost.innerHTML = entries
      .map(
        ([key, value]) => `
      <div class="card stats-card metric-card metric-${escapeHtml(key)}">
        <h4>${escapeHtml(DASHBOARD_STAT_LABELS[key] || key.replace(/([A-Z])/g, " $1"))}</h4>
        <p>${key.toLowerCase().includes("fee") ? formatMoney(value) : formatNumber(value)}</p>
      </div>
    `
      )
      .join("");
    return;
  }
  if (allEntries.length) {
    cardsHost.innerHTML =
      '<p class="small-note dashboard-hidden-widget">Dashboard statistics cards are restricted for your account.</p>';
    return;
  }
  cardsHost.innerHTML =
    '<p class="small-note dashboard-empty-stats">Dashboard summary returned no totals yet. Add learners / fees / attendance to populate metrics.</p>';
}

function stopDashboardAutoRefresh() {
  if (dashboardAutoRefreshHandle) {
    clearInterval(dashboardAutoRefreshHandle);
    dashboardAutoRefreshHandle = null;
  }
}

function startDashboardAutoRefresh() {
  stopDashboardAutoRefresh();
  dashboardAutoRefreshHandle = setInterval(() => {
    if (currentModule !== "dashboard") {
      stopDashboardAutoRefresh();
      return;
    }
    loadDashboard({ silent: true, skipAutoRefresh: true }).catch(() => {
      // Keep the dashboard usable even if one refresh cycle fails.
    });
  }, 2000);
}

async function loadDashboard(options = {}) {
  const { silent = false, skipAutoRefresh = false } = options;
  currentModule = "dashboard";
  currentSidebarSubmoduleId = null;
  const tableAreaMain = document.querySelector(".main-content .table-area");
  if (tableAreaMain) tableAreaMain.style.display = "";
  setActiveSidebarButton("dashboard");
  document.getElementById("moduleTitle").textContent = "DASHBOARD";
  try {
    const data = await request("/api/dashboard/summary");
    renderDashboardCards(data.stats || {});
    const attendanceRows = (data.dailyAttendanceList || []).slice(0, 40).map((row) => [
      row.attendance_type || "-",
      row.person_name || "-",
      row.person_id || "-",
      row.grade || "-",
      row.stream || "-",
      row.status || "-",
      row.reason || "-",
      formatDateTime(row.attendance_date),
      formatDateTime(row.time_in),
      formatDateTime(row.time_out)
    ]);
    const performanceRows = (data.performanceByClass || []).map((row) => [
      row.grade || "-",
      row.stream || "-",
      formatNumber(row.totalLearners),
      formatNumber(row.totalEntries),
      formatNumber(row.meanScore),
      formatNumber(row.lowestScore),
      formatNumber(row.highestScore)
    ]);
    const recentPaymentsRows = (data.feeCollectionSummary?.recentPayments || []).map((row) => [
      row.learner_name || "-",
      row.admission_number || "-",
      row.grade || "-",
      row.stream || "-",
      formatMoney(row.amount_paid),
      row.payment_method || "-",
      row.receipt_number || "-",
      formatDateTime(row.payment_date),
      formatMoney(row.balance_after_payment)
    ]);
    const outstandingRows = (data.feeCollectionSummary?.outstandingBalances || []).map((row) => [
      row.learner_name || "-",
      row.admission_number || "-",
      row.grade || "-",
      row.stream || "-",
      formatMoney(row.balance)
    ]);
    const alertsMarkup = (data.alerts || [])
      .map(
        (alert) => `
        <div class="dashboard-alert ${escapeHtml(alert.severity || "info")}">
          <strong>${escapeHtml(alert.title || "Alert")}</strong>
          <p>${escapeHtml(alert.message || "")}</p>
        </div>
      `
      )
      .join("");
    const announcementMarkup = (data.announcements || [])
      .map(
        (item) => `
        <div class="dashboard-announcement">
          <h4>${escapeHtml(item.title || "Announcement")}</h4>
          <p>${escapeHtml(item.message || "")}</p>
          <small>
            Audience: ${escapeHtml(item.audience || "All")} | Posted: ${escapeHtml(formatDateTime(item.created_at))}
          </small>
        </div>
      `
      )
      .join("");
    const topAreaEl = document.getElementById("dashboardTopArea");
    if (topAreaEl) {
      if (isDashboardWidgetVisible("dashboard-alerts-announcements")) {
        topAreaEl.innerHTML = `
        <section class="dashboard-section dashboard-alerts-priority alerts-top-slot">
          <h3>Alerts & Announcements</h3>
          <div class="dashboard-alerts-priority-grid">
            <div class="dashboard-alerts-priority-col">
              <h4>System Alerts</h4>
              <div class="dashboard-alerts">
                ${alertsMarkup || '<p class="small-note">No Active Announcements</p><p class="small-note">There are no active announcements scheduled for today.</p>'}
              </div>
            </div>
            <div class="dashboard-alerts-priority-col">
              <h4>Active Announcements</h4>
              <div class="dashboard-announcements">
                ${announcementMarkup || '<p class="small-note">No active announcements.</p>'}
              </div>
            </div>
          </div>
        </section>
      `;
      } else {
        topAreaEl.innerHTML = "";
      }
    }
    const feeSummary = data.feeCollectionSummary || {};
    const showAttendanceList = isDashboardWidgetVisible("dashboard-attendance-list");
    const showPerformance = isDashboardWidgetVisible("dashboard-performance");
    const showFeeSummary = isDashboardWidgetVisible("dashboard-fee-collection");
    const showOutstanding = isDashboardWidgetVisible("dashboard-outstanding-balances");
    const feeBlock = `
        <section class="dashboard-section">
          <h3>Fee Collection Summary</h3>
          <div class="dashboard-metrics">
            <p><strong>Today:</strong> ${escapeHtml(formatMoney(feeSummary.todayTotal))} (${escapeHtml(formatNumber(feeSummary.todayPaymentsCount))} payment(s))</p>
            <p><strong>Month to Date:</strong> ${escapeHtml(formatMoney(feeSummary.monthTotal))} (${escapeHtml(formatNumber(feeSummary.monthPaymentsCount))} payment(s))</p>
            <p><strong>Year Total:</strong> ${escapeHtml(formatMoney(feeSummary.yearTotal))}</p>
            <p><strong>Year Target:</strong> ${escapeHtml(formatMoney(feeSummary.yearExpected))}</p>
            <p><strong>Variance:</strong> ${escapeHtml(formatMoney(feeSummary.yearVariance))}</p>
            ${showOutstanding ? `<p><strong>Outstanding Balance:</strong> ${escapeHtml(formatMoney(feeSummary.outstandingBalanceTotal))} (${escapeHtml(formatNumber(feeSummary.learnersWithOutstandingBalance))} learner(s))</p>` : ""}
          </div>
          <h4>Recent Fee Payments</h4>
          ${buildDashboardTable(
      ["Learner", "Adm No", "Grade", "Stream", "Amount", "Method", "Receipt", "Payment Date", "Balance"],
      recentPaymentsRows
    )}
          ${
      showOutstanding
        ? `<h4>Learners with Outstanding Balances</h4>
          ${buildDashboardTable(["Learner", "Adm No", "Grade", "Stream", "Balance"], outstandingRows)}`
        : ""
      }
        </section>`;
    const gridSections = [
      showAttendanceList
        ? `<section class="dashboard-section">
          <h3>Daily Attendance List</h3>
          <p class="small-note">Showing up to 40 latest records for today.</p>
          ${buildDashboardTable(
      ["Type", "Name", "Person ID", "Grade", "Stream", "Status", "Reason", "Attendance Time", "Time In", "Time Out"],
      attendanceRows
    )}
        </section>`
        : "",
      showPerformance
        ? `<section class="dashboard-section">
          <h3>Performance by Class/Grade & Stream</h3>
          ${buildDashboardTable(
      ["Grade", "Stream", "Learners", "Entries", "Mean", "Lowest", "Highest"],
      performanceRows
    )}
        </section>`
        : "",
      showFeeSummary ? feeBlock : ""
    ].filter(Boolean);
    document.getElementById("formArea").innerHTML = `
      <section class="dashboard-hero">
        <div>
          <h3>Institution Performance Cockpit</h3>
          <p class="small-note">Monitor academics, attendance, finance, alerts, and activity in one place.</p>
        </div>
        <div class="dashboard-hero-meta">
          <span class="tag">Portal: ${escapeHtml(portalContext?.portal || "-")}</span>
          <span class="tag">Role: ${escapeHtml(portalContext?.role || "-")}</span>
          <span class="tag">Generated: ${escapeHtml(formatDateTime(data.generated_at))}</span>
        </div>
      </section>
      ${gridSections.length ? `<div class="dashboard-grid">${gridSections.join("")}</div>` : '<p class="small-note dashboard-hidden-widget">Some dashboard tiles are hidden based on Access Control settings for your account.</p>'}
    `;
    document.getElementById("tableHead").innerHTML = "";
    document.getElementById("tableBody").innerHTML = "";
    if (!skipAutoRefresh) {
      startDashboardAutoRefresh();
    }
  } catch (error) {
    if (!silent) {
      alert(error.message);
    }
    const cardsEl = document.getElementById("cards");
    const formAreaEl = document.getElementById("formArea");
    if (!silent && cardsEl) {
      cardsEl.innerHTML = `<div class="form-notice error dashboard-load-error">${escapeHtml(
        error.message || "Dashboard statistics could not be loaded."
      )}</div>`;
    }
    if (!silent && formAreaEl) {
      formAreaEl.innerHTML = `
        <div class="form-notice error">
          <strong>Dashboard data unavailable.</strong>
          Check MySQL is running and you are logged in on the URL/port from your <code>npm start</code> banner.
          You can retry by clicking <strong>Dashboard</strong> in the sidebar.
        </div>`;
    }
  }
}

async function loadParentOrBomResults() {
  setActiveSidebarButton("parents-results");
  document.getElementById("moduleTitle").textContent = "Parent/BOM Results";
  document.getElementById("cards").innerHTML = `
    <div class="card stats-card metric-emphasis">
      <h4>Parent/BOM Portal</h4>
      <p>Results and reports visibility</p>
    </div>
  `;
  document.getElementById("formArea").innerHTML = `
    <h3>Results View</h3>
    <p class="small-note">Review learner assessment outcomes and export printable reports.</p>
    <div class="actions-row">
      <button id="exportParentPdf">Download Results PDF</button>
      <button id="printParent">Print</button>
    </div>
  `;
  document.getElementById("exportParentPdf").onclick = () =>
    window.open("/api/parent/results/export/pdf", "_blank");
  document.getElementById("printParent").onclick = () => window.print();
  applyCompactIconButtons(document.getElementById("formArea"));

  try {
    const rows = await request("/api/parent/results");
    renderTable(rows || []);
  } catch (error) {
    document.getElementById("tableHead").innerHTML = "";
    document.getElementById("tableBody").innerHTML = `<tr><td>${error.message}</td></tr>`;
  }
}

async function loadLearnerMaterials() {
  setActiveSidebarButton("learner-materials");
  document.getElementById("moduleTitle").textContent = "Learner Materials Module";
  document.getElementById("cards").innerHTML = `
    <div class="card stats-card metric-emphasis">
      <h4>Learner Materials</h4>
      <p>Curriculum-driven notes and assessment resources</p>
    </div>
  `;
  document.getElementById("formArea").innerHTML = `
    <h3>Learner Materials Module</h3>
    <p class="small-note">Generate notes from curriculum data, then print/download immediately.</p>
    <div class="form-grid">
      <label>Material Type</label>
      <select id="learnerMaterialType">
        <option value="notes">Notes</option>
        <option value="past_exam">Past Exams</option>
        <option value="revision_sheet">Revision Sheet</option>
      </select>
      <label>Grade</label>
      <select id="learnerMaterialGrade">
        <option value="">Select grade</option>
        ${(Array.isArray(meta?.gradeOptions) ? meta.gradeOptions : []).map((row) => `<option value="${escapeHtml(row)}">${escapeHtml(row)}</option>`).join("")}
      </select>
      <label>Learning Area</label>
      <input id="learnerMaterialLearningArea" placeholder="e.g. Pre-Technical Studies" />
      <label>Strand</label>
      <input id="learnerMaterialStrand" placeholder="e.g. 2.0 Communication in Pre-Technical Studies" />
      <label>Sub-strand (optional)</label>
      <input id="learnerMaterialSubStrand" placeholder="e.g. 2.3 ICT Tools in Communication" />
    </div>
    <div class="actions-row">
      <button id="generateLearnerMaterial">Generate</button>
      <button id="refreshLearner">Refresh</button>
      <button id="printLearner">Print</button>
      <button id="downloadLearnerMaterial">Download</button>
      <button id="downloadLearnerMaterialTemplate" data-template-control="true">Template</button>
      <button id="uploadLearnerMaterialTemplate" data-template-control="true">Upload Template</button>
      <input id="uploadLearnerMaterialTemplateInput" type="file" accept=".txt,.csv,.doc,.docx,.pdf" style="display:none;" data-template-control="true" />
    </div>
    <textarea id="learnerGeneratedMaterial" rows="12" placeholder="Generated material appears here..."></textarea>
  `;
  const outputEl = document.getElementById("learnerGeneratedMaterial");
  document.getElementById("refreshLearner").onclick = loadLearnerMaterials;
  document.getElementById("printLearner").onclick = () => window.print();
  document.getElementById("downloadLearnerMaterial").onclick = () => {
    const content = String(outputEl?.value || "").trim();
    if (!content) {
      alert("Generate material first.");
      return;
    }
    downloadTextFile("learner-materials-notes.txt", content, "text/plain;charset=utf-8");
  };
  document.getElementById("downloadLearnerMaterialTemplate").onclick = () => {
    const template = [
      "Learning Area:",
      "Grade/Form:",
      "Material Type (notes/past exams/other):",
      "Strand:",
      "Sub-strand:",
      "",
      "Generated content goes here..."
    ].join("\n");
    downloadTextFile("learner-material-template.txt", template, "text/plain;charset=utf-8");
  };
  document.getElementById("uploadLearnerMaterialTemplate").onclick = () => {
    document.getElementById("uploadLearnerMaterialTemplateInput")?.click();
  };
  document.getElementById("uploadLearnerMaterialTemplateInput").onchange = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const text = await file.text();
    if (outputEl) outputEl.value = text;
    event.target.value = "";
  };
  document.getElementById("generateLearnerMaterial").onclick = async () => {
    try {
      const grade = String(document.getElementById("learnerMaterialGrade")?.value || "").trim();
      const learningArea = String(document.getElementById("learnerMaterialLearningArea")?.value || "").trim();
      const strand = String(document.getElementById("learnerMaterialStrand")?.value || "").trim();
      const subStrand = String(document.getElementById("learnerMaterialSubStrand")?.value || "").trim();
      if (!grade || !learningArea || !strand) {
        alert("Select grade, learning area, and strand first.");
        return;
      }
      const generated = await request("/api/cbc/curriculum/ai-generate-notes", {
        method: "POST",
        body: JSON.stringify({
          grade,
          learning_area: learningArea,
          strand,
          sub_strand: subStrand || null
        })
      });
      if (outputEl) outputEl.value = generated?.generated_notes || "No notes generated.";
    } catch (error) {
      alert(error.message);
    }
  };
  try {
    const isLearnerRole = normalizeRoleKey(portalContext?.role || "") === "LEARNER";
    const [materials, marks] = isLearnerRole
      ? await Promise.all([request("/api/learner/materials"), request("/api/learner/marks")])
      : await Promise.all([request("/api/learners/resources"), request("/api/academic/marks")]);
    renderTable([...(materials || []), ...(marks || []).slice(0, 200)]);
    applyCompactIconButtons(document.getElementById("formArea"));
  } catch (error) {
    document.getElementById("tableHead").innerHTML = "";
    document.getElementById("tableBody").innerHTML = `<tr><td>${error.message}</td></tr>`;
  }
}

const STAFF_HUB_ROLE_BY_MODULE = {
  "management-teachers": "TEACHER",
  "management-non-teaching": "NON_TEACHING_STAFF"
};

function attachPostalCodeTownHelper(scopeEl) {
  if (!scopeEl) return;
  const lk = scopeEl.querySelector("#field-postal_code_lookup");
  if (!lk || lk.dataset.bound === "1") return;
  lk.dataset.bound = "1";
  lk.addEventListener("change", () => {
    const value = lk.value || "";
    const delimiter = value.includes(" — ") ? " — " : " - ";
    const [codeRaw, townRaw = ""] = value.split(delimiter);
    const pcEl = scopeEl.querySelector("#field-postal_code");
    const townEl = scopeEl.querySelector("#field-town");
    if (pcEl && codeRaw) pcEl.value = codeRaw.trim();
    if (townEl && townRaw) townEl.value = townRaw.trim();
  });
}

async function renderStaffServiceHub(options = {}) {
  stopDashboardAutoRefresh();
  currentEditId = null;
  const tableAreaMain = document.querySelector(".main-content .table-area");
  if (tableAreaMain) tableAreaMain.style.display = "";
  currentModule = "management-teachers";
  setActiveSidebarButton("management-staff-service");
  document.getElementById("moduleTitle").textContent = "Staff Profile";

  document.getElementById("cards").innerHTML = `
    <div class="card stats-card metric-emphasis">
      <h4>Staff Hub</h4>
      <p>Teachers • Support Staff</p>
    </div>
    <div class="card stats-card">
      <h4>Registration</h4>
      <p>HoI fills profile, presses Register</p>
    </div>
    <div class="card stats-card">
      <h4>Postal Codes</h4>
      <p>Kenya town helper dropdown</p>
    </div>
  `;

  const categories = [
    { key: "management-teachers", label: "Teacher Profile" },
    { key: "management-non-teaching", label: "Support Staff Profile" }
  ];

  document.getElementById("formArea").innerHTML = `
    <div class="module-header-card">
      <h3>Staff Profile</h3>
      <p class="small-note">
        HoI/Administrator registers teacher and support staff portal users here. Use <strong>Register</strong> after entering contact channels so SMS/email instructions can be dispatched automatically where configured.
      </p>
    </div>
    <div class="form-grid staff-hub-category-grid">
      <label>Category</label>
      <select id="staffHubCategorySelect">
        ${categories.map((c) => `<option value="${escapeHtmlAttribute(c.key)}">${escapeHtml(c.label)}</option>`).join("")}
      </select>
    </div>
    <div id="staffHubMount"></div>
  `;

  const mount = document.getElementById("staffHubMount");
  const catSelect = document.getElementById("staffHubCategorySelect");

  const mountCategory = (key) => {
    currentEditId = null;
    document.getElementById("tableHead").innerHTML = "";
    document.getElementById("tableBody").innerHTML = "";
    currentModule = key;
    if (!mount || !moduleConfigs[key]) return;
    renderCrudModule(key, { container: mount, preserveCards: true });
    setTimeout(() => {
      attachPostalCodeTownHelper(mount);
      const actions = mount.querySelector(".actions-row");
      if (actions && !mount.querySelector("#staffHubRegisterPortalButton")) {
        const regBtn = document.createElement("button");
        regBtn.id = "staffHubRegisterPortalButton";
        regBtn.type = "button";
        regBtn.className = "success";
        regBtn.textContent = "Register";
        actions.insertBefore(regBtn, actions.firstChild);
        regBtn.onclick = async () => {
          const role = STAFF_HUB_ROLE_BY_MODULE[key];
          const fullInput = mount.querySelector("#field-full_name");
          const emailInput = mount.querySelector("#field-email_address");
          const phoneInput = mount.querySelector("#field-phone_number");
          const full_name = fullInput?.value?.trim();
          const email = emailInput?.value?.trim() || "";
          const phone = phoneInput?.value?.trim() || "";
          if (!full_name) {
            alert("Full name is required before registering a portal user.");
            return;
          }
          if (!email && !phone) {
            alert("Provide at least an email or mobile number for login instructions.");
            return;
          }
          const username = email
            ? email.split("@")[0].replace(/[^a-z0-9]+/gi, "").slice(0, 40)
            : phone.replace(/\D/g, "").slice(-10);
          if (!username) {
            alert("Could not derive username from email/phone.");
            return;
          }
          try {
            const result = await request("/api/management/staff-portal-account", {
              method: "POST",
              body: JSON.stringify({ full_name, username, email: email || null, phone: phone || null, role })
            });
            alert(result.message || "Registration notification sent.");
          } catch (error) {
            alert(error.message);
          }
        };
      }
    }, 0);
  };

  catSelect?.addEventListener("change", () => mountCategory(catSelect.value));
  const initialCategory = [ "management-teachers", "management-non-teaching" ].includes(String(options?.staffCategory || ""))
    ? String(options.staffCategory)
    : String(catSelect?.value || "management-teachers");
  if (catSelect) catSelect.value = initialCategory;
  mountCategory(initialCategory);
}

async function renderTeacherTimetableHub(mount) {
  if (!mount) return;
  mount.innerHTML = `
    <div class="module-header-card">
      <h3>Teacher Timetable</h3>
      <p class="small-note">
        Select a teacher, enter term/grade/learning area and number of lessons. Optionally pin specific lessons to fixed times; the scheduler fills the rest avoiding clashes, distributing across Mon–Fri.
      </p>
    </div>
    <div class="form-grid">
      <label>Timetable Category</label>
      <select id="ttCategory">
        <option>Normal Lesson</option>
        <option>Remedial</option>
        <option>Other</option>
      </select>
      <label>Teacher Profile ID</label>
      <input id="ttTeacherId" type="number" placeholder="Numeric teacher_profile id (see Teacher Profile list)" />
      <label>Teacher Name</label>
      <input id="ttTeacherName" placeholder="Teacher name" />
      <label>Term</label>
      <select id="ttTerm">
        <option>Term One</option>
        <option>Term Two</option>
        <option>Term Three</option>
      </select>
      <label>Grade / Form</label>
      <input id="ttGrade" placeholder="e.g. Grade 7 or Form 3" />
      <label>Stream</label>
      <input id="ttStream" placeholder="Optional (e.g. Blue)" />
      <label>Learning Area</label>
      <input id="ttLearningArea" placeholder="e.g. Mathematics" />
      <label>Lessons per Week</label>
      <input id="ttLessons" type="number" min="1" max="40" value="5" />
      <label>Default Lesson Start</label>
      <input id="ttStart" type="time" value="08:00" />
      <label>Default Lesson End</label>
      <input id="ttEnd" type="time" value="08:40" />
      <label>Pin specific lessons?</label>
      <select id="ttManualToggle">
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    </div>
    <div id="ttManualSection" hidden class="dashboard-section">
      <h4>Pinned lessons</h4>
      <p class="small-note">Use <strong>+ Add pinned lesson</strong>. Each pin sets a fixed day and start time.</p>
      <div id="ttManualRows"></div>
      <button type="button" id="ttAddManual">+ Add pinned lesson</button>
    </div>
    <div class="actions-row">
      <button id="ttGenerateButton" class="success">Process &amp; Generate Timetable</button>
      <button id="ttReloadButton">View / Refresh</button>
    </div>
    <div id="ttResultHolder"></div>
  `;

  const manualRows = mount.querySelector("#ttManualRows");
  const addManualRow = () => {
    const idx = manualRows.children.length;
    const row = document.createElement("div");
    row.className = "form-grid";
    row.innerHTML = `
      <label>Pinned #${idx + 1} Day</label>
      <select class="tt-manual-day">
        ${["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((d) => `<option>${d}</option>`).join("")}
      </select>
      <label>Start</label>
      <input type="time" class="tt-manual-start" value="08:00" />
      <label>End</label>
      <input type="time" class="tt-manual-end" value="08:40" />
    `;
    manualRows.appendChild(row);
  };
  mount.querySelector("#ttAddManual").onclick = addManualRow;
  mount.querySelector("#ttManualToggle").onchange = (ev) => {
    mount.querySelector("#ttManualSection").hidden = ev.target.value !== "yes";
  };

  const refreshList = async () => {
    const teacherId = Number(mount.querySelector("#ttTeacherId").value || 0);
    try {
      const qs = teacherId ? `?teacher_profile_id=${teacherId}` : "";
      const data = await request(`/api/staff/teacher-timetable${qs}`);
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const holder = mount.querySelector("#ttResultHolder");
      if (!rows.length) {
        holder.innerHTML = `<p class="small-note">No timetable rows yet.</p>`;
        return;
      }
      holder.innerHTML = `
        <div class="dashboard-section">
          <h4>Generated timetable (${rows.length} lesson${rows.length === 1 ? "" : "s"})</h4>
          <table>
            <thead><tr>
              <th>Day</th><th>Start</th><th>End</th><th>Grade</th><th>Learning Area</th><th>Category</th><th>Term</th><th>Actions</th>
            </tr></thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td>${escapeHtml(r.day_of_week || "-")}</td>
                  <td>${escapeHtml(String(r.start_time || "-").slice(0,5))}</td>
                  <td>${escapeHtml(String(r.end_time || "-").slice(0,5))}</td>
                  <td>${escapeHtml(r.grade || "-")}</td>
                  <td>${escapeHtml(r.learning_area || "-")}</td>
                  <td>${escapeHtml(r.timetable_category || "-")}</td>
                  <td>${escapeHtml(r.term || "-")}</td>
                  <td>
                    <button class="iim-action-btn delete" data-tt-delete="${Number(r.id || 0)}">🗑 Delete</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
      holder.querySelectorAll("[data-tt-delete]").forEach((btn) => {
        btn.onclick = async () => {
          const id = Number(btn.getAttribute("data-tt-delete") || 0);
          if (!id) return;
          if (!window.confirm("Remove this lesson?")) return;
          try {
            await request(`/api/staff/teacher-timetable/${id}`, { method: "DELETE" });
            await refreshList();
          } catch (err) { alert(err.message); }
        };
      });
    } catch (err) {
      mount.querySelector("#ttResultHolder").innerHTML = `<p class="small-note error">${escapeHtml(err.message || "Failed to load timetable.")}</p>`;
    }
  };

  mount.querySelector("#ttReloadButton").onclick = refreshList;
  mount.querySelector("#ttGenerateButton").onclick = async () => {
    const tId = Number(mount.querySelector("#ttTeacherId").value || 0);
    if (!tId) { alert("Teacher profile id is required. Check the Teacher Profile list for the numeric id."); return; }
    const manual = [...mount.querySelectorAll("#ttManualRows > div")].map((row) => ({
      day: row.querySelector(".tt-manual-day")?.value || "Monday",
      start_time: row.querySelector(".tt-manual-start")?.value || null,
      end_time: row.querySelector(".tt-manual-end")?.value || null
    }));
    const entry = {
      teacher_profile_id: tId,
      teacher_name: mount.querySelector("#ttTeacherName").value || null,
      timetable_category: mount.querySelector("#ttCategory").value || "Normal Lesson",
      term: mount.querySelector("#ttTerm").value || null,
      grade: mount.querySelector("#ttGrade").value || null,
      stream: mount.querySelector("#ttStream").value || null,
      learning_area: mount.querySelector("#ttLearningArea").value || null,
      lessons_per_week: Number(mount.querySelector("#ttLessons").value || 1),
      start_time: mount.querySelector("#ttStart").value || "08:00",
      end_time: mount.querySelector("#ttEnd").value || "08:40",
      manual_lessons: manual
    };
    try {
      const result = await request("/api/staff/teacher-timetable/generate", {
        method: "POST",
        body: JSON.stringify({ entries: [entry] })
      });
      alert(result.message || "Timetable generated.");
      await refreshList();
    } catch (err) {
      alert(err.message || "Failed to generate.");
    }
  };

  refreshList().catch(() => {});
}

async function renderLearnerDisciplineHub(mount) {
  if (!mount) return;
  mount.innerHTML = `<div class="module-header-card"><h3>Learners Disciplinary Record</h3></div><div id="disciplineForm"></div><div id="disciplineList"></div>`;
  let data = { categories: [], rows: [] };
  try { data = await request("/api/staff/learner-discipline"); } catch (_) {}
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const rows = Array.isArray(data.rows) ? data.rows : [];
  mount.querySelector("#disciplineForm").innerHTML = `
    <div class="form-grid">
      <label>Learner Name</label>
      <input id="dcName" placeholder="Full name" />
      <label>Learner ID (optional)</label>
      <input id="dcLearnerId" type="number" placeholder="learners.id" />
      <label>Grade</label>
      <input id="dcGrade" placeholder="e.g. Grade 7" />
      <label>Stream</label>
      <input id="dcStream" placeholder="Optional" />
      <label>Category</label>
      <select id="dcCategory">${categories.map((c) => `<option>${escapeHtml(c)}</option>`).join("")}</select>
      <label>Custom Breach (only if "Other/Breach of rules")</label>
      <input id="dcCustom" placeholder="Type the specific breach" />
      <label>Occurred At</label>
      <input id="dcOccurred" type="datetime-local" />
      <label>Others Involved</label>
      <input id="dcOthers" placeholder="Names, separated by commas" />
      <label>Action Taken</label>
      <textarea id="dcAction" rows="3" placeholder="Corrective measures / warnings issued"></textarea>
    </div>
    <div class="actions-row">
      <button id="dcSave" class="success">Save Record</button>
      <button id="dcReload">Refresh</button>
    </div>
  `;
  const refresh = async () => renderLearnerDisciplineHub(mount);
  mount.querySelector("#dcReload").onclick = refresh;
  mount.querySelector("#dcSave").onclick = async () => {
    const payload = {
      learner_name: mount.querySelector("#dcName").value || null,
      learner_id: Number(mount.querySelector("#dcLearnerId").value || 0) || null,
      grade: mount.querySelector("#dcGrade").value || null,
      stream: mount.querySelector("#dcStream").value || null,
      category: mount.querySelector("#dcCategory").value || "Breach of school rules",
      custom_breach: mount.querySelector("#dcCustom").value || null,
      occurred_at: mount.querySelector("#dcOccurred").value || null,
      other_persons_involved: mount.querySelector("#dcOthers").value || null,
      action_taken: mount.querySelector("#dcAction").value || null
    };
    if (!payload.learner_name) { alert("Learner name is required."); return; }
    try {
      await request("/api/staff/learner-discipline", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await refresh();
    } catch (err) { alert(err.message); }
  };
  const list = mount.querySelector("#disciplineList");
  if (!rows.length) {
    list.innerHTML = `<p class="small-note">No discipline records yet.</p>`;
  } else {
    list.innerHTML = `
      <div class="dashboard-section">
        <h4>Recorded indiscipline cases (${rows.length})</h4>
        <table>
          <thead><tr><th>Learner</th><th>Grade</th><th>Stream</th><th>Category</th><th>Occurred</th><th>Action</th><th>Actions</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${escapeHtml(r.resolved_learner_name || r.learner_name || "-")}</td>
                <td>${escapeHtml(r.grade || "-")}</td>
                <td>${escapeHtml(r.stream || "-")}</td>
                <td>${escapeHtml(r.category || "-")}${r.custom_breach ? " / " + escapeHtml(r.custom_breach) : ""}</td>
                <td>${escapeHtml(r.occurred_at ? String(r.occurred_at).slice(0,16).replace("T"," ") : "-")}</td>
                <td>${escapeHtml(r.action_taken || "-")}</td>
                <td><button class="iim-action-btn delete" data-dc-delete="${Number(r.id || 0)}">🗑 Delete</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    list.querySelectorAll("[data-dc-delete]").forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.getAttribute("data-dc-delete") || 0);
        if (!id) return;
        if (!window.confirm("Remove this record?")) return;
        try { await request(`/api/staff/learner-discipline/${id}`, { method: "DELETE" }); await refresh(); } catch (err) { alert(err.message); }
      };
    });
  }
}

function normalizeStatusLabel(value) {
  return Number(value) === 1 || String(value).toLowerCase() === "active" ? "Active" : "Inactive";
}

function buildSearchScopeSection(title, headers, rows) {
  return `
    <section class="dashboard-section search-scope-table">
      <h4>${escapeHtml(title)}</h4>
      ${buildDashboardTable(headers, rows)}
    </section>
  `;
}

function renderSearchActionButtons(scope, row = {}) {
  const rowId = Number(row?.id || 0);
  if (!rowId) return "-";
  const safeScope = escapeHtmlAttribute(scope);
  return `
    <div class="iim-actions-row search-inline-actions">
      <button class="iim-action-btn" title="View" onclick="handleSearchRowAction('${safeScope}', ${rowId}, 'view')">👁 View</button>
      <button class="iim-action-btn" title="Edit" onclick="handleSearchRowAction('${safeScope}', ${rowId}, 'edit')">✎ Edit</button>
      <button class="iim-action-btn success" title="Save" onclick="handleSearchRowAction('${safeScope}', ${rowId}, 'save')">💾 Save</button>
      <button class="iim-action-btn warn" title="Download PDF" onclick="handleSearchRowAction('${safeScope}', ${rowId}, 'pdf')">📄 PDF</button>
      <button class="iim-action-btn muted" title="Print" onclick="handleSearchRowAction('${safeScope}', ${rowId}, 'print')">🖨 Print</button>
      <button class="iim-action-btn delete" title="Delete" onclick="handleSearchRowAction('${safeScope}', ${rowId}, 'delete')">🗑 Delete</button>
    </div>
  `;
}

function buildIimsActionsRow(buttons = []) {
  const html = buttons
    .filter(Boolean)
    .map((btn) => {
      const cls = ["iim-action-btn", btn.className || ""].filter(Boolean).join(" ");
      const onclick = btn.onclick ? ` onclick="${btn.onclick}"` : "";
      const id = btn.id ? ` id="${escapeHtmlAttribute(btn.id)}"` : "";
      const title = ` title="${escapeHtmlAttribute(btn.title || btn.label || "")}"`;
      return `<button${id} class="${cls}"${title}${onclick}>${btn.label}</button>`;
    })
    .join("");
  return `<div class="iim-actions-row">${html}</div>`;
}

const SEARCH_SCOPE_UPDATE_CONFIG = {
  learners: { endpoint: "/api/admission/learners" },
  teachers: { endpoint: "/api/management/teachers" },
  users: { endpoint: "/api/users" },
  institutions: { endpoint: "/api/institutions" }
};

window.handleSearchRowAction = async (scope, rowId, action) => {
  const numericId = Number(rowId || 0);
  if (!numericId) {
    alert("Invalid record id.");
    return;
  }
  const scopeKey = String(scope || "").toLowerCase();
  try {
    if (action === "view") {
      alert(`View ${scopeKey} record #${numericId}`);
      return;
    }
    if (action === "edit") {
      const value = prompt("Quick edit: enter a display name/full name value", "");
      if (value === null) return;
      const config = SEARCH_SCOPE_UPDATE_CONFIG[scopeKey];
      if (!config) {
        alert("Edit is not supported for this scope.");
        return;
      }
      const body = scopeKey === "institutions"
        ? { institution_name: value }
        : { full_name: value };
      await request(`${config.endpoint}/${numericId}`, {
        method: "PUT",
        body: JSON.stringify(body)
      });
      alert("Record updated.");
      return;
    }
    if (action === "save") {
      alert("Save completed.");
      return;
    }
    if (action === "pdf") {
      const endpointByScope = {
        learners: "/api/admission/learners/export/pdf",
        teachers: "/api/management/teachers/export/pdf",
        institutions: "/api/system/registry/export/pdf",
        users: "/api/system/registry/export/pdf",
        parents: "/api/admission/learners/export/pdf",
        bom: "/api/users/export/pdf"
      };
      const exportUrl = endpointByScope[scopeKey];
      if (exportUrl) {
        window.open(exportUrl, "_blank");
      } else {
        alert("PDF export is not configured for this scope.");
      }
      return;
    }
    if (action === "print") {
      window.print();
      return;
    }
    if (action === "delete") {
      const ok = await confirmSoftDeletePrompts();
      if (!ok) return;
      const config = SEARCH_SCOPE_UPDATE_CONFIG[scopeKey];
      if (!config) {
        alert("Delete is not supported for this scope.");
        return;
      }
      await request(`${config.endpoint}/${numericId}`, { method: "DELETE" });
      alert("Record deleted.");
      return;
    }
  } catch (error) {
    alert(error.message || "Action failed.");
  }
};

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

async function globalSearch() {
  setActiveSidebarButton(null);
  currentModule = "search";
  stopDashboardAutoRefresh();
  const q = document.getElementById("globalSearch").value.trim();
  try {
    const scopeElValue = String(document.getElementById("searchScope")?.value || "all");
    const gradeFilterValue = String(document.getElementById("searchGradeFilter")?.value || "");
    const classFormFilterValue = String(document.getElementById("searchClassFormFilter")?.value || "");
    const streamFilterValue = String(document.getElementById("searchStreamFilter")?.value || "");
    const nameFilterValue = String(document.getElementById("searchNameFilter")?.value || "");
    const detailsFilterValue = String(document.getElementById("searchDetailsFilter")?.value || "");
    const params = new URLSearchParams({
      q,
      target: scopeElValue,
      grade: gradeFilterValue,
      class_form: classFormFilterValue,
      stream: streamFilterValue,
      learner_status: "",
      teacher_category: "",
      limit: "200"
    });
    const result = await request(`/api/search/global?${params.toString()}`);
    document.getElementById("moduleTitle").textContent = `SEARCH RESULTS: ${q || "ALL"}`;
    const summaryDescription =
      isSystemDeveloperRole(portalContext?.role)
        ? "Cross-portal search intelligence view."
        : "Search intelligence view for your institution.";
    const gradeOptions = Array.isArray(meta?.gradeOptions) ? meta.gradeOptions : [];
    const formOptions = Array.isArray(meta?.formOptions) ? meta.formOptions : [];
    const classOrFormOptions = Array.from(new Set([...gradeOptions, ...formOptions].filter(Boolean)));
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card">
        <h4>Learners Found</h4>
        <p>${formatNumber(result.learners?.length || 0)}</p>
      </div>
      <div class="card stats-card">
        <h4>Teachers Found</h4>
        <p>${formatNumber(result.teachers?.length || 0)}</p>
      </div>
      <div class="card stats-card metric-emphasis">
        <h4>Parents/BOM Found</h4>
        <p>${formatNumber(result.parentsAndBom?.length || 0)}</p>
      </div>
    `;
    const showInstitutionUserScope = isSystemDeveloperRole(portalContext?.role);
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Global Search Intelligence</h3>
        <p>${escapeHtml(summaryDescription)}</p>
      </div>
      <div class="search-summary-card">
        <h3>Search Result Summary</h3>
        <div class="pill-row summary-counts">
          <span class="status-pill">Learners: ${result.learners.length}</span>
          <span class="status-pill">Teachers: ${result.teachers.length}</span>
          <span class="status-pill">Parents/BOM: ${result.parentsAndBom.length}</span>
        </div>
      </div>
      <div class="dashboard-section search-filter-card">
        <h4>Filter Search Results</h4>
        <div class="search-filter-grid">
          <div>
            <label for="searchScope">Scope</label>
            <select id="searchScope">
              <option value="all">All</option>
              <option value="learners">Learners</option>
              <option value="grade">Grade</option>
              <option value="stream">Stream</option>
              <option value="teachers">Teachers</option>
              <option value="parents">Parents/Guardians</option>
              <option value="bom">BoM Members</option>
              ${showInstitutionUserScope ? '<option value="institutions">Institutions</option>' : ""}
              ${showInstitutionUserScope ? '<option value="users">Users</option>' : ""}
            </select>
          </div>
          <div id="searchGradeFilterWrap">
            <label for="searchGradeFilter">Grade</label>
            <select id="searchGradeFilter">
              <option value="">All Grades/Forms</option>
              ${classOrFormOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}
            </select>
          </div>
          <div id="searchClassFormFilterWrap">
            <label for="searchClassFormFilter">Class/Form</label>
            <select id="searchClassFormFilter">
              <option value="">All Classes/Forms</option>
              ${classOrFormOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}
            </select>
          </div>
          <div id="searchStreamFilterWrap">
            <label for="searchStreamFilter">Stream</label>
            <input id="searchStreamFilter" placeholder="e.g. Blue" />
          </div>
          <div>
            <label for="searchNameFilter">Name</label>
            <input id="searchNameFilter" placeholder="Search by name" />
          </div>
          <div>
            <label for="searchDetailsFilter">Grade/Form/TSC/ID No</label>
            <input id="searchDetailsFilter" placeholder="Grade, Form, TSC No, ID No, Admission No" />
          </div>
        </div>
        <div class="actions-row">
          <button id="applySearchFiltersButton">Apply Filters</button>
          <button id="clearSearchFiltersButton">Clear Filters</button>
        </div>
      </div>
      <div id="searchResultsPanels" class="search-results-panels"></div>
    `;
    const byNameAsc = (rows = []) =>
      [...rows].sort((a, b) => {
        const aKey = String(
          a.full_name || a.parent_full_name || a.institution_name || a.username || a.learner_name || ""
        ).toLowerCase();
        const bKey = String(
          b.full_name || b.parent_full_name || b.institution_name || b.username || b.learner_name || ""
        ).toLowerCase();
        return aKey.localeCompare(bKey);
      });
    const learnersData = byNameAsc(Array.isArray(result.learners) ? result.learners : []);
    const teachersData = byNameAsc(Array.isArray(result.teachers) ? result.teachers : []);
    const parentsData = byNameAsc(Array.isArray(result.parents) ? result.parents : []);
    const bomData = byNameAsc(Array.isArray(result.bom) ? result.bom : []);
    const institutionsData = byNameAsc(Array.isArray(result.institutions) ? result.institutions : []);
    const usersData = byNameAsc(Array.isArray(result.users) ? result.users : []);
    resetDataTable("Search results are shown above in separate scope tables.");

    const toggleScopedFilters = () => {
      const scope = (document.getElementById("searchScope")?.value || "all").toLowerCase();
      const gradeWrap = document.getElementById("searchGradeFilterWrap");
      const classFormWrap = document.getElementById("searchClassFormFilterWrap");
      const streamWrap = document.getElementById("searchStreamFilterWrap");
      if (gradeWrap) {
        gradeWrap.style.display = scope === "grade" ? "block" : "none";
      }
      if (classFormWrap) {
        classFormWrap.style.display = scope === "stream" ? "block" : "none";
      }
      if (streamWrap) {
        streamWrap.style.display = scope === "stream" ? "block" : "none";
      }
    };

    const applyFilters = () => {
      const scope = (document.getElementById("searchScope")?.value || "all").toLowerCase();
      const gradeFilter = (document.getElementById("searchGradeFilter")?.value || "").trim().toLowerCase();
      const classFormFilter = (document.getElementById("searchClassFormFilter")?.value || "").trim().toLowerCase();
      const streamFilter = (document.getElementById("searchStreamFilter")?.value || "").trim().toLowerCase();
      const nameFilter = normalizeSearchText(document.getElementById("searchNameFilter")?.value || "");
      const detailsFilter = normalizeSearchText(document.getElementById("searchDetailsFilter")?.value || "");
      const learnersFiltered = learnersData.filter((row) => {
        const rowGrade = String(row.grade || "").toLowerCase();
        const rowForm = String(row.form_name || "").toLowerCase();
        const rowStream = String(row.stream || "").toLowerCase();
        const rowName = normalizeSearchText(row.full_name || "");
        const rowNumbers = normalizeSearchText(
          [row.admission_number, row.upi_number, row.assessment_number, row.birth_certificate_number, row.id_number].join(" ")
        );
        if (gradeFilter && !rowGrade.includes(gradeFilter) && !rowForm.includes(gradeFilter)) return false;
        if (classFormFilter && !rowGrade.includes(classFormFilter) && !rowForm.includes(classFormFilter)) return false;
        if (streamFilter && !rowStream.includes(streamFilter)) return false;
        if (nameFilter && !rowName.includes(nameFilter)) return false;
        if (detailsFilter && !`${rowGrade} ${rowForm} ${rowStream} ${rowNumbers}`.includes(detailsFilter)) return false;
        return true;
      });
      const teachersFiltered = teachersData.filter((row) => {
        const rowName = normalizeSearchText(row.full_name || "");
        const rowDetails = normalizeSearchText(
          [row.grade, row.form_name, row.stream, row.tsc_number, row.id_number, row.category].join(" ")
        );
        if (nameFilter && !rowName.includes(nameFilter)) return false;
        if (detailsFilter && !rowDetails.includes(detailsFilter)) return false;
        return true;
      });
      const parentsFiltered = parentsData.filter((row) => {
        const rowGrade = String(row.grade || "").toLowerCase();
        const rowForm = String(row.form_name || "").toLowerCase();
        const rowStream = String(row.stream || "").toLowerCase();
        const rowName = normalizeSearchText(row.parent_full_name || row.full_name || "");
        const rowDetails = normalizeSearchText(
          [row.grade, row.form_name, row.stream, row.parent_phone, row.parent_email].join(" ")
        );
        if (gradeFilter && !rowGrade.includes(gradeFilter) && !rowForm.includes(gradeFilter)) return false;
        if (classFormFilter && !rowGrade.includes(classFormFilter) && !rowForm.includes(classFormFilter)) return false;
        if (streamFilter && !rowStream.includes(streamFilter)) return false;
        if (nameFilter && !rowName.includes(nameFilter)) return false;
        if (detailsFilter && !rowDetails.includes(detailsFilter)) return false;
        return true;
      });
      const bomFiltered = bomData.filter((row) => {
        const rowName = normalizeSearchText(row.full_name || "");
        const rowDetails = normalizeSearchText([row.role, row.id_number, row.phone, row.email].join(" "));
        if (nameFilter && !rowName.includes(nameFilter)) return false;
        if (detailsFilter && !rowDetails.includes(detailsFilter)) return false;
        return true;
      });
      const institutionsFiltered = institutionsData.filter((row) => {
        const rowName = normalizeSearchText(row.institution_name || "");
        const rowDetails = normalizeSearchText([row.institution_code, row.county, row.category].join(" "));
        if (nameFilter && !rowName.includes(nameFilter)) return false;
        if (detailsFilter && !rowDetails.includes(detailsFilter)) return false;
        return true;
      });
      const usersFiltered = usersData.filter((row) => {
        const rowName = normalizeSearchText(row.full_name || row.username || "");
        const rowDetails = normalizeSearchText([row.role, row.id_number, row.tsc_number, row.institution_id].join(" "));
        if (nameFilter && !rowName.includes(nameFilter)) return false;
        if (detailsFilter && !rowDetails.includes(detailsFilter)) return false;
        return true;
      });
      const scopedRows =
        scope === "learners"
          ? learnersFiltered
          : scope === "grade"
            ? learnersFiltered
            : scope === "stream"
              ? learnersFiltered
              : scope === "teachers"
                ? teachersFiltered
                : scope === "parents"
                  ? parentsFiltered
                  : scope === "bom"
                    ? bomFiltered
                    : scope === "institutions"
                      ? institutionsFiltered
                      : scope === "users"
                        ? usersFiltered
                        : [
                            ...learnersFiltered,
                            ...teachersFiltered,
                            ...parentsFiltered,
                            ...bomFiltered,
                            ...institutionsFiltered,
                            ...usersFiltered
                          ];
      const searchPanels = document.getElementById("searchResultsPanels");
      if (!searchPanels) return;
      window.__latestSearchScopeRows = {
        learners: learnersFiltered,
        teachers: teachersFiltered,
        parents: parentsFiltered,
        bom: bomFiltered,
        institutions: institutionsFiltered,
        users: usersFiltered
      };
      const sections = [];
      if (scope === "all" || scope === "learners") {
        sections.push(buildSearchScopeSection(
          "Learners",
          ["Learner Name", "Adm No", "Grade/Form", "Stream", "Status", "Parent/Guardian", "Actions"],
          learnersFiltered.map((row) => [
            row.full_name || "-",
            row.admission_number || "-",
            row.grade || row.form_name || "-",
            row.stream || "-",
            row.status || "-",
            row.parent_full_name || "-",
            renderSearchActionButtons("learners", row)
          ])
        ));
      }
      if (scope === "grade") {
        sections.push(buildSearchScopeSection(
          `Learners By Grade${gradeFilter ? ` (${gradeFilterValue})` : ""}`,
          ["Learner Name", "Adm No", "Grade/Form", "Stream", "Status", "Actions"],
          learnersFiltered.map((row) => [
            row.full_name || "-",
            row.admission_number || "-",
            row.grade || row.form_name || "-",
            row.stream || "-",
            row.status || "-",
            renderSearchActionButtons("learners", row)
          ])
        ));
      }
      if (scope === "stream") {
        sections.push(buildSearchScopeSection(
          "Learners By Stream",
          ["Learner Name", "Adm No", "Class/Form", "Stream", "Status", "Actions"],
          learnersFiltered.map((row) => [
            row.full_name || "-",
            row.admission_number || "-",
            row.grade || row.form_name || "-",
            row.stream || "-",
            row.status || "-",
            renderSearchActionButtons("learners", row)
          ])
        ));
      }
      if (scope === "all" || scope === "teachers") {
        sections.push(buildSearchScopeSection(
          "Teachers",
          ["Teacher Name", "TSC/ID", "Learning Area", "Category", "Contact", "Status", "Actions"],
          teachersFiltered.map((row) => [
            row.full_name || "-",
            row.tsc_number || row.id_number || "-",
            row.major_subject || row.other_subject || "-",
            row.category || row.employment_status || "-",
            row.phone_number || row.phone || "-",
            row.status || row.accountability_status || "-",
            renderSearchActionButtons("teachers", row)
          ])
        ));
      }
      if (scope === "all" || scope === "parents") {
        sections.push(buildSearchScopeSection(
          "Parents/Guardians",
          ["Parent/Guardian", "Phone", "Email", "Learner", "Grade/Form", "Stream", "Actions"],
          parentsFiltered.map((row) => [
            row.parent_full_name || "-",
            row.parent_phone || "-",
            row.parent_email || "-",
            row.full_name || "-",
            row.grade || row.form_name || "-",
            row.stream || "-",
            renderSearchActionButtons("parents", row)
          ])
        ));
      }
      if (scope === "all" || scope === "bom") {
        sections.push(buildSearchScopeSection(
          "BoM Members",
          ["Name", "Username", "Role", "Phone", "Email", "Status", "Actions"],
          bomFiltered.map((row) => [
            row.full_name || "-",
            row.username || "-",
            formatRoleDisplay(row.role || ""),
            row.phone || "-",
            row.email || "-",
            normalizeStatusLabel(row.is_active),
            renderSearchActionButtons("bom", row)
          ])
        ));
      }
      if (showInstitutionUserScope && (scope === "all" || scope === "institutions")) {
        sections.push(buildSearchScopeSection(
          "Institutions",
          ["Institution Name", "Code", "County", "Category", "Email", "Phone", "Status", "Actions"],
          institutionsFiltered.map((row) => [
            row.institution_name || "-",
            row.institution_code || "-",
            row.county || "-",
            row.category || "-",
            row.email || "-",
            row.phone || "-",
            normalizeStatusLabel(row.is_active),
            renderSearchActionButtons("institutions", row)
          ])
        ));
      }
      if (showInstitutionUserScope && (scope === "all" || scope === "users")) {
        sections.push(buildSearchScopeSection(
          "Users",
          ["Full Name", "Username", "Role", "Institution ID", "Email", "Phone", "Status", "Actions"],
          usersFiltered.map((row) => [
            row.full_name || "-",
            row.username || "-",
            formatRoleDisplay(row.role || ""),
            row.institution_id || "-",
            row.email || "-",
            row.phone || "-",
            normalizeStatusLabel(row.is_active),
            renderSearchActionButtons("users", row)
          ])
        ));
      }
      if (!showInstitutionUserScope && (scope === "institutions" || scope === "users")) {
        sections.push('<section class="dashboard-section search-scope-table"><h4>Access Denied</h4><p class="small-note">Institutions and Users search scopes are available to the System Developer only.</p></section>');
      }
      searchPanels.innerHTML = sections.length
        ? sections.join("")
        : '<section class="dashboard-section search-scope-table"><h4>No Results</h4><p class="small-note">No records match your selected filters.</p></section>';
      if (!scopedRows.length) {
        resetDataTable("No records match your selected filters.");
      }
    };

    const scopeEl = document.getElementById("searchScope");
    if (scopeEl) {
      scopeEl.value = scopeElValue || "all";
      scopeEl.addEventListener("change", toggleScopedFilters);
    }
    const gradeFilterEl = document.getElementById("searchGradeFilter");
    if (gradeFilterEl) gradeFilterEl.value = gradeFilterValue;
    const classFormFilterEl = document.getElementById("searchClassFormFilter");
    if (classFormFilterEl) classFormFilterEl.value = classFormFilterValue;
    const streamFilterEl = document.getElementById("searchStreamFilter");
    if (streamFilterEl) streamFilterEl.value = streamFilterValue;
    const nameFilterEl = document.getElementById("searchNameFilter");
    if (nameFilterEl) nameFilterEl.value = nameFilterValue;
    const detailsFilterEl = document.getElementById("searchDetailsFilter");
    if (detailsFilterEl) detailsFilterEl.value = detailsFilterValue;
    toggleScopedFilters();

    document.getElementById("applySearchFiltersButton")?.addEventListener("click", applyFilters);
    document.getElementById("clearSearchFiltersButton")?.addEventListener("click", () => {
      ["searchGradeFilter", "searchClassFormFilter", "searchStreamFilter", "searchNameFilter", "searchDetailsFilter"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      const scopeEl = document.getElementById("searchScope");
      if (scopeEl) scopeEl.value = "all";
      resetDataTable("Search results are shown above in separate scope tables.");
      toggleScopedFilters();
      applyFilters();
    });
    applyFilters();
  } catch (error) {
    alert(error.message);
  }
}

async function changeCredentials() {
  try {
    const profile = await request("/api/profile");
    renderProfileCenter(profile || {});
  } catch (error) {
    alert(error.message);
  }
}

function renderPasswordPolicyBanner(user = {}, portal = {}) {
  const formArea = document.getElementById("formArea");
  const banner = document.getElementById("passwordExpiryNotice");
  if (banner) {
    banner.textContent = "";
    banner.className = "small-note";
  }
  if (!formArea) return;
  if (user.role === "SYSTEM_DEVELOPER") return;

  const expiresAt = user.password_expires_at;
  let daysRemaining = Number(user.password_days_remaining ?? NaN);
  if (Number.isNaN(daysRemaining) && expiresAt) {
    const expiryDate = new Date(expiresAt);
    if (!Number.isNaN(expiryDate.getTime())) {
      const diffMs = expiryDate.getTime() - Date.now();
      daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }
  }
  if (!Number.isFinite(daysRemaining)) return;

  const severity =
    daysRemaining <= 3 ? "error" : daysRemaining <= 10 ? "warning" : "info";
  const message =
    daysRemaining <= 0
      ? "Your password has expired. Change it immediately."
      : `Password policy notice: ${daysRemaining} day(s) remaining before password expiry.`;
  if (banner) {
    banner.textContent = message;
    banner.className = `small-note ${severity}`;
  }
  if (daysRemaining <= 0 && currentModule !== "profile" && !window.__iimsPasswordExpiryRedirected) {
    window.__iimsPasswordExpiryRedirected = true;
    setTimeout(() => {
      changeCredentials();
    }, 150);
  }
}

function attendanceHubThreeStepConfirm() {
  if (!window.confirm("Delete this attendance record?")) return false;
  if (!window.confirm("Confirm deletion again?")) return false;
  if (!window.confirm("Final confirmation: proceed with delete?")) return false;
  return true;
}

function normalizeAttendanceTypeForApi(rawType = "") {
  const normalized = String(rawType || "").trim().toLowerCase();
  if (normalized === "teacher") return "Teacher";
  if (normalized === "support staff" || normalized === "support_staff") return "Support Staff";
  return "Learner";
}

async function renderAttendanceManagementHub(options = {}) {
  stopDashboardAutoRefresh();
  currentModule = "attendance";
  currentEditId = null;
  setActiveSidebarButton("attendance");
  document.getElementById("moduleTitle").textContent = "Attendance Management";
  const tableAreaMain = document.querySelector(".main-content .table-area");
  if (tableAreaMain) tableAreaMain.style.display = "none";

  document.getElementById("cards").innerHTML = `
    <div class="card stats-card metric-emphasis"><h4>Attendance Workflow</h4><p>Teacher, Support Staff, Learner</p></div>
    <div class="card stats-card"><h4>Capture Chain</h4><p>Select person -> date -> status -> time in/out -> comment</p></div>
    <div class="card stats-card"><h4>Registers</h4><p>Daily and period exports (PDF / Excel / Word)</p></div>
  `;

  document.getElementById("formArea").innerHTML = `
    <div class="form-grid">
      <label>Attendance Type</label>
      <select id="attendanceHubType">
        <option value="">Select type</option>
        <option value="Teacher">Teacher</option>
        <option value="Support Staff">Support Staff</option>
        <option value="Learner">Learner</option>
      </select>
      <label>Date</label>
      <input id="attendanceHubDate" type="date" />
      <label>Grade/Form (Learner)</label>
      <input id="attendanceHubGrade" placeholder="Grade/Form" />
      <label>Stream (Learner optional)</label>
      <input id="attendanceHubStream" placeholder="Stream" />
      <label>Status</label>
      <select id="attendanceHubStatus">
        <option value="">Select status</option>
        <option value="Present">Present</option>
        <option value="Absent">Absent</option>
        <option value="Absent with apology">Absent with apology</option>
        <option value="Absent without apology">Absent without apology</option>
        <option value="Official Duty">Official Duty</option>
        <option value="Leave">Leave</option>
        <option value="Transferred">Transferred</option>
        <option value="Suspended">Suspended</option>
        <option value="Interdicted">Interdicted</option>
        <option value="Dismissed">Dismissed</option>
        <option value="Others">Others</option>
      </select>
      <label>Time In</label>
      <input id="attendanceHubTimeIn" type="datetime-local" />
      <label>Time Out</label>
      <input id="attendanceHubTimeOut" type="datetime-local" />
      <label>Comment</label>
      <textarea id="attendanceHubComment" rows="2" placeholder="Comment"></textarea>
    </div>
    <div class="actions-row">
      <button id="attendanceHubLoadPeople" class="ax-btn ax-btn--view ax-btn--sm">Load People</button>
      <button id="attendanceHubSave" class="ax-btn ax-btn--save ax-btn--sm">Save Attendance</button>
      <button id="attendanceHubRefresh" class="ax-btn ax-btn--refresh ax-btn--sm">Refresh Register</button>
    </div>
    <div id="attendanceHubPeople" class="dashboard-table-wrap"></div>
    <section class="dashboard-section">
      <h4>Attendance Register</h4>
      <div class="form-grid">
        <label>Type</label>
        <select id="attendanceRegisterType">
          <option value="">All</option>
          <option value="Teacher">Teacher</option>
          <option value="Support Staff">Support Staff</option>
          <option value="Learner">Learner</option>
        </select>
        <label>From</label>
        <input id="attendanceRegisterFrom" type="date" />
        <label>To</label>
        <input id="attendanceRegisterTo" type="date" />
      </div>
      <div class="actions-row">
        <button id="attendanceRegisterPdf" class="ax-btn ax-btn--download ax-btn--sm">PDF</button>
        <button id="attendanceRegisterExcel" class="ax-btn ax-btn--download ax-btn--sm">Excel</button>
        <button id="attendanceRegisterWord" class="ax-btn ax-btn--download ax-btn--sm">Word</button>
        <button id="attendanceRegisterPrint" class="ax-btn ax-btn--print ax-btn--sm">Print</button>
      </div>
      <div id="attendanceRegisterTable" class="dashboard-table-wrap"></div>
    </section>
  `;
  const initialAttendanceType = String(options?.attendanceType || "");
  const attendanceTypeEl = document.getElementById("attendanceHubType");
  const attendanceRegisterTypeEl = document.getElementById("attendanceRegisterType");
  if (["Teacher", "Support Staff", "Learner"].includes(initialAttendanceType)) {
    if (attendanceTypeEl) attendanceTypeEl.value = initialAttendanceType;
    if (attendanceRegisterTypeEl) attendanceRegisterTypeEl.value = initialAttendanceType;
  }

  const state = { people: [], selected: new Set(), learnerStatus: new Map() };
  const peopleHost = document.getElementById("attendanceHubPeople");

  const renderPeople = () => {
    if (!state.people.length) {
      peopleHost.innerHTML = '<p class="small-note">No people loaded yet.</p>';
      return;
    }
    const type = normalizeAttendanceTypeForApi(document.getElementById("attendanceHubType")?.value || "");
    const rows = state.people.map((row) => {
      const id = Number(row.id || 0);
      const learnerStatus = state.learnerStatus.get(id) || "";
      return [
        `<input type="checkbox" class="att-person-check" data-id="${id}" ${state.selected.has(id) ? "checked" : ""} />`,
        row.person_name || "-",
        row.tsc_number || row.staff_number || row.admission_number || "-",
        row.grade || "-",
        row.stream || "-",
        type === "Learner"
          ? `<select class="att-learner-status" data-id="${id}">
              <option value="">Select</option>
              <option value="Present" ${learnerStatus === "Present" ? "selected" : ""}>Present</option>
              <option value="Absent" ${learnerStatus === "Absent" ? "selected" : ""}>Absent</option>
            </select>`
          : "-"
      ];
    });
    peopleHost.innerHTML = buildDashboardTable(
      ["Select", "Name", "Reference", "Grade", "Stream", "Learner Status"],
      rows
    );
    peopleHost.querySelectorAll(".att-person-check").forEach((el) => {
      el.addEventListener("change", () => {
        const id = Number(el.getAttribute("data-id") || 0);
        if (!id) return;
        if (el.checked) state.selected.add(id);
        else state.selected.delete(id);
      });
    });
    peopleHost.querySelectorAll(".att-learner-status").forEach((el) => {
      el.addEventListener("change", () => {
        const id = Number(el.getAttribute("data-id") || 0);
        if (!id) return;
        state.learnerStatus.set(id, el.value || "");
      });
    });
  };

  const buildRegisterParams = () => {
    const params = new URLSearchParams();
    const type = document.getElementById("attendanceRegisterType")?.value || "";
    const fromDate = document.getElementById("attendanceRegisterFrom")?.value || "";
    const toDate = document.getElementById("attendanceRegisterTo")?.value || "";
    if (type) params.set("type", type);
    if (fromDate) params.set("from_date", fromDate);
    if (toDate) params.set("to_date", toDate);
    return params;
  };

  const refreshRegister = async () => {
    const params = buildRegisterParams();
    const data = await request(`/api/attendance/register?${params.toString()}`);
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    document.getElementById("attendanceRegisterTable").innerHTML = buildDashboardTable(
      ["Date", "Type", "Name", "Status", "Time In", "Time Out", "Comment", "Action"],
      rows.map((row) => [
        formatDateTime(row.attendance_date),
        row.attendance_type || "-",
        row.person_name || "-",
        row.status || "-",
        formatDateTime(row.time_in),
        formatDateTime(row.time_out),
        row.comments || "-",
        `<button class="ax-btn ax-btn--delete ax-btn--sm" data-att-del="${Number(row.id || 0)}">Delete</button>`
      ])
    );
    document.querySelectorAll("[data-att-del]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = Number(button.getAttribute("data-att-del") || 0);
        if (!id || !attendanceHubThreeStepConfirm()) return;
        await request(`/api/attendance/records/${id}`, { method: "DELETE" });
        await refreshRegister();
      });
    });
  };

  document.getElementById("attendanceHubLoadPeople")?.addEventListener("click", async () => {
    try {
      const type = normalizeAttendanceTypeForApi(document.getElementById("attendanceHubType")?.value || "");
      if (!type) {
        alert("Select attendance type first.");
        return;
      }
      const params = new URLSearchParams();
      params.set("type", type);
      if (type === "Learner") {
        params.set("grade", document.getElementById("attendanceHubGrade")?.value || "");
        params.set("stream", document.getElementById("attendanceHubStream")?.value || "");
      }
      const data = await request(`/api/attendance/participants?${params.toString()}`);
      state.people = Array.isArray(data?.rows) ? data.rows : [];
      state.selected = new Set();
      state.learnerStatus = new Map();
      renderPeople();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("attendanceHubSave")?.addEventListener("click", async () => {
    try {
      const type = normalizeAttendanceTypeForApi(document.getElementById("attendanceHubType")?.value || "");
      const dateValue = document.getElementById("attendanceHubDate")?.value || "";
      const statusValue = document.getElementById("attendanceHubStatus")?.value || "";
      const timeInValue = document.getElementById("attendanceHubTimeIn")?.value || "";
      const timeOutValue = document.getElementById("attendanceHubTimeOut")?.value || "";
      const commentValue = document.getElementById("attendanceHubComment")?.value || "";
      const gradeValue = document.getElementById("attendanceHubGrade")?.value || "";
      const streamValue = document.getElementById("attendanceHubStream")?.value || "";
      const selectedPeople = state.people.filter((row) => state.selected.has(Number(row.id || 0)));
      if (!type || !dateValue || !selectedPeople.length) {
        alert("Select type, date and at least one participant.");
        return;
      }
      if (type === "Learner") {
        for (const row of selectedPeople) {
          const learnerStatus = state.learnerStatus.get(Number(row.id || 0));
          if (!learnerStatus) continue;
          // eslint-disable-next-line no-await-in-loop
          await request("/api/attendance/records", {
            method: "POST",
            body: JSON.stringify({
              attendance_type: "Learner",
              person_id: String(row.id || ""),
              person_name: row.person_name || row.full_name || "-",
              grade: row.grade || gradeValue || null,
              stream: row.stream || streamValue || null,
              attendance_date: `${dateValue}T08:00`,
              status: learnerStatus,
              comments: commentValue || null
            })
          });
        }
      } else {
        if (!statusValue || !timeInValue) {
          alert("Status and Time In are required for teacher/support attendance.");
          return;
        }
        for (const row of selectedPeople) {
          // eslint-disable-next-line no-await-in-loop
          await request("/api/attendance/records", {
            method: "POST",
            body: JSON.stringify({
              attendance_type: type,
              person_id: String(row.id || ""),
              person_name: row.person_name || row.full_name || "-",
              grade: null,
              stream: null,
              attendance_date: `${dateValue}T08:00`,
              time_in: timeInValue || null,
              time_out: timeOutValue || null,
              status: statusValue,
              reason: statusValue.toLowerCase().startsWith("absent") ? statusValue : null,
              comments: commentValue || null
            })
          });
        }
      }
      alert("Attendance saved.");
      await refreshRegister();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("attendanceHubRefresh")?.addEventListener("click", async () => {
    try {
      await refreshRegister();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById("attendanceRegisterPdf")?.addEventListener("click", async () => {
    const params = buildRegisterParams();
    await downloadWithAuth(`/api/attendance/register/export/pdf?${params.toString()}`, "attendance-register.pdf");
  });
  document.getElementById("attendanceRegisterExcel")?.addEventListener("click", async () => {
    const params = buildRegisterParams();
    await downloadWithAuth(`/api/attendance/register/export/excel?${params.toString()}`, "attendance-register.xlsx");
  });
  document.getElementById("attendanceRegisterWord")?.addEventListener("click", async () => {
    const params = buildRegisterParams();
    await downloadWithAuth(`/api/attendance/register/export/word?${params.toString()}`, "attendance-register.doc");
  });
  document.getElementById("attendanceRegisterPrint")?.addEventListener("click", () => {
    const hostHtml = document.getElementById("attendanceRegisterTable")?.innerHTML || "<p>No attendance rows.</p>";
    const popup = window.open("", "_blank");
    if (!popup) return;
    popup.document.write(`<html><head><title>Attendance Register</title></head><body>${hostHtml}</body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  });

  await refreshRegister();
  if (["Teacher", "Support Staff", "Learner"].includes(initialAttendanceType)) {
    const today = new Date().toISOString().slice(0, 10);
    const dateEl = document.getElementById("attendanceHubDate");
    if (dateEl && !dateEl.value) dateEl.value = today;
  }
}

async function openModule(targetModule, options = {}) {
  if (!targetModule || !isSidebarModuleAllowed(targetModule)) return;
  currentModule = targetModule;
  currentEditId = null;
  if (targetModule === "dashboard") return loadDashboard();
  if (targetModule === "system-register") return renderSystemRegistration(options);
  if (targetModule === "system-access-control") return renderModuleRights();
  if (targetModule === "system-audit") return renderSecurityAudit();
  if (targetModule === "system-ops-center") return renderSystemOpsCenter();
  if (targetModule === "system-incident-response") return renderSystemIncidentResponse();
  if (targetModule === "system-registry") return renderInstitutionsRegistry();
  if (targetModule === "system-institution-edit") return renderInstitutionEditModule();
  if (targetModule === "system-institution-uploads") return renderInstitutionUploadsModule();
  if (targetModule === "system-recycle-bin") return renderRecycleBin();
  if (targetModule === "system-cbc-editor") return renderCbcCurriculumEditor(options);
  if (targetModule === "management-staff-service") return renderStaffServiceHub(options);
  if (targetModule === "attendance") return renderAttendanceManagementHub(options);
  if (targetModule === "parents-results") return loadParentOrBomResults();
  if (targetModule === "learner-materials") return loadLearnerMaterials();
  if (targetModule === "hr-institutional-letters") return renderInstitutionalLettersHub();
  if (targetModule === "finance-fee-status") return renderFeeStatusHub();
  if (targetModule === "institutional-registers") return renderInstitutionalRegistersHub();
  if (moduleConfigs[targetModule]) return renderCrudModule(targetModule, options);
  return null;
}

function collapseSidebarSubmoduleLists(exceptParentModule = "") {
  document.querySelectorAll(".sidebar-submodule-list[data-parent-module]").forEach((list) => {
    const parent = String(list.dataset.parentModule || "");
    if (!exceptParentModule || parent !== exceptParentModule) {
      list.hidden = true;
    }
  });
}

function bindSidebar() {
  document.querySelectorAll(".sidebar-submodule-list[data-parent-module]").forEach((node) => node.remove());
  document.querySelectorAll(".sidebar button[data-module]").forEach((button) => {
    const moduleId = String(button.dataset.module || "");
    if ((moduleId === "system-institution-edit" || moduleId === "system-institution-uploads") && !isSuperSystemDeveloperPortal()) {
      button.style.display = "none";
      return;
    }
    if (!isSidebarModuleAllowed(moduleId)) {
      button.style.display = "none";
      return;
    }
    button.style.display = "";
    const submodules = sidebarSubmodulesFor(moduleId).filter(
      (item) => isSidebarModuleAllowed(item.targetModule) && isSidebarSubmoduleAllowed(item)
    );
    if (submodules.length) {
      const list = document.createElement("div");
      list.className = "sidebar-submodule-list";
      list.dataset.parentModule = moduleId;
      list.hidden = true;
      list.innerHTML = submodules
        .map(
          (item) => `<button type="button" class="sidebar-submodule-btn" data-submodule-id="${escapeHtmlAttribute(item.id)}" data-target-module="${escapeHtmlAttribute(item.targetModule)}">
            ${escapeHtml(item.label)}
          </button>`
        )
        .join("");
      button.insertAdjacentElement("afterend", list);
      list.querySelectorAll(".sidebar-submodule-btn[data-submodule-id]").forEach((subBtn) => {
        subBtn.onclick = async (event) => {
          event.stopPropagation();
          const submoduleId = String(subBtn.dataset.submoduleId || "");
          const selected = submodules.find((item) => item.id === submoduleId);
          if (!selected) return;
          currentSidebarSubmoduleId = selected.id;
          collapseSidebarSubmoduleLists(moduleId);
          list.hidden = false;
          setActiveSidebarButton(moduleId);
          await openModule(selected.targetModule, selected.options || {});
        };
      });
    }
    button.onclick = async () => {
      if (submodules.length) {
        const list = document.querySelector(`.sidebar-submodule-list[data-parent-module="${moduleId}"]`);
        const nextHidden = Boolean(list?.hidden);
        collapseSidebarSubmoduleLists(nextHidden ? moduleId : "");
        if (list) list.hidden = !nextHidden ? true : false;
        currentSidebarSubmoduleId = null;
        setActiveSidebarButton(moduleId);
        const moduleTitleEl = document.getElementById("moduleTitle");
        if (moduleTitleEl) moduleTitleEl.textContent = `${toLabel(moduleId)} - Select Sub-Module`;
        const cardsEl = document.getElementById("cards");
        if (cardsEl) cardsEl.innerHTML = "";
        const formArea = document.getElementById("formArea");
        if (formArea) {
          formArea.innerHTML = `
            <div class="module-header-card">
              <h3>${escapeHtml(toLabel(moduleId))}</h3>
              <p>Select one sub-module below. Only the selected sub-module details will be shown.</p>
            </div>
            <div class="actions-row">
              ${submodules.map((item) => `<button type="button" data-inline-submodule-id="${escapeHtmlAttribute(item.id)}">${escapeHtml(item.label)}</button>`).join("")}
            </div>
          `;
          formArea.querySelectorAll("button[data-inline-submodule-id]").forEach((inlineButton) => {
            inlineButton.addEventListener("click", async () => {
              const targetSubmoduleId = String(inlineButton.getAttribute("data-inline-submodule-id") || "");
              const selected = submodules.find((item) => item.id === targetSubmoduleId);
              if (!selected) return;
              currentSidebarSubmoduleId = selected.id;
              await openModule(selected.targetModule, selected.options || {});
            });
          });
          applyCompactIconButtons(formArea);
        }
        resetDataTable("Select a sub-module to continue.");
        return;
      }
      collapseSidebarSubmoduleLists("");
      currentSidebarSubmoduleId = null;
      await openModule(moduleId);
    };
  });
}

function renderSidebarInstitutionBranding() {
  const mount = document.getElementById("sidebarInstitutionBrandingMount");
  if (!mount) return;
  const allowed = ["SUPER_SYSTEM_DEVELOPER", "SYSTEM_DEVELOPER", "SYSTEM_ADMINISTRATOR", "ADMIN", "HEAD_OF_INSTITUTION"]
    .includes(String(portalContext?.role || "").toUpperCase());
  if (!allowed) {
    mount.innerHTML = "";
    return;
  }
  mount.className = "sidebar-branding-mount";
  mount.innerHTML = `
    <h4>Institution Letterhead Slot</h4>
    <p class="small-note">Upload/update letterhead used in correspondence.</p>
    <input id="sidebarLetterheadPathInput" placeholder="/uploads/letterhead.png" />
    <div class="actions-row">
      <label class="ax-btn ax-btn--upload ax-btn--sm" for="sidebarLetterheadFileInput">Upload</label>
      <input id="sidebarLetterheadFileInput" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" hidden />
      <button id="sidebarLetterheadSaveButton" type="button" class="ax-btn ax-btn--save ax-btn--sm">Save</button>
    </div>
  `;
  const pathInput = document.getElementById("sidebarLetterheadPathInput");
  const fileInput = document.getElementById("sidebarLetterheadFileInput");
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file || !pathInput) return;
    try {
      const uploaded = await uploadFileWithAuth(file);
      pathInput.value = uploaded?.filePath || "";
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("sidebarLetterheadSaveButton")?.addEventListener("click", async () => {
    try {
      const letterheadPath = String(pathInput?.value || "").trim();
      if (!letterheadPath) {
        alert("Upload a letterhead file first.");
        return;
      }
      await request("/api/institutions/letterhead", {
        method: "PATCH",
        body: JSON.stringify({ letterhead_file_path: letterheadPath })
      });
      alert("Institution letterhead saved.");
    } catch (error) {
      alert(error.message);
    }
  });
  applyCompactIconButtons(mount);
}

async function initDashboardAssistant() {
  const panel = document.getElementById("dashboardAiAssistant");
  const messagesEl = document.getElementById("assistantMessages");
  const inputEl = document.getElementById("assistantInput");
  const sendBtn = document.getElementById("assistantSendButton");
  const toggleBtn = document.getElementById("assistantToggleButton");
  if (!panel || !messagesEl || !inputEl || !sendBtn || !toggleBtn) return;
  panel.setAttribute("data-collapsed", panel.getAttribute("data-collapsed") === "1" ? "1" : "0");
  toggleBtn.textContent = panel.getAttribute("data-collapsed") === "1" ? "Open" : "Hide";
  const append = (role, message) => {
    const item = document.createElement("div");
    item.className = `assistant-msg ${role}`;
    item.textContent = message;
    messagesEl.appendChild(item);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };
  const submit = async () => {
    const prompt = String(inputEl.value || "").trim();
    if (!prompt) return;
    append("user", prompt);
    append("ai", "Checking system modules...");
    const pendingNode = messagesEl.lastElementChild;
    inputEl.value = "";
    try {
      const response = await request("/api/dashboard/assistant", {
        method: "POST",
        body: JSON.stringify({ prompt })
      });
      if (pendingNode) pendingNode.textContent = String(response?.answer || "No assistant response.");
    } catch (error) {
      if (pendingNode) {
        pendingNode.textContent =
          "I cannot answer right now. For complex questions consult System Developer / Institution System Administrator.";
      }
    }
  };
  sendBtn.addEventListener("click", () => {
    submit();
  });
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });
  toggleBtn.addEventListener("click", () => {
    const collapsed = panel.getAttribute("data-collapsed") === "1";
    const nextState = collapsed ? "0" : "1";
    panel.setAttribute("data-collapsed", nextState);
    toggleBtn.textContent = collapsed ? "Hide" : "Open";
  });
  messagesEl.innerHTML = "";
  append("ai", "Ask where to find modules/sub-modules. Complex issues are escalated to your system developer/admin.");
}

function bindTopbarButtons() {
  document.getElementById("searchButton").addEventListener("click", globalSearch);
  document.getElementById("logoutButton").addEventListener("click", async () => {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } catch (_) {
      // Continue local logout even when audit endpoint fails.
    } finally {
      localStorage.clear();
      window.location.href = "/";
    }
  });
  document
    .getElementById("changeCredentialsButton")
    .addEventListener("click", async () => {
      try {
        const profile = await request("/api/profile");
        renderProfileCenter(profile || {});
      } catch (error) {
        alert(error.message);
      }
    });
  const heroButton = document.getElementById("updateHeroImageButton");
  const heroInput = document.getElementById("heroImageInput");
  const canManageHeroImage = ["SUPER_SYSTEM_DEVELOPER", "SYSTEM_DEVELOPER", "SYSTEM_ADMINISTRATOR", "ADMIN", "HEAD_OF_INSTITUTION"].includes(
    String(portalContext?.role || "")
  );
  if (heroButton && heroInput) {
    if (!canManageHeroImage) {
      heroButton.style.display = "none";
      heroInput.disabled = true;
      return;
    }
    heroButton.addEventListener("click", () => {
      heroInput.click();
    });
    heroInput.addEventListener("change", async () => {
      const file = heroInput.files?.[0];
      if (!file) return;
      const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
      if (!allowedTypes.includes(file.type)) {
        alert("Unsupported image format. Use JPEG, PNG, WEBP, GIF, or AVIF.");
        heroInput.value = "";
        return;
      }
      try {
        const result = await uploadHeroImage(file);
        alert(result.message || "Login hero image updated.");
      } catch (error) {
        alert(error.message);
      } finally {
        heroInput.value = "";
      }
    });
  }
  applyCompactIconButtons(document.querySelector(".topbar-right"));
}

function renderProfileCenter(profile) {
  currentModule = "profile";
  stopDashboardAutoRefresh();
  currentSidebarSubmoduleId = null;
  setActiveSidebarButton(null);
  const photoSrc = String(
    profile?.photo_url || profile?.profile_photo_url || profile?.avatar_url || profile?.photo || ""
  ).trim();
  const profileInitial = String(profile?.full_name || "U").trim().charAt(0).toUpperCase() || "U";
  const roleLabel = formatDashboardRoleLabel(profile?.role || "");
  const institutionScopeOptions = Array.isArray(portalContext?.institution_scope_options)
    ? portalContext.institution_scope_options
    : [];
  const showInstitutionSwitch = String(profile?.role || "").toUpperCase() === "SYSTEM_DEVELOPER" && institutionScopeOptions.length > 1;
  document.getElementById("moduleTitle").textContent = "Profile";
  document.getElementById("cards").innerHTML = `
    <div class="card stats-card metric-emphasis">
      <h4>Profile Center</h4>
      <p>Manage your account securely</p>
    </div>
    <div class="card stats-card">
      <h4>Institution</h4>
      <p>${escapeHtml(profile?.institution_name || "-")}</p>
    </div>
    <div class="card stats-card">
      <h4>Role</h4>
      <p>${escapeHtml(roleLabel || "-")}</p>
    </div>
  `;
  document.getElementById("formArea").innerHTML = `
    <div class="profile-center-grid">
      <div class="profile-card">
        <div class="profile-avatar-shell">
          ${
            photoSrc
              ? `<img src="${escapeHtmlAttribute(photoSrc)}" alt="Profile photo" class="profile-avatar-image" />`
              : `<div class="profile-avatar-fallback">${escapeHtml(profileInitial)}</div>`
          }
        </div>
        <h3>${escapeHtml(profile?.full_name || "-")}</h3>
        <p><strong>Email:</strong> ${escapeHtml(profile?.email || "-")}</p>
        <p><strong>Mobile:</strong> ${escapeHtml(profile?.phone || "-")}</p>
        <p><strong>Institution:</strong> ${escapeHtml(profile?.institution_name || "-")}</p>
        <p><strong>Role:</strong> ${escapeHtml(roleLabel || "-")}</p>
      </div>
      <div class="profile-edit-card">
        <h3>Update Contacts / Password</h3>
        <p class="small-note">Use OTP channel (Email/SMS) for verification where required.</p>
        <div class="form-grid">
          <label>OTP Channel (required when changing password)</label>
          <select id="profileOtpChannel">
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="both">Both (Email + SMS)</option>
          </select>
          <label>Previous Password</label>
          <input id="profileCurrentPassword" type="password" placeholder="Previous password" />
          <label>New Password</label>
          <input id="profileNewPassword" type="password" placeholder="New password" />
          <label>Confirm New Password</label>
          <input id="profileConfirmPassword" type="password" placeholder="Confirm new password" />
          <label>New Email</label>
          <input id="profileNewEmail" type="email" placeholder="Email" value="${escapeHtmlAttribute(profile?.email || "")}" />
          <label>New Mobile Number</label>
          <input id="profileNewPhone" placeholder="Mobile number" value="${escapeHtmlAttribute(profile?.phone || "")}" />
          <label>OTP Code</label>
          <input id="profileOtpCode" placeholder="Enter OTP when requested" />
        </div>
        <div class="actions-row">
          <button id="requestProfileOtpButton">Request OTP</button>
          <button id="saveProfileButton">Save Profile Updates</button>
        </div>
        ${
          showInstitutionSwitch
            ? `
        <hr />
        <h4>Institution Scope</h4>
        <p class="small-note">Switch to one of your assigned institutions.</p>
        <div class="form-grid">
          <label>Assigned Institution</label>
          <select id="profileInstitutionSwitch">
            ${institutionScopeOptions
              .map((row) => {
                const id = Number(row?.id || 0);
                const selected = Number(profile?.institution_id || 0) === id ? "selected" : "";
                const label = `${row?.institution_name || "Institution"} (${row?.institution_code || "-"})`;
                return `<option value="${id}" ${selected}>${escapeHtml(label)}</option>`;
              })
              .join("")}
          </select>
        </div>
        <div class="actions-row">
          <button id="profileSwitchInstitutionButton">Switch Institution</button>
        </div>`
            : ""
        }
      </div>
    </div>
  `;
  resetDataTable("Profile information is shown above.");
  document.getElementById("requestProfileOtpButton")?.addEventListener("click", async () => {
    try {
      const otpChannel = String(document.getElementById("profileOtpChannel")?.value || "email");
      const newPasswordValue = String(document.getElementById("profileNewPassword")?.value || "").trim();
      const passwordChange = Boolean(newPasswordValue);
      const result = await request("/api/profile/request-update-otp", {
        method: "POST",
        body: JSON.stringify({
          update_type: passwordChange ? "password_change" : "profile_update",
          otp_channel: otpChannel,
          password_change: passwordChange
        })
      });
      alert(result.message || "OTP requested.");
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("saveProfileButton")?.addEventListener("click", async () => {
    const currentPassword = String(document.getElementById("profileCurrentPassword")?.value || "");
    const newPassword = String(document.getElementById("profileNewPassword")?.value || "");
    const confirmPassword = String(document.getElementById("profileConfirmPassword")?.value || "");
    if (newPassword && newPassword !== confirmPassword) {
      alert("Password confirmation does not match.");
      return;
    }
    try {
      const result = await request("/api/profile/update", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword || null,
          new_password: newPassword || null,
          email: String(document.getElementById("profileNewEmail")?.value || "").trim() || null,
          phone: String(document.getElementById("profileNewPhone")?.value || "").trim() || null,
          otp_code: String(document.getElementById("profileOtpCode")?.value || "").trim() || null
        })
      });
      alert(result.message || "Profile updated successfully.");
      const refreshed = await request("/api/profile");
      renderProfileCenter(refreshed || profile);
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById("profileSwitchInstitutionButton")?.addEventListener("click", async () => {
    try {
      const nextInstitutionId = Number(document.getElementById("profileInstitutionSwitch")?.value || 0);
      if (!nextInstitutionId) {
        alert("Select an institution to switch.");
        return;
      }
      const result = await request("/api/portal/switch-institution", {
        method: "POST",
        body: JSON.stringify({ institution_id: nextInstitutionId })
      });
      if (result?.token) {
        token = result.token;
        localStorage.setItem("token", token);
      }
      alert(result?.message || "Institution switched.");
      await init();
    } catch (error) {
      alert(error.message);
    }
  });
}

function bindQuickActionCards() {
  document.querySelectorAll(".quick-action-card[data-module]").forEach((card) => {
    card.onclick = async () => {
      const targetModule = card.getAttribute("data-module");
      if (!targetModule || !isSidebarModuleAllowed(targetModule)) return;
      currentSidebarSubmoduleId = null;
      collapseSidebarSubmoduleLists("");
      await openModule(targetModule);
    };
  });
}

async function renderInstitutionalLettersHub() {
  stopDashboardAutoRefresh();
  currentModule = "hr-institutional-letters";
  document.getElementById("moduleTitle").textContent = "Institutional Letters";
  const container = document.getElementById("formArea");
  document.getElementById("cards").innerHTML = "";
  document.getElementById("tableHead").innerHTML = "";
  document.getElementById("tableBody").innerHTML = "";
  container.innerHTML = `
    <div class="module-header-card"><h3>Institutional Letters</h3><p class="small-note">HoI and System Developer generate and upload letters (appointment, promotion, suspension, warning, show-cause, dismissal, early retirement, job vacancies, shortlisting). Staff only see letters addressed to them.</p></div>
    <div class="form-grid">
      <label>Record Type</label>
      <select id="letterType">
        ${["Appointment Letter","Promotion Letter","Suspension Letter","Warning Letter","Show Cause Letter","Dismissal Letter","Early Retirement","Job Vacancy","Shortlisted Candidates","Successful Candidates","Past Advertisement","Other"].map((x)=>`<option>${escapeHtml(x)}</option>`).join("")}
      </select>
      <label>Target User ID</label>
      <input id="letterTargetUserId" type="number" placeholder="users.id (optional)" />
      <label>Target Staff Name</label>
      <input id="letterStaffName" placeholder="Recipient full name" />
      <label>Target Staff Category</label>
      <select id="letterStaffCategory">
        <option value="">(select)</option>
        <option>Teacher</option>
        <option>Support Staff</option>
        <option>Service Provider</option>
        <option>BoM Member</option>
      </select>
      <label>ID Number</label>
      <input id="letterIdNumber" />
      <label>Mobile</label>
      <input id="letterMobile" />
      <label>Email</label>
      <input id="letterEmail" />
      <label>Position</label>
      <input id="letterPosition" />
      <label>Terms of Service</label>
      <select id="letterTos">
        <option value="">(select)</option>
        <option>Permanent</option>
        <option>Temporary</option>
        <option>Contract</option>
        <option>Casual</option>
        <option>Other</option>
      </select>
      <label>Title / Subject</label>
      <input id="letterTitle" placeholder="Letter subject line" />
      <label>Description / Body</label>
      <textarea id="letterBody" rows="4" placeholder="Typed letter body or reference to uploaded file"></textarea>
      <label>File path (if uploaded)</label>
      <input id="letterFilePath" placeholder="/uploads/..." />
    </div>
    <div class="actions-row">
      <button id="letterSaveBtn" class="success">Generate &amp; Save</button>
      <button id="letterReloadBtn">Refresh</button>
    </div>
    <div id="letterList"></div>
  `;
  const refresh = async () => {
    try {
      const data = await request("/api/hr/institutional-letters");
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const list = document.getElementById("letterList");
      if (!rows.length) { list.innerHTML = `<p class="small-note">No letters on file.</p>`; return; }
      list.innerHTML = `
        <div class="dashboard-section">
          <h4>Letters (${rows.length})</h4>
          <table>
            <thead><tr><th>Type</th><th>Title</th><th>Recipient</th><th>Position</th><th>Terms</th><th>Status</th><th>Issued</th></tr></thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td>${escapeHtml(r.record_type || "-")}</td>
                  <td>${escapeHtml(r.title || "-")}</td>
                  <td>${escapeHtml(r.target_staff_name || "-")}</td>
                  <td>${escapeHtml(r.position_name || "-")}</td>
                  <td>${escapeHtml(r.terms_of_service || "-")}</td>
                  <td>${escapeHtml(r.status || "-")}</td>
                  <td>${escapeHtml(String(r.issued_at || r.created_at || "").slice(0,19).replace("T"," "))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>`;
    } catch (err) {
      document.getElementById("letterList").innerHTML = `<p class="small-note error">${escapeHtml(err.message || "Failed to load.")}</p>`;
    }
  };
  document.getElementById("letterReloadBtn").onclick = refresh;
  document.getElementById("letterSaveBtn").onclick = async () => {
    const body = {
      record_type: document.getElementById("letterType").value,
      title: document.getElementById("letterTitle").value,
      target_user_id: Number(document.getElementById("letterTargetUserId").value || 0) || null,
      target_staff_name: document.getElementById("letterStaffName").value,
      target_staff_category: document.getElementById("letterStaffCategory").value,
      target_id_number: document.getElementById("letterIdNumber").value,
      target_mobile: document.getElementById("letterMobile").value,
      target_email: document.getElementById("letterEmail").value,
      position_name: document.getElementById("letterPosition").value,
      terms_of_service: document.getElementById("letterTos").value,
      description: document.getElementById("letterBody").value,
      body_text: document.getElementById("letterBody").value,
      file_path: document.getElementById("letterFilePath").value
    };
    try {
      await request("/api/hr/institutional-letters", { method: "POST", body: JSON.stringify(body) });
      await refresh();
      alert("Letter saved.");
    } catch (err) { alert(err.message); }
  };
  refresh();
}

async function renderFeeStatusHub() {
  stopDashboardAutoRefresh();
  currentModule = "finance-fee-status";
  document.getElementById("moduleTitle").textContent = "Fee Status";
  const container = document.getElementById("formArea");
  document.getElementById("cards").innerHTML = "";
  container.innerHTML = `
    <div class="module-header-card"><h3>Fee Status</h3><p class="small-note">Required − Paid per learner. Filter by grade, stream, year.</p></div>
    <div class="form-grid">
      <label>Grade</label><input id="fsGrade" placeholder="e.g. Grade 7" />
      <label>Stream</label><input id="fsStream" placeholder="Optional" />
      <label>Year</label><input id="fsYear" type="number" value="${new Date().getFullYear()}" />
    </div>
    <div class="actions-row">
      <button id="fsLoadBtn" class="success">Load Fee Status</button>
    </div>
    <div id="fsResult"></div>
  `;
  document.getElementById("fsLoadBtn").onclick = async () => {
    const q = new URLSearchParams({
      grade: document.getElementById("fsGrade").value || "",
      stream: document.getElementById("fsStream").value || "",
      year: document.getElementById("fsYear").value || String(new Date().getFullYear())
    });
    try {
      const data = await request(`/api/finance/fee-status?${q.toString()}`);
      const list = Array.isArray(data?.balance) ? data.balance : [];
      const holder = document.getElementById("fsResult");
      if (!list.length) { holder.innerHTML = `<p class="small-note">No records matched.</p>`; return; }
      holder.innerHTML = `
        <div class="dashboard-section">
          <h4>Fee balance (${list.length} learners)</h4>
          <table>
            <thead><tr><th>#</th><th>Learner</th><th>Adm. No.</th><th>Grade</th><th>Stream</th><th>Required</th><th>Paid</th><th>Balance</th></tr></thead>
            <tbody>
              ${list.map((r, i) => `
                <tr>
                  <td>${i+1}</td>
                  <td>${escapeHtml(r.full_name || "-")}</td>
                  <td>${escapeHtml(r.admission_number || "-")}</td>
                  <td>${escapeHtml(r.grade || "-")}</td>
                  <td>${escapeHtml(r.stream || "-")}</td>
                  <td>${Number(r.required).toFixed(2)}</td>
                  <td>${Number(r.paid).toFixed(2)}</td>
                  <td style="color:${Number(r.balance) > 0 ? "#a02020" : "#1f7a3a"};font-weight:700">${Number(r.balance).toFixed(2)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>`;
    } catch (err) { document.getElementById("fsResult").innerHTML = `<p class="small-note error">${escapeHtml(err.message)}</p>`; }
  };
}

async function renderInstitutionalRegistersHub() {
  stopDashboardAutoRefresh();
  currentModule = "institutional-registers";
  document.getElementById("moduleTitle").textContent = "Registers & Records";
  const container = document.getElementById("formArea");
  document.getElementById("cards").innerHTML = "";
  document.getElementById("tableHead").innerHTML = "";
  document.getElementById("tableBody").innerHTML = "";
  let types = [];
  try {
    const resp = await request("/api/institutional-registers/types");
    types = Array.isArray(resp?.types) ? resp.types : [];
  } catch (_) {}
  container.innerHTML = `
    <div class="module-header-card"><h3>Registers &amp; Records</h3><p class="small-note">Select the register type FIRST, then upload the correct document for that register.</p></div>
    <div class="form-grid">
      <label>Register Type</label>
      <select id="regType">${types.map((t) => `<option>${escapeHtml(t)}</option>`).join("")}</select>
      <label>Title / Reference</label>
      <input id="regTitle" placeholder="Free-text label" />
      <label>File path (after upload)</label>
      <input id="regFilePath" placeholder="/uploads/..." />
      <label>File name</label>
      <input id="regFileName" placeholder="original filename.pdf" />
      <label>Description</label>
      <textarea id="regDesc" rows="2"></textarea>
    </div>
    <div class="actions-row">
      <button id="regSave" class="success">Upload Register Entry</button>
      <button id="regReload">Refresh</button>
    </div>
    <div id="regList"></div>
  `;
  const refresh = async () => {
    try {
      const data = await request("/api/institutional-registers");
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const list = document.getElementById("regList");
      if (!rows.length) { list.innerHTML = `<p class="small-note">No registers uploaded.</p>`; return; }
      list.innerHTML = `
        <div class="dashboard-section">
          <h4>Registers on file (${rows.length})</h4>
          <table>
            <thead><tr><th>Type</th><th>Title</th><th>File</th><th>Uploaded</th><th>Actions</th></tr></thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td>${escapeHtml(r.register_type || "-")}</td>
                  <td>${escapeHtml(r.title || "-")}</td>
                  <td>${r.file_path ? `<a target="_blank" href="${escapeHtmlAttribute(r.file_path)}">${escapeHtml(r.file_name || r.file_path)}</a>` : "-"}</td>
                  <td>${escapeHtml(String(r.created_at || "").slice(0,19).replace("T"," "))}</td>
                  <td><button class="iim-action-btn delete" data-reg-delete="${Number(r.id || 0)}">🗑 Delete</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>`;
      list.querySelectorAll("[data-reg-delete]").forEach((btn) => {
        btn.onclick = async () => {
          const id = Number(btn.getAttribute("data-reg-delete") || 0);
          if (!id || !window.confirm("Remove this register entry?")) return;
          try { await request(`/api/institutional-registers/${id}`, { method: "DELETE" }); await refresh(); } catch (err) { alert(err.message); }
        };
      });
    } catch (err) { document.getElementById("regList").innerHTML = `<p class="small-note error">${escapeHtml(err.message)}</p>`; }
  };
  document.getElementById("regReload").onclick = refresh;
  document.getElementById("regSave").onclick = async () => {
    const body = {
      register_type: document.getElementById("regType").value,
      title: document.getElementById("regTitle").value,
      description: document.getElementById("regDesc").value,
      file_path: document.getElementById("regFilePath").value,
      file_name: document.getElementById("regFileName").value
    };
    try {
      await request("/api/institutional-registers", { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (err) { alert(err.message); }
  };
  refresh();
}

function formatRoleDisplay(role) {
  const value = String(role || "").trim().toUpperCase();
  const map = {
    SYSTEM_DEVELOPER: "SYSTEM DEVELOPER",
    ADMIN: "HoI/Administrator",
    HEAD_OF_INSTITUTION: "HoI/Administrator",
    TEACHER: "Teacher",
    SENIOR_TEACHER: "Senior Teacher",
    HEAD_OF_DEPARTMENT: "Head of Department",
    BOM: "BoM Member",
    PARENT: "Parent/Guardian",
    NON_TEACHING_STAFF: "Support Staff",
    SUPPLIER: "Supplier",
    CONTRACTOR: "Contractor",
    MOD: "MoE",
    TSC: "TSC"
  };
  return map[value] || String(role || "-");
}

// Backward compatibility for older cached dashboard bundles.
function toRoleLabel(role) {
  return formatRoleDisplay(role);
}

async function safeStep(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.warn(`[dashboard:init] step "${label}" failed:`, error);
    return null;
  }
}

function showInitErrorBanner(message) {
  const fp = document.getElementById("dashUiFingerprint");
  if (fp) {
    fp.textContent = `${CLIENT_UI_BUNDLE_ID} · INIT WARNING: ${String(message).slice(0, 220)}`;
  }
  const cardsEl = document.getElementById("cards");
  if (cardsEl && !cardsEl.innerHTML.trim()) {
    cardsEl.innerHTML = `<div class="form-notice error">Some startup data did not load (check F12 console). Sidebar buttons should still work; click <strong>Dashboard</strong> to retry.</div>`;
  }
}

async function init() {
  meta = (await safeStep("/api/meta", () => request("/api/meta"))) || meta || {};
  const portalData = await safeStep("/api/portal/current", () => request("/api/portal/current"));
  portalContext = portalData || null;
  allowedModules = Array.isArray(portalData?.allowed_modules) ? portalData.allowed_modules : [];
  const meData = (await safeStep("/api/auth/me", () => request("/api/auth/me"))) || {};

  await safeStep("applyDashboardIdentity", async () => {
    try {
      applyDashboardIdentity(meData || {});
    } catch (identityError) {
      const portalLabelEl = document.getElementById("portalLabel");
      if (portalLabelEl) {
        const fallbackName = String(meData?.institution_name || "Institution").trim();
        portalLabelEl.textContent = `${fallbackName} (${String(meData?.role || "USER")})`;
      }
      throw identityError;
    }
  });

  const normalizedUiRole = String(portalData?.role || meData?.role || "").toUpperCase();
  if (["PARENT", "LEARNER", "BOM"].includes(normalizedUiRole)) {
    document.body.classList.add("read-only-portal");
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      if (e.ctrlKey && ["p", "s", "c"].includes(k)) e.preventDefault();
      if (k === "printscreen") e.preventDefault();
    });
  }

  await safeStep("build-info fingerprint", async () => {
    let stamp = "unknown";
    try {
      const buildRes = await fetch("/api/build-info", { cache: "no-store" });
      if (buildRes.ok) {
        const b = await buildRes.json();
        stamp = b?.build_stamp || stamp;
      }
    } catch (_) { /* ignore */ }
    const fp = document.getElementById("dashUiFingerprint");
    if (fp) {
      fp.textContent = `${CLIENT_UI_BUNDLE_ID} · API build_stamp: ${stamp} — Ctrl+F5 if this text looks old.`;
    }
  });

  const buildLineEl = document.getElementById("iimsBuildLineDash");
  if (buildLineEl) buildLineEl.textContent = "";

  // CRITICAL: bind sidebar/topbar BEFORE the dashboard cockpit fetch so module
  // navigation always works even if /api/dashboard/summary fails.
  await safeStep("bindSidebar", async () => bindSidebar());
  await safeStep("bindTopbarButtons", async () => bindTopbarButtons());
  await safeStep("bindQuickActionCards", async () => bindQuickActionCards());
  await safeStep("initDashboardAssistant", async () => initDashboardAssistant());

  const loaded = await safeStep("loadDashboard", () => loadDashboard());
  if (loaded === null) {
    showInitErrorBanner("dashboard summary failed");
  }

  await safeStep("renderPasswordPolicyBanner", async () =>
    renderPasswordPolicyBanner(meData, portalData)
  );
  if (meData?.must_change_password) {
    alert("Password policy notice: your password was reset and must be changed immediately.");
  }
  applyCompactIconButtons(document.getElementById("formArea"));
  applyTemplateVisibility(document.getElementById("formArea"));
}

window.editRow = editRow;
window.deleteRow = deleteRow;
window.dispatchCommunicationMessage = dispatchCommunicationMessage;
window.admissionRegisterView = admissionRegisterView;
window.admissionRegisterEdit = admissionRegisterEdit;
window.admissionRegisterSaveRow = admissionRegisterSaveRow;
window.admissionRegisterDelete = admissionRegisterDelete;
window.admissionParentGuardianView = admissionParentGuardianView;
window.admissionParentGuardianEdit = admissionParentGuardianEdit;
window.admissionParentGuardianSave = admissionParentGuardianSave;
window.admissionParentGuardianDelete = admissionParentGuardianDelete;
window.admissionParentGuardianPrint = admissionParentGuardianPrint;
window.admissionParentGuardianDownload = admissionParentGuardianDownload;
window.restoreCbcEntry = async (entryId) => {
  if (!entryId) return;
  try {
    const result = await request(`/api/system/recycle-bin/${entryId}/restore`, { method: "POST" });
    alert(result.message || "CBC entry restored.");
    await renderRecycleBin();
  } catch (error) {
    alert(error.message);
  }
};
window.deleteCbcEntryPermanently = async (entryId) => {
  if (!entryId) return;
  const ok = window.confirm("Permanently delete this recycled entry?");
  if (!ok) return;
  try {
    const result = await request(`/api/system/recycle-bin/${entryId}`, { method: "DELETE" });
    alert(result.message || "CBC entry permanently removed.");
    await renderRecycleBin();
  } catch (error) {
    alert(error.message);
  }
};
init();
