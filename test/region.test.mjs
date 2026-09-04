/* Crisis-data integrity test. This is the highest-stakes data in the product:
   a number that doesn't dial fails at the exact moment someone reaches for it. */
import { REGIONS, REGION_ORDER, regionById, telHref, DEFAULT_REGION }
  from "../js/region.js";

let fail = 0;
const ok = (cond, msg) => { if (!cond) { console.log("FAIL " + msg); fail++; } };

// telHref is IMPORTED, not re-implemented: a private copy could pass here
// while the real renderer drifted.

for (const id of REGION_ORDER) {
  const r = REGIONS[id];
  ok(r, `${id} exists`);
  ok(r.name && r.name.length, `${id} has a name`);

  // EVERY region must offer at least one thing a person can act on
  const actionable = r.lines.length > 0 || Boolean(r.directory);
  ok(actionable, `${id} offers at least one actionable route`);

  for (const l of r.lines) {
    ok(l.tel || l.sms, `${id}/${l.name} has tel or sms`);
    const href = telHref(l);
    // dialable: no spaces, and only characters a dialer accepts
    ok(!/\s/.test(href), `${id}/${l.name} href has no spaces -> ${href}`);
    ok(/^(tel:[+0-9\-]+|sms:[0-9]+(\?&body=[A-Za-z]+)?)$/.test(href),
       `${id}/${l.name} href well-formed -> ${href}`);
    ok(l.display && l.display.length, `${id}/${l.name} has display text`);
    ok(l.note && l.note.length, `${id}/${l.name} has a note`);
  }

  if (r.directory) {
    ok(/^https:\/\//.test(r.directory.url), `${id} directory is https -> ${r.directory.url}`);
  }
  // emergency may be null ONLY for the region that can't know it
  ok(r.emergency || id === "other", `${id} has an emergency number (or is 'other')`);
  ok(typeof r.lawVerified === "boolean", `${id} declares lawVerified`);
  // provenance: every region with numbers must record where they came from
  if (r.lines.length) ok(r.src && r.src.length, `${id} records its source`);
}

// the picker must offer every region that exists, and nothing that doesn't
ok(REGION_ORDER.length === Object.keys(REGIONS).length,
   `REGION_ORDER covers every region (${REGION_ORDER.length} vs ${Object.keys(REGIONS).length})`);
for (const k of Object.keys(REGIONS)) ok(REGION_ORDER.includes(k), `${k} appears in REGION_ORDER`);
// an emergency number must be dialable digits, never prose
for (const id of REGION_ORDER) {
  const e = REGIONS[id].emergency;
  ok(e === null || /^[0-9]{3,6}$/.test(e), `${id} emergency is dialable digits or null (got ${e})`);
}

// "anonymous" is a CLAIM: only lines carrying anon:true may be described that
// way. This drifted three times when the word lived in prose.
for (const id of REGION_ORDER) {
  for (const l of REGIONS[id].lines) {
    // BICONDITIONAL: flag and note must agree in BOTH directions, or a note
    // saying "Anonymous" without the flag would sail through.
    const noteSaysAnon = /anonymous/i.test(l.note || "");
    ok(Boolean(l.anon) === noteSaysAnon,
       `${id}/${l.name}: anon flag (${Boolean(l.anon)}) matches its note (${noteSaysAnon})`);
    // the single criterion is "the operator says so" — so a flag needs a source
    if (l.anon) ok(l.anonSrc && l.anonSrc.length, `${id}/${l.name} records anonSrc`);
  }
}
ok(REGIONS.other.lines.length === 0, "'other' has no lines, so nothing can be called anonymous there");

// exactly one region may claim verified law — the corpus is Ontario's
const verified = REGION_ORDER.filter((id) => REGIONS[id].lawVerified);
ok(verified.length === 1 && verified[0] === "on-ca",
   `only Ontario claims lawVerified (got: ${verified.join(",") || "none"})`);

// corrupt / missing ids must fall back, never throw or return undefined
ok(regionById("nonsense").name === REGIONS[DEFAULT_REGION].name, "unknown id falls back to default");
ok(regionById(undefined).name === REGIONS[DEFAULT_REGION].name, "undefined id falls back to default");
ok(regionById("").name === REGIONS[DEFAULT_REGION].name, "empty id falls back to default");

// every option in the picker resolves
for (const id of REGION_ORDER) ok(REGIONS[id], `picker option ${id} resolves`);



/* ---- source scan: the word may not appear ungated, PER OCCURRENCE ----
   Data assertions cannot see prose, and prose is where this drifted three
   times. An earlier version of this scan gated per FILE — it passed a whole
   file once any primaryIsAnon() call existed anywhere in it, which would have
   waved through a new hard-coded claim in safety.js, ask.js or codename.js:
   precisely the three files it drifted in. Now every occurrence must be
   gated on its own line. region.js is the data home; corpus.js is
   Ontario-gated content behind jurisdictionNote(). */
import { readFileSync, readdirSync } from "node:fs";
const UI_DIR = new URL("../js/", import.meta.url);
const DATA_OR_CONTENT = new Set(["region.js", "corpus.js"]);
// the product's own codename feature is legitimately anonymous — that is a
// claim about US, not about a crisis service
/* Deliberately ONE exact phrase, not a loose alternation. An earlier version
   also allowed the bare word "codename", which appears on dozens of lines in
   codename.js — so a real violation there ("Kids Help Phone is anonymous —
   your codename stays yours") would have been exempted by the word next to
   it. Both legitimate uses say this exact thing, about OUR product rather
   than a crisis line. */
const PRODUCT_CLAIM = /anonymous messages to anyone/i;

for (const f of readdirSync(UI_DIR).filter((n) => n.endsWith(".js"))) {
  if (DATA_OR_CONTENT.has(f)) continue;
  const src = readFileSync(new URL(f, UI_DIR), "utf8");
  /* Blank out block comments across the WHOLE file before splitting — a naive
     per-line strip misses continuation lines inside /* … *\/, and the comments
     explaining this very rule are full of the word. Replacing each non-newline
     with a space keeps line numbers honest in the failure message. */
  const scrubbed = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  scrubbed.split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (!/anonym/i.test(code)) return;
    const gated = /primaryIsAnon\(\)/.test(code) || PRODUCT_CLAIM.test(code);
    ok(gated, `${f}:${i + 1} "anonymous" is gated on primaryIsAnon() or is about the product itself`);
  });
}

/* ---- timezone routing ---- */
/* guessRegion must never hand someone a number that doesn't work where they
   are. The two failures the audit caught: every America/* fell through to the
   US (so São Paulo got 988/911), and Iqaluit matched Ontario (so a Nunavut
   student had the "these are Ontario's rules" note silently suppressed). */
const cases = [
  ["America/Sao_Paulo", "other"],
  ["America/Bogota", "other"],
  ["America/Argentina/Buenos_Aires", "other"],
  ["America/Mexico_City", "other"],
  ["America/Iqaluit", "ca"],
  ["America/Toronto", "on-ca"],
  ["America/Vancouver", "ca"],
  ["America/New_York", "us"],
  ["America/Los_Angeles", "us"],
  ["Pacific/Honolulu", "us"],
  ["Europe/London", "gb"],
  ["Europe/Dublin", "ie"],
  ["Europe/Berlin", "other"],
  ["Australia/Sydney", "au"],
  ["Pacific/Auckland", "nz"],
  ["Africa/Johannesburg", "za"],
  ["Africa/Lagos", "other"],
  ["Asia/Tokyo", "other"],
  ["Asia/Kolkata", "other"],
];

const orig = Intl.DateTimeFormat;
const { guessRegion } = await import(
  "../js/region.js");

let bad = 0;
for (const [tz, want] of cases) {
  Intl.DateTimeFormat = function () { return { resolvedOptions: () => ({ timeZone: tz }) }; };
  const got = guessRegion();
  if (got !== want) { console.log(`FAIL ${tz} -> ${got} (want ${want})`); bad++; }
  else console.log(` ok  ${tz} -> ${got}`);
}
Intl.DateTimeFormat = orig;
console.log(bad ? `\n${bad} FAILED` : `\nguessRegion correct on ${cases.length} zones`);
fail += bad;
console.log(fail ? `
${fail} FAILED` : `
all checks passed — ${REGION_ORDER.length} regions, ${cases.length} timezones`);
process.exit(fail ? 1 : 0);
