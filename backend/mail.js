require("dotenv").config();

// ========================
// BREVO CONFIG (HTTP API — Render-da SMTP port bloklansa da isleyir)
// ========================

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || "aliyevali2909@gmail.com";
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || "RealChat";

if (!BREVO_API_KEY) {
  console.error("❌ BREVO_API_KEY environment variable is not set!");
} else {
  console.log("✅ Brevo API ready");
}

// ========================
// SEND OTP EMAIL (Brevo HTTP API — no SDK needed)
// ========================

async function sendOtpEmail(toEmail, otp) {
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: {
          name: EMAIL_FROM_NAME,
          email: EMAIL_FROM_ADDRESS,
        },
        to: [{ email: toEmail }],
        subject: "OTP Code — RealChat",
        textContent: `Your OTP code is: ${otp}. This code expires in 5 minutes.`,
        htmlContent: `
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
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("❌ Brevo API error:", JSON.stringify(result));
      throw new Error(result.message || "Brevo API error");
    }

    console.log("✅ OTP email göndərildi:", toEmail);
    console.log("Message ID:", result.messageId);

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
