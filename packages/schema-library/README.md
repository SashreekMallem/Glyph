# @glyph/schema-library

Zod schemas for every document type Glyph understands (contract, resume,
invoice), a discriminated-union document schema, and a `toJsonSchema`
helper that emits JSON Schema for external consumers.

## Install

```sh
pnpm add @glyph/schema-library
```

## Usage

```ts
import {
  ContractSchema,
  DocumentSchema,
  getSchema,
  toJsonSchema,
  type GlyphDocument,
} from '@glyph/schema-library';

const doc: GlyphDocument = DocumentSchema.parse(input);
const schema = getSchema('invoice');
const jsonSchema = toJsonSchema(ContractSchema);
```

Top-level schemas are `.strict()` — unknown fields on the document root
are rejected. This keeps the embedded JSON contract stable.
