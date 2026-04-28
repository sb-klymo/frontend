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

  it("returns 'fr' for time/article/day/month words (regression for live bug)", () => {
    // "Milan → Marseille la semaine prochaine" had no diacritic and no
    // word from the original list. Expanded to cover French-only time,
    // modifier, day, and month words.
    expect(detectLanguage("Milan → Marseille la semaine prochaine")).toBe("fr");
    expect(detectLanguage("vol Lyon Nice du 5 mai au 10 juin")).toBe("fr");
    expect(detectLanguage("lundi prochain matin")).toBe("fr");
    expect(detectLanguage("le mois prochain")).toBe("fr");
    expect(detectLanguage("samedi soir")).toBe("fr");
  });

  it("does not misclassify ordinary English as French after expansion", () => {
    expect(detectLanguage("flight to New York next week")).toBe("en");
    expect(detectLanguage("I want a morning flight")).toBe("en");
    // "mars" excluded from the list precisely so this stays English.
    expect(detectLanguage("a one-way ticket to Mars please")).toBe("en");
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
