/* safety.js — tiered risk check + Tier-3 takeover + Tier-2 banner.
   Honest scope, stated in the README and in the UI: these are curated
   patterns, not a model. Misses are possible. That is why both tiers
   surface human help, and why the check is deliberately conservative —
   hyperbole ("this homework is killing me") may fire it, by design.

   Invariant: every free-text input in the app is wrapped by safety.guard()
   BEFORE its content reaches retrieval, storage, or assembly.

   Privacy invariant: we never store or transmit matched text. Only a tier
   number and the held route string (never user text) touch sessionStorage. */

import { store } from "./store.js";
import { $, el, trapFocus } from "./ui.js";
import { router } from "./router.js";
import { currentRegion, crisisRoutes, bannerLines } from "./crisis.js";

/* ---------------- pattern taxonomy ----------------
   ['’]? — smart-quote tolerant: iOS/Word type U+2019, which would otherwise
   silently defeat these patterns.
   Tier 3 falls into two families, and the takeover's honest note branches
   on them: SELF (suicidality/self-harm) vs ABUSE (someone hurting them). */

const AP = "['’]?";
const T3 = [
  // --- SELF family ---
  // object is "myself" ONLY. The bare "me" form was matching the two most
  // common hyperboles in English — "this homework is killing me", "my mum will
  // kill me" — and Level 2 turns a false positive into a REFUSAL TO SEND, not
  // just a dismissible dialog. Real suicidality is still caught by the
  // patterns below (want to die / end it / no point / not be here / …).
  // Leader convention: intent leaders are (want to|wanna|going to|gonna|
  // plan(ning) to/on|about to) — "gonna X" must never require a literal "to".
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

const T2 = [
  { id: "t2-hopeless",     re: /\b(hopeless|worthless|pointless|empty\s+inside|numb\s+all\s+the\s+time)\b/i },
  { id: "t2-cant-anymore", re: new RegExp(`\\bcan${AP}t\\s+(do|take|handle)\\s+(this|it)\\s+(any\\s*more|anymore|any\\s+longer)\\b`, "i") },
  { id: "t2-hate-myself",  re: /\bhate\s+(myself|my\s+life)\b/i },
  { id: "t2-scared-home",  re: /\b(scared|afraid|nervous)\s+(to\s+go|of\s+going|to\s+be)\s+(home|at\s+home)\b/i },
  { id: "t2-harm-mention", re: /\b(hurting|harming)\s+(someone|somebody|people)\b/i },
  { id: "t2-not-eating",   re: new RegExp(`\\b(stopp?ed|can${AP}t|haven${AP}t\\s+been)\\s+(eat(ing)?|sleep(ing)?)\\b`, "i") },
  { id: "t2-panic",        re: /\bpanic\s+attacks?\b/i },
  { id: "t2-alone",        re: /\b(completely|totally|so)\s+alone\b/i },
];

function famsOf(matches) {
  const fams = new Set();
  T3.forEach((p) => { if (matches.includes(p.id)) fams.add(p.fam); });
  return fams;
}

/* ---------------- check ---------------- */

export const safety = {
  check(text) {
    // strip zero-width characters (strip, not space: "k​ill" must rejoin)
    const t = String(text || "").replace(/[​-‍⁠﻿­]/g, "");
    if (!t.trim()) return { tier: 0, matches: [] };
    const m3 = T3.filter((p) => p.re.test(t)).map((p) => p.id);
    if (m3.length) return { tier: 3, matches: m3 };
    const m2 = T2.filter((p) => p.re.test(t)).map((p) => p.id);
    if (m2.length) return { tier: 2, matches: m2 };
    return { tier: 0, matches: [] };
  },

  _dismissed() {
    return !!store.session.get("s")?.dismissed;
  },

  /** internal: run check, remember T3 families for the honest-note branch.
      The family category (a category flag, never text) persists in session so
      a refresh re-asserts the RIGHT honest note — an abused student must not
      be shown the "doesn't trigger children's aid" copy after a reload. */
  _scan(text) {
    const result = this.check(text);
    if (result.tier === 3) {
      this._lastFams = famsOf(result.matches);
      const prev = store.session.get("s") || {};
      store.session.set("s", { ...prev, fam: this._lastFams.has("abuse") ? "abuse" : "self" });
    }
    return result;
  },

  /** attach guards to a free-text input.
      After an explicit "I'm safe" dismissal this session, T3 re-detection does
      NOT re-open the takeover from typing — the banner stays, and Ask submits
      proceed so the relevant corpus answer (e.g. suicide-self-harm) can help.
      This prevents the permanent-lock failure where the person who most needs
      the "what happens if I say I'm suicidal" answer can never ask it. */
  guard(inputEl) {
    let timer = 0;
    inputEl.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const { tier } = this._scan(inputEl.value);
        // pass the input as the restore target: focus can move during the
        // 400ms debounce, and on blur it has already left
        if (tier === 3 && !this._dismissed()) this.takeover(this._everFired() ? "again" : "first", inputEl);
      }, 400);
    });
    inputEl.addEventListener("blur", () => {
      const { tier } = this._scan(inputEl.value);
      if (tier === 3 && !this._dismissed()) this.takeover(this._everFired() ? "again" : "first", inputEl);
      else if (tier >= 2) this._elevate();
    });
  },

  /** submit-time check; returns true when the caller may proceed.
      @param restoreTo where to send focus when the takeover is dismissed.
      Without it the student lands on the Send button they just pressed rather
      than the words they wrote — and this is the COMMON crisis path, since
      the client check runs before the relay's. */
  clear(text, restoreTo) {
    const { tier } = this._scan(text);
    if (tier === 3) {
      if (!this._dismissed()) { this.takeover(this._everFired() ? "again" : "first", restoreTo); return false; }
      this._elevate();
      return true; // dismissed once: let the corpus answer help instead of re-blocking
    }
    if (tier === 2) this._elevate();
    return true;
  },

  _everFired() {
    return !!store.session.get("s")?.fired;
  },

  _elevate() {
    const cur = store.session.get("s") || { tier: 0 };
    if ((cur.tier || 0) < 2) store.session.set("s", { ...cur, tier: 2 });
    renderBanner();
  },

  /* ---------------- Tier 3 takeover ---------------- */

  _active: false,
  _releaseTrap: null,

  takeover(variant = "first", restoreTo) {
    if (this._active) return;
    this._active = true;

    // any playing audio stops — a voice reading corpus copy under this
    // dialog would be noise at the worst possible moment (voice.js listens)
    document.dispatchEvent(new CustomEvent("bit:silence"));

    const prev = store.session.get("s") || {};
    // persist tier + fired flag only — never text
    store.session.set("s", { ...prev, tier: 3, fired: true });
    store.session.set("heldRoute", router.current());
    router.lock();

    // the honest note branches by what actually fired — a suicidal student
    // must NOT be told that disclosure triggers children's aid (it doesn't;
    // that duty is about abuse/neglect)
    const storedFam = store.session.get("s")?.fam;
    const fams = this._lastFams || new Set([storedFam === "abuse" ? "abuse" : "self"]);

    /* The two branches below state ONTARIO law, and only Ontario is verified.
       Telling a student in Australia that a disclosure triggers "a children's
       aid society" would be a confident, wrong claim at the worst possible
       moment — so outside Ontario we say only what we can stand behind: that
       the duty depends where they live, that the listed services will talk,
       and that they may ask their own school outright.

       Note what this deliberately does NOT say. An earlier version called the
       first listed line "anonymous… not reported anywhere" — unverified for
       services we haven't checked (several can initiate an emergency
       response), and for the "somewhere else" region lines[0] is undefined,
       so it rendered "The line above", which is the 112 emergency row. It
       promised anonymity for calling emergency services. */
    const lawKnown = currentRegion().lawVerified;
    const honestNote = !lawKnown
      ? [
          "Honest note, because you deserve the truth: what a school adult would have to pass on depends on where you live, and we only have that verified for Ontario, Canada — so we're not going to guess at yours. ",
          "Two things you can do anyway: the services above will talk this through with you, and you can ask your own school outright — \"if I tell you something, what would you have to pass on?\" — before you tell them anything. A good adult will answer that plainly.",
        ]
      : fams.has("abuse")
      ? [
          "Honest note, because you deserve the truth: if you tell a school adult that someone is hurting you and you're under 16, the law requires them to contact a children's aid society — that exists to protect you, and it can't be undone once said. At 16–17, reporting is allowed but not automatic. ",
          "Kids Help Phone is different: it's anonymous, so you choose what to share and when. Knowing this before you decide is the whole point of this site.",
        ]
      : [
          "Honest note, because you deserve the truth: telling a school counsellor you're struggling like this does not trigger children's aid — that law is about abuse and neglect. What a counsellor will do is take it seriously and work to keep you safe, which can include involving people who care about you. ",
          "Kids Help Phone is anonymous: you choose what to share and when. You don't have to have the words figured out first.",
        ];

    const overlay = el("div", { class: "takeover", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "takeover-title", "aria-describedby": "takeover-desc", tabindex: "-1" },
      el("div", { class: "takeover__panel" },
        el("h2", { id: "takeover-title" },
          variant === "again" ? "Still here for you." : "This matters more than this website."),
        el("p", { id: "takeover-desc" },
          variant === "again"
            ? "It sounds like things are still heavy. You don't have to carry this through an app — a real person is ready right now."
            : "What you just wrote sounds heavy — heavier than a website should hold alone. You deserve a real person, right now. These are free, private, and used by thousands of people your age every day."),
        // routed to the user's own country: a crisis number is worthless if it
        // is for the wrong side of the world. Every line comes from region.js,
        // where each one is recorded with the operator's site it was read from
        crisisRoutes(),
        el("div", { class: "takeover__honest" }, ...honestNote),
        el("div", { class: "btn-row btn-row--between", style: "margin-top:0" },
          el("button", { class: "btn btn--quiet", type: "button", onclick: () => quickExit() },
            "Leave this site quickly"),
          el("button", { class: "btn btn--secondary", type: "button", onclick: () => this._dismiss() },
            "I'm safe right now — take me back"))));

    document.body.append(overlay);
    document.body.style.overflow = "hidden";

    // background becomes inert: unreachable by focus, click, and SRs
    this._inerted = [...document.body.children].filter((n) => n !== overlay);
    this._inerted.forEach((n) => { n.inert = true; });

    this._overlay = overlay;
    this._releaseTrap = trapFocus(overlay, restoreTo);

    this._escBlock = (e) => {
      // stopImmediatePropagation only silences listeners registered AFTER
      // this one — the real invariant is that no other Escape-closable layer
      // (e.g. the practice overlay) can coexist with an active takeover:
      // practice contains no guarded inputs, and the takeover inerts its opener
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    document.addEventListener("keydown", this._escBlock, true);

    this._popBlock = () => {
      const held = store.session.get("heldRoute");
      if (held) history.replaceState(null, "", "#" + held);
    };
    addEventListener("popstate", this._popBlock);
  },

  /** which pattern families fired most recently — drives the honest-note branch */
  _lastFams: null,

  /** set by a route handler whose render bailed because the takeover fired —
      dismissal must then re-resolve the route or the page behind is blank */
  renderAborted: false,

  _dismiss() {
    this._active = false;
    const prev = store.session.get("s") || {};
    store.session.set("s", { ...prev, tier: 2, dismissed: true });
    store.session.remove("heldRoute");
    document.removeEventListener("keydown", this._escBlock, true);
    removeEventListener("popstate", this._popBlock);
    // un-inert BEFORE releasing the trap: _releaseTrap() restores focus to the
    // element the student was using, and focusing an inert element is a no-op —
    // so releasing first dropped them to <body> after "I'm safe right now",
    // losing their place in whatever they were typing.
    (this._inerted || []).forEach((n) => { n.inert = false; });
    this._inerted = null;
    if (this._releaseTrap) this._releaseTrap();
    this._overlay?.remove();
    document.body.style.overflow = "";
    router.unlock();
    renderBanner();
    if (this.renderAborted) {
      this.renderAborted = false;
      router.go(router.current()); // re-runs the handler; clear() now passes via the dismissed branch
    }
  },

  /** on boot: a refresh during an active takeover re-asserts it.
      (Honest limitation, documented in README: in private-browsing/blocked-storage
      mode sessionStorage is memory-only, so a refresh there escapes — the
      trade-off of storing nothing durable.) */
  restore() {
    const s = store.session.get("s");
    if (s?.tier === 3 && !s?.dismissed) this.takeover("again");
    else if ((s?.tier || 0) >= 2) renderBanner();
  },
};

/* ---------------- quick exit (shared) ---------------- */
export function quickExit() {
  // replace, not assign: this page drops out of the CURRENT history entry.
  // (Earlier entries may remain — stated honestly in the FAQ.)
  location.replace("https://www.google.com/search?q=weather");
}

/* ---------------- Tier 2 banner ---------------- */

/* The banner is session-persistent, so a student who trips tier 2 under the
   timezone guess and THEN corrects their country would otherwise keep an
   undialable Ontario number pinned under the nav for the rest of the session. */
addEventListener("bit:region", () => {
  const existing = $(".safety-banner");
  if (!existing) return;
  /* Not while the takeover is up. _inerted is a snapshot of body's children
     taken when the dialog opened, so a banner re-inserted now would sit
     OUTSIDE it — reachable by focus and screen readers behind a modal that is
     supposed to own the screen. The dispatch is debounced, so this window is
     real. _dismiss() calls renderBanner() anyway, which re-reads the region. */
  if (safety._active) return;
  existing.remove();
  renderBanner();
});

function renderBanner() {
  if ($(".safety-banner")) return;
  if ((store.session.get("s")?.tier || 0) < 2) return;
  // insert the live region EMPTY and fill it a tick later — a live region that
  // already has its content when appended is often not announced at all
  const banner = el("div", { class: "safety-banner", role: "status" });
  const nav = $(".nav");
  if (nav && nav.parentNode) nav.parentNode.insertBefore(banner, nav.nextSibling);
  else document.body.prepend(banner);
  /* A TIMER, not requestAnimationFrame. rAF does not fire while the tab isn't
     compositing, and this content is the crisis phone numbers: a missed frame
     leaves a distressed student staring at an empty coloured bar, with the
     live region announcing nothing. Observed happening in a hidden tab.
     (The extra scroll depth this banner forces is declared by
     `body:has(.safety-banner)` in components.css for most targets; the crisis
     jump measures nav + banner live at click time — see ui.js.) */
  setTimeout(() => {
    // the banner persists for the whole session, so a hard-coded Ontario
    // number here would sit undialable in front of a UK or AU student for as
    // long as they use the site
    banner.append(el("span", {}, "Whatever is going on, you don't have to figure it out alone. "));
    bannerLines().forEach((node, i) => {
      if (i) banner.append(el("span", {}, " · "));
      banner.append(node);
    });
  }, 50);
}
