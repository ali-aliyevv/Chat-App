require("dotenv").config();
const nodemailer = require("nodemailer");

// ========================
// SMTP CONFIG
// ========================

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM;

// port-a görə secure avtomatik seçilir
const isSecure = SMTP_PORT === 465;

// transporter yarat
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: isSecure,

  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },

  // STARTTLS üçün lazımdır (port 587)
  requireTLS: !isSecure,

  // timeout-lar (Render üçün çox vacibdir)
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

// ========================
// SMTP VERIFY (server start zamanı)
// ========================

async function verifySMTP() {
  try {
    await transporter.verify();
    console.log("✅ SMTP ready");
    console.log("Host:", SMTP_HOST);
    console.log("Port:", SMTP_PORT);
    console.log("Secure:", isSecure);
  } catch (error) {
    console.error("❌ SMTP verify error:", error.message);
  }
}

// dərhal yoxla
verifySMTP();

// ========================
// SEND OTP EMAIL
// ========================

async function sendOtpEmail(toEmail, otp) {
  try {
    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to: toEmail,
      subject: "OTP Code — RealChat",

      text: `Your OTP code is: ${otp}. This code expires in 5 minutes.`,

      html: `
        <div style="
          font-family: Arial, sans-serif;
          max-width: 500px;
          margin: auto;
          padding: 20px;
          border: 1px solid #eee;
          border-radius: 10px;
        ">
          <h2 style="color:#333;">RealChat Verification</h2>

          <p>Your OTP code:</p>

          <div style="
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 8px;
            background: #f4f4f4;
            padding: 10px;
            text-align: center;
            border-radius: 6px;
          ">
            ${otp}
          </div>

          <p style="margin-top:15px;">
            This code expires in <b>5 minutes</b>.
          </p>

          <p style="color:#777;font-size:12px;">
            If you didn't request this, ignore this email.
          </p>
        </div>
      `,
    });

    console.log("✅ OTP email göndərildi:", toEmail);
    console.log("Message ID:", info.messageId);

    return true;
  } catch (error) {
    console.error("❌ OTP email göndərilmədi:", error.message);
    throw error;
  }
}

// ========================
// EXPORT
// ========================

module.exports = {
  sendOtpEmail,
};
