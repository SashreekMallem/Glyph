# @glyph/crypto

Internal crypto primitives for Glyph: AES-256-GCM payload encryption, RSA-PSS
signing, and bcrypt-hashed API keys.

## Install

```sh
pnpm add @glyph/crypto
```

## Usage

```ts
import {
  encryptPayload,
  decryptPayload,
  signPayload,
  verifySignature,
  generateApiKey,
  verifyApiKey,
} from '@glyph/crypto';

const { encrypted, iv, tag } = await encryptPayload({ hello: 'world' });
const data = await decryptPayload(encrypted, iv, tag);

const sig = await signPayload(encrypted);
await verifySignature(encrypted, sig); // → true

const key = generateApiKey(); // { raw, hash, prefix }
await verifyApiKey(key.raw, key.hash); // → true
```

Requires `ENCRYPTION_MASTER_KEY` (32-byte hex), `SIGNING_PRIVATE_KEY` and
`SIGNING_PUBLIC_KEY` (PEM RSA-2048) in `process.env`.
