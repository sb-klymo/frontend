/**
 * Phase 10b 5e — option-list footer makes booking explicit.
 *
 * Pre-fix wording (ambiguous):
 *   "Just let me know which one. Say 'option 1', 'the cheapest', or
 *    anything that helps me narrow it down."
 *
 * Post-fix wording (booking contract explicit):
 *   "Reply with 'option 1' (or 2, 3) to book it, 'the cheapest', or
 *    tell me what to tweak. I lock it in as soon as you pick."
 *
 * The 2026-05-18 user feedback flagged the old wording as ambiguous
 * about whether "option N" was a selection (preview) or a booking
 * (charge the card / mint the virtual card). Phase 10b PR #98 rewrote
 * the template to make the consequence explicit.
 *
 * The footer goes through `phrase()` for LLM rephrasing — so a strict
 * literal-string match would be too brittle. Instead this E2E asserts
 * on the SEMANTIC anchors: (a) the new "book" verb (or its FR
 * equivalent) is present, (b) the old ambiguous wording is absent.
 */

import { expect, test } from "@playwright/test";

import { signupAndOnboard } from "./_fixtures/userSetup";

test.describe("Phase 10b 5e — booking-explicit footer wording", () => {
  test.setTimeout(180_000);

  test("option-list footer contains booking verb, not 'let me know'", async ({
    page,
  }) => {
    const { input } = await signupAndOnboard(page, { prefix: "p10b-footer" });

    await input.fill("Vol Marseille → Toulouse demain, 1 passager");
    await input.press("Enter");

    // Wait for the chat option list to render (scoped via testid so we
    // don't false-positive on the dev panel sidebar's "option 1"
    // buttons in the Choix d'option quick-reply chips).
    await expect(page.getByTestId("option-list-header")).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByTestId("option-list-footer")).toBeVisible({
      timeout: 5_000,
    });

    // Positive assertion: the footer SHOULD mention booking (the new
    // explicit verb, in EN or FR post-phrase() rephrase).
    //   EN templates from phrase(): "book it", "book", "reserve", "lock"
    //   FR templates from phrase(): "réserver", "cale", "lock", "Je vous cale"
    await expect(page.getByTestId("option-list-footer")).toContainText(
      /book\s+it|book|réserv|cale|lock\s+it|je\s+vous\s+cale/i,
    );

    // Negative assertion: the pre-fix ambiguous wording must NOT appear.
    // "Just let me know which one" is the unique literal that the old
    // template emitted before phrase() rephrasing — would not appear
    // in any well-formed Phase-10b output.
    await expect(page.getByTestId("option-list-footer")).not.toContainText(
      /Just let me know which one/i,
    );
  });
});
