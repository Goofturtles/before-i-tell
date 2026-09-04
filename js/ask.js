/* ask.js — the L1 "Ask" screen. Anonymous by design: questions are never
   persisted anywhere. Input passes through safety.guard/clear before
   retrieval sees it. Answers always cite; unknowns refuse honestly. */

import { el, clearNode, appendKids } from "./ui.js";
import { safety } from "./safety.js";
import { retrieval } from "./retrieval.js";
import { voice } from "./voice.js";
import { currentRegion } from "./crisis.js";

/* The corpus is Ontario law. Outside Ontario the honest move is to say so
   BEFORE the answers, not in a footnote under them — a student reading
   "your counsellor must report this" has no way to know it was written for
   somewhere else. Generating local rules instead would be the one failure
   this product exists to prevent: a confident, wrong answer about whether a
   disclosure gets passed on. */
function jurisdictionNote() {
  const r = currentRegion();
  if (r.lawVerified) return null;
  return el("div", { class: "decode-note" },
    el("p", { style: "margin:0 0 8px" },
      el("b", {}, "You're set to " + r.name + " — so read the legal answers below as background, not as your rules."),
      " Every answer here is checked against ", el("b", {}, "Ontario, Canada"),
      " law. Who must report what genuinely differs where you are, and we won't invent it."),
    el("p", { style: "margin:0" },
      "What still applies anywhere: how to prepare, how to choose an adult, and what to ask them. ",
      el("b", {}, "Ask your school directly"),
      " — \"if I tell you something, what would you have to pass on?\" is a fair question, and a good adult will answer it plainly."));
}

function renderAnswer(container, entry) {
  clearNode(container);
  const heading = el("h2", {}, entry.q[0]);
  const headRow = el("div", { class: "answer-head" }, heading);
  // appears only when pre-recorded audio exists for this entry (see voice.js)
  voice.attach(headRow, entry.id);
  container.append(
    el("article", { class: "answer-card step-enter" },
      headRow,
      el("div", { class: "answer-body" },
        entry.a.map((para) => el("p", {}, para))),
      el("div", { class: "cite-row" },
        el("span", { class: "caption" }, "Sources:"),
        entry.cite.map((c) =>
          el("a", { class: "cite-chip", href: c.url, target: "_blank", rel: "noopener noreferrer" }, c.label))),
      entry.related?.length
        ? el("div", {},
            el("span", { class: "suggest-label" }, "People usually ask next"),
            entry.related
              .map((id) => retrieval.byId(id))
              .filter(Boolean)
              .map((rel) =>
                el("button", { class: "suggest-row", type: "button", onclick: () => ask.show(rel.id) },
                  el("span", {}, rel.q[0]))))
        : null));
}

function renderRefusal(container, alternates) {
  clearNode(container);
  // never a dead end: fall back to one entry per topic when nothing scored close
  const suggestions = alternates.length ? alternates : retrieval.topics();
  container.append(
    el("article", { class: "answer-card step-enter" },
      el("h2", {}, "Honestly? I'm not sure about that one."),
      el("div", { class: "answer-body" },
        el("p", {}, "Rules like these matter too much to guess at, so I only repeat what's actually written down in my sources. Guessing could steer you wrong, and you deserve better."),
        el("p", {}, "A real person can answer anything, anonymously: ",
          el("a", { href: "tel:1-800-668-6868" }, "Kids Help Phone, 1-800-668-6868"),
          " or text CONNECT to 686868.")),
      el("div", {},
        el("span", { class: "suggest-label" },
          alternates.length ? "Were you asking about one of these?" : "Things I can answer"),
        suggestions.map((a) =>
          el("button", { class: "suggest-row", type: "button", onclick: () => ask.show(a.id) },
            el("span", {}, a.q[0]))))));
}

export const ask = {
  _results: null,

  /** Once an answer is on screen the starter list is noise — the answer's own
      "ask next" rows take over. Removing it (and re-rendering the results)
      destroys whatever button the user just pressed, so focus must be MOVED
      deliberately or it falls to <body> and a keyboard user restarts at the
      top of the document. The answer heading is the right landing place: it
      names what just happened without reciting the whole answer. */
  _afterAnswer() {
    document.querySelector(".ask-starters")?.remove();
    const heading = this._results?.querySelector("h2");
    if (!heading) return;
    heading.setAttribute("tabindex", "-1");
    // Scroll the SAME element we focus, and do it explicitly: focus() alone
    // was observed not to scroll at all (leaving the answer 339px above the
    // viewport), and scrolling the results wrapper instead overshot, because
    // only the heading carries the scroll-margin that clears the sticky nav.
    // scrollIntoView honours that margin and the CSS scroll-behavior, which
    // is already gated on prefers-reduced-motion and the motion toggle.
    heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
  },

  show(id) {
    const entry = retrieval.byId(id);
    if (entry && this._results) {
      renderAnswer(this._results, entry);
      this._afterAnswer();
    }
  },

  render(view) {
    const input = el("input", {
      class: "ask-input",
      type: "text",
      id: "ask-q",
      "aria-label": "Your question",
      placeholder: "e.g. Will they tell my parents?",
      autocomplete: "off",
      maxlength: "280",
    });
    safety.guard(input);

    /* deliberately NOT aria-live: an answer is a document (several paragraphs,
       citations and follow-up buttons), and a polite region would recite the
       whole thing uninterruptibly. _afterAnswer moves focus to its heading
       instead, which announces the answer and lets the reader explore it. */
    const results = el("div");
    this._results = results;

    const submit = (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      if (!safety.clear(q, input)) return; // tier 3: takeover owns the screen now
      const { entry, alternates } = retrieval.answer(q);
      if (entry) renderAnswer(results, entry);
      else renderRefusal(results, alternates);
      this._afterAnswer();
      // anonymity kept literally: the question is not stored, and we clear it
      input.value = "";
    };

    // .filter: native append() STRINGIFIES null, so a conditional child like
    // jurisdictionNote() (null in Ontario) prints a literal "null" on screen.
    // Same trap as codename.js's add(); el() filters, append() does not.
    appendKids(view,
      el("div", { class: "step-head" },
        el("p", { class: "eyebrow" }, "Level 1 · Ask"),
        el("h1", {}, "Ask anything. Decide later."),
        el("p", { class: "lead" }, "Nothing you type here is saved, sent, or seen by anyone — including us. Every answer links the real rule it comes from, so you're not taking our word for it.")),
      el("form", { class: "ask-form", onsubmit: submit },
        input,
        el("button", { class: "btn btn--primary", type: "submit" }, "Ask")),
      jurisdictionNote(),
      el("p", { class: "jurisdiction" }, "These rules are for Ontario schools. Other provinces and countries differ."),
      results,
      // the starting state does the work of the empty screen: real questions,
      // tappable, in the order a scared person actually asks them
      el("div", { class: "ask-starters" },
        el("span", { class: "suggest-label" }, "Common questions"),
        ["tell-parents", "what-must-report", "believed-proof", "taken-away", "coming-out", "drugs-alcohol", "change-mind", "records", "hypothetical", "how-to-start"]
          .map((id) => retrieval.byId(id))
          .filter(Boolean)
          .map((entry) =>
            el("button", { class: "suggest-row", type: "button", onclick: () => this.show(entry.id) },
              el("span", {}, entry.q[0])))));
  },
};
