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
 * same rule server-side-style (threshold required and strictly below cap).
 *
 * Locked fields (Plan, Billing mode, Transport/Class allowed,
 * International travel) are display-only — NOT registered with RHF
 * and NOT included in the POST body.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { CompanyProfileSchema, type CompanyProfile } from "./CompanyProfileSchema";

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
      currency: "EUR",
      approval_mode: "self_serve",
      manager_approval_threshold_cents: null,
    },
  });

  const approvalMode = watch("approval_mode");
  const currency = watch("currency");
  const moneySymbol = currency === "USD" ? "$" : "€";

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
      // The cap + threshold inputs collect MAJOR UNITS (e.g. 1000 = €1000)
      // despite the `_cents` field names; the backend (CompanyProfileRequest)
      // expects CENTS. Convert once here, at the boundary. Without this, "1000"
      // was persisted as 1000 cents (€10) and the policy engine blocked every
      // flight. Guarded by the "submits ... on 201" and "converts the
      // manager-approval threshold units to cents" tests in CompanyProfileForm.test.tsx.
      const payload = {
        ...values,
        policy_cap_amount_cents: values.policy_cap_amount_cents * 100,
        manager_approval_threshold_cents:
          values.manager_approval_threshold_cents === null
            ? null
            : values.manager_approval_threshold_cents * 100,
      };

      const res = await fetch("/api/onboarding/company-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
        <Field label="Country" error={errors.country?.message}>
          <input {...register("country")} className={INPUT_CLASS} type="text" />
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
      </Section>

      <Section title="Workspace">
        <Field label="Primary office city" error={errors.location?.message}>
          <input {...register("location")} className={INPUT_CLASS} type="text" />
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
          label={`Cap per employee per flight (${moneySymbol})`}
          error={errors.policy_cap_amount_cents?.message}
        >
          <input
            {...register("policy_cap_amount_cents", { valueAsNumber: true })}
            className={INPUT_CLASS}
            type="number"
            min={1}
          />
        </Field>
        {approvalMode === "manager_approval" && (
          <Field
            label={`Manager approval threshold (${moneySymbol})`}
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
        <LockedField label="Plan" value="Company" />
        <LockedField label="Billing mode" value="Company card" />
        <LockedField label="Transport allowed" value="Flight only" />
        <LockedField label="Class allowed" value="Economy only" />
        <LockedField label="International travel" value="Yes" />
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
      <span className="mb-1 block text-gray-700">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-gray-700">{label}</span>
      <select
        disabled
        aria-label={label}
        className={`${INPUT_CLASS} cursor-not-allowed bg-gray-100 text-gray-500`}
      >
        <option>{value}</option>
      </select>
      <span className="mt-1 block text-xs text-gray-400">Not modifiable in the MVP.</span>
    </label>
  );
}
