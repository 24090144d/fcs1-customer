# fcs1-customer

Enterprise-ready baseline for **Option 1 (per-customer isolated deployment)**.

## What this repo is prepared for
- One customer = one Vercel project
- One customer = one Azure PostgreSQL database/server
- Dedicated secrets and domain per customer
- No cross-customer data sharing

## Quick start (new customer)
1. Copy `.env.customer.template` to `.env.local` and fill values.
2. Create customer DB/schema in Azure using `sql/schema.sql` + `sql/migrations`.
3. Create a new Vercel project for the customer and set env vars.
4. Deploy and run onboarding upload to validate.

## Safety
- `data/` is git-ignored (local CSV only)
- `.vercel/` is removed so this repo is not bound to old project
