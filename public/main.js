const API_BASE = "";
const UI_BUILD_VERSION = "20260418-2";

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

async function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const otpChannel = document.getElementById("otpChannel").value;

  if (!username || !password) {
    alert("Username and password are required.");
    return;
  }

  try {
    const data = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, otpChannel })
    });
    localStorage.setItem("pendingUsername", username);
    alert(`${data.message} Portal: ${data.portal}`);
  } catch (error) {
    alert(error.message);
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
    window.location.href = `/dashboard.html?v=${encodeURIComponent(UI_BUILD_VERSION)}`;
  } catch (error) {
    alert(error.message);
  }
}

document.getElementById("loginButton").addEventListener("click", login);
document.getElementById("verifyButton").addEventListener("click", verifyOtp);
