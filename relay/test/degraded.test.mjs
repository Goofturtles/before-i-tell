/* degraded.test.mjs — the invariant this whole storage change exists for.
   Run:  node test/degraded.test.mjs   (from relay/)

   Lives in its OWN process because DURABLE is decided once, at import time,
   from DATABASE_URL — the main suite forces the file store, so it can never
   exercise this path.

   The URL points at a closed port so nothing real is touched and no send can
   escape. Note what actually fails locally: with `pg` not installed, init()
   fails at `import("pg")` rather than at connect. That is deliberate and
   fine — the invariant is "init() failed for ANY reason, so writes must
   refuse", and both routes land in the same catch. On Render, where pg is
   installed, the same assertions run against a real connection refusal. */

import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BIT_RELAY_MODE = "dry";
process.env.BIT_AUTOSTART = "0";
process.env.PORT = "8801";
// a real drop directory: without one, pollDrop() returns 0 before touching
// anything, and an assertion that it "collected nothing" proves nothing
const TMP = mkdtempSync(join(tmpdir(), "bit-degraded-"));
process.env.BIT_INBOX_DROP = join(TMP, "drop");
// 127.0.0.1:1 refuses immediately: a boot read that fails, without a 30s wait
process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:1/x";

let pass = 0, fail = 0;
const ok = (msg, cond, extra = "") => {
  if (cond) { pass++; console.log("  ok   " + msg); }
  else { fail++; console.log("  FAIL " + msg + (extra ? "  " + extra : "")); }
};

/* An unhandled rejection here is the exact class of bug that crash-looped this
   relay. Fail the test rather than let the process die with a green log. */
let unhandled = null;
process.on("unhandledRejection", (err) => { unhandled = err; });
process.on("uncaughtException", (err) => { unhandled = err; });

const store = await import("../store.js");

ok("DURABLE is on when DATABASE_URL is set", store.DURABLE === true);

// must NOT throw: storage trouble may never take the relay down
let threw = null;
try { await store.init(); } catch (err) { threw = err; }
ok("init() survives an unreachable database", threw === null, String(threw));

ok("loaded stays false after a failed read", store.stats().loaded === false);
ok("degraded() reports the truth", store.degraded() === true);

/* THE invariant. A failed read left the store empty; if a write now ran, it
   would upsert that empty blob over row 1 and delete every conversation that
   had survived. flush() must refuse. */
const before = store.stats().threads;
// newThread destructures an object — passing a bare string left `to` undefined
const created = await store.newThread({ to: "counsellor@wrdsb.ca", domain: "wrdsb.ca" });
store.addMessage(created.thread.tag, "student", "this must not reach the database");
await new Promise((r) => setTimeout(r, 250));   // let any flush settle

ok("a write attempt does not crash the process", unhandled === null,
   unhandled ? String(unhandled?.message ?? unhandled) : "");
ok("in-memory state still works while degraded", store.stats().threads === before + 1);
ok("lastWriteOk is not reported as a success", store.stats().lastWriteOk !== true,
   JSON.stringify(store.stats().lastWriteOk));

/* The assertion that actually PINS the guard. Every check above still passes
   if the `!loaded` check is deleted, because the write would then fail on its
   own and be caught — so they constrain nothing. The difference between
   "refused to write" and "tried and failed" is whether an error was recorded:
   flush() returns before touching the pool, so lastWriteErr is never set. */
ok("no write was even ATTEMPTED (the guard, not luck)",
   !("lastWriteErr" in store.stats()),
   JSON.stringify(store.stats().lastWriteErr));

/* The consequence callers must honour, tested through the SERVER rather than
   asserted about the module. `typeof store.degraded === "function"` sat here
   first and could not fail — deleting the refusal in server.js left every
   suite green, so the commit's headline behaviour had no coverage at all. */
const { server } = await import("../server.js");
await new Promise((r) => server.listen(8801, r));

const post = async (path, payload) => {
  const r = await fetch("http://127.0.0.1:8801" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

const sent = await post("/send", { to: "counsellor@wrdsb.ca", message: "please read this" });
ok("/send refuses while degraded instead of issuing an unusable passphrase",
   sent.status === 503 && sent.json.reason === "storage",
   sent.status + " " + JSON.stringify(sent.json));
ok("/send hands back no passphrase to write down",
   !sent.json.pass && !sent.json.tag, JSON.stringify(sent.json));

/* The returning reader — the likeliest outage path, since they were told to
   come back for the reply. Answering "auth" would tell them their
   conversation may have been deleted, which the relay knows is not true. */
const read = await post("/thread", { codename: "anything", pass: "anything" });
ok("/thread says storage, not auth (never claims the conversation is gone)",
   read.status === 503 && read.json.reason === "storage",
   read.status + " " + JSON.stringify(read.json));

/* A counsellor's reply must survive the outage. pollOnce() marks IMAP mail
   \Seen and renames drop files, each unconditionally — while the store is
   empty it would consume a reply it cannot file, destroying it permanently. */
const { pollOnce } = await import("../inbox.js");
const { mkdirSync } = await import("node:fs");
mkdirSync(process.env.BIT_INBOX_DROP, { recursive: true });
const dropFile = join(process.env.BIT_INBOX_DROP, "reply.txt");
writeFileSync(dropFile,
  "To: relay+bitdeadbeefdeadbeef@gmail.com\nFrom: counsellor@wrdsb.ca\nSubject: Re:\n\nCome see me Thursday.\n");

const collected = await pollOnce();
ok("the poller files nothing while degraded", collected === 0, String(collected));
/* THE assertion. "collected === 0" alone is vacuous — record() fails against
   an empty store either way. What distinguishes the guard is whether the
   reply was CONSUMED: pollDrop renames to .done (and pollImap marks \Seen)
   even when filing failed, so the counsellor's answer could never be read
   again. It must still be sitting there, untouched. */
ok("the counsellor's reply is NOT consumed — it survives for a later poll",
   existsSync(dropFile) && !existsSync(dropFile + ".done"),
   `reply.txt=${existsSync(dropFile)} reply.txt.done=${existsSync(dropFile + ".done")}`);

// await the close: exiting with it still in flight trips a libuv assertion on
// Windows and returns 127, which would fail CI on a fully passing run
await new Promise((r) => server.close(r));

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
/* exitCode, not process.exit(): forcing the process down while the store's
   pool promise and the just-closed server are still settling trips a libuv
   assertion on Windows and returns 127 on an all-green run. Every timer here
   is unref'd, so the loop drains on its own. */
process.exitCode = fail ? 1 : 0;
