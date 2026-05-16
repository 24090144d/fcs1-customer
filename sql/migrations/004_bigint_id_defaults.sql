-- Migration 004: Ensure bigint ID columns auto-generate values.
-- Fixes row insert failures when app payloads omit bigint primary keys.

do $$
declare
  rec record;
  seq_name text;
  full_table text;
begin
  for rec in
    select table_schema, table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name = 'id'
      and data_type = 'bigint'
      and table_name in ('im_staging_rows', 'jo_staging_rows', 'im_records', 'jo_records')
  loop
    full_table := format('%I.%I', rec.table_schema, rec.table_name);
    seq_name := format('%I.%I_id_seq', rec.table_schema, rec.table_name);

    execute format('create sequence if not exists %s', seq_name);
    execute format('alter sequence %s owned by %s.%I', seq_name, full_table, rec.column_name);
    execute format('alter table %s alter column %I set default nextval(%L)', full_table, rec.column_name, seq_name);
  end loop;
end $$;
