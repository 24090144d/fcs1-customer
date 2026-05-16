# Onboarding Automation Preparation Checklist

Complete these before running `.github/workflows/onboard-customer.yml`.

## 1) GitHub repository settings
- Add repository secret `VERCEL_TOKEN`.
- Add repository secret `VERCEL_ORG_ID` (team/org id used by your Vercel projects).
- Create environment `production` and add required approvers if needed.

## 2) Azure database preparation
- Provision Azure PostgreSQL Flexible Server and customer database.
- Create least-privilege app user credentials.
- Confirm firewall/private networking allows GitHub Actions runner connectivity, or run workflow from a self-hosted runner inside your network.
- Prepare final customer `DATABASE_URL` with `sslmode=require`.

## 3) Vercel access
- Ensure `VERCEL_TOKEN` can create projects and manage env vars.
- Ensure the GitHub repo is authorized in the target Vercel org/team.

## 4) First-run inputs
- `customer_code` (for example `ACME`)
- `customer_name` (for example `Acme Hospitality`)
- `database_url` (customer-specific)
- `release_ref` (`main` or tag)
- `domain` (optional at first run)

## 5) Manual help required if blocked
- If project creation fails with permission error: grant Vercel token access to org/team.
- If DB migration fails on connectivity: adjust Azure firewall/private endpoint or switch to self-hosted runner.
- If domain attach fails: complete DNS verification in Vercel and rerun workflow.
