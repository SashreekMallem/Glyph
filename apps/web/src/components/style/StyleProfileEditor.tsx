"use client";

/**
 * StyleProfileEditor — premium modal form for editing one StyleProfile.
 *
 * Layout (lg+): two columns. Form on the left; live preview pane on the
 * right that re-renders on every keystroke using the profile's CSS
 * variables (`toCssVariables` from `@glyph/style-profile`).
 *
 * Validation: every committed save runs the canonical
 * `StyleProfileSchema.safeParse`. Field-level issues are mapped back to
 * dotted paths (e.g. `colors.accent`, `sizes.h1`) so the offending row
 * highlights and the issue message renders inline.
 *
 * The component is fully controlled internally — the parent only passes
 * the initial profile, the existing id (if any), and the open/close
 * state. Save/Delete are wired through the styleProfiles tRPC router.
 */

import { useEffect, useMemo, useState } from "react";

import {
  ALL_ALLOWED_FONTS,
  GLYPH_MODERN_PROFILE,
  StyleProfileSchema,
  toCssVariables,
  type StyleProfile,
} from "@glyph/style-profile";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface StyleProfileEditorProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** When set, the editor is editing an existing library row. */
  readonly profileId?: string;
  /** Initial profile state — defaults to GLYPH_MODERN_PROFILE. */
  readonly initialProfile?: StyleProfile;
  /** Whether the row is currently the user's default profile. */
  readonly initialIsDefault?: boolean;
  /** Fired after a successful save / delete so the parent list refreshes. */
  readonly onSaved?: () => void;
}

// ---------------------------------------------------------------------------

export function StyleProfileEditor({
  open,
  onOpenChange,
  profileId,
  initialProfile = GLYPH_MODERN_PROFILE,
  initialIsDefault = false,
  onSaved,
}: StyleProfileEditorProps) {
  const isEditing = profileId !== undefined;
  const utils = trpc.useUtils();

  // Form state is a single mutable copy of the profile + name + default flag.
  // We never mutate `initialProfile` — re-opening the modal with a different
  // row resets state via the `useEffect` below.
  const [profile, setProfile] = useState<StyleProfile>(initialProfile);
  const [isDefault, setIsDefault] = useState<boolean>(initialIsDefault);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Resync when the dialog re-opens against a different row. Without this
  // the form keeps the previous row's values when the user navigates
  // between cards in quick succession.
  useEffect(() => {
    if (open) {
      setProfile(initialProfile);
      setIsDefault(initialIsDefault);
      setIssues({});
      setSubmitError(null);
    }
  }, [open, initialProfile, initialIsDefault]);

  const createMut = trpc.styleProfiles.create.useMutation();
  const updateMut = trpc.styleProfiles.update.useMutation();
  const deleteMut = trpc.styleProfiles.delete.useMutation();

  const busy =
    createMut.isPending || updateMut.isPending || deleteMut.isPending;

  // CSS custom properties for the live preview. Memoized so React doesn't
  // diff a fresh object on every keystroke that didn't touch the profile.
  const previewVars = useMemo(
    () => toCssVariables(profile) as React.CSSProperties,
    [profile],
  );

  // -----------------------------------------------------------------------
  // Field updaters — every leaf path is wrapped in a small helper that
  // takes a single value and merges it into `profile`. Keeps the JSX
  // declarative without sprinkling immer-style setters everywhere.
  // -----------------------------------------------------------------------

  const setField = <K extends keyof StyleProfile>(
    key: K,
    value: StyleProfile[K],
  ) => setProfile((p) => ({ ...p, [key]: value }));

  const setFont = (slot: keyof StyleProfile["fonts"], value: string) =>
    setProfile((p) => ({ ...p, fonts: { ...p.fonts, [slot]: value } }));

  const setColor = (slot: keyof StyleProfile["colors"], value: string) =>
    setProfile((p) => ({ ...p, colors: { ...p.colors, [slot]: value } }));

  const setSize = (slot: keyof StyleProfile["sizes"], value: number) =>
    setProfile((p) => ({ ...p, sizes: { ...p.sizes, [slot]: value } }));

  const setSpacing = (
    slot: keyof StyleProfile["spacing"],
    value: number,
  ) => setProfile((p) => ({ ...p, spacing: { ...p.spacing, [slot]: value } }));

  const setMargin = (
    slot: keyof StyleProfile["page"]["margins"],
    value: number,
  ) =>
    setProfile((p) => ({
      ...p,
      page: { margins: { ...p.page.margins, [slot]: value } },
    }));

  // -----------------------------------------------------------------------
  // Submit / delete
  // -----------------------------------------------------------------------

  const handleSave = async () => {
    setSubmitError(null);
    const parsed = StyleProfileSchema.safeParse(profile);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        next[issue.path.join(".")] = issue.message;
      }
      setIssues(next);
      return;
    }
    setIssues({});
    try {
      if (isEditing && profileId) {
        await updateMut.mutateAsync({
          id: profileId,
          profile: parsed.data,
          isDefault,
        });
      } else {
        await createMut.mutateAsync({
          profile: parsed.data,
          isDefault,
        });
      }
      await utils.styleProfiles.list.invalidate();
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Save failed.");
    }
  };

  const handleDelete = async () => {
    if (!isEditing || !profileId) return;
    setSubmitError(null);
    try {
      await deleteMut.mutateAsync({ id: profileId });
      await utils.styleProfiles.list.invalidate();
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-5xl overflow-hidden border-neutral-200 bg-white p-0 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="grid max-h-[88vh] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* Form column ----------------------------------------------- */}
          <div className="overflow-y-auto px-7 pb-6 pt-7">
            <DialogHeader className="space-y-1.5 text-left">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-400">
                Settings · Style · {isEditing ? "Edit" : "New"}
              </p>
              <DialogTitle className="font-serif text-2xl tracking-tight text-neutral-900 dark:text-neutral-50">
                {isEditing ? "Edit brand profile" : "New brand profile"}
              </DialogTitle>
              <DialogDescription className="text-sm text-neutral-500 dark:text-neutral-400">
                Reusable visual identity for your documents — fonts, colors,
                sizes, spacing, and page margins.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSave();
              }}
              className="mt-6 space-y-7"
            >
              {/* Name -------------------------------------------------- */}
              <Section title="Name">
                <FieldRow label="Profile name" issue={issues.name}>
                  <Input
                    value={profile.name}
                    onChange={(e) => setField("name", e.target.value)}
                    placeholder="My brand"
                    maxLength={80}
                    disabled={busy}
                  />
                </FieldRow>
              </Section>

              {/* Fonts ------------------------------------------------- */}
              <Section title="Fonts">
                <FieldRow label="Heading" issue={issues["fonts.heading"]}>
                  <FontPicker
                    value={profile.fonts.heading}
                    disabled={busy}
                    onChange={(v) => setFont("heading", v)}
                  />
                </FieldRow>
                <FieldRow label="Body" issue={issues["fonts.body"]}>
                  <FontPicker
                    value={profile.fonts.body}
                    disabled={busy}
                    onChange={(v) => setFont("body", v)}
                  />
                </FieldRow>
                <FieldRow label="Mono" issue={issues["fonts.mono"]}>
                  <FontPicker
                    value={profile.fonts.mono}
                    disabled={busy}
                    onChange={(v) => setFont("mono", v)}
                  />
                </FieldRow>
              </Section>

              {/* Colors ------------------------------------------------ */}
              <Section title="Colors">
                <ColorRow
                  label="Text"
                  value={profile.colors.text}
                  issue={issues["colors.text"]}
                  disabled={busy}
                  onChange={(v) => setColor("text", v)}
                />
                <ColorRow
                  label="Accent"
                  value={profile.colors.accent}
                  issue={issues["colors.accent"]}
                  disabled={busy}
                  onChange={(v) => setColor("accent", v)}
                />
                <ColorRow
                  label="Muted"
                  value={profile.colors.muted}
                  issue={issues["colors.muted"]}
                  disabled={busy}
                  onChange={(v) => setColor("muted", v)}
                />
                <ColorRow
                  label="Background"
                  value={profile.colors.background}
                  issue={issues["colors.background"]}
                  disabled={busy}
                  onChange={(v) => setColor("background", v)}
                />
              </Section>

              {/* Sizes ------------------------------------------------- */}
              <Section title="Sizes (pt)">
                <div className="grid grid-cols-5 gap-3">
                  <NumberField
                    label="H1"
                    value={profile.sizes.h1}
                    min={8}
                    max={48}
                    issue={issues["sizes.h1"]}
                    disabled={busy}
                    onChange={(v) => setSize("h1", v)}
                  />
                  <NumberField
                    label="H2"
                    value={profile.sizes.h2}
                    min={8}
                    max={48}
                    issue={issues["sizes.h2"]}
                    disabled={busy}
                    onChange={(v) => setSize("h2", v)}
                  />
                  <NumberField
                    label="H3"
                    value={profile.sizes.h3}
                    min={8}
                    max={48}
                    issue={issues["sizes.h3"]}
                    disabled={busy}
                    onChange={(v) => setSize("h3", v)}
                  />
                  <NumberField
                    label="Body"
                    value={profile.sizes.body}
                    min={8}
                    max={48}
                    issue={issues["sizes.body"]}
                    disabled={busy}
                    onChange={(v) => setSize("body", v)}
                  />
                  <NumberField
                    label="Small"
                    value={profile.sizes.small}
                    min={8}
                    max={48}
                    issue={issues["sizes.small"]}
                    disabled={busy}
                    onChange={(v) => setSize("small", v)}
                  />
                </div>
              </Section>

              {/* Spacing ----------------------------------------------- */}
              <Section title="Spacing">
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Line height"
                    value={profile.spacing.line_height}
                    min={1}
                    max={3}
                    step={0.1}
                    issue={issues["spacing.line_height"]}
                    disabled={busy}
                    onChange={(v) => setSpacing("line_height", v)}
                  />
                  <NumberField
                    label="Paragraph gap (pt)"
                    value={profile.spacing.paragraph_gap}
                    min={0}
                    max={32}
                    issue={issues["spacing.paragraph_gap"]}
                    disabled={busy}
                    onChange={(v) => setSpacing("paragraph_gap", v)}
                  />
                </div>
              </Section>

              {/* Margins ----------------------------------------------- */}
              <Section title="Page margins (pt)">
                <div className="grid grid-cols-4 gap-3">
                  <NumberField
                    label="Top"
                    value={profile.page.margins.top}
                    min={0}
                    max={144}
                    issue={issues["page.margins.top"]}
                    disabled={busy}
                    onChange={(v) => setMargin("top", v)}
                  />
                  <NumberField
                    label="Right"
                    value={profile.page.margins.right}
                    min={0}
                    max={144}
                    issue={issues["page.margins.right"]}
                    disabled={busy}
                    onChange={(v) => setMargin("right", v)}
                  />
                  <NumberField
                    label="Bottom"
                    value={profile.page.margins.bottom}
                    min={0}
                    max={144}
                    issue={issues["page.margins.bottom"]}
                    disabled={busy}
                    onChange={(v) => setMargin("bottom", v)}
                  />
                  <NumberField
                    label="Left"
                    value={profile.page.margins.left}
                    min={0}
                    max={144}
                    issue={issues["page.margins.left"]}
                    disabled={busy}
                    onChange={(v) => setMargin("left", v)}
                  />
                </div>
              </Section>

              {/* Default toggle --------------------------------------- */}
              <Section title="Default">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={isDefault}
                    disabled={busy}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-300 text-emerald-600 focus-visible:ring-emerald-500/40"
                  />
                  <span className="text-sm text-neutral-700 dark:text-neutral-300">
                    Use this profile by default for new documents
                  </span>
                </label>
              </Section>

              {submitError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400">
                  {submitError}
                </div>
              )}

              {/* Footer ----------------------------------------------- */}
              <div className="flex items-center justify-between gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                <div>
                  {isEditing && (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => void handleDelete()}
                      disabled={busy}
                    >
                      Delete
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {busy
                      ? "Saving"
                      : isEditing
                        ? "Save changes"
                        : "Create profile"}
                  </Button>
                </div>
              </div>
            </form>
          </div>

          {/* Preview column ------------------------------------------ */}
          <aside className="hidden border-l border-neutral-200 bg-neutral-50/50 lg:block dark:border-neutral-800 dark:bg-neutral-950/50">
            <div className="sticky top-0 px-6 pb-6 pt-7">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-400">
                Preview
              </p>
              <PreviewPane vars={previewVars} />
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Internal subcomponents
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-500">
        {title}
      </legend>
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}

function FieldRow({
  label,
  issue,
  children,
}: {
  label: string;
  issue?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-neutral-600 dark:text-neutral-400">
        {label}
      </Label>
      {children}
      {issue && <p className="text-[11px] text-red-600">{issue}</p>}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  issue,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  issue?: string;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wider text-neutral-500">
        {label}
      </Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        disabled={disabled}
        onChange={(e) => {
          // Number(""): NaN. Coerce to 0 — Zod will surface the real issue
          // if the field requires a positive integer.
          const raw = e.target.value;
          const next = raw === "" ? 0 : Number(raw);
          onChange(Number.isFinite(next) ? next : 0);
        }}
        className={cn("h-9", issue && "border-red-400")}
      />
      {issue && <p className="text-[11px] text-red-600">{issue}</p>}
    </div>
  );
}

function ColorRow({
  label,
  value,
  issue,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  issue?: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-neutral-600 dark:text-neutral-400">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          // Native color input does not accept short hex; we lowercase
          // because Chrome canonicalizes to lowercase anyway.
          value={value.toLowerCase()}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} color picker`}
          className="h-9 w-12 cursor-pointer rounded-md border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-950"
        />
        <Input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          aria-label={`${label} hex value`}
          className={cn("h-9 font-mono text-xs", issue && "border-red-400")}
        />
      </div>
      {issue && <p className="text-[11px] text-red-600">{issue}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Font picker — searchable Popover. shadcn's Select primitive doesn't
// support inline filtering, so we render our own list inside a Popover
// with a text-input filter. The list is small (~60 fonts) so we render
// it fully and let CSS handle the scroll.
// ---------------------------------------------------------------------------

function FontPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return ALL_ALLOWED_FONTS;
    return ALL_ALLOWED_FONTS.filter((f) => f.toLowerCase().includes(q));
  }, [query]);

  return (
    <Popover open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-3 text-left text-sm transition-colors dark:border-neutral-800 dark:bg-neutral-950",
            "focus-visible:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/20",
            disabled && "cursor-not-allowed opacity-60",
          )}
          style={{ fontFamily: `"${value}", system-ui, sans-serif` }}
        >
          <span className="truncate">{value}</span>
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
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-neutral-200 p-2 dark:border-neutral-800">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fonts"
            className="h-8 text-xs"
            autoFocus
          />
        </div>
        <ul
          role="listbox"
          className="max-h-64 overflow-y-auto p-1"
          aria-label="Font family"
        >
          {items.length === 0 && (
            <li className="px-3 py-2 text-xs text-neutral-500">
              No matching fonts.
            </li>
          )}
          {items.map((font) => (
            <li key={font}>
              <button
                type="button"
                role="option"
                aria-selected={font === value}
                onClick={() => {
                  onChange(font);
                  setOpen(false);
                  setQuery("");
                }}
                className={cn(
                  "w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                  font === value
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800",
                )}
                style={{ fontFamily: `"${font}", system-ui, sans-serif` }}
              >
                {font}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Live preview pane
// ---------------------------------------------------------------------------

function PreviewPane({ vars }: { vars: React.CSSProperties }) {
  return (
    <div
      className="mt-3 overflow-hidden rounded-2xl border border-neutral-200 shadow-sm dark:border-neutral-800"
      style={vars}
    >
      <div
        className="space-y-4 p-6"
        style={{
          background: "var(--glyph-color-background)",
          color: "var(--glyph-color-text)",
          fontFamily: "var(--glyph-font-body), system-ui, sans-serif",
          fontSize: "var(--glyph-size-body)",
          lineHeight: "var(--glyph-spacing-line-height)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--glyph-font-heading), system-ui, sans-serif",
            fontSize: "var(--glyph-size-h1)",
            color: "var(--glyph-color-text)",
            margin: 0,
            marginBottom: "var(--glyph-spacing-paragraph-gap)",
            lineHeight: 1.1,
          }}
        >
          Document Title
        </h1>
        <h2
          style={{
            fontFamily: "var(--glyph-font-heading), system-ui, sans-serif",
            fontSize: "var(--glyph-size-h2)",
            color: "var(--glyph-color-accent)",
            margin: 0,
            marginBottom: "var(--glyph-spacing-paragraph-gap)",
            lineHeight: 1.2,
          }}
        >
          Subhead
        </h2>
        <p style={{ margin: 0, marginBottom: "var(--glyph-spacing-paragraph-gap)" }}>
          Body copy carries the structural payload Glyph extracts as you
          write. Every paragraph re-renders at the size, font, and color
          you pick on the left.
        </p>
        <p
          style={{
            margin: 0,
            marginBottom: "var(--glyph-spacing-paragraph-gap)",
            color: "var(--glyph-color-muted)",
            fontSize: "var(--glyph-size-small)",
          }}
        >
          A muted note — captions, footers, fine print.
        </p>
        <pre
          style={{
            margin: 0,
            padding: "0.75rem",
            borderRadius: "0.5rem",
            background: "var(--glyph-color-muted)",
            color: "var(--glyph-color-background)",
            fontFamily: "var(--glyph-font-mono), ui-monospace, monospace",
            fontSize: "var(--glyph-size-small)",
            lineHeight: 1.4,
            overflowX: "auto",
          }}
        >
{`const glyph = { version: "1.0" };`}
        </pre>
      </div>
    </div>
  );
}
