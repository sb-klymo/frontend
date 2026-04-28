import { describe, expect, it } from "vitest";

import { detectLanguage, strings } from "./i18n";

describe("detectLanguage", () => {
  it("returns 'en' for empty/null/undefined", () => {
    expect(detectLanguage(null)).toBe("en");
    expect(detectLanguage(undefined)).toBe("en");
    expect(detectLanguage("")).toBe("en");
  });

  it("returns 'en' for plain English", () => {
    expect(detectLanguage("I want to fly Paris to Marseille on June 1")).toBe(
      "en",
    );
    expect(detectLanguage("show me the cheapest flight")).toBe("en");
  });

  it("returns 'fr' when the text contains French diacritics", () => {
    expect(detectLanguage("je veux aller à Marseille")).toBe("fr");
    expect(detectLanguage("c'est très bien")).toBe("fr");
    expect(detectLanguage("le vol part à 8h")).toBe("fr");
  });

  it("returns 'fr' for French function words even without diacritics", () => {
    // No accented chars, but unmistakably French
    expect(detectLanguage("je veux partir de Paris pour aller a Marseille")).toBe(
      "fr",
    );
    expect(detectLanguage("nous voudrions un vol")).toBe("fr");
  });

  it("returns 'en' for ambiguous short replies (no French signals)", () => {
    expect(detectLanguage("CDG")).toBe("en");
    expect(detectLanguage("option 2")).toBe("en");
    expect(detectLanguage("yes")).toBe("en");
  });
});

describe("strings", () => {
  it("English option-list header pluralises correctly", () => {
    const t = strings("en").optionList;
    expect(t.header(1)).toBe("Here is 1 option for your trip:");
    expect(t.header(3)).toBe("Here are 3 options for your trip:");
  });

  it("French option-list header pluralises correctly", () => {
    const t = strings("fr").optionList;
    expect(t.header(1)).toBe("Voici 1 option pour votre voyage :");
    expect(t.header(3)).toBe("Voici 3 options pour votre voyage :");
  });

  it("status badges have French translations", () => {
    expect(strings("fr").optionCard.badgeApproved).toBe("✓ approuvé");
    expect(strings("fr").optionCard.badgeManagerApproval).toContain(
      "manager",
    );
    expect(strings("fr").optionCard.badgeManagerApproval).toContain("requise");
  });
});
