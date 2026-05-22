"use client";

/**
 * Settings → Style page.
 *
 * Lists the user's saved brand profiles as cards. Each card surfaces
 * the profile name, a default badge, and a 4-square color swatch
 * (text / accent / muted / background) so the user can scan their
 * library at a glance.
 *
 * Click any card to open the editor pre-populated. The trailing "+
 * New profile" card opens the editor with GLYPH_MODERN_PROFILE as the
 * starting point.
 *
 * Data flows via `trpc.styleProfiles.list` — RLS scopes rows to the
 * caller's user_id. No SSR pre-render: this is a settings page, the
 * caller is already authenticated by the time the route mounts.
 */

import { useState } from "react";

import {
  GLYPH_MODERN_PROFILE,
  type StyleProfile,
} from "@glyph/style-profile";

import { FadeInUp, Stagger, StaggerChild } from "@/components/motion/primitives";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StyleProfileEditor } from "@/components/style/StyleProfileEditor";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type EditorState =
  | { mode: "closed" }
  | {
      mode: "new";
    }
  | {
      mode: "edit";
      id: string;
      profile: StyleProfile;
      isDefault: boolean;
    };

export default function StyleSettingsPage() {
  const profiles = trpc.styleProfiles.list.useQuery();
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });

  const closeEditor = () => setEditor({ mode: "closed" });

  return (
    <FadeInUp>
      <div className="mb-6">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-400">
          Settings · Style
        </p>
        <h1 className="mt-1 font-serif text-2xl tracking-tight text-neutral-900">
          Brand profiles.
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Save reusable looks for your documents — fonts, colors, sizes,
          spacing, and margins. Apply any profile to a new doc, or switch on
          the fly from the editor toolbar.
        </p>
      </div>

      {profiles.isLoading ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : (
        <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(profiles.data ?? []).map((p) => (
            <StaggerChild key={p.id}>
              <ProfileCard
                name={p.profile.name}
                isDefault={p.isDefault}
                profile={p.profile}
                onClick={() =>
                  setEditor({
                    mode: "edit",
                    id: p.id,
                    profile: p.profile,
                    isDefault: p.isDefault,
                  })
                }
              />
            </StaggerChild>
          ))}
          <StaggerChild>
            <NewProfileCard onClick={() => setEditor({ mode: "new" })} />
          </StaggerChild>
        </Stagger>
      )}

      <StyleProfileEditor
        open={editor.mode !== "closed"}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        profileId={editor.mode === "edit" ? editor.id : undefined}
        initialProfile={
          editor.mode === "edit" ? editor.profile : GLYPH_MODERN_PROFILE
        }
        initialIsDefault={editor.mode === "edit" ? editor.isDefault : false}
        onSaved={closeEditor}
      />
    </FadeInUp>
  );
}

// ---------------------------------------------------------------------------

function ProfileCard({
  name,
  isDefault,
  profile,
  onClick,
}: {
  name: string;
  isDefault: boolean;
  profile: StyleProfile;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group h-full w-full text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
      )}
    >
      <Card className="h-full cursor-pointer p-5 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-serif text-lg tracking-tight text-neutral-900">
            {name}
          </h3>
          {isDefault && <Badge variant="accent">Default</Badge>}
        </div>
        <div className="mt-4 flex items-center gap-1.5">
          <Swatch color={profile.colors.text} label="text" />
          <Swatch color={profile.colors.accent} label="accent" />
          <Swatch color={profile.colors.muted} label="muted" />
          <Swatch color={profile.colors.background} label="background" />
        </div>
        <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-400">
          {profile.fonts.heading} · {profile.fonts.body} · {profile.fonts.mono}
        </div>
      </Card>
    </button>
  );
}

function NewProfileCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group h-full w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
    >
      <Card
        className={cn(
          "flex h-full min-h-[170px] cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-5 text-neutral-500 transition-colors",
          "hover:border-emerald-300 hover:bg-emerald-50/30 hover:text-emerald-700",
          "dark:hover:border-emerald-500/40 dark:hover:bg-emerald-900/10",
        )}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="text-sm">New profile</span>
      </Card>
    </button>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span
      role="img"
      aria-label={`${label} ${color}`}
      title={`${label} ${color}`}
      className="h-6 w-6 rounded-md border border-neutral-200 shadow-sm dark:border-neutral-800"
      style={{ background: color }}
    />
  );
}
