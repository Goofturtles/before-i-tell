/* ask.js — the L1 "Ask" screen. Anonymous by design: questions are never
   persisted anywhere. Input passes through safety.guard/clear before
   retrieval sees it. Answers always cite; unknowns refuse honestly. */

import { el, clearNode } from "./ui.js";
import { safety } from "./safety.js";
import { retrieval } from "./retrieval.js";
import { voice } from "./voice.js";

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
      "ask next" rows take over. Also bring the answer into view: on a phone
      the results region sits below the fold. */
  _afterAnswer() {
    document.querySelector(".ask-starters")?.remove();
    this._results?.scrollIntoView({ behavior: "smooth", block: "start" });
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

    const results = el("div", { "aria-live": "polite" });
    this._results = results;

    const submit = (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      if (!safety.clear(q)) return; // tier 3: takeover owns the screen now
      const { entry, alternates } = retrieval.answer(q);
      if (entry) renderAnswer(results, entry);
      else renderRefusal(results, alternates);
      this._afterAnswer();
      // anonymity kept literally: the question is not stored, and we clear it
      input.value = "";
    };

    view.append(
      el("div", { class: "step-head" },
        el("p", { class: "eyebrow" }, "Level 1 · Ask"),
        el("h1", {}, "Ask anything. Decide later."),
        el("p", { class: "lead" }, "Nothing you type here is saved, sent, or seen by anyone — including us. Every answer links the real rule it comes from, so you're not taking our word for it.")),
      el("form", { class: "ask-form", onsubmit: submit },
        input,
        el("button", { class: "btn btn--primary", type: "submit" }, "Ask")),
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
