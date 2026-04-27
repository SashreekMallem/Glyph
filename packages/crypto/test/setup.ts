import { generateKeyPairSync, randomBytes } from 'node:crypto';

export interface TestKeys {
  readonly masterKeyHex: string;
  readonly privatePem: string;
  readonly publicPem: string;
  readonly otherPrivatePem: string;
  readonly otherPublicPem: string;
}

export function makeTestKeys(): TestKeys {
  const masterKeyHex = randomBytes(32).toString('hex');
  const primary = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const other = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    masterKeyHex,
    privatePem: primary.privateKey,
    publicPem: primary.publicKey,
    otherPrivatePem: other.privateKey,
    otherPublicPem: other.publicKey,
  };
}
