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

process.env.BIT_RELAY_MODE = "dry";
process.env.BIT_AUTOSTART = "0";
process.env.PORT = "8801";
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
const created = await store.newThread("counsellor@wrdsb.ca");
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

/* And the consequence callers must honour: server.js refuses /send while this
   is true, instead of issuing a passphrase it cannot store. */
ok("degraded() is exported for callers to refuse on",
   typeof store.degraded === "function");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
