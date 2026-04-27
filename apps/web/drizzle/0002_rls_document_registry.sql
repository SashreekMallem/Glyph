-- RLS for document_types + document_templates -------------------------------
-- System rows are globally visible; custom rows are per-user.

alter table document_types enable row level security;

drop policy if exists "document_types_select_visible" on document_types;
create policy "document_types_select_visible" on document_types
  for select using (is_system = true or user_id = auth.uid());

drop policy if exists "document_types_insert_own" on document_types;
create policy "document_types_insert_own" on document_types
  for insert with check (is_system = false and user_id = auth.uid());

drop policy if exists "document_types_update_own" on document_types;
create policy "document_types_update_own" on document_types
  for update using (is_system = false and user_id = auth.uid())
  with check (is_system = false and user_id = auth.uid());

drop policy if exists "document_types_delete_own" on document_types;
create policy "document_types_delete_own" on document_types
  for delete using (is_system = false and user_id = auth.uid());

alter table document_templates enable row level security;

drop policy if exists "document_templates_select_visible" on document_templates;
create policy "document_templates_select_visible" on document_templates
  for select using (is_system = true or user_id = auth.uid());

drop policy if exists "document_templates_insert_own" on document_templates;
create policy "document_templates_insert_own" on document_templates
  for insert with check (is_system = false and user_id = auth.uid());

drop policy if exists "document_templates_update_own" on document_templates;
create policy "document_templates_update_own" on document_templates
  for update using (is_system = false and user_id = auth.uid())
  with check (is_system = false and user_id = auth.uid());

drop policy if exists "document_templates_delete_own" on document_templates;
create policy "document_templates_delete_own" on document_templates
  for delete using (is_system = false and user_id = auth.uid());
