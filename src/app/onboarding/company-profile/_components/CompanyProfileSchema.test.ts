import { describe, it, expect } from "vitest";
import { CompanyProfileSchema } from "./CompanyProfileSchema";

const validBase = {
  name: "Acme",
  website: null,
  industry: "technology" as const,
  team_size: "11-50" as const,
  billing_email: "bills@acme.test",
  billing_address: null,
  location: "Paris",
  timezone: "Europe/Paris",
  currency: "EUR" as const,
  approval_mode: "self_serve" as const,
  policy_cap_amount_cents: 50000,
  manager_approval_threshold_cents: null,
  employee_count: 25,
  monthly_search_token_limit: 1000,
  search_token_price: 0.01,
  search_token_currency: "USD" as const,
  block_search_when_limit_reached: false,
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
      policy_cap_amount_cents: 50000,
      manager_approval_threshold_cents: 60000,
    });
    expect(result.success).toBe(false);
  });

  it("accepts manager_approval when threshold is below cap", () => {
    const result = CompanyProfileSchema.safeParse({
      ...validBase,
      approval_mode: "manager_approval",
      policy_cap_amount_cents: 50000,
      manager_approval_threshold_cents: 20000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty company name", () => {
    const result = CompanyProfileSchema.safeParse({ ...validBase, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid industry", () => {
    const result = CompanyProfileSchema.safeParse({
      ...validBase,
      industry: "agriculture" as never,
    });
    expect(result.success).toBe(false);
  });
});
