-- Style profile: a separate encrypted sidecar storing visual styling
-- (fonts, colors, sizes, spacing, page margins) alongside the structural
-- ProseMirror state and the structured Glyph payload. See
-- packages/style-profile for the schema.

-- 1. Add encrypted style profile columns to documents.
ALTER TABLE documents
  ADD COLUMN style_profile_encrypted text,
  ADD COLUMN style_profile_iv text,
  ADD COLUMN style_profile_tag text;

-- 2. User-saved brand profiles table.
CREATE TABLE style_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Encrypted JSON of a StyleProfile (Zod-validated client-side before save).
  profile_encrypted text NOT NULL,
  profile_iv text NOT NULL,
  profile_tag text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_style_profiles_user ON style_profiles(user_id);
CREATE UNIQUE INDEX uniq_style_profiles_user_default
  ON style_profiles(user_id) WHERE is_default = true;

ALTER TABLE style_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own style profiles" ON style_profiles
  FOR ALL USING (auth.uid() = user_id);
