/* relay.test.mjs — end-to-end test of the codename relay, dry mode.
   Run:  node test/relay.test.mjs   (from relay/)
   No credentials, no network, no npm install required. */

import { mkdtempSync, rmSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "bit-relay-"));
process.env.BIT_RELAY_MODE = "dry";
process.env.BIT_DATA_DIR = join(TMP, "data");
process.env.BIT_OUTBOX_DIR = join(TMP, "outbox");
process.env.BIT_INBOX_DROP = join(TMP, "drop");
process.env.BIT_AUTOSTART = "0";
process.env.PORT = "8799";

const { server, _resetRates } = await import("../server.js");
const store = await import("../store.js");
const { pollOnce } = await import("../inbox.js");
const { checkRecipient } = await import("../schools.js");

await store.init();
mkdirSync(process.env.BIT_INBOX_DROP, { recursive: true });
await new Promise((r) => server.listen(8799, r));
const BASE = "http://127.0.0.1:8799";

let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}
function group(n) { console.log(`\n${n}`); }

const post = async (path, body) => {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
};

/* ---------------- 1. the abuse gate ---------------- */
group("1. recipient gate (the anti-remailer rule)");
for (const bad of ["someone@gmail.com", "kid@hotmail.com", "x@yahoo.ca", "a@proton.me",
                   "target@mail.gmail.com", "person@mailinator.com", "user@rogers.com"]) {
  ok(`rejects personal mail: ${bad}`, checkRecipient(bad).reason === "personal");
}
for (const bad of ["notanemail", "no@domain", "a b@tdsb.on.ca", "x@tdsb.on.ca\nBcc: evil@x.com"]) {
  ok(`rejects malformed: ${JSON.stringify(bad)}`, checkRecipient(bad).ok === false);
}
for (const good of ["counsellor@tdsb.on.ca", "j.smith@yrdsb.ca", "help@ocdsb.ca",
                    "s@mail.tdsb.on.ca",      // subdomain of a listed board
                    "s@kprdsb.ca",            // listed board
                    "s@zzdsb.on.ca",          // board not in the list, right shape
                    "advisor@school.edu", "x@wcdsb.ca"]) {
  ok(`accepts school address: ${good}`, checkRecipient(good).ok === true, JSON.stringify(checkRecipient(good)));
}
ok("rejects unknown non-school domain", checkRecipient("boss@randomcorp.io").reason === "unknown");

/* ---------------- 2. crisis interception ---------------- */
group("2. crisis content is never relayed");
for (const text of [
  "i want to kill myself",
  "I don't want to be here anymore",
  "my dad hits me",
  "I'm not safe at home",
  "i’ve been cutting myself",   // smart apostrophe
]) {
  const r = await post("/send", { to: "counsellor@tdsb.on.ca", message: text });
  ok(`blocked + routed to humans: ${JSON.stringify(text.slice(0, 28))}`,
     r.json.ok === false && r.json.reason === "crisis", JSON.stringify(r.json));
}
const outboxFiles = () => { try { return readdirSync(process.env.BIT_OUTBOX_DIR); } catch { return []; } };
ok("nothing was written to the outbox by crisis attempts", outboxFiles().length === 0);
ok("no thread was created by crisis attempts", store.stats().threads === 0);

/* ---------------- 3. happy path: send ---------------- */
group("3. first message creates a codename thread");
const first = await post("/send", {
  to: "counsellor@tdsb.on.ca",
  message: "Hi. There's something going on at home I don't really know how to say out loud. Can I talk to you?",
});
ok("accepted", first.json.ok === true, JSON.stringify(first.json));
ok("returns a codename", /^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/.test(first.json.codename || ""), first.json.codename);
ok("returns a passphrase exactly once", typeof first.json.pass === "string" && first.json.pass.length >= 8);
ok("returns a thread tag", /^[0-9a-f]{18}$/.test(first.json.tag || ""));
const outbox = outboxFiles();
ok("wrote one email", outbox.length === 1, outbox.join(","));

const eml = (await import("node:fs")).readFileSync(join(process.env.BIT_OUTBOX_DIR, outbox[0]), "utf8");
ok("email goes to the school address", /^To: counsellor@tdsb\.on\.ca$/m.test(eml));
ok("Reply-To carries the thread tag", eml.includes(`+bit${first.json.tag}@`), eml.split("\n")[2]);
ok("email contains the student's message", eml.includes("don't really know how to say out loud"));
ok("email explains how to block", eml.includes("/block?tag="));
ok("email states the duty to report is unchanged", /duty to report/i.test(eml));

/* ---------------- 4. reading the thread ---------------- */
group("4. thread reads require the passphrase");
const wrongPass = await post("/thread", { codename: first.json.codename, pass: "WRONG-PASS" });
ok("wrong passphrase is refused", wrongPass.status === 403 && wrongPass.json.reason === "auth");
const noPass = await post("/thread", { codename: first.json.codename });
ok("missing passphrase is refused", noPass.status === 403);
const read = await post("/thread", { codename: first.json.codename, pass: first.json.pass });
ok("correct passphrase reads the thread", read.json.ok === true);
ok("thread has the student's message", read.json.messages?.length === 1 && read.json.messages[0].from === "student");

/* ---------------- 5. the counsellor replies ---------------- */
group("5. reply routing (plus-address → thread)");
writeFileSync(join(TMP, "drop", "reply1.txt"),
  `To: relay+bit${first.json.tag}@gmail.com\nFrom: counsellor@tdsb.on.ca\nSubject: Re: [Before I Tell]\n\n` +
  `Thank you for writing. You can come by my office any time this week — you don't need an appointment.\n\n` +
  `On Fri, Aug 15 2026, Before I Tell wrote:\n> Hi. There's something going on at home\n`);
const collected = await pollOnce();
ok("collected the reply", collected === 1, String(collected));

const read2 = await post("/thread", { codename: first.json.codename, pass: first.json.pass });
ok("reply is in the thread", read2.json.messages?.length === 2);
ok("reply is attributed to the adult", read2.json.messages?.[1]?.from === "adult");
ok("quoted original was stripped", !read2.json.messages?.[1]?.body.includes("going on at home"));
ok("counsellor's own words survived", read2.json.messages?.[1]?.body.includes("come by my office"));
ok("thread is marked as replied", read2.json.adultReplied === true);

/* ---------------- 6. continuing the conversation ---------------- */
group("6. continuing a thread");
const noAuth = await post("/send", { tag: first.json.tag, pass: "NOPE", message: "hello again" });
ok("continuing without the passphrase is refused", noAuth.status === 403);
const second = await post("/send", { tag: first.json.tag, pass: first.json.pass, message: "Thanks. Is Thursday ok?" });
ok("continuing with the passphrase works", second.json.ok === true, JSON.stringify(second.json));
ok("no second passphrase is issued", second.json.pass == null);
ok("a second email went out", outboxFiles().length === 2);

/* ---------------- 7. the block link ---------------- */
group("7. recipient opt-out");
const blockRes = await fetch(`${BASE}/block`, {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ tag: first.json.tag }).toString(),
});
const blockHtml = await blockRes.text();
ok("block page confirms", blockRes.status === 200 && /Blocked\./.test(blockHtml));
const afterBlock = await post("/send", { tag: first.json.tag, pass: first.json.pass, message: "one more" });
ok("blocked address receives nothing further", afterBlock.status === 403 && afterBlock.json.reason === "blocked");
const newThreadToBlocked = await post("/send", { to: "counsellor@tdsb.on.ca", message: "starting fresh" });
ok("blocked address cannot be re-targeted by a new thread",
   newThreadToBlocked.status === 403 && newThreadToBlocked.json.reason === "blocked");

/* ---------------- 8. limits + hygiene ---------------- */
group("8. limits and hygiene");
const long = await post("/send", { to: "c@yrdsb.ca", message: "x".repeat(4001) });
ok("over-long message refused", long.json.reason === "too_long");
const empty = await post("/send", { to: "c@yrdsb.ca", message: "   " });
ok("empty message refused", empty.json.reason === "empty");
const health = await (await fetch(`${BASE}/health`)).json();
ok("health reports dry mode", health.ok === true && health.mode === "dry");

// cap is 120/h (venue WiFi shares one egress IP — see server.js); distinct
// recipients so the per-recipient caps don't fire first
let limited = false;
for (let i = 0; i < 130; i++) {
  const r = await post("/send", { to: `c${i}@ddsb.ca`, message: "hello there" });
  if (r.status === 429 && r.json.reason === "rate") { limited = true; break; }
}
ok("per-IP send limit engages", limited);

// authfail gate on the scrypt oracle: failures charge, success doesn't,
// the 31st guess goes quiet, and a cleared window lets the right pass in
_resetRates();
const at = await post("/send", { to: "counsellor@tdsb.on.ca", message: "auth gate probe" });
ok("auth-gate thread created", at.json.ok === true, JSON.stringify(at.json));
for (let i = 0; i < 30; i++) await post("/send", { tag: at.json.tag, pass: "wrong-pass", message: "x" });
const gated = await post("/send", { tag: at.json.tag, pass: "wrong-pass", message: "x" });
ok("31st failed guess is rate-limited, not auth", gated.status === 429 && gated.json.reason === "rate");
const rightButGated = await post("/send", { tag: at.json.tag, pass: at.json.pass, message: "y" });
ok("closed gate holds even for the right passphrase (by design, 1h max)", rightButGated.status === 429);
_resetRates();
const rightAfterClear = await post("/send", { tag: at.json.tag, pass: at.json.pass, message: "hello again" });
ok("correct passphrase works once the window clears", rightAfterClear.json.ok === true, JSON.stringify(rightAfterClear.json));
const readAfterSuccess = await post("/thread", { tag: at.json.tag, pass: at.json.pass });
ok("successes never charged the authfail bucket", readAfterSuccess.json.ok === true);

const dump = JSON.stringify(store._db());
ok("no IP address is persisted", !/\b\d{1,3}(\.\d{1,3}){3}\b/.test(dump));
ok("passphrase is not stored in the clear", !dump.includes(first.json.pass));
ok("passphrase hash is stored", dump.includes(store.getThread(first.json.tag).passHash));

/* ---------------- 9. audit regressions ---------------- */
group("9. audit regressions (must never come back)");
_resetRates(); // section 8 deliberately exhausted the per-IP send budget
const { checkTier3 } = await import("../safety.js");
const { isAutomated, addressOf } = await import("../inbox.js");

// blocker 1 — ordinary English must not be read as a crisis
for (const benign of [
  "things have been odd at home lately",
  "this homework is killing me",
  "my mum will kill me if she finds out",
  "the noise is hurting me a bit",
  "that was an odd week",
]) {
  ok(`not a crisis: ${JSON.stringify(benign.slice(0, 34))}`, checkTier3(benign).tier === 0);
}
// …while real crisis language still is
for (const real of ["i want to kill myself", "i have been cutting myself", "i od'd last night",
                    "i think i overdosed", "self harm", "i want to die",
                    // hackathon-audit additions (verified real teen phrasings that used to slip through)
                    "gonna end it all", "im going to end my life", "i want to hang myself",
                    "i want to off myself", "no reason to live", "want to slit my wrists",
                    "he raped me", "i was raped", "my uncle molested me", "someone touched me",
                    "i don't feel safe at home", "my dad chokes me"]) {
  ok(`still a crisis: ${JSON.stringify(real.slice(0, 34))}`, checkTier3(real).tier === 3);
}

// blocker 2 — inbound replies must be authenticated
const t2 = await post("/send", { to: "counsellor@yrdsb.ca", message: "hello, can we talk this week" });
ok("second thread created", t2.json.ok === true, JSON.stringify(t2.json));

writeFileSync(join(TMP, "drop", "forged.txt"),
  `To: relay+bit${t2.json.tag}@gmail.com\nFrom: stranger@elsewhere.com\nSubject: Re:\n\nI forwarded this to myself. Meet me alone.\n`);
await pollOnce();
let after = await post("/thread", { tag: t2.json.tag, pass: t2.json.pass });
ok("forged sender is rejected", after.json.messages.length === 1, JSON.stringify(after.json.messages?.map(m => m.from)));

writeFileSync(join(TMP, "drop", "ooo.txt"),
  `To: relay+bit${t2.json.tag}@gmail.com\nFrom: counsellor@yrdsb.ca\nAuto-Submitted: auto-replied\nSubject: Out of Office\n\nI am away until September.\n`);
await pollOnce();
after = await post("/thread", { tag: t2.json.tag, pass: t2.json.pass });
ok("out-of-office auto-reply is not shown as a reply", after.json.messages.length === 1);

writeFileSync(join(TMP, "drop", "bounce.txt"),
  `To: relay+bit${t2.json.tag}@gmail.com\nFrom: MAILER-DAEMON@gmail.com\nContent-Type: multipart/report; report-type=delivery-status\nSubject: Undelivered\n\nDelivery failed permanently.\n`);
await pollOnce();
after = await post("/thread", { tag: t2.json.tag, pass: t2.json.pass });
ok("bounce message is not shown as a reply", after.json.messages.length === 1);

writeFileSync(join(TMP, "drop", "genuine.txt"),
  `To: relay+bit${t2.json.tag}@gmail.com\nFrom: "A Counsellor" <counsellor@yrdsb.ca>\nSubject: Re:\n\nOf course. Come find me Tuesday.\n`);
await pollOnce();
after = await post("/thread", { tag: t2.json.tag, pass: t2.json.pass });
ok("the genuine counsellor reply still lands", after.json.messages.length === 2 && after.json.messages[1].from === "adult");
ok("addressOf parses a display-name From", addressOf('"A Counsellor" <c@yrdsb.ca>') === "c@yrdsb.ca");
ok("isAutomated catches Precedence: bulk", isAutomated("Precedence: bulk\n"));

// blocker 3 — /block must not mutate on GET
const t3 = await post("/send", { to: "head@ocdsb.ca", message: "hi there, hoping to talk" });
const scanned = await fetch(`${BASE}/block?tag=${t3.json.tag}`);   // simulates a link scanner
const scannedHtml = await scanned.text();
ok("GET /block only offers a confirmation", scanned.status === 200 && /Stop these messages\?/.test(scannedHtml));
const stillWorks = await post("/send", { tag: t3.json.tag, pass: t3.json.pass, message: "just following up" });
ok("a scanner prefetch does NOT block a real counsellor", stillWorks.json.ok === true, JSON.stringify(stillWorks.json));
const acted = await fetch(`${BASE}/block`, {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ tag: t3.json.tag }).toString(),
});
ok("POST /block actually blocks", /Blocked\./.test(await acted.text()));

// registrable-domain laundering
ok("rejects a registrable lookalike board (.com)", checkRecipient("x@evildsb.com").ok === false);
ok("rejects a registrable lookalike board (.net)", checkRecipient("x@fakecdsb.net").ok === false);
ok("still accepts a real board", checkRecipient("x@tvdsb.ca").ok === true);

/* ---------------- 10. re-audit regressions ---------------- */
group("10. re-audit regressions");
const { headerBlock } = await import("../inbox.js");

// .env must be loaded BEFORE any module reads process.env at load time.
// (ESM evaluates imports before module-body statements — an inline loader in
// server.js ran too late and silently left the service in dry mode.)
{
  const envDir = join(TMP, "envtest");
  mkdirSync(envDir, { recursive: true });
  const envFile = join(envDir, "test.env");
  writeFileSync(envFile, "# comment\nBIT_PROBE_VALUE = hello-from-env\nexport BIT_PROBE_QUOTED=\"quoted value\"\n");
  const probe = await import(`../env.js?bust=${envFile.length}`).catch(() => null);
  // env.js reads at import time; drive it explicitly through its documented knob
  delete process.env.BIT_PROBE_VALUE;
  process.env.BIT_ENV_FILE = envFile;
  await import(`../env.js?again=1`);
  ok("env loader reads KEY = value", process.env.BIT_PROBE_VALUE === "hello-from-env", process.env.BIT_PROBE_VALUE);
  ok("env loader strips quotes and `export`", process.env.BIT_PROBE_QUOTED === "quoted value", process.env.BIT_PROBE_QUOTED);
  // Position, not presence: with /m alone, `^` matches ANY line start, so a
  // reordered import still passed and the test only caught deletion.
  {
    const src = (await import("node:fs")).readFileSync(new URL("../server.js", import.meta.url), "utf8");
    const envAt = src.search(/^import\s+["']\.\/env\.js["']/m);
    const firstAt = src.search(/^import\b/m);
    ok("./env.js is the FIRST import in server.js", envAt !== -1 && envAt === firstAt,
       `env.js at ${envAt}, first import at ${firstAt} — moving it silently reverts the dry-mode bug`);
  }
  void probe;
}

// a failed reply must not leave the message looking delivered
{
  const t = await post("/send", { to: "c@hdsb.ca", message: "first message here" });
  ok("thread for rollback test", t.json.ok === true, JSON.stringify(t.json));
  const ghost = store.addMessage(t.json.tag, "student", "this one never left");
  ok("message present before rollback", store.getThread(t.json.tag).messages.length === 2);
  // a counsellor reply lands in the gap between send and delivery failure
  store.addMessage(t.json.tag, "adult", "meanwhile, here is my reply");
  store.dropMessage(t.json.tag, ghost);
  const left = store.getThread(t.json.tag).messages;
  ok("rollback removes the undelivered message", !left.some((m) => m.body === "this one never left"));
  ok("rollback does NOT eat the reply that raced it", left.some((m) => m.body === "meanwhile, here is my reply"));
  ok("rollback is idempotent", store.dropMessage(t.json.tag, ghost) === false);
}

// isAutomated must inspect headers only — a quoted line in a reply body was
// silently deleting real counsellor replies
ok("headerBlock stops at the blank line", headerBlock("From: a@b.c\nSubject: x\n\nPrecedence: bulk in the body") === "From: a@b.c\nSubject: x");
ok("quoted 'Precedence: bulk' in a BODY is not treated as automated",
   isAutomated("From: c@yrdsb.ca\nSubject: Re:\n\n> Precedence: bulk\nSee you Tuesday.") === false);
ok("real Precedence header IS treated as automated",
   isAutomated("From: c@yrdsb.ca\nPrecedence: bulk\n\nbody") === true);

// CRLF drop files (Windows) must still parse
{
  const t = await post("/send", { to: "c@wrdsb.ca", message: "hello from windows" });
  writeFileSync(join(TMP, "drop", "crlf.txt"),
    `To: relay+bit${t.json.tag}@gmail.com\r\nFrom: c@wrdsb.ca\r\nSubject: Re:\r\n\r\nYes, come by Thursday.\r\n`);
  await pollOnce();
  const read = await post("/thread", { tag: t.json.tag, pass: t.json.pass });
  ok("CRLF drop file parses on Windows", read.json.messages.length === 2, JSON.stringify(read.json.messages?.map(m => m.from)));
}

/* ---------------- done ---------------- */
console.log(`\n${pass} passed, ${fail} failed\n`);
server.close();
rmSync(TMP, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
