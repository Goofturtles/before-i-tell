/* adult.js — adult.html entry. Decodes #t= fragment, renders the briefing.
   Degrades to the complete generic briefing on any decode failure — that half
   needs no payload and is the more important half. ALL fragment-derived
   rendering goes through el()/textContent. Print strips the hash first so the
   payload never appears in the browser's printed URL header. */

import { store } from "./store.js";
import { $, el, clearNode, bootPage } from "./ui.js";
import { link } from "./link.js";
import { terms } from "./terms.js";
import { voice } from "./voice.js";

const ROLE_COPY = {
  counsellor: "a student",
  teacher: "a student",
  coach: "one of your athletes",
  other: "a young person",
};

function renderRequests(container, payload) {
  const items = payload.t
    .map((id) => terms.byId(id))
    .filter(Boolean)
    .map((t) => (typeof t.adult === "function" ? t.adult(payload.p) : t.adult));

  if (!items.length) return;

  container.append(
    el("section", { class: "brief-section" },
      el("h2", {}, payload.n ? `What ${payload.n} asked of you` : "What they asked of you"),
      el("div", { class: "request-cards" },
        items.map((text) => el("div", { class: "request-card" }, text)))));
}

function renderGeneric(container, hasPayload) {
  container.append(
    el("section", { class: "brief-section" },
      el("h2", {}, "How to receive what you're about to hear"),
      el("ol", { class: "brief-steps" },
        el("li", {}, el("span", {}, el("b", {}, "Listen all the way through first."),
          el("p", {}, "No questions, no advice, no visible alarm — even helpful interruptions tell them to stop. There will be time for all of it after."))),
        el("li", {}, el("span", {}, el("b", {}, "Believe them."),
          el("p", {}, "The single strongest predictor of whether a young person keeps seeking help is whether the first adult believed them. You can verify details later; believe first."))),
        el("li", {}, el("span", {}, el("b", {}, "Don't promise secrecy — say what you must share, before they start."),
          el("p", {}, "In Ontario, every adult must report suspected abuse or neglect of anyone under 16 directly to a children's aid society — even things told 'in confidence.' Saying this up front, plainly and kindly, is what makes the rest of their trust possible."))),
        el("li", {}, el("span", {}, el("b", {}, "Let silence happen."),
          el("p", {}, "If they go quiet or cry, wait. The pause is part of the telling."))),
        el("li", {}, el("span", {}, el("b", {}, "End with what happens next — decided together."),
          el("p", {}, "Name one concrete next step, however small, and when you'll check in. Uncertainty after disclosure is where regret grows."))))),
    el("section", { class: "brief-section" },
      el("h2", {}, "The hard case — read this before you need it"),
      el("div", { class: "hard-case" },
        el("h3", {}, "What if they ask you not to tell anyone — and it's something you must report?"),
        el("p", {}, "Honour every request you legally can, and be honest immediately about the one you can't. Something like: \"I'm going to do everything you asked. One thing I can't do is keep this part secret — the law says I have to involve people whose whole job is protecting you. I'll tell you exactly what happens next, and I'm not going anywhere.\""),
        el("p", {}, "Under Ontario's Child, Youth and Family Services Act, the duty to report is yours personally — you must call a children's aid society directly and cannot delegate it. For 16–17 year olds, reporting is permitted rather than mandatory, which gives you room to plan next steps together."),
        el("p", { class: "small" },
          "Source: Ontario College of Teachers, Professional Advisory on the Duty to Report; OACAS."))));

  if (!hasPayload) {
    container.append(
      el("section", { class: "brief-section" },
        el("p", { class: "muted" },
          "If someone sent you a link that should have shown their specific requests and you're seeing this general version instead, the link may be incomplete — ask them to re-copy it. The guidance above stands either way.")));
  }
}

function boot() {
  const container = $("#brief");
  clearNode(container);

  const result = link.decode(location.hash);

  // header
  const who = result.ok && result.payload.n ? result.payload.n : null;
  const roleWord = result.ok ? (ROLE_COPY[result.payload.r] || ROLE_COPY.other) : ROLE_COPY.other;

  const head = el("div", { class: "step-head" },
    el("p", { class: "eyebrow" }, "Before I Tell · For the adult"),
    el("h1", { class: "head-md" },
      who ? `${who} is about to tell you something hard.` : `Someone is about to tell you something hard.`),
    el("p", { class: "lead" },
      `This page was prepared by ${who ? "them" : roleWord} to help the conversation go well. It takes two minutes to read. What they have to say is not in this page — it stays theirs, until they say it.`));
  // pre-recorded narration, if generated: the pace of the voice IS part of
  // the lesson — unhurried, the way the page asks the adult to be
  voice.attach(head, "adult-briefing", "Listen to this page");
  container.append(head);

  if (result.ok === false && result.reason === "newer-version") {
    container.append(el("p", { class: "decode-note" },
      "This link was made with a newer version of Before I Tell, so the specific requests can't be shown here — the general guidance below still applies fully."));
  } else if (result.ok && result.skipped > 0) {
    container.append(el("p", { class: "decode-note" },
      "One or more requests in this link couldn't be displayed by this version — everything shown is exactly as they set it."));
  }

  if (result.ok) renderRequests(container, result.payload);
  // a valid link with zero selected terms is still a valid link — no warning.
  // The "ask them to re-copy the link" note is for links that actually BROKE
  // (malformed fragment) — a cold nav visit (no fragment at all) is a normal
  // way to arrive and must not be told their link looks damaged.
  const brokenLink = result.ok === false && result.reason === "malformed";
  renderGeneric(container, !brokenLink);

}

/* print wiring — once, outside boot (boot may re-run on hashchange).
   Strips the #t= payload so it never appears in the browser's printed header. */
function wirePrint() {
  const printBtn = $("#print-btn");
  const stripHashAndPrint = () => {
    const hash = location.hash;
    history.replaceState(null, "", location.pathname + location.search);
    // note: Safari may return from print() before the dialog closes; the hash
    // restore below is cosmetic state, not payload loss — decode already ran
    window.print();
    history.replaceState(null, "", location.pathname + location.search + hash);
  };
  if (printBtn) printBtn.addEventListener("click", stripHashAndPrint);

  let restoredHash = null;
  addEventListener("beforeprint", () => {
    if (location.hash) {
      restoredHash = location.hash;
      history.replaceState(null, "", location.pathname + location.search);
    }
  });
  addEventListener("afterprint", () => {
    if (restoredHash) {
      history.replaceState(null, "", location.pathname + location.search + restoredHash);
      restoredHash = null;
    }
  });
}

bootPage(store); // page chrome: once
boot();          // fragment-dependent content: re-runs on hashchange
wirePrint();     // print wiring: once

// a pasted-in new fragment on an already-open page must re-render, not show
// the previous link's content
addEventListener("hashchange", boot);
