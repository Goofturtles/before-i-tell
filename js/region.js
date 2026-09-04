/* region.js — where the user is, and what that changes.

   The hard rule this file exists to enforce:

     CRISIS ROUTING is localised. LEGAL ANSWERS ARE NOT.

   Every phone number below was read from the operator's own site (see the
   `src` on each region) — none are generated, and none are guessed. Where we
   have no verified line for a country, the answer is a real directory, not an
   invented number: a wrong crisis number is worse than no number, because it
   fails at the exact moment someone reaches for it.

   Same rule for the word "anonymous": it is a claim, not a description. Only
   a line carrying `anon: true` may be called anonymous in copy — Kids Help
   Phone says so on its own site. Services like 988 are confidential but can
   initiate an emergency response, so calling them "anonymous" would be a
   promise we cannot keep. The flag exists so the claim lives in data next to
   its source, instead of in prose where it drifted three times.

   The reporting-law corpus stays Ontario-only, and `lawVerified` is the flag
   that keeps it honest. Mandatory-reporting duties differ per country, per
   state, and per profession; generating them would produce confident, cited-
   looking, wrong answers about whether a teenager's disclosure gets passed on.
   That is the one failure this whole product exists to prevent, so outside
   Ontario the app says plainly what it does not know and routes to someone who
   does. Adding a jurisdiction means adding a CITED corpus for it — not
   flipping a flag. */

export const DEFAULT_REGION = "on-ca";

export const REGIONS = {
  "on-ca": {
    name: "Ontario, Canada",
    short: "Ontario",
    lawVerified: true,             // the corpus in corpus.js is Ontario law
    emergency: "911",
    lines: [
      { name: "Kids Help Phone", note: "Talk to a real counsellor, 24/7. Anonymous.", tel: "1-800-668-6868", display: "1-800-668-6868", anon: true },
      { name: "Text instead", note: "Text CONNECT — a trained volunteer answers. Anonymous.", sms: "686868", smsBody: "CONNECT", display: "686868", anon: true },
      { name: "9-8-8 · call or text", note: "Suicide Crisis Helpline, 24/7.", tel: "988", display: "9-8-8" },
    ],
    src: "kidshelpphone.ca, 988.ca",
  },
  "ca": {
    name: "Canada (outside Ontario)",
    short: "Canada",
    lawVerified: false,
    emergency: "911",
    lines: [
      { name: "Kids Help Phone", note: "Talk to a real counsellor, 24/7. Anonymous.", tel: "1-800-668-6868", display: "1-800-668-6868", anon: true },
      { name: "Text instead", note: "Text CONNECT — a trained volunteer answers. Anonymous.", sms: "686868", smsBody: "CONNECT", display: "686868", anon: true },
      { name: "9-8-8 · call or text", note: "Suicide Crisis Helpline, 24/7.", tel: "988", display: "9-8-8" },
    ],
    src: "kidshelpphone.ca, 988.ca",
  },
  us: {
    name: "United States",
    short: "the US",
    lawVerified: false,
    emergency: "911",
    lines: [
      { name: "988 Suicide & Crisis Lifeline", note: "Call, text or chat. Free, confidential, 24/7.", tel: "988", display: "988" },
    ],
    src: "988lifeline.org",
  },
  gb: {
    name: "United Kingdom",
    short: "the UK",
    lawVerified: false,
    emergency: "999",
    lines: [
      { name: "Samaritans", note: "Free from any phone, day or night, 365 days a year.", tel: "116123", display: "116 123" },
    ],
    src: "samaritans.org",
  },
  ie: {
    name: "Ireland",
    short: "Ireland",
    lawVerified: false,
    emergency: "112",
    lines: [
      { name: "Samaritans", note: "Free from any phone, day or night, 365 days a year.", tel: "116123", display: "116 123" },
    ],
    src: "samaritans.org",
  },
  au: {
    name: "Australia",
    short: "Australia",
    lawVerified: false,
    emergency: "000",
    lines: [
      { name: "Lifeline", note: "Crisis support, 24/7.", tel: "131114", display: "13 11 14" },
    ],
    src: "lifeline.org.au",
  },
  nz: {
    name: "New Zealand",
    short: "New Zealand",
    lawVerified: false,
    emergency: "111",
    lines: [
      { name: "1737", note: "Free call or text. Confidential support, 24/7.", tel: "1737", display: "1737" },
    ],
    src: "1737.org.nz",
  },
  za: {
    name: "South Africa",
    short: "South Africa",
    lawVerified: false,
    emergency: "10111",
    lines: [
      { name: "SADAG Suicide Crisis Line", note: "Toll-free, 24 hours.", tel: "0800567567", display: "0800 567 567" },
    ],
    src: "sadag.org",
  },
  other: {
    name: "Somewhere else",
    short: "your country",
    lawVerified: false,
    emergency: null,               // varies; the UI asks rather than guesses
    lines: [],
    // a maintained directory beats a number we invented: it covers far more
    // countries than we could verify, and it is somebody's actual job to
    // keep it current
    directory: { name: "Find a helpline in your country", url: "https://findahelpline.com/" },
    src: "findahelpline.com",
  },
};

/** The dialable href for a line. Exported so crisis.js and the test share ONE
    implementation — a test with its own copy can pass while the real code drifts. */
export function telHref(line) {
  if (line.tel) return "tel:" + line.tel;
  return "sms:" + line.sms + (line.smsBody ? "?&body=" + line.smsBody : "");
}

export function regionById(id) {
  return REGIONS[id] || REGIONS[DEFAULT_REGION];
}

/** Ordered list for the picker. Ontario first (it is the only one whose legal
    answers are verified), "Somewhere else" last. */
export const REGION_ORDER = ["on-ca", "ca", "us", "gb", "ie", "au", "nz", "za", "other"];

/** A best-effort FIRST GUESS only — never a silent decision. The picker always
    shows, and the user's choice always wins; this only pre-selects a likely
    option so most people confirm rather than hunt. Timezone, not IP: it needs
    no network request, which keeps the zero-external-request guarantee. */
export function guessRegion() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    // Ontario proper. Iqaluit is deliberately NOT here: it is Nunavut, and
    // matching it would set lawVerified and silently suppress the "these are
    // Ontario's rules" note for someone the corpus does not cover.
    if (/^America\/(Toronto|Nipigon|Thunder_Bay|Atikokan)$/.test(tz)) return "on-ca";
    if (/^America\/(Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Whitehorse|Yellowknife|Moncton|Glace_Bay|Goose_Bay|Blanc-Sablon|Dawson|Inuvik|Rankin_Inlet|Resolute|Cambridge_Bay|Creston|Fort_Nelson|Swift_Current|Iqaluit|Pangnirtung|Coral_Harbour|Whitehorse)$/.test(tz)) return "ca";
    // an explicit allowlist, NOT /^America\//: that prefix covers São Paulo,
    // Bogotá and Buenos Aires, and defaulting them to 988/911 would hand a
    // student in Brazil two numbers that do not work
    if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Adak|Juneau|Sitka|Nome|Yakutat|Metlakatla|Detroit|Indiana\/|Kentucky\/|Boise|Menominee|North_Dakota\/)/.test(tz)) return "us";
    if (/^Pacific\/(Honolulu)$/.test(tz)) return "us";
    if (/^Europe\/(London|Belfast)$/.test(tz)) return "gb";
    if (/^Europe\/Dublin$/.test(tz)) return "ie";
    if (/^Australia\//.test(tz)) return "au";
    if (/^Pacific\/(Auckland|Chatham)$/.test(tz)) return "nz";
    if (/^Africa\/Johannesburg$/.test(tz)) return "za";
  } catch { /* no Intl: fall through */ }
  // everywhere else gets the honest default, not a nearby-sounding guess
  return "other";
}
