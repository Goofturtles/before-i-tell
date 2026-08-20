/* voice-build.mjs — pre-generates the optional "Listen" audio (see js/voice.js).

   This is a BUILD-TIME tool, run by the site author on their own machine.
   The API key never ships; the site only ever serves the finished mp3 files,
   same-origin, like the font. Nothing a user types is ever voiced — student
   words never leave their device, so there is deliberately no runtime TTS.

   Usage:
     ELEVENLABS_API_KEY=xi-... node tools/voice-build.mjs          # starter set
     ELEVENLABS_API_KEY=xi-... node tools/voice-build.mjs --all    # every entry
     ELEVENLABS_API_KEY=xi-... node tools/voice-build.mjs --force  # regenerate

   PowerShell:  $env:ELEVENLABS_API_KEY="xi-..."; node tools/voice-build.mjs

   The starter set (~8.5k characters) fits inside ElevenLabs' free tier
   (~10k credits/month): the adult briefing plus the seven most-asked answers.
   Run --all in a later month, or on a paid tier, to voice the whole corpus.

   Voice: defaults to "Rachel" (21m00Tcm4TlvDq8ikWAM) — calm, warm, unhurried,
   which on the adult page is itself the lesson. Override: ELEVENLABS_VOICE_ID. */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { CORPUS } = await import("../js/corpus.js");

const KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const VOICE = (process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM").trim();
const ALL = process.argv.includes("--all");
const FORCE = process.argv.includes("--force");

if (!KEY) {
  console.error("Set ELEVENLABS_API_KEY first (create one at elevenlabs.io → Profile → API keys).");
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "media", "voice");
const MANIFEST = join(OUT, "manifest.json");

/* The adult briefing narration — kept in sync with js/adult.js by hand.
   Slightly adapted for the ear (numbered steps spoken, quotes flattened). */
const ADULT_BRIEFING = `Someone is about to tell you something hard. This page helps the conversation go well. It takes two minutes — and what they have to say is not in this page. It stays theirs, until they say it.

How to receive what you're about to hear.

One. Listen all the way through first. No questions, no advice, no visible alarm — even helpful interruptions tell them to stop. There will be time for all of it after.

Two. Believe them. The single strongest predictor of whether a young person keeps seeking help is whether the first adult believed them. You can verify details later. Believe first.

Three. Don't promise secrecy. Say what you must share, before they start. In Ontario, every adult must report suspected abuse or neglect of anyone under sixteen directly to a children's aid society — even things told in confidence. Saying this up front, plainly and kindly, is what makes the rest of their trust possible.

Four. Let silence happen. If they go quiet or cry, wait. The pause is part of the telling.

Five. End with what happens next — decided together. Name one concrete next step, however small, and when you'll check in. Uncertainty after disclosure is where regret grows.

And the hard case. What if they ask you not to tell anyone — and it's something you must report? Honor every request you legally can, and be honest immediately about the one you can't. Something like: I'm going to do everything you asked. One thing I can't do is keep this part secret — the law says I have to involve people whose whole job is protecting you. I'll tell you exactly what happens next. And I'm not going anywhere.

However they chose to tell you — they chose you. That means something. Take a breath. You're ready.`;

/* highest-traffic answers first: the fears that keep the most people silent */
const STARTER_IDS = [
  "tell-parents", "what-must-report", "suicide-self-harm", "taken-away",
  "coming-out", "believed-proof", "change-mind",
];

function entryText(e) {
  return `${e.q[0]}\n\n${e.a.join("\n\n")}`;
}

async function tts(text, file) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        // steady and warm; low style keeps it plain-spoken, not performed
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15 },
      }),
    },
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

const jobs = [
  { id: "adult-briefing", text: ADULT_BRIEFING },
  ...CORPUS
    .filter((e) => ALL || STARTER_IDS.includes(e.id))
    .map((e) => ({ id: e.id, text: entryText(e) })),
];

if (!existsSync(OUT)) await mkdir(OUT, { recursive: true });
let manifest = { v: 1, voice: VOICE, clips: {} };
if (existsSync(MANIFEST) && !FORCE) {
  try { manifest = JSON.parse(await readFile(MANIFEST, "utf8")); } catch { /* rebuild */ }
}

let chars = 0, made = 0, skipped = 0;
for (const job of jobs) {
  const file = join(OUT, `${job.id}.mp3`);
  if (existsSync(file) && !FORCE) {
    manifest.clips[job.id] = `media/voice/${job.id}.mp3`;
    skipped++;
    continue;
  }
  process.stdout.write(`  ${job.id} (${job.text.length} chars)… `);
  try {
    await tts(job.text, file);
    manifest.clips[job.id] = `media/voice/${job.id}.mp3`;
    // write the manifest after every clip: a quota cut-off mid-run still
    // leaves a valid, working partial set
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
    chars += job.text.length;
    made++;
    console.log("ok");
  } catch (err) {
    console.log(`FAILED — ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 600)); // stay polite to the API
}

console.log(`\n${made} generated (${chars} chars billed), ${skipped} already existed.`);
console.log(`Manifest: ${MANIFEST}`);
console.log(`Commit media/voice/ and push — the Listen buttons appear wherever a clip exists.`);
