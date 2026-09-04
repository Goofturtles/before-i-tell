/* app.js — app.html entry: boot, routes, HOME / CODENAME / TELL screens.
   ASK lives in ask.js. All free-text inputs are safety-guarded. */

import { store } from "./store.js";
import { $, el, clearNode, bootPage, copyText, trapFocus } from "./ui.js";
import { router } from "./router.js";
import { safety, quickExit } from "./safety.js";
import { ask } from "./ask.js";
import { terms, CATALOG, ADULT_ROLES } from "./terms.js";
import { link } from "./link.js";
import { scaffold, OPENERS, CLOSINGS, WHO_OPTIONS, NEED_OPTIONS } from "./scaffold.js";
import { codename } from "./codename.js";
import { RELAY_ENABLED } from "./config.js";

const view = $("#view");

/* ---------------- shared chrome ---------------- */

function chromeRow() {
  return el("div", { class: "btn-row btn-row--between", style: "margin-top:64px; border-top:1px solid var(--c-hairline); padding-top:24px" },
    el("button", { class: "btn btn--quiet", type: "button", onclick: quickExit },
      "Leave quickly"),
    el("button", {
      class: "btn btn--quiet", type: "button",
      onclick: () => {
        store.clearAll();
        router.go("/"); // real navigation: hash, view, and state stay in sync
      },
    }, "Delete everything I've entered"));
}

/** Thin progress bar + "step N of M" — replaces counting dots, which stop
    being readable past three steps. */
function wizard(step, total) {
  return el("div", { class: "wizard" },
    el("div", {
      class: "wizard__track", role: "progressbar",
      "aria-valuenow": String(step), "aria-valuemin": "1", "aria-valuemax": String(total),
      "aria-label": `Step ${step} of ${total}`,
    }, el("div", { class: "wizard__fill", style: `width:${(step / total) * 100}%` })),
    el("span", { class: "wizard__count" }, `Step ${step} of ${total}`));
}

/** Sticky bottom bar so the primary action is always in reach on a phone —
    the L3 forms are long enough that a page-bottom button meant scrolling. */
function actionBar(...children) {
  return el("div", { class: "action-bar" }, children);
}

/** Brief confirmation that doesn't shift layout (a growing inline message
    pushed the copy button out from under the user's finger). */
function toast(message) {
  document.querySelector(".toast")?.remove();
  const node = el("div", { class: "toast", role: "status" }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

function storageBanner() {
  if (store.available) return null;
  return el("p", { class: "decode-note" },
    "Heads up: this browser is blocking storage (private mode?), so drafts won't survive a refresh. Everything still works — it just won't remember.");
}

/* ---------------- practice mode ----------------
   A full-screen cue card for rehearsing the words out loud. Reads only what
   the student already wrote (no new input, so no safety.guard needed — the
   text passed safety.clear on the review screen that opened this). Unlike the
   takeover it closes on Escape: it's a private rehearsal, not a lock. */

function practiceOverlay(text) {
  if ($(".practice")) return; // rAF-delayed focus means the opener can re-fire
  const overlay = el("div", { class: "practice", role: "dialog", "aria-modal": "true", "aria-labelledby": "practice-title", "aria-describedby": "practice-hint practice-words", tabindex: "-1" },
    el("div", { class: "practice__panel" },
      el("p", { class: "eyebrow" }, "Practice — just you here"),
      el("h2", { id: "practice-title" }, "Try saying it out loud once."),
      el("p", { class: "practice__hint", id: "practice-hint" },
        "A whisper counts. However it comes out is right — rehearsal is how the real one gets easier."),
      el("div", { class: "practice__words", id: "practice-words" }, text),
      el("p", { class: "practice__hint" },
        "Nobody heard that but you. The version you say on the day doesn't need to be any smoother."),
      el("div", { class: "btn-row btn-row--between" },
        el("button", { class: "btn btn--primary", type: "button", onclick: close }, "Done — back to my plan"),
        el("button", { class: "btn btn--quiet", type: "button", onclick: quickExit }, "Leave quickly"))));

  // background becomes inert, same as the takeover — an SR virtual cursor
  // must not wander into content the opaque overlay hides
  let inerted = [];
  function close() {
    document.removeEventListener("keydown", onEsc, true);
    removeEventListener("popstate", close);
    inerted.forEach((n) => { n.inert = false; });
    release(); // also restores focus to the button that opened this
    overlay.remove();
    document.body.style.overflow = "";
  }
  function onEsc(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
  }
  document.addEventListener("keydown", onEsc, true);
  // back button/gesture: the route changes behind the overlay — close along
  // with it rather than stranding a dialog over a different screen
  addEventListener("popstate", close);
  document.body.append(overlay);
  inerted = [...document.body.children].filter((n) => n !== overlay);
  inerted.forEach((n) => { n.inert = true; });
  document.body.style.overflow = "hidden";
  const release = trapFocus(overlay);
}

/* ---------------- screens ---------------- */

const render = {
  home() {
    clearNode(view);
    const draft = store.get("terms");
    const words = store.get("words");
    const cn = store.get("cn");
    // "You have a draft" only when they actually changed something — the
    // default auto-save alone marks every window-shopper as having a draft
    const defaultOn = new Set(CATALOG.filter((t) => t.kind === "negotiable" && t.default).map((t) => t.id));
    const draftStarted = Boolean(draft && (
      (Array.isArray(draft.on) && (draft.on.length !== defaultOn.size || draft.on.some((id) => !defaultOn.has(id))))
      || (typeof draft.name === "string" && draft.name.trim())
      || Object.keys(draft.params || {}).length
      || words
    ));
    view.append(
      el("div", { class: "step-enter" },
        el("div", { class: "step-head" },
          el("p", { class: "eyebrow" }, "Before I Tell"),
          el("h1", {}, "Hey. Glad you're here."),
          el("p", { class: "lead" }, "Whatever brought you here, you don't have to do anything today. Three levels, your speed — and every step up is a button only you can press.")),
        storageBanner(),
        el("div", { class: "chooser" },
          el("a", { class: "chooser__card", href: "#/ask" },
            el("span", { class: "chooser__num" }, "L1"),
            el("span", { class: "chooser__body" },
              el("b", {}, "Ask"),
              el("span", {}, "Find out what happens if you tell — without telling. Nothing is saved. Costs you nothing.")),
            el("span", { class: "chooser__arrow", "aria-hidden": "true" }, "→")),
          el("a", { class: "chooser__card", href: "#/codename" },
            el("span", { class: "chooser__num" }, "L2"),
            el("span", { class: "chooser__body" },
              el("b", {}, "Codename"),
              el("span", {}, cn?.tag && cn?.codename
                ? `You're ${cn.codename}. Open your conversation — a reply may be waiting.`
                : RELAY_ENABLED
                  ? "Write to an adult at your school as a codename, not your name. They can write back. School addresses only."
                  : "Talk to your school's counsellor under a code, not your name. Preview — no relay connected here.")),
            el("span", { class: "chooser__arrow", "aria-hidden": "true" }, "→")),
          el("a", { class: "chooser__card", href: "#/tell" },
            el("span", { class: "chooser__num" }, "L3"),
            el("span", { class: "chooser__body" },
              el("b", {}, "Tell — on your terms"),
              el("span", {}, "Set the rules for the conversation, find your words, and prepare the adult before you speak.")),
            el("span", { class: "chooser__arrow", "aria-hidden": "true" }, "→"))),
        draftStarted
          ? el("div", { class: "resume-card" },
              el("span", {}, el("b", {}, "You have a draft. "), "Your terms are saved on this device."),
              el("span", { class: "spacer" }),
              el("a", { class: "btn btn--ghost", href: "#/tell/terms" }, "Continue"))
          : null,
        chromeRow()));
  },

  ask() {
    clearNode(view);
    const wrap = el("div", { class: "step-enter" });
    ask.render(wrap);
    wrap.append(chromeRow());
    view.append(wrap);
  },

  codename() {
    clearNode(view);
    const wrap = el("div", { class: "step-enter" });
    codename.render(wrap);
    wrap.append(chromeRow());
    view.append(wrap);
  },

  tellIntro() {
    clearNode(view);
    view.append(
      el("div", { class: "step-enter" },
        wizard(1, 4),
        el("div", { class: "step-head" },
          el("p", { class: "eyebrow" }, "Level 3 · Tell"),
          el("h1", {}, "The conversation happens on your terms."),
          el("p", { class: "lead" }, "You'll set the rules, find your words if you want help, and get a link that prepares the adult — before you say anything.")),
        el("div", { class: "answer-card" },
          el("div", { class: "answer-body" },
            el("p", {}, el("b", {}, "Two things can't be turned off"), " — and we show them up front, because an honest adult would too: if you're not safe, or another kid isn't, the adult has to involve people who can protect you. Everything else is yours to decide."),
            el("p", {}, el("b", {}, "What the adult receives:"), " only your requests — never what you're going to tell them. Your words stay with you; you say them out loud, in person, when you're ready."))),
        chromeRow(),
        actionBar(
          el("a", { class: "btn btn--secondary", href: "#/" }, "Back"),
          el("span", { class: "action-bar__grow" }),
          el("a", { class: "btn btn--primary", href: "#/tell/terms" }, "Set my terms"))));
  },

  tellTerms() {
    clearNode(view);
    const selection = terms.load();
    // persist immediately: accepting the defaults IS a valid selection, and
    // the forward guard checks for a saved draft (default-accept deadlock fix)
    // — including seeding params for any already-checked param terms
    CATALOG.filter((t) => t.param && selection.on.includes(t.id)).forEach((t) => {
      if (!selection.params[t.param.name]) selection.params[t.param.name] = t.param.options[0];
    });
    terms.save(selection);

    const lockedGroup = el("fieldset", { class: "terms-form terms-group" },
      el("legend", {}, "Always true — the law, shown honestly"),
      CATALOG.filter((t) => t.kind === "locked").map((t) =>
        el("div", { class: "term term--locked" },
          el("span", { class: "lock-icon", "aria-hidden": "true" }, "🔒"),
          el("div", {},
            el("span", {}, t.student),
            el("span", { class: "term__why" }, t.why),
            el("span", { class: "vh" }, "This item is fixed by Ontario law and cannot be changed.")))));

    const negotiableGroup = el("fieldset", { class: "terms-form terms-group" },
      el("legend", {}, "Yours to decide — the adult will be told"),
      CATALOG.filter((t) => t.kind === "negotiable").map((t) => {
        const checked = selection.on.includes(t.id);
        const box = el("input", {
          type: "checkbox", id: `term-${t.id}`, checked,
          onchange: (e) => {
            if (e.target.checked) {
              if (!selection.on.includes(t.id)) selection.on.push(t.id);
              // seed the param with what the select DISPLAYS — a student who
              // keeps the default day must get exactly what the UI shows
              if (t.param && !selection.params[t.param.name]) {
                selection.params[t.param.name] = paramSelect?.value || t.param.options[0];
              }
            }
            else {
              selection.on = selection.on.filter((x) => x !== t.id);
              // don't let a stale param ride along in the payload
              if (t.param) delete selection.params[t.param.name];
            }
            terms.save(selection);
            if (t.param) paramSelect.style.display = e.target.checked ? "" : "none";
          },
        });
        let paramSelect = null;
        if (t.param) {
          paramSelect = el("select", {
            "aria-label": "Which day",
            onchange: (e) => { selection.params[t.param.name] = e.target.value; terms.save(selection); },
          }, t.param.options.map((o) =>
            el("option", { value: o, selected: selection.params[t.param.name] === o }, o)));
          paramSelect.style.display = checked ? "" : "none";
        }
        // paramSelect is a SIBLING of the label — a label may only contain its
        // own labelable element, and nesting pollutes the checkbox's name
        return el("div", { class: "term" },
          box,
          el("div", { style: "flex:1" },
            el("label", { for: `term-${t.id}` }, t.student),
            paramSelect));
      }));

    view.append(
      el("div", { class: "step-enter" },
        wizard(2, 4),
        el("div", { class: "step-head" },
          el("p", { class: "eyebrow" }, "Level 3 · Your terms"),
          el("h1", {}, "Set the rules."),
          el("p", { class: "lead" }, "Nobody has ever laid this out for you, so here it is: what's fixed, and what's completely yours."),
          el("p", { class: "caption", style: "margin-top:12px" }, "Tick everything you want. Nothing is required — and you can change any of it later.")),
        storageBanner(),
        lockedGroup,
        negotiableGroup,
        chromeRow(),
        actionBar(
          el("a", { class: "btn btn--secondary", href: "#/tell" }, "Back"),
          el("a", { class: "btn btn--ghost", href: "#/tell/review" }, "Skip words"),
          el("span", { class: "action-bar__grow" }),
          el("a", { class: "btn btn--primary", href: "#/tell/words" }, "Next: my words"))));
  },

  tellWords() {
    clearNode(view);
    const values = scaffold.load();
    const selection = terms.load();
    // visiting the words screen at all means the card should appear at review —
    // a card built purely from the dropdown lines is the whole point for
    // someone who doesn't have their own words yet
    values.touched = true;
    scaffold.save(values);

    const openerCustom = el("input", {
      type: "text", id: "slot-opener-custom", maxlength: "140",
      placeholder: "…or write your own opener",
      value: values.openerCustom || "",
      oninput: (e) => { values.openerCustom = e.target.value; scaffold.save(values); },
    });
    safety.guard(openerCustom);

    const topicHint = el("input", {
      type: "text", id: "slot-topic", maxlength: "80",
      placeholder: "school stress · my family · something that happened…",
      value: values.topicHint || "",
      oninput: (e) => { values.topicHint = e.target.value; scaffold.save(values); },
    });
    safety.guard(topicHint);

    const theThing = el("textarea", {
      id: "slot-thing", maxlength: "1200",
      placeholder: "In your own words. However it comes out is right.",
      oninput: (e) => { values.theThing = e.target.value; scaffold.save(values); },
    }, values.theThing || "");
    safety.guard(theThing);

    view.append(
      el("div", { class: "step-enter" },
        wizard(3, 4),
        el("div", { class: "step-head" },
          el("p", { class: "eyebrow" }, "Level 3 · Your words — optional"),
          el("h1", {}, "Find the first sentence."),
          el("p", { class: "lead" }, "This builds a card you can read from — or hand over. It uses only your words. Nothing here goes into the adult's link, and you can skip it entirely.")),
        el("div", { class: "slot" },
          el("label", { for: "slot-who" }, "I'm telling"),
          el("select", {
            id: "slot-who",
            onchange: (e) => { values.who = e.target.value; scaffold.save(values); },
          }, WHO_OPTIONS.map((w) => el("option", { value: w, selected: values.who === w }, w)))),
        el("div", { class: "slot" },
          el("label", { for: "slot-opener" }, "Opening line"),
          el("select", {
            id: "slot-opener",
            onchange: (e) => { values.opener = e.target.value; scaffold.save(values); },
          }, OPENERS.map((o) => el("option", { value: o, selected: values.opener === o }, o))),
          openerCustom),
        el("div", { class: "slot" },
          el("label", { for: "slot-topic" }, "It's about ", el("span", { class: "hint" }, "(optional, rough is fine)")),
          topicHint),
        el("div", { class: "slot" },
          el("label", { for: "slot-thing" }, "The thing itself ", el("span", { class: "hint" }, "(optional here — you can also just say it out loud on the day)")),
          theThing),
        el("div", { class: "slot" },
          el("label", { for: "slot-need" }, "What I need first"),
          el("select", {
            id: "slot-need",
            onchange: (e) => { values.need = e.target.value; scaffold.save(values); },
          }, NEED_OPTIONS.map((n) => el("option", { value: n.value, selected: values.need === n.value }, n.label)))),
        el("div", { class: "slot" },
          el("label", { for: "slot-closing" }, "Closing line"),
          el("select", {
            id: "slot-closing",
            onchange: (e) => { values.closing = e.target.value; scaffold.save(values); },
          }, CLOSINGS.map((c) => el("option", { value: c, selected: values.closing === c }, c)))),
        chromeRow(),
        actionBar(
          el("a", { class: "btn btn--secondary", href: "#/tell/terms" }, "Back"),
          el("span", { class: "action-bar__grow" }),
          el("a", { class: "btn btn--primary", href: "#/tell/review" }, "Review everything"))));
  },

  tellReview() {
    const selection = terms.load();
    const values = scaffold.load();
    const activeTerms = CATALOG.filter((t) => t.kind === "negotiable" && selection.on.includes(t.id));
    const lockedTerms = CATALOG.filter((t) => t.kind === "locked");
    const wordsText = scaffold.assemble(values, selection, CATALOG);
    const hasWords = Boolean(values.touched
      || (values.theThing || "").trim() || (values.topicHint || "").trim() || (values.openerCustom || "").trim());

    // safety check BEFORE clearing the view: if the takeover fires, the prior
    // screen stays intact behind it and after "I'm safe" (invariant: nothing
    // unchecked reaches assembly output). renderAborted tells _dismiss to
    // re-resolve the route — otherwise a direct landing on #/tell/review
    // (fresh tab, bookmark) dismisses to a BLANK page: hash says review,
    // view was never rendered.
    if (hasWords && !safety.clear([values.openerCustom, values.topicHint, values.theThing, selection.name].join(" "))) {
      safety.renderAborted = true;
      return;
    }
    clearNode(view);

    const nameInput = el("input", {
      type: "text", id: "review-name", maxlength: "12",
      placeholder: "e.g. J., or leave empty",
      value: selection.name || "",
      oninput: (e) => { selection.name = e.target.value; terms.save(selection); },
    });
    safety.guard(nameInput); // every free-text input is guarded — no exceptions

    store.set("reviewed", true);

    view.append(
      el("div", { class: "step-enter" },
        wizard(4, 4),
        el("div", { class: "step-head" },
          el("p", { class: "eyebrow" }, "Level 3 · Review"),
          el("h1", {}, "Here's your plan."),
          el("p", { class: "lead" }, "Check it. Change anything. When it's right, we'll make the adult's page.")),
        el("h2", { class: "head-sm", style: "margin-bottom:16px" }, "The adult will be asked to:"),
        el("ul", { class: "review-list" },
          activeTerms.map((t) =>
            el("li", {}, el("span", { class: "tick", "aria-hidden": "true" }, "✓"),
              el("span", {}, el("span", { class: "vh" }, "You asked: "),
                typeof t.adult === "function" ? t.adult(selection.params) : t.adult))),
          lockedTerms.map((t) =>
            el("li", {}, el("span", { class: "lock", "aria-hidden": "true" }, "🔒"),
              el("span", {}, el("span", { class: "vh" }, "Required by law: "), t.adult)))),
        hasWords
          ? el("div", {},
              el("h2", { class: "head-sm", style: "margin:32px 0 16px" }, "Your words (for you only — not in the link):"),
              el("div", { class: "words-card" }, wordsText),
              el("div", { class: "btn-row", style: "margin-top:16px" },
                el("button", {
                  class: "btn btn--secondary", type: "button",
                  onclick: () => practiceOverlay(wordsText),
                }, "Practice saying it out loud")))
          : null,
        el("div", { class: "slot", style: "margin-top:32px" },
          el("label", { for: "review-name" }, "Sign the page with ", el("span", { class: "hint" }, "(first name, initial, or nothing — your call)")),
          nameInput),
        el("div", { class: "slot" },
          el("label", { for: "review-role" }, "Who is this for?"),
          el("select", {
            id: "review-role",
            onchange: (e) => { selection.role = e.target.value; terms.save(selection); },
          }, ADULT_ROLES.map((r) => el("option", { value: r, selected: selection.role === r }, r)))),
        chromeRow(),
        actionBar(
          el("a", { class: "btn btn--secondary", href: "#/tell/words" }, "Back"),
          el("span", { class: "action-bar__grow" }),
          el("a", { class: "btn btn--primary", href: "#/tell/link" }, "Create the adult's page"))));
  },

  tellLink() {
    clearNode(view);
    const selection = terms.load();
    const fragment = link.encode(selection);
    const url = new URL("adult.html", location.href).href + fragment;

    const urlInput = el("input", { type: "text", readonly: true, value: url, "aria-label": "Link to the adult's page" });
    const confirm = el("span", { class: "copy-confirm", role: "status" });

    view.append(
      el("div", { class: "step-enter" },
        // a real completion moment: the last screen of the hardest flow in
        // the app shouldn't look identical to every step before it
        el("div", { class: "success-mark", "aria-hidden": "true" },
          el("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
                      "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round" },
            el("path", { d: "M20 6 9 17l-5-5" }))),
        el("div", { class: "step-head" },
          el("p", { class: "eyebrow" }, "Level 3 · Done"),
          el("h1", {}, "Done. That took guts."),
          el("p", { class: "lead" }, "Here's the adult's page — send it, or open it on their screen. It carries your requests and how to listen. What you're going to say stays with you.")),
        el("div", { class: "link-box" },
          urlInput,
          el("button", {
            class: "btn btn--primary", type: "button",
            onclick: async () => {
              const ok = await copyText(url, urlInput);
              confirm.textContent = ok ? "Copied." : "Press Ctrl/Cmd-C to copy.";
              toast(ok ? "Link copied." : "Select it and press Ctrl/Cmd-C.");
            },
          }, "Copy"),
          // the OS share sheet, where it exists — on a phone, copy-paste is
          // the clumsy path. No request leaves; the sheet IS the OS. The text
          // gives the student the opening line, so they don't have to write one.
          navigator.share
            ? el("button", {
                class: "btn btn--secondary", type: "button",
                onclick: () => navigator.share({
                  title: "Before I Tell — for the adult",
                  text: "Before I tell you something, please read this.",
                  url,
                }).catch(() => { /* cancelled */ }),
              }, "Share")
            : null),
        confirm,
        el("div", { class: "answer-card", style: "margin-top:24px" },
          el("div", { class: "answer-body" },
            el("p", {}, el("b", {}, "Honest fine print:"), " this link is encoded, not encrypted — anyone who has it can open it. That's why it holds your requests, never your story. Send it somewhere you trust, and remember it may sit in chat logs or browser history."),
            el("p", {}, el("b", {}, "When to send it:"), " right before you talk works best — \"Before I tell you something, please open this.\" It does the bravest part of the opening for you."))),
        chromeRow(),
        actionBar(
          el("a", { class: "btn btn--secondary", href: "#/tell/review" }, "Back"),
          el("span", { class: "action-bar__grow" }),
          el("a", { class: "btn btn--ghost", href: url, target: "_blank", rel: "noopener" }, "Preview what they'll see"))));
  },
};

/* ---------------- guards + boot ---------------- */

function guard(route) {
  const hasTerms = Boolean(store.get("terms"));
  const reviewed = Boolean(store.get("reviewed"));
  if ((route === "/tell/words" || route === "/tell/review") && !hasTerms) return "/tell/terms";
  if (route === "/tell/link" && !hasTerms) return "/tell/terms";
  if (route === "/tell/link" && !reviewed) return "/tell/review";
  return null;
}

bootPage(store);

// quota fills mid-session: show the same gentle banner blocked storage gets,
// instead of silently losing drafts
store.onWriteError = () => {
  if ($("#view .decode-note")) return;
  view.prepend(el("p", { class: "decode-note" },
    "Heads up: this browser just stopped saving (storage full?). Everything still works — it just won't remember new changes."));
};

// order matters: the router must render its first view BEFORE safety.restore
// can lock it — otherwise a refresh mid-takeover leaves a blank page behind
// the dialog, and "I'm safe — take me back" returns to nothing
router.start({
  "/": render.home,
  "/ask": render.ask,
  "/codename": render.codename,
  "/tell": render.tellIntro,
  "/tell/terms": render.tellTerms,
  "/tell/words": render.tellWords,
  "/tell/review": render.tellReview,
  "/tell/link": render.tellLink,
}, guard);

safety.restore();
