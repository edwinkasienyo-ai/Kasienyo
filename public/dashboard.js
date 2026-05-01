const token = localStorage.getItem("token");
if (!token) {
  window.location.href = "/";
}

let meta = {};
let currentModule = "dashboard";
let currentEditId = null;
let allowedModules = [];
let portalContext = null;
let searchRowDrafts = {};
let dashboardAutoRefreshHandle = null;
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

const MODULE_KEY_BY_ID = {
  dashboard: "dashboard",
  admission: "admission",
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
  "management-non-teaching": "Manage non-teaching staff records and roles.",
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
        if (!window.confirm("Move this institution to recycle bin?")) return;
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
      if (!window.confirm("Move this user to recycle bin?")) return;
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
  const first = prompt("Permanent delete confirmation step 1: Type YES");
  if (first === null) return null;
  const second = prompt("Permanent delete confirmation step 2: Type CONFIRM");
  if (second === null) return null;
  const third = prompt("Permanent delete confirmation step 3: Type DELETE");
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
  if (!isSystemAdminRole()) {
    alert("Only System Developer, Admin, or Head of Institution can manage module rights.");
    return loadDashboard();
  }
  try {
    const [users, metaData] = await Promise.all([
      request("/api/users"),
      request("/api/meta")
    ]);
    const moduleKeys = Object.values(metaData?.moduleKeys || {});
    const defaultMap = metaData?.defaultModuleAccessByRole || {};
    const rows = Array.isArray(users) ? users.slice(0, 200) : [];
    const permissionKeys = ["ACCESS", "VIEW", "EDIT", "DELETE", "SAVE", "PROCESS", "SHOW_ROLES"];
    const permissionLabels = {
      ACCESS: "View",
      VIEW: "View",
      EDIT: "Edit",
      DELETE: "Delete",
      SAVE: "Save",
      PROCESS: "Process",
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

    await loadOverrides();
    resetDataTable("Module access matrix loaded.");
  } catch (error) {
    alert(error.message);
  }
}

async function renderSecurityAudit() {
  setActiveSidebarButton("system-audit");
  document.getElementById("moduleTitle").textContent = "Security and Logging Audit";
  if (!isSystemAdminRole()) {
    alert("Only System Developer, Admin, or Head of Institution can view audit logs.");
    return loadDashboard();
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
        <p>System Developer sees all logs; HoI/Administrator sees logs scoped to own institution. Other users are not allowed.</p>
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
    const retentionYears = Number(recycleData?.retention_years || 12);
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
        <p>Deleted items are retained for ${retentionYears} years. HoI/Admin purge hides item from their view but keeps it visible to System Developer retention controls.</p>
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
      { name: "first_name", label: "First Name" },
      { name: "middle_name", label: "Middle Name" },
      { name: "last_name", label: "Last Name" },
      { name: "other_names", label: "Other Names" },
      { name: "full_name", label: "Full Name" },
      { name: "admission_number", label: "Admission Number" },
      { name: "date_of_admission", label: "Date of Admission", type: "date" },
      { name: "grade", label: "Grade", type: "select", optionsKey: "gradeOptions" },
      { name: "form_name", label: "Form", type: "select", optionsKey: "formOptions" },
      { name: "stream", label: "Stream" },
      { name: "assessment_number", label: "Assessment Number" },
      { name: "upi_number", label: "UPI Number" },
      { name: "birth_certificate_number", label: "Birth Certificate Number" },
      { name: "date_of_birth", label: "Date of Birth", type: "date" },
      { name: "gender", label: "Gender", type: "select", optionsKey: "genderOptions" },
      { name: "passport_photo_path", label: "Passport Photo Path (/uploads/...)" },
      { name: "religion", label: "Religion" },
      { name: "nationality", label: "Nationality" },
      { name: "county", label: "County" },
      { name: "sub_county", label: "Sub County" },
      { name: "location", label: "Location" },
      { name: "sub_location", label: "Sub Location" },
      { name: "village", label: "Village" },
      { name: "year_joined", label: "Year Joined", type: "select", optionsKey: "yearJoinedOptions" },
      { name: "term_joined", label: "Term Joined", type: "select", optionsKey: "termOptions" },
      { name: "orphan_condition", label: "Condition", type: "select", optionsKey: "orphanStatus" },
      { name: "status", label: "Status", type: "select", optionsKey: "admissionStatus" },
      { name: "parent_full_name", label: "Parent Name" },
      { name: "parent_relationship", label: "Parent Relationship", type: "select", optionsKey: "relationshipOptions" },
      { name: "parent_id_number", label: "Parent ID Number" },
      { name: "parent_phone", label: "Parent Phone Number" },
      { name: "parent_email", label: "Parent Email Address" }
    ]
  },
  "management-teachers": {
    title: "Teachers Profile",
    endpoint: "/api/management/teachers",
    fields: [
      { name: "full_name", label: "Full Name" },
      { name: "tsc_number", label: "TSC Number" },
      { name: "id_number", label: "ID Number" },
      { name: "phone_number", label: "Phone Number" },
      { name: "category", label: "Category", type: "select", optionsKey: "staffCategories" },
      { name: "major_subject", label: "Major Subject", type: "select", optionsKey: "subjectOptions" },
      { name: "other_subject", label: "Other Subject", type: "select", optionsKey: "subjectOptions" },
      { name: "next_of_kin_name", label: "Next of Kin Name" },
      { name: "next_of_kin_relationship", label: "Next of Kin Relationship" },
      { name: "next_of_kin_mobile", label: "Next of Kin Mobile" },
      { name: "next_of_kin_email", label: "Next of Kin Email" }
    ]
  },
  "management-non-teaching": {
    title: "Non-Teaching Staff Profile",
    endpoint: "/api/management/non-teaching-staff",
    fields: [
      { name: "full_name", label: "Full Name" },
      { name: "staff_number", label: "Staff Number (or auto generated)" },
      { name: "id_number", label: "ID Number" },
      { name: "phone_number", label: "Phone Number" },
      { name: "position_department", label: "Position/Department" },
      { name: "next_of_kin_name", label: "Next of Kin Name" },
      { name: "next_of_kin_contact", label: "Next of Kin Contact" }
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
  const ipAddress = row.ip_address || "-";
  const machineName = row.machine_name || "-";
  const loginTime = formatDateTime(row.login_time || row.created_at);
  const logoutTime = formatDateTime(row.logout_time);
  const activityDone = row.activity_done || row.action || "-";
  const actorRole = row.actor_role || "-";
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
        <span class="audit-chip">Password Correct: ${escapeHtml(passwordCorrect)}</span>
        <span class="audit-chip">OTP Correct: ${escapeHtml(otpCorrect)}</span>
        <span class="audit-chip">IP Address: ${escapeHtml(ipAddress)}</span>
        <span class="audit-chip">Machine: ${escapeHtml(machineName)}</span>
        <span class="audit-chip">Login Time: ${escapeHtml(loginTime)}</span>
        <span class="audit-chip">Logout Time: ${escapeHtml(logoutTime)}</span>
        <span class="audit-chip">Activity: ${escapeHtml(activityDone)}</span>
        <span class="audit-chip">Role: ${escapeHtml(actorRole)}</span>
        <span class="audit-chip">Institution: ${escapeHtml(String(institutionId))}</span>
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
  if (field.type === "select") {
    const options = field.options || meta[field.optionsKey] || [];
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
  } catch (error) {
    alert(error.message);
  }
}

async function deleteRow(id) {
  const config = moduleConfigs[currentModule];
  if (!config) return;
  if (!isModuleAllowed(currentModule)) {
    alert("Your role does not have access to this module.");
    return;
  }
  const ok = window.confirm("Delete this record permanently?");
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
    renderTable(rows || []);
  } catch (error) {
    alert(error.message);
  }
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

function renderCrudModule(moduleKey) {
  const config = moduleConfigs[moduleKey];
  setActiveSidebarButton(moduleKey);
  document.getElementById("moduleTitle").textContent = config.title;
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
  document.getElementById("formArea").innerHTML = `
    <div class="section-card-header">
      <h3>${config.title}</h3>
      <p class="small-note">${escapeHtml(MODULE_DESCRIPTIONS[moduleKey] || "Manage records and actions for this module.")}</p>
    </div>
    <div class="form-grid">
      ${config.fields.map(buildInput).join("")}
    </div>
    <div class="actions-row">
      <button id="saveButton">Save</button>
      <button id="clearButton">Clear</button>
      <button id="processButton">Process</button>
      <button id="downloadPdfButton">Download PDF</button>
      <button id="downloadExcelButton">Download Excel</button>
      <button id="printButton">Print</button>
      <button id="viewButton">View</button>
      ${moduleKey === "finance-payroll" ? '<button id="autoGeneratePayrollButton">Auto Generate Payroll</button>' : ""}
      ${moduleKey === "finance-salary-advance" ? '<button id="processAdvanceButton">Process Selected Advance</button>' : ""}
      ${moduleKey === "communication-messages" ? '<button id="dispatchQueuedMessagesButton">Dispatch Queued</button>' : ""}
      ${moduleKey === "communication-messages" ? '<button id="openChatButton">Open Chat</button>' : ""}
    </div>
  `;
  document.getElementById("saveButton").onclick = saveCurrentModule;
  document.getElementById("clearButton").onclick = () => clearForm(config);
  document.getElementById("processButton").onclick = () => alert("Processing completed for this module.");
  document.getElementById("downloadPdfButton").onclick = exportPdf;
  document.getElementById("downloadExcelButton").onclick = exportExcel;
  document.getElementById("printButton").onclick = () => window.print();
  document.getElementById("viewButton").onclick = () => loadModuleData(config);
  if (moduleKey === "finance-payroll") {
    document.getElementById("autoGeneratePayrollButton")?.addEventListener("click", async () => {
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
    document.getElementById("processAdvanceButton")?.addEventListener("click", async () => {
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
    document.getElementById("dispatchQueuedMessagesButton")?.addEventListener("click", dispatchQueuedMessages);
    document.getElementById("openChatButton")?.addEventListener("click", openCommunicationChat);
  }
  loadModuleData(config);
}

function renderDashboardCards(stats) {
  document.getElementById("cards").innerHTML = Object.entries(stats)
    .map(
      ([key, value]) => `
      <div class="card stats-card metric-card metric-${escapeHtml(key)}">
        <h4>${DASHBOARD_STAT_LABELS[key] || key.replace(/([A-Z])/g, " $1")}</h4>
        <p>${key.toLowerCase().includes("fee") ? formatMoney(value) : formatNumber(value)}</p>
      </div>
    `
    )
    .join("");
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
    }
    const feeSummary = data.feeCollectionSummary || {};
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
      <div class="dashboard-grid">
        <section class="dashboard-section">
          <h3>Daily Attendance List</h3>
          <p class="small-note">Showing up to 40 latest records for today.</p>
          ${buildDashboardTable(
            ["Type", "Name", "Person ID", "Grade", "Stream", "Status", "Reason", "Attendance Time", "Time In", "Time Out"],
            attendanceRows
          )}
        </section>
        <section class="dashboard-section">
          <h3>Performance by Class/Grade & Stream</h3>
          ${buildDashboardTable(
            ["Grade", "Stream", "Learners", "Entries", "Mean", "Lowest", "Highest"],
            performanceRows
          )}
        </section>
        <section class="dashboard-section">
          <h3>Fee Collection Summary</h3>
          <div class="dashboard-metrics">
            <p><strong>Today:</strong> ${escapeHtml(formatMoney(feeSummary.todayTotal))} (${escapeHtml(formatNumber(feeSummary.todayPaymentsCount))} payment(s))</p>
            <p><strong>Month to Date:</strong> ${escapeHtml(formatMoney(feeSummary.monthTotal))} (${escapeHtml(formatNumber(feeSummary.monthPaymentsCount))} payment(s))</p>
            <p><strong>Year Total:</strong> ${escapeHtml(formatMoney(feeSummary.yearTotal))}</p>
            <p><strong>Year Target:</strong> ${escapeHtml(formatMoney(feeSummary.yearExpected))}</p>
            <p><strong>Variance:</strong> ${escapeHtml(formatMoney(feeSummary.yearVariance))}</p>
            <p><strong>Outstanding Balance:</strong> ${escapeHtml(formatMoney(feeSummary.outstandingBalanceTotal))} (${escapeHtml(formatNumber(feeSummary.learnersWithOutstandingBalance))} learner(s))</p>
          </div>
          <h4>Recent Fee Payments</h4>
          ${buildDashboardTable(
            ["Learner", "Adm No", "Grade", "Stream", "Amount", "Method", "Receipt", "Payment Date", "Balance"],
            recentPaymentsRows
          )}
          <h4>Learners with Outstanding Balances</h4>
          ${buildDashboardTable(["Learner", "Adm No", "Grade", "Stream", "Balance"], outstandingRows)}
        </section>
      </div>
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
      const ok = window.confirm("Delete selected record?");
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
      if (moduleConfigs[targetModule]) {
        renderCrudModule(targetModule);
      }
    });
  });
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

async function init() {
  try {
    [meta] = await Promise.all([request("/api/meta")]);
    const portalData = await request("/api/portal/current");
    portalContext = portalData || null;
    allowedModules = Array.isArray(portalData?.allowed_modules) ? portalData.allowed_modules : [];
    const meData = await request("/api/auth/me");
    const institutionName = String(
      meData?.institution_name || portalData?.institution_name || "Institution"
    ).trim();
    const roleLabel = formatRoleDisplay(portalData?.role || meData?.role || "");
    document.getElementById("portalLabel").textContent = `${institutionName} (${roleLabel})`;
    const buildLineEl = document.getElementById("iimsBuildLineDash");
    if (buildLineEl) {
      buildLineEl.textContent = "";
    }
    bindSidebar();
    bindTopbarButtons();
    bindQuickActionCards();
    await loadDashboard();
    renderPasswordPolicyBanner(meData, portalData);
    if (meData?.must_change_password) {
      alert("Password policy notice: your password was reset and must be changed immediately.");
    }
  } catch (error) {
    alert(error.message);
  }
}

window.editRow = editRow;
window.deleteRow = deleteRow;
window.dispatchCommunicationMessage = dispatchCommunicationMessage;
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
