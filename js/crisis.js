/* crisis.js — renders the crisis routes for the user's chosen region.

   Separate from region.js (which is pure data) and from safety.js (which owns
   the takeover) so that every surface showing crisis help — the takeover, the
   page-bottom strip, the tier-2 banner — reads from ONE place. When these were
   three hand-written lists, "update the numbers" meant remembering all three. */

import { el } from "./ui.js";
import { store } from "./store.js";
import { REGIONS, REGION_ORDER, regionById, guessRegion, telHref, DEFAULT_REGION } from "./region.js";

/** The user's choice if they made one, else a timezone guess. Never a network
    lookup — the zero-external-request guarantee covers this too. */
export function currentRegion() {
  const saved = store.get("region");
  if (saved && REGIONS[saved]) return regionById(saved);
  return regionById(guessRegion() || DEFAULT_REGION);
}

export function currentRegionId() {
  const saved = store.get("region");
  if (saved && REGIONS[saved]) return saved;
  return guessRegion() || DEFAULT_REGION;
}

export function setRegion(id) {
  if (REGIONS[id]) store.set("region", id);
}

/** The routes block inside the tier-3 takeover. */
export function crisisRoutes() {
  const r = currentRegion();
  const rows = r.lines.map((line) =>
    el("a", { class: "takeover__route", href: telHref(line) },
      el("span", {}, el("b", {}, line.name), el("span", {}, line.note)),
      el("span", { class: "num" }, line.display)));

  // no verified line for this country: send them to a maintained directory
  // rather than to a number we made up
  if (!r.lines.length && r.directory) {
    rows.push(
      el("a", { class: "takeover__route", href: r.directory.url, target: "_blank", rel: "noopener noreferrer" },
        el("span", {},
          el("b", {}, r.directory.name),
          el("span", {}, "We don't have a verified number for your country — this directory does, for 130+ countries.")),
        el("span", { class: "num" }, "Open")));
  }

  // Always DIALABLE, never a dead row. Where we don't know the local
  // emergency number, 112 is the honest best offer: it reaches emergency
  // services across the EU and, via GSM, from most mobile networks worldwide.
  rows.push(
    r.emergency
      ? el("a", { class: "takeover__route", href: "tel:" + r.emergency },
          el("span", {}, el("b", {}, "In danger right now?"), el("span", {}, "Call " + r.emergency + ".")),
          el("span", { class: "num" }, r.emergency))
      : el("a", { class: "takeover__route", href: "tel:112" },
          el("span", {}, el("b", {}, "In danger right now?"),
            el("span", {}, "Use your local emergency number. From most mobiles, 112 also connects.")),
          el("span", { class: "num" }, "112")));

  return el("div", { class: "takeover__routes" }, rows);
}

/** Inline "here's who to call" for running prose — the honest refusal, the
    Level 2 crisis fork, the post-send wait note. These are the quieter crisis
    surfaces, and they were still handing a Canadian 1-800 to students in the
    UK and Australia. Returns nodes, so callers splice it into a sentence. */
export function helpInline() {
  const r = currentRegion();
  if (r.lines.length) {
    const l = r.lines[0];
    return [el("a", { href: telHref(l) }, l.name + ", " + l.display)];
  }
  return [el("a", {
    href: r.directory ? r.directory.url : "https://findahelpline.com/",
    target: "_blank", rel: "noopener noreferrer",
  }, "a helpline where you are")];
}

/** May copy call the primary line "anonymous"? Only where region.js records
    it. The word is a promise about what happens to what you say, so it must
    be verified per service — 988 is confidential but can dispatch, and for an
    unknown country the link is a whole directory we know nothing about. */
export function primaryIsAnon() {
  return Boolean(currentRegion().lines[0]?.anon);
}

/** The tier-2 banner's inline links — same data, so the banner can never
    advertise a number the takeover doesn't. */
export function bannerLines() {
  const r = currentRegion();
  if (r.lines.length) {
    return r.lines.slice(0, 2).map((line) =>
      el("a", { href: telHref(line) }, line.name + " " + line.display));
  }
  return [el("a", {
    href: r.directory ? r.directory.url : "https://findahelpline.com/",
    target: "_blank", rel: "noopener noreferrer",
  }, "Find a helpline where you are")];
}

let regionAnnounce = 0;

/** The compact strip at the bottom of every page. */
export function crisisStrip(container) {
  if (!container) return;
  const r = currentRegion();
  const inner = container.querySelector(".crisis__inner");
  if (!inner) return;
  // keep the page's own heading (the adult page says "If they're in danger
  // right now:", which must not be replaced with the teen-voiced label), and
  // clear the picker too or repeat calls stack duplicate selects
  [...inner.querySelectorAll("a, .muted, .crisis__emerg, .region-pick")].forEach((n) => n.remove());

  r.lines.forEach((line) => {
    inner.append(el("a", { href: telHref(line) }, line.name + " " + line.display));
  });
  if (!r.lines.length && r.directory) {
    inner.append(el("a", { href: r.directory.url, target: "_blank", rel: "noopener noreferrer" }, r.directory.name));
  }
  // an ANCHOR, not a span: adult.html shipped <a href="tel:911"> here and this
  // used to replace it with dead text — on the page most likely opened on a
  // phone. For an unknown country 112 is the honest dialable fallback.
  inner.append(el("a", { href: "tel:" + (r.emergency || "112"), class: "crisis__emerg" },
    r.emergency ? "In immediate danger: " + r.emergency : "In immediate danger: 112"));

  // The picker lives WITH the numbers, not buried in settings: its only job is
  // to make sure the numbers above are the right ones for where you are.
  /* Re-render in place; do NOT reload. A reload would (a) destroy an unsent
     Level 2 message, which is never persisted, (b) wipe the choice itself in
     private browsing, where the store is an in-memory Map, and (c) fire on
     every arrow key, since a closed <select> emits `change` per option on
     Windows — trapping keyboard users on the second entry. */
  const sel = el("select", {
    class: "region-select",
    "aria-label": "Show help for which country",
    onchange: (e) => {
      setRegion(e.target.value);
      wireCrisis();                 // this REPLACES the select you're using…
      /* Debounced: on Windows a closed <select> fires `change` once per arrow
         key, and each dispatch blanks + refills the tier-2 banner (a polite
         live region) and rebuilds #view. Nine options meant nine blanks and
         nine announcements. The strip above still updates instantly. */
      clearTimeout(regionAnnounce);
      regionAnnounce = setTimeout(() => dispatchEvent(new CustomEvent("bit:region")), 150);
      // …so put focus back on its replacement. Without this, changing the
      // dropdown drops focus to <body> and the /ask re-render then throws the
      // user to the top of the page (WCAG 3.2.2).
      const again = document.querySelector(".region-select");
      if (again) again.focus();
    },
  }, REGION_ORDER.map((id) =>
    el("option", { value: id, selected: id === currentRegionId() }, REGIONS[id].name)));

  inner.append(el("span", { class: "region-pick" }, el("span", {}, "Showing help for"), sel));
}

/** Re-render every crisis surface on the page. */
export function wireCrisis() {
  document.querySelectorAll(".crisis").forEach((n) => crisisStrip(n));
}
