/* smooth.js — Lenis-style lerp smooth scrolling, vendored (zero external
   requests). Technique: intercept wheel input, accumulate a target position,
   ease the real scroll toward it on rAF via window.scrollTo. Because the
   NATIVE scroll position stays authoritative, position:sticky pins, CSS
   scroll-driven animations, anchors, keyboard scrolling, and the scrub video
   all keep working — this only changes the feel, never the mechanics.

   Deliberately not active for: reduced-motion users, touch devices (native
   momentum is already good and fighting it feels broken), and while the
   crisis takeover holds the page. */

export function initSmoothScroll() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!matchMedia("(pointer: fine)").matches) return; // touch stays native

  // native CSS smooth-behavior would double-ease every programmatic scroll
  document.documentElement.classList.add("smooth-js");

  let target = scrollY;
  let current = scrollY;
  let expected = scrollY; // last position WE wrote — distinguishes our scrolls from external ones
  let raf = null;
  let lastT = 0;

  const maxScroll = () =>
    document.documentElement.scrollHeight - innerHeight;

  const step = (t) => {
    // if the page got locked mid-lerp (crisis takeover sets body overflow
    // hidden — a coupling: if the lock mechanism changes, change this check),
    // halt instead of scrolling behind the dialog
    if (document.body.style.overflow === "hidden") { target = current; raf = null; return; }
    const dt = Math.min(50, t - lastT || 16.7);
    lastT = t;
    // frame-rate-independent exponential ease (≈0.1/frame at 60fps)
    const alpha = 1 - Math.pow(0.0018, dt / 1000);
    current += (target - current) * alpha;
    if (Math.abs(target - current) < 0.4) {
      current = target;
      raf = null;
    } else {
      raf = requestAnimationFrame(step);
    }
    expected = current;
    scrollTo(0, current);
  };

  addEventListener("wheel", (e) => {
    if (e.ctrlKey) return;                                  // pinch-zoom
    if (document.body.style.overflow === "hidden") return;  // takeover holds the page
    e.preventDefault();
    const dy = e.deltaMode === 2 ? e.deltaY * innerHeight   // page-mode (older Firefox)
             : e.deltaMode === 1 ? e.deltaY * 16            // line-mode mice
             : e.deltaY;
    target = Math.max(0, Math.min(maxScroll(), target + dy));
    if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(step); }
  }, { passive: false });

  // External scrolls (keyboard, anchors, programmatic jumps — INCLUDING the
  // crisis link) must win over an in-flight lerp: without this, the easing
  // loop would drag a distressed user away from the crisis numbers they just
  // jumped to. Our own scrollTo differs from `expected` by <1px, so external
  // movement is unambiguous; scroll events dispatch before rAF callbacks, so
  // the cancel lands ahead of the reverting frame.
  addEventListener("scroll", () => {
    if (raf) {
      if (Math.abs(scrollY - expected) > 1) {
        cancelAnimationFrame(raf);
        raf = null;
        target = current = expected = scrollY;
      }
    } else {
      target = current = expected = scrollY;
    }
  }, { passive: true });
}
