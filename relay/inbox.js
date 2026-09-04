/* inbox.js — inbound replies from counsellors.

   The counsellor hits Reply. That reply is addressed to
   <user>+bit<tag>@gmail.com, so the thread tag arrives in the envelope and no
   database lookup by human identity is ever needed.

   dry mode  — polls inbox-drop/*.txt (a file with a "To:" line and a body),
               so the round trip is testable with no credentials.
   live mode — IMAP IDLE-less polling of UNSEEN mail, every BIT_POLL_SECONDS. */

import { readdir, readFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { addMessage, getThread, seenUid, markUid, degraded, settled, dropMessage } from "./store.js";

const MODE = (process.env.BIT_RELAY_MODE || "dry").toLowerCase();
const DROP = process.env.BIT_INBOX_DROP || join(process.cwd(), "inbox-drop");
const POLL_MS = Number(process.env.BIT_POLL_SECONDS || 20) * 1000;
const MAX_REPLY = 4000;

/* Replies we refused and consumed. Each one is a counsellor who believes they
   answered a child who will never see it, so these must be visible somewhere
   an operator actually looks — /health, not just the log. */
export const rejected = { senderMismatch: 0, expiredThread: 0, emptyBody: 0 };

/** pull the thread tag out of any address-bearing header */
export function tagFrom(headerValue) {
  const m = /\+bit([0-9a-f]{8,64})@/i.exec(String(headerValue || ""));
  return m ? m[1].toLowerCase() : null;
}

/** Keep only what the counsellor actually typed.
    Mail clients bolt the original message onto every reply; forwarding that
    back to the student would echo their own words at them and leak our
    boilerplate into the thread. */
export function stripQuoted(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const cut = [
    /^\s*>/,                                   // quoted block
    /^\s*On .+ wrote:\s*$/i,                   // Gmail/Apple
    /^\s*-{2,}\s*Original Message\s*-{2,}/i,   // Outlook
    /^\s*_{5,}\s*$/,                           // Outlook divider
    /^\s*From:\s.+@/i,                         // forwarded header block
    /^\s*─{5,}\s*$/,                           // our own message divider
    /^\s*Sent from my /i,
  ];
  const out = [];
  for (const line of lines) {
    if (cut.some((re) => re.test(line))) break;
    out.push(line);
  }
  return out.join("\n").trim().slice(0, MAX_REPLY);
}

/** RFC 5322 unfolding: a header may continue on following lines when they
    start with whitespace. Join them back before any per-line header regex,
    or a wrapped From:/To: reads as a header with its value cut off. */
export function unfold(headerText) {
  return String(headerText || "").replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ");
}

/** bare address out of "Name <a@b.c>" or "a@b.c" */
export function addressOf(headerValue) {
  const s = String(headerValue || "");
  const m = /<([^>]+)>/.exec(s) || /([^\s<>,;:"]+@[^\s<>,;:"]+)/.exec(s);
  return m ? m[1].trim().toLowerCase() : "";
}

/** Everything before the first blank line. These checks must see HEADERS only:
    run over a whole message and a *quoted* "Precedence:" line inside a reply
    body would silently delete a real counsellor's answer to a child. */
export function headerBlock(raw) {
  const s = String(raw || "").replace(/\r\n/g, "\n");
  const end = s.indexOf("\n\n");
  return end === -1 ? s : s.slice(0, end);
}

/** Machine mail must never be shown to a child as their counsellor's answer.
    An out-of-office or a bounce filed as "Them" after a disclosure is cruel. */
export function isAutomated(headers) {
  const h = headerBlock(headers);
  return /^auto-submitted:\s*auto/im.test(h)
    || /^precedence:\s*(bulk|auto_reply|junk|list)/im.test(h)
    || /^x-auto(response|reply)/im.test(h)
    || /^content-type:\s*multipart\/report/im.test(h)          // DSN / bounce
    || /^from:[^\n]*(mailer-daemon|postmaster|no-?reply|do-?not-?reply)/im.test(h);
}

/**
 * File a reply — only if it came from the school this thread writes to.
 * Anyone the counsellor forwards our email to holds the tag (it's in Reply-To),
 * so the tag alone must NOT be treated as proof of identity. The address is
 * checked against the thread's recipient, and accepted from any other address
 * at the SAME DOMAIN — an operator decision, made because aliases, shared
 * guidance@ mailboxes and Exchange address-rewriting were causing real
 * answers to children to be refused. A reply from a different address is
 * labelled as such in the body, so the thread never implies the student is
 * hearing back from the specific adult they chose.
 */
/* Returns one of three outcomes, because "not filed" is two different things
   and the caller must treat them oppositely:
     "filed"       — stored; count it and consume the source message.
     "rejected"    — deliberately not ours (unknown tag, auto-reply, bounce,
                     wrong sender, empty). Consume it, or every poll retries
                     the same spam forever.
     "unpersisted" — it IS a real reply and we could not store it. Do NOT
                     consume: marking it \Seen or renaming it .done destroys
                     a counsellor's answer permanently, because both
                     transports only ever look at unseen/undone items. */
async function record(tag, body, fromHeader, rawHeaders) {
  const thread = getThread(tag);
  if (!thread) {
    // distinct from spam: a well-formed tag with no thread means retention
    // deleted it (90 days) — worth seeing in the log, since the counsellor's
    // reply is about to be consumed and they will never know
    rejected.expiredThread++;
    console.warn(`[inbox] reply for an unknown or expired thread ${tag.slice(0, 8)} — nothing to file it against`);
    return "rejected";
  }
  if (isAutomated(rawHeaders)) return "rejected";
  /* Sender check: the exact address, OR another address at the same school.
     The operator chose same-domain deliberately, because refusing an alias,
     a shared guidance@ mailbox, or an Exchange-rewritten address meant real
     answers to children were never delivered.

     The accepted risk: the thread tag rides in the Reply-To of an email a
     counsellor can forward, so a colleague at that school who receives a
     forward could write into the conversation. It is bounded to that one
     school's domain — never a stranger, never another board. */
  const sender = addressOf(fromHeader);
  const to = String(thread.to).toLowerCase();
  const senderDomain = sender.includes("@") ? sender.split("@").pop() : "";
  const threadDomain = String(thread.domain || to.split("@").pop() || "").toLowerCase();
  const sameDomain = Boolean(senderDomain) && senderDomain === threadDomain;
  if (!sender || (sender !== to && !sameDomain)) {
    rejected.senderMismatch++;
    console.warn(`[inbox] dropped reply on ${tag.slice(0, 8)}: sender ${sender || "(unparseable)"} is outside this thread's school — it stays in the mailbox, marked read`);
    return "rejected";
  }
  let clean = stripQuoted(body);
  /* stripQuoted cuts at the FIRST quote marker, which assumes the counsellor
     top-posted. Three common styles put a marker on line 1 — bottom-posting,
     inline replying, and Outlook's "-----Original Message-----" — and each
     leaves nothing behind. Treated as "rejected", a real answer to a child was
     then consumed and destroyed, with no outage and no log, while the student
     waited under a note blaming their school's spam filter.

     If the body had text and our parse emptied it, the parse is wrong, not the
     reply. Fall back to the raw body: showing a little quoted history is a
     cosmetic flaw, losing the message is not. Same principle as the send path
     — duplicate beats silent loss. */
  if (!clean && String(body || "").trim()) {
    /* Keep the TAIL, not the head. This fallback fires precisely when a quote
       marker sat on line 1, which means the counsellor wrote BELOW the quote —
       so the head is our boilerplate and the student's own message read back
       to them. A student using the full 4000-char composer makes the raw body
       ~6000 chars, and slicing the first 4000 delivered their own words with
       the counsellor's sentence cut off the end, under a heading saying
       "They replied". Verified: head-slicing loses it, tail-slicing keeps it. */
    const raw = String(body).replace(/\r\n/g, "\n").trim();
    clean = raw.length > MAX_REPLY ? raw.slice(-MAX_REPLY) : raw;
    console.warn(`[inbox] quote-stripping emptied a non-empty reply on ${tag.slice(0, 8)} — keeping the raw body`);
  }
  if (!clean) { rejected.emptyBody++; return "rejected"; }
  /* Same-domain replies are accepted, so the answer may not be from the adult
     the student chose to write to. The thread shows it as "They replied",
     which would then be a claim we cannot make — a student deciding whether to
     keep talking deserves to know a different person is reading. Name the
     address; it is a school work address, not private information. */
  if (sender !== to) {
    clean = `[Replied by ${sender} — a different address at the same school, not the one you wrote to.]\n\n${clean}`;
  }
  const msg = addMessage(tag, "adult", clean);
  /* degraded() is decided once at boot and never flips, so it cannot see a
     database that dies mid-life — the expected end state on a free plan.
     Confirm THIS write landed before letting the caller consume the source.
     Roll back on failure so the retry files it once, not twice. */
  if ((await settled()) === false) {
    dropMessage(tag, msg);
    console.error(`[inbox] could not persist a reply on ${tag.slice(0, 8)} — leaving it collectable`);
    return "unpersisted";
  }
  return "filed";
}

/* ---------------- dry mode: file drop ---------------- */

async function pollDrop() {
  if (!existsSync(DROP)) return 0;
  const files = (await readdir(DROP)).filter((f) => f.endsWith(".txt"));
  let n = 0;
  for (const f of files) {
    const full = join(DROP, f);
    try {
      // normalize CRLF first: on Windows an editor-saved drop file has \r\n,
      // and the \n\n split would never find the header/body boundary
      const raw = (await readFile(full, "utf8")).replace(/\r\n/g, "\n");
      const split = raw.indexOf("\n\n");
      const head = split === -1 ? raw : raw.slice(0, split);
      const body = split === -1 ? "" : raw.slice(split + 2);
      // unfold here too — the IMAP path is not the only header parser, and
      // fixing only that one is how the last four rounds of this went
      const unfolded = unfold(head);
      const to = /^To:\s*(.+)$/im.exec(unfolded)?.[1] || "";
      const from = /^From:\s*(.+)$/im.exec(unfolded)?.[1] || "";
      const tag = tagFrom(to);
      const outcome = tag ? await record(tag, body, from, head) : "rejected";
      // leave the file untouched so a later poll can still collect the reply
      if (outcome === "unpersisted") break;
      if (outcome === "filed") n++;
      await rename(full, full + ".done");
    } catch { /* a malformed drop file must not stop the loop */ }
  }
  return n;
}

/* ---------------- live mode: IMAP ---------------- */

async function pollImap() {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    logger: false,
    auth: {
      user: process.env.BIT_GMAIL_USER,
      pass: process.env.BIT_GMAIL_APP_PASSWORD,
    },
    // a dead socket must fail THIS poll, not hang until Node's default timeout
    socketTimeout: 60000,
    greetingTimeout: 20000,
  });

  /* THE relay-killer, fixed.
     imapflow emits an 'error' EVENT on socket timeouts (Gmail drops idle IMAP
     connections routinely). An unhandled 'error' event is fatal in Node — it
     rethrows outside any try/catch, so pollOnce()'s catch never saw it. The
     process died roughly every five minutes, and because free-tier storage does
     not survive a restart, every restart took every conversation with it.
     One listener turns a fatal event into an ordinary failed poll. */
  client.on("error", (err) => {
    console.error("[inbox] imap socket error (poll abandoned, relay stays up):", err.message);
  });

  let n = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for await (const msg of client.fetch({ seen: false }, { uid: true, envelope: true, headers: true, source: true })) {
        const uid = String(msg.uid);
        if (seenUid("INBOX", uid)) continue;
        const headerText = msg.headers ? msg.headers.toString() : "";
        const src = msg.source ? msg.source.toString() : "";
        const tag =
          // unfolded too: a wrapped To: would hide the plus-address the tag
          // lives in, and an untagged message is skipped entirely
          tagFrom(/^(?:Delivered-To|X-Original-To|To|X-BIT-Reply):\s*(.+)$/im.exec(unfold(headerText))?.[1]) ||
          tagFrom((msg.envelope?.to || []).map((a) => a.address).join(",")) ||
          tagFrom(headerText);
        if (!tag) continue;
        // crude but dependency-free body extraction: first text/plain part
        const body = extractPlain(src);
        /* Unfold before matching, and fall back on the ADDRESS rather than on
           the match. RFC 5322 lets a long header continue on the next line
           indented by whitespace, which real mail does constantly:
             From: "Smith, Jane - Student Success & Guidance"
              <jane.smith@pdsb.net>
           A single-line regex captured only the display name, addressOf()
           returned "", the sender check failed, and the reply was consumed as
           an impostor. The old `||` could not save it because the regex DID
           match — it just matched something with no address in it. */
        const fromHeader = /^From:\s*(.+)$/im.exec(unfold(headerText))?.[1] || "";
        const from = addressOf(fromHeader)
          ? fromHeader
          : ((msg.envelope?.from || []).map((a) => a.address).join(",") || fromHeader);
        // full src, not a slice: Gmail's Received/DKIM/ARC block can exceed 4KB,
        // and a truncated header set would let a bounce through as "Them".
        // headerBlock() bounds it correctly either way.
        const outcome = await record(tag, body, from, headerText || src);
        // leave it UNSEEN: the fetch above asks for unseen mail only, so
        // marking it now would consume a reply we failed to store
        if (outcome === "unpersisted") break;
        if (outcome === "filed") n++;
        markUid("INBOX", uid);
        await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return n;
}

function decodeBody(head, body) {
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) {
    // assemble raw bytes, then decode ONCE as UTF-8 — decoding each =XX as a
    // Latin-1 char split multibyte sequences (é, —, ') into garbage glyphs,
    // so a counsellor's reply with any accent showed up mangled to the child
    const collapsed = body.replace(/=\r?\n/g, "");
    const bytes = [];
    for (let i = 0; i < collapsed.length; i++) {
      const hx = collapsed.substr(i + 1, 2);
      if (collapsed[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hx)) { bytes.push(parseInt(hx, 16)); i += 2; }
      else bytes.push(collapsed.charCodeAt(i) & 0xff);
    }
    return Buffer.from(bytes).toString("utf8");
  }
  if (/content-transfer-encoding:\s*base64/i.test(head)) {
    try { return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8"); } catch { return body; }
  }
  return body;
}

/** turn an HTML part into readable plain text — the fallback for HTML-only
    clients, so a counsellor's reply never shows up as raw markup to a child */
function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

/** first text/plain section of a raw RFC822 message, quoted-printable decoded;
    falls back to a de-tagged text/html part, never raw MIME */
export function extractPlain(source) {
  const s = String(source || "").replace(/\r\n/g, "\n");
  const parts = s.split(/\n--[^\n]+\n/);
  const candidates = parts.length > 1 ? parts : [s];
  let htmlFallback = "";
  for (const part of candidates) {
    const split = part.indexOf("\n\n");
    if (split === -1) continue;
    const head = part.slice(0, split);
    const isHtml = /content-type:\s*text\/html/i.test(head);
    if (parts.length > 1 && !/content-type:\s*text\/plain/i.test(head) && !isHtml) continue;
    const body = decodeBody(head, part.slice(split + 2));
    if (isHtml) { if (!htmlFallback) htmlFallback = htmlToText(body); continue; }
    if (body.trim()) return body;
  }
  if (htmlFallback) return htmlFallback;
  return s.slice(s.indexOf("\n\n") + 2);
}

/* ---------------- loop ---------------- */

let timer = null;

export async function pollOnce() {
  /* Never collect while storage is degraded, and guard it HERE so both
     transports are covered — pollImap marks mail \Seen and pollDrop renames
     the file to .done, each unconditionally, and the fetch/scan afterwards
     only looks at unseen/undone items.

     Filing a reply needs getThread(), which finds nothing in an empty store,
     so record() refuses it — and the message was consumed anyway. That is a
     counsellor's answer destroyed permanently: the student waits forever
     while our own copy blames their school's spam filter. Skipping costs one
     poll cycle; the reply stays exactly where it is until storage is back. */
  if (degraded()) {
    console.error("[inbox] storage degraded — skipping poll so replies stay collectable");
    return 0;
  }
  try {
    return MODE === "live" ? await pollImap() : await pollDrop();
  } catch (err) {
    console.error("[inbox] poll failed:", err.message);
    return 0;
  }
}

export async function startPolling() {
  if (MODE !== "live" && !existsSync(DROP)) await mkdir(DROP, { recursive: true });
  if (MODE === "live" && !(process.env.BIT_GMAIL_USER && process.env.BIT_GMAIL_APP_PASSWORD)) {
    console.warn("[inbox] live mode without credentials — replies will not be collected");
    return;
  }
  const tick = async () => {
    const n = await pollOnce();
    if (n) console.log(`[inbox] collected ${n} repl${n === 1 ? "y" : "ies"}`);
    timer = setTimeout(tick, POLL_MS);
  };
  timer = setTimeout(tick, 1000);
}

export function stopPolling() {
  if (timer) clearTimeout(timer);
  timer = null;
}
