/* mailer.js — outbound mail.

   Delivery transport, chosen automatically:
     dry (default)     — writes .eml files to outbox/. Nothing is sent. The
                         whole flow is testable with no credentials.
     Brevo HTTP API    — when BIT_BREVO_API_KEY is set. Sends over HTTPS (443),
                         which is what makes live delivery work on hosts that
                         BLOCK outbound SMTP — Render's free tier does exactly
                         that, so the old Gmail-SMTP path timed out there and
                         no mail ever left. This is the production path.
     Gmail SMTP        — when a Gmail app password is set but no Brevo key.
                         Works locally (where SMTP ports are open); kept for
                         dev and for hosts that don't block SMTP.

   Reply routing is transport-independent: every message sets Reply-To to
   <user>+bit<tag>@gmail.com, so a counsellor's reply lands in the relay Gmail
   inbox regardless of who SENT it, and inbox.js (IMAP) matches the tag back to
   the thread. Sending via Brevo and reading replies via Gmail compose cleanly. */

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const MODE = (process.env.BIT_RELAY_MODE || "dry").toLowerCase();
const GMAIL_USER = (process.env.BIT_GMAIL_USER || "").trim();
/* Google displays app passwords as "abcd efgh ijkl mnop". The spaces are
   presentation only — passing them to SMTP AUTH verbatim fails with
   "Username and Password not accepted", which reads like a wrong password. */
const GMAIL_PASS = (process.env.BIT_GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const BREVO_KEY = (process.env.BIT_BREVO_API_KEY || "").trim();
/* the verified Brevo sender. Defaults to the Gmail user (verify that address
   in Brevo). Counsellors see this as the From; replies still go to Reply-To. */
const MAIL_FROM = (process.env.BIT_MAIL_FROM || GMAIL_USER || "relay@localhost").trim();
const PUBLIC_URL = (process.env.BIT_PUBLIC_URL || "http://localhost:8787").replace(/\/$/, "");
const OUTBOX = process.env.BIT_OUTBOX_DIR || join(process.cwd(), "outbox");

/** which live transport is active (Brevo preferred — it survives SMTP blocks) */
function transportKind() {
  if (BREVO_KEY) return "brevo";
  if (GMAIL_USER && GMAIL_PASS) return "smtp";
  return "none";
}

let transport = null;

async function getTransport() {
  if (transport) return transport;
  const { default: nodemailer } = await import("nodemailer");
  transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    // pooled: keep the TLS connection alive between sends — a fresh SMTP
    // handshake per message added seconds to every "Sending…"
    pool: true,
    maxConnections: 1,
  });
  return transport;
}

/** Brevo transactional-email HTTP API — POST over 443, no SMTP port needed. */
async function sendViaBrevo({ to, subject, replyTo, text, html, tag }) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "content-type": "application/json", accept: "application/json" },
    // a stalled socket must not hang the /send request forever — fail to
    // "delivery" and roll back, same as any other send error
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      sender: { email: MAIL_FROM, name: "Before I Tell" },
      to: [{ email: to }],
      replyTo: { email: replyTo },
      subject,
      textContent: text,
      htmlContent: html,
      headers: { "X-BIT-Thread": tag, "Auto-Submitted": "auto-generated" },
    }),
  });
  if (!res.ok) {
    // surface Brevo's reason in logs (never the message body) so a bad key or
    // unverified sender is diagnosable; the caller turns any throw into "delivery"
    const detail = await res.text().catch(() => "");
    throw new Error(`brevo ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => ({}));
  return data.messageId || "brevo-ok";
}

/* The tag MUST land as "+bit<tag>@" — inbox.js parses exactly that shape, so
   the dry-mode fallback has to match the live one or the reply loop silently
   breaks in testing and works in production (or vice versa). */
export function replyAddress(tag) {
  const [name, domain] = GMAIL_USER.includes("@") ? GMAIL_USER.split("@") : ["relay", "localhost"];
  return `${name}+bit${tag}@${domain}`;
}

export function modeInfo() {
  return { mode: MODE, transport: transportKind(), configured: MODE !== "live" || transportKind() !== "none" };
}

const esc = (s) => String(s)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

/** strip anything that could forge a header; subjects are attacker-influenced */
const headerSafe = (s) => String(s).replace(/[\r\n]+/g, " ").slice(0, 180);

/* COUPLING: the first-message text template is mirrored in
   ../js/codename.js emailPreview() — the compose screen shows students the
   EXACT email before they send. If you edit this copy, edit that too. */
function bodyText({ codename, message, tag, first }) {
  const blockUrl = `${PUBLIC_URL}/block?tag=${tag}`;
  const intro = first
    ? `A student at your school is using Before I Tell — a tool that lets a young person start a conversation with a school adult under a codename instead of their name, because not knowing what happens after telling is one of the top reasons students stay silent.

They have chosen to write to you. They are identified only as "${codename}". Nobody — including the people who built this — can see who they are.`
    : `New message from "${codename}" at your school, sent through Before I Tell.`;

  return `${intro}

────────────────────────────────────────
${message}
────────────────────────────────────────

HOW TO REPLY
Just hit Reply. Your reply goes back to ${codename} inside the app — it does not reveal your email to them, and it does not reveal them to you.

IMPORTANT
· This is not a monitored crisis service, and nobody reads these messages but you. If you believe this student is in immediate danger and you cannot identify them, contact your school's admin team and Kids Help Phone (1-800-668-6868).
· We screen outgoing messages for explicit crisis language and route those students to crisis lines instead of to your inbox. That screening is pattern-based and imperfect — please do not assume a message reached you because it was judged safe. Read it as you would any disclosure.
· Your Ontario duty to report is unchanged. If what you read gives reasonable grounds to suspect abuse or neglect of someone under 16, you must contact a children's aid society directly — and you should say so plainly in your reply.

Not expecting this, or don't want messages here?
Block this address permanently: ${blockUrl}

— Before I Tell · built by a student, for students`;
}

function bodyHtml({ codename, message, tag, first }) {
  const blockUrl = `${PUBLIC_URL}/block?tag=${tag}`;
  const intro = first
    ? `<p>A student at your school is using <b>Before I Tell</b> — a tool that lets a young person start a conversation with a school adult under a codename instead of their name, because not knowing what happens after telling is one of the top reasons students stay silent.</p>
       <p>They have chosen to write to you. They are identified only as <b>${esc(codename)}</b>. Nobody — including the people who built this — can see who they are.</p>`
    : `<p>New message from <b>${esc(codename)}</b> at your school, sent through Before I Tell.</p>`;

  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#33261e;max-width:620px">
  ${intro}
  <div style="margin:22px 0;padding:18px 20px;background:#fdf9f3;border-left:4px solid #c2410c;border-radius:10px;white-space:pre-wrap">${esc(message)}</div>
  <p><b>How to reply:</b> just hit Reply. Your reply goes back to ${esc(codename)} inside the app — it does not reveal your email to them, and it does not reveal them to you.</p>
  <div style="margin:22px 0;padding:16px 18px;background:#fdf0ec;border-radius:10px;font-size:14px">
    <p style="margin:0 0 10px"><b>Important</b></p>
    <p style="margin:0 0 8px">This is not a monitored crisis service, and nobody reads these messages but you. If you believe this student is in immediate danger and you cannot identify them, contact your school's admin team and Kids Help Phone (1-800-668-6868).</p>
    <p style="margin:0 0 8px">We screen outgoing messages for explicit crisis language and route those students to crisis lines instead of to your inbox. That screening is pattern-based and <b>imperfect</b> — please do not assume a message reached you because it was judged safe. Read it as you would any disclosure.</p>
    <p style="margin:0">Your Ontario duty to report is unchanged. If what you read gives reasonable grounds to suspect abuse or neglect of someone under 16, you must contact a children's aid society directly — and you should say so plainly in your reply.</p>
  </div>
  <p style="font-size:13px;color:#6b5d52">Not expecting this, or don't want messages here? <a href="${esc(blockUrl)}" style="color:#c2410c">Block this address permanently</a>.</p>
  <p style="font-size:13px;color:#6b5d52">— Before I Tell · built by a student, for students</p>
</div>`;
}

/**
 * Send one student message to a counsellor.
 * @returns {Promise<{ok:true, mode:string, id?:string}>}
 */
export async function sendToCounsellor({ to, codename, message, tag, first }) {
  const subject = headerSafe(first
    ? `[Before I Tell] A student wants to talk — ${codename}`
    : `[Before I Tell] Re: message from ${codename}`);

  const replyTo = replyAddress(tag);
  const text = bodyText({ codename, message, tag, first });
  const html = bodyHtml({ codename, message, tag, first });

  if (MODE !== "live") {
    if (!existsSync(OUTBOX)) await mkdir(OUTBOX, { recursive: true });
    const file = join(OUTBOX, `${Date.now()}-${tag.slice(0, 8)}.eml`);
    await writeFile(file,
      `To: ${to}\nFrom: "Before I Tell" <${MAIL_FROM}>\nReply-To: ${replyTo}\nSubject: ${subject}\nX-BIT-Thread: ${tag}\n\n${text}\n`, "utf8");
    return { ok: true, mode: "dry", id: file };
  }

  const kind = transportKind();
  if (kind === "brevo") {
    const id = await sendViaBrevo({ to, subject, replyTo, text, html, tag });
    return { ok: true, mode: "live", transport: "brevo", id };
  }
  if (kind === "smtp") {
    const info = await (await getTransport()).sendMail({
      from: `"Before I Tell" <${MAIL_FROM}>`, to, subject, replyTo, text, html,
      headers: { "Auto-Submitted": "auto-generated", "X-BIT-Thread": tag },
    });
    return { ok: true, mode: "live", transport: "smtp", id: info.messageId };
  }
  throw new Error("no live transport: set BIT_BREVO_API_KEY (HTTP, works on Render) or Gmail SMTP creds");
}
