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

export async function init() {
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
        const tmp = DATA_FILE + ".tmp";
        await writeFile(tmp, JSON.stringify(db), "utf8");
        await rename(tmp, DATA_FILE);
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
  return db.threads[String(tag || "")] || null;
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
  };
}

export const _db = () => db;
