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

import { GET } from "./route";

// ── helpers ────────────────────────────────────────────────────────────────

function authedSession(token = "test-jwt") {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
  });
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } });
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("GET /api/me/pending-approvals BFF route", () => {
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

  // ── auth guard ────────────────────────────────────────────────────────

  it("returns 401 when no session is available", async () => {
    noSession();

    const response = await GET();

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.code).toBe("unauthorized");
  });

  it("returns 500 when NEXT_PUBLIC_API_URL is not set", async () => {
    authedSession();
    delete process.env.NEXT_PUBLIC_API_URL;

    const response = await GET();

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("misconfigured");
  });

  // ── proxy ─────────────────────────────────────────────────────────────

  it("forwards to backend /me/pending-approvals with JWT and returns body", async () => {
    authedSession("tok-pending");
    const approvalRows = [
      {
        id: "apr-1",
        conversation_id: "conv-1",
        status: "approved",
        decided_at: "2026-05-21T10:00:00Z",
      },
    ];
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify(approvalRows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://backend-test/me/pending-approvals",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer tok-pending",
        }),
      }),
    );
    const json = await response.json();
    expect(json).toHaveLength(1);
    expect(json[0].status).toBe("approved");
  });

  it("forwards non-200 backend responses as-is", async () => {
    authedSession();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("forwards empty array when backend returns no approvals", async () => {
    authedSession();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual([]);
  });
});
