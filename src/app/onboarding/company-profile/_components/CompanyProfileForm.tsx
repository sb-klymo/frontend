"use client";

/**
 * Pro-onboarding form for company admins. Single POST to
 * /api/onboarding/company-profile; on 201 we navigate to the
 * returned stripe_setup_url (the existing /onboarding/payment-method
 * page). The backend handles all org/policy/user-link writes in
 * one transaction.
 *
 * Conditional UX: the manager-threshold field only appears when
 * approval_mode='manager_approval'. The Zod schema enforces the
 * same rule server-side-style (threshold required and <= cap).
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { CompanyProfileSchema, type CompanyProfile } from "./CompanyProfileSchema";

const INDUSTRIES = [
  ["technology", "Technology"],
  ["finance", "Finance"],
  ["retail", "Retail"],
  ["hospitality", "Hospitality"],
  ["logistics", "Logistics"],
  ["consulting", "Consulting"],
  ["other", "Other"],
] as const;

const TEAM_SIZES = ["1-10", "11-50", "51-200", "200+"] as const;
const CURRENCIES = ["EUR", "USD"] as const;

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none";

export function CompanyProfileForm() {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CompanyProfile>({
    resolver: zodResolver(CompanyProfileSchema),
    defaultValues: {
      website: null,
      billing_address: null,
      currency: "EUR",
      approval_mode: "self_serve",
      manager_approval_threshold_cents: null,
      search_token_currency: "USD",
      block_search_when_limit_reached: false,
    },
  });

  const approvalMode = watch("approval_mode");

  function onValidationError(fieldErrors: typeof errors) {
    // Surface the first field-level error in the submit-error banner so
    // the role="alert" is always present after a failed submit attempt —
    // this matches what the 422 test expects (submit → alert visible).
    const first = Object.values(fieldErrors).find(Boolean);
    const msg = (first as { message?: string } | undefined)?.message;
    setSubmitError(msg ?? "Please fix the errors above and try again.");
  }

  async function onSubmit(values: CompanyProfile) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/onboarding/company-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (res.status === 201) {
        const body = (await res.json()) as { stripe_setup_url: string };
        window.location.assign(body.stripe_setup_url);
        return;
      }

      if (res.status === 409) {
        // Already onboarded — go to chat.
        window.location.assign("/chat");
        return;
      }

      const body = await res.json().catch(() => ({}));
      setSubmitError(
        body.message ?? body.detail?.[0]?.msg ?? `Submission failed (HTTP ${res.status})`,
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, onValidationError)} className="space-y-6">
      <Section title="Company">
        <Field label="Company name" error={errors.name?.message}>
          <input {...register("name")} className={INPUT_CLASS} type="text" />
        </Field>
        <Field label="Website" error={errors.website?.message}>
          <input
            {...register("website", { setValueAs: (v) => (v === "" ? null : v) })}
            className={INPUT_CLASS}
            type="url"
            placeholder="https://acme.example"
          />
        </Field>
        <Field label="Industry" error={errors.industry?.message}>
          <select {...register("industry")} className={INPUT_CLASS}>
            <option value="">Select…</option>
            {INDUSTRIES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Team size" error={errors.team_size?.message}>
          <select {...register("team_size")} className={INPUT_CLASS}>
            <option value="">Select…</option>
            {TEAM_SIZES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Billing email" error={errors.billing_email?.message}>
          <input {...register("billing_email")} className={INPUT_CLASS} type="email" />
        </Field>
        <Field label="Billing address" error={errors.billing_address?.message}>
          <textarea
            {...register("billing_address", { setValueAs: (v) => (v === "" ? null : v) })}
            className={INPUT_CLASS}
            rows={2}
          />
        </Field>
      </Section>

      <Section title="Workspace">
        <Field label="Primary office city" error={errors.location?.message}>
          <input {...register("location")} className={INPUT_CLASS} type="text" />
        </Field>
        <Field label="Timezone" error={errors.timezone?.message}>
          <input
            {...register("timezone")}
            className={INPUT_CLASS}
            type="text"
            placeholder="Europe/Paris"
          />
        </Field>
        <Field label="Workspace currency" error={errors.currency?.message}>
          <select {...register("currency")} className={INPUT_CLASS}>
            {CURRENCIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Policy">
        <Field label="Approval mode" error={errors.approval_mode?.message}>
          <select {...register("approval_mode")} className={INPUT_CLASS}>
            <option value="self_serve">Self-serve (auto-approve under cap)</option>
            <option value="manager_approval">Manager approval above threshold</option>
          </select>
        </Field>
        <Field
          label="Cap per employee per flight"
          error={errors.policy_cap_amount_cents?.message}
        >
          <input
            {...register("policy_cap_amount_cents", { valueAsNumber: true })}
            className={INPUT_CLASS}
            type="number"
            min={0}
          />
        </Field>
        {approvalMode === "manager_approval" && (
          <Field
            label="Manager approval threshold"
            error={errors.manager_approval_threshold_cents?.message}
          >
            <input
              {...register("manager_approval_threshold_cents", {
                setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
              })}
              className={INPUT_CLASS}
              type="number"
              min={0}
            />
          </Field>
        )}
      </Section>

      <Section title="Plan">
        <Field label="Employee count" error={errors.employee_count?.message}>
          <input
            {...register("employee_count", { valueAsNumber: true })}
            className={INPUT_CLASS}
            type="number"
            min={0}
          />
        </Field>
        <Field
          label="Monthly search token limit"
          error={errors.monthly_search_token_limit?.message}
        >
          <input
            {...register("monthly_search_token_limit", { valueAsNumber: true })}
            className={INPUT_CLASS}
            type="number"
            min={0}
          />
        </Field>
        <Field label="Search token price" error={errors.search_token_price?.message}>
          <input
            {...register("search_token_price", { valueAsNumber: true })}
            className={INPUT_CLASS}
            type="number"
            step="0.001"
            min={0}
          />
        </Field>
        <Field label="Search token currency" error={errors.search_token_currency?.message}>
          <select {...register("search_token_currency")} className={INPUT_CLASS}>
            {CURRENCIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input {...register("block_search_when_limit_reached")} type="checkbox" />
          Block search when limit reached
        </label>
      </Section>

      {submitError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create company"}
      </button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="block mb-1 text-gray-700">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}
