# Onboarding Automation Preparation Checklist

Complete these before running `.github/workflows/onboard-customer.yml`.

## 1) GitHub repository settings
- Add repository secret `VERCEL_TOKEN`.
- Add repository secret `VERCEL_ORG_ID` (team/org id used by your Vercel projects).
- Create environment `production` and add required approvers if needed.

## 2) Neon database preparation
- Provision one Neon project per customer/chain you want isolated.
- Create the customer database and least-privilege app user in Neon.
- Prepare the final customer `DATABASE_URL` with `sslmode=require`.
- Add repo secrets for each customer DB:
  - `DATABASE_URL_CN`
  - `DATABASE_URL_UNPOOLED_CN`
  - `DATABASE_URL_HK`
  - `DATABASE_URL_UNPOOLED_HK`
- The onboarding workflow auto-selects `DATABASE_URL_<CUSTOMER_CODE>` unless you override `database_url`.

## 3) Vercel access
- Ensure `VERCEL_TOKEN` can create projects and manage env vars.
- Ensure the GitHub repo is authorized in the target Vercel org/team.

## 4) First-run inputs
- `customer_code` (for example `CN`)
- `customer_name` (for example `CN`)
- `database_url` (customer-specific)
- `database_url_secret_name` (optional override; usually not needed)
- `release_ref` (`main` or tag)
- `domain` (optional at first run)

## 5) Manual help required if blocked
- If project creation fails with permission error: grant Vercel token access to org/team.
- If DB migration fails on connectivity: verify the Neon connection string, project access, and network path.
- If domain attach fails: complete DNS verification in Vercel and rerun workflow.
