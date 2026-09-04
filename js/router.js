/* router.js — hash router with forward guards and a lock for the safety takeover.
   Routes are functions that render into #view. Guards may redirect. */

import { store } from "./store.js";

let routeTable = {};
let guardFn = null;
let locked = false;

function normalize(hash) {
  const h = (hash || "").replace(/^#/, "");
  return h.startsWith("/") ? h : "/" + h;
}

export const router = {
  current() {
    return normalize(location.hash) || "/";
  },

  start(routes, guard) {
    routeTable = routes;
    guardFn = guard || null;
    addEventListener("hashchange", () => this._resolve());
    this._resolve();
  },

  go(route) {
    if (locked) return;
    if (this.current() === route) this._resolve();
    else location.hash = route;
  },

  /** takeover holds navigation; popstate while locked re-asserts current hash.
      lock() owns its invariant: it captures the held route itself. */
  lock() {
    locked = true;
    store.session.set("heldRoute", this.current());
  },
  unlock() { locked = false; },
  get locked() { return locked; },

  _resolve() {
    let route = this.current();

    if (locked) {
      // takeover active: re-assert the stored route so back/forward can't escape it
      const held = store.session.get("heldRoute");
      if (held && route !== held) {
        history.replaceState(null, "", "#" + held);
      }
      // the takeover module re-asserts its own UI; router renders nothing
      return;
    }

    if (guardFn) {
      // fixed-point: the redirect target is itself re-guarded (cap 5 hops)
      for (let hops = 0; hops < 5; hops++) {
        const redirect = guardFn(route);
        if (!redirect || redirect === route) break;
        route = redirect;
      }
      if (route !== this.current()) history.replaceState(null, "", "#" + route);
    }

    // unknown routes render home AND normalize the hash (no garbage persisted)
    if (!routeTable[route]) {
      route = "/";
      history.replaceState(null, "", "#/");
    }

    // deliberately NOT persisted: a route trail in localStorage would be a
    // write-only privacy footprint on a shared device
    const handler = routeTable[route];
    handler(route);

    // a11y: move focus to the step heading on route CHANGES — not on the
    // initial page load, where stealing focus would bypass the skip link
    if (this._booted) {
      // a timer, not requestAnimationFrame: rAF doesn't fire while the tab
      // isn't compositing, and a dropped focus move leaves a keyboard user
      // stranded at the top of the document after every route change
      setTimeout(() => {
        const heading = document.querySelector("#view h1");
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus({ preventScroll: false });
        }
      });
    }
    this._booted = true;
  },
};
