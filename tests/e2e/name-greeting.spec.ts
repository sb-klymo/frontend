/**
 * Name-greeting regression suite — covers the seven nodes that can
 * produce the bot's FIRST utterance of a conversation. Pins the
 * contract introduced by `phase-5/chat-ux-polish-2` (PR #83): passing
 * `state=state` to `phrase()` in any first-utterance-eligible node
 * auto-injects `address_user_by_name_directive(state)` so a returning
 * personal-flow user is greeted by name.
 *
 * Test data setup (per spec):
 *   - Signup creates a fresh `e2e-greet-<ts>@klymo.local` account
 *   - Direct DB UPDATE sets `users.first_name='Harold'` +
 *     `users.stripe_payment_method_id='pm_e2e_test'` so the chat
 *     service treats the user as fully-onboarded (skips the
 *     onboarding routing) and seeds `graph_input["user_first_name"]`
 *     for the first turn
 *   - Each test asserts "Harold" appears in the bot's first reply
 *
 * The seven trigger phrases below each route through a different node:
 *   welcome   → "bonjour" (greeting first)
 *   ask       → "I want to go to Tokyo" (missing origin)
 *   help      → "comment ça marche ?" (Klymo identity question)
 *   search_present → "j'habite à Marseille et je veux aller à Toulouse demain"
 *   disambiguate → "je veux partir de Paris pour Marseille le 3 juin" (Paris = CDG/ORY/BVA)
 *   offtopic  → "il fait beau aujourd'hui ?"
 *   unclear   → "xkcd?#@!" (gibberish)
 *
 * Each test isolates its own user so they can run in parallel without
 * checkpoint or conversation collisions.
 */

import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

function seedUserFirstName(email: string, firstName: string): void {
  // Direct DB write via execFile (no shell interpretation) — local-dev
  // only. Email comes from a controlled `e2e-greet-*@klymo.local`
  // template so there's no untrusted-input surface, but using
  // execFileSync keeps us defensive regardless.
  const sql = `UPDATE public.users
    SET first_name = $$${firstName}$$,
        stripe_payment_method_id = 'pm_e2e_test_${Date.now()}',
        account_type = 'individual'
    WHERE id = (SELECT id FROM auth.users WHERE email = $$${email}$$);`;
  execFileSync(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      "54322",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-tA",
      "-c",
      sql,
    ],
    {
      env: { ...process.env, PGPASSWORD: "postgres" },
      stdio: "pipe",
    },
  );
}

async function signupAsHarold(page: Page, slug: string): Promise<string> {
  const email = `e2e-greet-${slug}-${Date.now()}@klymo.local`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123456");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/chat$/);

  // Seed first_name + a fake stripe_payment_method_id so the chat
  // service treats this user as fully onboarded on the next turn.
  seedUserFirstName(email, "Harold");

  // Reload so /me returns the seeded values and the chat service's
  // first-turn `aget_state` snapshot sees the seeded user.
  await page.reload();
  await expect(page).toHaveURL(/\/chat$/);
  return email;
}

async function sendAndAssertHarold(page: Page, message: string): Promise<void> {
  const input = page.getByPlaceholder(/ask about a trip/i);
  await input.fill(message);
  await input.press("Enter");

  // Bot's first reply MUST contain "Harold". The directive instructs
  // the LLM to open with a name greeting (e.g. "Bonjour Harold,..."
  // or "Hi Harold,..."), but the rephraser is non-deterministic — we
  // only pin the name token, not the full phrasing.
  //
  // Skipping the user-bubble visibility precondition because some
  // trigger phrases (e.g. "comment ça marche ?", "j'habite à
  // Marseille...") also appear as dev-panel quick-prompt buttons and
  // hit strict-mode violations. The bot-reply assertion below is the
  // load-bearing one anyway — if the user message hadn't gone
  // through, no bot reply would arrive.
  await expect(page.getByText(/Harold/).first()).toBeVisible({
    timeout: 25_000,
  });
}

test.describe("Name greeting — first utterance per node (PR #83)", () => {
  test("search_present_node greets when user opens with a flight query", async ({
    page,
  }) => {
    await signupAsHarold(page, "search-present");
    await sendAndAssertHarold(
      page,
      "j'habite à Marseille et je veux aller à Toulouse demain, aller simple",
    );
  });

  test("disambiguate_node greets on ambiguous-city first message", async ({
    page,
  }) => {
    // Paris → CDG/ORY/BVA → routes to disambiguate_node before search.
    await signupAsHarold(page, "disambiguate");
    await sendAndAssertHarold(
      page,
      "je veux partir de Paris pour aller à Marseille le 3 juin",
    );
  });

  test("welcome_node greets on plain greeting first message", async ({
    page,
  }) => {
    await signupAsHarold(page, "welcome");
    await sendAndAssertHarold(page, "bonjour");
  });

  test("ask_node greets when first message is missing required field", async ({
    page,
  }) => {
    // "Tokyo" without an origin → extract_node returns partial trip →
    // ask_node fires to request the missing origin city.
    await signupAsHarold(page, "ask");
    await sendAndAssertHarold(page, "je voudrais aller à Tokyo demain");
  });

  test("help_node greets on Klymo identity question", async ({ page }) => {
    await signupAsHarold(page, "help");
    await sendAndAssertHarold(page, "comment ça marche ?");
  });

  test("offtopic_node greets on first-turn off-topic", async ({ page }) => {
    await signupAsHarold(page, "offtopic");
    await sendAndAssertHarold(page, "il fait beau aujourd'hui ?");
  });

  test("unclear_node greets on gibberish first message", async ({ page }) => {
    await signupAsHarold(page, "unclear");
    await sendAndAssertHarold(page, "xkcd?#@!");
  });
});
