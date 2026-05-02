const nodemailer = require("nodemailer");
const twilio = require("twilio");

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function buildOtpExpiry() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + OTP_EXPIRY_MINUTES);
  return now;
}

function smtpReady() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
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

function buildMailTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendOtp({ channel, destination, code }) {
  if (channel === "sms_email") {
    await sendOtp({ channel: "sms", destination, code });
    await sendOtp({ channel: "email", destination, code });
    return;
  }

  if (channel === "email") {
    if (!smtpReady()) throw new Error("SMTP is not configured.");
    const transporter = buildMailTransporter();
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: destination,
      subject: "IMIS OTP Verification Code",
      text: `Your IMIS OTP is ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes. Never share this code.`
    });
    return;
  }

  if (channel === "sms") {
    // Prefer Twilio Verify if configured (Twilio Verify manages its own codes),
    // otherwise fall back to regular SMS that contains the code we already generated.
    if (twilioVerifyReady()) {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      try {
        await client.verify.v2
          .services(process.env.TWILIO_VERIFY_SERVICE_SID)
          .verifications.create({ to: destination, channel: "sms" });
        return;
      } catch (err) {
        // If Verify fails, try raw SMS as fallback rather than crashing.
        if (!twilioSmsReady()) throw err;
      }
    }
    if (!twilioSmsReady()) throw new Error("Twilio is not configured.");
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: process.env.TWILIO_FROM,
      to: destination,
      body: `IMIS OTP: ${code}. Expires in ${OTP_EXPIRY_MINUTES} minutes. Never share this code.`
    });
    return;
  }

  // Default channel: console
  // eslint-disable-next-line no-console
  console.log(`OTP for ${destination}: ${code}`);
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
  verifyTwilioOtp,
  smtpReady,
  twilioSmsReady,
  twilioVerifyReady
};
