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
        htmlContent: ` <div style="margin:0;padding:0;background-color:#f4f6f8;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;padding:40px 0;">
            <tr>
              <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,0.08);">
                  
                  <!-- Header -->
                  <tr>
                    <td style="background:#111827;padding:24px;text-align:center;">
                      <h1 style="margin:0;font-family:Arial,sans-serif;font-size:22px;color:#ffffff;letter-spacing:0.5px;">
                        RealChat
                      </h1>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding:32px 28px;font-family:Arial,sans-serif;color:#111827;">
                      <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;">
                        Email Verification Code
                      </h2>

                      <p style="margin:0 0 24px;font-size:14px;color:#374151;line-height:1.6;">
                        Please use the following One-Time Password (OTP) to complete your registration.
                      </p>

                      <!-- OTP box -->
                      <div style="text-align:center;margin:24px 0;">
                        <div style="
                          display:inline-block;
                          padding:16px 28px;
                          font-size:28px;
                          font-weight:700;
                          letter-spacing:6px;
                          color:#111827;
                          background:#f3f4f6;
                          border-radius:8px;
                          border:1px dashed #d1d5db;
                        ">
                          ${otp}
                        </div>
                      </div>

                      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">
                        ⏱ This code will expire in <strong>5 minutes</strong>.
                      </p>

                      <p style="margin:0;font-size:13px;color:#6b7280;">
                        If you did not request this code, please ignore this email.
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f9fafb;padding:20px;text-align:center;font-family:Arial,sans-serif;font-size:12px;color:#9ca3af;">
                      © ${new Date().getFullYear()} RealChat. All rights reserved.
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </div>`,
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