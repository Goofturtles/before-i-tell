/* schools.js — who this relay is allowed to email.
   ==================================================================
   THIS FILE IS THE ABUSE GATE. Without it, the relay is an anonymous
   remailer: anyone could send untraceable messages to any address on
   earth. Every recipient must look like a school account.

   Order matters: DENY is checked before ALLOW, so a freemail address
   can never slip through a broad pattern.
   ================================================================== */

/* Consumer mail. Hard no — this is the harassment vector. */
const DENY_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "live.com", "live.ca", "msn.com", "yahoo.com", "yahoo.ca", "yahoo.co.uk",
  "ymail.com", "rocketmail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "pm.me", "tutanota.com",
  "tuta.io", "zoho.com", "gmx.com", "gmx.net", "yandex.com", "yandex.ru",
  "mail.com", "mail.ru", "fastmail.com", "hey.com", "hushmail.com",
  "inbox.com", "email.com", "posteo.de", "disroot.org", "riseup.net",
  "sharklasers.com", "guerrillamail.com", "mailinator.com", "10minutemail.com",
  "temp-mail.org", "throwawaymail.com", "yopmail.com", "trashmail.com",
  "rogers.com", "bell.net", "sympatico.ca", "shaw.ca", "telus.net",
  "videotron.ca", "cogeco.ca", "eastlink.ca",
]);

/* Ontario boards a student is realistically at. Curated, not exhaustive —
   the patterns below catch the rest of the province's naming convention. */
const ALLOW_DOMAINS = new Set([
  // public boards
  "tdsb.on.ca", "yrdsb.ca", "pdsb.net", "ddsb.ca", "hdsb.ca", "ocdsb.ca",
  "wrdsb.ca", "hwdsb.on.ca", "ugdsb.ca", "tvdsb.ca", "gecdsb.on.ca",
  "lkdsb.net", "scdsb.on.ca", "kprdsb.ca", "limestone.on.ca", "ucdsb.on.ca",
  "bwdsb.on.ca", "amdsb.ca", "rainbowschools.ca", "granderie.ca",
  "npsc.ca", "nearnorthschools.ca", "lakeheadschools.ca", "rrdsb.com",
  "kpdsb.on.ca", "adsb.on.ca", "dsb1.ca", "publicboard.ca", "renfrewschools.ca",
  // catholic boards
  "tcdsb.org", "dpcdsb.org", "ycdsb.ca", "hcdsb.org", "wcdsb.ca", "ocsb.ca",
  "smcdsb.on.ca", "pvnccdsb.on.ca", "alcdsb.on.ca", "cdsbeo.on.ca",
  "bgcdsb.org", "hpcdsb.ca", "wecdsb.on.ca", "ldcsb.ca", "bhncdsb.ca",
  "nccdsb.on.ca", "sudburycatholicschools.ca", "tldsb.on.ca",
  // french boards
  "csviamonde.ca", "cscmonavenir.ca", "cepeo.on.ca", "ecolecatholique.ca",
  "csdccs.edu.on.ca", "cscprovidence.ca",
]);

/* Structural patterns. Ontario boards are overwhelmingly "<something>dsb.<tld>";
   .edu / k12 / sch cover schools elsewhere. Deliberately conservative — a false
   negative sends someone to Level 3, a false positive builds a remailer. */
const ALLOW_PATTERNS = [
  // Ontario boards. Restricted to .on.ca ONLY: a bare .ca is an openly
  // registrable CIRA ccTLD (same class as .com), so "myevildsb.ca" + a
  // catch-all forward would have laundered mail to any inbox and defeated the
  // whole gate. .on.ca third-level registrations are effectively closed, so
  // they can't be self-registered. Every board that legitimately uses a bare
  // .ca (yrdsb.ca, ddsb.ca, hdsb.ca, ocdsb.ca, wrdsb.ca, ugdsb.ca, tvdsb.ca,
  // kprdsb.ca, amdsb.ca, ycdsb.ca, wcdsb.ca) is in the exact-match set above,
  // so tightening the pattern rejects no real recipient — it only closes the
  // remailer hole.
  /(^|\.)[a-z]{2,}dsb\.on\.ca$/i,
  /(^|\.)[a-z]{2,}cdsb\.on\.ca$/i,
  // registry-controlled educational namespaces (cannot be self-registered
  // without meeting the registry's accreditation rules)
  /(^|\.)edu$/i,
  /(^|\.)edu\.[a-z]{2}$/i,
  /(^|\.)k12\.[a-z]{2}\.us$/i,
  /(^|\.)sch\.[a-z]{2}$/i,
  /(^|\.)ac\.[a-z]{2}$/i,
  /(^|\.)edu\.on\.ca$/i,
];

const EMAIL_RE = /^[^\s@,;:<>"'\\]{1,64}@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/** normalize + validate shape. Returns null when it isn't a usable address. */
export function normalizeEmail(raw) {
  const s = String(raw || "").trim().toLowerCase();
  // header-injection guard: no CR/LF may ever reach an SMTP header
  if (/[\r\n\t]/.test(s)) return null;
  if (s.length > 254 || !EMAIL_RE.test(s)) return null;
  return s;
}

export function domainOf(email) {
  return String(email).split("@")[1] || "";
}

/**
 * The gate. Returns { ok: true, domain } or { ok: false, reason }.
 * reason: "malformed" | "personal" | "unknown"
 */
export function checkRecipient(raw) {
  const email = normalizeEmail(raw);
  if (!email) return { ok: false, reason: "malformed" };
  const domain = domainOf(email);

  /* Demo allowlist: EXACT addresses the operator sets in the environment
     (BIT_DEMO_RECIPIENTS, comma-separated). Exists so the full send→reply
     loop can be filmed/tested against an inbox the operator controls, and so
     boards that hard-block outside senders don't block a judged demo.
     Deliberately NOT a gate-widening: it matches whole addresses (never
     domains), is empty unless the operator sets it, and is checked before
     DENY only because demo inboxes are usually freemail. Read per-call so
     tests and dashboard changes apply without a restart. */
  const demo = String(process.env.BIT_DEMO_RECIPIENTS || "")
    .toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (demo.includes(email)) return { ok: true, email, domain, demo: true };

  // subdomain-aware deny: mail.gmail.com must not sneak past an exact-match set
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (DENY_DOMAINS.has(labels.slice(i).join("."))) return { ok: false, reason: "personal", email, domain };
  }

  if (ALLOW_DOMAINS.has(domain)) return { ok: true, email, domain };
  for (let i = 1; i < labels.length - 1; i++) {
    if (ALLOW_DOMAINS.has(labels.slice(i).join("."))) return { ok: true, email, domain };
  }
  if (ALLOW_PATTERNS.some((re) => re.test(domain))) return { ok: true, email, domain };

  return { ok: false, reason: "unknown", email, domain };
}

export const _internals = { DENY_DOMAINS, ALLOW_DOMAINS, ALLOW_PATTERNS };
