/* scaffold.js — the words scaffold. Structural honesty: assembly is a pure
   string join of the student's own words and fixed template strings.
   There is no generation step, so the app cannot invent facts.
   Output lives in bit:words and is NEVER part of the adult link. */

import { store } from "./store.js";

export const OPENERS = [
  "There's something I've been wanting to tell you.",
  "This is hard for me to say, so I wrote it down first.",
  "I need to talk to you about something. I'm nervous about it.",
];

export const CLOSINGS = [
  "Thanks for listening.",
  "I don't need you to fix it today. I just needed you to know.",
  "Can we figure out what happens next together?",
];

export const WHO_OPTIONS = ["my counsellor", "a teacher I trust", "another adult at school"];

export const NEED_OPTIONS = [
  { value: "listen", label: "Just listen for now" },
  { value: "advice", label: "Help me figure out what to do" },
  { value: "action", label: "Help me change something concrete" },
];

export const scaffold = {
  load() {
    const def = {
      who: WHO_OPTIONS[0],
      opener: OPENERS[0],
      openerCustom: "",
      topicHint: "",
      theThing: "",
      need: "listen",
    };
    const saved = store.get("words");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return def;
    const out = { ...def, ...saved };
    // corrupt storage must not brick review/assembly: every string field a
    // consumer calls .trim() on must actually be a string. Dropdown values
    // that no longer exist (copy edits) fall back to the current defaults.
    for (const k of ["who", "opener", "openerCustom", "topicHint", "theThing", "need", "closing"]) {
      if (k in out && typeof out[k] !== "string") out[k] = typeof def[k] === "string" ? def[k] : "";
    }
    if (!WHO_OPTIONS.includes(out.who)) out.who = def.who;
    if (!OPENERS.includes(out.opener)) out.opener = def.opener;
    if (out.closing !== undefined && !CLOSINGS.includes(out.closing)) delete out.closing;
    return out;
  },

  save(values) {
    store.set("words", values);
  },

  /** pure template join — empty slots collapse, nothing is invented */
  assemble(values, selection, catalog) {
    const parts = [];

    const opener = (values.openerCustom || "").trim() || values.opener;
    if (opener) parts.push(opener);

    if ((values.topicHint || "").trim()) {
      parts.push(`It's about ${values.topicHint.trim()}.`);
    }

    if ((values.theThing || "").trim()) {
      parts.push(values.theThing.trim());
    }

    const needLabel = {
      listen: "Right now I mostly need you to listen.",
      advice: "I'd like help figuring out what to do.",
      action: "I need help changing something, not just talking about it.",
    }[values.need];
    if (needLabel) parts.push(needLabel);

    // requests come from the terms selection, rendered from catalog student copy
    const requests = (selection?.on || [])
      .map((id) => catalog.find((t) => t.id === id))
      .filter(Boolean)
      .map((t) => {
        let s = typeof t.student === "string" ? t.student : "";
        // param terms end in "on…" — fill in the chosen value ("on Thursday")
        // rather than reading a dangling ellipsis out loud
        if (t.param) {
          const v = selection?.params?.[t.param.name];
          s = v ? s.replace(/…$/, ` ${v}`) : s.replace(/\s*on…$/, "").replace(/…$/, "");
        }
        return s;
      })
      .filter(Boolean);
    if (requests.length) {
      // lowercase only the first character, and never the pronoun "I" —
      // "until i'm done" reads as sloppy in the student's own rehearsal card
      parts.push("A few things that would help me get through this: "
        + requests.map((r) => r.replace(/\.$/, "").replace(/^(?!I\b)./, (c) => c.toLowerCase())).join("; ") + ".");
    }

    const closing = values.closing || CLOSINGS[0];
    if (closing) parts.push(closing);

    return parts.join(" ");
  },
};
