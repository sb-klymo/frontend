"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type AccountType = "company" | "individual";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("individual");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const supabase = createSupabaseBrowserClient();
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { account_type: accountType },
      },
    });

    setSubmitting(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    if (data.session) {
      router.push("/chat");
      router.refresh();
    } else {
      setError("Account created. Check your email to verify your address.");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-2xl font-bold">Create an account</h1>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">I&apos;m signing up as a…</legend>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 hover:border-blue-400">
            <input
              type="radio"
              name="accountType"
              value="individual"
              checked={accountType === "individual"}
              onChange={() => setAccountType("individual")}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">Personal</span>
              <span className="block text-xs text-gray-600">
                Book your own travel independently.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 hover:border-blue-400">
            <input
              type="radio"
              name="accountType"
              value="company"
              checked={accountType === "company"}
              onChange={() => setAccountType("company")}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">Company</span>
              <span className="block text-xs text-gray-600">
                Set up your company on Klymo and invite your team.
              </span>
            </span>
          </label>
        </fieldset>

        <label className="block text-sm" htmlFor="email">
          Email
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <label className="block text-sm" htmlFor="password">
          Password
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create account"}
        </button>

        <p className="text-center text-sm text-gray-600">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
