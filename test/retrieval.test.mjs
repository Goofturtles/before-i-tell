/* retrieval.test.mjs — pins the L1 engine's routing so corpus edits can't
   silently regress it. Run: node test/retrieval.test.mjs (no install, no DOM).

   Three suites: (1) queries that must hit a SPECIFIC entry, (2) off-topic
   queries that must REFUSE (the engine's designed failure mode), (3)
   structural checks (related ids resolve, cites present, ids unique). */

import { retrieval } from "../js/retrieval.js";
import { CORPUS } from "../js/corpus.js";

const MUST_HIT = [
  // the product's headline questions
  ["will they tell my parents", "tell-parents"],
  ["will you tell anyone", "what-must-report"],
  ["will they tell anyone", "what-must-report"],
  ["what do you have to report", "what-must-report"],
  ["what stays confidential", "what-stays-private"],
  // people and fears
  ["will i get taken away from my family", "taken-away"],
  ["does cas put kids in foster care", "taken-away"],
  ["what does cas actually do", "what-happens-after-report"],
  ["what if they dont believe me", "believed-proof"],
  ["do i need proof", "believed-proof"],
  ["what if they think im lying", "believed-proof"],
  ["will they tell my parents if im gay", "coming-out"],
  ["is coming out to the counsellor confidential", "coming-out"],
  ["what if a teacher is the one hurting me", "adult-is-problem"],
  ["can i report a teacher", "adult-is-problem"],
  ["i dont trust my counsellor", "counsellor-trust"],
  ["what if the counsellor is the problem", "counsellor-trust"],
  ["im being bullied", "bullying"],
  ["will they do anything about cyberbullying", "bullying"],
  // logistics — the "how do I actually do this" intent
  ["how do i talk to the counsellor", "how-to-start"],
  ["how do i see the counsellor", "how-to-start"],
  ["can i email the counsellor", "how-to-start"],
  ["can i text the counsellor", "how-to-start"],
  ["can i bring a friend with me", "how-to-start"],
  ["can i write it down instead of saying it", "how-to-start"],
  ["does the counsellor cost money", "how-to-start"],
  // police vs drugs disambiguation
  ["police", "police"],
  ["do they call the cops", "police"],
  ["will they call the cops if i talk about weed", "drugs-alcohol"],
  ["is weed illegal to talk about", "drugs-alcohol"],
  // rest of the catalog
  ["can i take it back after i tell", "change-mind"],
  ["do they write down what i say", "records"],
  ["what if i ask hypothetically", "hypothetical"],
  ["asking hypothetically does it count", "hypothetical"],
  ["someone has my nudes", "sexting-images"],
  ["is sexting illegal", "sexting-images"],
  ["my boyfriend hits me is that reported", "dating-violence"],
  ["im 17 do they still have to report", "age-16-17"],
  ["can i ask about birth control", "health-confidential"],
  ["my stepdad yells at me", "what-stays-private"],
  ["is yelling abuse", "what-stays-private"],
  ["i think my friend is being abused by her dad", "friend-disclosure"],
];

const MUST_REFUSE = [
  "tell me a joke",
  "can you write my essay",
  "how do i hack the school",
  "what is the meaning of life",
  "who made this website",
  "whats the weather today",
  "do my homework for me",
  "what time does school end",
  // bug-hunt: "high school" must NOT return the drugs/police answer
  "high school",
  "my high school",
  "i go to a big high school",
];

let pass = 0, fail = 0;
for (const [q, want] of MUST_HIT) {
  const { entry, score } = retrieval.answer(q);
  const got = entry?.id || "(refusal)";
  if (got === want) pass++;
  else { console.log(`FAIL hit  "${q}" -> ${got} (wanted ${want}, score ${score.toFixed(2)})`); fail++; }
}
for (const q of MUST_REFUSE) {
  const { entry, score } = retrieval.answer(q);
  if (!entry) pass++;
  else { console.log(`FAIL refuse  "${q}" -> ${entry.id}@${score.toFixed(2)} (should refuse)`); fail++; }
}

const ids = new Set(CORPUS.map((e) => e.id));
for (const e of CORPUS) {
  for (const r of e.related || []) if (!ids.has(r)) { console.log(`FAIL structure: ${e.id} relates to missing ${r}`); fail++; }
  if (!e.cite?.length || e.cite.some((c) => !c?.url)) { console.log(`FAIL structure: ${e.id} bad cites`); fail++; }
}
if (CORPUS.length !== ids.size) { console.log("FAIL structure: duplicate ids"); fail++; }

console.log(`\n${pass} passed, ${fail} failed (${CORPUS.length} corpus entries)`);
process.exit(fail ? 1 : 0);
