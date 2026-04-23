const token = localStorage.getItem("token");
if (!token) {
  window.location.href = "/";
}

let meta = {};
let currentModule = "dashboard";
let currentEditId = null;
let allowedModules = [];
let portalContext = null;
const DASHBOARD_STAT_LABELS = {
  totalLearners: "Total Learners Population",
  totalPresent: "Present Today",
  totalAbsent: "Absent Today",
  totalBoys: "Total Boys",
  totalGirls: "Total Girls",
  totalLate: "Late Today",
  totalSuspended: "Suspended",
  totalExpelled: "Expelled",
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

async function renderSystemRegistration() {
  setActiveSidebarButton("system-register");
  document.getElementById("moduleTitle").textContent = "Register (Institution/User)";
  if (!isSystemAdminRole()) {
    alert("Only System Developer, HoI/Administrator can access registration center.");
    return loadDashboard();
  }
  try {
    const options = await request("/api/users/registrar-options");
    const institutionRows = Array.isArray(options?.institutions) ? options.institutions : [];
    const roleOptions = Array.isArray(options?.assignable_roles) ? options.assignable_roles : [];
    const canRegisterInstitution = Boolean(options?.can_register_institution);
    const canManageAllInstitutions = Boolean(options?.can_manage_all_institutions);
    const registrationMeta = options?.registration_meta || null;
    const defaultInstitutionId = Number(options?.institution_scope_id || 0) || Number(portalContext?.institution_id || 0) || 0;
    const defaultInstitution = institutionRows.find((item) => Number(item.id) === defaultInstitutionId) || institutionRows[0] || null;
    const defaultInstitutionCode = defaultInstitution?.institution_code || "";
    const defaultRole = roleOptions[0] || "";
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>Registration Center</h4>
        <p>${formatNumber(institutionRows.length)} institution record(s)</p>
      </div>
      <div class="card stats-card">
        <h4>Assignable Roles</h4>
        <p>${formatNumber(roleOptions.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Scope</h4>
        <p>${canManageAllInstitutions ? "Global (System Developer)" : "Institution only (HoI/Admin)"}</p>
      </div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Registration and Onboarding Center</h3>
        <p>All registration is done inside the system. HoI/Admin are restricted to their institution and cannot create System Developer, MoE, or TSC users.</p>
      </div>
      ${canRegisterInstitution ? `
      <div class="section-card">
        <div class="section-card-header">
          <h3>Register Institution (System Developer only)</h3>
          <p class="small-note">Creates institution and HoI/Administrator account in one secure flow.</p>
        </div>
        <div class="form-grid">
          <label>Institution Name</label>
          <input id="sysInstitutionName" placeholder="Institution name" />
          <label>County</label>
          ${
            registrationMeta?.counties?.length
              ? `<select id="sysInstitutionCounty">
            <option value="">Select county</option>
            ${registrationMeta.counties
              .map(
                (c) =>
                  `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${escapeHtml(c.code)})</option>`
              )
              .join("")}
          </select>`
              : `<input id="sysInstitutionCounty" placeholder="County (exact name)" />`
          }
          <label>County Code</label>
          <input id="sysInstitutionCountyCode" placeholder="e.g. 001" ${
            registrationMeta?.counties?.length ? 'readonly class="readonly-field"' : ""
          } />
          <label>Category</label>
          ${
            registrationMeta?.categories?.length
              ? `<select id="sysInstitutionCategory">
            <option value="">Select category</option>
            ${registrationMeta.categories
              .map(
                (c) =>
                  `<option value="${escapeHtml(c.label)}">${escapeHtml(c.label)} (${escapeHtml(c.code)})</option>`
              )
              .join("")}
          </select>`
              : `<input id="sysInstitutionCategory" placeholder="Category (e.g. Primary)" />`
          }
          <label>Sub County</label>
          <input id="sysInstitutionSubCounty" placeholder="Sub county (optional)" />
          <label>Location</label>
          <input id="sysInstitutionLocation" placeholder="Location (optional)" />
          <label>Village/Town</label>
          <input id="sysInstitutionVillage" placeholder="Village or town (optional)" />
          <label>Postal Code</label>
          ${
            registrationMeta?.postalCodes?.length
              ? `<select id="sysInstitutionPostalCode">
            <option value="">Optional — select postal code</option>
            ${registrationMeta.postalCodes
              .map(
                (p) =>
                  `<option value="${escapeHtml(String(p.postal_code))}">${escapeHtml(
                    String(p.postal_code)
                  )} — ${escapeHtml(p.town)}</option>`
              )
              .join("")}
          </select>`
              : `<input id="sysInstitutionPostalCode" placeholder="Postal code (optional)" />`
          }
          <label>Town (post office)</label>
          <input id="sysInstitutionTown" placeholder="Town (optional, or pick postal code above)" />
          <label>Institution Email</label>
          <input id="sysInstitutionEmail" placeholder="Email (optional)" />
          <label>Institution Phone</label>
          <input id="sysInstitutionPhone" placeholder="Phone (optional)" />
          <label>Admin Full Name</label>
          <input id="sysInstitutionAdminName" placeholder="HoI/Administrator full name" />
          <label>Admin Username</label>
          <input id="sysInstitutionAdminUsername" placeholder="Admin username" />
          <label>Admin Role</label>
          <select id="sysInstitutionAdminRole">
            <option value="ADMIN">HoI/Administrator</option>
            <option value="HEAD_OF_INSTITUTION">D/HoI</option>
          </select>
          <label>Admin Password</label>
          <input id="sysInstitutionAdminPassword" type="text" placeholder="Admin password (unless auto-generated)" />
          <label>Auto-generate password</label>
          <select id="sysInstitutionAutoPassword">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
          <label>Email agreement</label>
          <select id="sysInstitutionSendAgreement">
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </div>
        <div class="actions-row">
          <button id="sysRegisterInstitutionButton">Register Institution</button>
        </div>
      </div>
      ` : ""}
      <div class="section-card">
        <div class="section-card-header">
          <h3>Register User (Inside Institution Scope)</h3>
          <p class="small-note">System Developer can target any institution; HoI/Admin are locked to their own institution.</p>
        </div>
        <div class="form-grid">
          <label>Institution</label>
          <select id="sysUserInstitutionId">
            ${institutionRows
              .map(
                (item) =>
                  `<option value="${item.id}" ${Number(item.id) === Number(defaultInstitution?.id || 0) ? "selected" : ""}>${escapeHtml(
                    item.institution_name || "Institution"
                  )} (${escapeHtml(item.institution_code || "-")})</option>`
              )
              .join("")}
          </select>
          <label>Institution Code</label>
          <input id="sysUserInstitutionCodePreview" value="${escapeHtml(defaultInstitutionCode)}" readonly />
          <label>Full Name</label>
          <input id="sysUserFullName" placeholder="Full name" />
          <label>Username</label>
          <input id="sysUserUsername" placeholder="Username" />
          <label>Role</label>
          <select id="sysUserRole">
            ${roleOptions.map((role) => `<option value="${escapeHtml(role)}">${escapeHtml(toLabel(role))}</option>`).join("")}
          </select>
          <label>Email</label>
          <input id="sysUserEmail" placeholder="Email (optional)" />
          <label>Phone</label>
          <input id="sysUserPhone" placeholder="Phone (optional)" />
          <label>Password</label>
          <input id="sysUserPassword" type="text" placeholder="Password" />
          <label>Auto-generate password</label>
          <select id="sysUserAutoPassword">
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </div>
        <div class="actions-row">
          <button id="sysRegisterUserButton">Register User</button>
          <button id="refreshInstitutionRegistryButton">Refresh Registry</button>
        </div>
      </div>
      ${buildDashboardTable(
        ["Institution", "Code", "County", "Email", "Phone", "Created"],
        institutionRows.map((row) => [
          row.institution_name || "-",
          row.institution_code || "-",
          row.county || "-",
          row.email || "-",
          row.phone || "-",
          formatDateTime(row.created_at)
        ])
      )}
    `;
    resetDataTable("Registration center loaded.");
    const institutionSelect = document.getElementById("sysUserInstitutionId");
    const institutionCodePreview = document.getElementById("sysUserInstitutionCodePreview");
    const refreshInstitutionCodePreview = () => {
      if (!institutionSelect || !institutionCodePreview) return;
      const selected = institutionRows.find((item) => Number(item.id) === Number(institutionSelect.value));
      institutionCodePreview.value = selected?.institution_code || "";
    };
    if (institutionSelect) {
      if (!canManageAllInstitutions) {
        institutionSelect.disabled = true;
      }
      institutionSelect.addEventListener("change", refreshInstitutionCodePreview);
      refreshInstitutionCodePreview();
    }

    const countySelectEl = document.getElementById("sysInstitutionCounty");
    const countyCodeEl = document.getElementById("sysInstitutionCountyCode");
    const postalSelectEl = document.getElementById("sysInstitutionPostalCode");
    const townEl = document.getElementById("sysInstitutionTown");
    if (countySelectEl && countyCodeEl && registrationMeta?.counties?.length && countySelectEl.tagName === "SELECT") {
      const syncCountyCode = () => {
        const selected = registrationMeta.counties.find((c) => c.name === countySelectEl.value);
        countyCodeEl.value = selected?.code || "";
      };
      countySelectEl.addEventListener("change", syncCountyCode);
      syncCountyCode();
    }
    if (postalSelectEl && townEl && registrationMeta?.postalCodes?.length && postalSelectEl.tagName === "SELECT") {
      postalSelectEl.addEventListener("change", () => {
        const code = postalSelectEl.value;
        const selected = registrationMeta.postalCodes.find((p) => String(p.postal_code) === String(code));
        if (selected) townEl.value = selected.town || "";
      });
    }

    document.getElementById("sysRegisterInstitutionButton")?.addEventListener("click", async () => {
      try {
        const payload = {
          institution_name: String(document.getElementById("sysInstitutionName")?.value || "").trim(),
          county: String(document.getElementById("sysInstitutionCounty")?.value || "").trim(),
          county_code: String(document.getElementById("sysInstitutionCountyCode")?.value || "").trim(),
          category: String(document.getElementById("sysInstitutionCategory")?.value || "").trim(),
          sub_county: String(document.getElementById("sysInstitutionSubCounty")?.value || "").trim(),
          location: String(document.getElementById("sysInstitutionLocation")?.value || "").trim(),
          village: String(document.getElementById("sysInstitutionVillage")?.value || "").trim(),
          postal_code: String(document.getElementById("sysInstitutionPostalCode")?.value || "").trim(),
          town: String(document.getElementById("sysInstitutionTown")?.value || "").trim(),
          email: String(document.getElementById("sysInstitutionEmail")?.value || "").trim(),
          phone: String(document.getElementById("sysInstitutionPhone")?.value || "").trim(),
          admin_full_name: String(document.getElementById("sysInstitutionAdminName")?.value || "").trim(),
          admin_username: String(document.getElementById("sysInstitutionAdminUsername")?.value || "").trim(),
          admin_password: String(document.getElementById("sysInstitutionAdminPassword")?.value || ""),
          portal_role: String(document.getElementById("sysInstitutionAdminRole")?.value || "ADMIN"),
          auto_generate_password: String(document.getElementById("sysInstitutionAutoPassword")?.value || "true") === "true",
          send_agreement_email: String(document.getElementById("sysInstitutionSendAgreement")?.value || "false") === "true"
        };
        const result = await request("/api/institutions", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        alert(
          `Institution registered. Code: ${result.institution_code}. Admin: ${result.admin_username}.` +
          (result.admin_password ? ` Password: ${result.admin_password}` : "")
        );
        await renderSystemRegistration();
      } catch (error) {
        alert(error.message);
      }
    });

    document.getElementById("sysRegisterUserButton")?.addEventListener("click", async () => {
      try {
        const payload = {
          institution_id: Number(document.getElementById("sysUserInstitutionId")?.value || 0) || undefined,
          full_name: String(document.getElementById("sysUserFullName")?.value || "").trim(),
          username: String(document.getElementById("sysUserUsername")?.value || "").trim(),
          role: String(document.getElementById("sysUserRole")?.value || defaultRole),
          email: String(document.getElementById("sysUserEmail")?.value || "").trim(),
          phone: String(document.getElementById("sysUserPhone")?.value || "").trim()
        };
        const autoGenerate = String(document.getElementById("sysUserAutoPassword")?.value || "false") === "true";
        if (autoGenerate) {
          payload.password = `Aa1!${Math.random().toString(36).slice(-9)}#`;
        } else {
          payload.password = String(document.getElementById("sysUserPassword")?.value || "");
        }
        const result = await request("/api/users", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        alert(result.message || "User registered successfully.");
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("refreshInstitutionRegistryButton")?.addEventListener("click", renderSystemRegistration);
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
    const [users, metaData] = await Promise.all([request("/api/users"), request("/api/meta")]);
    const moduleKeys = Object.values(metaData?.moduleKeys || {});
    const defaultMap = metaData?.defaultModuleAccessByRole || {};
    const rows = (users || []).slice(0, 120);
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>Module Access Management</h4>
        <p>${formatNumber(rows.length)} user(s) available</p>
      </div>
      <div class="card stats-card">
        <h4>Available Modules</h4>
        <p>${formatNumber(moduleKeys.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Control</h4>
        <p>Per-user module overrides</p>
      </div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Module Rights Overrides</h3>
        <p>Select a user and override specific module access rights.</p>
      </div>
      <div class="form-grid">
        <label>User</label>
        <select id="moduleAccessUserSelect">
          <option value="">Select user...</option>
          ${rows
            .map(
              (user) =>
                `<option value="${user.id}" data-role="${escapeHtml(user.role || "")}" data-inst="${escapeHtml(
                  String(user.institution_id || "")
                )}">${escapeHtml(user.full_name || user.username || `User ${user.id}`)} (${escapeHtml(
                  user.username || "-"
                )}) • ${escapeHtml(user.role || "-")} • Inst ${escapeHtml(String(user.institution_id || "-"))}</option>`
            )
            .join("")}
        </select>
        <label>Module</label>
        <select id="moduleAccessModuleSelect">
          <option value="">Select module...</option>
          ${moduleKeys.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}
        </select>
        <label>Can Access</label>
        <select id="moduleAccessStateSelect">
          <option value="true">Allow</option>
          <option value="false">Deny</option>
        </select>
      </div>
      <div class="actions-row">
        <button id="saveModuleAccessButton">Save Override</button>
        <button id="showRoleDefaultsButton">Show Role Defaults</button>
      </div>
      <div id="moduleAccessInfo" class="small-note"></div>
    `;
    resetDataTable("Use controls above to manage module overrides.");
    document.getElementById("saveModuleAccessButton")?.addEventListener("click", async () => {
      const userId = Number(document.getElementById("moduleAccessUserSelect")?.value || 0);
      const moduleKey = String(document.getElementById("moduleAccessModuleSelect")?.value || "");
      const canAccess = String(document.getElementById("moduleAccessStateSelect")?.value || "true") === "true";
      if (!userId || !moduleKey) {
        alert("Select user and module first.");
        return;
      }
      try {
        const response = await request("/api/users/module-access", {
          method: "POST",
          body: JSON.stringify({
            user_id: userId,
            module_key: moduleKey,
            can_access: canAccess
          })
        });
        alert(response.message || "Module access override saved.");
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("showRoleDefaultsButton")?.addEventListener("click", () => {
      const selected = document.getElementById("moduleAccessUserSelect");
      const selectedRole = selected?.selectedOptions?.[0]?.dataset?.role || "";
      const defaults = Array.isArray(defaultMap[selectedRole]) ? defaultMap[selectedRole] : [];
      const info = document.getElementById("moduleAccessInfo");
      if (info) {
        info.textContent = selectedRole
          ? `Default modules for ${selectedRole}: ${defaults.join(", ") || "None"}`
          : "Select a user to view role defaults.";
      }
    });
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
    const logs = await request("/api/system/audit-logs?limit=200");
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
        <p>Track login outcomes, OTP validation, and account mutation events.</p>
      </div>
      <div class="dashboard-metrics">
        <p><strong>Failed login events (24h):</strong> ${formatNumber(logs?.metrics?.failed_login_events_24h || 0)}</p>
        <p><strong>OTP failure events (24h):</strong> ${formatNumber(logs?.metrics?.otp_fail_events_24h || 0)}</p>
      </div>
    `;
    const tableRows = rows.map((row) => [
      formatDateTime(row.created_at),
      row.actor_role || "-",
      row.action || "-",
      row.entity_name || "-",
      row.entity_id || "-",
      typeof row.details_json === "object" ? JSON.stringify(row.details_json) : row.details_json || "-"
    ]);
    const head = document.getElementById("tableHead");
    const body = document.getElementById("tableBody");
    if (head && body) {
      head.innerHTML = `<tr><th>When</th><th>Actor Role</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>Details</th></tr>`;
      body.innerHTML = tableRows
        .map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`)
        .join("");
      if (!tableRows.length) {
        resetDataTable("No audit log entries found.");
      }
    }
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
    const institutions = Array.isArray(registry?.institutions) ? registry.institutions : [];
    const users = Array.isArray(registry?.users) ? registry.users : [];
    const institutionRows = Array.isArray(institutions) ? institutions : [];
    const userRows = Array.isArray(users) ? users : [];
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
        <p>${escapeHtml(portalContext?.role || "-")}</p>
      </div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Institutions Registry</h3>
        <p>Review institutions and user accounts available in your scope.</p>
      </div>
      ${buildDashboardTable(
        ["Institution", "Code", "County", "Email", "Phone"],
        institutionRows.slice(0, 100).map((item) => [
          item.institution_name || "-",
          item.institution_code || "-",
          item.county || "-",
          item.email || "-",
          item.phone || "-"
        ])
      )}
    `;
    const head = document.getElementById("tableHead");
    const body = document.getElementById("tableBody");
    if (head && body) {
      head.innerHTML = "<tr><th>User</th><th>Username</th><th>Role</th><th>Institution ID</th><th>Status</th><th>Created</th></tr>";
      body.innerHTML = userRows
        .slice(0, 300)
        .map(
          (row) => `<tr>
            <td>${escapeHtml(row.full_name || "-")}</td>
            <td>${escapeHtml(row.username || "-")}</td>
            <td>${escapeHtml(row.role || "-")}</td>
            <td>${escapeHtml(String(row.institution_id || "-"))}</td>
            <td>${Number(row.is_active) === 1 ? "Active" : "Inactive"}</td>
            <td>${escapeHtml(formatDateTime(row.created_at))}</td>
          </tr>`
        )
        .join("");
      if (!userRows.length) {
        resetDataTable("No user records found.");
      }
    }
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
    document.getElementById("cards").innerHTML = `
      <div class="card stats-card metric-emphasis">
        <h4>Trashed Items</h4>
        <p>${formatNumber(rows.length)}</p>
      </div>
      <div class="card stats-card">
        <h4>Restore</h4>
        <p>Bring deleted records back</p>
      </div>
      <div class="card stats-card">
        <h4>Purge</h4>
        <p>Permanent cleanup control</p>
      </div>
    `;
    document.getElementById("formArea").innerHTML = `
      <div class="module-header-card">
        <h3>Recycle Bin Management</h3>
        <p>Restore records by recycle item ID or purge permanently.</p>
      </div>
      <div class="actions-row">
        <button id="restoreRecycleItemButton">Restore Item</button>
        <button id="purgeRecycleItemButton" class="danger">Purge Item</button>
        <button id="refreshRecycleBinButton">Refresh</button>
      </div>
    `;
    const head = document.getElementById("tableHead");
    const body = document.getElementById("tableBody");
    if (head && body) {
      head.innerHTML = "<tr><th>Recycle ID</th><th>Entity</th><th>Entity ID</th><th>Deleted At</th><th>Deleted By</th><th>Status</th></tr>";
      body.innerHTML = rows
        .map(
          (row) => `<tr>
            <td>${escapeHtml(String(row.id || "-"))}</td>
            <td>${escapeHtml(row.entity_name || "-")}</td>
            <td>${escapeHtml(String(row.entity_id || "-"))}</td>
            <td>${escapeHtml(formatDateTime(row.deleted_at))}</td>
            <td>${escapeHtml(String(row.deleted_by_user_id || "-"))}</td>
            <td>${escapeHtml(row.status || "-")}</td>
          </tr>`
        )
        .join("");
      if (!rows.length) {
        resetDataTable("Recycle bin is empty.");
      }
    }
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
      const ok = window.confirm("Purge permanently? This action cannot be undone.");
      if (!ok) return;
      try {
        const result = await request(`/api/system/recycle-bin/${recycleId}`, { method: "DELETE" });
        alert(result.message || "Item purged permanently.");
        await renderRecycleBin();
      } catch (error) {
        alert(error.message);
      }
    });
    document.getElementById("refreshRecycleBinButton")?.addEventListener("click", renderRecycleBin);
  } catch (error) {
    alert(error.message);
  }
}

async function renderCbcCurriculumEditor() {
  setActiveSidebarButton("system-cbc-editor");
  document.getElementById("moduleTitle").textContent = "CBC/CBE Management Module";
  if (!isSystemAdminRole()) {
    alert("Only System Developer, Admin, or Head of Institution can manage CBC curriculum editor.");
    return loadDashboard();
  }
  currentModule = "system-cbc-editor";
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
        <h3>CBC/CBE Management Module</h3>
        <p>Manage teacher materials, curriculum design, textbooks, and AI-generated simplified notes that support exam generation.</p>
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
        <button id="printCbcNotesButton">Print Notes</button>
        <button id="downloadCbcNotesButton">Download Notes</button>
        <button id="uploadCbcMaterialButton">Upload Material</button>
        <button id="amendCbcMaterialButton">Amend Material</button>
        <button id="refreshCbcEditorButton">Refresh</button>
      </div>
    `;
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
            .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
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

async function loadDashboard() {
  setActiveSidebarButton("dashboard");
  document.getElementById("moduleTitle").textContent = "Dashboard";
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
    const logRows = (data.systemActivityLogs || []).map((row) => [
      formatDateTime(row.created_at),
      row.actor_role || "-",
      row.action || "-",
      row.entity_name || "-",
      row.entity_id || "-"
    ]);
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
        <section class="dashboard-section">
          <h3>Alerts & Announcements</h3>
          <h4>System Alerts</h4>
          <div class="dashboard-alerts">
            ${alertsMarkup || '<p class="small-note">No alerts for today.</p>'}
          </div>
          <h4>Active Announcements</h4>
          <div class="dashboard-announcements">
            ${announcementMarkup || '<p class="small-note">No active announcements.</p>'}
          </div>
        </section>
        <section class="dashboard-section">
          <h3>System Activity Logs</h3>
          ${buildDashboardTable(["When", "Actor Role", "Action", "Entity", "Entity ID"], logRows)}
        </section>
      </div>
    `;
    document.getElementById("tableHead").innerHTML = "";
    document.getElementById("tableBody").innerHTML = "";
  } catch (error) {
    alert(error.message);
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

async function globalSearch() {
  setActiveSidebarButton(null);
  const q = document.getElementById("globalSearch").value.trim();
  if (!q) return;
  try {
    const result = await request(`/api/search/global?q=${encodeURIComponent(q)}`);
    document.getElementById("moduleTitle").textContent = `Search Results: ${q}`;
    const summaryDescription =
      portalContext?.role === "SYSTEM_DEVELOPER"
        ? "Cross-portal search intelligence view."
        : "Search intelligence view for your institution.";
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
              <option value="teachers">Teachers</option>
              <option value="parents-bom">Parents/BOM</option>
            </select>
          </div>
          <div>
            <label for="searchGradeFilter">Grade</label>
            <input id="searchGradeFilter" placeholder="e.g. Grade 7" />
          </div>
          <div>
            <label for="searchStreamFilter">Stream</label>
            <input id="searchStreamFilter" placeholder="e.g. Blue" />
          </div>
          <div>
            <label for="searchStatusFilter">Status</label>
            <input id="searchStatusFilter" placeholder="e.g. In Session, Active" />
          </div>
          <div>
            <label for="searchRoleFilter">Role</label>
            <input id="searchRoleFilter" placeholder="e.g. TEACHER, BOM, PARENT" />
          </div>
        </div>
        <div class="actions-row">
          <button id="applySearchFiltersButton">Apply Filters</button>
          <button id="clearSearchFiltersButton">Clear Filters</button>
        </div>
      </div>
    `;
    const learnersData = Array.isArray(result.learners) ? result.learners : [];
    const teachersData = Array.isArray(result.teachers) ? result.teachers : [];
    const parentsBomData = Array.isArray(result.parentsAndBom) ? result.parentsAndBom : [];
    let combinedRows = [...learnersData, ...teachersData, ...parentsBomData];
    renderTable(combinedRows);

    const applyFilters = () => {
      const scope = (document.getElementById("searchScope")?.value || "all").toLowerCase();
      const gradeFilter = (document.getElementById("searchGradeFilter")?.value || "").trim().toLowerCase();
      const streamFilter = (document.getElementById("searchStreamFilter")?.value || "").trim().toLowerCase();
      const statusFilter = (document.getElementById("searchStatusFilter")?.value || "").trim().toLowerCase();
      const roleFilter = (document.getElementById("searchRoleFilter")?.value || "").trim().toLowerCase();

      const sourceRows =
        scope === "learners"
          ? learnersData
          : scope === "teachers"
            ? teachersData
            : scope === "parents-bom"
              ? parentsBomData
              : combinedRows;
      const filteredRows = sourceRows.filter((row) => {
        const rowRole = String(row.role || "").toLowerCase();
        const rowGrade = String(row.grade || "").toLowerCase();
        const rowStream = String(row.stream || "").toLowerCase();
        const rowStatus = String(row.status || "").toLowerCase();
        if (gradeFilter && !rowGrade.includes(gradeFilter)) return false;
        if (streamFilter && !rowStream.includes(streamFilter)) return false;
        if (statusFilter && !rowStatus.includes(statusFilter)) return false;
        if (roleFilter && !rowRole.includes(roleFilter)) return false;
        return true;
      });
      renderTable(filteredRows);
      if (!filteredRows.length) {
        resetDataTable("No records match your selected filters.");
      }
    };

    document.getElementById("applySearchFiltersButton")?.addEventListener("click", applyFilters);
    document.getElementById("clearSearchFiltersButton")?.addEventListener("click", () => {
      ["searchGradeFilter", "searchStreamFilter", "searchStatusFilter", "searchRoleFilter"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      const scopeEl = document.getElementById("searchScope");
      if (scopeEl) scopeEl.value = "all";
      renderTable(combinedRows);
    });
  } catch (error) {
    alert(error.message);
  }
}

async function changeCredentials() {
  const currentPassword = prompt("Enter current password:");
  if (!currentPassword) return;
  const newUsername = prompt("Enter new username (optional):") || null;
  const newPassword = prompt("Enter new password (optional):") || null;
  try {
    await request("/api/profile/change-credentials", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_username: newUsername,
        new_password: newPassword
      })
    });
    alert("Credentials updated successfully.");
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
    .addEventListener("click", changeCredentials);
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

async function init() {
  try {
    [meta] = await Promise.all([request("/api/meta")]);
    const portalData = await request("/api/portal/current");
    portalContext = portalData || null;
    allowedModules = Array.isArray(portalData?.allowed_modules) ? portalData.allowed_modules : [];
    const meData = await request("/api/auth/me");
    document.getElementById("portalLabel").textContent = `${portalData.portal} (${portalData.role})`;
    const buildLineEl = document.getElementById("iimsBuildLineDash");
    if (buildLineEl) {
      fetch("/api/build-info")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const stamp = data?.build_stamp;
          buildLineEl.textContent = stamp ? `Release ${stamp} · UI v20` : "";
        })
        .catch(() => {
          buildLineEl.textContent = "";
        });
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
