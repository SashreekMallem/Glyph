"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeInUp } from "@/components/motion/primitives";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "sign-in" | "sign-up";

export default function SignInPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      if (mode === "sign-in") {
        const { error: err } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (err) {
          setError(err.message);
          return;
        }
        router.push("/documents");
        router.refresh();
      } else {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
        });
        if (err) {
          setError(err.message);
          return;
        }
        setMessage(
          "Check your inbox to confirm your email, then sign in.",
        );
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <FadeInUp>
        <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)]">
          <Link
            href="/"
            className="mb-6 inline-block font-serif text-xl tracking-tight text-neutral-900"
          >
            Glyph
          </Link>
          <h1 className="mb-1 font-serif text-2xl tracking-tight text-neutral-900">
            {mode === "sign-in" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mb-6 text-sm text-neutral-500">
            {mode === "sign-in"
              ? "Sign in to continue."
              : "Start structuring documents in under a minute."}
          </p>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={
                  mode === "sign-in" ? "current-password" : "new-password"
                }
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            {message && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {message}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending
                ? "…"
                : mode === "sign-in"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>
          <div className="mt-6 text-center text-xs text-neutral-500">
            {mode === "sign-in" ? (
              <>
                New to Glyph?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("sign-up");
                    setError(null);
                    setMessage(null);
                  }}
                  className="font-medium text-neutral-900 hover:underline"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("sign-in");
                    setError(null);
                    setMessage(null);
                  }}
                  className="font-medium text-neutral-900 hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </FadeInUp>
    </main>
  );
}
