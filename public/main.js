const API_BASE = "";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function setAuthNotice(message, type = "info") {
  const el = document.getElementById("authNotice");
  if (!el) return;
  el.textContent = message || "";
  el.className = `small-note auth-notice ${type}`;
}

let registrationMeta = null;
let lastRegisteredInstitution = null;

function normalizeRoleValue(role) {
  const normalized = String(role || "").trim().toUpperCase().replaceAll(/[\s-]+/g, "_");
  if (normalized === "NON_TEACHING" || normalized === "NONTEACHING" || normalized === "NON_TEACHING_STAFF") {
    return "NON_TEACHING_STAFF";
  }
  if (normalized === "HEAD" || normalized === "HEAD_OF_SCHOOL") {
    return "HEAD_OF_INSTITUTION";
  }
  if (normalized === "BOARD_OF_MANAGEMENT") {
    return "BOM";
  }
  if (normalized === "SYSTEMDEVELOPER") {
    return "SYSTEM_DEVELOPER";
  }
  return normalized;
}

async function loadRegistrationMeta() {
  try {
    registrationMeta = await request("/api/public/registration/meta");
  } catch (error) {
    setAuthNotice(`Registration metadata unavailable: ${error.message}`, "error");
    return;
  }

  const countySelect = document.getElementById("registerInstitutionCounty");
  if (countySelect) {
    countySelect.innerHTML = '<option value="">Select county</option>' + (registrationMeta.counties || [])
      .map((county) => `<option value="${county.name}">${county.name}</option>`)
      .join("");
  }

  const categorySelect = document.getElementById("registerInstitutionCategory");
  if (categorySelect) {
    categorySelect.innerHTML = '<option value="">Select category</option>' + (registrationMeta.categories || [])
      .map((category) => `<option value="${category.label}">${category.label}</option>`)
      .join("");
  }

  const postalSelect = document.getElementById("registerInstitutionPostalCode");
  if (postalSelect) {
    postalSelect.innerHTML = '<option value="">Select postal code</option>' + (registrationMeta.postalCodes || [])
      .map((entry) => `<option value="${entry.postal_code}">${entry.postal_code} - ${entry.town}</option>`)
      .join("");
  }
}

function bindInstitutionAutoFields() {
  const countySelect = document.getElementById("registerInstitutionCounty");
  const postalSelect = document.getElementById("registerInstitutionPostalCode");
  const countyCodeInput = document.getElementById("registerInstitutionCountyCode");
  const townInput = document.getElementById("registerInstitutionTown");

  if (countySelect && countyCodeInput) {
    countySelect.addEventListener("change", () => {
      const selected = (registrationMeta?.counties || []).find((county) => county.name === countySelect.value);
      countyCodeInput.value = selected?.code || "";
    });
  }

  if (postalSelect && townInput) {
    postalSelect.addEventListener("change", () => {
      const selected = (registrationMeta?.postalCodes || []).find(
        (entry) => String(entry.postal_code) === String(postalSelect.value)
      );
      townInput.value = selected?.town || "";
    });
  }
}

async function login() {
  const selectedPortalRole = normalizeRoleValue(
    document.getElementById("loginPortalRole")?.value ||
    document.getElementById("portalRole")?.value ||
    ""
  );
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const otpChannel = document.getElementById("otpChannel").value;

  if (!selectedPortalRole) {
    setAuthNotice("Choose portal role first.", "error");
    return;
  }
  if (!username || !password) {
    alert("Username and password are required.");
    return;
  }

  try {
    const data = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, otpChannel })
    });
    const accountRole = normalizeRoleValue(data?.role);
    if (accountRole && accountRole !== selectedPortalRole) {
      setAuthNotice(
        `Selected role does not match account role (${data.role}). Choose the correct role and retry.`,
        "error"
      );
      return;
    }
    localStorage.setItem("pendingUsername", username);
    const deliveredBy = data?.otp_channel_used ? ` via ${data.otp_channel_used}` : "";
    const otpPreviewMessage = data?.otp_preview
      ? ` OTP (for testing): ${data.otp_preview}`
      : "";
    setAuthNotice(`${data.message}${deliveredBy}. Portal: ${data.portal}.${otpPreviewMessage}`, "success");
  } catch (error) {
    setAuthNotice(error.message, "error");
  }
}

async function verifyOtp() {
  const otp = document.getElementById("otp").value.trim();
  const username = localStorage.getItem("pendingUsername") || document.getElementById("username").value.trim();

  if (!username || !otp) {
    alert("Username and OTP are required.");
    return;
  }

  try {
    const data = await request("/api/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ username, otp })
    });
    localStorage.setItem("token", data.token);
    localStorage.setItem("portal", data.portal);
    localStorage.removeItem("pendingUsername");
    window.location.href = "/dashboard.html";
  } catch (error) {
    setAuthNotice(error.message, "error");
  }
}

async function registerInstitution() {
  const institution_name = document.getElementById("registerInstitutionName").value.trim();
  const email = document.getElementById("registerInstitutionEmail").value.trim();
  const phone = document.getElementById("registerInstitutionPhone").value.trim();
  const description = document.getElementById("registerInstitutionDescription").value.trim();
  const county = document.getElementById("registerInstitutionCounty").value.trim();
  const category = document.getElementById("registerInstitutionCategory").value.trim();
  const county_code = document.getElementById("registerInstitutionCountyCode").value.trim();
  const postal_code = document.getElementById("registerInstitutionPostalCode").value.trim();
  const town = document.getElementById("registerInstitutionTown").value.trim();
  const sendAgreementEmail = Boolean(document.getElementById("registerInstitutionSendAgreement")?.checked);
  const autoGeneratePassword = Boolean(document.getElementById("registerInstitutionAutoPassword")?.checked);
  const admin_full_name = document.getElementById("registerInstitutionAdminName").value.trim();
  const admin_username = document.getElementById("registerInstitutionAdminUsername").value.trim();
  const admin_password = document.getElementById("registerInstitutionAdminPassword").value;
  const portal_role = document.getElementById("registerInstitutionPortalRole").value;

  if (!institution_name || !county || !category || !admin_full_name || !admin_username) {
    setAuthNotice("Institution, county, category, admin name and admin username are required.", "error");
    return;
  }
  if (!autoGeneratePassword && !admin_password) {
    setAuthNotice("Provide admin password or enable auto-generate password.", "error");
    return;
  }

  try {
    const data = await request("/api/public/register-institution", {
      method: "POST",
      body: JSON.stringify({
        institution_name,
        description,
        email,
        phone,
        county,
        category,
        county_code,
        postal_code,
        town,
        send_agreement_email: sendAgreementEmail,
        auto_generate_password: autoGeneratePassword,
        admin_full_name,
        admin_username,
        admin_password,
        portal_role
      })
    });
    lastRegisteredInstitution = data || null;
    const generatedCodeInput = document.getElementById("registerInstitutionCode");
    if (generatedCodeInput && data?.institution_code) {
      generatedCodeInput.value = data.institution_code;
    }
    const agreementUrl = data?.agreement_pdf_url ? ` Agreement: ${data.agreement_pdf_url}` : "";
    const passwordInfo = data?.admin_password ? ` Password: ${data.admin_password}` : "";
    setAuthNotice(
      `Institution registered. Code: ${data.institution_code}. Admin: ${data.admin_username}.${passwordInfo}${agreementUrl}`,
      "success"
    );
  } catch (error) {
    setAuthNotice(error.message, "error");
  }
}

async function registerUser() {
  const institution_code = document.getElementById("registerUserInstitutionCode").value.trim();
  const full_name = document.getElementById("registerUserFullName").value.trim();
  const username = document.getElementById("registerUserUsername").value.trim();
  const password = document.getElementById("registerUserPassword").value;
  const role = document.getElementById("registerUserRole").value;
  const email = document.getElementById("registerUserEmail").value.trim();
  const phone = document.getElementById("registerUserPhone").value.trim();
  const autoGeneratePassword = Boolean(document.getElementById("registerUserAutoPassword")?.checked);

  if (!institution_code || !full_name || !username || !role) {
    setAuthNotice("Complete institution code, name, username and role.", "error");
    return;
  }
  if (!autoGeneratePassword && !password) {
    setAuthNotice("Provide password or enable auto-generate password.", "error");
    return;
  }

  try {
    const data = await request("/api/public/register-user", {
      method: "POST",
      body: JSON.stringify({
        institution_code,
        full_name,
        username,
        password,
        portal_role: role,
        email,
        phone,
        auto_generate_password: autoGeneratePassword
      })
    });
    const passwordInfo = data?.password ? ` Password: ${data.password}` : "";
    setAuthNotice(`User registered successfully.${passwordInfo}`, "success");
  } catch (error) {
    setAuthNotice(error.message, "error");
  }
}

async function recoverUsername() {
  const institution_code = document.getElementById("forgotUsernameInstitutionCode").value.trim();
  const email = document.getElementById("forgotUsernameEmail").value.trim();
  const phone = document.getElementById("forgotUsernamePhone").value.trim();
  if (!institution_code || (!email && !phone)) {
    setAuthNotice("Institution code and email or mobile are required.", "error");
    return;
  }
  try {
    const data = await request("/api/public/forgot-username", {
      method: "POST",
      body: JSON.stringify({
        institution_code,
        email,
        phone
      })
    });
    const list = Array.isArray(data.usernames) ? data.usernames : [];
    if (!list.length) {
      setAuthNotice("No username found for the supplied details.", "error");
      return;
    }
    const usernames = list.map((item) => item.username).join(", ");
    setAuthNotice(`Recovered username(s): ${usernames}`, "success");
  } catch (error) {
    setAuthNotice(error.message, "error");
  }
}

async function resetPassword() {
  const institution_code = document.getElementById("forgotPasswordInstitutionCode").value.trim();
  const username = document.getElementById("forgotPasswordUsername").value.trim();
  const new_password = document.getElementById("forgotPasswordNewPassword").value;
  const email = document.getElementById("forgotPasswordEmail").value.trim();
  const phone = document.getElementById("forgotPasswordPhone").value.trim();
  if (!institution_code || !username || !new_password || (!email && !phone)) {
    setAuthNotice("Institution code, username, new password and email or mobile are required.", "error");
    return;
  }
  try {
    await request("/api/public/forgot-password", {
      method: "POST",
      body: JSON.stringify({
        institution_code,
        username,
        new_password,
        email,
        phone
      })
    });
    setAuthNotice("Password reset successful. Login with new password.", "success");
  } catch (error) {
    setAuthNotice(error.message, "error");
  }
}

function previewAgreement() {
  const institutionId = lastRegisteredInstitution?.institution_id;
  if (!institutionId) {
    setAuthNotice("Register an institution first before previewing agreement.", "error");
    return;
  }
  window.open(`/api/public/institutions/${institutionId}/agreement.pdf`, "_blank");
}

async function sendAgreementNow() {
  const institutionId = lastRegisteredInstitution?.institution_id;
  if (!institutionId) {
    setAuthNotice("Register an institution first before sending agreement.", "error");
    return;
  }
  try {
    const data = await request(`/api/public/institutions/${institutionId}/agreement/send`, {
      method: "POST"
    });
    setAuthNotice(data.message || "Agreement dispatch completed.", "success");
  } catch (error) {
    setAuthNotice(error.message, "error");
  }
}

document.getElementById("loginButton").addEventListener("click", login);
document.getElementById("verifyButton").addEventListener("click", verifyOtp);
document.getElementById("registerInstitutionButton")?.addEventListener("click", registerInstitution);
document.getElementById("registerUserButton")?.addEventListener("click", registerUser);
document.getElementById("forgotUsernameButton")?.addEventListener("click", recoverUsername);
document.getElementById("forgotPasswordButton")?.addEventListener("click", resetPassword);
document.getElementById("previewInstitutionAgreementButton")?.addEventListener("click", previewAgreement);
document.getElementById("sendInstitutionAgreementButton")?.addEventListener("click", sendAgreementNow);

function bindAuthSectionLinks() {
  document.querySelectorAll("[data-auth-panel], .auth-link-btn[data-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.getAttribute("data-auth-panel") || button.getAttribute("data-target");
      if (!targetId) return;
      document.querySelectorAll("[data-auth-panel], .auth-link-btn[data-target]").forEach((btn) => {
        btn.classList.toggle(
          "active",
          (btn.getAttribute("data-auth-panel") || btn.getAttribute("data-target")) === targetId
        );
      });
      document.querySelectorAll(".auth-panel, .auth-section").forEach((section) => {
        if (section.id === targetId) {
          section.hidden = false;
        } else {
          section.hidden = true;
        }
      });
    });
  });
}

function initializeAuthPanels() {
  document.querySelectorAll(".auth-panel").forEach((section) => {
    section.hidden = true;
  });
  document.querySelectorAll("[data-auth-panel], .auth-link-btn[data-target]").forEach((button) => {
    button.classList.remove("active");
  });
}

initializeAuthPanels();
bindAuthSectionLinks();
loadRegistrationMeta();
bindInstitutionAutoFields();
