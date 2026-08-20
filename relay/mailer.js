/* mailer.js — outbound mail.

   Two modes, chosen by BIT_RELAY_MODE:
     dry  (default) — writes .eml files to outbox/. Nothing is sent. The whole
                      flow is testable with no credentials and no risk of
                      mailing a real school by accident.
     live           — Gmail SMTP with an App Password (2FA account required).

   Reply routing: every message sets Reply-To to <user>+bit<tag>@gmail.com.
   Gmail delivers plus-addressed mail to the same inbox, so one free account
   carries every thread and inbox.js can match the tag back to the thread. */

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const MODE = (process.env.BIT_RELAY_MODE || "dry").toLowerCase();
const GMAIL_USER = (process.env.BIT_GMAIL_USER || "").trim();
/* Google displays app passwords as "abcd efgh ijkl mnop". The spaces are
   presentation only — passing them to SMTP AUTH verbatim fails with
   "Username and Password not accepted", which reads like a wrong password. */
const GMAIL_PASS = (process.env.BIT_GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const PUBLIC_URL = (process.env.BIT_PUBLIC_URL || "http://localhost:8787").replace(/\/$/, "");
const OUTBOX = process.env.BIT_OUTBOX_DIR || join(process.cwd(), "outbox");

let transport = null;

async function getTransport() {
  if (transport) return transport;
  const { default: nodemailer } = await import("nodemailer");
  transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
  return transport;
}

/* The tag MUST land as "+bit<tag>@" — inbox.js parses exactly that shape, so
   the dry-mode fallback has to match the live one or the reply loop silently
   breaks in testing and works in production (or vice versa). */
export function replyAddress(tag) {
  const [name, domain] = GMAIL_USER.includes("@") ? GMAIL_USER.split("@") : ["relay", "localhost"];
  return `${name}+bit${tag}@${domain}`;
}

export function modeInfo() {
  return { mode: MODE, configured: MODE !== "live" || Boolean(GMAIL_USER && GMAIL_PASS) };
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
    <p style="margin:0 0 8px">We screen outgoing messages for explicit crisis language and route those students to crisis lines instead of to your inbox. That screening is pattern-based and <b>imperfect</b> — please don't assume a message reached you because it was judged safe.</p>
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

  const mail = {
    from: MODE === "live" ? `"Before I Tell" <${GMAIL_USER}>` : `"Before I Tell" <relay@localhost>`,
    to,
    subject,
    replyTo: replyAddress(tag),
    text: bodyText({ codename, message, tag, first }),
    html: bodyHtml({ codename, message, tag, first }),
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-BIT-Thread": tag,
    },
  };

  if (MODE !== "live") {
    if (!existsSync(OUTBOX)) await mkdir(OUTBOX, { recursive: true });
    const file = join(OUTBOX, `${Date.now()}-${tag.slice(0, 8)}.eml`);
    await writeFile(file,
      `To: ${mail.to}\nFrom: ${mail.from}\nReply-To: ${mail.replyTo}\nSubject: ${mail.subject}\nX-BIT-Thread: ${tag}\n\n${mail.text}\n`, "utf8");
    return { ok: true, mode: "dry", id: file };
  }

  if (!GMAIL_USER || !GMAIL_PASS) throw new Error("BIT_GMAIL_USER / BIT_GMAIL_APP_PASSWORD not set");
  const info = await (await getTransport()).sendMail(mail);
  return { ok: true, mode: "live", id: info.messageId };
}
