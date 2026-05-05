"use client";

/**
 * Shared sign-in / sign-up form.
 *
 * Variant `"sign-in"` shows email + password and a "Forgot?" link.
 * Variant `"sign-up"` adds a name field and a soft 8-char password rule.
 *
 * Built on the same shadcn primitives as the rest of the app — Input,
 * Label, Button — but with a more polished framing (focus rings tinted
 * emerald, inline error/success banners, magnetic button hover).
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type AuthVariant = "sign-in" | "sign-up";

export function AuthForm({
  variant,
  redirectTo = "/documents",
}: {
  variant: AuthVariant;
  redirectTo?: string;
}) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setPending(true);
    try {
      if (variant === "sign-in") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (err) {
          setError(err.message);
          return;
        }
        router.push(redirectTo);
        router.refresh();
      } else {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: name ? { full_name: name } : undefined,
            emailRedirectTo:
              typeof window !== "undefined"
                ? `${window.location.origin}${redirectTo}`
                : undefined,
          },
        });
        if (err) {
          setError(err.message);
          return;
        }
        setSuccess(
          "Check your inbox to confirm your email — then come back and sign in.",
        );
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {variant === "sign-up" && (
        <Field
          id="name"
          label="Full name"
          autoComplete="name"
          required
          value={name}
          onChange={setName}
        />
      )}

      <Field
        id="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
        value={email}
        onChange={setEmail}
      />

      <Field
        id="password"
        type="password"
        label="Password"
        autoComplete={variant === "sign-in" ? "current-password" : "new-password"}
        required
        minLength={8}
        value={password}
        onChange={setPassword}
        helper={
          variant === "sign-up"
            ? "8 characters minimum. We hash it; we never see it."
            : undefined
        }
      />

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
          >
            {error}
          </motion.div>
        )}
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/10 dark:text-emerald-400"
          >
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      <Button
        type="submit"
        disabled={pending}
        className="group h-11 w-full text-[14px] font-medium"
      >
        <span className="flex items-center justify-center gap-2">
          {pending ? (
            <>
              <Spinner />
              {variant === "sign-in" ? "Signing in" : "Creating account"}
            </>
          ) : (
            <>
              {variant === "sign-in" ? "Sign in" : "Create account"}
              <ArrowIcon />
            </>
          )}
        </span>
      </Button>

      <div className="flex items-center gap-3 py-2">
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        <span className="font-mono text-[0.55rem] uppercase tracking-[0.22em] text-neutral-400">
          or
        </span>
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
      </div>

      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={async () => {
          setError(null);
          const { error: err } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo:
                typeof window !== "undefined"
                  ? `${window.location.origin}${redirectTo}`
                  : undefined,
            },
          });
          if (err) setError(err.message);
        }}
        className="h-11 w-full"
      >
        <span className="flex items-center justify-center gap-2 text-[14px]">
          <GoogleIcon />
          Continue with Google
        </span>
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Field({
  id,
  label,
  type = "text",
  autoComplete,
  required,
  minLength,
  value,
  onChange,
  helper,
}: {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  value: string;
  onChange: (v: string) => void;
  helper?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-500">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 border-neutral-200 bg-white text-[15px] text-neutral-900 transition-colors focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500/20 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-50"
      />
      {helper && (
        <p className="text-[11px] text-neutral-400">{helper}</p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.36-8.6" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-transform group-hover:translate-x-0.5"
      aria-hidden
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.26c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
