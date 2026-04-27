"use client";

import Link from "next/link";
import { FadeInUp } from "@/components/motion/primitives";
import { DashboardGrid } from "@/components/dashboard/DashboardGrid";
import { StatsCard } from "@/components/dashboard/StatsCard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export default function ReceivedPage() {
  const stats = trpc.apiKeys.getStats.useQuery();
  const recent = trpc.apiKeys.getRecentUsage.useQuery({ limit: 20 });
  const docsCount = trpc.documents.list.useQuery(undefined, {
    select: (rows) => rows.length,
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <FadeInUp>
        <div className="mb-8 flex flex-col gap-1">
          <h1 className="font-serif text-3xl tracking-tight text-neutral-900">
            Received
          </h1>
          <p className="text-sm text-neutral-500">
            Documents extracted through your Glyph API keys.
          </p>
        </div>
      </FadeInUp>

      <DashboardGrid>
        <StatsCard
          label="Extracted · 7d"
          value={stats.data?.extracted7d ?? (stats.isLoading ? "—" : 0)}
        />
        <StatsCard
          label="Extracted · 30d"
          value={stats.data?.extracted30d ?? (stats.isLoading ? "—" : 0)}
        />
        <StatsCard
          label="Active API keys"
          value={stats.data?.activeKeys ?? (stats.isLoading ? "—" : 0)}
        />
        <StatsCard
          label="Documents authored"
          value={docsCount.data ?? (docsCount.isLoading ? "—" : 0)}
        />
      </DashboardGrid>

      <FadeInUp className="mt-10">
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Last 20 extractions across all your API keys.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recent.isLoading ? (
              <p className="text-sm text-neutral-500">Loading…</p>
            ) : recent.data && recent.data.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Document type</TableHead>
                    <TableHead>Document</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-neutral-500">
                        {new Date(r.processedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-neutral-700">
                            {r.apiKeyPrefix}…
                          </span>
                          <span className="text-xs text-neutral-500">
                            {r.apiKeyName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.documentType ? (
                          <Badge variant="secondary">{r.documentType}</Badge>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-neutral-500">
                        {r.documentId ? r.documentId.slice(0, 8) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex flex-col items-start gap-3 py-6">
                <p className="text-sm text-neutral-600">
                  No extractions yet. Generate an API key to start receiving
                  structured documents.
                </p>
                <Button asChild>
                  <Link href="/settings/api-keys">Generate an API key</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </FadeInUp>
    </div>
  );
}
