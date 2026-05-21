import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/headers before importing the route, because createSupabaseServerClient
// calls cookies() from next/headers — that throws outside the Next.js runtime.
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}));

// Mock @supabase/ssr so we can control what getSession returns without
// needing real Supabase env vars. The mock is declared before the route
// import so the module factory runs first.
const mockGetSession = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getSession: mockGetSession },
  })),
}));

// Import the route AFTER the mocks are wired.
import { POST } from "./route";

// ── helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: unknown = { conversation_id: "conv-uuid-123" }): Request {
  return new Request("http://test/api/chat/resume-extras", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authedSession(token = "test-jwt") {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
  });
}

function noSession() {
  mockGetSession.mockResolvedValue({ data: { session: null } });
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("POST /api/chat/resume-extras BFF route", () => {
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

    const response = await POST(makeRequest());

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.code).toBe("unauthorized");
  });

  it("returns 500 when NEXT_PUBLIC_API_URL is not set", async () => {
    authedSession();
    delete process.env.NEXT_PUBLIC_API_URL;

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.code).toBe("misconfigured");
  });

  // ── 204 passthrough ───────────────────────────────────────────────────

  it("forwards 204 from backend as 204 (nothing to fire)", async () => {
    authedSession("tok-abc");
    vi.mocked(global.fetch).mockResolvedValue(new Response(null, { status: 204 }));

    const response = await POST(makeRequest());

    expect(response.status).toBe(204);
    // Verify the upstream call was made with correct auth + path
    expect(global.fetch).toHaveBeenCalledWith(
      "http://backend-test/chat/resume-extras",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tok-abc",
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        }),
      }),
    );
  });

  // ── error passthrough ─────────────────────────────────────────────────

  it("forwards 403 from backend with body intact", async () => {
    authedSession();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: "forbidden_conversation" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.code).toBe("forbidden_conversation");
  });

  it("forwards 500 from backend with body intact", async () => {
    authedSession();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: "internal_error", message: "boom" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("internal_error");
  });

  // ── SSE stream pipe ───────────────────────────────────────────────────

  it("pipes 200 SSE stream back with correct headers", async () => {
    authedSession();
    const ssePayload = `data: {"type":"message","delta":"Voilà..."}\n\n`;
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(ssePayload, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");

    const text = await response.text();
    expect(text).toContain("Voilà");
  });

  it("forwards the request body verbatim to the backend", async () => {
    authedSession();
    vi.mocked(global.fetch).mockResolvedValue(new Response(null, { status: 204 }));

    const bodyPayload = { conversation_id: "conv-xyz-789" };
    await POST(makeRequest(bodyPayload));

    const [, init] = vi.mocked(global.fetch).mock.calls[0]!;
    const forwardedBody = JSON.parse((init as RequestInit).body as string);
    expect(forwardedBody.conversation_id).toBe("conv-xyz-789");
  });
});
