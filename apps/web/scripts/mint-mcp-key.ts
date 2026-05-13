import { db } from "../src/db";
import { apiKeys } from "../src/db/schema";
import { generateApiKey } from "@glyph/crypto";

async function main() {
  const userId = process.env.USER_ID ?? "8107d799-2cf6-4aee-8b4d-d4d0bf9ca6ca";
  const k = generateApiKey();
  await db.insert(apiKeys).values({
    userId,
    name: "mcp-smoke-test",
    keyHash: k.hash,
    keyPrefix: k.prefix,
  });
  console.log(k.raw);
}

void main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
