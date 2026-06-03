import { describe, expect, it } from "vitest";

import { strings } from "./i18n";

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
