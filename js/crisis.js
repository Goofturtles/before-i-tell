/* crisis.js — renders the crisis routes for the user's chosen region.

   Separate from region.js (which is pure data) and from safety.js (which owns
   the takeover) so that every surface showing crisis help — the takeover, the
   page-bottom strip, the tier-2 banner — reads from ONE place. When these were
   three hand-written lists, "update the numbers" meant remembering all three. */

import { el } from "./ui.js";
import { store } from "./store.js";
import { REGIONS, REGION_ORDER, regionById, guessRegion, DEFAULT_REGION } from "./region.js";

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

/** true once the user has actively chosen, so the picker can prompt on a first
    visit and stay out of the way afterwards */
export function regionChosen() {
  const saved = store.get("region");
  return Boolean(saved && REGIONS[saved]);
}

function telHref(line) {
  if (line.tel) return "tel:" + line.tel;
  return "sms:" + line.sms + (line.smsBody ? "?&body=" + line.smsBody : "");
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

/** The compact strip at the bottom of every page. */
export function crisisStrip(container) {
  if (!container) return;
  const r = currentRegion();
  const inner = container.querySelector(".crisis__inner");
  if (!inner) return;
  // keep the page's own heading (the adult page says "If they're in danger
  // right now:", which must not be replaced with the teen-voiced label), and
  // clear the picker too or repeat calls stack duplicate selects
  [...inner.querySelectorAll("a, .muted, .region-pick")].forEach((n) => n.remove());

  r.lines.forEach((line) => {
    inner.append(el("a", { href: telHref(line) }, line.name + " " + line.display));
  });
  if (!r.lines.length && r.directory) {
    inner.append(el("a", { href: r.directory.url, target: "_blank", rel: "noopener noreferrer" }, r.directory.name));
  }
  inner.append(el("span", { class: "muted" },
    r.emergency ? "In immediate danger: " + r.emergency : "In immediate danger: your local emergency number"));

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
      wireCrisis();
      // tell the rest of the app so any region-dependent screen can redraw
      dispatchEvent(new CustomEvent("bit:region"));
    },
  }, REGION_ORDER.map((id) =>
    el("option", { value: id, selected: id === currentRegionId() }, REGIONS[id].name)));

  inner.append(el("span", { class: "region-pick" }, el("span", {}, "Showing help for"), sel));
}

/** Re-render every crisis surface on the page. */
export function wireCrisis() {
  document.querySelectorAll(".crisis").forEach((n) => crisisStrip(n));
}
