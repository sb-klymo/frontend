/**
 * Unit tests for `PATCH /api/payment/preferences` BFF route.
 *
 * Verifies: 401 without a session, 500 when NEXT_PUBLIC_API_URL is unset,
 * and that a valid session forwards the PATCH to the backend with the Bearer
 * token + body verbatim, returning the upstream status/body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({ getAll: () => [], set: vi.fn() })),
}));

const mockGetSession = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getSession: mockGetSession },
  })),
}));

import { PATCH } from "./route";

function req(body: unknown) {
  return new Request("http://test/api/payment/preferences", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/payment/preferences BFF route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    process.env = { ...originalEnv, NEXT_PUBLIC_API_URL: "http://backend-test" };
    mockGetSession.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = originalEnv;
  });

  it("returns 401 when no session is available", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const response = await PATCH(req({ auto_charge: true }));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("unauthorized");
  });

  it("returns 500 when NEXT_PUBLIC_API_URL is not set", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "jwt", user: { id: "u1" } } },
    });
    delete process.env.NEXT_PUBLIC_API_URL;
    const response = await PATCH(req({ auto_charge: true }));
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("misconfigured");
  });

  it("forwards the PATCH to the backend with Bearer + body, returns upstream verbatim", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "user-jwt", user: { id: "u1" } } },
    });
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ payment_mode: "auto_charge" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await PATCH(req({ auto_charge: true }));

    expect(global.fetch).toHaveBeenCalledWith(
      "http://backend-test/payment/preferences",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          Authorization: "Bearer user-jwt",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ auto_charge: true }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).payment_mode).toBe("auto_charge");
  });
});
