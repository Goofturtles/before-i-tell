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
  // Leader convention: (want to|wanna|going to|gonna|plan(ning) to/on|about to)
  // — "gonna X" must never require a literal "to".
  { id: "t3-self-kill",     fam: "self", re: new RegExp(`\\b(kill(ing)?|end(ing)?|hurt(ing)?|hang(ing)?)\\s+my\\s*self\\b`, "i") },
  { id: "t3-self-suicide",  fam: "self", re: /\b(suicid(e|al)|kms\b|unalive|sewer\s*slide)/i },
  { id: "t3-self-want-die", fam: "self", re: new RegExp(`\\b(want(\\s+to)?|wanna|going\\s+to|gonna|plan(ning)?\\s+(to|on)|about\\s+to|wish(ed)?\\s+(i|to))\\s+(die|dying|be\\s+dead|was\\s+dead|end(ing)?\\s+my\\s+life|tak(e|ing)\\s+my\\s+own\\s+life)\\b`, "i") },
  { id: "t3-self-not-here", fam: "self", re: new RegExp(`\\b(don${AP}t|do\\s+not|no\\s+longer)\\s+(want(\\s+to)?|wanna)\\s+(be\\s+(here|alive)|exist|live|wake\\s+up)\\b`, "i") },
  { id: "t3-self-better",   fam: "self", re: new RegExp(`\\bbetter\\s+off\\s+(without\\s+me|if\\s+i\\s+was\\s+(gone|dead)|when\\s+i${AP}m\\s+gone)\\b`, "i") },
  { id: "t3-self-end-it",   fam: "self", re: /\b(want\s+to|wanna|going\s+to|gonna|plan(ning)?\s+(to|on)|about\s+to)\s+end(ing)?\s+it(\s+all)?\b/i },
  { id: "t3-self-wish",     fam: "self", re: new RegExp(`\\bwish(ed)?\\s+i\\s+(wasn${AP}t\\s+(alive|born)|was\\s+not\\s+(alive|born)|was\\s+never\\s+born)\\b`, "i") },
  { id: "t3-self-off",      fam: "self", re: /\b(want(\s+to)?|wanna|gonna|going\s+to|thinking\s+(about|of)|might|should)\s+(just\s+)?off\s+my\s*self\b/i },
  { id: "t3-self-delete",   fam: "self", re: /\b(want(\s+to)?|wanna|gonna|going\s+to|thinking\s+(about|of))\s+(just\s+)?self[\s-]?delete\b/i },
  // The apostrophe here is REQUIRED (['’]d, not AP's optional ['’]?d) — an
  // optional one still lets "od"+"d" match the ordinary word "odd".
  // "cut my wrists" keeps the plural: "i cut my wrist on the fence" is an
  // accident report, "cut my wrists" is not. "slit" has no accidental reading.
  // "cut myself some slack" is self-compassion, not self-harm — guard it
  { id: "t3-self-harm",     fam: "self", re: /\b(cut(ting)?\s+(myself|my\s*self)(?!\s+some\s+slack\b)|self[\s-]?harm(ing)?|hurt\s+myself|slit(ting)?\s+my\s+wrists?|cut(ting)?\s+my\s+wrists|od(?:['’]d|ed)?\b|overdos(e|ing|ed))/i },
  // lookahead keeps "no reason to live in fear / live with regret" clean
  { id: "t3-self-no-point", fam: "self", re: /\b(no\s+(point|reason)\s+((in|to)\s+)?(living|live(?!\s+(in|with)\b)|going\s+on)|nothing\s+to\s+live\s+for)\b/i },
  { id: "t3-self-around",   fam: "self", re: new RegExp(`\\b(not|won${AP}t)\\s+(gonna\\s+|going\\s+to\\s+)?be\\s+around\\s+(much\\s+longer|anymore|any\\s+more)\\b`, "i") },
  { id: "t3-self-goodbye",  fam: "self", re: /\b(say(ing)?\s+goodbye\s+to\s+everyone|wrote\s+(a\s+)?(goodbye|final)\s+(note|letter))\b/i },
  { id: "t3-self-gone",     fam: "self", re: /\b(want\s+to|wanna)\s+disappear(\s+forever)?\b/i },
  // leader-gated: "jump off the diving board" and third-person stay clean
  { id: "t3-self-jump",     fam: "self", re: new RegExp(`\\b(i${AP}m|im|i\\s+am|want(\\s+to)?|wanna|gonna|going\\s+to|thinking\\s+(about|of))\\s+(gonna\\s+|going\\s+to\\s+)?jump(ing)?\\s+off\\s+(a|the|my)\\s+(bridge|roof|building|balcony)\\b`, "i") },
  // --- ABUSE family ---
  // verb list is tense-complete on purpose: present ("chokes me") and past
  // ("choked me") both fire; sexual-assault verbs included
  // idiom guards: "beats me at chess" (competition) and "hits me up"
  // (messaging) are not abuse. Only "at" is excluded, not "in" — "beats me in
  // the basement" is real abuse, and a safety product must over-fire ("beats
  // me in every race") rather than miss. Every real phrasing ("he beats me",
  // "he beats me up", "she hits me hard") still fires.
  { id: "t3-abuse-active",  fam: "abuse", re: /\b(my\s+)?(he|she|they|dad|mom|mum|father|mother|stepdad|stepmom|stepfather|stepmother|brother|sister|stepbrother|stepsister|uncle|aunt|cousin|grandpa|grandma|boyfriend|girlfriend|bf|gf|partner|coach|teacher)\s+(hits?\s+me\b(?!\s+up\b)|hurts?\s+me\b|beats?\s+me\b(?!\s+at\b)|(touch(es|ed)?|abus(es|ed|ing)?|slap(s|ped)?|chok(e|es|ed|ing)|grab(s|bed)?|punch(es|ed)?|kick(s|ed)?|molest(s|ed)?|rap(es|ed))\s+me\b)/i },
  { id: "t3-abuse-passive", fam: "abuse", re: /\bi\s+(was|got|am\s+being|have\s+been)\s+(raped|molested|sexually\s+(abused|assaulted|touched))\b/i },
  { id: "t3-abuse-someone", fam: "abuse", re: /\b(someone|somebody)\s+(touch(es|ed)?|molest(s|ed)?|rap(es|ed))\s+me\b/i },
  { id: "t3-abuse-fear",    fam: "abuse", re: new RegExp(`\\b(scared|afraid|terrified)\\s+(that\\s+)?(my\\s+)?(he|she|they|dad|mom|mum|father|mother|stepdad|stepmom|brother|sister|boyfriend|girlfriend|partner)\\s*(${AP}ll|\\s+will|\\s+might|\\s+is\\s+going\\s+to)\\s+(hurt|hit|kill|beat)\\s+me\\b`, "i") },
  { id: "t3-abuse-unsafe",  fam: "abuse", re: new RegExp(`\\b(not|don${AP}t\\s+feel|do\\s+not\\s+feel|never\\s+feel|no\\s+longer\\s+feel)\\s+safe\\s+at\\s+home\\b`, "i") },
];

/** @returns {{tier: 0|3, matches: string[], fam: "self"|"abuse"|null}} */
export function checkTier3(text) {
  // strip zero-width characters (strip, not space: "k​ill" must rejoin)
  const t = String(text || "").replace(/[​-‍⁠﻿­]/g, "");
  if (!t.trim()) return { tier: 0, matches: [], fam: null };
  const hits = T3.filter((p) => p.re.test(t));
  if (!hits.length) return { tier: 0, matches: [], fam: null };
  return {
    tier: 3,
    matches: hits.map((p) => p.id),
    fam: hits.some((p) => p.fam === "abuse") ? "abuse" : "self",
  };
}
