"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";

export interface FieldDescriptor {
  path: string;
  label: string;
  section: string;
  type?: "string" | "number" | "boolean" | "date";
  placeholder?: string;
}

export interface TemplateInput {
  id: string;
  documentTypeId: string;
  name: string;
  description: string | null;
  descriptors: FieldDescriptor[];
  isSystem: boolean;
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [picked] = next.splice(from, 1);
  if (picked !== undefined) next.splice(to, 0, picked);
  return next;
}

export function TemplateEditor({
  template,
  typeKey,
}: {
  template: TemplateInput;
  typeKey: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  const [rows, setRows] = useState<FieldDescriptor[]>(template.descriptors);
  const [error, setError] = useState<string | null>(null);

  const save = trpc.documentTypes.upsertTemplate.useMutation({
    onSuccess: () => {
      void utils.documentTypes.listTemplatesForType.invalidate();
      router.push(`/settings/document-types/${typeKey}`);
    },
    onError: (e) => setError(e.message),
  });
  const del = trpc.documentTypes.deleteTemplate.useMutation({
    onSuccess: () => {
      void utils.documentTypes.listTemplatesForType.invalidate();
      router.push(`/settings/document-types/${typeKey}`);
    },
  });

  const readOnly = template.isSystem;

  const addRow = () => {
    setRows((rs) => [
      ...rs,
      { path: "", label: "", section: "General", type: "string" },
    ]);
  };
  const removeRow = (i: number) => {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  };
  const updateRow = (i: number, patch: Partial<FieldDescriptor>) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const onSave = () => {
    setError(null);
    const cleaned = rows.filter((r) => r.path.trim().length > 0 && r.label.trim().length > 0);
    if (cleaned.length === 0) {
      setError("Add at least one descriptor row with a path and label.");
      return;
    }
    save.mutate({
      id: template.id,
      documentTypeId: template.documentTypeId,
      name: name.trim(),
      description: description.trim() || undefined,
      descriptors: cleaned,
    });
  };

  return (
    <div className="space-y-6">
      {readOnly && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          System templates are read-only. Click Clone on the type page to customize.
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="tpl-name">Template name</Label>
        <Input
          id="tpl-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="tpl-desc">Description</Label>
        <Textarea
          id="tpl-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={readOnly}
          rows={3}
          placeholder="What is this template for?"
        />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-neutral-700">Field descriptors</h3>
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={addRow}>
              Add field
            </Button>
          )}
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Section</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Placeholder</TableHead>
                {!readOnly && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-neutral-400">{i + 1}</TableCell>
                  <TableCell>
                    <Input
                      value={r.section}
                      onChange={(e) => updateRow(i, { section: e.target.value })}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={r.path}
                      onChange={(e) => updateRow(i, { path: e.target.value })}
                      disabled={readOnly}
                      className="h-8 font-mono text-xs"
                      placeholder="e.g. parties.0.name"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={r.label}
                      onChange={(e) => updateRow(i, { label: e.target.value })}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <select
                      value={r.type ?? "string"}
                      onChange={(e) =>
                        updateRow(i, {
                          type: e.target.value as FieldDescriptor["type"],
                        })
                      }
                      disabled={readOnly}
                      className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs"
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="date">date</option>
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={r.placeholder ?? ""}
                      onChange={(e) => updateRow(i, { placeholder: e.target.value })}
                      disabled={readOnly}
                      className="h-8"
                    />
                  </TableCell>
                  {!readOnly && (
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Move up"
                          onClick={() => setRows((rs) => move(rs, i, i - 1))}
                          disabled={i === 0}
                        >
                          ↑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Move down"
                          onClick={() => setRows((rs) => move(rs, i, i + 1))}
                          disabled={i === rows.length - 1}
                        >
                          ↓
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Remove"
                          onClick={() => removeRow(i)}
                        >
                          ✕
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={readOnly ? 6 : 7} className="text-center text-neutral-500">
                    No fields yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!readOnly && (
        <div className="flex items-center justify-between">
          <Button
            variant="destructive"
            onClick={() => del.mutate({ id: template.id })}
            disabled={del.isPending}
          >
            {del.isPending ? "Deleting…" : "Delete template"}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => router.push(`/settings/document-types/${typeKey}`)}
            >
              Cancel
            </Button>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
