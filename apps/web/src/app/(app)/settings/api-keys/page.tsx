"use client";

import { useState } from "react";
import { FadeInUp } from "@/components/motion/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";

export default function ApiKeysPage() {
  const utils = trpc.useUtils();
  const keys = trpc.apiKeys.list.useQuery();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [revealedKey, setRevealedKey] = useState<{ key: string; prefix: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (data) => {
      setRevealedKey({ key: data.key, prefix: data.prefix });
      setNewName("");
      setCreateOpen(false);
      utils.apiKeys.list.invalidate();
    },
  });

  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => {
      setRevokeTarget(null);
      utils.apiKeys.list.invalidate();
    },
  });

  return (
    <FadeInUp>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl tracking-tight text-neutral-900">
            API Keys
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Use these keys to call the Glyph extraction API from your backend.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New key</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {keys.isLoading ? (
            <p className="px-6 py-8 text-sm text-neutral-500">Loading…</p>
          ) : keys.data && keys.data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requests</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.data.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium text-neutral-900">
                      {k.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-neutral-500">
                      {k.prefix}…
                    </TableCell>
                    <TableCell>
                      {k.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Revoked</Badge>
                      )}
                    </TableCell>
                    <TableCell>{k.requestCount.toLocaleString()}</TableCell>
                    <TableCell className="text-sm text-neutral-500">
                      {k.lastUsedAt
                        ? new Date(k.lastUsedAt).toLocaleDateString()
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      {k.isActive ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRevokeTarget({ id: k.id, name: k.name })}
                        >
                          Revoke
                        </Button>
                      ) : (
                        <span className="text-xs text-neutral-400">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="px-6 py-10 text-center">
              <p className="mb-4 text-sm text-neutral-600">
                No API keys yet. Generate one to start extracting.
              </p>
              <Button onClick={() => setCreateOpen(true)}>Generate your first key</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CREATE DIALOG */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Give your key a descriptive name so you can identify it later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Production server"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate({ name: newName.trim() })}
              disabled={newName.trim().length === 0 || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REVEAL DIALOG (one-time key display) */}
      <Dialog
        open={revealedKey !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevealedKey(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>
              Copy this now. For security, the full key will not be shown again.
            </DialogDescription>
          </DialogHeader>
          {revealedKey && (
            <div className="space-y-3 py-2">
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Store this somewhere safe. If you lose it, generate a new one.
              </div>
              <div className="group relative">
                <code className="block overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-sm text-neutral-900">
                  {revealedKey.key}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute right-1 top-1"
                  onClick={() => {
                    void navigator.clipboard.writeText(revealedKey.key);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => {
                setRevealedKey(null);
                setCopied(false);
              }}
            >
              I’ve saved it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REVOKE CONFIRM */}
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this key?</DialogTitle>
            <DialogDescription>
              Requests using {revokeTarget?.name} will immediately start failing with 401.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (revokeTarget) revokeMutation.mutate({ id: revokeTarget.id });
              }}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? "Revoking…" : "Revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FadeInUp>
  );
}
