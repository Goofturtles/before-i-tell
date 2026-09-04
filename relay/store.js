/* store.js — thread store, Postgres-backed in production.

   Deliberately boring: an in-memory copy is the source of truth, persisted as
   one JSON blob. Two backends, chosen by DATABASE_URL at import: a single
   jsonb row when it is set, a whole-file atomic write when it is not (local
   development). The file branch is NOT viable in production — Render's free
   filesystem is ephemeral, so it lost every conversation on each restart, and
   that is why counsellor replies appeared to vanish.

   Read init() and flush() together before changing either: a failed load must
   never become a write, or one bad boot deletes everyone's conversations.

   WHAT IS STORED: codename, a scrypt hash of the passphrase, the recipient
   school address, and message bodies.
   WHAT IS NOT: the student's name, email, IP, or any device identifier. There
   is nothing here that maps a thread back to a person. */

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// async on purpose: scryptSync (~20ms fast CPU, worse on the free tier) on
// the auth hot path froze the single-threaded instance for EVERY user under
// an auth flood. The libuv threadpool absorbs it instead.
const scrypt = promisify(scryptCb);

const DATA_DIR = process.env.BIT_DATA_DIR || join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "threads.json");

/** message + thread retention: nothing here needs to outlive the conversation */
const RETAIN_DAYS = Number(process.env.BIT_RETAIN_DAYS || 90);
const DAY = 86400000;

let db = { threads: {}, blocked: [], seenUids: {} };
let writing = null;
let dirty = false;

/* ---------------- durable backing store ----------------

   The shape of this file is unchanged: everything still operates on the
   in-memory `db`, and persistence is one JSON blob. Only WHERE that blob
   lives moved.

   It used to be a file on the instance. On Render's free plan the instance
   filesystem does not survive a restart, and the relay restarts on every
   deploy and every idle spin-down — so a student's conversation, and their
   counsellor's reply, were erased within minutes. A thread created at 17:55
   was gone by 18:03. That is not a durability nicety; it is the Level 2
   feature not working.

   With DATABASE_URL set the blob lives in Postgres, outside the instance.
   Without it (local dev, dry mode, the test suite) the file path is kept
   exactly as it was, so nothing about running this locally changes. */
const DB_URL = process.env.DATABASE_URL || "";
export const DURABLE = Boolean(DB_URL);

/* jsonb rejects a NUL outright ("unsupported Unicode escape sequence"), so one
   NUL in one message would make EVERY later write fail -- silently, and
   forever. It carries no meaning in a message someone typed, so it is dropped.

   Stripped per string value in a REPLACER, never with a regex over the finished
   JSON. Both of those alternatives are wrong and both shipped or were tried:
     - matching the raw NUL character finds nothing, because stringify has
       already rewritten it as the six-character escape \u0000;
     - matching that escape as TEXT corrupts real messages, because a student
       who types \u0000 yields an escaped backslash, and removing the tail
       leaves a stray backslash that fuses with the next character (a test
       message turned into a tab).
   The NUL has a TWIN: an unpaired surrogate. stringify emits it as the
   escape \ud800, which jsonb rejects for the same reason and with the
   same permanent effect. It needs no attacker -- slicing a reply at
   MAX_REPLY can cut an emoji in half. toWellFormed() (Node >=20, and
   package.json already requires it) replaces any lone surrogate with
   U+FFFD, so both halves of the hazard are handled in one pass.

   Exported so relay.test.mjs can hold this behaviour down. */
export function nulSafeJson(db) {
  return JSON.stringify(db, (_k, v) =>
    typeof v === "string" ? v.replace(/\u0000/g, "").toWellFormed() : v);
}
/* `loaded` gates every write: see init(). `lastWriteOk` is reported on /health
   so durability is a fact about the last write, not a fact about an env var —
   the whole incident that led here was a status that looked fine while data
   was quietly evaporating. */
let loaded = false;
let lastWriteOk = null;
let lastWriteErr = "";

/** True when we are configured for Postgres but the boot read failed, so
    writes are disabled. Callers must refuse work they cannot persist rather
    than accept it silently — see the refusal in server.js's /send. */
export function degraded() { return DURABLE && !loaded; }

/** Await the in-flight persist and report whether it succeeded.
    degraded() only catches a failed boot read; writes can also start failing
    AFTER a good one (the database deleted mid-life, connections exhausted).
    That leaves loaded true, so /send would accept the message, email the
    counsellor, and hand over a passphrase — while nothing was stored. Callers
    await this before claiming a send succeeded. Returns null when no write
    has been attempted, which is not a failure. */
export async function settled() {
  await writing;   // null while idle; awaiting null is a no-op
  return lastWriteOk;
}
/* Memoise the PROMISE, not the pool. Awaiting `import("pg")` yields, so two
   callers racing the first call would each construct a Pool and the loser's
   connections would leak for the life of the process. On failure the memo is
   cleared so a transient outage doesn't permanently poison every later call. */
let poolPromise = null;

function db_pool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const { default: pg } = await import("pg");
      const p = new pg.Pool({
        connectionString: DB_URL,
        // Render's INTERNAL hostname has no dots and speaks plaintext on a
        // private network; the external one requires TLS. Detect, don't guess.
        ssl: DB_URL.includes("render.com") ? { rejectUnauthorized: false } : false,
        max: 3,
      });
      // a pool is an EventEmitter: an idle-client error with no listener is a
      // fatal unhandled 'error' event — the exact class of bug that was
      // crash-looping this relay every five minutes
      p.on("error", (err) => console.error("[store] idle pg client error:", err?.message ?? err));
      await p.query("CREATE TABLE IF NOT EXISTS bit_store (id int PRIMARY KEY, data jsonb NOT NULL)");
      return p;
    })().catch((err) => { poolPromise = null; throw err; });
  }
  return poolPromise;
}

export async function init() {
  if (DURABLE) {
    try {
      const { rows } = await (await db_pool()).query("SELECT data FROM bit_store WHERE id = 1");
      if (rows[0]?.data) db = { threads: {}, blocked: [], seenUids: {}, ...rows[0].data };
      loaded = true;
      console.log("[store] durable: Postgres (threads survive restarts)");
    } catch (err) {
      /* Do NOT set `loaded`. This is the dangerous case: a cold or asleep
         Postgres at boot leaves db empty, and the very next flush() would
         upsert that empty blob over row 1 — destroying every conversation that
         HAD survived. A failed read must never become a write. flush() refuses
         while !loaded, so this degrades to "in memory this boot" instead of
         "everyone's history is gone". */
      console.error("[store] POSTGRES READ FAILED — running in memory for this boot; writes are DISABLED so nothing overwrites stored conversations:", err?.message ?? err);
    }
    prune();
    setInterval(prune, 6 * 3600 * 1000).unref();
    return db;
  }

  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(DATA_FILE)) {
    try {
      const parsed = JSON.parse(await readFile(DATA_FILE, "utf8"));
      db = { threads: {}, blocked: [], seenUids: {}, ...parsed };
    } catch {
      // a corrupt file must not take the service down; keep the bad copy
      await rename(DATA_FILE, DATA_FILE + ".corrupt-" + Date.now()).catch(() => {});
    }
  }
  prune();
  // retention is a promise, not a startup task: a long-lived process would
  // otherwise never expire anything after boot
  setInterval(prune, 6 * 3600 * 1000).unref();
  return db;
}

/** whole-file atomic write, coalesced so a burst of sends is one flush.
    Callers are fire-and-forget, so this must never reject: an unhandled
    rejection kills the process on Node ≥15, and leaving `writing` set would
    silently stop all persistence for the lifetime of the service. */
async function flush() {
  /* The refusal lives HERE, above the promise, and must stay above it. Inside
     the IIFE it returned before any await, so the whole body — including
     `finally { writing = null }` — ran synchronously, and the assignment below
     then re-set `writing` to an already-settled promise. `writing` stayed
     non-null forever, every later flush() took the coalescing branch and never
     wrote again, and settled() reported a stale result. */
  if (DURABLE && !loaded) {
    // see init(): writing now would overwrite stored conversations
    // with whatever this boot happens to hold
    console.error("[store] refusing to write: the load failed this boot, so a write would erase stored conversations");
    return;
  }
  if (writing) { dirty = true; return writing; }
  writing = (async () => {
    try {
      do {
        dirty = false;
        if (DURABLE) {
          // one row, replaced wholesale — same semantics as the atomic file
          // write it replaces, and the relay is single-instance so there is
          // no writer to race with.
          // NUL must be stripped before it reaches jsonb -- see nulSafeJson.
          await (await db_pool()).query(
            "INSERT INTO bit_store (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
            [nulSafeJson(db)]);
          lastWriteOk = true;
        } else {
          const tmp = DATA_FILE + ".tmp";
          await writeFile(tmp, JSON.stringify(db), "utf8");
          await rename(tmp, DATA_FILE);
          /* Set on BOTH branches. Only the Postgres branch used to, so a
             single transient failure in file mode latched lastWriteOk at
             false forever and /send answered 503 storage for the rest of the
             process — and stats() reported a write state that never recovered. */
          lastWriteOk = true;
        }
      } while (dirty);
    } catch (err) {
      lastWriteOk = false;
      lastWriteErr = String(err?.message ?? err).slice(0, 120);
      console.error("[store] persist failed (in-memory state is still good):", lastWriteErr);
    } finally {
      writing = null;
    }
  })();
  return writing;
}

export function prune() {
  const cutoff = Date.now() - RETAIN_DAYS * DAY;
  let dropped = 0;
  for (const [tag, t] of Object.entries(db.threads)) {
    if ((t.lastAt || t.createdAt || 0) < cutoff) { delete db.threads[tag]; dropped++; }
  }
  if (dropped) flush();
  return dropped;
}

/* ---------------- passphrase ---------------- */

async function hashPass(pass, salt) {
  return (await scrypt(String(pass), salt, 32)).toString("hex");
}

export async function verifyPass(thread, pass) {
  if (!thread?.passHash || !thread?.passSalt) return false;
  const candidate = Buffer.from(await hashPass(pass, thread.passSalt), "hex");
  const stored = Buffer.from(thread.passHash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/* ---------------- codenames ---------------- */

const ADJ = ["Blue", "Quiet", "Amber", "Rapid", "Copper", "Golden", "Silver", "Bright",
  "Wandering", "Northern", "Autumn", "Clever", "Steady", "Silent", "Rusty", "Distant"];
const NOUN = ["Heron", "Falcon", "Otter", "Fox", "Lantern", "Compass", "Harbour", "Maple",
  "Cedar", "Sparrow", "Comet", "Beacon", "Willow", "Raven", "Marten", "Anchor"];

function pick(arr) { return arr[randomBytes(1)[0] % arr.length]; }

export function makeCodename() {
  const n = 10 + (randomBytes(1)[0] % 89); // 10–98, never a lonely single digit
  return `${pick(ADJ)} ${pick(NOUN)} ${n}`;
}

/** passphrase the student writes down. No 0/O/1/I/l — they get transcribed wrong. */
export function makePassphrase() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("").replace(/(.{4})(?=.)/g, "$1-");
}

/* ---------------- threads ---------------- */

export async function newThread({ to, domain, codename }) {
  const tag = randomBytes(9).toString("hex"); // 18 chars, unguessable in a Reply-To
  const pass = makePassphrase();
  const salt = randomBytes(16).toString("hex");
  const thread = {
    tag,
    codename: codename || makeCodename(),
    passSalt: salt,
    passHash: await hashPass(pass, salt),
    to,
    domain,
    createdAt: Date.now(),
    lastAt: Date.now(),
    messages: [],
    adultReplied: false,
  };
  db.threads[tag] = thread;
  flush();
  return { thread, pass };
}

export function getThread(tag) {
  // own-property only: a reserved tag like "constructor"/"__proto__" would
  // otherwise resolve to a built-in and produce a bogus thread object
  const k = String(tag || "");
  return Object.hasOwn(db.threads, k) ? db.threads[k] : null;
}

/** roll back a stored message whose email never left. Without this the student
    is told "nothing was sent" and then sees that same message sitting in the
    transcript — and reasonably concludes it was delivered. */
export function dropMessage(tag, msg) {
  const t = db.threads[tag];
  if (!t || !msg) return false;
  // by identity, not position: a counsellor reply (or a concurrent send) can
  // land between addMessage and a failed delivery, and popping the tail would
  // then delete a message that WAS delivered
  const i = t.messages.indexOf(msg);
  if (i === -1) return false;
  t.messages.splice(i, 1);
  /* addMessage sets adultReplied; rolling the message back must clear it, or
     the thread keeps advertising a reply that no longer exists. That is not
     cosmetic: the student opens it to "They replied — read it whenever you're
     ready", finds nothing, and the note explaining that school filters
     sometimes delay mail is suppressed because we think it already arrived. */
  t.adultReplied = t.messages.some((m) => m.from === "adult");
  /* Never move lastAt BACKWARDS. It is only read by retention, and lowering it
     can drop a nearly-expired thread past the prune cutoff — after which the
     retry sees an unknown tag, classifies the reply as junk, and consumes it.
     Keeping it costs nothing: it is never sent to the client. */
  const recomputed = t.messages.length ? t.messages[t.messages.length - 1].at : t.createdAt;
  t.lastAt = Math.max(t.lastAt || 0, recomputed);
  flush();
  return true;
}

/** used when a brand-new thread's first email fails to leave — otherwise the
    student's words persist in a thread whose passphrase was never issued */
export function dropThread(tag) {
  if (!db.threads[tag]) return false;
  delete db.threads[tag];
  flush();
  return true;
}

export function findByCodename(codename) {
  const want = String(codename || "").trim().toLowerCase().replace(/\s+/g, " ");
  return Object.values(db.threads).filter((t) => t.codename.toLowerCase() === want);
}

export function addMessage(tag, from, body) {
  const t = db.threads[tag];
  if (!t) return null;
  const msg = { from, body: String(body), at: Date.now() };
  t.messages.push(msg);
  t.lastAt = msg.at;
  if (from === "adult") t.adultReplied = true;
  flush();
  return msg;
}

/* ---------------- recipient blocks ---------------- */

export function isBlocked(email) {
  return db.blocked.includes(String(email || "").toLowerCase());
}

export function blockRecipient(email) {
  const e = String(email || "").toLowerCase();
  if (!e || db.blocked.includes(e)) return false;
  db.blocked.push(e);
  flush();
  return true;
}

/* ---------------- IMAP dedupe ---------------- */

export function seenUid(mailbox, uid) {
  const list = db.seenUids[mailbox] || [];
  return list.includes(uid);
}

export function markUid(mailbox, uid) {
  const list = db.seenUids[mailbox] || (db.seenUids[mailbox] = []);
  list.push(uid);
  if (list.length > 500) list.splice(0, list.length - 500);
  flush();
}

export function stats() {
  return {
    threads: Object.keys(db.threads).length,
    messages: Object.values(db.threads).reduce((n, t) => n + t.messages.length, 0),
    blocked: db.blocked.length,
    // answerable from outside, instead of being discovered by a student losing
    // a conversation. `durable` alone would report true while every write was
    // failing, so report what actually happened as well.
    durable: DURABLE,
    loaded: DURABLE ? loaded : null,
    // the one field to alert on: true means sends are being refused
    degraded: degraded(),
    lastWriteOk,
    ...(lastWriteErr ? { lastWriteErr } : {}),
  };
}

export const _db = () => db;
