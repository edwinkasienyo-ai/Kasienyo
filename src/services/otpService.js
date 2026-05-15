const nodemailer = require("nodemailer");
const twilio = require("twilio");

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);

// =============================================================================
// OTP CODE & EXPIRY
// =============================================================================
function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function buildOtpExpiry() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + OTP_EXPIRY_MINUTES);
  return now;
}

// =============================================================================
// PROVIDER READINESS
// =============================================================================
function smtpReady() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
function sendgridReady() {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM);
}
function twilioSmsReady() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}
function twilioVerifyReady() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_VERIFY_SERVICE_SID
  );
}
function africasTalkingReady() {
  return Boolean(
    process.env.AT_API_KEY &&
      process.env.AT_USERNAME &&
      process.env.AT_FROM
  );
}

/** True if any wired email backend can dispatch OTP (matches sendEmailOtp). */
function emailChannelReady() {
  return sendgridReady() || smtpReady();
}

/** True if any wired SMS backend can dispatch OTP (matches sendSmsOtp). */
function smsChannelReady() {
  return africasTalkingReady() || twilioSmsReady();
}

// =============================================================================
// EMAIL PROVIDERS
// =============================================================================
async function sendEmailViaSendgrid({ to, subject, text }) {
  // SendGrid HTTP API — typically responds in ~150ms vs SMTP cold start (3-10s).
  const body = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: process.env.SENDGRID_FROM, name: process.env.SENDGRID_FROM_NAME || "IMIS" },
    subject,
    content: [{ type: "text/plain", value: text }]
  };
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`SendGrid error ${res.status}: ${errText.slice(0, 240)}`);
  }
}

let cachedSmtpTransporter = null;
function buildMailTransporter() {
  if (cachedSmtpTransporter) return cachedSmtpTransporter;
  cachedSmtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    pool: true,
    maxConnections: 3,
    maxMessages: 50
  });
  return cachedSmtpTransporter;
}

async function sendEmailViaSmtp({ to, subject, text }) {
  const transporter = buildMailTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text
  });
}

async function sendEmailOtp(destination, code) {
  const subject = "IMIS OTP Verification Code";
  const text = `Your IMIS OTP is ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes. Never share this code.`;

  return sendTransactionalEmail({ to: destination, subject, text });
}

async function sendTransactionalEmail({ to, subject, text }) {
  if (!to || !subject) {
    throw new Error("Transactional email requires to and subject.");
  }
  const bodyText = text || "";

  // Prefer SendGrid (faster, more reliable). Fall back to SMTP.
  if (sendgridReady()) {
    try {
      await sendEmailViaSendgrid({ to, subject, text: bodyText });
      return;
    } catch (err) {
      if (!smtpReady()) throw err;
      // SendGrid failed; try SMTP fallback below.
      // eslint-disable-next-line no-console
      console.warn(`[otp] SendGrid failed, falling back to SMTP: ${err.message}`);
    }
  }

  if (!smtpReady()) {
    throw new Error("No email provider configured. Set SENDGRID_API_KEY+SENDGRID_FROM or SMTP_*");
  }
  await sendEmailViaSmtp({ to, subject, text: bodyText });
}

// =============================================================================
// SMS PROVIDERS
// =============================================================================
async function sendSmsViaAfricasTalking({ to, text }) {
  // Africa's Talking REST API — much faster + cheaper for Kenyan numbers
  // than international Twilio. Endpoint changes between sandbox + live.
  const isSandbox = String(process.env.AT_USERNAME || "").toLowerCase() === "sandbox";
  const endpoint = isSandbox
    ? "https://api.sandbox.africastalking.com/version1/messaging"
    : "https://api.africastalking.com/version1/messaging";

  const params = new URLSearchParams();
  params.append("username", process.env.AT_USERNAME);
  params.append("to", to);
  params.append("message", text);
  if (process.env.AT_FROM) params.append("from", process.env.AT_FROM);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      apiKey: process.env.AT_API_KEY
    },
    body: params.toString()
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`AfricasTalking ${res.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }
  const recipients = json?.SMSMessageData?.Recipients || [];
  const failed = recipients.filter((r) => r.statusCode && r.statusCode >= 400);
  if (recipients.length && failed.length === recipients.length) {
    throw new Error(
      `AfricasTalking all recipients failed: ${recipients.map((r) => r.status).join(",")}`
    );
  }
}

async function sendSmsViaTwilio({ to, text }) {
  if (twilioVerifyReady()) {
    // Twilio Verify uses its own code, but our flow generates the code locally.
    // We can't use Verify here — it would send a different code than our DB has.
    // Fall through to raw SMS.
  }
  if (!twilioSmsReady()) {
    throw new Error("Twilio is not configured.");
  }
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: process.env.TWILIO_FROM,
    to,
    body: text
  });
}

async function sendSmsOtp(destination, code) {
  const text = `IMIS OTP: ${code}. Expires in ${OTP_EXPIRY_MINUTES} minutes. Never share this code.`;

  return sendTransactionalSms({ to: destination, text });
}

async function sendTransactionalSms({ to, text }) {
  const bodyText = cleanPlainSmsText(text);
  if (!to || !bodyText) {
    throw new Error("Transactional SMS requires destination and body text.");
  }

  // Prefer Africa's Talking for Kenyan numbers (faster, cheaper).
  if (africasTalkingReady()) {
    try {
      await sendSmsViaAfricasTalking({ to, text: bodyText });
      return;
    } catch (err) {
      if (!twilioSmsReady()) throw err;
      // eslint-disable-next-line no-console
      console.warn(`[sms] AfricasTalking failed, falling back to Twilio: ${err.message}`);
    }
  }

  if (!twilioSmsReady()) {
    throw new Error("No SMS provider configured. Set AT_API_KEY+AT_USERNAME+AT_FROM or TWILIO_*");
  }
  await sendSmsViaTwilio({ to, text: bodyText });
}

function cleanPlainSmsText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 920);
}

// =============================================================================
// PUBLIC API
// =============================================================================
async function sendOtp({ channel, destination, code }) {
  if (channel === "sms_email") {
    // Fire both in parallel — wait for the first to succeed; let the other
    // continue in the background. This way the user gets an OTP as fast as
    // any provider can deliver one.
    const smsPromise = sendSmsOtp(destination, code).then(
      () => "sms_ok",
      (err) => ({ provider: "sms", error: err })
    );
    const emailPromise = sendEmailOtp(destination, code).then(
      () => "email_ok",
      (err) => ({ provider: "email", error: err })
    );
    const results = await Promise.allSettled([smsPromise, emailPromise]);
    const failures = results
      .map((r) => (r.status === "fulfilled" ? r.value : { provider: "?", error: r.reason }))
      .filter((v) => typeof v === "object" && v.error);
    if (failures.length === results.length) {
      throw new Error(
        failures.map((f) => `${f.provider}: ${f.error?.message || f.error}`).join(" | ")
      );
    }
    return;
  }

  if (channel === "email") {
    return sendEmailOtp(destination, code);
  }

  if (channel === "sms") {
    return sendSmsOtp(destination, code);
  }

  // Default: console (dev / system-developer fallback only)
  // eslint-disable-next-line no-console
  console.log(`[OTP] ${destination} -> ${code} (channel=${channel || "console"})`);
}

async function verifyTwilioOtp(destination, code) {
  if (!twilioVerifyReady()) return null;
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const result = await client.verify.v2
    .services(process.env.TWILIO_VERIFY_SERVICE_SID)
    .verificationChecks.create({ to: destination, code });
  return result?.status || null;
}

module.exports = {
  generateOtpCode,
  buildOtpExpiry,
  sendOtp,
  sendTransactionalEmail,
  sendTransactionalSms,
  verifyTwilioOtp,
  smtpReady,
  sendgridReady,
  twilioSmsReady,
  twilioVerifyReady,
  africasTalkingReady,
  emailChannelReady,
  smsChannelReady
};
