# CN Customer Onboarding Automation Summary (2026-05-16)

## Completed
- Created customer database: `fcs1_cn`.
- Created/updated least-privilege app user: `app_user_cn`.
- Added reusable DB provisioning script:
  - `scripts/provision-customer-db.js`
  - `npm run provision:customer-db`
- Updated onboarding workflow to support secret-based DB URL:
  - `.github/workflows/onboard-customer.yml`
  - New optional input: `database_url_secret_name`
  - If provided, workflow reads `secrets[database_url_secret_name]`.
  - Falls back to manual `database_url` input.

## Generated Database URL
- `postgresql://app_user_cn:<password>@<neon-host>/fcs1_cn?sslmode=require`
- Current generated password is stored in command output from provisioning run.

## What You Need To Configure In GitHub
1. Add secret `DATABASE_URL_CN` with the full URL above.
2. Ensure existing secrets are set:
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
3. In workflow run:
   - `customer_code=cn`
   - `customer_name=CN`
   - `database_url_secret_name=DATABASE_URL_CN`
   - `release_ref=main`

## Remaining Manual Infrastructure Checks
- Confirm Azure firewall/private networking allows the Actions runner to connect to PostgreSQL.
- If private-only network is required, run workflow on a self-hosted runner in your network.
- If using custom domain, complete DNS verification in Vercel.

## Execution Command For Future Customers
```powershell
$env:ADMIN_DATABASE_URL="<azure-admin-database-url>"
$env:CUSTOMER_CODE="<customer-code>"
npm run provision:customer-db
```
