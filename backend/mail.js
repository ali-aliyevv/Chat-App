const axios = require("axios");
require("dotenv").config();

async function sendOtpEmail(toEmail, otp) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("BREVO_API_KEY is missing");

  const from = process.env.SMTP_FROM || "RealChat <bytemasters22@gmail.com>";
  const senderEmail = from.match(/<([^>]+)>/)?.[1] || from; // fallback

  try {
    const res = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { name: "RealChat", email: senderEmail },
        to: [{ email: toEmail }],
        subject: "OTP Code — RealChat",
        htmlContent: `... sənin html ...`,
        textContent: `Your OTP code is: ${otp}. This code expires in 5 minutes.`,
      },
      {
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          "accept": "application/json",
        },
        timeout: 10000,
      }
    );

    console.log("✅ OTP email göndərildi:", toEmail, "Brevo:", res.data);
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    console.error("❌ Brevo email error:", status, data || err.message);
    throw new Error(data?.message || "Brevo email send failed");
  }
}

module.exports = { sendOtpEmail };