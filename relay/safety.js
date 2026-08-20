/* safety.js — server-side Tier-3 check.

   COUPLING: this is a deliberate mirror of the T3 patterns in
   ../js/safety.js. The client already checks before sending; this exists
   because the client is not a security boundary — anyone can POST straight
   to /send. If you change the client taxonomy, change this too.

   Why refuse instead of relay: an anonymous "I'm not safe" landing in a
   counsellor's inbox at 2am is the worst outcome this product can produce —
   an adult who knows a child is in danger and has no way to reach them.
   Crisis content routes to humans who answer immediately, not to a mailbox.

   Privacy: matched TEXT is never logged or stored. Pattern ids only. */

const AP = "['’]?";

const T3 = [
  // --- SELF family ---
  // "myself" ONLY — see ../js/safety.js. A false positive here is a refusal to
  // send, so hyperbole ("this is killing me") must not reach this list.
  { id: "t3-self-kill",     fam: "self", re: new RegExp(`\\b(kill(ing)?|end(ing)?|hurt(ing)?)\\s+my\\s*self\\b`, "i") },
  { id: "t3-self-suicide",  fam: "self", re: /\b(suicid(e|al)|kms\b|unalive)/i },
  { id: "t3-self-want-die", fam: "self", re: new RegExp(`\\b(want(\\s+to)?|wanna|wish(ed)?\\s+(i|to))\\s+(die|be\\s+dead|was\\s+dead|end\\s+my\\s+life|take\\s+my\\s+own\\s+life)\\b`, "i") },
  { id: "t3-self-not-here", fam: "self", re: new RegExp(`\\b(don${AP}t|do\\s+not|no\\s+longer)\\s+(want(\\s+to)?|wanna)\\s+(be\\s+(here|alive)|exist|live|wake\\s+up)\\b`, "i") },
  { id: "t3-self-better",   fam: "self", re: /\bbetter\s+off\s+without\s+me\b/i },
  { id: "t3-self-end-it",   fam: "self", re: /\b(want|going|gonna|plan(ning)?)\s+to\s+end\s+it(\s+all)?\b/i },
  // The apostrophe here is REQUIRED (['’]d, not AP's optional ['’]?d) — an
  // optional one still lets "od"+"d" match the ordinary word "odd".
  { id: "t3-self-harm",     fam: "self", re: /\b(cut(ting)?\s+(myself|my\s*self)|self[\s-]?harm(ing)?|hurt\s+myself|od(?:['’]d|ed)?\b|overdos(e|ing|ed))/i },
  { id: "t3-self-no-point", fam: "self", re: /\b(no\s+point\s+(in\s+)?(living|going\s+on)|nothing\s+to\s+live\s+for)\b/i },
  { id: "t3-self-around",   fam: "self", re: new RegExp(`\\b(not|won${AP}t)\\s+(gonna\\s+|going\\s+to\\s+)?be\\s+around\\s+(much\\s+longer|anymore|any\\s+more)\\b`, "i") },
  { id: "t3-self-goodbye",  fam: "self", re: /\b(say(ing)?\s+goodbye\s+to\s+everyone|wrote\s+(a\s+)?(goodbye|final)\s+(note|letter))\b/i },
  { id: "t3-self-gone",     fam: "self", re: /\b(want\s+to|wanna)\s+disappear(\s+forever)?\b/i },
  // --- ABUSE family ---
  { id: "t3-abuse-active",  fam: "abuse", re: /\b(my\s+)?(he|she|they|dad|mom|mum|father|mother|stepdad|stepmom|stepfather|stepmother|brother|sister|stepbrother|stepsister|uncle|aunt|cousin|grandpa|grandma|boyfriend|girlfriend|bf|gf|partner|coach|teacher)\s+(hits?|hurts?|beats?|touch(es|ed)?|abus(es|ed)?|hit|beat|slapped|choked|grabbed)\s+me\b/i },
  { id: "t3-abuse-fear",    fam: "abuse", re: new RegExp(`\\b(scared|afraid|terrified)\\s+(that\\s+)?(my\\s+)?(he|she|they|dad|mom|mum|father|mother|stepdad|stepmom|brother|sister|boyfriend|girlfriend|partner)\\s*(${AP}ll|\\s+will|\\s+might|\\s+is\\s+going\\s+to)\\s+(hurt|hit|kill|beat)\\s+me\\b`, "i") },
  { id: "t3-abuse-unsafe",  fam: "abuse", re: /\bnot\s+safe\s+at\s+home\b/i },
];

/** @returns {{tier: 0|3, matches: string[], fam: "self"|"abuse"|null}} */
export function checkTier3(text) {
  const t = String(text || "");
  if (!t.trim()) return { tier: 0, matches: [], fam: null };
  const hits = T3.filter((p) => p.re.test(t));
  if (!hits.length) return { tier: 0, matches: [], fam: null };
  return {
    tier: 3,
    matches: hits.map((p) => p.id),
    fam: hits.some((p) => p.fam === "abuse") ? "abuse" : "self",
  };
}
