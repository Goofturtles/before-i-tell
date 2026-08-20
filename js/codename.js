/* codename.js — Level 2: talk to a school adult under a codename.

   This is the one screen that sends anything anywhere. Rules it keeps:
     · Nothing is sent until the student presses a button that says "Send".
     · The message is safety-checked here AND on the relay. Crisis content
       never becomes an email — it becomes the takeover.
     · Only school addresses are accepted (the relay enforces it; we explain
       it here so a refusal never feels like a bug).
     · The passphrase is shown exactly once and is NOT stored unless the
       student explicitly opts in — this device may not be theirs alone. */

import { el, clearNode, copyText } from "./ui.js";
import { store } from "./store.js";
import { safety } from "./safety.js";
import { relayPost, RELAY_ENABLED } from "./config.js";

const REFUSALS = {
  personal: "That's a personal email address. Level 2 only writes to school accounts — that rule is what stops this from becoming a way to send anonymous messages to anyone. Use your counsellor's school address.",
  unknown: "That doesn't look like a school address. If your school's domain isn't recognised yet, Level 3 gets you a page you can hand the adult in person — no email needed.",
  malformed: "That doesn't look like an email address. Check it and try again.",
  blocked: "That address has asked not to receive messages from Before I Tell. Try another adult at your school, or use Level 3.",
  rate: "That's a lot of messages in a short time. Give it an hour.",
  rate_recipient: "That address has already received several messages today. Give it a day.",
  too_long: "That's longer than a first message needs to be. Trim it a bit.",
  empty: "Write something first.",
  auth: "That codename and passphrase don't match a conversation. Check for typos — the passphrase is case-sensitive.",
  delivery: "The message couldn't be delivered right now. Nothing was sent. Try again in a minute.",
  offline: "Can't reach the relay right now. Nothing was sent.",
};

let mount = null;

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

/** The relay refuses to email crisis content — correct, but a bare refusal is a
    dead end for someone who was reaching out. Raise the takeover AND leave a
    signposted fork behind it, so dismissing the dialog doesn't strand them in
    front of a Send button that will never work. */
function crisisFork(status, { raise = true } = {}) {
  // raise=false when safety.clear() already put the dialog up; and never
  // re-raise for someone who has explicitly said "I'm safe right now"
  if (raise && !safety._dismissed()) safety.takeover("first");
  clearNode(status);
  status.append(
    el("div", { class: "answer-card", style: "margin-top:16px" },
      el("div", { class: "answer-body" },
        el("p", {}, el("b", {}, "This one wasn't sent — on purpose. "),
          "It reads like you might not be safe right now, and an email can sit unread in an inbox for a day. That's the wrong speed for this."),
        el("p", {}, "The people on those numbers answer immediately, and they're anonymous too: ",
          el("a", { href: "tel:1-800-668-6868" }, "Kids Help Phone 1-800-668-6868"), " · ",
          el("a", { href: "sms:686868?body=CONNECT" }, "text CONNECT to 686868"), "."),
        el("p", {}, el("b", {}, "If that's not what you meant, "),
          "you can reword it and send again — or use ",
          el("a", { href: "#/tell" }, "Level 3"), " to set up talking in person instead."))));
}

/* ---------------- screens ---------------- */

function renderIntro() {
  const saved = state();
  clearNode(mount);
  mount.append(
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
    if (!safety.clear(message)) { crisisFork(status, { raise: false }); return; }

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    const res = await relayPost("/send", { to, message });
    sendBtn.disabled = false;
    sendBtn.textContent = "Send it";

    if (res.ok) {
      saveState({ tag: res.tag, codename: res.codename, to: res.to || to });
      renderCreated(res);
      return;
    }
    if (res.reason === "crisis") { crisisFork(status); return; }
    status.append(note(REFUSALS[res.reason] || "Something went wrong. Nothing was sent."));
  });

  mount.append(
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

  mount.append(
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
        el("p", {}, el("b", {}, "If things get heavy while you wait: "), "Kids Help Phone, ", el("a", { href: "tel:1-800-668-6868" }, "1-800-668-6868"), ", answers right now, anonymously."))),

    el("div", { class: "btn-row" },
      el("button", { class: "btn btn--primary", type: "button", onclick: () => openThread(res.tag, res.pass) }, "Open the conversation"),
      el("a", { class: "btn btn--ghost", href: "#/" }, "Done for now")));
}

function renderResume(saved) {
  clearNode(mount);
  const status = statusRegion();
  const nameInput = el("input", { type: "text", id: "cn-name", value: saved.codename || "", placeholder: "Blue Heron 41" });
  const passInput = el("input", { type: "password", id: "cn-pass", value: saved.pass || "", placeholder: "your passphrase" });
  const goBtn = el("button", { class: "btn btn--primary", type: "button" }, "Open it");

  goBtn.addEventListener("click", async () => {
    clearNode(status);
    goBtn.disabled = true;
    const res = await relayPost("/thread", {
      tag: saved.tag || undefined,
      codename: nameInput.value.trim(),
      pass: passInput.value.trim(),
    });
    goBtn.disabled = false;
    if (res.ok) {
      saveState({ tag: res.tag, codename: res.codename, to: res.to });
      renderThread(res, passInput.value.trim());
      return;
    }
    status.append(note(REFUSALS[res.reason] || "Couldn't open that conversation."));
  });

  mount.append(
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

async function openThread(tag, pass) {
  const res = await relayPost("/thread", { tag, pass });
  if (res.ok) renderThread(res, pass);
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
    if (!safety.clear(message)) { crisisFork(status, { raise: false }); return; }
    replyBtn.disabled = true;
    replyBtn.textContent = "Sending…";
    const res = await relayPost("/send", { tag: thread.tag, pass, message });
    replyBtn.disabled = false;
    replyBtn.textContent = "Send reply";
    if (res.ok) { openThread(thread.tag, pass); return; }
    if (res.reason === "crisis") { crisisFork(status); return; }
    status.append(note(REFUSALS[res.reason] || "Couldn't send that."));
  });

  const bubbles = thread.messages.map((m) =>
    el("div", { class: m.from === "adult" ? "request-card" : "words-card", style: "margin-bottom:12px" },
      el("span", { class: "ladder__level", style: "display:block;margin-bottom:6px" },
        m.from === "adult" ? "Them" : "You"),
      m.body));

  mount.append(
    el("div", { class: "step-head" },
      el("p", { class: "eyebrow" }, "Level 2 · " + thread.codename),
      el("h1", {}, thread.adultReplied ? "They wrote back." : "Waiting for a reply."),
      el("p", { class: "lead" },
        thread.adultReplied
          ? "Read it whenever you're ready. You can answer, or not."
          : "Nothing yet. Counsellors are usually teaching or in meetings — a day is normal.")),
    el("div", {}, bubbles),
    el("div", { class: "slot", style: "margin-top:24px" },
      el("label", { for: "cn-reply" }, "Your reply"),
      replyBox),
    status,
    el("div", { class: "btn-row" },
      replyBtn,
      el("button", { class: "btn btn--secondary", type: "button", onclick: () => openThread(thread.tag, pass) }, "Refresh"),
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
