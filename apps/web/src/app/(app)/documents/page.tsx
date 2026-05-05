"use client";

/**
 * Documents workspace — premium, interactive surface.
 *
 * Layout:
 *   1. Page header — eyebrow + serif H1 + subtitle on the left, search +
 *      magnetic "New document" CTA on the right
 *   2. Stat strip — three live stats (drafts / signed / reads served)
 *      with animated counters
 *   3. Filter bar — All / Drafts / Signed pills, type filter, sort
 *   4. Document grid — premium cards with CSS-3D mini-doc previews
 *
 * Empty state is a centered floating doc + magnetic "Create your first
 * document" CTA. Loading state shows skeleton cards instead of bare text.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { CreateDocDialog } from "@/components/documents/CreateDocDialog";
import { DeleteDocDialog } from "@/components/documents/DeleteDocDialog";
import { DocumentCard } from "@/components/documents/DocumentCard";
import { MagneticButton } from "@/components/landing/MagneticButton";

interface PendingDelete {
  readonly id: string;
  readonly title: string;
}

type StatusFilter = "all" | "draft" | "signed";
type TypeFilter = "all" | string;
type SortKey = "recent" | "oldest";

export default function DocumentsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const deferredSearch = useDeferredValue(search);

  const list = trpc.documents.list.useQuery(undefined, {
    retry: 1,
  });
  const docs = useMemo(() => list.data ?? [], [list.data]);

  const stats = useMemo(() => {
    const drafts = docs.filter((d) => !d.isFinalized).length;
    const signed = docs.filter((d) => d.isFinalized).length;
    return { drafts, signed, reads: 0 };
  }, [docs]);

  const filtered = useMemo(() => {
    let xs = docs;
    if (statusFilter === "draft") xs = xs.filter((d) => !d.isFinalized);
    if (statusFilter === "signed") xs = xs.filter((d) => d.isFinalized);
    if (typeFilter !== "all") xs = xs.filter((d) => d.documentType === typeFilter);
    if (deferredSearch) {
      const f = deferredSearch.toLowerCase();
      xs = xs.filter((d) => d.title.toLowerCase().includes(f));
    }
    xs = [...xs].sort((a, b) => {
      const A = new Date(a.updatedAt).getTime();
      const B = new Date(b.updatedAt).getTime();
      return sort === "recent" ? B - A : A - B;
    });
    return xs;
  }, [docs, statusFilter, typeFilter, deferredSearch, sort]);

  const presentTypes = useMemo(() => {
    const set = new Set<string>();
    for (const d of docs) set.add(d.documentType);
    return Array.from(set).sort();
  }, [docs]);

  return (
    <div className="relative">
      {/* Brand wash background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute right-[-10%] top-[-5%] h-[420px] w-[420px] rounded-full bg-emerald-200/25 blur-3xl" />
        <div className="absolute left-[-10%] top-[30%] h-[380px] w-[380px] rounded-full bg-amber-100/35 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-10 lg:py-14">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-400">
              Workspace · Documents
            </p>
            <h1 className="mt-2 font-serif text-4xl leading-[1.05] tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-5xl">
              Your documents.
            </h1>
            <p className="mt-2 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
              Author once. Sign once. Every consumer reads in 2 ms — for free
              to you, forever.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <SearchInput value={search} onChange={setSearch} />
            <MagneticButton>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="group inline-flex h-10 items-center gap-2 rounded-full bg-neutral-900 px-5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                New document
                <ArrowIcon />
              </button>
            </MagneticButton>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="mt-8 grid grid-cols-3 gap-3 sm:gap-4"
        >
          <Stat label="Drafts" value={stats.drafts} sub="in progress" />
          <Stat label="Signed" value={stats.signed} sub="ready to share" accent />
          <Stat label="Reads served" value={stats.reads} sub="$0 to you, always" />
        </motion.div>

        {/* Filters */}
        {docs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="mt-8 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterPill
                active={statusFilter === "all"}
                onClick={() => setStatusFilter("all")}
              >
                All <Count>{docs.length}</Count>
              </FilterPill>
              <FilterPill
                active={statusFilter === "draft"}
                onClick={() => setStatusFilter("draft")}
              >
                Drafts <Count>{stats.drafts}</Count>
              </FilterPill>
              <FilterPill
                active={statusFilter === "signed"}
                onClick={() => setStatusFilter("signed")}
              >
                Signed <Count>{stats.signed}</Count>
              </FilterPill>
              <span className="mx-1 hidden h-4 w-px bg-neutral-200 dark:bg-neutral-800 sm:block" />
              <FilterPill
                active={typeFilter === "all"}
                onClick={() => setTypeFilter("all")}
              >
                Any type
              </FilterPill>
              {presentTypes.map((t) => (
                <FilterPill
                  key={t}
                  active={typeFilter === t}
                  onClick={() => setTypeFilter(t)}
                >
                  {t}
                </FilterPill>
              ))}
            </div>
            <div className="flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-neutral-400">
              <span>Sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="cursor-pointer rounded-md bg-transparent py-1 pl-2 pr-6 text-neutral-700 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <option value="recent">Recent</option>
                <option value="oldest">Oldest</option>
              </select>
            </div>
          </motion.div>
        )}

        {/* Body */}
        <div className="mt-8">
          {list.isLoading ? (
            <SkeletonGrid />
          ) : list.isError ? (
            <ErrorState message={list.error?.message ?? "Could not load documents."} />
          ) : docs.length === 0 ? (
            <EmptyState onCreate={() => setCreateOpen(true)} />
          ) : filtered.length === 0 ? (
            <NoResultsState onClear={() => {
              setSearch("");
              setStatusFilter("all");
              setTypeFilter("all");
            }} />
          ) : (
            <DocumentGrid
              docs={filtered}
              onDelete={(d) => setPendingDelete({ id: d.id, title: d.title })}
            />
          )}
        </div>
      </div>

      <CreateDocDialog open={createOpen} onOpenChange={setCreateOpen} />
      {pendingDelete !== null && (
        <DeleteDocDialog
          open={true}
          onOpenChange={(v) => {
            if (!v) setPendingDelete(null);
          }}
          docId={pendingDelete.id}
          docTitle={pendingDelete.title}
          onDeleted={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header / search
// ---------------------------------------------------------------------------

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="relative">
      <SearchIcon />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search…"
        className="h-10 w-44 rounded-full border-neutral-200 bg-white/80 pl-9 pr-4 text-[13px] backdrop-blur transition-colors focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500/20 dark:border-neutral-800 dark:bg-neutral-900/80 sm:w-56"
      />
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
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

// ---------------------------------------------------------------------------
// Stats strip
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 sm:p-6 ${
        accent
          ? "border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white dark:border-emerald-900/40 dark:from-emerald-900/10 dark:to-neutral-900"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-neutral-400">
        {label}
      </div>
      <div className="mt-2 font-serif text-3xl tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
        <AnimatedNumber value={value} />
      </div>
      <div className="mt-1 text-xs text-neutral-500">{sub}</div>
    </div>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {value.toLocaleString()}
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// Filter pills
// ---------------------------------------------------------------------------

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[0.6rem] uppercase tracking-[0.18em] transition ${
        active
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/15 dark:text-emerald-400"
          : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-50"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-0.5 rounded-full bg-neutral-100 px-1.5 py-0 text-[9px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Body states
// ---------------------------------------------------------------------------

function DocumentGrid({
  docs,
  onDelete,
}: {
  docs: ReadonlyArray<{
    id: string;
    title: string;
    documentType: string;
    isFinalized: boolean;
    updatedAt: string;
  }>;
  onDelete: (d: {
    id: string;
    title: string;
    documentType: string;
    isFinalized: boolean;
    updatedAt: string;
  }) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <AnimatePresence initial={false}>
        {docs.map((d, i) => (
          <motion.div
            key={d.id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{
              duration: 0.32,
              ease: [0.16, 1, 0.3, 1],
              delay: Math.min(i * 0.025, 0.15),
            }}
          >
            <DocumentCard doc={d} onDelete={onDelete} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
          style={{ animation: `pulse 1.6s ease-in-out ${i * 0.08}s infinite` }}
        >
          <div className="h-32 bg-neutral-100 dark:bg-neutral-800" />
          <div className="space-y-2 p-5">
            <div className="h-3 w-1/3 rounded-full bg-neutral-100 dark:bg-neutral-800" />
            <div className="h-5 w-2/3 rounded-full bg-neutral-100 dark:bg-neutral-800" />
            <div className="h-3 w-1/2 rounded-full bg-neutral-100 dark:bg-neutral-800" />
          </div>
        </div>
      ))}
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-900/40 dark:bg-red-900/10">
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-red-700">
        Could not load documents
      </p>
      <p className="mt-2 text-sm text-red-700 dark:text-red-400">{message}</p>
    </div>
  );
}

function NoResultsState({ onClear }: { onClear: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-dashed border-neutral-200 bg-white p-10 text-center dark:border-neutral-800 dark:bg-neutral-900">
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-400">
        No matches
      </p>
      <p className="mt-2 font-serif text-lg text-neutral-900 dark:text-neutral-50">
        Nothing matched your filters.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-emerald-600 hover:text-emerald-700"
      >
        Clear filters →
      </button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-6 py-12 text-center">
      <FloatingDocPreview />
      <p className="mt-8 font-mono text-[0.6rem] uppercase tracking-[0.22em] text-neutral-400">
        Empty workspace
      </p>
      <h2 className="mt-2 font-serif text-3xl tracking-tight text-neutral-900 dark:text-neutral-50">
        No documents yet — your first stamp is on us.
      </h2>
      <p className="mt-3 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
        Create a resume, contract, or invoice. Glyph reads as you type, signs
        the result, and embeds it into the file forever.
      </p>
      <div className="mt-6">
        <MagneticButton>
          <button
            type="button"
            onClick={onCreate}
            className="group inline-flex h-11 items-center gap-2 rounded-full bg-neutral-900 px-6 text-sm font-medium text-white transition-colors hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Create your first document
            <ArrowIcon />
          </button>
        </MagneticButton>
      </div>
    </div>
  );
}

function FloatingDocPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, rotateY: 12 }}
      animate={{ opacity: 1, y: 0, rotateY: 6 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformStyle: "preserve-3d", perspective: 1200 }}
      className="relative"
    >
      <div
        aria-hidden
        className="absolute left-1/2 top-full h-12 w-[80%] -translate-x-1/2 rounded-[50%] bg-black/15 blur-2xl"
      />
      <div
        className="rounded-xl bg-[#fdfcfa] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.18),0_18px_36px_-18px_rgba(0,0,0,0.12),inset_0_0_0_1px_rgba(0,0,0,0.04)]"
        style={{ width: 280, padding: "28px 28px" }}
      >
        <div className="font-mono text-[8px] uppercase tracking-[0.22em] text-neutral-400">
          Resume · Ada Lovelace
        </div>
        <div className="mt-2 font-serif text-2xl leading-[1.05] tracking-tight text-neutral-900">
          Ada Lovelace
        </div>
        <div className="mt-1 text-[11px] text-neutral-500">
          Lead Algorithmist · 1843–1852
        </div>
        <div className="mt-3 h-px w-full bg-neutral-200" />
        <div className="mt-3 space-y-1">
          {[80, 60, 70, 90, 50].map((w, i) => (
            <div
              key={i}
              className="h-[3px] rounded-full bg-neutral-300/80"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-2 font-mono text-[8px] uppercase tracking-[0.18em]">
          <span className="text-neutral-400">glyph stamp</span>
          <span className="text-emerald-600">✓ signed</span>
        </div>
      </div>
      <div
        className="absolute -right-8 top-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-700 backdrop-blur-sm"
        style={{ transform: "translateZ(40px)" }}
      >
        ✓ signed
      </div>
    </motion.div>
  );
}
