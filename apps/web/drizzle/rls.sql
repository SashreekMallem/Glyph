-- Glyph Row Level Security policies.
-- Apply after Drizzle-generated migrations. Run in Supabase SQL editor
-- (or via psql using a superuser connection).
--
-- Model:
--   * Every user-owned table gets RLS enabled.
--   * Access is scoped to auth.uid() on user_id.
--   * api_usage authorizes via a join through api_keys.
--   * The `service_role` key bypasses RLS; server-side tRPC procedures
--     use it and MUST manually filter by ctx.user.id. See
--     apps/web/src/server/trpc.ts for enforcement.

-- users_profile -------------------------------------------------------------
alter table users_profile enable row level security;

drop policy if exists "users_profile_select_own" on users_profile;
create policy "users_profile_select_own" on users_profile
  for select using (id = auth.uid());

drop policy if exists "users_profile_insert_own" on users_profile;
create policy "users_profile_insert_own" on users_profile
  for insert with check (id = auth.uid());

drop policy if exists "users_profile_update_own" on users_profile;
create policy "users_profile_update_own" on users_profile
  for update using (id = auth.uid());

drop policy if exists "users_profile_delete_own" on users_profile;
create policy "users_profile_delete_own" on users_profile
  for delete using (id = auth.uid());

-- documents -----------------------------------------------------------------
alter table documents enable row level security;

drop policy if exists "documents_select_own" on documents;
create policy "documents_select_own" on documents
  for select using (user_id = auth.uid());

drop policy if exists "documents_insert_own" on documents;
create policy "documents_insert_own" on documents
  for insert with check (user_id = auth.uid());

drop policy if exists "documents_update_own" on documents;
create policy "documents_update_own" on documents
  for update using (user_id = auth.uid());

drop policy if exists "documents_delete_own" on documents;
create policy "documents_delete_own" on documents
  for delete using (user_id = auth.uid());

-- document_exports ----------------------------------------------------------
alter table document_exports enable row level security;

drop policy if exists "document_exports_select_own" on document_exports;
create policy "document_exports_select_own" on document_exports
  for select using (user_id = auth.uid());

drop policy if exists "document_exports_insert_own" on document_exports;
create policy "document_exports_insert_own" on document_exports
  for insert with check (user_id = auth.uid());

drop policy if exists "document_exports_update_own" on document_exports;
create policy "document_exports_update_own" on document_exports
  for update using (user_id = auth.uid());

drop policy if exists "document_exports_delete_own" on document_exports;
create policy "document_exports_delete_own" on document_exports
  for delete using (user_id = auth.uid());

-- api_keys ------------------------------------------------------------------
alter table api_keys enable row level security;

drop policy if exists "api_keys_select_own" on api_keys;
create policy "api_keys_select_own" on api_keys
  for select using (user_id = auth.uid());

drop policy if exists "api_keys_insert_own" on api_keys;
create policy "api_keys_insert_own" on api_keys
  for insert with check (user_id = auth.uid());

drop policy if exists "api_keys_update_own" on api_keys;
create policy "api_keys_update_own" on api_keys
  for update using (user_id = auth.uid());

drop policy if exists "api_keys_delete_own" on api_keys;
create policy "api_keys_delete_own" on api_keys
  for delete using (user_id = auth.uid());

-- api_usage -----------------------------------------------------------------
alter table api_usage enable row level security;

drop policy if exists "api_usage_select_via_key" on api_usage;
create policy "api_usage_select_via_key" on api_usage
  for select using (
    exists (
      select 1 from api_keys k
      where k.id = api_usage.api_key_id
        and k.user_id = auth.uid()
    )
  );

drop policy if exists "api_usage_insert_via_key" on api_usage;
create policy "api_usage_insert_via_key" on api_usage
  for insert with check (
    exists (
      select 1 from api_keys k
      where k.id = api_usage.api_key_id
        and k.user_id = auth.uid()
    )
  );
