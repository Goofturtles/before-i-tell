/* server.js — the Before I Tell codename relay.

   Endpoints
     POST /send      start or continue a thread          → { tag, codename, pass? }
     POST /thread    read a thread (codename + pass)     → { messages }
     GET  /block     one-click permanent opt-out for a recipient
     GET  /health    liveness + mode

   Design rules this file enforces:
     1. Recipients must look like school accounts (schools.js). Without that
        rule this is an anonymous remailer.
     2. Tier-3 content is never relayed. It routes to humans instead.
     3. Reading a thread requires the passphrase, and the passphrase only ever
        travels in a POST body — never a URL, never a log line.
     4. No IP addresses, names, or device identifiers are persisted. Rate-limit
        counters live in memory and die with the process. */

// FIRST — populates process.env before any module below reads it at load time.
// Moving this line changes behaviour silently; see env.js.
import "./env.js";

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import * as store from "./store.js";
import { checkRecipient } from "./schools.js";
import { checkTier3 } from "./safety.js";
import { sendToCounsellor, modeInfo } from "./mailer.js";
import { startPolling } from "./inbox.js";

const PORT = Number(process.env.PORT || 8787);
const ALLOW_ORIGIN = process.env.BIT_ALLOW_ORIGIN || "*";
const MAX_BODY = 16 * 1024;
const MAX_MESSAGE = 4000;

/* ---------------- rate limits (memory only) ----------------
   Keyed by a salted hash of the IP so a heap dump isn't a list of who used a
   disclosure tool. Windows are coarse on purpose: a student writing to their
   counsellor a few times a day is normal; anything above is not. */
const RATE_SALT = createHash("sha256").update(String(Date.now()) + Math.random()).digest("hex");
const hits = new Map();
const HOUR = 3600000;

function bump(key, limit, windowMs) {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now > rec.reset) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  if (rec.n >= limit) return false;
  rec.n++;
  return true;
}

function ipKey(req) {
  const raw = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.socket.remoteAddress || "unknown";
  return createHash("sha256").update(RATE_SALT + raw).digest("hex").slice(0, 16);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, 10 * 60 * 1000).unref();

/** test hook: the limiter is keyed on a per-process salt, so a suite that
    deliberately exhausts a limit has no other way to get a fresh budget. */
export function _resetRates() { hits.clear(); }

/* ---------------- http helpers ---------------- */

function cors(res, origin) {
  const allow = ALLOW_ORIGIN === "*"
    ? "*"
    : (ALLOW_ORIGIN.split(",").map((s) => s.trim()).includes(origin) ? origin : ALLOW_ORIGIN.split(",")[0].trim());
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(body);
}

function html(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(new Error("bad json")); }
    });
    req.on("error", reject);
  });
}

/* ---------------- handlers ---------------- */

async function handleSend(req, res, body) {
  const message = String(body.message || "").trim();
  if (!message) return json(res, 400, { ok: false, reason: "empty" });
  if (message.length > MAX_MESSAGE) return json(res, 400, { ok: false, reason: "too_long" });

  // (2) crisis interception — before any recipient work, before anything is stored
  const risk = checkTier3(message);
  if (risk.tier === 3) {
    return json(res, 200, { ok: false, reason: "crisis", fam: risk.fam });
  }

  const key = ipKey(req);
  if (!bump("send:" + key, 12, HOUR)) return json(res, 429, { ok: false, reason: "rate" });

  let thread, pass = null, first = false;

  if (body.tag) {
    // continuing an existing thread
    thread = store.getThread(String(body.tag));
    if (!thread || !store.verifyPass(thread, body.pass)) {
      return json(res, 403, { ok: false, reason: "auth" });
    }
    if (!bump("thread:" + thread.tag, 20, HOUR)) return json(res, 429, { ok: false, reason: "rate" });
    // per-RECIPIENT ceiling across every thread: without this, 6 new threads
    // × 20/hour was 120 messages an hour into one counsellor's inbox
    if (!bump("inbox:" + thread.to, 30, 24 * HOUR)) return json(res, 429, { ok: false, reason: "rate_recipient" });
  } else {
    // (1) abuse gate — only school accounts, ever
    const gate = checkRecipient(body.to);
    if (!gate.ok) return json(res, 400, { ok: false, reason: gate.reason, domain: gate.domain || null });
    if (store.isBlocked(gate.email)) return json(res, 403, { ok: false, reason: "blocked" });
    if (!bump("to:" + gate.email, 6, 24 * HOUR)) return json(res, 429, { ok: false, reason: "rate_recipient" });
    if (!bump("inbox:" + gate.email, 30, 24 * HOUR)) return json(res, 429, { ok: false, reason: "rate_recipient" });

    const created = store.newThread({ to: gate.email, domain: gate.domain });
    thread = created.thread;
    pass = created.pass;
    first = true;
  }

  if (store.isBlocked(thread.to)) return json(res, 403, { ok: false, reason: "blocked" });

  const stored = store.addMessage(thread.tag, "student", message);
  try {
    await sendToCounsellor({ to: thread.to, codename: thread.codename, message, tag: thread.tag, first });
  } catch (err) {
    console.error("[send] delivery failed:", err.message);
    // Undeliverable means undelivered — the transcript must not imply otherwise.
    // New thread: drop it whole (its passphrase was never returned, so nobody
    // could ever open or delete it). Continuing thread: roll back just this
    // message, so the student doesn't see it sitting there looking sent.
    if (first) store.dropThread(thread.tag);
    else store.dropMessage(thread.tag, stored);
    return json(res, 502, { ok: false, reason: "delivery" });
  }

  return json(res, 200, {
    ok: true,
    tag: thread.tag,
    codename: thread.codename,
    pass,                                  // returned exactly once, on creation
    to: first ? thread.to : undefined,
    mode: modeInfo().mode,
  });
}

async function handleThread(req, res, body) {
  const key = ipKey(req);
  if (!bump("read:" + key, 60, HOUR)) return json(res, 429, { ok: false, reason: "rate" });

  const pass = String(body.pass || "");
  let thread = null;

  if (body.tag) {
    const t = store.getThread(String(body.tag));
    if (t && store.verifyPass(t, pass)) thread = t;
  } else {
    // codenames can collide; the passphrase is what actually authenticates
    for (const t of store.findByCodename(body.codename)) {
      if (store.verifyPass(t, pass)) { thread = t; break; }
    }
  }
  if (!thread) return json(res, 403, { ok: false, reason: "auth" });

  return json(res, 200, {
    ok: true,
    tag: thread.tag,
    codename: thread.codename,
    to: thread.to,
    adultReplied: thread.adultReplied,
    messages: thread.messages.map((m) => ({ from: m.from, body: m.body, at: m.at })),
  });
}

const escHtml = (s) => String(s)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function blockPage(res, title, note, form) {
  return html(res, 200, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)} — Before I Tell</title></head>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#fdf9f3;color:#33261e;margin:0;padding:48px 20px">
<div style="max-width:560px;margin:0 auto"><h1 style="font-size:26px;margin:0 0 14px">${escHtml(title)}</h1>
<p style="line-height:1.6">${note}</p>${form || ""}
<p style="line-height:1.6;font-size:14px;color:#6b5d52">If a student at your school is in danger, Kids Help Phone is 1-800-668-6868, 24/7.</p></div></body></html>`);
}

/* GET = show a confirm button. POST = actually block.
   Corporate mail security (M365 Safe Links, Proofpoint, Mimecast — which the
   Ontario boards run) fetches every URL in an inbound email. A GET that mutates
   state would silently blocklist a real counsellor before they ever read the
   message. RFC 9110 §9.2.1: GET must be safe. */
function handleBlockConfirm(res, url) {
  const tag = url.searchParams.get("tag") || "";
  const thread = store.getThread(tag);
  if (!thread) return blockPage(res, "Nothing to block", "That link has expired or the conversation is already closed. No further messages will be sent from it.");
  if (store.isBlocked(thread.to)) return blockPage(res, "Already blocked", `<b>${escHtml(thread.to)}</b> is already opted out. Nothing further will arrive.`);
  return blockPage(res,
    "Stop these messages?",
    `Press the button and <b>${escHtml(thread.to)}</b> will never receive another message from Before I Tell. Existing conversations to that address close immediately.`,
    `<form method="POST" action="/block" style="margin:22px 0">
       <input type="hidden" name="tag" value="${escHtml(tag)}">
       <button type="submit" style="font:inherit;font-weight:700;padding:12px 22px;border-radius:999px;border:none;background:#c2410c;color:#fff;cursor:pointer">Yes, block this address</button>
     </form>`);
}

async function handleBlockAct(req, res) {
  let tag = "";
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/json")) {
    tag = String((await readBody(req)).tag || "");
  } else {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) return json(res, 413, { ok: false, reason: "too_large" });
      chunks.push(c);
    }
    tag = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("tag") || "";
  }
  const thread = store.getThread(tag);
  if (!thread) return blockPage(res, "Nothing to block", "That link has expired or the conversation is already closed.");
  store.blockRecipient(thread.to);
  return blockPage(res, "Blocked.", `<b>${escHtml(thread.to)}</b> will not receive any further messages from Before I Tell. Nobody has to do anything else.`);
}

/* ---------------- server ---------------- */

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  cors(res, origin);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, ...modeInfo(), ...store.stats() });
    }
    if (req.method === "GET" && url.pathname === "/block") {
      return handleBlockConfirm(res, url);
    }
    if (req.method === "POST" && url.pathname === "/block") {
      return await handleBlockAct(req, res);
    }
    if (req.method === "POST" && url.pathname === "/send") {
      return await handleSend(req, res, await readBody(req));
    }
    if (req.method === "POST" && url.pathname === "/thread") {
      return await handleThread(req, res, await readBody(req));
    }
    return json(res, 404, { ok: false, reason: "not_found" });
  } catch (err) {
    // never echo the error: it can contain fragments of what was posted
    console.error("[server]", req.method, url.pathname, err.message);
    return json(res, 400, { ok: false, reason: "bad_request" });
  }
});

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain || process.env.BIT_AUTOSTART === "1") {
  await store.init();
  await startPolling();
  server.listen(PORT, () => {
    const m = modeInfo();
    console.log(`[relay] listening on :${PORT} · mode=${m.mode}${m.configured ? "" : " (NOT CONFIGURED)"}`);
    if (m.mode !== "live") console.log("[relay] dry run — mail is written to outbox/, replies read from inbox-drop/");
  });
}

export { server };
