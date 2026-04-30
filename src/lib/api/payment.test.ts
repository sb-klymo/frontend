import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSetupIntent, PaymentApiError } from "./payment";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSetupIntent", () => {
  it("posts to the BFF route and returns the typed response on 200", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        client_secret: "seti_1_secret_xxx",
        publishable_key: "pk_test_xxx",
        setup_intent_id: "seti_1",
      }),
    });

    const result = await createSetupIntent();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/payment/setup-intent",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({
      client_secret: "seti_1_secret_xxx",
      publishable_key: "pk_test_xxx",
      setup_intent_id: "seti_1",
    });
  });

  it("throws PaymentApiError carrying the backend code on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ code: "unauthorized", message: "Not signed in" }),
    });

    await expect(createSetupIntent()).rejects.toMatchObject({
      name: "PaymentApiError",
      status: 401,
      code: "unauthorized",
      message: "Not signed in",
    });
  });

  it("falls back to a generic error when the body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });

    const promise = createSetupIntent();
    await expect(promise).rejects.toBeInstanceOf(PaymentApiError);
    await expect(promise).rejects.toMatchObject({
      status: 500,
      code: "unknown_error",
    });
  });
});
