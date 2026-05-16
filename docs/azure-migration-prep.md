# Azure Migration Prep (Vercel + Azure PostgreSQL)

Use this checklist before cloning to `fcs1-jo-azure`.

## 1) Provision Azure PostgreSQL

1. Create **Azure Database for PostgreSQL Flexible Server**.
2. Create database (for example: `fcs1_jo`).
3. Enable SSL (`sslmode=require` in connection string).
4. Configure firewall/network so Vercel can connect.
   - If you stay on Vercel Free, avoid strict fixed-IP allowlist assumptions.

## 2) Load Schema

Run the baseline schema:

```bash
psql "<DATABASE_URL_UNPOOLED_OR_DATABASE_URL>" -f sql/schema.sql
```

If your DB already exists, also apply incremental migrations:

```bash
psql "<DATABASE_URL_UNPOOLED_OR_DATABASE_URL>" -f sql/migrations/001_upload_tracking.sql
psql "<DATABASE_URL_UNPOOLED_OR_DATABASE_URL>" -f sql/migrations/002_jo_schema_alignment.sql
psql "<DATABASE_URL_UNPOOLED_OR_DATABASE_URL>" -f sql/migrations/003_record_scope_columns.sql
```

Then seed at least one organization record used by upload job creation:

```sql
insert into public.organizations (organization_code, organization_name, timezone)
values ('WYNN', 'Wynn Group', 'Asia/Macau')
on conflict (organization_code) do nothing;
```

## 3) Environment Variables

Set in Vercel project:

- `DATABASE_URL`
- `DATABASE_URL_UNPOOLED` (optional)
- `NEXT_PUBLIC_APP_URL`

Local `.env.local` should match `.env.example`.

## 4) Reset/Retention Notes

- Staging tables (`im_staging_rows`, `jo_staging_rows`) are temporary.
- Finalize flow should delete per-job staging rows after success.
- `source_row_id` in record tables is nullable and **not FK-linked** to staging,
  so staging can be truncated safely when needed.

## 5) Smoke Test

1. Upload small IM file.
2. Upload small JO file.
3. Confirm:
   - `upload_jobs` status is `completed`
   - records exist in `im_records` / `jo_records`
   - dashboard rows exist in `im_dashboard_json` / `jo_dashboard_json`


