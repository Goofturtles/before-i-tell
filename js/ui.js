/* ui.js — DOM micro-helpers: element builder, focus trap, clipboard,
   theme toggle, nav scroll state, reveal fallback.
   All rendering goes through el()/textContent — no innerHTML with dynamic data. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** el("div", {class:"x", "aria-live":"polite"}, child1, "text", ...) — text is always textContent-safe */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith("aria-")) { node.setAttribute(k, String(v)); continue; } // "false" is meaningful ARIA
    if (v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) {
      if (typeof v !== "function") throw new Error(`el(): ${k} must be a function — inline handler strings are forbidden`);
      node.addEventListener(k.slice(2), v);
    }
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/* ---------- focus trap (takeover dialog) ---------- */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(container) {
  const previouslyFocused = document.activeElement;
  // getClientRects() works for position:fixed elements (offsetParent does not)
  const visible = (n) => n.getClientRects().length > 0;

  function handleKey(e) {
    if (e.key !== "Tab") return;
    const focusables = $$(FOCUSABLE, container).filter(visible);
    if (!focusables.length) { e.preventDefault(); container.focus(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const inside = container.contains(document.activeElement);
    if (!inside) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  // if focus escapes (backdrop click → body), pull it back in
  function handleFocusIn(e) {
    if (!container.contains(e.target)) {
      const target = $$(FOCUSABLE, container).filter(visible)[0] || container;
      target.focus();
    }
  }

  // document-level: the trap holds even when focus is outside the container
  document.addEventListener("keydown", handleKey, true);
  document.addEventListener("focusin", handleFocusIn);
  const target = $(FOCUSABLE, container) || container;
  // a timer, not requestAnimationFrame: rAF doesn't fire while the tab isn't
  // compositing, and this is the only thing that moves focus INTO the tier-3
  // crisis dialog. The Tab handler would recover, but a keyboard user should
  // not have to press a key to get inside the takeover.
  setTimeout(() => target.focus(), 0);

  return () => {
    document.removeEventListener("keydown", handleKey, true);
    document.removeEventListener("focusin", handleFocusIn);
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  };
}

/* ---------- clipboard with fallback ---------- */
export async function copyText(text, sourceEl) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback: select-all in the source input so the user can Ctrl/Cmd-C
    if (sourceEl && sourceEl.select) {
      sourceEl.focus();
      sourceEl.select();
    }
    return false;
  }
}

/* ---------- theme ---------- */
export function wireThemeToggle(store) {
  // :not() matters: the motion toggle shares .theme-toggle for its chrome and
  // sits FIRST in the nav — a bare query would wire the wrong button
  const btn = $(".theme-toggle:not(.motion-toggle)");
  if (!btn) return;
  const currentTheme = () => document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const label = () =>
    btn.setAttribute("aria-label", currentTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme");
  label();
  btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
    label();
  });
}

/* ---------- motion pause (WCAG 2.2.2 stop control) ---------- */
/* html.motion-off pauses the INFINITE decor loops only (scoped whitelist in
   base.css — a blanket pause would freeze both-fill entrances at opacity 0)
   and this wiring pauses the videos. Persisted as bit:motion so the choice
   survives navigation; the pre-paint script stamps the class before paint. */
export function wireMotionToggle(store) {
  const btn = $(".motion-toggle");
  if (!btn) return;
  const root = document.documentElement;
  const apply = () => {
    const off = root.classList.contains("motion-off");
    // APG toggle pattern: the NAME stays constant, aria-pressed carries state
    // (a flipping label + aria-pressed reads as "Resume animations, pressed")
    btn.setAttribute("aria-pressed", String(off));
    $$("video").forEach((v) => {
      if (off) v.pause();
      // only resume clips this page intentionally started (marked at play())
      else if (v.dataset.motionplay) v.play().catch(() => {});
    });
  };
  apply();
  btn.addEventListener("click", () => {
    root.classList.toggle("motion-off");
    store.set("motion", root.classList.contains("motion-off") ? "off" : "on");
    apply();
  });
}

/** The crisis link must never change the hash. On the hash-routed app page a
    bare href="#crisis" resolves as an unknown route: the router rewrites to
    "#/", re-renders HOME (wiping whatever the student was in the middle of,
    including an unsent Level 2 message) and pulls focus to the top — i.e. the
    most urgent control in the product scrolled AWAY from the phone numbers.
    Jump instantly (a distressed user must not ride a smooth scroll) and move
    focus with the jump so keyboard/SR users land on the numbers. */
export function wireCrisisLink() {
  const link = $(".nav__crisis");
  const crisis = $("#crisis");
  if (!link || !crisis) return;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    crisis.setAttribute("tabindex", "-1");
    crisis.focus({ preventScroll: true });

    /* Measure the sticky chrome NOW rather than trusting a CSS offset. The
       tier-2 banner sits under the nav and its height depends on how the text
       wraps — 54px on a desktop, 133px at 375px — so no fixed scroll-margin
       covers every width, and the student who sees that banner is exactly the
       one pressing this link. At click time the real heights are knowable.

       scrollTo(x, y) rather than scrollIntoView({behavior}): the options-object
       enum throws on older engines, while this two-arg form exists everywhere.
       scroll-behavior is forced off around it because CSS smooth would
       otherwise animate the one jump that must be instant. */
    const stuck = [$(".nav"), $(".safety-banner")]
      .filter(Boolean)
      .reduce((h, n) => h + n.getBoundingClientRect().height, 0);
    const y = crisis.getBoundingClientRect().top + window.scrollY - stuck - 12;
    const root = document.documentElement;
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, Math.max(0, y));
    root.style.scrollBehavior = prev;
  });
}

/** skip links must move focus without touching the hash (a hash change would
    fire the router and dump the user back to HOME, wiping their screen) */
export function wireSkipLink() {
  const skip = $(".skip-link");
  if (!skip) return;
  skip.addEventListener("click", (e) => {
    e.preventDefault();
    const target = $(skip.getAttribute("href"));
    if (target) {
      target.setAttribute("tabindex", "-1");
      target.focus();
    }
  });
}

/* ---------- nav scrolled state ---------- */
export function wireNavScroll() {
  const nav = $(".nav");
  if (!nav) return;
  let raf = 0;
  addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      nav.classList.toggle("scrolled", scrollY > 24);
    });
  }, { passive: true });
}

/* ---------- IntersectionObserver reveal fallback ---------- */
let revealIO = null;

export function wireRevealFallback() {
  if (CSS.supports("animation-timeline: view()")) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  revealIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("in-view");
        revealIO.unobserve(e.target);
      }
    });
  }, { threshold: 0.15 });
  observeReveals(document);
}

/** call after rendering dynamic content that contains animated-entrance nodes */
export function observeReveals(root) {
  if (!revealIO) return;
  $$(".reveal, .fly-l, .fly-r, .fly-up", root).forEach((n) => revealIO.observe(n));
}

/* ---------- shared page boot (all three pages) ---------- */
/* some engines pass @supports for scroll timelines + counter-set yet fail to
   reify var() inside counter-reset — which would render a permanent "0".
   Probe the real behavior and gate the counter CSS on html.counters-ok. */
export function wireCounterProbe() {
  try {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    probe.style.setProperty("--n", "42");
    probe.style.counterReset = "n var(--n)";
    document.body.append(probe);
    const ok = getComputedStyle(probe).counterReset.includes("42");
    probe.remove();
    if (ok) document.documentElement.classList.add("counters-ok");
  } catch { /* no class → static numbers show, which is always correct */ }
}

export function bootPage(store) {
  wireThemeToggle(store);
  wireMotionToggle(store);
  wireSkipLink();
  wireCrisisLink();
  wireNavScroll();
  wireRevealFallback();
  wireCounterProbe();

  /* offline shell: after the first visit, Levels 1 and 3 run with the network
     off — the provable form of "nothing you type leaves your device". The SW
     caches only the app's own files, never anything a user enters. Private
     windows and old browsers just skip this; the site works identically.
     Registered after load: the ~30-file install burst must not compete with
     the first paint. */
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* file://, permissions: site still works online */ });
    });
  }
}
