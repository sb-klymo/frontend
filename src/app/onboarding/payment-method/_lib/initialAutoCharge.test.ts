import { describe, expect, it } from "vitest";

import { deriveInitialAutoCharge } from "./initialAutoCharge";

describe("deriveInitialAutoCharge", () => {
  it("is true only for auto_charge", () => {
    expect(deriveInitialAutoCharge("auto_charge")).toBe(true);
  });

  it("is false for checkout_opt_in", () => {
    expect(deriveInitialAutoCharge("checkout_opt_in")).toBe(false);
  });

  it("is false for checkout_fallback (new user default)", () => {
    expect(deriveInitialAutoCharge("checkout_fallback")).toBe(false);
  });

  it("is false for an unknown value", () => {
    expect(deriveInitialAutoCharge("something_else")).toBe(false);
  });

  it("is false when the value is null or undefined (missing row / error)", () => {
    expect(deriveInitialAutoCharge(null)).toBe(false);
    expect(deriveInitialAutoCharge(undefined)).toBe(false);
  });
});
