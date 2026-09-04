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
export const rejected = { senderMismatch: 0, expiredThread: 0, emptyBody: 0, automated: 0, authFailed: 0 };

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

/** Bare address out of `Name <a@b.c>` or `a@b.c`, or "" if there isn't a
    well-formed one.

    This is a TRUST decision, not a formatting convenience: its answer decides
    whether a message is filed as the counsellor's. Three things it must do,
    each of which it previously got wrong:

    1. Drop quoted display names FIRST. A display name may legally contain
       angle brackets, and taking the first `<…>` meant
         From: "Guidance <guidance@school.ca>" <attacker@evil.com>
       authenticated as the counsellor while the mail genuinely came from
       evil.com — passing SPF/DKIM/DMARC for evil.com, so it lands in the
       inbox normally. If the crafted inner address matched the thread's
       recipient exactly, even the "replied by someone else" note was skipped.
    2. Accept EXACTLY ONE distinct address, or nothing. "Take the last
       angle-addr" was the first fix here and it is itself a vulnerability:
       `From:` is a mailbox-LIST in RFC 5322, so
         From: bot@evil.com, Guidance <guidance@school.ca>
       is valid, Gmail delivers it, and "the last one" is the school address.
    3. Validate the result is actually an address — exactly one "@", no
       whitespace, non-empty on both sides. Without this, `<@school.ca>` and
       `<x] arbitrary text [y@school.ca>` both parsed to something whose
       "domain" was the school, which passed the same-domain check AND got
       interpolated into the note the student reads. */
export function addressOf(headerValue) {
  // quoted display names and parenthesised comments are sender-chosen text
  const s = String(headerValue || "")
    .replace(/"(?:[^"\\]|\\.)*"/g, " ")
    .replace(/\((?:[^()\\]|\\.)*\)/g, " ");
  const strict = /^[^\s<>,;:"@]+@[^\s<>,;:"@]+$/;
  const found = [];
  for (const a of s.match(/<[^<>]*>/g) || []) {
    const inner = a.slice(1, -1).trim();
    if (strict.test(inner)) found.push(inner.toLowerCase());
  }
  // bare addresses OUTSIDE any angle brackets count too
  for (const b of s.replace(/<[^<>]*>/g, " ").match(/[^\s<>,;:"@]+@[^\s<>,;:"@]+/g) || []) {
    if (strict.test(b)) found.push(b.toLowerCase());
  }
  /* Exactly one, or nothing. `From:` is a mailbox-LIST in RFC 5322, so
       From: bot@evil.com, Guidance <guidance@school.ca>
     is valid and Gmail delivers it — and "take the last angle-addr" happily
     returned the school address, re-opening the spoof this function exists to
     close. Worse, when that address equals the thread's recipient the
     "replied by someone else" note is skipped too, so an outsider is filed as
     the counsellor verbatim. A real reply never names two senders; refusing
     is both correct and safe. */
  const uniq = [...new Set(found)];
  return uniq.length === 1 ? uniq[0] : "";
}

/* Public suffixes a domain can sit UNDER but never BE. Treating one as a
   parent domain would make every school under it "the same school": with
   `@ca` as the sender, "wrdsb.ca".endsWith(".ca") is true, so any address at
   the bare TLD could answer any Canadian school's thread. Mirrors the shapes
   schools.js already enumerates. */
const PUBLIC_SUFFIX = [
  /^[a-z]{2,}$/i,               // bare TLD: ca, net, edu, com
  /^on\.ca$/i, /^bc\.ca$/i, /^ab\.ca$/i, /^qc\.ca$/i, /^ns\.ca$/i,
  /^mb\.ca$/i, /^sk\.ca$/i, /^nb\.ca$/i, /^nl\.ca$/i, /^pe\.ca$/i,
  /^edu\.[a-z]{2}$/i, /^ac\.[a-z]{2}$/i, /^sch\.[a-z]{2}$/i,
  /^k12\.[a-z]{2}\.us$/i, /^edu\.on\.ca$/i,
  /* Reachable through schools.js's own accepted shapes: it admits
     *.k12.<st>.us and *.edu.au, so without these a thread to
     smith.k12.or.us would accept a forged sender at "or.us", and one to
     qld.edu.au a sender at "qld.edu.au". */
  /^[a-z]{2}\.us$/i,
  /^(?:act|nsw|nt|qld|sa|tas|vic|wa|catholic|schools)\.edu\.au$/i,
];

/** Can this domain be registered by one organisation — i.e. is it safe to
    treat as "one school" for the purpose of matching a subdomain? */
export function isRegistrable(domain) {
  const d = String(domain || "").toLowerCase();
  if (d.split(".").length < 2) return false;
  return !PUBLIC_SUFFIX.some((re) => re.test(d));
}

/** Did the receiving server explicitly say this message FAILED authentication?

    Deliberately not the inverse of "did it pass". Requiring a pass would refuse
    mail from the many school domains with weak or absent DKIM, and refusing a
    real reply is the worst failure this system has — the whole session's work
    has been about not doing that. So this returns true only on positive
    evidence of forgery: a DMARC failure, or both SPF and DKIM failing.
    Absent, unparseable, or inconclusive headers are treated as no evidence.

    We read the From header for identity, and a forged From is exactly what
    these results detect, so this is the one signal that is not attacker-
    controlled — Gmail stamps it on arrival. (An attacker can add their own
    Authentication-Results line to the body of the message, but it lands
    BELOW Gmail's, and headerBlock keeps only the real header block.) */
export function authFailed(headers) {
  /* UNFOLD FIRST. Gmail always wraps this header, putting every dkim=/spf=/
     dmarc= token on a continuation line:
       Authentication-Results: mx.google.com;
              dkim=fail ...; spf=fail; dmarc=fail (p=REJECT)
     Matching the first physical line therefore saw no verdict at all and this
     function returned false for every message ever received — a check that was
     100% dead while /health reported "no forgery seen". Verified by running it
     against a real folded header. */
  const h = unfold(headerBlock(headers)).toLowerCase();
  const lines = h.split("\n").filter((l) => l.startsWith("authentication-results:"));
  /* Evaluate each header on its OWN. A message can carry several — one from
     the board's gateway, one from Gmail — and joining them let an upstream
     `spf=fail` combine with Gmail's `dkim=fail` to read as forged even when
     Gmail's own verdict was spf=pass, dmarc=pass. That would consume a real
     counsellor's reply on evidence no single server actually gave. */
  return lines.some((l) =>
    /dmarc=fail/.test(l) || (/spf=fail/.test(l) && /dkim=fail/.test(l)));
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
  // unfolded for the same reason as authFailed: `From: "Automatic Reply"\n
  // <no-reply@board.ca>` hid the no-reply address from the [^\n]* below
  const h = unfold(headerBlock(headers));
  return /^auto-submitted:\s*auto/im.test(h)
    || /^precedence:\s*(bulk|auto_reply|junk|list)/im.test(h)
    || /^x-auto(response|reply)/im.test(h)
    || /^content-type:\s*multipart\/report/im.test(h)          // DSN / bounce
    /* Test the ADDRESS, not the whole From line. Unfolding made that line
       include the display name, so a counsellor whose signature reads
       "Jane — do-not-reply to this thread" had their genuine answer dropped
       as machine mail. What matters is who sent it, not what they called
       themselves. */
    || /(mailer-daemon|postmaster|no-?reply|do-?not-?reply)/i
         .test(addressOf(/^from:\s*(.+)$/im.exec(h)?.[1] || ""));
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
  /* Positive evidence the From header was forged. Checked before identity,
     because identity is derived FROM that header. */
  if (authFailed(rawHeaders)) {
    rejected.authFailed++;
    console.warn(`[inbox] dropped reply on ${tag.slice(0, 8)}: the receiving server reported an authentication failure`);
    return "rejected";
  }
  if (isAutomated(rawHeaders)) {
    // a false positive here (a board stamping Precedence: bulk on all mail)
    // destroys a real reply, so make it visible rather than silent
    rejected.automated++;
    console.warn(`[inbox] dropped reply on ${tag.slice(0, 8)}: looks like machine mail (auto-reply, bounce or no-reply sender)`);
    return "rejected";
  }
  /* Sender check: the exact address, OR another address at the same school.
     The operator chose same-domain deliberately, because refusing an alias,
     a shared guidance@ mailbox, or an Exchange-rewritten address meant real
     answers to children were never delivered.

     The accepted risk: the thread tag rides in the Reply-To of an email a
     counsellor can forward, so a colleague at that school who receives a
     forward could write into the conversation.

     The bound is "that school's domain", and it is only as strong as our
     reading of the From header — which the sender writes. addressOf() closes
     the display-name spoof that made this claim false, and authFailed()
     refuses mail the receiving server positively flagged as forged. Neither
     is proof of identity: a domain with no DMARC policy can still be
     spoofed by someone who also holds the tag. Do not upgrade this comment
     to a guarantee. */
  const sender = addressOf(fromHeader);
  const to = String(thread.to).toLowerCase();
  const senderDomain = sender.includes("@") ? sender.split("@").pop() : "";
  /* No fallback to the recipient's own domain. A thread with no stored domain
     is a DEMO thread (schools.js returns null for those on purpose), and
     deriving the domain from the address would hand the whole of gmail.com
     the ability to reply into it. Missing domain therefore means exact match
     only — the safe direction. */
  const threadDomain = String(thread.domain || "").toLowerCase();
  /* Subdomain-aware in BOTH directions, because school mail is: a thread to
     x@mail.pdsb.net whose counsellor replies from the Exchange-primary
     x@pdsb.net is exactly the case this widening exists to fix, and an exact
     string compare still refused it. Anchored on a dot so "evilwrdsb.ca"
     cannot pass as a subdomain of "wrdsb.ca". */
  const sameDomain = Boolean(senderDomain) && Boolean(threadDomain) && (
    senderDomain === threadDomain ||
    // thread's domain is the parent: sender is a subdomain of the school
    (isRegistrable(threadDomain) && senderDomain.endsWith("." + threadDomain)) ||
    // sender's domain is the parent: the Exchange-primary answering a
    // subdomain thread. The parent must be registrable, or "@ca" matches
    // every .ca school and "@net" every .net one.
    (isRegistrable(senderDomain) && threadDomain.endsWith("." + senderDomain)));
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
  if (!clean) {
    /* Log the tag, not just a counter. Once the mail is marked \Seen the
       counter alone cannot tell you WHICH conversation lost a reply. */
    rejected.emptyBody++;
    console.warn(`[inbox] dropped reply on ${tag.slice(0, 8)}: no readable text (attachment-only, calendar or opaque message)`);
    return "rejected";
  }
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
  /* Split on the message's DECLARED boundaries. Splitting on any `\n--…\n`
     also matched a counsellor separating paragraphs with "---", truncating
     their reply there.

     ALL of them, not the first. A normal Outlook reply with a signature image
     is multipart/mixed[ multipart/alternative[plain, html], image ], and
     splitting only on the outer boundary leaves the inner part whole: its head
     reads "Content-Type: multipart/alternative", which matches neither
     text/plain nor text/html, so every part is skipped and the function fell
     through to returning the ENTIRE MIME body — a child who had just disclosed
     would open their reply and read boundary markers, headers, and base64
     image bytes. Verified by running it before this fix.

     Quoted form handled too: a boundary may legally contain spaces. */
  const boundaries = [...unfold(s).matchAll(/boundary=(?:"([^"]*)"|([^;\s]+))/gi)]
    .map((m) => m[1] ?? m[2]).filter(Boolean);
  const esc = (b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /* NO boundary declared means the message is not multipart, so there is
     nothing to split. Splitting anyway is what the loose `\n--…\n` pattern
     did, and it cut a plain-text reply in half at any line of dashes:
       Thanks for writing.
       ---
       Come to my office Thursday.
     kept only the first half and dropped the instruction, silently. The
     comment above used to claim this was fixed; it was fixed only for
     messages that DO declare a boundary. Verified by running it. */
  /* SINGLE-PART: no boundary declared, so the message is its own body — and
     its own Content-Type decides whether we may show it at all. The previous
     version returned everything after the headers unconditionally, so a
     counsellor sending a meeting invite from Outlook (text/calendar, no
     boundary) had "BEGIN:VCALENDAR VERSION:2.0 PRODID:-//Microsoft…" filed
     under "They replied" to a child who had just disclosed. An opaque S/MIME
     message rendered as binary mojibake the same way. Both verified by running
     it.

     Note text/* is NOT the right test: text/calendar is text/*. Only the two
     types a human actually wrote in are shown. An absent Content-Type means
     text/plain per RFC 2045. */
  if (!boundaries.length) {
    const end = s.indexOf("\n\n");
    if (end === -1) return "";
    const head = s.slice(0, end);
    /* ANCHORED. Unanchored, this matched the first "content-type:" ANYWHERE in
       the header block — and Microsoft 365 prepends a DKIM-Signature whose h=
       tag list literally reads
         h=From:Date:Subject:Message-ID:Content-Type:MIME-Version:X-MS-...
       so the captured "type" became "mime-version:x-ms-exchange-senderadcheck",
       matched neither branch, and every plain-text reply from an M365 school
       (most Ontario boards) returned "" and was destroyed. X-Original-Content-
       Type does the same. Unfolding puts each real header at a line start, so
       ^…$m can only match a genuine header. Verified by running it against a
       realistic M365 header block. */
    const type = (/^content-type:\s*([^;\s]+)/im.exec(unfold(head))?.[1] || "text/plain").toLowerCase();
    const body = decodeBody(head, s.slice(end + 2));
    if (type === "text/html") return htmlToText(body);
    if (type === "text/plain") return body;
    return "";
  }

  let parts = s.split(
    new RegExp("\\n--(?:" + boundaries.map(esc).join("|") + ")(?:--)?[ \\t]*\\n?"));
  /* Inert for any message whose delimiters are whole lines — which is all
     well-formed mail. The trigger scans a whole part while the loop's accept
     test scans only its head, so a part the loop could accept would already
     have suppressed the trigger; removing a whole `\n--…\n` line cannot create
     a line start that did not exist. Deleting the branch leaves 201/201.

     NOT inert in general, and an earlier version of this comment wrongly said
     so. `boundary="([^"]*)"` matches across a newline, so a bare LF inside a
     quoted boundary makes the delimiter eat a prefix of the following line —
     the strict split then leaves a part whose head has been chewed, the
     trigger fires, and the loose split does recover the text. Malformed mail
     only, and it rescues rather than admits (identity and auth checks are
     untouched), so the branch stays. Verified both directions by running it. */
  if (!parts.some((p) => /^content-type:\s*text\//im.test(p))) {
    parts = s.split(/\n--[^\n]+\n/);
  }
  let htmlFallback = "";
  for (const part of parts) {
    const split = part.indexOf("\n\n");
    if (split === -1) continue;
    const head = part.slice(0, split);
    // anchored for the same reason as the single-part branch above; parts[0]
    // is the RFC822 header block plus Outlook's "This is a multi-part message"
    // preamble, and an unanchored match there returned the preamble as the reply
    const uhead = unfold(head);
    const isHtml = /^content-type:\s*text\/html/im.test(uhead);
    if (!/^content-type:\s*text\/plain/im.test(uhead) && !isHtml) continue;
    /* An attachment is not the reply. Exchange emits the body as text/html and
       drops an "ATT00001.txt" beside it, and taking the first text/plain part
       returned the attachment while the real answer became only a fallback. */
    if (/^content-disposition:\s*attachment/im.test(uhead) || /\bfilename=/i.test(uhead)) continue;
    const body = decodeBody(head, part.slice(split + 2));
    if (isHtml) { if (!htmlFallback) htmlFallback = htmlToText(body); continue; }
    if (body.trim()) return body;
  }
  if (htmlFallback) return htmlFallback;
  /* Multipart with no readable text part — an attachment-only reply, or a
     boundary that was declared but never appears (truncated mail). Returning
     everything after the first blank line here handed the student the raw MIME
     body: boundary markers, part headers and base64 bytes, filed as their
     counsellor's words. Return nothing instead, so record() counts
     rejected.emptyBody and logs the tag; a visible "no reply arrived" beats a
     wall of machine output presented as an answer to a disclosure. */
  return "";
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
