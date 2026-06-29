// Email sending via Resend. With no RESEND_API_KEY (local dev / tests), emails
// are logged to the console instead of sent, so flows stay testable offline.
import { env } from "cloudflare:workers";

const emailEnv = env as typeof env & {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
};

// resend.dev works without a verified domain (only sends to the account owner);
// set RESEND_FROM to a verified address for real delivery.
const FROM = emailEnv.RESEND_FROM ?? "VRC6 <onboarding@resend.dev>";

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ ok: boolean; dev: boolean }> {
  const key = emailEnv.RESEND_API_KEY;
  if (!key) {
    console.log(
      `[email:dev] to=${opts.to} subject="${opts.subject}"\n${opts.text ?? opts.html}`,
    );
    return { ok: true, dev: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!res.ok) {
    console.error(`[email] Resend failed (${res.status}): ${await res.text()}`);
  }
  return { ok: res.ok, dev: false };
}
