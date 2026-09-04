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
