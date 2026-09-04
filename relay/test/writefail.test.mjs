/* writefail.test.mjs — the loss mode degraded() CANNOT catch.
   Run:  node test/writefail.test.mjs   (from relay/)

   degraded() only reports a failed boot READ. Writes can also start failing
   after a perfectly good one — the database deleted mid-life, connections
   exhausted, a disk gone. `loaded` stays true, so every earlier guard passes
   and /send would email the counsellor, hand the student a passphrase, and
   store nothing: the passphrase opens an empty thread forever and the reply
   can never be matched back.

   Fault injection without mocks: point BIT_DATA_DIR at a FILE, so every
   write fails with ENOENT while reads and in-memory state work normally.
   Own process because the store's backend is chosen once, at import. */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "bit-writefail-"));
const notADir = join(TMP, "notadir");
writeFileSync(notADir, "x");

process.env.BIT_RELAY_MODE = "dry";
process.env.BIT_AUTOSTART = "0";
process.env.PORT = "8802";
process.env.DATABASE_URL = "";      // file backend, so `loaded` is irrelevant
process.env.BIT_DATA_DIR = notADir; // every persist will fail

let pass = 0, fail = 0;
const ok = (msg, cond, extra = "") => {
  if (cond) { pass++; console.log("  ok   " + msg); }
  else { fail++; console.log("  FAIL " + msg + (extra ? "  " + extra : "")); }
};

const store = await import("../store.js");
try { await store.init(); } catch { /* the file backend may not survive this */ }

ok("degraded() is FALSE here — this is the case it cannot see",
   store.degraded() === false);

const { server } = await import("../server.js");
await new Promise((r) => server.listen(8802, r));

const post = async (path, payload) => {
  const r = await fetch("http://127.0.0.1:8802" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

const before = store.stats().threads;
const sent = await post("/send", { to: "counsellor@wrdsb.ca", message: "please read this" });

ok("/send refuses when the write failed, instead of reporting success",
   sent.status === 503 && sent.json.reason === "storage",
   sent.status + " " + JSON.stringify(sent.json));
ok("no passphrase is handed over for a message that was not stored",
   !sent.json.pass && !sent.json.tag, JSON.stringify(sent.json));
/* The refusal copy says "nothing was sent, and nothing was lost", so the
   half-made thread must not survive either. */
ok("the unstored thread is rolled back, not left half-made",
   store.stats().threads === before, `${before} -> ${store.stats().threads}`);

await new Promise((r) => server.close(r));
rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exitCode = fail ? 1 : 0;
