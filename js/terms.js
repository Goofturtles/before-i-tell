/* terms.js — the terms catalog (single source of truth for student + adult copy)
   and the TELL_TERMS screen logic. Ids are append-only and never reused:
   old adult links must always render. */

import { store } from "./store.js";

export const TERMS_VERSION = 1;

export const CATALOG = [
  /* ---- locked: the law, shown honestly, non-toggleable ---- */
  {
    id: "must-report-safety",
    kind: "locked",
    student: "If I'm not safe — or another kid isn't — they'll have to involve people who can protect us.",
    why: "This one isn't a choice — Ontario law requires every school adult to report suspected abuse or serious danger. It exists to protect you.",
    adult: "You cannot promise secrecy about safety. If what you hear raises reasonable grounds to suspect abuse or neglect, Ontario law requires you to report it directly to a children's aid society — even if it was shared in confidence.",
  },
  {
    id: "no-secrecy-promise",
    kind: "locked",
    student: "They can't promise to keep everything secret — and an honest adult will say so up front.",
    why: "Any adult who promises total secrecy is making a promise the law doesn't let them keep.",
    adult: "Before they begin, tell them plainly what you would have to pass on and what stays between you. Honesty about the limits is what makes the rest of their trust possible.",
  },

  /* ---- negotiable: entirely the student's ---- */
  {
    id: "listen-first",
    kind: "negotiable",
    default: true,
    student: "Just listen first. No advice, no questions, until I'm done.",
    adult: "They asked you to listen all the way through before responding. Hold your questions and advice until they finish — even the helpful ones.",
  },
  {
    id: "tell-me-first-what-you-share",
    kind: "negotiable",
    default: true,
    student: "Before I start, tell me what you'd have to pass on.",
    adult: "They asked you to state, before they begin, exactly what kinds of things you would be required to share and with whom. Do this first, in plain words.",
  },
  {
    id: "no-parents-nonsafety",
    kind: "negotiable",
    default: false,
    student: "Don't tell my parents the parts that aren't about safety — ask me first.",
    adult: "They asked that anything not related to safety stays out of conversations with their parents unless they agree first. Ask them before any call home.",
  },
  {
    id: "no-admin-unless-required",
    kind: "negotiable",
    default: false,
    student: "Don't take this to the office or admin unless you legally have to.",
    adult: "They asked that this stays out of administrative or disciplinary channels unless the law requires it. This is a conversation, not an incident report.",
  },
  {
    id: "no-phone-taken",
    kind: "negotiable",
    default: false,
    student: "Don't let this turn into my phone getting taken away.",
    adult: "They're worried this ends with losing their phone. Unless safety truly requires it, treat their phone as theirs — it may also be their lifeline to support.",
  },
  {
    id: "write-not-talk",
    kind: "negotiable",
    default: false,
    student: "Let me show you something I wrote instead of saying it out loud.",
    adult: "They may hand you something written instead of speaking. Read it fully before you say anything. Writing it was the hard part.",
  },
  {
    id: "wait-through-silence",
    kind: "negotiable",
    default: false,
    student: "I might go quiet or cry. Wait — don't fill the silence.",
    adult: "If they go quiet or get upset, wait. Don't fill the silence or rush them. The pause is part of them telling you.",
  },
  {
    id: "no-public-checkins",
    kind: "negotiable",
    default: false,
    student: "Don't check on me in front of other people.",
    adult: "They asked that you never check in on them in front of classmates or staff. Keep every follow-up private.",
  },
  {
    id: "no-notes-while-talking",
    kind: "negotiable",
    default: false,
    student: "Don't take notes while I'm talking.",
    adult: "They asked you not to write while they speak. If notes matter afterward, tell them what you're writing down and why.",
  },
  {
    id: "check-in-day",
    kind: "negotiable",
    default: false,
    param: { name: "checkin", options: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
    student: "Check in with me privately on…",
    adult: (params) => `They asked you to check in with them privately${params?.checkin ? ` on ${params.checkin}` : ""}. Quietly, one-on-one — not in front of others.`,
  },
];

export const ADULT_ROLES = ["counsellor", "teacher", "coach", "other"];

export const terms = {
  catalog() { return CATALOG; },

  byId(id) { return CATALOG.find((t) => t.id === id) || null; },

  load() {
    const saved = store.get("terms");
    if (saved && saved.v === TERMS_VERSION) return saved;
    return {
      v: TERMS_VERSION,
      on: CATALOG.filter((t) => t.kind === "negotiable" && t.default).map((t) => t.id),
      params: {},
      name: "",
      role: "counsellor",
    };
  },

  save(selection) {
    store.set("terms", selection);
  },
};
