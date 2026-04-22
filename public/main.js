const API_BASE = "";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
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

async function loadBuildStampLogin() {
  const el = document.getElementById("iimsBuildLineLogin");
  if (!el) return;
  try {
    let response = await fetch("/api/build-info");
    if (!response.ok) {
      response = await fetch("/api/building-info");
    }
    const data = response.ok ? await response.json() : null;
    const stamp = data?.build_stamp || "unknown";
    el.textContent = `Release: ${stamp} · UI v20 — production-ready index and legal/public pages synchronized.`;
  } catch (_) {
    el.textContent =
      "Could not load release info. Ensure Node is running from your updated project (e.g. BASIC EDUCATION) and try again.";
  }
}

async function loadPublicHeroImage() {
  const heroImageEl = document.querySelector(".hero-image");
  if (!heroImageEl) return;
  const fallbackUrl = heroImageEl.getAttribute("src");
  try {
    const data = await request("/api/public/branding/hero-image");
    const staticPriorityUrl = "/assets/imis-hero.jpg";
    const resolvedUrl = data?.hero_image_url || fallbackUrl;
    const resolvedIsDefaultUpload =
      typeof resolvedUrl === "string" && resolvedUrl.includes("/uploads/index-hero.");
    const finalUrl = resolvedIsDefaultUpload ? staticPriorityUrl : resolvedUrl;
    const preferredFinalUrl = finalUrl || staticPriorityUrl || fallbackUrl;
    heroImageEl.onerror = function onHeroLoadError() {
      this.onerror = null;
      this.src = fallbackUrl;
    };
    heroImageEl.src = preferredFinalUrl;
  } catch (_) {
    heroImageEl.src = fallbackUrl;
  }
}

function setAuthNotice(message, type = "info") {
  const el = document.getElementById("authNotice");
  if (!el) return;
  el.textContent = message || "";
  el.className = `small-note auth-notice ${type}`;
}

function normalizeRoleValue(role) {
  const normalized = String(role || "").trim().toUpperCase().replaceAll(/[\s-]+/g, "_");
  if (normalized === "NON_TEACHING" || normalized === "NONTEACHING" || normalized === "NON_TEACHING_STAFF") {
    return "NON_TEACHING_STAFF";
  }
  if (normalized === "SUPPORT_STAFF") {
    return "NON_TEACHING_STAFF";
  }
  if (normalized === "HEAD" || normalized === "HEAD_OF_SCHOOL") {
    return "HEAD_OF_INSTITUTION";
  }
  if (
    normalized === "HOI" ||
    normalized === "HOI_ADMINISTRATOR" ||
    normalized === "HOI_ADMIN" ||
    normalized === "D_HOI" ||
    normalized === "DEPUTY_HOI" ||
    normalized === "DEPUTY_HEAD_OF_INSTITUTION"
  ) {
    return "HEAD_OF_INSTITUTION";
  }
  if (normalized === "BOARD_OF_MANAGEMENT") {
    return "BOM";
  }
  if (normalized === "BOM_MEMBER") {
    return "BOM";
  }
  if (normalized === "PARENT_GUARDIAN") {
    return "PARENT";
  }
  if (
    normalized === "SUPPLIERS_CONTRACTORS_SERVICE_PROVIDERS" ||
    normalized === "SUPPLIERS_CONTUCTORS_SERVICE_PROVIDERS" ||
    normalized === "SUPPLIER_CONTRACTOR_SERVICE_PROVIDER" ||
    normalized === "SERVICE_PROVIDER"
  ) {
    return "SUPPLIER";
  }
  if (normalized === "MOE" || normalized === "MINISTRY_OF_EDUCATION_MOE") {
    return "MOD";
  }
  if (normalized === "SYSTEMDEVELOPER") {
    return "SYSTEM_DEVELOPER";
  }
  return normalized;
}

function validateUsernameValue(username, fieldLabel = "Username") {
  const value = String(username || "").trim();
  if (!value) return `${fieldLabel} is required.`;
  if (value.length < 5) return `${fieldLabel} must be at least 5 characters.`;
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    return `${fieldLabel} can only contain letters, numbers, dot, underscore, or dash.`;
  }
  return null;
}

function updateLoginFieldState() {
  const selectedPortalRole = normalizeRoleValue(
    document.getElementById("loginPortalRole")?.value ||
    document.getElementById("portalRole")?.value ||
    ""
  );
  const isRoleSelected = Boolean(selectedPortalRole);
  const controlledInputIds = ["username", "password", "otpChannel", "otp"];
  controlledInputIds.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.disabled = !isRoleSelected;
    }
  });
  const loginButton = document.getElementById("loginButton");
  if (loginButton) {
    loginButton.disabled = !isRoleSelected;
  }
  const verifyButton = document.getElementById("verifyButton");
  if (verifyButton) {
    verifyButton.disabled = !isRoleSelected;
  }
  if (!isRoleSelected) {
    setAuthNotice("Choose portal role to activate username, password, OTP channel, and OTP code fields.", "info");
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
  const usernameValidationError = validateUsernameValue(username, "Username");
  if (usernameValidationError) {
    setAuthNotice(usernameValidationError, "error");
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
    setAuthNotice(`${data.message}${deliveredBy}. Portal: ${data.portal}.`, "success");
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

async function recoverUsername() {
  const guidance = document.getElementById("forgotUsernameGuidance");
  if (guidance) {
    guidance.hidden = false;
    guidance.textContent =
      "For username recovery, contact your Institution Administrator or the System Developer.";
  }
  setAuthNotice("Username recovery guidance is shown below.", "info");
}

function collectForgotPasswordInputs() {
  const institution_code = document.getElementById("forgotPasswordInstitutionCode")?.value.trim();
  const username = document.getElementById("forgotPasswordUsername")?.value.trim();
  const contact_method = document.getElementById("forgotPasswordContactMethod")?.value || "email";
  const otp_channel = document.getElementById("forgotPasswordOtpChannel")?.value || "email";
  const email = document.getElementById("forgotPasswordEmail")?.value.trim();
  const phone = document.getElementById("forgotPasswordPhone")?.value.trim();
  const otp = document.getElementById("forgotPasswordOtp")?.value.trim();
  const new_password = document.getElementById("forgotPasswordNewPassword")?.value;
  return { institution_code, username, contact_method, otp_channel, email, phone, otp, new_password };
}

async function requestForgotPasswordOtp() {
  const { institution_code, username, contact_method, otp_channel, email, phone } = collectForgotPasswordInputs();
  if (!institution_code) {
    setAuthNotice("Institution code is required.", "error");
    return;
  }
  if (!username) {
    setAuthNotice("Username is required.", "error");
    return;
  }
  if (contact_method === "email" && !email) {
    setAuthNotice("Email is required when contact method is Email.", "error");
    return;
  }
  if (contact_method === "phone" && !phone) {
    setAuthNotice("Mobile number is required when contact method is Mobile.", "error");
    return;
  }
  if (otp_channel === "email" && !email) {
    setAuthNotice("Provide email to receive OTP by email.", "error");
    return;
  }
  if (otp_channel === "sms" && !phone) {
    setAuthNotice("Provide mobile number to receive OTP by SMS.", "error");
    return;
  }

  try {
    const data = await request("/api/public/forgot-password", {
      method: "POST",
      body: JSON.stringify({
        institution_code,
        username,
        contact_method,
        otp_channel,
        email,
        phone
      })
    });
    setAuthNotice(data.message || "OTP sent for password reset.", "success");
  } catch (error) {
    setAuthNotice(error.message, "error");
  }
}

async function resetPassword() {
  const { institution_code, username, contact_method, otp_channel, email, phone, otp, new_password } =
    collectForgotPasswordInputs();
  if (!institution_code || !username) {
    setAuthNotice("Institution code and username are required.", "error");
    return;
  }
  if (!otp || !new_password) {
    setAuthNotice("Enter OTP code and new password to complete reset.", "error");
    return;
  }
  try {
    const data = await request("/api/public/forgot-password", {
      method: "POST",
      body: JSON.stringify({
        institution_code,
        username,
        contact_method,
        otp_channel,
        email,
        phone,
        otp,
        new_password
      })
    });
    setAuthNotice(data.message || "Password reset successful. Login with new password.", "success");
  } catch (error) {
    setAuthNotice(error.message, "error");
  }
}

document.getElementById("loginButton").addEventListener("click", login);
document.getElementById("verifyButton").addEventListener("click", verifyOtp);
document.getElementById("forgotUsernameButton")?.addEventListener("click", recoverUsername);
document.getElementById("forgotPasswordSendOtpButton")?.addEventListener("click", requestForgotPasswordOtp);
document.getElementById("forgotPasswordButton")?.addEventListener("click", resetPassword);

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

document.getElementById("loginPortalRole")?.addEventListener("change", updateLoginFieldState);
initializeAuthPanels();
bindAuthSectionLinks();
loadPublicHeroImage();
loadBuildStampLogin();
updateLoginFieldState();
