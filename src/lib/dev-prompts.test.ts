import { describe, expect, it } from "vitest";

import {
  DEV_PROMPT_CATEGORIES,
  pickRandomPrompt,
} from "./dev-prompts";

describe("DEV_PROMPT_CATEGORIES", () => {
  it("has at least one category", () => {
    expect(DEV_PROMPT_CATEGORIES.length).toBeGreaterThan(0);
  });

  it("every category has both a FR and EN label", () => {
    for (const cat of DEV_PROMPT_CATEGORIES) {
      expect(cat.label.fr.length).toBeGreaterThan(0);
      expect(cat.label.en.length).toBeGreaterThan(0);
    }
  });

  it("every prompt has both FR and EN copy", () => {
    for (const cat of DEV_PROMPT_CATEGORIES) {
      for (const p of cat.prompts) {
        expect(p.fr.length).toBeGreaterThan(0);
        expect(p.en.length).toBeGreaterThan(0);
      }
    }
  });

  it("category keys are unique", () => {
    const keys = DEV_PROMPT_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers the canonical multi-airport disambiguation cities", () => {
    // Pin the multi-airport cities listed in PRODUCT_SPEC.md §6.
    const multi = DEV_PROMPT_CATEGORIES.find((c) => c.key === "multi-airport");
    expect(multi).toBeDefined();
    const allText = multi!.prompts
      .flatMap((p) => [p.fr, p.en])
      .join(" ")
      .toLowerCase();
    expect(allText).toContain("paris");
    // London / Tokyo / Milan all appear at least once across the catalogue
    const everything = DEV_PROMPT_CATEGORIES.flatMap((c) => c.prompts)
      .flatMap((p) => [p.fr, p.en])
      .join(" ")
      .toLowerCase();
    expect(everything).toMatch(/london|londres/);
    expect(everything).toContain("tokyo");
    expect(everything).toContain("milan");
  });

  it("includes the IATA codes used by the disambiguation flow", () => {
    const codes = DEV_PROMPT_CATEGORIES.flatMap((c) => c.prompts).flatMap(
      (p) => [p.fr, p.en],
    );
    expect(codes).toContain("CDG");
    expect(codes).toContain("ORY");
    expect(codes).toContain("BVA");
    expect(codes).toContain("JFK");
  });
});

describe("pickRandomPrompt", () => {
  it("returns a non-empty string for either language", () => {
    const fr = pickRandomPrompt(DEV_PROMPT_CATEGORIES, "fr");
    const en = pickRandomPrompt(DEV_PROMPT_CATEGORIES, "en");
    expect(fr).toBeTypeOf("string");
    expect(en).toBeTypeOf("string");
    expect(fr!.length).toBeGreaterThan(0);
    expect(en!.length).toBeGreaterThan(0);
  });

  it("returns null on an empty catalogue", () => {
    expect(pickRandomPrompt([], "fr")).toBeNull();
  });

  it("returns text that exists somewhere in the requested language", () => {
    const allFrPrompts = DEV_PROMPT_CATEGORIES.flatMap((c) => c.prompts).map(
      (p) => p.fr,
    );
    const picked = pickRandomPrompt(DEV_PROMPT_CATEGORIES, "fr");
    expect(allFrPrompts).toContain(picked);
  });
});
