const API_BASE = "";

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 25000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal,
      ...options
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      throw new Error("Network timeout. Server slow or unreachable. Check the dev terminal for errors.");
    }
    throw new Error(`Network error: ${err?.message || "failed to fetch"}.  Is the server running on this URL?`);
  }
  clearTimeout(timer);
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
    el.textContent = `Release: ${stamp} · UI bundle rev41 — streams, timetable, discipline, parent read-only guard.`;
  } catch (_) {
    el.textContent =
      "Could not load release info. Ensure Node is running from your updated project (e.g. BASIC EDUCATION) and try again.";
  }
}

async function loadPublicHeroImage() {
  const heroImageEl = document.querySelector(".hero-image");
  if (!heroImageEl) return;
  const fallbackUrl = heroImageEl.getAttribute("src");
  const roleSelect = document.getElementById("loginPortalRole");
  const usernameInput = document.getElementById("username");
  const institutionCodeInput = document.getElementById("forgotPasswordInstitutionCode");
  const resolveInstitutionCodeFromUsername = async (usernameValue) => {
    const trimmed = String(usernameValue || "").trim();
    if (!trimmed) return null;
    try {
      const profile = await request(`/api/public/profile/by-username?username=${encodeURIComponent(trimmed)}`);
      return profile?.institution_code || null;
    } catch (_) {
      return null;
    }
  };
  const loadWithContext = async () => {
    const institutionCodeHint = String(institutionCodeInput?.value || "").trim();
    const usernameHint = String(usernameInput?.value || "").trim();
    const institutionCode =
      institutionCodeHint ||
      (await resolveInstitutionCodeFromUsername(usernameHint)) ||
      "";
    const params = new URLSearchParams();
    if (institutionCode) {
      params.set("institution_code", institutionCode);
    }
    const endpoint = `/api/public/branding/hero-image${params.toString() ? `?${params.toString()}` : ""}`;
    let data = null;
    try {
      data = await request(endpoint);
    } catch (_) {
      data = null;
    }
    const resolvedUrl = (data && data.hero_image_url) ? data.hero_image_url : fallbackUrl;
    heroImageEl.onerror = function onHeroLoadError() {
      if (!this.dataset.fallbackApplied) {
        this.dataset.fallbackApplied = "1";
        this.src = "/uploads/index.jpg";
        return;
      }
      if (!this.dataset.fallback2Applied) {
        this.dataset.fallback2Applied = "1";
        this.src = "/assets/imis-hero.jpg";
        return;
      }
      this.onerror = null;
      this.style.display = "none";
    };
    heroImageEl.src = resolvedUrl || fallbackUrl;
  };
  try {
    await loadWithContext();
  } catch (_) {
    heroImageEl.src = fallbackUrl;
  }
  roleSelect?.addEventListener("change", loadWithContext);
  usernameInput?.addEventListener("blur", loadWithContext);
  institutionCodeInput?.addEventListener("blur", loadWithContext);
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
  if (normalized === "SENIOR_TEACHER") {
    return "SENIOR_TEACHER";
  }
  if (normalized === "HEAD_OF_DEPARTMENT" || normalized === "HOD") {
    return "HEAD_OF_DEPARTMENT";
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
    const channelSummary = Array.isArray(data?.otp_delivery_log)
      ? ` Delivery: ${data.otp_delivery_log.join(", ")}.`
      : "";
    setAuthNotice(
      `${data.message || ""}${deliveredBy}.${channelSummary} Portal: ${data.portal}.`.trim(),
      "success"
    );
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
  const confirm_new_password = document.getElementById("forgotPasswordConfirmNewPassword")?.value;
  return {
    institution_code,
    username,
    contact_method,
    otp_channel,
    email,
    phone,
    otp,
    new_password,
    confirm_new_password
  };
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
    const logLine = Array.isArray(data?.otp_delivery_log)
      ? ` Details: ${data.otp_delivery_log.join(", ")}.`
      : "";
    setAuthNotice(`${data.message || "OTP requested."}${logLine}`, "success");
  } catch (error) {
    setAuthNotice(error.message, "error");
  }
}

async function resetPassword() {
  const { institution_code, username, contact_method, otp_channel, email, phone, otp, new_password, confirm_new_password } =
    collectForgotPasswordInputs();
  if (!institution_code || !username) {
    setAuthNotice("Institution code and username are required.", "error");
    return;
  }
  if (!otp || !new_password) {
    setAuthNotice("Enter OTP code and new password to complete reset.", "error");
    return;
  }
  if (!confirm_new_password) {
    setAuthNotice("Confirm your new password to continue.", "error");
    return;
  }
  if (new_password !== confirm_new_password) {
    setAuthNotice("New password and confirm new password must match.", "error");
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

const INDEX_PAGE_DETAILS = {
  about: {
    title: "About IMIS",
    path: "/about.html",
    html: `
      <p>The <strong>Integrated Management Information System (IMIS)</strong> is a secure, multi-tenant platform for basic education institutions.
      It brings together admissions, attendance, assessments, finance, compliance, and institutional registers in one audited environment.</p>
      <h3>What IMIS delivers</h3>
      <ul>
        <li>Role-based portals for System Developer, administrators, teachers, parents, learners, and service providers.</li>
        <li>Institution-scoped data isolation with optional institution letterhead on reports and dashboards.</li>
        <li>Strong authentication with one-time passwords (OTP) where required, plus detailed security audit trails.</li>
        <li>CBC/CBE-aligned workflows for curriculum, examinations, and learner progress tracking.</li>
      </ul>
      <h3>Developed by</h3>
      <p><strong>MWENDEGU ENTERPRISE LIMITED</strong> — contact: +254725757767 · mwendeguenterpriseltd@gmail.com</p>
    `
  },
  contact: {
    title: "Contact",
    path: "/contact.html",
    html: `
      <p>For implementation, training, or hosting support, use the channels below. Include your institution name and code where applicable.</p>
      <h3>Primary contact</h3>
      <ul>
        <li>Phone: <strong>+254725757767</strong></li>
        <li>Email: <strong>mwendeguenterpriseltd@gmail.com</strong></li>
      </ul>
      <h3>Response expectations</h3>
      <p>For production incidents, escalate through your Head of Institution first; the System Developer retains platform-wide oversight for security and tenancy issues.</p>
    `
  },
  privacy: {
    title: "Privacy Policy",
    path: "/privacy.html",
    html: `
      <p>IMIS processes institutional and personal data strictly for education administration, compliance, and agreed service delivery.</p>
      <h3>Key practices</h3>
      <ul>
        <li>Authentication events and OTP flows are logged for security; access is limited by role.</li>
        <li>Personal data is segmented by institution tenant so each school only sees its authorised scope.</li>
        <li>Retention for deleted records follows the platform recycle-bin policy (extended supervisory retention for authorised roles).</li>
      </ul>
      <p>For the full legal text, open the complete policy in a new tab.</p>
    `
  },
  terms: {
    title: "Terms of Service",
    path: "/terms.html",
    html: `
      <p>Use of IMIS is governed by your institution&apos;s licence or agreement with the platform operator.</p>
      <h3>Acceptable use</h3>
      <ul>
        <li>Use accounts only for authorised education and administration purposes.</li>
        <li>Do not share OTPs or credentials; report suspected compromise immediately.</li>
        <li>Respect Kenyan education regulations and institutional policies when entering data.</li>
      </ul>
    `
  },
  compliance: {
    title: "Compliance",
    path: "/compliance.html",
    html: `
      <p>IMIS is engineered to align with <strong>Kenya Basic Education Regulations, 2015</strong> and related ICT guidance for learner registers and oversight.</p>
      <h3>Operational readiness</h3>
      <ul>
        <li>Configurable registers for learners, staff, BOM, and service providers.</li>
        <li>Audit logs for authentication and privileged actions visible to authorised roles.</li>
        <li>Document workflows for procurement, policies, and institution-specific agreements.</li>
      </ul>
    `
  },
  support: {
    title: "Support",
    path: "/support.html",
    html: `
      <p>Operational support covers account access, onboarding, integrations, and best practices for CBC/CBE data capture.</p>
      <h3>Before opening a ticket</h3>
      <ul>
        <li>Confirm browser cache is refreshed and you are using a supported Chromium or Firefox-class browser.</li>
        <li>Verify OTP email/SMS settings with your administrator if codes do not arrive.</li>
      </ul>
    `
  },
  "support-compliance": {
    title: "Support &amp; Compliance",
    path: "/support-compliance.html",
    html: `
      <p>Combined reference for statutory alignment and escalation paths within IMIS deployments.</p>
      <ul>
        <li>Institution Heads coordinate day-to-day user access; System Developer retains tenancy and security sovereignty.</li>
        <li>Accessibility and security disclosures are maintained as separate public artefacts for transparency.</li>
      </ul>
    `
  },
  cookies: {
    title: "Cookie Notice",
    path: "/cookies.html",
    html: `
      <p>IMIS may use strictly necessary cookies and local storage tokens (for example session and build stamps) needed for secure login and UI stability.</p>
      <p>Analytics cookies, if introduced, would be disclosed in your deployment&apos;s configuration and institutional agreement.</p>
    `
  },
  security: {
    title: "Security",
    path: "/security.html",
    html: `
      <p>Security controls include OTP-backed authentication where configured, hashed passwords, rate limits on sensitive endpoints,
      structured audit trails, and role-scoped APIs.</p>
      <p>Deployments should follow <strong>security.txt</strong> disclosures for coordinated vulnerability reporting.</p>
    `
  },
  humans: {
    title: "Humans.txt",
    path: "/humans.txt",
    html: `
      <p>A plain-text index of the team and technology stack powering IMIS.</p>
      <pre style="white-space:pre-wrap;font-size:12px;background:#fff;border-radius:8px;padding:12px;border:1px solid #dce6ef;">/* TEAM */
Organization: MWENDEGU ENTERPRISE LIMITED
Product: INTEGRATED MANAGEMENT INFORMATION SYSTEM (IMIS)
Contact: mwendeguenterpriseltd@gmail.com
Phone: +254725757767

/* SITE */
Standards: HTML5, CSS3, JavaScript, Node.js, Express, MySQL
Security: /security.txt and /.well-known/security.txt</pre>
      <p><a href="/humans.txt" target="_blank" rel="noopener">View raw humans.txt</a></p>
    `
  },
  llms: {
    title: "LLMs.txt",
    path: "/llms.txt",
    html: `
      <p>Machine-oriented summary of public documentation URLs for assistants and tooling.</p>
      <pre style="white-space:pre-wrap;font-size:11px;background:#fff;border-radius:8px;padding:12px;border:1px solid #dce6ef;">Primary public URLs include /about.html, /contact.html, policies, accessibility, cookies, security, status, sitemap.xml, robots.txt, and site.webmanifest.</pre>
      <p><a href="/llms.txt" target="_blank" rel="noopener">View raw llms.txt</a></p>
    `
  },
  status: {
    title: "Service Status",
    path: "/status.html",
    html: `
      <p>Operational status for hosted IMIS deployments. Use this page during maintenance windows or incident communication.</p>
      <ul>
        <li>Healthy: API heartbeat at <code>/api/health</code> responds with service acknowledgement.</li>
        <li>Degraded: database or SMTP/SMS relays may delay OTP—check delivery logs.</li>
      </ul>
    `
  },
  accessibility: {
    title: "Accessibility Statement",
    path: "/accessibility.html",
    html: `
      <p>IMIS aims for perceptible contrast, scalable typography, meaningful focus order on forms (including OTP steps), and coherent labels on interactive controls.</p>
      <h3>Continuing improvement</h3>
      <ul>
        <li>Report accessibility barriers to your administrator with screenshots and browser version.</li>
        <li>Keyboard users: use Tab/Shift+Tab through role selection, credential fields, and recovery panels.</li>
      </ul>
    `
  }
};

function attachModalEscapeHandler(container, handler) {
  container.addEventListener("keydown", handler);
  const focusables = container.querySelectorAll(
    'a[href]:not([hidden]), button:not([disabled]):not([hidden]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
  );
  const list = [...focusables].filter((el) => el.offsetParent !== null);
  if (list.length) list[0].focus({ preventScroll: true });
  return () => container.removeEventListener("keydown", handler);
}

function openIndexLegalModal(pageKey) {
  const modal = document.getElementById("indexPageModal");
  const titleEl = document.getElementById("indexPageModalTitle");
  const bodyEl = document.getElementById("indexPageModalBody");
  const linkEl = document.getElementById("indexPageModalOpenNew");
  const config = INDEX_PAGE_DETAILS[pageKey];
  if (!modal || !titleEl || !bodyEl || !linkEl || !config) return;

  titleEl.textContent = config.title;
  bodyEl.innerHTML = config.html;
  linkEl.href = config.path;
  modal.hidden = false;
  document.body.style.overflow = "hidden";

  const modalPanel = modal.querySelector(".index-modal__panel");

  const onKeyDown = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeIndexLegalModal();
      return;
    }
    if (ev.key !== "Tab" || !modalPanel) return;
    const seq = [...modalPanel.querySelectorAll(
      'a[href]:not([hidden]), button:not([disabled]):not([hidden]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    )].filter((el) => el.offsetParent !== null);
    if (seq.length <= 1) return;
    const first = seq[0];
    const last = seq[seq.length - 1];
    if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    } else if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    }
  };

  if (modal._indexModalCleanup) modal._indexModalCleanup();
  modal._indexModalCleanup = attachModalEscapeHandler(modal, onKeyDown);
}

function closeIndexLegalModal() {
  const modal = document.getElementById("indexPageModal");
  if (!modal || modal.hidden) return;
  if (modal._indexModalCleanup) {
    modal._indexModalCleanup();
    modal._indexModalCleanup = null;
  }
  modal.hidden = true;
  document.body.style.overflow = "";
}

function bindIndexLegalFooters() {
  document.querySelectorAll(".legal-link-btn[data-index-page]").forEach((btn) =>
    btn.addEventListener("click", () => {
      openIndexLegalModal(btn.getAttribute("data-index-page"));
    })
  );

  document.getElementById("indexPageModal")?.addEventListener("click", (ev) => {
    if (ev.target?.closest("[data-index-modal-close]")) closeIndexLegalModal();
  });
}

document.getElementById("loginPortalRole")?.addEventListener("change", updateLoginFieldState);
initializeAuthPanels();
bindAuthSectionLinks();
bindIndexLegalFooters();
loadPublicHeroImage();
loadBuildStampLogin();
updateLoginFieldState();

document.getElementById("loginButton").addEventListener("click", login);
document.getElementById("verifyButton").addEventListener("click", verifyOtp);
document.getElementById("forgotUsernameButton")?.addEventListener("click", recoverUsername);
document.getElementById("forgotPasswordSendOtpButton")?.addEventListener("click", requestForgotPasswordOtp);
document.getElementById("forgotPasswordButton")?.addEventListener("click", resetPassword);
