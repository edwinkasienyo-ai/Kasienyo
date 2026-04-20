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

async function login() {
  const portalRole =
    document.getElementById("loginPortalRole")?.value ||
    document.getElementById("portalRole")?.value ||
    "";
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const otpChannel = document.getElementById("otpChannel").value;

  if (!portalRole) {
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
    if (data?.role && data.role !== portalRole) {
      setAuthNotice(`Selected role does not match account role (${data.role}).`, "error");
      return;
    }
    localStorage.setItem("pendingUsername", username);
    setAuthNotice(`${data.message} Portal: ${data.portal}`, "success");
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
  const institution_code = document.getElementById("registerInstitutionCode").value.trim();
  const email = document.getElementById("registerInstitutionEmail").value.trim();
  const phone = document.getElementById("registerInstitutionPhone").value.trim();
  const description = document.getElementById("registerInstitutionDescription").value.trim();
  const admin_full_name = document.getElementById("registerInstitutionAdminName").value.trim();
  const admin_username = document.getElementById("registerInstitutionAdminUsername").value.trim();
  const admin_password = document.getElementById("registerInstitutionAdminPassword").value;
  const portal_role = document.getElementById("registerInstitutionPortalRole").value;

  if (!institution_name || !institution_code || !admin_full_name || !admin_username || !admin_password) {
    setAuthNotice("Institution, code, admin name, admin username and admin password are required.", "error");
    return;
  }

  try {
    await request("/api/public/register-institution", {
      method: "POST",
      body: JSON.stringify({
        institution_name,
        institution_code,
        email,
        phone,
        description,
        admin_full_name,
        admin_username,
        admin_password,
        portal_role
      })
    });
    setAuthNotice("Institution and admin account registered successfully.", "success");
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

  if (!institution_code || !full_name || !username || !password || !role) {
    setAuthNotice("Complete institution code, name, username, password and role.", "error");
    return;
  }

  try {
    await request("/api/public/register-user", {
      method: "POST",
      body: JSON.stringify({ institution_code, full_name, username, password, portal_role: role, email, phone })
    });
    setAuthNotice("User registered successfully. Please login.", "success");
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
document.getElementById("registerInstitutionButton")?.addEventListener("click", registerInstitution);
document.getElementById("registerUserButton")?.addEventListener("click", registerUser);
document.getElementById("forgotUsernameButton")?.addEventListener("click", recoverUsername);
document.getElementById("forgotPasswordButton")?.addEventListener("click", resetPassword);

function bindAuthSectionLinks() {
  document.querySelectorAll("[data-auth-panel], .auth-link-btn[data-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.getAttribute("data-auth-panel") || button.getAttribute("data-target");
      if (!targetId) return;
      document.querySelectorAll(".auth-section").forEach((section) => {
        if (section.id === targetId) {
          section.hidden = !section.hidden;
        } else {
          section.hidden = true;
        }
      });
    });
  });
}

bindAuthSectionLinks();
