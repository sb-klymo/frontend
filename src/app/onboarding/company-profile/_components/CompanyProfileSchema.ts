import { z } from "zod";

const TeamSize = z.enum(["1-10", "11-50", "51-200", "200+"]);
const WorkspaceCurrency = z.enum(["EUR", "USD"]);
const ApprovalMode = z.enum(["self_serve", "manager_approval"]);

export const CompanyProfileSchema = z
  .object({
    name: z.string().min(1).max(200),
    team_size: TeamSize,
    // Stricter than backend (which accepts any string up to 200 chars).
    // Frontend enforces RFC-format on this field as a pre-submit UX guard.
    billing_email: z.string().email().max(200),
    location: z.string().min(1).max(200),
    country: z.string().min(1).max(100),
    currency: WorkspaceCurrency,
    approval_mode: ApprovalMode,
    policy_cap_amount_cents: z.number().int().nonnegative(),
    manager_approval_threshold_cents: z.number().int().nonnegative().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.approval_mode === "manager_approval") {
      if (data.manager_approval_threshold_cents === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manager_approval_threshold_cents"],
          message: "Required when approval_mode is manager_approval",
        });
      } else if (
        data.manager_approval_threshold_cents > data.policy_cap_amount_cents
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manager_approval_threshold_cents"],
          message: "Must be less than or equal to the policy cap",
        });
      }
    } else if (data.manager_approval_threshold_cents !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manager_approval_threshold_cents"],
        message: "Must be null when approval_mode is self_serve",
      });
    }
  });

export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;
