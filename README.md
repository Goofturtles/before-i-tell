# Before I Tell

**Know what happens before you say it.**

**Live: https://goofturtles.github.io/before-i-tell/**

A website that prepares a young person to tell an adult at school something hard — and prepares the adult to receive it well.

## The three-minute tour (for judges)

1. **Ask it the scary question** — open [the app](https://goofturtles.github.io/before-i-tell/app.html#/ask) and type *"will you tell my parents"* or *"will I get taken away"*. Every answer cites the actual Ontario rule. Now type *"tell me a joke"* — it refuses rather than guesses, because a safety product must fail to "I don't know."
2. **Trip the safety net** — type *"i want to end it all"*. The site stops being a website: a full-screen takeover routes to Kids Help Phone and 9-8-8, can't be escaped by Esc/back/refresh, and its honest note *branches* (a suicidal student is told the truth that this does **not** trigger children's aid; an abused student is told the truth that it does).
3. **See radical transparency** — on Level 2's compose screen, open *"See the exact email they'll receive"*: the site shows students the full email, word for word, before they send. On Level 3, build your terms and watch the adult's briefing page carry your requests — never your story (it's not in the link; decode it yourself).
4. **Prove the privacy claim** — turn on airplane mode and reload. Levels 1 and 3 still work entirely. A tool that sent your answers to a server couldn't do that.
5. **The other half** — the [adult briefing page](https://goofturtles.github.io/before-i-tell/adult.html) teaches the receiving adult how to listen, including the hard case where they must report.

Under the hood: zero external requests on Levels 1/3, a rule-based retrieval engine that refuses instead of hallucinating (committed regression suites: `test/retrieval.test.mjs`, `relay/test/relay.test.mjs` — 159 assertions), and a codename email relay on **Render** with crisis interception, school-address-only delivery, and spoof-resistant rate limiting.

Built for **Hack for Humanity | Summer 2026** (theme: AI for mental/physical health). Interface: flat, high-contrast, Uber-Base-inspired — black & white foundation, heavy editorial type, light + dark themes.

## The problem

75% of adolescents with mental-health problems are not in contact with any service (Velasco et al., 2020 — 54 studies, 56,821 participants). The top barriers aren't access — they're stigma, fear of confidentiality breaches, and **not knowing what happens after telling** (Gulliver, Griffiths & Christensen, 2010; Rowe et al., 2014). The counsellor's office is forty feet away and empty; walking in is the hard part, because it feels like handing over control of your own story.

## What it does

Three levels, climbed at the user's own speed — every step up is a button only they press:

- **L1 · Ask** — anonymous Q&A about exactly what a school adult must report vs. what stays confidential in Ontario. Answers are *retrieved from a fixed, cited corpus* (23 entries: reporting, confidentiality, coming out, bullying, being believed, "will I be taken away", how to even start…) — never generated. Unknown questions get an honest "I don't know" plus a route to a human.
- **L2 · Codename** — **live**: write to an adult at your school under a codename ("Blue Heron 41"), through a deployed relay (Render) that only accepts school addresses, intercepts crisis content, and routes replies back to the codename. Neither side learns who the other is. What still needs the real world: school-board adoption so counsellors expect these messages.
- **L3 · Tell, on your terms** — set the rules for the conversation (what's negotiable is entirely yours; what the law fixes is shown honestly and locked), optionally build your words from your own text, **practice saying them out loud** on a full-screen rehearsal card, and generate an **adult briefing page**: how to listen, plus your specific requests. The disclosure itself is never in the link — it stays yours until you say it out loud.

**Offline as proof.** After the first visit a service worker keeps the whole site on-device: Levels 1 and 3 run in airplane mode. That's the checkable form of "nothing you type leaves your device" — a tool that needed a server couldn't do it.

**A voice, where a voice helps (ElevenLabs, build-time only).** "Listen" buttons on the L1 answers and the adult briefing play pre-recorded narration — generated once by the site author with ElevenLabs (`tools/voice-build.mjs`), shipped as same-origin mp3 files like the font. The adult page is the clever half: the calm, unhurried voice *models the exact tone the page teaches*, and listening forces the full two minutes instead of a skim. For students, it serves younger readers, dyslexic readers, and anyone too shaken to parse dense legal text. What we deliberately refused: runtime text-to-speech. The only text worth speaking at runtime is the student's own words, and a cloud voice API has no business hearing those — so pressing play fetches a file from this site, sends nothing, and works offline. The buttons appear only where a generated clip exists; until then the feature is invisible.

```bash
# one-time, by the site author (key never ships):
ELEVENLABS_API_KEY=xi-... node tools/voice-build.mjs   # starter set, fits the free tier
# then: git add media/voice && commit && push
```

## Safety architecture

- **Tiered risk detection** on every free-text input, *before* anything else sees it.
  - Tier 3 (active self-harm/suicide intent, being hurt now): full-screen calm takeover routing to Kids Help Phone (1-800-668-6868 / text CONNECT to 686868), 9-8-8, and 911. Cannot be dismissed by Esc, backdrop, back button, or refresh — only by an explicit "I'm safe right now" choice. The background becomes `inert`. The honest note **branches**: an abuse disclosure explains the children's-aid duty (mandatory under 16, permissive 16–17); suicidal distress explicitly does *not* claim CAS involvement, because that would be false and could deter help-seeking.
  - Tier 2 (distress without stated intent): a persistent, gentle banner with human routes.
  - After an explicit dismissal, re-detection does not re-lock the app — so the person who most needs the "what happens if I say I'm suicidal" answer can actually ask it.
- **Honest limitations, stated in-product**: detection is curated patterns, not ML — misses are possible; hyperbole may over-fire by design (conservative). In private-browsing, storage is memory-only, so a refresh escapes the takeover — the trade-off of storing nothing durable.
- **Privacy by architecture**: no server, no accounts, no analytics, **zero external requests** (any third-party script could read the URL fragment). L1 questions are never persisted. The adult link carries term *ids and enums only* — never free text except an optional ≤12-char display name, rendered as text. All storage is `bit:*`-prefixed localStorage with a "Delete everything" control and a quick-exit. Matched safety text is never stored — only a tier number.
- **The words scaffold cannot invent facts** — there is no generation step; assembly is a pure string join of the user's own words and fixed templates.
- **Print** strips the URL fragment before printing so the payload never appears in the browser's printed header.

## Why the "AI" is rule-based + retrieval, on purpose

Lexical retrieval fails to "I don't know" — the correct failure mode for a safety product. A generative model fails to a confident wrong answer about the law. AI "therapy" is now illegal in Nevada (AB 406) and Illinois (WOPR Act); what those laws *explicitly permit* is administrative and supplementary support — which is exactly what this is. `retrieval.answer()` is the single seam where a dense re-ranker can be added later.

## Sources

- OACAS — [Duty to Report](https://www.oacas.org/childrens-aid-child-protection/duty-to-report/)
- Ontario College of Teachers — [Professional Advisory: Duty to Report](https://www.oct.ca/en-ca/for-members/professional-advisories/duty-to-report)
- IPC Ontario — [Disclosure to a children's aid society](https://www.ipc.on.ca/en/education/special-topics/disclosure-to-a-childrens-aid-society)
- [Kids Help Phone](https://kidshelpphone.ca/) · [9-8-8](https://988.ca/)
- Gulliver, Griffiths & Christensen (2010), *BMC Psychiatry* · Velasco et al. (2020) · Rowe et al. (2014)

Jurisdiction: **Ontario**. The listening guidance is universal; reporting rules differ elsewhere and the UI says so.

## Run it

The site is live at **https://goofturtles.github.io/before-i-tell/** (GitHub Pages, static hosting, `.nojekyll`). Level 2 runs against the deployed relay at `https://bit-relay.onrender.com` (**Render** free tier — `render.yaml` at the repo root is the blueprint; `PROD_RELAY` in `js/config.js` points the site at it). Emptying `PROD_RELAY` cleanly degrades Level 2 back to its labelled preview.

Locally: no build step. ES modules require an HTTP server (file:// won't work):

```bash
python -m http.server 3487 -d before-i-tell
```

Then open http://localhost:3487/. Dev note: the service worker serves cache-first, so after editing a file the first reload can be one version behind (the refresh lands in the background); reload twice, or unregister the SW in DevTools while iterating.

## Structure

```
index.html         landing (works with JS disabled)
app.html           student flow — hash-routed SPA
adult.html         the briefing page (reads #t= fragment; degrades to generic guidance)
css/tokens.css     design tokens: light default, dark via data-theme or system preference
css/base.css       reset, type, layout, nav, motion (reduced-motion + no-scroll-timeline fallbacks)
css/components.css ladder, ask, terms, takeover, briefing
css/print.css      print: forced light, chrome stripped
js/store.js        bit:* storage with in-memory fallback
js/router.js       hash router, guards, safety lock
js/safety.js       tier taxonomy, takeover, banner, quick exit
js/corpus.js       DATA: 23 cited Q&A entries + teen-register synonyms
js/retrieval.js    lexical scoring; honest refusal below threshold
js/ask.js          L1 screen
js/terms.js        terms catalog (student + adult copy, append-only ids)
js/scaffold.js     words scaffold (pure template join)
js/link.js         fragment encode/decode, versioned, enum-validated
js/app.js          routes + screens + practice mode (rehearsal dialog)
js/adult.js        briefing renderer + hash-stripping print
js/voice.js        optional pre-recorded Listen buttons (dark until generated)
tools/voice-build.mjs — build-time ElevenLabs narration generator
sw.js              offline shell (same-origin only; never caches user input)
manifest.webmanifest + icon.svg — installable, minimal-ui
media/             generated video: story-scrub.mp4 (all-intra H.264 for
                   bidirectional scroll-scrubbing), warm-loop.mp4, posters
```

### Regenerating the video clips

Both clips are AI-generated locally (LTX-Video 2B on ComfyUI, RTX 4090 — no
external services, keeping the zero-request guarantee). Prompts: "luminous
violet ink clouds swirling underwater, deep indigo" (story, seed 771001) and
"soft pastel watercolor clouds in cream/lavender/mint/peach" (warm, seed
771002), 832×480 × 97 frames. Post-process for scrubbing:

```bash
ffmpeg -i in.mp4 -c:v libx264 -g 1 -pix_fmt yuv420p -crf 26 -movflags +faststart -an story-scrub.mp4
```

`-g 1` (every frame a keyframe) is what makes reverse scrubbing smooth. The
page loads the scrub clip as a Blob URL because some static servers (including
python http.server) lack Range support, which silently breaks media seeking.

## Honest limitations

- Not a crisis service, not therapy, not legal advice — and it says so where users will read it.
- Pattern-based risk detection will miss things; that is why every tier routes to humans.
- Quick exit replaces only the current history entry; browser history may retain earlier pages and the adult link. The FAQ recommends private windows on shared devices.
- L2 requires a school partnership to be real; it is presented as a preview, not simulated.
