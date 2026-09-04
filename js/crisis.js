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

  rows.push(
    r.emergency
      ? el("a", { class: "takeover__route", href: "tel:" + r.emergency },
          el("span", {}, el("b", {}, "In danger right now?"), el("span", {}, "Call " + r.emergency + ".")),
          el("span", { class: "num" }, r.emergency))
      : el("div", { class: "takeover__route" },
          el("span", {}, el("b", {}, "In danger right now?"),
            el("span", {}, "Call your local emergency number — in most of Europe it's 112.")),
          el("span", { class: "num" }, "—")));

  return el("div", { class: "takeover__routes" }, rows);
}

/** The compact strip at the bottom of every page. */
export function crisisStrip(container) {
  if (!container) return;
  const r = currentRegion();
  const label = container.querySelector(".crisis__label");
  const inner = container.querySelector(".crisis__inner");
  if (!inner) return;
  // keep the heading, replace the links
  [...inner.querySelectorAll("a, .muted")].forEach((n) => n.remove());

  r.lines.forEach((line) => {
    inner.append(el("a", { href: telHref(line) }, line.name + " " + line.display));
  });
  if (!r.lines.length && r.directory) {
    inner.append(el("a", { href: r.directory.url, target: "_blank", rel: "noopener noreferrer" }, r.directory.name));
  }
  inner.append(el("span", { class: "muted" },
    r.emergency ? "In immediate danger: " + r.emergency : "In immediate danger: your local emergency number"));
  if (label) label.textContent = "Need someone right now?";

  // The picker lives WITH the numbers, not buried in settings: its only job is
  // to make sure the numbers above are the right ones for where you are.
  const sel = el("select", {
    class: "region-select",
    "aria-label": "Show help for which country",
    onchange: (e) => { setRegion(e.target.value); location.reload(); },
  }, REGION_ORDER.map((id) =>
    el("option", { value: id, selected: id === currentRegionId() }, REGIONS[id].name)));

  inner.append(el("span", { class: "region-pick" }, el("span", {}, "Showing help for"), sel));
}

/** Re-render every crisis surface on the page. */
export function wireCrisis() {
  document.querySelectorAll(".crisis").forEach((n) => crisisStrip(n));
}
