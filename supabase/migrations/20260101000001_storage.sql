-- Private bucket for uploaded interviews (audio, .txt, .md, .docx).
-- Objects live under "<owner uuid>/<project uuid>/<file>". Only the owner can touch them.
-- Skipped automatically when the storage schema is absent (plain Postgres in tests).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('interviews', 'interviews', false, 26214400)
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

    execute $p$create policy interviews_owner_select on storage.objects for select to authenticated
      using (bucket_id = 'interviews' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy interviews_owner_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'interviews' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy interviews_owner_update on storage.objects for update to authenticated
      using (bucket_id = 'interviews' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy interviews_owner_delete on storage.objects for delete to authenticated
      using (bucket_id = 'interviews' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;
