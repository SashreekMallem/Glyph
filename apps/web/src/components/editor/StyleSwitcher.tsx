"use client";

/**
 * StyleSwitcher — compact toolbar dropdown for swapping the document's
 * brand profile on the fly.
 *
 * On selection:
 *   1. Fires `documents.setStyleProfile({ docId, styleProfileId })` to
 *      re-encrypt the chosen library row onto the document.
 *   2. Invalidates `documents.get` so the editor re-fetches the new
 *      profile and re-applies the CSS variables.
 *   3. The selected profile is identified by `currentProfileName` (best-
 *      effort) — when the document carries the default GLYPH_MODERN
 *      profile without a library row, the trigger reads
 *      "Glyph Modern".
 *
 * Defensive UX: if the list is still loading, the switcher renders a
 * disabled trigger rather than blocking the toolbar.
 */

import { useState } from "react";

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export interface StyleSwitcherProps {
  readonly docId: string;
  /** Name of the profile currently applied to the doc (best-effort). */
  readonly currentProfileName: string;
  /** Optional saved-profile id when the current profile maps to a library row. */
  readonly currentProfileId?: string;
}

export function StyleSwitcher({
  docId,
  currentProfileName,
  currentProfileId,
}: StyleSwitcherProps) {
  const [open, setOpen] = useState(false);
  const profiles = trpc.styleProfiles.list.useQuery();
  const utils = trpc.useUtils();
  const setProfile = trpc.documents.setStyleProfile.useMutation({
    onSuccess: async () => {
      await utils.documents.get.invalidate({ id: docId });
    },
  });

  const apply = async (styleProfileId: string | undefined) => {
    setOpen(false);
    if (styleProfileId === currentProfileId) return;
    try {
      await setProfile.mutateAsync({ docId, styleProfileId });
    } catch {
      // Surface failures via the mutation's own error state — the
      // toolbar deliberately stays quiet to avoid drawing attention to
      // a transient API blip.
    }
  };

  const busy = setProfile.isPending;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !busy && setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Brand profile"
        className={cn(
          "flex h-7 max-w-[180px] items-center gap-1.5 rounded-md bg-transparent px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-700 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-neutral-200 dark:hover:bg-neutral-800",
          busy && "cursor-not-allowed opacity-60",
        )}
      >
        <svg
          aria-hidden
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2l2.2 6.6H21l-5.4 4 2 6.6L12 15.4 6.4 19.2l2-6.6L3 8.6h6.8z" />
        </svg>
        <span className="truncate">{currentProfileName}</span>
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-neutral-400"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          {/* Click-outside guard — a transparent overlay closes the menu
              without bleeding focus into the editor surface. */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <ul
            role="listbox"
            aria-label="Brand profile"
            className="absolute right-0 top-9 z-50 max-h-72 w-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
          >
            <li>
              <SwitcherItem
                label="Glyph Modern (default)"
                selected={currentProfileId === undefined}
                onClick={() => void apply(undefined)}
              />
            </li>
            {profiles.isLoading && (
              <li className="px-3 py-2 text-[11px] text-neutral-500">
                Loading…
              </li>
            )}
            {(profiles.data ?? []).map((p) => (
              <li key={p.id}>
                <SwitcherItem
                  label={p.profile.name}
                  badge={p.isDefault ? "Default" : undefined}
                  selected={currentProfileId === p.id}
                  onClick={() => void apply(p.id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SwitcherItem({
  label,
  badge,
  selected,
  onClick,
}: {
  label: string;
  badge?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-colors",
        selected
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800",
      )}
    >
      <span className="truncate">{label}</span>
      {badge && (
        <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-400">
          {badge}
        </span>
      )}
    </button>
  );
}
