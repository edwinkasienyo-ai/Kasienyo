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

async function sendOtp({ channel, destination, code }) {
  if (channel === "sms_email") {
    await sendOtp({ channel: "sms", destination, code });
    await sendOtp({ channel: "email", destination, code });
    return;
  }

  if (channel === "email") {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      throw new Error("SMTP is not configured.");
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "false") === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: destination,
      subject: "IIMS OTP Verification Code",
      text: `Your OTP is ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`
    });
    return;
  }

  if (channel === "sms") {
    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN ||
      !process.env.TWILIO_FROM
    ) {
      throw new Error("Twilio is not configured.");
    }

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: process.env.TWILIO_FROM,
      to: destination,
      body: `Your IIMS OTP is ${code}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`
    });
    return;
  }

  // Default channel: console
  // eslint-disable-next-line no-console
  console.log(`OTP for ${destination}: ${code}`);
}

module.exports = { generateOtpCode, buildOtpExpiry, sendOtp };
