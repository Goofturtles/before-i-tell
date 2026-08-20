/* config.js — the ONE place the site is allowed to know about a server.

   Levels 1 and 3 never touch this file: the ask engine, the terms builder and
   the adult link are pure client-side and make zero requests, exactly as the
   landing page promises. Level 2 (codename) is the single feature that needs a
   relay, because delivering a message to a human requires a machine that can
   send mail.

   RELAY_URL empty  → Level 2 renders as an honest, clearly-labelled preview.
   RELAY_URL set    → Level 2 is live against that relay.

   Deployed relay lives in ../relay (see relay/README.md). */

const PROD_RELAY = ""; // ← paste the deployed relay origin here, e.g. https://bit-relay.onrender.com

const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

export const RELAY_URL = (isLocal ? "http://localhost:8787" : PROD_RELAY).replace(/\/$/, "");
export const RELAY_ENABLED = Boolean(RELAY_URL);

/** POST helper. Never sends anything the caller did not explicitly pass. */
export async function relayPost(path, payload, { timeoutMs = 15000 } = {}) {
  if (!RELAY_ENABLED) return { ok: false, reason: "offline" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(RELAY_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      // no cookies, no credentials — the passphrase in the body is the only auth
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    return await res.json();
  } catch {
    return { ok: false, reason: "offline" };
  } finally {
    clearTimeout(timer);
  }
}
