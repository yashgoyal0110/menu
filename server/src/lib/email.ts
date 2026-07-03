import { randomInt } from 'node:crypto'

import nodemailer from 'nodemailer'

/**
 * Email delivery. Configured via SMTP_* env vars. When SMTP_HOST is unset
 * (local dev), we skip real delivery and log the message to the console so the
 * OTP flow is still testable without a mail server.
 */

const SMTP_HOST = process.env.SMTP_HOST
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587)
const SMTP_USER = process.env.SMTP_USER
const SMTP_PASS = process.env.SMTP_PASS
const SMTP_SECURE = process.env.SMTP_SECURE === 'true'
const MAIL_FROM = process.env.MAIL_FROM ?? 'ServiceDock <no-reply@servicedock.app>'

const APP_NAME = 'ServiceDock'
const BRAND = '#2563eb'
const BRAND_DARK = '#1d4ed8'
const OTP_TTL_MINUTES = 10

const transporter = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null

/** Cryptographically-random 6-digit one-time code. */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export const OTP_TTL_MS = OTP_TTL_MINUTES * 60 * 1000

async function send(to: string, subject: string, html: string, text: string) {
  if (!transporter) {
    // Dev fallback — no SMTP configured.
    console.log(
      `\n[EMAIL:dev] SMTP not configured. Would send to ${to}\n  Subject: ${subject}\n  ${text}\n`,
    )
    return
  }
  await transporter.sendMail({ from: MAIL_FROM, to, subject, html, text })
}

function otpEmailHtml(name: string, code: string): string {
  const greetingName = name?.trim() ? name.trim().split(' ')[0] : 'there'
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND},${BRAND_DARK});padding:28px 32px;">
              <span style="display:inline-block;width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,0.18);text-align:center;line-height:34px;color:#fff;font-weight:800;font-size:18px;vertical-align:middle;">S</span>
              <span style="color:#ffffff;font-size:19px;font-weight:800;letter-spacing:-0.02em;margin-left:10px;vertical-align:middle;">${APP_NAME}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 8px;font-size:22px;letter-spacing:-0.02em;">Welcome to ${APP_NAME}, ${greetingName} 👋</h1>
              <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
                Thanks for signing up. To finish creating your account and start
                building your digital catalogs, confirm your email with the code below.
              </p>
              <div style="margin:24px 0;text-align:center;">
                <div style="display:inline-block;padding:16px 28px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;">
                  <span style="font-size:34px;font-weight:800;letter-spacing:10px;color:${BRAND};">${code}</span>
                </div>
              </div>
              <p style="margin:0 0 8px;color:#475569;font-size:14px;line-height:1.6;">
                Enter this code on the verification screen. It expires in
                <strong>${OTP_TTL_MINUTES} minutes</strong>.
              </p>
              <ul style="margin:8px 0 20px;padding-left:18px;color:#64748b;font-size:13px;line-height:1.7;">
                <li>Never share this code with anyone.</li>
                <li>${APP_NAME} staff will never ask you for it.</li>
                <li>Didn't request this? You can safely ignore this email.</li>
              </ul>
              <p style="margin:0;color:#94a3b8;font-size:13px;">Happy building,<br/>The ${APP_NAME} team</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">© ${APP_NAME} · This is an automated message, please don't reply.</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

export async function sendOtpEmail(
  to: string,
  name: string,
  code: string,
): Promise<void> {
  const text = `Welcome to ${APP_NAME}! Your verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. Never share this code with anyone.`
  await send(to, `Your ${APP_NAME} verification code: ${code}`, otpEmailHtml(name, code), text)
}
