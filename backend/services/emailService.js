const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
dotenv.config();

// Two delivery paths:
//   1. Resend HTTP API (preferred) — sends over HTTPS/443, so it works on hosts that block
//      outbound SMTP (Render's free tier blocks ports 25/465/587 outright).
//   2. Gmail SMTP (legacy fallback) — used only when RESEND_API_KEY is absent.
const useResend = Boolean(process.env.RESEND_API_KEY);

let resend = null;
let smtpTransporter = null;

if (useResend) {
  const { Resend } = require("resend");
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log("Email service: Resend HTTP API");
} else {
  smtpTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      // NOTE: the README documents EMAIL_USER / EMAIL_PASS, but this file reads
      // EMAIL / EMAIL_PASSWORD. Set the names the code actually reads, or the
      // credentials arrive as undefined and every OTP send fails.
      user: process.env.EMAIL,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  // Deliberately no eager transporter.verify() call.
  //
  // nodemailer emits an 'error' event when the SMTP handshake fails, and with no listener
  // attached Node converts that into an uncaught exception. Because this ran at module load,
  // a missing or wrong Gmail credential killed the process on every cold start — on Vercel
  // that means every invocation 500s before it reaches a route. It also cost a pointless SMTP
  // round-trip per instance. Real failures now surface from sendMail() inside the request that
  // needs them, where the caller already handles them.
  console.log("Email service: Gmail SMTP configured (not pre-verified)");
}

// The From address. With Resend this must sit on a domain you have verified.
//
// Accepts EITHER a bare address (no-reply@example.com) OR an already-decorated
// "Name <addr>" value. Without this check a decorated value (which is how RESEND_FROM is
// stored in the Vercel project) produced a malformed header:
//   from: "Varnox App" <Varnox Chat <no-reply@varnoxapp.blacklord.tech>>
// Resend rejects that, so every OTP send would have failed with an opaque error.
const FROM_RAW = process.env.RESEND_FROM || process.env.EMAIL;
const FROM_HEADER = FROM_RAW
  ? FROM_RAW.includes("<")
    ? FROM_RAW
    : `"Varnox App" <${FROM_RAW}>`
  : null;

const sendOtpToEmail = async (email, otp) => {
  const digits = String(otp).split("");

  // Each digit rendered as its own table cell for email-client compatibility
  const digitCells = digits.map(d => `
    <td style="padding:0 5px;">
      <table cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:8px;border:2px solid #e9edef;width:44px;height:56px;">
        <tr>
          <td align="center" valign="middle" style="font-size:28px;font-weight:700;color:#111b21;font-family:Courier,monospace;text-align:center;width:44px;height:56px;">
            ${d}
          </td>
        </tr>
      </table>
    </td>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Varnox Verification</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0f2f5;padding:40px 16px;">
    <tr>
      <td align="center">

        <table width="480" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);max-width:480px;width:100%;">

          <!-- Green header -->
          <tr>
            <td align="center" style="background:linear-gradient(135deg,#00a884 0%,#075e54 100%);padding:32px 40px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom:14px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" valign="middle" width="76" height="76" style="background:rgba(255,255,255,0.18);border-radius:50%;width:76px;height:76px;">
                          <img
                            src="https://varnoxapp.blacklord.tech/varnox-icon.png"
                            alt="Varnox"
                            width="46"
                            height="46"
                            style="display:block;margin:0 auto;"
                          />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;padding-bottom:4px;">Varnox App</td>
                </tr>
                <tr>
                  <td align="center" style="color:rgba(255,255,255,0.80);font-size:13px;">Verification Code</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 28px;">
              <p style="margin:0 0 8px;font-size:15px;color:#111b21;font-weight:600;">Hi there,</p>
              <p style="margin:0 0 28px;font-size:14px;color:#54656f;line-height:1.6;">
                Use the verification code below to confirm your email address.
                This code will expire in <strong style="color:#111b21;">5 minutes</strong>.
              </p>

              <!-- OTP digits -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0" border="0" style="background:#f0f2f5;border-radius:12px;padding:20px 24px;">
                      <tr>
                        <td align="center" style="padding-bottom:14px;">
                          <span style="font-size:11px;font-weight:600;color:#8696a0;letter-spacing:2px;text-transform:uppercase;">Your Verification Code</span>
                        </td>
                      </tr>
                      <tr>
                        <td align="center">
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>${digitCells}</tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Warning -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#fff8e1;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:12px 16px;">
                    <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
                      🔒 <strong>Never share this code</strong> with anyone. Varnox will never ask for your code.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#8696a0;line-height:1.6;">
                If you didn't request this code, you can safely ignore this email.
                Someone may have entered your email address by mistake.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="height:1px;background:#e9edef;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle">
                    <p style="margin:0 0 4px;font-size:12px;color:#8696a0;">
                      Automated message from <strong style="color:#00a884;">Varnox App</strong>.
                    </p>
                    <p style="margin:0;font-size:12px;color:#aebac1;">Please do not reply to this email.</p>
                  </td>
                  <td valign="middle" align="right" width="42">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" valign="middle" width="36" height="36" style="background:#00a884;border-radius:50%;width:36px;height:36px;">
                          <img
                            src="https://varnoxapp.blacklord.tech/varnox-icon.png"
                            width="22"
                            height="22"
                            style="display:block;margin:0 auto;"
                            alt="WA"
                          />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

        <p style="margin-top:20px;font-size:11px;color:#aebac1;text-align:center;">
          © 2026 Varnox &middot; End-to-end encrypted
        </p>

      </td>
    </tr>
  </table>

</body>
</html>`;

  const subject = `${otp} is your Varnox verification code`;

  if (useResend) {
    const { error } = await resend.emails.send({
      from: FROM_HEADER,
      to: email,
      subject,
      html,
    });
    // The SDK reports API failures in the result rather than throwing.
    if (error) throw new Error(error.message || "Resend rejected the message");
  } else {
    await smtpTransporter.sendMail({
      from: FROM_HEADER,
      to: email,
      subject,
      html,
    });
  }
};

module.exports = { sendOtpToEmail };