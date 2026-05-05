import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = {
  title: "Sign in",
  description: "Sign in to Glyph.",
};

export default function SignInPage() {
  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to Glyph."
      subtitle="Pick up where you left off — your documents and signed payloads are waiting."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            New here?{" "}
            <Link
              href="/sign-up"
              className="font-medium text-neutral-900 underline-offset-4 hover:underline dark:text-neutral-50"
            >
              Create an account
            </Link>
          </span>
          <Link
            href="/forgot-password"
            className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            Forgot password?
          </Link>
        </div>
      }
    >
      <AuthForm variant="sign-in" />
    </AuthShell>
  );
}
