/**
 * Shared test fixtures: an AES master key and an RSA signing key pair.
 * Importing this module sets the env vars so crypto helpers bootstrap
 * cleanly the first time they are called.
 */

import { generateKeyPairSync, randomBytes } from "node:crypto";

const masterKey = randomBytes(32).toString("hex");
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

process.env.ENCRYPTION_MASTER_KEY = masterKey;
process.env.SIGNING_PRIVATE_KEY = privateKey;
process.env.SIGNING_PUBLIC_KEY = publicKey;

export const TEST_MASTER_KEY = masterKey;
export const TEST_SIGNING_PRIVATE_KEY = privateKey;
export const TEST_SIGNING_PUBLIC_KEY = publicKey;
