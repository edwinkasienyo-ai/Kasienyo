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

async function loadPublicHeroImage() {
  const heroImageEl = document.querySelector(".hero-image");
  const heroPanelEl = document.querySelector(".hero-panel");
  if (!heroImageEl || !heroPanelEl) return;
  const fallbackUrl = heroImageEl.getAttribute("src");
  try {
    const data = await request("/api/public/branding/hero-image");
    const resolvedUrl = data?.hero_image_url || fallbackUrl;
    heroImageEl.src = resolvedUrl;
    heroPanelEl.style.setProperty("--hero-image-url", `url("${resolvedUrl}")`);
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
  if (selectedPortalRole === "SYSTEM_DEVELOPER" && username && username !== "952252") {
    setAuthNotice("System Developer default username is 952252 (unless amended).", "error");
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

document.getElementById("loginButton").addEventListener("click", login);
document.getElementById("verifyButton").addEventListener("click", verifyOtp);
document.getElementById("forgotUsernameButton")?.addEventListener("click", recoverUsername);
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
updateLoginFieldState();
