import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/settings/api-keys", label: "API Keys" },
  { href: "/settings/document-types", label: "Document Types" },
  { href: "/settings/account", label: "Account" },
] as const;

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 py-10 md:grid-cols-[200px_1fr]">
      <aside>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
          Settings
        </h2>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div>{children}</div>
    </div>
  );
}
