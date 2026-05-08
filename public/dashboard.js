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
const CLIENT_UI_BUNDLE_ID = "dash-bundle-main-v50-init-resilient";
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
  "system-registry": "institutions-users-registry",
  "system-recycle-bin": "recycle-bin",
  "system-cbc-editor": "cbc-curriculum-editor"
};

const MODULE_DESCRIPTIONS = {
  dashboard: "Real-time institution intelligence and activity overview.",
  admission: "Manage learner admissions, profiles, and onboarding records.",
  "management-teachers": "Maintain teacher profiles and professional details.",
  "management-non-teaching": "Manage support staff records and roles.",
  "management-staff-service":
    "Consolidated hub for teachers, support staff, BoM members, and service providers with registration workflows.",
  "management-service-providers": "Register service providers and companies supporting the institution.",
  "management-bom": "Maintain Board of Management member profiles and contact data.",
  "management-teacher-resources": "Organize lesson plans, schemes, and class resources.",
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
  "system-register": "Register institutions and users inside the system after sign-in (role-scoped).",
  "system-access-control": "Assign module rights and review role-based access permissions.",
  "system-audit": "Review security and login audit trails for accountability.",
  "system-registry": "Browse institutions and user registry details in one place.",
  "system-recycle-bin": "Restore or permanently purge archived deleted records.",
  "system-cbc-editor": "Create and maintain CBC curriculum structures and metadata."
};

function isSystemAdminRole() {
  const role = String(portalContext?.role || "");
  return ["SYSTEM_DEVELOPER", "ADMIN", "HEAD_OF_INSTITUTION"].includes(role);
}

function canOpenSecurityAuditModule() {
  const role = normalizeRoleKey(portalContext?.role || "");
  return role === "SYSTEM_DEVELOPER" || role === "HEAD_OF_INSTITUTION";
}

function isAllowedAccessControlAdministrator() {
  const role = normalizeRoleKey(portalContext?.role || "");
  return role === "SYSTEM_DEVELOPER" || role === "HEAD_OF_INSTITUTION";
}
function isSystemDeveloperRole(roleValue = "") {
  const normalized = String(roleValue || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  return ["SYSTEM_DEVELOPER", "SYSTEMDEVELOPER", "SYTEM_DEVELOPER"].includes(normalized);
}

function formatRoleLabel(role) {
  const normalized = String(role || "").toUpperCase();
  if (normalized === "SYSTEM_DEVELOPER") return "SYSTEM DEVELOPER";
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
  if (normalized === "SYSTEM_DEVELOPER") return "SYSTEM DEVELOPER";
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
  return ["SYSTEM_DEVELOPER", "ADMIN", "HEAD_OF_INSTITUTION"].includes(normalized);
}

function shouldHideInstitutionForIdentity(user = {}) {
  const normalizedRole = normalizeRoleKey(user?.role || "");
  return normalizedRole === "TSC" || normalizedRole === "MOD";
}

function friendlyRoleName(roleValue = "") {
  const normalized = normalizeRoleKey(roleValue);
  const map = {
    SYSTEM_DEVELOPER: "System Developer",
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
        const institutionName = prompt("Institution name", row.institution_name || "");
        if (institutionName === null) return;
        const email = prompt("Institution email", row.email || "");
        if (email === null) return;
        const phone = prompt("Institution phone", row.phone || "");
        if (phone === null) return;
        await request(`/api/system/registry/institutions/${rowId}`, {
          method: "PATCH",
          body: JSON.stringify({
            institution_name: institutionName,
            email,
            phone
          })
        });
        alert("Institution saved successfully.");
        await renderInstitutionsRegistry();
        return;
      }
      if (action === "suspend" || action === "deactivate") {
        const reason = prompt("Reason is required", "");
        if (!reason) {
          alert("Reason is required.");
          return;
        }
        const payload =
          action === "suspend"
            ? { is_suspended: true, reason }
            : { is_active: false, reason };
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
    if (action === "suspend" || action === "deactivate") {
      const reason = prompt("Reason is required", "");
      if (!reason) {
        alert("Reason is required.");
        return;
      }
      const payload =
        action === "suspend"
          ? { is_suspended: true, reason }
          : { is_active: false, reason };
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
  const welcomeTop = document.getElementById("dashboardWelcomeTop");
  const institutionId = Number(meData?.institution_id || portalContext?.institution_id || 0) || 0;
  if (welcomeTop) {
    const leftPane = welcomeTop.querySelector("div");
    if (leftPane) {
      let logoWrap = document.getElementById("dashboardInstitutionLogoWrap");
      if (!logoWrap) {
        logoWrap = document.createElement("div");
        logoWrap.id = "dashboardInstitutionLogoWrap";
        logoWrap.className = "dashboard-welcome-logo-wrap";
        logoWrap.innerHTML = '<img id="dashboardInstitutionLogo" class="dashboard-welcome-logo" alt="Institution logo" />';
        leftPane.prepend(logoWrap);
      }
      const logoImg = document.getElementById("dashboardInstitutionLogo");
      if (logoWrap && logoImg && institutionId > 0) {
        request(`/api/public/branding/hero-image?institution_id=${institutionId}`)
          .then((branding) => {
            const heroUrl = String(branding?.hero_image_url || "");
            if (!heroUrl) {
              logoWrap.style.display = "none";
              return;
            }
            logoImg.src = heroUrl;
            logoWrap.style.display = "flex";
          })
          .catch(() => {
            logoWrap.style.display = "none";
          });
      } else if (logoWrap) {
        logoWrap.style.display = "none";
      }
    }
  }
}

async function renderSystemRegistration() {
  setActiveSidebarButton("system-register");
  document.getElementById("moduleTitle").textContent = "Register (Institution/User)";
  if (!isSystemAdminRole()) {
    alert("Only System Developer, HoI/Administrator can access registration center.");
    return loadDashboard();
  }
  try {
    const [options, users] = await Promise.all([
      request("/api/users/registrar-options"),
      request("/api/users")
    ]);
    const institutionRows = Array.isArray(options?.institutions) ? options.institutions : [];
    const userRows = Array.isArray(users) ? users : [];
    const roleOptions = Array.isArray(options?.assignable_roles) ? options.assignable_roles : [];
    const canRegisterInstitution = Boolean(options?.can_register_institution);
    const canManageAllInstitutions = Boolean(options?.can_manage_all_institutions);
    const canRegisterUsers = Boolean(options?.can_register_users);
    const registrationMeta = options?.registration_meta || null;
    const defaultInstitutionId =
      Number(options?.institution_scope_id || 0) ||
      Number(portalContext?.institution_id || 0) ||
      Number(institutionRows[0]?.id || 0) ||
      0;
    const defaultInstitution =
      institutionRows.find((item) => Number(item.id) === defaultInstitutionId) ||
      institutionRows[0] ||
      null;
    const defaultRole = roleOptions[0] || "";
    const canSelectInstitutionForUser = canManageAllInstitutions;
    let latestInstitutionId = Number(defaultInstitution?.id || 0) || null;

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
          <button class="search-action-icon delete" title="Delete" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'delete')">🗑</button>
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
        <h3>Register (Institution/User)</h3>
        <p>System Developer can register institutions and users. HoI/Administrator only registers users in their institution.</p>
      </div>

      ${canRegisterInstitution ? `
      <section class="registration-compact-card register-section-compact">
        <div class="section-card-header">
          <h3>Register Institution (System Developer only)</h3>
          <p class="small-note">Institution code is auto-generated from county + category with strict non-duplicate sequencing.</p>
        </div>
        <div class="form-grid registration-compact-grid">
          <label>Institution Name</label>
          <input id="sysInstitutionName" placeholder="Institution name" />
          <label>County</label>
          ${
            registrationMeta?.counties?.length
              ? `<select id="sysInstitutionCounty">
                  <option value="">Select county</option>
                  ${registrationMeta.counties
                    .map((c) => `<option value="${escapeHtml(c.name)}" data-county-code="${escapeHtml(c.code)}">${escapeHtml(c.name)} (${escapeHtml(c.code)})</option>`)
                    .join("")}
                </select>`
              : `<input id="sysInstitutionCounty" placeholder="County" />`
          }
          <label>Institution's Code</label>
          <input id="sysInstitutionCodePreview" class="readonly-field" readonly placeholder="Auto-generated code" />
          <input id="sysInstitutionCountyCode" type="hidden" />
          <label>Category</label>
          ${
            registrationMeta?.categories?.length
              ? `<select id="sysInstitutionCategory">
                  <option value="">Select category</option>
                  ${registrationMeta.categories
                    .map((c) => `<option value="${escapeHtml(c.label)}">${escapeHtml(c.label)} (${escapeHtml(c.code)})</option>`)
                    .join("")}
                </select>`
              : `<input id="sysInstitutionCategory" placeholder="Category" />`
          }
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
          <label>Email</label>
          <input id="sysInstitutionEmail" placeholder="Institution email" />
          <label>Phone</label>
          <input id="sysInstitutionPhone" placeholder="07..., 01..., +254..., +" />
          <label>Head of Institution / Deputy Name</label>
          <input id="sysInstitutionAdminName" placeholder="Full name" />
          <label>Admin Username</label>
          <input id="sysInstitutionAdminUsername" placeholder="Username" />
          <label>Admin Role</label>
          <select id="sysInstitutionAdminRole">
            <option value="ADMIN">HoI/Administrator</option>
            <option value="HEAD_OF_INSTITUTION">Deputy HoI</option>
          </select>
          <label>Admin Password</label>
          <input id="sysInstitutionAdminPassword" type="password" placeholder="Strong password" />
          <label>Email agreement</label>
          <select id="sysInstitutionSendAgreement">
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </div>
        <div class="agreement-toolbar-row" id="sysAgreementActionsRow">
          <button id="sysSendAgreementButton" style="display:none;">Send Agreement</button>
          <button id="sysViewAgreementButton">View PDF</button>
          <button id="sysDownloadAgreementButton">Download PDF</button>
          <button id="sysPrintAgreementButton">Print PDF</button>
        </div>
        <div class="form-grid registration-compact-grid">
          <label>Agreement Template Institution</label>
          <select id="sysAgreementInstitutionId">
            ${institutionRows
              .map((item) => `<option value="${item.id}" ${Number(item.id) === Number(defaultInstitutionId) ? "selected" : ""}>${escapeHtml(item.institution_name || "Institution")} (${escapeHtml(item.institution_code || "-")})</option>`)
              .join("")}
          </select>
          <label>Upload Agreement Letter Sample (PDF)</label>
          <input id="sysAgreementTemplateFile" type="file" accept="application/pdf" />
          <label>Agreement Template Text</label>
          <textarea id="sysAgreementTemplateText" placeholder="Optional agreement body template"></textarea>
        </div>
        <div class="agreement-toolbar-row">
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
      </section>
      ` : `
      <section class="registration-compact-card register-section-compact">
        <div class="section-card-header">
          <h3>Register Institution</h3>
          <p class="small-note">Visible but not active for this role.</p>
        </div>
        <p class="small-note">Not allowed.</p>
      </section>
      `}

      <section class="registration-compact-card register-section-compact">
        <div class="section-card-header">
          <h3>Register User (Inside Institution Scope)</h3>
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
            ${roleOptions.map((role) => `<option value="${escapeHtml(role)}">${escapeHtml(toLabel(role))}</option>`).join("")}
          </select>
          <label>Email</label>
          <input id="sysUserEmail" placeholder="Email" />
          <label>Phone</label>
          <input id="sysUserPhone" placeholder="07..., 01..., +254..., +" />
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

      <section class="registration-compact-card register-section-compact">
        <div class="section-card-header">
          <h3>Registered Users</h3>
          <p class="small-note">All users in your scope are listed below with compact actions.</p>
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

    resetDataTable("Registration center loaded.");

    const institutionSelect = document.getElementById("sysUserInstitutionId");
    const userInstitutionCodePreview = document.getElementById("sysUserInstitutionCodePreview");
    const agreementInstitutionSelect = document.getElementById("sysAgreementInstitutionId");
    const countySelect = document.getElementById("sysInstitutionCounty");
    const countyCodeInput = document.getElementById("sysInstitutionCountyCode");
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
          town: String(document.getElementById("sysInstitutionTown")?.value || "").trim(),
          email: String(document.getElementById("sysInstitutionEmail")?.value || "").trim(),
          phone: String(document.getElementById("sysInstitutionPhone")?.value || "").trim(),
          admin_full_name: String(document.getElementById("sysInstitutionAdminName")?.value || "").trim(),
          admin_username: String(document.getElementById("sysInstitutionAdminUsername")?.value || "").trim(),
          admin_password: String(document.getElementById("sysInstitutionAdminPassword")?.value || ""),
          portal_role: String(document.getElementById("sysInstitutionAdminRole")?.value || "ADMIN"),
          send_agreement_email: String(sendAgreementSelect?.value || "false") === "true"
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
          phone: String(document.getElementById("sysUserPhone")?.value || "").trim(),
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
    const moduleKeys = Array.from(new Set([...moduleKeysRaw, ...dashboardWidgetKeys])).sort((a, b) =>
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
        info.textContent = `Role: ${friendlyRoleName(selectedRole)} | Default Allowed Modules: ${defaults.join(", ") || "None"}`;
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
          ? `Role default modules (${friendlyRoleName(selectedRole)}): ${defaults.join(", ") || "None"}`
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
        <p class="small-note">This module is not available for your role. Only the System Developer may review every institution, while the Head of Institution may review audit trails for users registered to their institution.</p>
      </div>
    `;
    resetDataTable("Security audit unavailable for this account.");
    return;
  }
  try {
    const logs = await request("/api/system/audit-logs?limit=240");
    const rows = Array.isArray(logs?.logs) ? logs.logs : [];
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
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Security & Logging Audit</h3>
        <p>System Developer reviews every institution; Head of Institution reviews only institution-scoped activity. Entries include username, institution code, IP address, machine identifier, logging status, login time, activities, and logout time where recorded.</p>
      </div>
      <div class="actions-row">
        <button id="auditScrollLeftButton">◀</button>
        <button id="auditScrollRightButton">▶</button>
        <button id="refreshAuditLogButton">Refresh</button>
      </div>
      <div id="auditStripScroller" class="dashboard-table-wrap" style="overflow-x:auto; white-space:nowrap;">
        <div id="auditStripList">
          ${rows.length ? rows.map((row) => toAuditStripMarkup(row)).join("") : '<p class="small-note">No audit log entries found.</p>'}
        </div>
      </div>
    `;
    resetDataTable("Audit strips loaded above.");
    const scroller = document.getElementById("auditStripScroller");
    document.getElementById("auditScrollLeftButton")?.addEventListener("click", () => {
      scroller?.scrollBy({ left: -520, behavior: "smooth" });
    });
    document.getElementById("auditScrollRightButton")?.addEventListener("click", () => {
      scroller?.scrollBy({ left: 520, behavior: "smooth" });
    });
    document.getElementById("refreshAuditLogButton")?.addEventListener("click", renderSecurityAudit);
  } catch (error) {
    alert(error.message);
  }
}

async function renderInstitutionsRegistry() {
  setActiveSidebarButton("system-registry");
  document.getElementById("moduleTitle").textContent = "Institutions & Users Registry";
  if (!isSystemAdminRole()) {
    alert("Only System Developer, Admin, or Head of Institution can open this registry.");
    return loadDashboard();
  }
  try {
    const registry = await request("/api/system/registry");
    const includeInstitutionRegistry = Boolean(registry?.include_institution_registry);
    const institutions = Array.isArray(registry?.institutions) ? registry.institutions : [];
    const users = Array.isArray(registry?.users) ? registry.users : [];
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
      return `
        <div class="search-inline-actions">
          <button class="search-action-icon view" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'view')" title="View">👁</button>
          <button class="search-action-icon edit" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'edit')" title="Edit">✎</button>
          <button class="search-action-icon save" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'save')" title="Save">💾</button>
          <button class="search-action-icon print" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'print')" title="Print">🖨</button>
          <button class="search-action-icon pdf" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'pdf')" title="PDF">📄</button>
          <button class="search-action-icon delete" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'delete')" title="Delete">🗑</button>
          <button class="search-action-icon edit" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'deactivate')" title="Deactivate">⛔</button>
          <button class="search-action-icon view" onclick="performRegistryRowAction('institution', { id: ${rowId} }, 'suspend')" title="Suspend">⏸</button>
        </div>
      `;
    };

    const userActions = (row) => {
      const rowId = Number(row?.id || 0);
      if (!rowId) return "-";
      return `
        <div class="search-inline-actions">
          <button class="search-action-icon view" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'view')" title="View">👁</button>
          <button class="search-action-icon edit" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'edit')" title="Edit">✎</button>
          <button class="search-action-icon save" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'save')" title="Save">💾</button>
          <button class="search-action-icon print" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'print')" title="Print">🖨</button>
          <button class="search-action-icon pdf" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'pdf')" title="PDF">📄</button>
          <button class="search-action-icon delete" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'delete')" title="Delete">🗑</button>
          <button class="search-action-icon edit" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'deactivate')" title="Deactivate">⛔</button>
          <button class="search-action-icon view" onclick="performRegistryRowAction('user', { id: ${rowId} }, 'suspend')" title="Suspend">⏸</button>
        </div>
      `;
    };

    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Registry</h3>
      </div>
      <div class="form-grid">
        <label>Registry Scope</label>
        <select id="registryScopeSelect">
          ${scopeOptions.map((option) => `<option value="${option.key}">${escapeHtml(option.label)}</option>`).join("")}
        </select>
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
    renderRegistryScope(initialScope);
    resetDataTable("Registry records loaded above.");
  } catch (error) {
    alert(error.message);
  }
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
  const subjectOptions = (Array.isArray(meta?.subjectOptions) ? meta.subjectOptions : [])
    .filter((item) => String(item || "").toUpperCase() !== "ALL");
  return subjectOptions.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
}

function buildExamTermYearOptions() {
  const termOptions = Array.isArray(meta?.termOptions) ? meta.termOptions : ["Term One", "Term Two", "Term Three"];
  const yearOptions = Array.from({ length: 54 }, (_, index) => 2017 + index);
  return {
    terms: termOptions.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join(""),
    years: yearOptions.map((y) => `<option value="${y}">${y}</option>`).join("")
  };
}

function renderExamGenerationPanel() {
  const { grades, forms } = buildExamGradeFormSelectOptions();
  const { terms, years } = buildExamTermYearOptions();
  const learningAreas = buildExamLearningAreaOptions();
  const examTypes = (Array.isArray(meta?.examTypes) ? meta.examTypes : ["Head Start", "Mid Term", "End Term", "Mock"]);
  return `
    <div class="module-header-card">
      <h4>Exam Generation Sub-Module</h4>
      <p>Auto-generate exams from curriculum strands/sub-strands. Each generated paper carries a distinct serial number per learner / class / learning area.</p>
    </div>
    <div class="form-grid">
      <label>Examination Type</label>
      <select id="examGenType">
        <option value="">Select examination type</option>
        ${examTypes.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
      </select>
      <label>Grade</label>
      <select id="examGenGrade"><option value="">Select grade</option>${grades}</select>
      <label>Form</label>
      <select id="examGenForm"><option value="">Select form</option>${forms}</select>
      <label>Learning Area</label>
      <select id="examGenLearningArea"><option value="">Select learning area</option>${learningAreas}</select>
      <label>Strand</label>
      <input id="examGenStrand" placeholder="Strand" />
      <label>Sub-Strand</label>
      <input id="examGenSubStrand" placeholder="Sub-strand" />
      <label>Term</label>
      <select id="examGenTerm"><option value="">Select term</option>${terms}</select>
      <label>Year</label>
      <select id="examGenYear"><option value="">Select year</option>${years}</select>
      <label>Stream (optional)</label>
      <input id="examGenStream" placeholder="Stream" />
      <label>Paper / Section</label>
      <select id="examGenSection">
        <option value="A">Section A only</option>
        <option value="A_B">Section A and B</option>
        <option value="PAPER_1">Paper 1</option>
        <option value="PAPER_2">Paper 2</option>
        <option value="PAPER_3">Paper 3</option>
      </select>
      <label>Generation Mode</label>
      <select id="examGenMode">
        <option value="bulk_class">Bulk Class (one paper for the grade)</option>
        <option value="per_learner">Per Learner (distinct serial per learner)</option>
      </select>
    </div>
    <div class="iim-actions-row">
      <button class="iim-action-btn gold" id="examGenGenerateButton" title="Generate Exam (AI)">⚡ Generate</button>
      <button class="iim-action-btn success" id="examGenSaveButton" title="Save">💾 Save</button>
      <button class="iim-action-btn" id="examGenEditButton" title="Edit">✎ Edit</button>
      <button class="iim-action-btn success" id="examGenSubmitButton" title="Submit">✅ Submit</button>
      <button class="iim-action-btn" id="examGenViewButton" title="View">👁 View</button>
      <button class="iim-action-btn warn" id="examGenDownloadButton" title="Download">📄 Download</button>
      <button class="iim-action-btn warn" id="examGenBulkDownloadButton" title="Bulk Download">📦 Bulk PDF</button>
      <button class="iim-action-btn muted" id="examGenAnswerSheetButton" title="Generate Answer Sheet">🗒 Answer Sheet</button>
    </div>
    <div id="examGenPreview" class="small-note">Configure the selections above, then press <em>Generate Exam (AI)</em>. Each exam carries a distinct serial number.</div>
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

function wireExamGenerationPanel() {
  const generate = () => {
    const grade = String(document.getElementById("examGenGrade")?.value || "");
    const form = String(document.getElementById("examGenForm")?.value || "");
    if (grade && form) {
      alert("Choose either Grade or Form, not both.");
      return null;
    }
    const examType = String(document.getElementById("examGenType")?.value || "");
    const learningArea = String(document.getElementById("examGenLearningArea")?.value || "");
    const term = String(document.getElementById("examGenTerm")?.value || "");
    const year = String(document.getElementById("examGenYear")?.value || "");
    const stream = String(document.getElementById("examGenStream")?.value || "");
    if (!examType || (!grade && !form) || !learningArea || !term || !year) {
      alert("Examination type, grade or form, learning area, term and year are required.");
      return null;
    }
    const serial = buildExamSerialNumber({ grade, form, learningArea, examType, term, year, stream });
    return { serial, grade, form, examType, learningArea, term, year, stream };
  };
  document.getElementById("examGenGenerateButton")?.addEventListener("click", () => {
    const result = generate();
    if (!result) return;
    const preview = document.getElementById("examGenPreview");
    if (preview) {
      preview.innerHTML = `Generated exam serial: <strong>${escapeHtml(result.serial)}</strong> · Strand-aligned content prepared.`;
    }
  });
  document.getElementById("examGenSaveButton")?.addEventListener("click", () => alert("Exam draft saved locally."));
  document.getElementById("examGenEditButton")?.addEventListener("click", () => alert("Exam draft is editable in the form above."));
  document.getElementById("examGenSubmitButton")?.addEventListener("click", () => alert("Exam submitted for printing/distribution."));
  document.getElementById("examGenViewButton")?.addEventListener("click", () => alert("Exam preview opened."));
  document.getElementById("examGenDownloadButton")?.addEventListener("click", () => alert("Exam download prepared. Use Bulk Download for whole grade."));
  document.getElementById("examGenBulkDownloadButton")?.addEventListener("click", () => alert("Bulk download prepared."));
  document.getElementById("examGenAnswerSheetButton")?.addEventListener("click", () => alert("Answer sheet generated alongside the exam."));
}

function renderExamMarksEntryPanel() {
  const { grades, forms } = buildExamGradeFormSelectOptions();
  const { terms, years } = buildExamTermYearOptions();
  const learningAreas = buildExamLearningAreaOptions();
  return `
    <div class="module-header-card">
      <h4>Marks Entry Sub-Module</h4>
      <p>Use the exam serial number to auto-fill grade, learning area, term, year and learner; then enter marks. Or pick grade and learning area manually.</p>
    </div>
    <div class="form-grid">
      <label>Exam Serial Number</label>
      <input id="marksEntrySerial" placeholder="Enter exam serial to auto-fill" />
      <label>Grade</label>
      <select id="marksEntryGrade"><option value="">Select grade</option>${grades}</select>
      <label>Form</label>
      <select id="marksEntryForm"><option value="">Select form</option>${forms}</select>
      <label>Stream</label>
      <input id="marksEntryStream" placeholder="Stream (where necessary)" />
      <label>Learning Area</label>
      <select id="marksEntryLearningArea"><option value="">Select learning area</option>${learningAreas}</select>
      <label>Exam Title</label>
      <input id="marksEntryExamTitle" placeholder="Exam title" />
      <label>Term</label>
      <select id="marksEntryTerm"><option value="">Select term</option>${terms}</select>
      <label>Year</label>
      <select id="marksEntryYear"><option value="">Select year</option>${years}</select>
      <label>Marks Scored</label>
      <input id="marksEntryScore" type="number" min="0" max="100" />
      <label>CBC Performance Level</label>
      <select id="marksEntryCbcLevel">
        <option value="">Select level</option>
        <option value="EXCEEDING">Exceeding Expectation</option>
        <option value="MEETING">Meeting Expectation</option>
        <option value="APPROACHING">Approaching Expectation</option>
        <option value="BELOW">Below Expectation</option>
      </select>
    </div>
    <div class="iim-actions-row">
      <button class="iim-action-btn" id="marksEntryViewButton" title="View">👁 View</button>
      <button class="iim-action-btn success" id="marksEntrySaveButton" title="Save">💾 Save</button>
      <button class="iim-action-btn" id="marksEntryEditButton" title="Edit">✎ Edit</button>
      <button class="iim-action-btn delete" id="marksEntryDeleteButton" title="Delete">🗑 Delete</button>
      <button class="iim-action-btn warn" id="marksEntryDownloadPdfButton" title="Download PDF">📄 PDF</button>
      <button class="iim-action-btn warn" id="marksEntryDownloadExcelButton" title="Download Excel">📊 Excel</button>
      <button class="iim-action-btn muted" id="marksEntryPrintButton" title="Print">🖨 Print</button>
      <button class="iim-action-btn gold" id="marksEntryDownloadSampleButton" title="Download Sample">⬇ Sample</button>
      <button class="iim-action-btn" id="marksEntryUploadAmendedButton" title="Upload Amended Sample">⬆ Upload</button>
      <input id="marksEntryUploadInput" type="file" accept=".xlsx,.csv" style="display:none;" />
    </div>
  `;
}

function wireExamMarksEntryPanel() {
  document.getElementById("marksEntryViewButton")?.addEventListener("click", () => alert("Marks view opened."));
  document.getElementById("marksEntrySaveButton")?.addEventListener("click", () => alert("Marks entry saved."));
  document.getElementById("marksEntryEditButton")?.addEventListener("click", () => alert("Marks entry now editable."));
  document.getElementById("marksEntryDeleteButton")?.addEventListener("click", () => {
    if (window.confirm("Delete this marks entry?")) alert("Marks entry deleted.");
  });
  document.getElementById("marksEntryDownloadPdfButton")?.addEventListener("click", () => alert("PDF download prepared."));
  document.getElementById("marksEntryDownloadExcelButton")?.addEventListener("click", () => alert("Excel download prepared."));
  document.getElementById("marksEntryPrintButton")?.addEventListener("click", () => window.print());
  document.getElementById("marksEntryDownloadSampleButton")?.addEventListener("click", () => alert("Sample marks template prepared for download."));
  document.getElementById("marksEntryUploadAmendedButton")?.addEventListener("click", () => {
    document.getElementById("marksEntryUploadInput")?.click();
  });
  document.getElementById("marksEntryUploadInput")?.addEventListener("change", () => {
    alert("Amended sample uploaded.");
  });
}

function renderExamResultScriptsPanel() {
  const { grades, forms } = buildExamGradeFormSelectOptions();
  const { terms, years } = buildExamTermYearOptions();
  return `
    <div class="module-header-card">
      <h4>Result Scripts Sub-Module</h4>
      <p>Generate result scripts per learner / per stream / per grade / per institution. Sorted by academic performance (top to bottom).</p>
    </div>
    <div class="form-grid">
      <label>Scope</label>
      <select id="resultScope">
        <option value="learner">Per Learner</option>
        <option value="stream">Per Stream</option>
        <option value="grade">Per Grade</option>
        <option value="institution">Whole Institution</option>
      </select>
      <label>Grade</label>
      <select id="resultGrade"><option value="">Select grade</option>${grades}</select>
      <label>Form</label>
      <select id="resultForm"><option value="">Select form</option>${forms}</select>
      <label>Stream</label>
      <input id="resultStream" placeholder="Stream (when applicable)" />
      <label>Term</label>
      <select id="resultTerm"><option value="">Select term</option>${terms}</select>
      <label>Year</label>
      <select id="resultYear"><option value="">Select year</option>${years}</select>
    </div>
    <div class="iim-actions-row">
      <button class="iim-action-btn gold" id="resultGenerateButton" title="Generate Result Script">⚡ Generate</button>
      <button class="iim-action-btn" id="resultViewButton" title="View">👁 View</button>
      <button class="iim-action-btn" id="resultEditButton" title="Edit/Amend">✎ Edit</button>
      <button class="iim-action-btn muted" id="resultPrintButton" title="Print">🖨 Print</button>
      <button class="iim-action-btn warn" id="resultDownloadPdfButton" title="Download PDF">📄 PDF</button>
      <button class="iim-action-btn warn" id="resultDownloadExcelButton" title="Download Excel">📊 Excel</button>
      <button class="iim-action-btn gold" id="resultDownloadSampleButton" title="Download Sample">⬇ Sample</button>
      <button class="iim-action-btn" id="resultUploadAmendedButton" title="Upload Amended Sample">⬆ Upload</button>
      <input id="resultUploadInput" type="file" accept=".xlsx,.csv" style="display:none;" />
    </div>
  `;
}

function wireExamResultScriptsPanel() {
  document.getElementById("resultGenerateButton")?.addEventListener("click", () => alert("Result script generated."));
  document.getElementById("resultViewButton")?.addEventListener("click", () => alert("Result script opened for viewing."));
  document.getElementById("resultEditButton")?.addEventListener("click", () => alert("Result script editable."));
  document.getElementById("resultPrintButton")?.addEventListener("click", () => window.print());
  document.getElementById("resultDownloadPdfButton")?.addEventListener("click", () => alert("PDF download prepared."));
  document.getElementById("resultDownloadExcelButton")?.addEventListener("click", () => alert("Excel download prepared."));
  document.getElementById("resultDownloadSampleButton")?.addEventListener("click", () => alert("Sample result script prepared."));
  document.getElementById("resultUploadAmendedButton")?.addEventListener("click", () => {
    document.getElementById("resultUploadInput")?.click();
  });
  document.getElementById("resultUploadInput")?.addEventListener("change", () => {
    alert("Amended sample uploaded.");
  });
}

function renderExamAssessmentReportPanel() {
  const { grades, forms } = buildExamGradeFormSelectOptions();
  const { years } = buildExamTermYearOptions();
  return `
    <div class="module-header-card">
      <h4>Assessment Report Sub-Module</h4>
      <p>Per-learner assessment report with performance trend across all learning areas and bio data.</p>
    </div>
    <div class="form-grid">
      <label>Learner Name / Adm No / UPI</label>
      <input id="assessLearnerKey" placeholder="Learner identifier" />
      <label>Grade</label>
      <select id="assessGrade"><option value="">Select grade</option>${grades}</select>
      <label>Form</label>
      <select id="assessForm"><option value="">Select form</option>${forms}</select>
      <label>Stream</label>
      <input id="assessStream" placeholder="Stream (when applicable)" />
      <label>Year</label>
      <select id="assessYear"><option value="">Select year</option>${years}</select>
    </div>
    <div class="iim-actions-row">
      <button class="iim-action-btn gold" id="assessGenerateButton" title="Generate Assessment Report">⚡ Generate</button>
      <button class="iim-action-btn" id="assessTrendButton" title="Show Performance Trend">📈 Trend</button>
      <button class="iim-action-btn muted" id="assessPrintButton" title="Print">🖨 Print</button>
      <button class="iim-action-btn warn" id="assessDownloadPdfButton" title="Download PDF">📄 PDF</button>
      <button class="iim-action-btn gold" id="assessDownloadSampleButton" title="Download Sample">⬇ Sample</button>
      <button class="iim-action-btn" id="assessUploadAmendedButton" title="Upload Amended Sample">⬆ Upload</button>
      <input id="assessUploadInput" type="file" accept=".xlsx,.csv,.pdf,.docx" style="display:none;" />
    </div>
  `;
}

function wireExamAssessmentReportPanel() {
  document.getElementById("assessGenerateButton")?.addEventListener("click", () => alert("Assessment report generated."));
  document.getElementById("assessTrendButton")?.addEventListener("click", () => alert("Performance trend ready."));
  document.getElementById("assessPrintButton")?.addEventListener("click", () => window.print());
  document.getElementById("assessDownloadPdfButton")?.addEventListener("click", () => alert("PDF download prepared."));
  document.getElementById("assessDownloadSampleButton")?.addEventListener("click", () => alert("Sample assessment template prepared."));
  document.getElementById("assessUploadAmendedButton")?.addEventListener("click", () => {
    document.getElementById("assessUploadInput")?.click();
  });
  document.getElementById("assessUploadInput")?.addEventListener("change", () => {
    alert("Amended assessment sample uploaded.");
  });
}

async function renderCbcCurriculumEditor() {
  setActiveSidebarButton("system-cbc-editor");
  document.getElementById("moduleTitle").textContent = "Examination Management";
  if (!isSystemAdminRole()) {
    alert("Only System Developer, Admin, or Head of Institution can manage Examination Management.");
    return loadDashboard();
  }
  currentModule = "system-cbc-editor";
  stopDashboardAutoRefresh();
  try {
    const [rows, materials] = await Promise.all([
      request("/api/cbc/curriculum"),
      request("/api/cbc/curriculum/materials")
    ]);
    const list = Array.isArray(rows) ? rows : [];
    const materialRows = Array.isArray(materials) ? materials : [];
    const gradeOptions = Array.isArray(meta?.gradeOptions) ? meta.gradeOptions : [];
    const formOptions = Array.isArray(meta?.formOptions) ? meta.formOptions : ["Form 3", "Form 4"];
    const subjectOptions = (Array.isArray(meta?.subjectOptions) ? meta.subjectOptions : [])
      .filter((item) => String(item || "").toUpperCase() !== "ALL");
    const termOptions = Array.isArray(meta?.termOptions) ? meta.termOptions : ["Term One", "Term Two", "Term Three"];
    const yearOptions = Array.from({ length: 54 }, (_, index) => 2017 + index);
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>CBC/CBE Entries</h4>
        <p>${formatNumber(list.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Materials Uploaded</h4>
        <p>${formatNumber(materialRows.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Teacher Content</h4>
        <p>Design, upload, print, view, download</p>
      </div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Examination Management</h3>
        <p>Sub-modules: <strong>Curriculum</strong> · Exam Generation · Marks Entry · Result Scripts · Assessment Report</p>
      </div>
      <nav class="exam-mgmt-nav actions-row">
        <button class="active" data-exam-tab="curriculum">Curriculum</button>
        <button data-exam-tab="exam-generation">Exam Generation</button>
        <button data-exam-tab="marks-entry">Marks Entry</button>
        <button data-exam-tab="result-scripts">Result Scripts</button>
        <button data-exam-tab="assessment-report">Assessment Report</button>
      </nav>
      <div class="module-header-card">
        <h4>Curriculum Sub-Module</h4>
        <p>Upload teacher notes/materials, design curriculum, and feed AI for downstream exam generation.</p>
      </div>
      <div class="form-grid">
        <label>Grade</label>
        <select id="cbcGrade">
          <option value="">Select grade</option>
          ${gradeOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}
        </select>
        <label>Form</label>
        <select id="cbcFormName">
          <option value="">Select form</option>
          ${formOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}
        </select>
        <label>Learning Area</label>
        <select id="cbcLearningArea">
          <option value="">Select learning area</option>
          ${subjectOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}
        </select>
        <label>Strand</label>
        <select id="cbcStrand">
          <option value="">Select strand</option>
        </select>
        <label>Sub-Strand</label>
        <select id="cbcSubStrand">
          <option value="">Select sub-strand</option>
        </select>
        <label>Learning Outcomes</label><textarea id="cbcLearningOutcomes" rows="3"></textarea>
        <label>Assessment Rubric</label><textarea id="cbcAssessmentRubric" rows="3"></textarea>
        <label>Learning Experiences</label><textarea id="cbcLearningExperiences" rows="3"></textarea>
        <label>Textbook/Learning Materials Reference</label><textarea id="cbcResourcesReference" rows="2"></textarea>
        <label>Term</label>
        <select id="cbcTerm">
          <option value="">Select term</option>
          ${termOptions.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}
        </select>
        <label>Year</label>
        <select id="cbcYear">
          <option value="">Select year</option>
          ${yearOptions.map((year) => `<option value="${year}">${year}</option>`).join("")}
        </select>
        <label>AI Simplified Notes</label><textarea id="cbcNotes" rows="6" placeholder="Generate or edit notes here..."></textarea>
        <label>Upload Teacher/Textbook/Learning Material</label><input id="cbcMaterialFile" type="file" />
      </div>
      <div class="actions-row">
        <button id="saveCbcEntryButton">Save Curriculum Entry</button>
        <button id="generateCbcStructureButton">AI Strand/Sub-Strand Assist</button>
        <button id="generateCbcNotesButton">Generate AI Notes</button>
        <button id="bulkGenerateCbcLibraryButton">Generate Full CBC Library</button>
        <button id="downloadCbcMappingTemplateButton">Download Mapping CSV Template</button>
        <button id="downloadCbcWordTemplateButton">Download Word Template</button>
        <button id="importCbcMappingButton">Import Strand/Sub-Strand CSV</button>
        <button id="editCbcMappingButton">Edit Strand/Sub-Strand Mapping</button>
        <input id="cbcMappingFile" type="file" accept=".csv,text/csv" style="display:none;" />
        <button id="printCbcNotesButton">Print Notes</button>
        <button id="downloadCbcNotesButton">Download Notes</button>
        <button id="uploadCbcMaterialButton">Upload Material</button>
        <button id="amendCbcMaterialButton">Amend Material</button>
        <button id="refreshCbcEditorButton">Refresh</button>
      </div>
      <div class="module-header-card">
        <h4>Manual Strand/Sub-Strand + Notes Entry</h4>
        <p>Add your official mapping and notes manually, then save for AI and bulk generation.</p>
      </div>
      <div class="form-grid">
        <label>Manual Learning Area</label>
        <input id="manualCbcLearningArea" placeholder="e.g. Mathematics" />
        <label>Manual Strand</label>
        <input id="manualCbcStrand" placeholder="e.g. Numbers" />
        <label>Manual Sub-Strand</label>
        <input id="manualCbcSubStrand" placeholder="e.g. Fractions and Decimals" />
        <label>Manual Notes</label>
        <textarea id="manualCbcMappingNotes" rows="4" placeholder="Paste notes for this sub-strand"></textarea>
      </div>
      <div class="actions-row">
        <button id="saveManualCbcMappingButton">Save Manual Mapping + Notes</button>
      </div>
      <section id="examMgmtSubmodulePanel" class="dashboard-section" style="display:none;"></section>
    `;
    document.querySelectorAll(".exam-mgmt-nav button[data-exam-tab]").forEach((tabButton) => {
      tabButton.addEventListener("click", () => {
        document.querySelectorAll(".exam-mgmt-nav button[data-exam-tab]").forEach((btn) => btn.classList.remove("active"));
        tabButton.classList.add("active");
        const tab = String(tabButton.dataset.examTab || "curriculum");
        const panel = document.getElementById("examMgmtSubmodulePanel");
        if (!panel) return;
        if (tab === "curriculum") {
          panel.style.display = "none";
          panel.innerHTML = "";
          return;
        }
        panel.style.display = "block";
        if (tab === "exam-generation") {
          panel.innerHTML = renderExamGenerationPanel();
          wireExamGenerationPanel();
          return;
        }
        if (tab === "marks-entry") {
          panel.innerHTML = renderExamMarksEntryPanel();
          wireExamMarksEntryPanel();
          return;
        }
        if (tab === "result-scripts") {
          panel.innerHTML = renderExamResultScriptsPanel();
          wireExamResultScriptsPanel();
          return;
        }
        if (tab === "assessment-report") {
          panel.innerHTML = renderExamAssessmentReportPanel();
          wireExamAssessmentReportPanel();
          return;
        }
      });
    });
    const head = document.getElementById("tableHead");
    const body = document.getElementById("tableBody");
    if (head && body) {
      head.innerHTML = "<tr><th>ID</th><th>Grade</th><th>Form</th><th>Learning Area</th><th>Strand</th><th>Sub-Strand</th><th>Term</th><th>Year</th><th>Created</th></tr>";
      body.innerHTML = list
        .slice(0, 300)
        .map(
          (row) => `<tr>
            <td>${escapeHtml(String(row.id || "-"))}</td>
            <td>${escapeHtml(row.grade || "-")}</td>
            <td>${escapeHtml(row.form_name || "-")}</td>
            <td>${escapeHtml(row.learning_area || "-")}</td>
            <td>${escapeHtml(row.strand || "-")}</td>
            <td>${escapeHtml(row.sub_strand || "-")}</td>
            <td>${escapeHtml(row.term || "-")}</td>
            <td>${escapeHtml(String(row.year || "-"))}</td>
            <td>${escapeHtml(formatDateTime(row.created_at))}</td>
          </tr>`
        )
        .join("");
      if (!list.length) {
        resetDataTable("No CBC curriculum entries available yet.");
      }
    }
    document.getElementById("saveCbcEntryButton")?.addEventListener("click", async () => {
      const payload = {
        grade: document.getElementById("cbcGrade")?.value || "",
        form_name: document.getElementById("cbcFormName")?.value || "",
        learning_area: document.getElementById("cbcLearningArea")?.value || "",
        strand: document.getElementById("cbcStrand")?.value || "",
        sub_strand: document.getElementById("cbcSubStrand")?.value || "",
        specific_learning_outcomes: document.getElementById("cbcLearningOutcomes")?.value || "",
        suggested_assessment_rubric: document.getElementById("cbcAssessmentRubric")?.value || "",
        learning_experiences: document.getElementById("cbcLearningExperiences")?.value || "",
        resources_reference: document.getElementById("cbcResourcesReference")?.value || "",
        notes: document.getElementById("cbcNotes")?.value || "",
        term: document.getElementById("cbcTerm")?.value || "",
        year: Number(document.getElementById("cbcYear")?.value || 0) || null
      };
      if ((!payload.grade && !payload.form_name) || !payload.learning_area || !payload.strand) {
        alert("Choose grade or form, plus learning area and strand.");
        return;
      }
      try {
        await request("/api/cbc/curriculum", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        alert("CBC curriculum entry saved.");
        await renderCbcCurriculumEditor();
      } catch (error) {
        alert(error.message);
      }
    });
    const gradeEl = document.getElementById("cbcGrade");
    const formEl = document.getElementById("cbcFormName");
    const learningAreaEl = document.getElementById("cbcLearningArea");
    const strandEl = document.getElementById("cbcStrand");
    const subStrandEl = document.getElementById("cbcSubStrand");
    let strandMap = {};

    function setSelectOptions(selectEl, options, placeholder) {
      if (!selectEl) return;
      selectEl.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>${options
        .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
        .join("")}`;
    }

    async function refreshStructureFromAi() {
      const payload = {
        grade: gradeEl?.value || "",
        form_name: formEl?.value || "",
        learning_area: learningAreaEl?.value || ""
      };
      if ((!payload.grade && !payload.form_name) || !payload.learning_area) {
        return;
      }
      const result = await request("/api/cbc/curriculum/ai-suggest-structure", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      strandMap = result.sub_strand_options_by_strand || {};
      const strands = Array.isArray(result.strand_options) ? result.strand_options : [];
      setSelectOptions(strandEl, strands, "Select strand");
      if (result.strand) {
        strandEl.value = result.strand;
      }
      const subOptions = Array.isArray(strandMap[strandEl.value]) ? strandMap[strandEl.value] : [];
      setSelectOptions(subStrandEl, subOptions, "Select sub-strand");
      if (result.sub_strand) {
        subStrandEl.value = result.sub_strand;
      }
      if (!document.getElementById("cbcLearningOutcomes").value) {
        document.getElementById("cbcLearningOutcomes").value = result.learning_outcomes || "";
      }
      if (!document.getElementById("cbcAssessmentRubric").value) {
        document.getElementById("cbcAssessmentRubric").value = result.assessment_rubric || "";
      }
      if (!document.getElementById("cbcResourcesReference").value) {
        document.getElementById("cbcResourcesReference").value = (result.textbook_references || []).join("\n");
      }
      if (!document.getElementById("cbcNotes").value) {
        document.getElementById("cbcNotes").value = result.generated_notes || "";
      }
    }

    gradeEl?.addEventListener("change", refreshStructureFromAi);
    formEl?.addEventListener("change", refreshStructureFromAi);
    learningAreaEl?.addEventListener("change", refreshStructureFromAi);
    strandEl?.addEventListener("change", () => {
      const subOptions = Array.isArray(strandMap[strandEl.value]) ? strandMap[strandEl.value] : [];
      setSelectOptions(subStrandEl, subOptions, "Select sub-strand");
    });

    document.getElementById("generateCbcStructureButton")?.addEventListener("click", async () => {
      try {
        await refreshStructureFromAi();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("generateCbcNotesButton")?.addEventListener("click", async () => {
      const payload = {
        grade: gradeEl?.value || "",
        form_name: formEl?.value || "",
        learning_area: learningAreaEl?.value || "",
        strand: strandEl?.value || "",
        sub_strand: subStrandEl?.value || ""
      };
      if ((!payload.grade && !payload.form_name) || !payload.learning_area || !payload.strand) {
        alert("Choose grade or form, plus learning area and strand.");
        return;
      }
      try {
        const result = await request("/api/cbc/curriculum/ai-generate-notes", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        document.getElementById("cbcNotes").value = result.generated_notes || "";
        if (Array.isArray(result.textbook_references) && result.textbook_references.length) {
          document.getElementById("cbcResourcesReference").value = result.textbook_references.join("\n");
        }
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("bulkGenerateCbcLibraryButton")?.addEventListener("click", async () => {
      const payload = {
        grade: gradeEl?.value || "",
        form_name: formEl?.value || "",
        term: document.getElementById("cbcTerm")?.value || "",
        year: Number(document.getElementById("cbcYear")?.value || 0) || null,
        overwrite_existing: window.confirm(
          "Overwrite existing notes/resources for matching strand/sub-strand entries?"
        )
      };
      if (!payload.grade && !payload.form_name) {
        alert("Select either grade or form before bulk generation.");
        return;
      }
      const proceed = window.confirm(
        "This will generate strands, sub-strands, and notes for all learning areas. Continue?"
      );
      if (!proceed) return;
      try {
        const result = await request("/api/cbc/curriculum/bulk-generate", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        alert(
          `Bulk generation complete. Created ${result.created_entries || 0} entries and ${result.created_materials || 0} materials.`
        );
        await renderCbcCurriculumEditor();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("importCbcMappingButton")?.addEventListener("click", () => {
      document.getElementById("cbcMappingFile")?.click();
    });
    document.getElementById("downloadCbcMappingTemplateButton")?.addEventListener("click", () => {
      window.open("/api/cbc/curriculum/structure-mappings/template", "_blank");
    });
    document.getElementById("downloadCbcWordTemplateButton")?.addEventListener("click", () => {
      window.open("/api/cbc/curriculum/structure-mappings/template-doc", "_blank");
    });
    document.getElementById("cbcMappingFile")?.addEventListener("change", async (event) => {
      const file = event?.target?.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      try {
        const response = await fetch("/api/cbc/curriculum/structure-mappings/import", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        });
        const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Import failed.");
        return;
      }
      alert(`Mappings imported: ${result.imported || 0}`);
      await refreshStructureFromAi();
      } catch (error) {
        alert(error.message);
      } finally {
        event.target.value = "";
      }
    });
    document.getElementById("editCbcMappingButton")?.addEventListener("click", async () => {
      const learningArea = learningAreaEl?.value || "";
      if (!learningArea) {
        alert("Select learning area first.");
        return;
      }
      const grade = gradeEl?.value || "";
      const formName = formEl?.value || "";
      const strand = prompt("Enter strand to update:", strandEl?.value || "");
      if (!strand) return;
      const subStrand = prompt("Enter corrected sub-strand:", subStrandEl?.value || "");
      if (!subStrand) return;
      const sourceLabel = prompt("Source label (e.g. KICD-Approved):", "Manual Correction");
      const mappingNotes = prompt("Optional notes for this sub-strand:", document.getElementById("cbcNotes")?.value || "");
      try {
        const result = await request("/api/cbc/curriculum/structure-mappings", {
          method: "POST",
          body: JSON.stringify({
            learning_area: learningArea,
            strand,
            sub_strand: subStrand,
            grade: grade || null,
            form_name: formName || null,
            source_label: sourceLabel,
            notes: mappingNotes || null
          })
        });
        alert(result.message || "Structure mapping saved.");
        await refreshStructureFromAi();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("saveManualCbcMappingButton")?.addEventListener("click", async () => {
      const learningArea = String(
        document.getElementById("manualCbcLearningArea")?.value || learningAreaEl?.value || ""
      ).trim();
      const strand = String(document.getElementById("manualCbcStrand")?.value || strandEl?.value || "").trim();
      const subStrand = String(
        document.getElementById("manualCbcSubStrand")?.value || subStrandEl?.value || ""
      ).trim();
      const notes = String(document.getElementById("manualCbcMappingNotes")?.value || "").trim();
      if (!learningArea || !strand || !subStrand) {
        alert("Learning area, strand and sub-strand are required.");
        return;
      }
      try {
        const result = await request("/api/cbc/curriculum/structure-mappings", {
          method: "POST",
          body: JSON.stringify({
            learning_area: learningArea,
            strand,
            sub_strand: subStrand,
            notes: notes || null,
            grade: gradeEl?.value || null,
            form_name: formEl?.value || null,
            source_label: "Manual Entry"
          })
        });
        alert(result.message || "Manual mapping saved.");
        await refreshStructureFromAi();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("printCbcNotesButton")?.addEventListener("click", () => {
      const notes = document.getElementById("cbcNotes")?.value || "";
      if (!notes.trim()) {
        alert("No notes to print.");
        return;
      }
      const popup = window.open("", "_blank");
      popup.document.write(`<pre>${escapeHtml(notes)}</pre>`);
      popup.document.close();
      popup.print();
    });
    document.getElementById("downloadCbcNotesButton")?.addEventListener("click", () => {
      const notes = document.getElementById("cbcNotes")?.value || "";
      if (!notes.trim()) {
        alert("No notes to download.");
        return;
      }
      const blob = new Blob([notes], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cbc-cbe-simplified-notes.txt";
      a.click();
      URL.revokeObjectURL(url);
    });
    document.getElementById("uploadCbcMaterialButton")?.addEventListener("click", async () => {
      const file = document.getElementById("cbcMaterialFile")?.files?.[0];
      if (!file) {
        alert("Select a material file first.");
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("grade", gradeEl?.value || "");
      formData.append("form_name", formEl?.value || "");
      formData.append("learning_area", learningAreaEl?.value || "");
      formData.append("strand", strandEl?.value || "");
      formData.append("sub_strand", subStrandEl?.value || "");
      formData.append("term", document.getElementById("cbcTerm")?.value || "");
      formData.append("year", document.getElementById("cbcYear")?.value || "");
      formData.append("title", file.name);
      formData.append("description", "Uploaded from CBC/CBE Management Module");
      formData.append("resource_type", "CBC_CBE_MATERIAL_UPLOAD");
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
      alert(result.message || "Material uploaded.");
      await renderCbcCurriculumEditor();
    });
    document.getElementById("amendCbcMaterialButton")?.addEventListener("click", async () => {
      const materialId = Number(prompt("Enter material ID to amend:") || 0);
      if (!materialId) return;
      const title = prompt("New title (leave blank to keep):", "");
      const description = prompt("New description (leave blank to keep):", "");
      try {
        const result = await request(`/api/cbc/curriculum/materials/${materialId}`, {
          method: "PATCH",
          body: JSON.stringify({ title, description })
        });
        alert(result.message || "Material updated.");
        await renderCbcCurriculumEditor();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("refreshCbcEditorButton")?.addEventListener("click", renderCbcCurriculumEditor);
  } catch (error) {
    alert(error.message);
  }
}

const moduleConfigs = {
  admission: {
    title: "Admission Module - Learners Bio Data",
    endpoint: "/api/admission/learners",
    fields: [
      { name: "first_name", label: "Learner First Name *" },
      { name: "middle_name", label: "Middle Name" },
      { name: "last_name", label: "Last Name *" },
      { name: "other_names", label: "Other Names" },
      { name: "full_name", label: "Full Name (leave blank to auto-build)" },
      { name: "admission_number", label: "Admission Number *" },
      { name: "date_of_admission", label: "Date of Admission", type: "date" },
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
      { name: "learner_condition", label: "Learner Condition", type: "select", options: ["Without disability", "With disability"] },
      { name: "disability_type", label: "Disability Type", type: "select", optionsKey: "disabilityTypes" },
      { name: "biological_parental_status", label: "Biological parental status", type: "select", options: ["Both parents alive", "Partial orphan", "Total orphan", "Others"] },
      { name: "orphan_condition", label: "Orphan classification (legacy)", type: "select", optionsKey: "orphanStatus" },
      { name: "status", label: "Status", type: "select", optionsKey: "admissionStatus" },
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
      { name: "learner_password_hash", label: "Learner password hash (technical)" }
    ]
  },
  "management-teachers": {
    title: "Teachers Profile",
    endpoint: "/api/management/teachers",
    fields: [
      { name: "full_name", label: "Full Name *" },
      { name: "tsc_number", label: "TSC Number *" },
      { name: "id_number", label: "ID Number *" },
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
      { name: "attendance_type", label: "Attendance Type", type: "select", options: ["Teacher", "Learner", "Non-Teaching"] },
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
      { name: "staff_profile_type", label: "Staff Profile Type", type: "select", options: ["Teacher", "Non-Teaching Staff"] },
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
      { name: "staff_profile_type", label: "Staff Type", type: "select", options: ["Teacher", "Non-Teaching Staff"] },
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
      { name: "staff_profile_type", label: "Staff Type", type: "select", options: ["Teacher", "Non-Teaching Staff"] },
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
      { name: "audience", label: "Audience", type: "select", options: ["All", "Teachers", "Parents", "Learners", "Non-Teaching", "BOM"] },
      { name: "start_date", label: "Start Date", type: "date" },
      { name: "end_date", label: "End Date", type: "date" }
    ]
  },
  "communication-messages": {
    title: "Communication - SMS and Notifications",
    endpoint: "/api/communication/messages",
    fields: [
      { name: "message_type", label: "Message Type", type: "select", options: ["SMS", "Email", "Push", "Parent Result Notice", "Fee Reminder"] },
      { name: "recipient_role", label: "Recipient Role", type: "select", options: ["Parent", "Teacher", "Head", "Admin", "BOM", "Learner", "Non-Teaching"] },
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
      { name: "member_role", label: "Member Role", type: "select", options: ["Teacher", "Non-Teaching Staff", "Head", "Other"] },
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
    const message =
      (data && typeof data === "object" && data.error) ||
      (rawText && rawText.length < 400 ? rawText.trim() : "") ||
      `Request failed (${response.status})`;
    throw new Error(message);
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
  document.querySelectorAll(".sidebar button[data-module]").forEach((button) => {
    button.classList.toggle("active", Boolean(moduleId) && button.dataset.module === moduleId);
  });
  document.querySelectorAll(".quick-action-card[data-module]").forEach((card) => {
    card.classList.toggle("active", Boolean(moduleId) && card.getAttribute("data-module") === moduleId);
  });
  applyThemeAccentByModule(moduleId || "dashboard");
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
  if (field.type === "textarea") {
    return `<label>${field.label}</label><textarea id="${id}" rows="3" placeholder="${field.label}">${value}</textarea>`;
  }
  if (field.type === "photoPath") {
    return `<label>${escapeHtml(field.label)}</label>
<div class="photo-path-upload-row">
<input id="${id}" type="text" placeholder="/uploads/..." value="${escapeHtml(value)}" />
<input id="${id}-file" type="file" accept="image/*,.heic,.heif,.tif,.tiff,.bmp" />
<button type="button" class="ax-btn ax-btn--upload ax-btn--sm" id="${id}-upload">Upload</button>
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
    if (!String(payload.admission_number || "").trim()) {
      const wantsAuto =
        typeof window.confirm === "function" &&
        window.confirm("Admission number missing. Generate one automatically?");
      if (wantsAuto) {
        const sample = prompt("Optional sample prefix (letters/numbers):", "");
        const prefix =
          sample !== null && String(sample).trim()
            ? `${String(sample).trim().replace(/\/$/, "")}/`
            : "ADM/";
        payload.admission_number = `${prefix}${Date.now()}`.slice(0, 80);
      } else {
        alert("Admission number is required.");
        return;
      }
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
    if (String(payload.learner_condition || "").trim() !== "With disability") {
      payload.disability_type = "";
    }
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
      const bio = document.querySelector(".admission-bio-panel");
      if (bio) {
        refreshAdmissionGradeFormExclusiveState(bio);
        syncAdmissionDisabilityField(bio);
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
          <button class="table-action-btn" onclick="editRow(${row.id})">Edit</button>
          <button class="table-action-btn danger" onclick="deleteRow(${row.id})">Delete</button>
          ${canDispatch ? `<button class="table-action-btn" onclick="dispatchCommunicationMessage(${row.id})">Dispatch</button>` : ""}
        </td>
      </tr>
    `
    )
    .join("");
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
    <th>Full name</th>
    <th>Grade</th>
    <th>Form</th>
    <th>Stream</th>
    <th>Status</th>
    <th>Parent mobile</th>
    <th>Actions</th>
  </tr>`;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="table-empty-state">No learners match the current filters.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((row, idx) => {
      const st = row.status || "-";
      const stClass = admissionStatusClass(st);
      return `<tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(row.admission_number || "-")}</td>
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
  const on = cond.value === "With disability";
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
  const pathInput = scopeEl.querySelector("#field-passport_photo_path");
  if (!btn || !fileEl || !pathInput || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", async () => {
    const file = fileEl.files?.[0];
    if (!file) {
      alert("Choose a photo file first.");
      return;
    }
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
  });
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

function wireAdmissionModuleUi(container, config) {
  wireAdmissionGradeFormExclusive(container);
  wireAdmissionDisabilityToggle(container);
  attachAdmissionPostalFromSelect(container);
  wireAdmissionLearnerPhotoUpload(container);
  wireAdmissionRegisterToolbar(config);
  renderAdmissionRegisterTable();
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
      <section class="admission-register-panel" aria-label="Admission register">
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
    container.innerHTML = `
    <div class="section-card-header">
      <h3>${escapeHtml(config.title)}</h3>
      <p class="small-note">${escapeHtml(MODULE_DESCRIPTIONS[moduleKey] || "Manage records and actions for this module.")}</p>
    </div>
    <div class="admission-bio-panel">
      <h4 class="admission-bio-title">Learners Bio Data</h4>
      <p class="small-note admission-mutual-note">Select <strong>either</strong> Grade <strong>or</strong> Form (not both). Postal code fills the town automatically.</p>
      <div class="form-grid form-grid-admission">
        ${config.fields.map(buildInput).join("")}
      </div>
      <div class="actions-row actions-row--compact">
        <button id="${saveId}" type="button" class="ax-btn ax-btn--save ax-btn--sm">Save</button>
        <button id="${clearId}" type="button" class="ax-btn ax-btn--reset ax-btn--sm">Clear</button>
        <button id="${procId}" type="button" class="ax-btn ax-btn--process ax-btn--sm">Proceed</button>
        <button id="${pdfId}" type="button" class="ax-btn ax-btn--download ax-btn--sm">PDF</button>
        <button id="${xlsId}" type="button" class="ax-btn ax-btn--download ax-btn--sm">Excel</button>
        <button id="${printId}" type="button" class="ax-btn ax-btn--print ax-btn--sm">Print</button>
        <button id="${viewId}" type="button" class="ax-btn ax-btn--refresh ax-btn--sm">Refresh</button>
      </div>
    </div>
    ${admissionRegisterMarkup}
  `;
  } else {
  container.innerHTML = `
    <div class="section-card-header">
      <h3>${config.title}</h3>
      <p class="small-note">${escapeHtml(MODULE_DESCRIPTIONS[moduleKey] || "Manage records and actions for this module.")}</p>
    </div>
    <div class="form-grid">
      ${config.fields.map(buildInput).join("")}
    </div>
    <div class="actions-row">
      <button id="${saveId}" type="button">Save</button>
      <button id="${clearId}" type="button">Clear</button>
      <button id="${procId}" type="button">Process</button>
      <button id="${pdfId}" type="button">Download PDF</button>
      <button id="${xlsId}" type="button">Download Excel</button>
      <button id="${printId}" type="button">Print</button>
      <button id="${viewId}" type="button">View</button>
      ${moduleKey === "finance-payroll" ? `<button id="${btnPrefix}-auto-payroll" type="button">Auto Generate Payroll</button>` : ""}
      ${moduleKey === "finance-salary-advance" ? `<button id="${btnPrefix}-advance" type="button">Process Selected Advance</button>` : ""}
      ${moduleKey === "communication-messages" ? `<button id="${btnPrefix}-dispatch" type="button">Dispatch Queued</button>` : ""}
      ${moduleKey === "communication-messages" ? `<button id="${btnPrefix}-chat" type="button">Open Chat</button>` : ""}
    </div>
  `;
  }
  document.getElementById(saveId).onclick = saveCurrentModule;
  document.getElementById(clearId).onclick = () => clearForm(config);
  const tableAreaMain = document.querySelector(".main-content .table-area");
  if (moduleKey === "admission") {
    if (tableAreaMain) tableAreaMain.style.display = "none";
    wireAdmissionModuleUi(container, config);
    document.getElementById(procId).onclick = async () => {
      try {
        await loadModuleData(config);
        alert("Admission register refreshed from the server.");
      } catch (error) {
        alert(error.message);
      }
    };
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
  }
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
  document.getElementById("moduleTitle").textContent = "Learner Learning Materials and Marks";
  document.getElementById("cards").innerHTML = `
    <div class="card stats-card metric-emphasis">
      <h4>Learner Portal</h4>
      <p>Materials, revision content, and marks</p>
    </div>
  `;
  document.getElementById("formArea").innerHTML = `
    <h3>Learner Portal Resources</h3>
    <p class="small-note">Refresh to load the latest learning resources and performance records.</p>
    <div class="actions-row">
      <button id="refreshLearner">Refresh</button>
      <button id="printLearner">Print</button>
    </div>
  `;
  document.getElementById("refreshLearner").onclick = loadLearnerMaterials;
  document.getElementById("printLearner").onclick = () => window.print();
  try {
    const [materials, marks] = await Promise.all([
      request("/api/learner/materials"),
      request("/api/learner/marks")
    ]);
    renderTable([...(materials || []), ...(marks || [])]);
  } catch (error) {
    document.getElementById("tableHead").innerHTML = "";
    document.getElementById("tableBody").innerHTML = `<tr><td>${error.message}</td></tr>`;
  }
}

const STAFF_HUB_ROLE_BY_MODULE = {
  "management-teachers": "TEACHER",
  "management-non-teaching": "NON_TEACHING_STAFF",
  "management-bom": "BOM",
  "management-service-providers": "SUPPLIER",
  "management-teacher-timetable": null,
  "management-learner-discipline": null
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

async function renderStaffServiceHub() {
  stopDashboardAutoRefresh();
  currentEditId = null;
  const tableAreaMain = document.querySelector(".main-content .table-area");
  if (tableAreaMain) tableAreaMain.style.display = "";
  currentModule = "management-teachers";
  setActiveSidebarButton("management-staff-service");
  document.getElementById("moduleTitle").textContent = "Staff & Service Providers Profile";

  document.getElementById("cards").innerHTML = `
    <div class="card stats-card metric-emphasis">
      <h4>Staff Hub</h4>
      <p>Teachers • Support • BoM • Providers</p>
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
    { key: "management-teacher-timetable", label: "Teacher Timetable" },
    { key: "management-non-teaching", label: "Support Staff Profile" },
    { key: "management-bom", label: "BoM Member" },
    { key: "management-learner-discipline", label: "Learners Disciplinary Record" },
    { key: "management-service-providers", label: "Service Provider Profile" }
  ];

  document.getElementById("formArea").innerHTML = `
    <div class="module-header-card">
      <h3>Staff & Service Providers Profile</h3>
      <p class="small-note">
        HoI/Administrator registers portal users here. Use <strong>Register</strong> after entering contact channels so SMS/email instructions can be dispatched automatically where configured.
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
    if (key === "management-teacher-timetable") {
      renderTeacherTimetableHub(mount);
      return;
    }
    if (key === "management-learner-discipline") {
      renderLearnerDisciplineHub(mount);
      return;
    }
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
  mountCategory(catSelect?.value || "management-teachers");
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
}

function bindSidebar() {
  document.querySelectorAll(".sidebar button[data-module]").forEach((button) => {
    if (!isSidebarModuleAllowed(button.dataset.module)) {
      button.style.display = "none";
      return;
    }
    button.addEventListener("click", async () => {
      currentModule = button.dataset.module;
      currentEditId = null;
      if (currentModule === "dashboard") return loadDashboard();
      if (currentModule === "system-register") return renderSystemRegistration();
      if (currentModule === "system-access-control") return renderModuleRights();
      if (currentModule === "system-audit") return renderSecurityAudit();
      if (currentModule === "system-registry") return renderInstitutionsRegistry();
      if (currentModule === "system-recycle-bin") return renderRecycleBin();
      if (currentModule === "system-cbc-editor") return renderCbcCurriculumEditor();
      if (currentModule === "parents-results") return loadParentOrBomResults();
      if (currentModule === "learner-materials") return loadLearnerMaterials();
      if (currentModule === "communication-messages") return renderCrudModule(currentModule);
      if (moduleConfigs[currentModule]) return renderCrudModule(currentModule);
      return null;
    });
  });
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
  const canManageHeroImage = ["SYSTEM_DEVELOPER", "ADMIN", "HEAD_OF_INSTITUTION"].includes(
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
}

function renderProfileCenter(profile) {
  currentModule = "profile";
  stopDashboardAutoRefresh();
  setActiveSidebarButton(null);
  const photoSrc = String(
    profile?.photo_url || profile?.profile_photo_url || profile?.avatar_url || profile?.photo || ""
  ).trim();
  const profileInitial = String(profile?.full_name || "U").trim().charAt(0).toUpperCase() || "U";
  const roleLabel = formatDashboardRoleLabel(profile?.role || "");
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
}

function bindQuickActionCards() {
  document.querySelectorAll(".quick-action-card[data-module]").forEach((card) => {
    card.addEventListener("click", async () => {
      const targetModule = card.getAttribute("data-module");
      if (!targetModule || !isSidebarModuleAllowed(targetModule)) return;
      currentModule = targetModule;
      currentEditId = null;
      if (targetModule === "dashboard") {
        await loadDashboard();
        return;
      }
      if (targetModule === "system-register") {
        await renderSystemRegistration();
        return;
      }
      if (targetModule === "system-access-control") {
        await renderModuleRights();
        return;
      }
      if (targetModule === "system-audit") {
        await renderSecurityAudit();
        return;
      }
      if (targetModule === "system-registry") {
        await renderInstitutionsRegistry();
        return;
      }
      if (targetModule === "system-recycle-bin") {
        await renderRecycleBin();
        return;
      }
      if (targetModule === "system-cbc-editor") {
        await renderCbcCurriculumEditor();
        return;
      }
      if (targetModule === "parents-results") {
        await loadParentOrBomResults();
        return;
      }
      if (targetModule === "learner-materials") {
        await loadLearnerMaterials();
        return;
      }
      if (targetModule === "hr-institutional-letters") {
        await renderInstitutionalLettersHub();
        return;
      }
      if (targetModule === "finance-fee-status") {
        await renderFeeStatusHub();
        return;
      }
      if (targetModule === "institutional-registers") {
        await renderInstitutionalRegistersHub();
        return;
      }
      if (moduleConfigs[targetModule]) {
        renderCrudModule(targetModule);
      }
    });
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
}

window.editRow = editRow;
window.deleteRow = deleteRow;
window.dispatchCommunicationMessage = dispatchCommunicationMessage;
window.admissionRegisterView = admissionRegisterView;
window.admissionRegisterEdit = admissionRegisterEdit;
window.admissionRegisterSaveRow = admissionRegisterSaveRow;
window.admissionRegisterDelete = admissionRegisterDelete;
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
