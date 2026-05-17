# Onboarding Verification Report: china

- Overall: **PASS**
- PASS: 10
- WARN: 0
- FAIL: 0

| Check | Status | Detail |
|---|---|---|
| vercel_project_exists | PASS | Project fcs1-china found |
| vercel_latest_deployment | PASS | Latest deployment READY (fcs1-china-hf8x2vgc8-fcs1-s-projects.vercel.app) |
| vercel_env_vars | PASS | Required env vars present |
| database_target | PASS | Connected to expected DB fcs1_china |
| database_user | PASS | Connected as app_user_china |
| database_schema_tables | PASS | Public tables count = 9 |
| smoke_/ | PASS | HTTP 200 |
| smoke_/onboarding | PASS | HTTP 200 |
| smoke_/dashboard | PASS | HTTP 200 |
| smoke_/api/nav/dashboards | PASS | HTTP 200 |
