/* link.js — adult-link fragment payload: encode/decode + versioning.
   The fragment carries REQUESTS, never facts: term ids, enum params,
   an optional display name (<=12 chars, rendered as text only), and an
   enum role. The disclosure itself never touches the link.
   Encoded ≈200 bytes typical; 1.5KB hard budget. Encoding, not encryption —
   the UI says so plainly and treats the link as public. */

import { CATALOG, ADULT_ROLES, TERMS_VERSION } from "./terms.js";

const MAX_FRAGMENT = 1536;
const MAX_NAME = 12;

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const KNOWN_IDS = new Set(CATALOG.map((t) => t.id));
const KNOWN_PARAMS = new Map(
  CATALOG.filter((t) => t.param).map((t) => [t.param.name, new Set(t.param.options)])
);

export const link = {
  /** selection -> "#t=<payload>" (only negotiable ids that are on; locked items are implicit) */
  encode(selection) {
    const payload = {
      v: TERMS_VERSION,
      t: (selection.on || []).filter((id) => KNOWN_IDS.has(id)),
      p: {},
      r: ADULT_ROLES.includes(selection.role) ? selection.role : "other",
    };
    for (const [name, value] of Object.entries(selection.params || {})) {
      const allowed = KNOWN_PARAMS.get(name);
      if (allowed && allowed.has(value)) payload.p[name] = value;
    }
    const name = String(selection.name || "").trim().slice(0, MAX_NAME);
    if (name) payload.n = name;

    const frag = "#t=" + b64urlEncode(JSON.stringify(payload));
    return frag.length <= MAX_FRAGMENT ? frag : "#t=" + b64urlEncode(JSON.stringify({ ...payload, n: undefined }));
  },

  /** fragment -> {ok:true, payload, skipped} | {ok:false, reason} */
  decode(fragment) {
    const frag = String(fragment || "");
    const m = frag.match(/#t=([A-Za-z0-9\-_]+)/);
    if (!m) return { ok: false, reason: "empty" };
    if (m[1].length > MAX_FRAGMENT) return { ok: false, reason: "malformed" };

    let raw;
    try {
      raw = JSON.parse(b64urlDecode(m[1]));
    } catch {
      return { ok: false, reason: "malformed" };
    }
    if (!raw || typeof raw !== "object" || typeof raw.v !== "number") {
      return { ok: false, reason: "malformed" };
    }
    if (raw.v > TERMS_VERSION) return { ok: false, reason: "newer-version" };

    // sanitize strictly: unknown ids are skipped (never fatal), params validated
    const ids = Array.isArray(raw.t) ? raw.t.filter((x) => typeof x === "string") : [];
    const known = ids.filter((id) => KNOWN_IDS.has(id));
    const skipped = ids.length - known.length;

    const params = {};
    if (raw.p && typeof raw.p === "object") {
      for (const [name, value] of Object.entries(raw.p)) {
        const allowed = KNOWN_PARAMS.get(name);
        if (allowed && allowed.has(value)) params[name] = value;
      }
    }

    return {
      ok: true,
      skipped,
      payload: {
        v: raw.v,
        t: known,
        p: params,
        n: typeof raw.n === "string" ? raw.n.slice(0, MAX_NAME) : "",
        r: ADULT_ROLES.includes(raw.r) ? raw.r : "other",
      },
    };
  },
};
