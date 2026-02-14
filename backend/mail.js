require("dotenv").config();
const { Resend } = require("resend");

// ========================
// RESEND CONFIG (HTTP API — Render-da SMTP bloklanmir)
// ========================

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "RealChat <onboarding@resend.dev>";

if (!RESEND_API_KEY) {
  console.error("❌ RESEND_API_KEY environment variable is not set!");
} else {
  console.log("✅ Resend API ready");
}

const resend = new Resend(RESEND_API_KEY);

// ========================
// SEND OTP EMAIL
// ========================

async function sendOtpEmail(toEmail, otp) {
  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: [toEmail],
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

    if (error) {
      console.error("❌ Resend API error:", error.message || JSON.stringify(error));
      throw new Error(error.message || "Resend API error");
    }

    console.log("✅ OTP email göndərildi:", toEmail);
    console.log("Email ID:", data?.id);

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
