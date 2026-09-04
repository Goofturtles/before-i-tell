/* codename.js — Level 2: talk to a school adult under a codename.

   This is the one screen that sends anything anywhere. Rules it keeps:
     · No words leave this device until the student presses a button that says
       "Send". (Opening a write screen fires warmRelay() — an empty /health GET
       that wakes the free-tier relay; it carries nothing the student typed.)
     · The message is safety-checked here AND on the relay. Crisis content
       never becomes an email — it becomes the takeover.
     · Only school addresses are accepted (the relay enforces it; we explain
       it here so a refusal never feels like a bug).
     · The passphrase is shown exactly once and is NOT stored unless the
       student explicitly opts in — this device may not be theirs alone. */

import { el, clearNode, copyText } from "./ui.js";
import { store } from "./store.js";
import { safety } from "./safety.js";
import { relayPost, warmRelay, RELAY_ENABLED } from "./config.js";
import { helpInline, primaryIsAnon } from "./crisis.js";

const REFUSALS = {
  personal: "That's a personal email address. Level 2 only writes to school accounts — that rule is what stops this from becoming a way to send anonymous messages to anyone. Use your counsellor's school address.",
  unknown: "That doesn't look like a school address. If your school's domain isn't recognized yet, Level 3 gets you a page you can hand the adult in person — no email needed.",
  malformed: "That doesn't look like an email address. Check it and try again.",
  blocked: "That address has asked not to receive messages from Before I Tell. Try another adult at your school, or use Level 3.",
  rate: "A lot of messages in a short time — from this conversation, or from this network (on school or event Wi-Fi, everyone counts together). Wait a bit, or try mobile data.",
  rate_recipient: "That address has already received several messages today. Give it a day.",
  too_long: "That's longer than a first message needs to be. Trim it a bit.",
  empty: "Write something first.",
  /* The relay genuinely cannot tell these cases apart — a wrong passphrase and
     a deleted thread both fail the same lookup — so this must not pick one.
     Two earlier versions each did: the first blamed the student ("check for
     typos") for what was usually our own data loss; the second overcorrected
     and declared the conversation gone, which was false once storage moved to
     a database, and told a student who had merely mistyped to stop trying.
     It also promised "your counsellor will still recognise what it's about",
     which is not ours to promise: a new thread gets a NEW codename and the
     counsellor receives first-contact copy with no link to the old one. */
  auth: "That codename and passphrase don't open a conversation. Most often that's a typo — the passphrase is case-sensitive, so check the capitals and the dash. If you're sure it's right, we can't open it from our side either: conversations are deleted after 90 days, and we can't tell that apart from a mistyped passphrase. You can start a new one — it arrives with a new codename, so it helps to say it's you carrying on from before.",
  /* Storage is down and the relay is refusing rather than pretending. Say
     plainly that nothing was sent, because the failure happened before the
     message went anywhere. */
  storage: "Level 2 can't take a message right now — the part that saves conversations is down, so anything sent would vanish instead of reaching anyone. Nothing was sent, and nothing was lost. Try again later. If this can't wait, Level 3 needs no email at all, and a real person answers right now on ",
  delivery: "The message couldn't be delivered right now. Nothing was sent. Try again in a minute.",
  offline: "Can't reach the relay right now. Nothing was sent.",
  timeout: "The relay took too long to answer, so we can't confirm whether this sent. Wait a minute and try again — if it turns out both copies went through, a duplicate is harmless.",
  // no number in the string: refusalNote() appends the caller's own region's
  // line, so this can't hand a Canadian 1-800 to a student in Australia
  capacity: "The relay has hit its daily sending limit — nothing was sent. It resets within 24 hours. If this can't wait, Level 3 needs no email, and a real person answers right now on ",
};

let mount = null;

/** Append into the mount, dropping conditional nulls.
    The el() helper filters null children, but native append() STRINGIFIES
    them — a `cond ? null : node` argument printed a literal "null" on screen
    (it was doing exactly that on the live L2 intro, where the relay is on). */
function add(...children) {
  mount.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
}

function state() {
  return store.get("cn") || {};
}
function saveState(patch) {
  store.set("cn", { ...state(), ...patch });
}

/** The persistent live region every screen puts its feedback into.
    It must already be in the DOM and EMPTY: a region built with its children
    and then appended never fires a mutation inside a live region, so screen
    readers stay silent. Announcement comes from filling this, not from roles
    on the content. */
function statusRegion() {
  return el("div", { role: "status", "aria-live": "polite" });
}

/** plain text — announcement comes from the statusRegion() it lands in, never
    from a role here (a nested live region would double-announce) */
function note(text) {
  return el("p", { class: "decode-note" }, text);
}

/** Transient feedback clears itself. A "couldn't refresh, try again" note that
    stays on screen forever reads, minutes later, as the current state of
    things — and on this screen the current state is what a student is anxious
    about. Long enough to read twice (12s), and only for notes that describe a
    passing condition: refusals that need a decision stay put. */
function fading(node, ms = 12000) {
  setTimeout(() => {
    // don't yank text out from under someone reading it with a screen reader
    if (node.isConnected && !node.contains(document.activeElement)) node.remove();
  }, ms);
  return node;
}

/** Refusals that offer a way out render as rich notes with a real link —
    "use Level 3" as plain text is a dead end on a phone. */
function refusalNote(status, reason) {
  clearNode(status);
  if (reason === "personal" || reason === "unknown") {
    status.append(el("div", { class: "decode-note" },
      el("p", { style: "margin:0 0 8px" }, REFUSALS[reason]),
      el("p", { style: "margin:0" },
        el("a", { href: "#/tell" }, "Go to Level 3"),
        " — it prepares the conversation with no email at all.")));
    return;
  }
  // both end mid-sentence so the caller's own region supplies the line —
  // hard-coding one here would hand a Canadian 1-800 to a student in Australia
  if (reason === "capacity" || reason === "storage") {
    status.append(el("p", { class: "decode-note" }, REFUSALS[reason], helpInline(), "."));
    return;
  }
  status.append(note(REFUSALS[reason] || "Something went wrong. Nothing was sent."));
}

/* The email template, mirrored from relay/mailer.js bodyText(first) — kept in
   sync BY HAND, like the safety mirror. The preview must show the student the
   EXACT email, because "know what happens before you say it" applies to the
   send button too: informed consent includes seeing what lands in the inbox. */
function emailPreview(message) {
  const codename = "(your codename — picked when you send)";
  return `Subject: [Before I Tell] A student wants to talk — ${codename}

A student at your school is using Before I Tell — a tool that lets a young person start a conversation with a school adult under a codename instead of their name, because not knowing what happens after telling is one of the top reasons students stay silent.

They have chosen to write to you. They are identified only as "${codename}". Nobody — including the people who built this — can see who they are.

────────────────────────────────────────
${message || "(your message appears here)"}
────────────────────────────────────────

HOW TO REPLY
Just hit Reply. Your reply goes back to ${codename} inside the app — it does not reveal your email to them, and it does not reveal them to you.

IMPORTANT
· This is not a monitored crisis service, and nobody reads these messages but you. If you believe this student is in immediate danger and you cannot identify them, contact your school's admin team and Kids Help Phone (1-800-668-6868).
· We screen outgoing messages for explicit crisis language and route those students to crisis lines instead of to your inbox. That screening is pattern-based and imperfect — please do not assume a message reached you because it was judged safe. Read it as you would any disclosure.
· Your Ontario duty to report is unchanged. If what you read gives reasonable grounds to suspect abuse or neglect of someone under 16, you must contact a children's aid society directly — and you should say so plainly in your reply.

Not expecting this, or don't want messages here?
Block this address permanently: (a one-click link)

— Before I Tell · built by a student, for students`;
}

/** During a cold start the free-tier relay can take up to a minute to wake —
    without a note, "Sending…" for 30s reads as broken. */
function slowNote(status) {
  return setTimeout(() => {
    status.append(note("Still connecting — this runs on a free server that falls asleep between visitors, and waking it can take up to a minute. Your words are still right here."));
  }, 5000);
}

/** The relay refuses to email crisis content — correct, but a bare refusal is a
    dead end for someone who was reaching out. Raise the takeover AND leave a
    signposted fork behind it, so dismissing the dialog doesn't strand them in
    front of a Send button that will never work.

    @param restoreTo the composer to return focus to when the takeover is
    dismissed. On the relay-verdict path the Send button was disabled and
    re-enabled before we get here, so activeElement is already <body> —
    without this the student is dropped to the top of the page instead of back
    to the message they wrote. */
function crisisFork(status, { raise = true, fam, restoreTo } = {}) {
  // the relay's check may out-know the client's (patterns drift) — its family
  // verdict must drive the honest-note branch, or an abused student could be
  // shown the "doesn't trigger children's aid" copy
  if (fam === "self" || fam === "abuse") {
    safety._lastFams = new Set([fam]);
    const prev = store.session.get("s") || {};
    store.session.set("s", { ...prev, fam });
  }
  // raise=false when safety.clear() already put the dialog up; and never
  // re-raise for someone who has explicitly said "I'm safe right now"
  if (raise && !safety._dismissed()) safety.takeover(safety._everFired() ? "again" : "first", restoreTo);
  clearNode(status);
  status.append(
    el("div", { class: "answer-card", style: "margin-top:16px" },
      el("div", { class: "answer-body" },
        el("p", {}, el("b", {}, "This one wasn't sent — on purpose. "),
          "It reads like you might not be safe right now, and an email can sit unread in an inbox for a day. That's the wrong speed for this."),
        // "those numbers" was also wrong for an unknown country, where
        // helpInline() renders a directory rather than a number
        el("p", {}, "This answers immediately",
          primaryIsAnon() ? ", and it's anonymous too" : "", ": ", helpInline(), "."),
        el("p", {}, el("b", {}, "If that's not what you meant, "),
          "you can reword it and send again — or use ",
          el("a", { href: "#/tell" }, "Level 3"), " to set up talking in person instead."))));
}

/* ---------------- screens ---------------- */

function renderIntro() {
  const saved = state();
  clearNode(mount);
  add(
    el("div", { class: "step-head" },
      el("p", { class: "eyebrow" }, RELAY_ENABLED ? "Level 2 · Codename" : "Level 2 · Codename — preview"),
      el("h1", {}, "Talk first. Your name stays yours."),
      el("p", { class: "lead" }, "Write to an adult at your school as a codename. They can write back. They never learn who you are unless you tell them.")),

    RELAY_ENABLED ? null : note("Not connected to a relay right now, so this level is a preview. Everything below is exactly what happens when it's live."),

    el("div", { class: "answer-card" },
      el("div", { class: "answer-body" },
        el("p", {}, el("b", {}, "How it works. "), "You get a codename like ", el("b", {}, "Blue Heron 41"), " and a passphrase. Your message arrives in your counsellor's inbox signed with the codename — not your name, not your email, not your device. When they reply, their answer comes back here."),
        el("p", {}, el("b", {}, "What we can't do. "), "We only write to ", el("b", {}, "school addresses"), " — never a personal inbox. That rule is deliberate: without it this would be a tool for sending anonymous messages to anyone, and that helps nobody."),
        el("p", {}, el("b", {}, "What happens if you're in danger. "), "If what you write says you're not safe right now, it is ", el("b", {}, "not"), " sent. An unread email is the wrong answer to an emergency — you'll get people who answer immediately instead."))),

    el("div", { class: "btn-row" },
      el("button", { class: "btn btn--primary", type: "button", onclick: renderCompose }, "Write a message"),
      saved.tag
        ? el("button", { class: "btn btn--secondary", type: "button", onclick: () => renderResume(saved) }, "Open my conversation")
        : el("button", { class: "btn btn--ghost", type: "button", onclick: () => renderResume({}) }, "I already have a codename"),
      el("a", { class: "btn btn--ghost", href: "#/" }, "Back")));
}

function renderCompose() {
  warmRelay(); // overlap the free-tier cold start with the student's typing
  clearNode(mount);
  const status = statusRegion();

  const toInput = el("input", {
    type: "email", id: "cn-to", autocomplete: "off", spellcheck: "false",
    placeholder: "counsellor@yourboard.on.ca",
    value: state().to || "",
  });

  const msgInput = el("textarea", {
    id: "cn-msg", maxlength: "4000",
    placeholder: "You don't need the perfect words. \"There's something going on and I don't know how to say it\" is a complete first message.",
  });
  safety.guard(msgInput);

  // the site's whole thesis, applied to its own send button: see the exact
  // email — word for word — before deciding to send it
  // tabindex: it's a bounded scroll region — keyboard users must be able to
  // scroll the email they're being shown
  const previewBody = el("pre", { class: "mail-preview", tabindex: "0", "aria-label": "The email, exactly as it will be sent" }, emailPreview(""));
  msgInput.addEventListener("input", () => { previewBody.textContent = emailPreview(msgInput.value.trim()); });
  const previewBox = el("details", { class: "mail-details" },
    el("summary", {}, "See the exact email they'll receive"),
    el("p", { class: "small muted", style: "margin:8px 0" },
      "Word for word — it updates as you type. Nothing is sent until you press Send."),
    previewBody);

  const sendBtn = el("button", { class: "btn btn--primary btn--lg", type: "button" }, "Send it");

  sendBtn.addEventListener("click", async () => {
    clearNode(status);
    const to = toInput.value.trim();
    const message = msgInput.value.trim();
    if (!to) { status.append(note("Who is this going to? Enter your counsellor's school email.")); toInput.focus(); return; }
    if (!message) { status.append(note(REFUSALS.empty)); msgInput.focus(); return; }

    // client-side crisis check first: the takeover must fire before any request.
    // It raises the dialog itself, so we only add the explanation behind it —
    // otherwise dismissing leaves the student staring at a Send button that
    // will never work, with no idea why.
    if (!safety.clear(message, msgInput)) { crisisFork(status, { raise: false }); return; }

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    const slow = slowNote(status);
    const res = await relayPost("/send", { to, message });
    clearTimeout(slow);
    clearNode(status);
    sendBtn.disabled = false;
    sendBtn.textContent = "Send it";

    if (res.ok) {
      saveState({ tag: res.tag, codename: res.codename, to: res.to || to });
      renderCreated(res);
      return;
    }
    if (res.reason === "crisis") { crisisFork(status, { fam: res.fam, restoreTo: msgInput }); return; }
    refusalNote(status, res.reason);
  });

  add(
    el("div", { class: "step-head" },
      el("p", { class: "eyebrow" }, "Level 2 · Your first message"),
      el("h1", {}, "Say as much or as little as you want."),
      el("p", { class: "lead" }, "This goes to one person, signed with a codename you're about to be given.")),
    el("div", { class: "slot" },
      el("label", { for: "cn-to" }, "Their school email ",
        el("span", { class: "hint" }, "(school addresses only — that's on purpose)")),
      toInput),
    el("div", { class: "slot" },
      el("label", { for: "cn-msg" }, "Your message"),
      msgInput),
    previewBox,
    status,
    el("div", { class: "btn-row" },
      sendBtn,
      el("button", { class: "btn btn--secondary", type: "button", onclick: renderIntro }, "Back")));
}

function renderCreated(res) {
  clearNode(mount);
  const confirm = el("span", { class: "copy-confirm", role: "status" });
  const passBox = el("input", { type: "text", readonly: true, value: res.pass, "aria-label": "Your passphrase" });

  const remember = el("input", { type: "checkbox", id: "cn-remember" });
  remember.addEventListener("change", () => {
    // opt-in only: this device may be shared, monitored, or not theirs at all
    saveState({ pass: remember.checked ? res.pass : undefined });
  });

  add(
    el("div", { class: "step-head" },
      el("p", { class: "eyebrow" }, "Level 2 · Sent"),
      el("h1", {}, "Sent. You're ", el("span", { class: "hl-pill" }, res.codename), "."),
      el("p", { class: "lead" }, "That's the only name they'll see. Their reply comes back here.")),

    el("div", { class: "words-card" },
      el("p", { style: "margin-bottom:12px" }, el("b", {}, "Write this passphrase down somewhere only you can find it.")),
      el("div", { class: "link-box" },
        passBox,
        el("button", {
          class: "btn btn--primary", type: "button",
          onclick: async () => {
            const ok = await copyText(res.pass, passBox);
            confirm.textContent = ok ? "Copied." : "Press Ctrl/Cmd-C to copy.";
          },
        }, "Copy")),
      confirm,
      el("p", { style: "margin:12px 0 0" }, "It's shown once. With your codename it's the only way back into this conversation — and it's what stops anyone else reading it."),
      el("div", { class: "term", style: "margin-top:16px" },
        remember,
        el("div", { style: "flex:1" },
          el("label", { for: "cn-remember" }, "Remember it on this device"),
          el("span", { class: "term__why" }, "Only if this device is yours alone. Anyone who can open this browser could then read the conversation.")))),

    el("div", { class: "answer-card", style: "margin-top:24px" },
      el("div", { class: "answer-body" },
        el("p", {}, el("b", {}, "What happens now. "), "It's in their inbox. Counsellors are usually in a school building, so a reply may take a day — that's normal, not a no."),
        el("p", {}, el("b", {}, "If things get heavy while you wait: "), helpInline(),
          primaryIsAnon() ? " answers right now, anonymously." : " answers right now."))),

    el("div", { class: "btn-row" },
      el("button", {
        class: "btn btn--primary", type: "button",
        onclick: (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          b.textContent = "Opening…";
          openThread(res.tag, res.pass, (fail) => {
            // stay HERE: this screen holds the once-shown passphrase
            b.disabled = false;
            b.textContent = "Open the conversation";
            // "your passphrase above still works" is only true for a transient
            // failure. If the relay refused for a reason it named, say that.
            confirm.textContent = failText(fail,
              "Couldn't open it just now — your passphrase above still works. Try again in a minute.");
          });
        },
      }, "Open the conversation"),
      el("a", { class: "btn btn--ghost", href: "#/" }, "Done for now")));
}

function renderResume(saved) {
  warmRelay(); // overlap the free-tier cold start with passphrase entry
  clearNode(mount);
  const status = statusRegion();
  const nameInput = el("input", { type: "text", id: "cn-name", value: saved.codename || "", placeholder: "Blue Heron 41" });
  const passInput = el("input", { type: "password", id: "cn-pass", value: saved.pass || "", placeholder: "your passphrase" });
  const goBtn = el("button", { class: "btn btn--primary", type: "button" }, "Open it");

  goBtn.addEventListener("click", async () => {
    clearNode(status);
    goBtn.disabled = true;
    goBtn.textContent = "Opening…"; // .btn--primary paints over UA disabled greying
    const slow = slowNote(status);
    const typedName = nameInput.value.trim();
    const res = await relayPost("/thread", {
      // the saved tag only helps when they're opening the SAME conversation —
      // with an edited codename it would shadow the lookup and falsely fail auth
      tag: saved.tag && typedName === (saved.codename || "") ? saved.tag : undefined,
      codename: typedName,
      pass: passInput.value.trim(),
    });
    clearTimeout(slow);
    clearNode(status);
    goBtn.disabled = false;
    goBtn.textContent = "Open it";
    if (res.ok) {
      saveState({ tag: res.tag, codename: res.codename, to: res.to });
      renderThread(res, passInput.value.trim());
      focusThreadTitle();
      return;
    }
    status.append(note(REFUSALS[res.reason] || "Couldn't open that conversation."));
  });

  add(
    el("div", { class: "step-head" },
      el("p", { class: "eyebrow" }, "Level 2 · Come back"),
      el("h1", {}, "Pick up where you left off."),
      el("p", { class: "lead" }, "Your codename and passphrase open the conversation. Nothing else does.")),
    el("div", { class: "slot" },
      el("label", { for: "cn-name" }, "Codename"), nameInput),
    el("div", { class: "slot" },
      el("label", { for: "cn-pass" }, "Passphrase"), passInput),
    status,
    el("div", { class: "btn-row" },
      goBtn,
      el("button", { class: "btn btn--secondary", type: "button", onclick: renderIntro }, "Back")));
}

/** Refresh rebuilds the whole screen, so focus would fall to <body> and a new
    reply would arrive silently. Land focus on the thread heading, which now
    states the reply state. */
function focusThreadTitle() {
  // Direct, not requestAnimationFrame: renderThread has already put the
  // heading in the DOM synchronously, and rAF does not fire while the tab
  // isn't compositing — which would silently drop the focus move. On Refresh
  // that move is the ONLY way a screen-reader user learns a reply arrived.
  // No preventScroll: from the bottom of a long thread the heading is off
  // screen, and focusing without scrolling strands a sighted keyboard user.
  // .thread-title is an h1 inside .app-view, so it inherits that rule's
  // --chrome-h scroll-margin, which clears the nav (and the tier-2 banner).
  mount?.querySelector(".thread-title")?.focus();
}

/** onFail keeps the CURRENT screen alive — a failed refresh must never
    destroy the once-shown passphrase screen behind an unexplained login form */
/* REFUSALS.capacity and .storage end mid-sentence on purpose, so the caller's
   own region can supply the crisis line; they are NOT usable as bare text.
   Everything else is a complete sentence and is preferred over a generic
   "try again", which would talk past a refusal that is not transient. */
const OPEN_ENDED = new Set(["capacity", "storage"]);
function failText(fail, fallback) {
  const r = fail && fail.reason;
  return (r && REFUSALS[r] && !OPEN_ENDED.has(r)) ? REFUSALS[r] : fallback;
}

async function openThread(tag, pass, onFail) {
  const res = await relayPost("/thread", { tag, pass });
  if (res.ok) { renderThread(res, pass); focusThreadTitle(); }
  else if (onFail) onFail(res);
  else renderResume(state());
}

function renderThread(thread, pass) {
  clearNode(mount);
  const status = statusRegion();

  const replyBox = el("textarea", { id: "cn-reply", maxlength: "4000", placeholder: "Write back…" });
  safety.guard(replyBox);
  const replyBtn = el("button", { class: "btn btn--primary", type: "button" }, "Send reply");

  replyBtn.addEventListener("click", async () => {
    clearNode(status);
    const message = replyBox.value.trim();
    if (!message) { status.append(note(REFUSALS.empty)); return; }
    if (!safety.clear(message, replyBox)) { crisisFork(status, { raise: false }); return; }
    replyBtn.disabled = true;
    replyBtn.textContent = "Sending…";
    const slow = slowNote(status);
    const res = await relayPost("/send", { tag: thread.tag, pass, message });
    clearTimeout(slow);
    clearNode(status);
    if (res.ok) {
      // stay disabled until the refresh lands — the text is still in the box,
      // and a re-enabled button here is a double-send window
      openThread(thread.tag, pass, () => {
        replyBtn.disabled = false;
        replyBtn.textContent = "Send reply";
        /* NOT fading: this is a record of what happened, not a passing
           condition. The reply text is still in the box and the button is
           enabled again, so if this note disappears the student concludes it
           never sent and sends a real disclosure to their counsellor twice. */
        status.append(note("Your reply was sent — the refresh just didn't load. Press Refresh in a moment."));
      });
      return;
    }
    replyBtn.disabled = false;
    replyBtn.textContent = "Send reply";
    if (res.reason === "crisis") { crisisFork(status, { fam: res.fam, restoreTo: replyBox }); return; }
    status.append(note(REFUSALS[res.reason] || "Couldn't send that."));
  });

  /* A conversation should look like one. Position and colour carry who said
     what, so each message no longer needs a "You"/"Them" label stacked on top
     — the label survives for screen readers, which get no position cue. */
  const when = (at) => {
    const d = new Date(at);
    return at && !isNaN(d)
      ? d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "";
  };

  const bubbles = el("div", { class: "msg-list" },
    thread.messages.map((m) => {
      const mine = m.from !== "adult";
      return el("div", { class: `msg ${mine ? "msg--you" : "msg--them"}` },
        el("div", { class: "msg__bubble" },
          el("span", { class: "vh" }, mine ? "You wrote: " : "They wrote: "),
          m.body),
        el("span", { class: "msg__meta" }, when(m.at)));
    }));

  /* initials from the codename ("Quiet Willow 72" → "QW"): an avatar that
     says who you are in here without touching a real identity */
  const initials = String(thread.codename || "")
    .split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join("") || "?";

  add(
    el("div", { class: "thread-head" },
      el("span", { class: "thread-avatar", "aria-hidden": "true" }, initials),
      // a real heading: every sibling screen has one, and the route-change
      // focus target needs it. It also states the reply state up front, so a
      // screen reader learns "they replied" without hunting for the dot.
      el("div", { class: "thread-head__who" },
        el("h1", { class: "thread-title", tabindex: "-1" },
          el("span", { class: "vh" },
            thread.adultReplied ? "They replied. Conversation with " : "Waiting for a reply. Conversation with "),
          thread.codename),
        el("span", { class: "thread-status" + (thread.adultReplied ? " thread-status--replied" : "") },
          thread.adultReplied ? "They replied" : "Waiting for a reply")),
      el("button", {
        class: "btn btn--quiet", type: "button",
        onclick: () => openThread(thread.tag, pass, (fail) => {
          // "nothing was lost" is a claim about storage, so keep it for the
          // cases where it is certain — the request never reached the relay.
          const transient = !fail || fail.reason === "offline" || fail.reason === "timeout";
          status.append(fading(note(failText(fail, transient
            ? "Couldn't refresh just now. Try again in a minute — nothing was lost."
            : "Couldn't refresh just now. Try again in a minute."))));
        }),
      }, "Refresh")),

    el("p", { class: "msg-system" },
      thread.adultReplied
        ? `They know you only as ${thread.codename}. Read it whenever you're ready — you can answer, or not.`
        : `Sent. They know you only as ${thread.codename}. Counsellors are usually teaching or in meetings, so a day is normal.`),

    bubbles,

    thread.adultReplied ? null : el("p", { class: "small muted", style: "margin-bottom:24px" },
      "If a few school days pass with nothing, don't assume you were read and ignored — school email filters sometimes hold mail from senders they don't recognize, so the adult may never have seen it. ",
      el("a", { href: "#/tell" }, "Level 3"),
      " (no email at all), or a fresh message to a different adult, gets around a filter."),

    el("div", { class: "slot" },
      el("label", { for: "cn-reply" }, "Your reply"),
      replyBox),
    status,
    // send sits with the composer, the way every messaging app puts it — a
    // separate sticky bar would also land after this screen's chrome row and
    // so could never actually stick
    el("div", { class: "btn-row" },
      replyBtn,
      el("a", { class: "btn btn--ghost", href: "#/" }, "Back")));
}

/* ---------------- entry ---------------- */

export const codename = {
  render(container) {
    mount = el("div");
    container.append(mount);
    renderIntro();
  },
};
