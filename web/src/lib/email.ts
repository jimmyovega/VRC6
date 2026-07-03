// Email sending via Resend. With no RESEND_API_KEY (local dev / tests), emails
// are logged to the console instead of sent, so flows stay testable offline.
import { env } from "cloudflare:workers";
import { log } from "./log";

const emailEnv = env as typeof env & {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  EMAIL_DEBUG?: string;
  EMAIL_DISABLED?: string;
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
  // Log-only (never a live send) when there's no key OR an explicit disable flag
  // (dev / E2E / CI, so tests don't depend on Resend). EMAIL_DEBUG logs the mail
  // AND still sends — handy for grabbing activation/reset links during dev.
  const logOnly = !key || !!emailEnv.EMAIL_DISABLED;
  if (logOnly || emailEnv.EMAIL_DEBUG) {
    log.info("email dev-logged", {
      to: opts.to,
      subject: opts.subject,
      body: opts.text ?? opts.html,
    });
  }
  if (logOnly) {
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
    log.error("resend send failed", { status: res.status, body: await res.text() });
  }
  return { ok: res.ok, dev: false };
}
