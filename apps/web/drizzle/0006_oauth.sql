-- OAuth 2.1 dynamic client registration + authorization code tables.
-- Tokens themselves reuse the existing api_keys table (issued at /token
-- with name='oauth:<client_id>') so verifyApiKey works unchanged.

CREATE TABLE IF NOT EXISTS "oauth_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" text NOT NULL,
  "client_name" text NOT NULL,
  "redirect_uris" jsonb NOT NULL,
  "grant_types" jsonb NOT NULL DEFAULT '["authorization_code","refresh_token"]'::jsonb,
  "token_endpoint_auth_method" text NOT NULL DEFAULT 'none',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_clients_client_id_unique" ON "oauth_clients" ("client_id");

CREATE TABLE IF NOT EXISTS "oauth_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "code" text NOT NULL,
  "client_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "code_challenge_method" text NOT NULL DEFAULT 'S256',
  "scope" text,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_codes_code_unique" ON "oauth_codes" ("code");
CREATE INDEX IF NOT EXISTS "oauth_codes_expires_at_idx" ON "oauth_codes" ("expires_at");
