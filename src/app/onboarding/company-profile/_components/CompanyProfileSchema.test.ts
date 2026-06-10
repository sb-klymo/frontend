import { describe, it, expect } from "vitest";
import { CompanyProfileSchema } from "./CompanyProfileSchema";

const validBase = {
  name: "Acme",
  team_size: "11-50" as const,
  billing_email: "bills@acme.test",
  location: "Paris",
  country: "France",
  currency: "EUR" as const,
  approval_mode: "self_serve" as const,
  policy_cap_amount_cents: 500,
  manager_approval_threshold_cents: null,
};

describe("CompanyProfileSchema", () => {
  it("accepts a valid self_serve payload with null threshold", () => {
    const result = CompanyProfileSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("rejects self_serve when threshold is non-null", () => {
    const result = CompanyProfileSchema.safeParse({
      ...validBase,
      approval_mode: "self_serve",
      manager_approval_threshold_cents: 10000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects manager_approval when threshold is null", () => {
    const result = CompanyProfileSchema.safeParse({
      ...validBase,
      approval_mode: "manager_approval",
      manager_approval_threshold_cents: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects manager_approval when threshold exceeds cap", () => {
    const result = CompanyProfileSchema.safeParse({
      ...validBase,
      approval_mode: "manager_approval",
      policy_cap_amount_cents: 500,
      manager_approval_threshold_cents: 600,
    });
    expect(result.success).toBe(false);
  });

  it("rejects manager_approval when threshold equals cap", () => {
    const result = CompanyProfileSchema.safeParse({
      ...validBase,
      approval_mode: "manager_approval",
      policy_cap_amount_cents: 500,
      manager_approval_threshold_cents: 500,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/strictly below/i);
    }
  });

  it("accepts manager_approval when threshold is below cap", () => {
    const result = CompanyProfileSchema.safeParse({
      ...validBase,
      approval_mode: "manager_approval",
      policy_cap_amount_cents: 500,
      manager_approval_threshold_cents: 200,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty company name", () => {
    const result = CompanyProfileSchema.safeParse({ ...validBase, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects empty country", () => {
    const result = CompanyProfileSchema.safeParse({ ...validBase, country: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a zero cap", () => {
    const result = CompanyProfileSchema.safeParse({ ...validBase, policy_cap_amount_cents: 0 });
    expect(result.success).toBe(false);
  });
});
