import "@testing-library/jest-dom/vitest";

// JSDOM doesn't implement Element.scrollTo — ChatWindow's auto-scroll
// effect calls it on the messages container. Polyfill as a no-op so
// component renders don't crash in tests.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function () {};
}
