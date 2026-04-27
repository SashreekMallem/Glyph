import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-100 bg-white/80 px-6 py-3 backdrop-blur">
        <Link href="/documents" className="font-serif text-lg tracking-tight">
          Glyph
        </Link>
        <nav className="flex gap-5 text-xs uppercase tracking-[0.18em] text-neutral-500">
          <Link href="/documents" className="hover:text-neutral-900">
            Documents
          </Link>
          <Link href="/received" className="hover:text-neutral-900">
            Received
          </Link>
          <Link href="/settings/api-keys" className="hover:text-neutral-900">
            Settings
          </Link>
          <form action="/auth/sign-out" method="post">
            <button type="submit" className="hover:text-neutral-900">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
