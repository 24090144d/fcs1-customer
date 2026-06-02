# Option 1 Onboarding Runbook (Per-Customer Isolation)

## 1) Provision customer infrastructure
- Create a Neon project and customer database `appdb`
- Create DB user `app_user` with least privileges
- Configure the Neon connection string and store it as a GitHub secret

## 2) Initialize schema
Run in order:
1. `sql/schema.sql`
2. `sql/migrations/001_upload_tracking.sql`
3. `sql/migrations/002_jo_schema_alignment.sql`
4. `sql/migrations/003_record_scope_columns.sql`
5. `sql/migrations/004_bigint_id_defaults.sql`
6. `sql/migrations/005_ai_chart_playground.sql`

## 3) Create Vercel project (per customer)
- Project name: `fcs1-<customer-code>`
- Link this repo
- Set env vars from `.env.customer.template`
- Set `DATABASE_URL` to the customer Neon connection string

## 4) Deploy and validate
- Deploy production
- Upload sample IM and JO CSV
- Verify dashboard rendering, filters, i18n, and reset flow

## 5) Operational controls
- Separate backups per customer
- Monitoring alerts per customer
- Rotate DB password and secrets regularly
- Restrict admin reset access
