/* retrieval.js — lexical scoring over the corpus. Deliberately rule-based:
   it fails to "I don't know" instead of a confident wrong answer, which is
   the correct failure mode for a safety product. Single seam for a future
   dense re-ranker: retrieval.answer() is the only entry point. */

import { CORPUS, SYNONYMS } from "./corpus.js";

const STOP = new Set([
  "a","an","the","is","are","was","were","be","been","do","does","did","will",
  "would","can","could","should","have","has","had","i","im","i'm","me","my",
  "you","your","they","them","their","it","its","this","that","what","when",
  "where","who","how","why","if","of","in","on","at","to","for","with","and",
  "or","but","not","no","so","get","got","about","from","up","out","just",
  "really","like","know","want","going","gonna","anything","something","actually",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .map((t) => SYNONYMS[t] || t)
    .filter((t) => t && !STOP.has(t));
}

/* precompute doc token sets + idf at module load */
const docs = CORPUS.map((entry) => {
  const bag = new Set();
  entry.q.forEach((v) => tokenize(v).forEach((t) => bag.add(t)));
  entry.keywords.forEach((k) => bag.add(k));
  entry.topics.forEach((t) => bag.add(t));
  return { entry, bag };
});

const df = new Map();
docs.forEach(({ bag }) => bag.forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
const N = docs.length;
const idf = (t) => 1 + Math.log(N / (df.get(t) || N));

/* canonical multi-word phrases get a flat bonus */
const PHRASES = [
  { re: /children'?s\s+aid/i, token: "childrens-aid" },
  { re: /tell\s+my\s+parents/i, token: "parents" },
  { re: /school\s+record/i, token: "records" },
  { re: /com(e|ing)\s+out\b/i, token: "identity" },
  { re: /taken?\s+away\b/i, token: "childrens-aid" },
  // "report a teacher" is about the teacher being the problem — break the
  // tie with teacher-vs-counsellor (whose bag also has report+teacher)
  { re: /\b(report(ing)?|tell\s+on)\s+(a|my|the|our)\s+(teacher|coach|principal|counsellor|counselor)\b/i, token: "staff" },
];

const THRESHOLD = 0.55;
const ALT_THRESHOLD = 0.35;

export const retrieval = {
  answer(query) {
    const qTokens = [...new Set(tokenize(query))];
    const phraseHits = PHRASES.filter((p) => p.re.test(query)).map((p) => p.token);

    if (!qTokens.length && !phraseHits.length) {
      return { entry: null, score: 0, alternates: [] };
    }

    const scored = docs.map(({ entry, bag }) => {
      const matched = qTokens.filter((t) => bag.has(t));
      const qWeight = qTokens.reduce((s, t) => s + idf(t), 0) || 1;
      const mWeight = matched.reduce((s, t) => s + idf(t), 0);
      let score = mWeight / qWeight;
      phraseHits.forEach((tok) => { if (bag.has(tok)) score += 0.15; });
      return { entry, score, matchedCount: matched.length };
    }).sort((a, b) => b.score - a.score);

    const top = scored[0];
    const alternates = scored
      .slice(1, 4)
      .filter((s) => s.score >= ALT_THRESHOLD)
      .map((s) => s.entry);

    /* single-token exact-match pass: a one-word query that directly hits a
       keyword/synonym answers rather than refuses ("weed", "snitch", "cas") */
    const minTokens = qTokens.length <= 2 ? 1 : 2;
    const passes =
      top.score >= THRESHOLD && top.matchedCount >= minTokens
      || (qTokens.length === 1 && top.matchedCount === 1 && top.score >= ALT_THRESHOLD);

    return passes
      ? { entry: top.entry, score: top.score, alternates }
      : { entry: null, score: top.score, alternates };
  },

  topics() {
    // representative entry per topic for refusal-state chips
    const seen = new Map();
    CORPUS.forEach((e) => {
      e.topics.forEach((t) => { if (!seen.has(t)) seen.set(t, e); });
    });
    return [...seen.values()];
  },

  byId(id) {
    return CORPUS.find((e) => e.id === id) || null;
  },
};
