"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PressScale } from "@/components/motion/primitives";

interface DocLike {
  readonly id: string;
  readonly title: string;
  readonly documentType: string;
  readonly isFinalized: boolean;
  readonly updatedAt: string;
}

export interface DocumentCardProps {
  readonly doc: DocLike;
  readonly onDelete: (doc: DocLike) => void;
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function relativeFrom(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return RELATIVE.format(diffSec, "second");
  if (abs < 3600) return RELATIVE.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return RELATIVE.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return RELATIVE.format(Math.round(diffSec / 86400), "day");
  if (abs < 31536000)
    return RELATIVE.format(Math.round(diffSec / 2592000), "month");
  return RELATIVE.format(Math.round(diffSec / 31536000), "year");
}

export function DocumentCard({ doc, onDelete }: DocumentCardProps) {
  return (
    <PressScale className="h-full">
      <Card className="group relative flex h-full flex-col gap-3 p-5 transition-shadow hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/documents/${doc.id}`}
            className="min-w-0 flex-1 focus:outline-none"
          >
            <h3 className="truncate font-serif text-lg tracking-tight text-neutral-900">
              {doc.title || "Untitled"}
            </h3>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-2 -mt-1 h-8 w-8 opacity-60 hover:opacity-100"
                aria-label="Document actions"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  // Rename: save doesn't accept title yet. Stub for now.
                  // eslint-disable-next-line no-console
                  console.info("Rename not yet supported by documents.save");
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onDelete(doc)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Link
          href={`/documents/${doc.id}`}
          className="flex flex-1 flex-col gap-3 focus:outline-none"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">{doc.documentType}</Badge>
            {doc.isFinalized ? (
              <Badge variant="success">Finalized</Badge>
            ) : (
              <Badge variant="secondary">Draft</Badge>
            )}
          </div>
          <div className="mt-auto text-sm text-neutral-500">
            Updated {relativeFrom(doc.updatedAt)}
          </div>
        </Link>
      </Card>
    </PressScale>
  );
}
