import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/headers before importing the route.
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}));

const mockGetSession = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getSession: mockGetSession },
  })),
}));

import { POST } from "./route";

// ── helpers ────────────────────────────────────────────────────────────────

function authedSession(token = "jwt-xyz", userId = "user-1") {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token, user: { id: userId } } },
  });
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } });
}

const samplePayload = {
  name: "Acme Inc",
  industry: "technology",
  team_size: "11-50",
  billing_email: "bills@acme.test",
  location: "Paris",
  timezone: "Europe/Paris",
  currency: "EUR",
  approval_mode: "self_serve",
  policy_cap_amount_cents: 50000,
  manager_approval_threshold_cents: null,
  employee_count: 25,
  monthly_search_token_limit: 1000,
  search_token_price: 0.01,
  search_token_currency: "USD",
  block_search_when_limit_reached: false,
};

// ── tests ──────────────────────────────────────────────────────────────────

describe("POST /api/onboarding/company-profile", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_API_URL: "http://backend.test",
      NEXT_PUBLIC_SUPABASE_URL: "http://supabase-test",
    };
    mockGetSession.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  it("returns 401 when there is no session", async () => {
    noSession();
    const req = new Request("http://localhost/api/onboarding/company-profile", {
      method: "POST",
      body: JSON.stringify(samplePayload),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("unauthorized");
  });

  it("forwards the payload to the backend with the JWT and returns the backend response", async () => {
    authedSession("jwt-xyz", "user-1");
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ org_id: "11111111-1111-1111-1111-111111111111", stripe_setup_url: "https://example/pay" }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    const req = new Request("http://localhost/api/onboarding/company-profile", {
      method: "POST",
      body: JSON.stringify(samplePayload),
    });

    const res = await POST(req);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://backend.test/onboarding/company-profile",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer jwt-xyz",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(samplePayload),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.org_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("passes through 409 already_onboarded", async () => {
    authedSession("jwt-xyz", "user-1");
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ code: "already_onboarded", message: "..." }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );

    const req = new Request("http://localhost/api/onboarding/company-profile", {
      method: "POST",
      body: JSON.stringify(samplePayload),
    });
    const res = await POST(req);

    expect(res.status).toBe(409);
  });

  it("returns 500 misconfigured when NEXT_PUBLIC_API_URL is not set", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    authedSession("jwt-xyz", "user-1");

    const req = new Request("http://localhost/api/onboarding/company-profile", {
      method: "POST",
      body: JSON.stringify(samplePayload),
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("misconfigured");
  });

  it("returns 502 upstream_error when the backend fetch throws", async () => {
    authedSession("jwt-xyz", "user-1");
    vi.mocked(global.fetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const req = new Request("http://localhost/api/onboarding/company-profile", {
      method: "POST",
      body: JSON.stringify(samplePayload),
    });

    const res = await POST(req);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("upstream_error");
  });
});
