require("dotenv").config();
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE) === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter
  .verify()
  .then(() => console.log("✅ SMTP ready"))
  .catch((e) => console.log("❌ SMTP error:", e?.message || e));

async function sendOtpEmail(toEmail, otp) {
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: "OTP Code — RealChat",
    text: `Your OTP code is: ${otp}. This code expires in 5 minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif">
        <h2>RealChat OTP Code</h2>
        <p>Your verification code:</p>
        <h1 style="letter-spacing:6px">${otp}</h1>
        <p>This code expires in 5 minutes.</p>
      </div>
    `,
  });

  console.log("✅ OTP email göndərildi:", toEmail, "messageId:", info.messageId);
}

module.exports = { sendOtpEmail };