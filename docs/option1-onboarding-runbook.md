# Option 1 Onboarding Runbook (Per-Customer Isolation)

## 1) Provision customer infrastructure
- Create Azure PostgreSQL flexible server and database `appdb`
- Create DB user `app_user` with least privileges
- Configure firewall / private networking

## 2) Initialize schema
Run in order:
1. `sql/schema.sql`
2. `sql/migrations/001_upload_tracking.sql`
3. `sql/migrations/002_jo_schema_alignment.sql`
4. `sql/migrations/003_record_scope_columns.sql`

## 3) Create Vercel project (per customer)
- Project name: `fcs1-<customer-code>`
- Link this repo
- Set env vars from `.env.customer.template`

## 4) Deploy and validate
- Deploy production
- Upload sample IM and JO CSV
- Verify dashboard rendering, filters, i18n, and reset flow

## 5) Operational controls
- Separate backups per customer
- Monitoring alerts per customer
- Rotate DB password and secrets regularly
- Restrict admin reset access
