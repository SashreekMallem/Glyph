import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = {
  title: "Create account",
  description: "Start signing your documents in under a minute.",
};

export default function SignUpPage() {
  return (
    <AuthShell
      eyebrow="Author free · Consumer pays"
      title="Create your Glyph account."
      subtitle="Stamp your first document for free. Every consumer that reads it pays Glyph — never you."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="font-medium text-neutral-900 underline-offset-4 hover:underline dark:text-neutral-50"
            >
              Sign in
            </Link>
          </span>
          <span className="text-neutral-400">
            By creating an account you agree to our{" "}
            <Link href="/terms" className="underline-offset-4 hover:underline">
              terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline-offset-4 hover:underline">
              privacy
            </Link>
            .
          </span>
        </div>
      }
    >
      <AuthForm variant="sign-up" />
    </AuthShell>
  );
}
