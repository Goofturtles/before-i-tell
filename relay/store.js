/* store.js — flat-file thread store.

   Deliberately boring: one JSON file, whole-file atomic writes, an in-memory
   copy as the source of truth. This holds at hackathon scale (hundreds of
   threads) and has zero operational surface. Swap for SQLite/Postgres if it
   ever needs to survive a fleet.

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
      console.log("[store] durable: Postgres (threads survive restarts)");
    } catch (err) {
      // Never take the relay down over storage. Running in memory still lets a
      // student send — the loud part is that we say so, rather than pretending.
      console.error("[store] POSTGRES UNAVAILABLE — running in memory, conversations will NOT survive a restart:", err?.message ?? err);
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
  if (writing) { dirty = true; return writing; }
  writing = (async () => {
    try {
      do {
        dirty = false;
        if (DURABLE) {
          // one row, replaced wholesale — same semantics as the atomic file
          // write it replaces, and the relay is single-instance so there is
          // no writer to race with
          await (await db_pool()).query(
            "INSERT INTO bit_store (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
            [JSON.stringify(db)]);
        } else {
          const tmp = DATA_FILE + ".tmp";
          await writeFile(tmp, JSON.stringify(db), "utf8");
          await rename(tmp, DATA_FILE);
        }
      } while (dirty);
    } catch (err) {
      console.error("[store] persist failed (in-memory state is still good):", err.message);
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
  t.lastAt = t.messages.length ? t.messages[t.messages.length - 1].at : t.createdAt;
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
    // surfaced so "do conversations survive a restart?" is answerable from
    // outside, instead of being discovered by a student losing one
    durable: DURABLE,
  };
}

export const _db = () => db;
