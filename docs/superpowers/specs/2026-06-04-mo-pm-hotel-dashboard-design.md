# MO/PM Hotel Dashboard MVP Design

Date: 2026-06-04
Status: Draft approved in chat, pending written-spec review
Route: `/dashboard?hotel=<HOTEL>&chain=<CHAIN>&module=mo`

## Objective

Add a new maintenance dashboard module using a single uploaded `MO` CSV that contains both corrective maintenance work orders (`MO`) and preventive maintenance work orders (`PM`). The system must ingest one CSV, derive a new `type` field from `Job Order`, store all rows in one physical table, and render one hotel maintenance dashboard with a top switch between `MO` and `PM` analysis modes.

## Scope

In scope for MVP:
- Accept `MO` CSV files in onboarding/upload
- Parse and store all 34 source columns in a new `mo_records` table
- Derive `type` from `job_order`
- Generate one hotel dashboard snapshot in `mo_dashboard_json`
- Support one hotel dashboard route using `module=mo`
- Add one top switch in the dashboard toolbar for `MO` / `PM`
- Implement 10 KPIs + 20 charts for `MO`
- Implement 5 KPIs + 10 charts for `PM`
- Support date filtering, export, dark/light, and existing theme system

Out of scope for MVP:
- Corp MO dashboard
- Corp PM dashboard
- AI builder support for MO/PM
- PM-specific separate upload module
- Full text analytics on remarks/comments fields
- Multi-tenant licensing/role changes specific to MO/PM

## Input Dataset

The uploaded CSV contains these source columns:
1. Date&Time (Created)
2. Job Status
3. Job Order
4. Guest Name
5. Location
6. Category
7. Defect
8. Remarks
9. Date&Time (Deadline)
10. Date&Time (Completed)
11. Escalation Level
12. Escalation To
13. Building
14. Floor
15. Asset
16. Created By
17. Created By (Dept)
18. Assigned To
19. Completed By
20. Inspected By
21. Attachment
22. Checklist Name
23. Checklist Status
24. Stock Out By
25. Stock Out Qty
26. Inventory Item
27. Comment
28. Remarks in Proof of Completion
29. eSignature
30. Inspection Remark
31. Inspection Result
32. Guest Related
33. Cancel Reason
34. Stop Reason

## Core Design Decision

### One upload module, one table, two analysis modes

- The filename/module validator accepts only `MO`
- The CSV can contain both `MO-*` and `PM-*` job order values
- All rows are stored in one new table: `mo_records`
- New derived field: `type`
  - `MO` when `job_order` starts with `MO`
  - `PM` when `job_order` starts with `PM`
- The hotel dashboard route stays in the existing route family:
  - `/dashboard?hotel=WM&chain=WYNN&module=mo`
- The dashboard toolbar adds a mode switch:
  - `MO`
  - `PM`

This avoids duplicate ingestion logic and keeps MO/PM analysis aligned on one dataset.

## Schema Design

### New table: `mo_records`

Required persisted fields:
- Scope fields:
  - `organization_id`
  - `upload_job_id`
  - `uploaded_file_id`
  - `source_row_id`
  - `chain_code`
  - `hotel_code`
  - `module_code`
  - `country_code`
- Raw source fields:
  - `created_datetime`
  - `job_status`
  - `job_order`
  - `guest_name`
  - `location`
  - `category`
  - `defect`
  - `remarks`
  - `deadline_datetime`
  - `completed_datetime`
  - `escalation_level`
  - `escalation_to`
  - `building`
  - `floor`
  - `asset`
  - `created_by`
  - `created_by_department`
  - `assigned_to`
  - `completed_by`
  - `inspected_by`
  - `attachment`
  - `checklist_name`
  - `checklist_status`
  - `stock_out_by`
  - `stock_out_qty`
  - `inventory_item`
  - `comment`
  - `remarks_proof_of_completion`
  - `e_signature`
  - `inspection_remark`
  - `inspection_result`
  - `guest_related`
  - `cancel_reason`
  - `stop_reason`
  - `normalized_row` JSONB
- Derived fields:
  - `type`
  - `is_completed`
  - `is_cancelled`
  - `is_stopped`
  - `is_open`
  - `is_overdue`
  - `is_escalated`
  - `is_guest_related`
  - `has_attachment`
  - `has_checklist`
  - `has_inventory_usage`
  - `has_esignature`
  - `has_inspection`
  - `inspection_passed`
  - `inspection_failed`
  - `resolution_minutes`
  - `sla_minutes`
  - `deadline_variance_minutes`
  - `completed_within_sla`
  - `created_date`
  - `created_hour`
  - `created_week`
  - `created_month`
  - `created_quarter`
  - `completed_date`
  - `stock_out_qty_num`
  - `escalation_level_num`

### New table: `mo_dashboard_json`

Match the existing `im_dashboard_json` / `jo_dashboard_json` pattern:
- `id`
- `upload_job_id`
- `generated_json`
- `created_at`

`generated_json.meta.schema` should use the new schema marker `mo-v1`.

## Derived Field Rules

### Type detection
- `type = 'MO'` when `job_order` matches `^MO`
- `type = 'PM'` when `job_order` matches `^PM`
- If neither prefix matches, the row is invalid for MVP and should be rejected during staging validation with a clear error tied to `Job Order`.

### Status normalization
Map raw `job_status` into normalized flags:
- completed keywords => `is_completed = true`
- cancelled keywords => `is_cancelled = true`
- stopped/paused keywords => `is_stopped = true`
- open/in-progress/pending-like statuses => `is_open = true`
- `is_overdue = true` when current row is not completed and deadline has passed, or completed after deadline depending on KPI context

### Time calculations
- `resolution_minutes = completed_datetime - created_datetime`
- `sla_minutes = deadline_datetime - created_datetime`
- `deadline_variance_minutes = completed_datetime - deadline_datetime`
- `completed_within_sla = is_completed && completed_datetime <= deadline_datetime`
- `created_week`, `created_month`, `created_quarter` use the same bucket strategy already used in IM/JO

### Quality / compliance calculations
- `has_attachment = attachment` not blank
- `has_checklist = checklist_name` not blank
- `has_inventory_usage = inventory_item` not blank or `stock_out_qty_num > 0`
- `has_esignature = e_signature` truthy
- `has_inspection = inspected_by` or `inspection_result` present
- `inspection_passed` / `inspection_failed` based on normalized `inspection_result`

### Inventory / escalation calculations
- `stock_out_qty_num` parsed numeric
- `escalation_level_num` parsed numeric
- `is_escalated = escalation_level_num > 0` or `escalation_to` present

## Upload and Validation Flow

### Onboarding / upload
- Extend recognized modules from `IM`, `JO` to `IM`, `JO`, `MO`
- Filename validator accepts `...-MO-...csv`
- Column validator must verify the 34 MO fields
- Upload job `module_code` remains `mo`

### Finalize path
- Add a dedicated `mo_staging_rows` table following the existing IM/JO staging pattern
- Finalize inserts rows into `mo_records`
- Finalize computes all derived fields during insert
- Finalize generates one `mo_dashboard_json` row per upload job

## Dashboard JSON Structure

`generated_json` should mirror the existing dashboard contract closely enough for reuse in `DashboardClient`:
- `meta`
- `kpis`
- `eac` or executive chart block
- `charts`
- `raw_daily`
- `summary`

Because the toolbar must switch between `MO` and `PM` without reloading a different module, the JSON should contain type-scoped aggregates. Two viable representations were considered:
- separate `summary_by_type` / `charts_by_type` / `kpis_by_type`
- one unified summary plus client-side filtering from richer raw aggregates

Recommendation for MVP:
- store `kpis_by_type: { MO, PM }`
- store `charts_by_type: { MO, PM }`
- store `raw_daily_by_type: { MO, PM }`
- keep top-level `meta` shared

This is the clearest and least brittle approach for the first release.

## Hotel Maintenance Dashboard UX

Route:
- `/dashboard?hotel=<HOTEL>&chain=<CHAIN>&module=mo`

Toolbar controls:
- date range
- quick date filters
- `Type` switch: `MO / PM`
- category filter
- building filter
- export PDF
- dark/light toggle

Behavior:
- Switching `Type` swaps KPI and chart sets using the same dashboard page and uploaded dataset
- Existing theme system applies unchanged
- Existing index numbering convention should continue

## KPI Set

### MO KPIs (10)
1. Total Work Orders
2. Completion Rate
3. Overdue Rate
4. SLA Compliance Rate
5. Avg Resolution Minutes
6. Escalation Rate
7. Guest-Related Order Rate
8. Attachment Coverage Rate
9. Inspection Failure Rate
10. Inventory Consumption Quantity

### PM KPIs (5)
1. Total PM Orders
2. PM Completion Rate
3. Checklist Completion Rate
4. Inspection Pass Rate
5. Avg Resolution Minutes

## Chart Set

### MO Charts (20)
1. Orders by Day
2. Orders by Hour
3. Status Distribution
4. Category Distribution
5. Defect Distribution
6. Building Distribution
7. Floor Distribution
8. Asset Distribution
9. Assigned To Distribution
10. Completed By Distribution
11. Created By Department Distribution
12. Escalation Level Distribution
13. Guest Related vs Non-Guest
14. Overdue Trend
15. SLA Compliance Trend
16. Avg Resolution by Category
17. Defect by Category drilldown
18. Building -> Floor drilldown
19. Inventory Item Usage
20. Cancel / Stop Reason Distribution

### PM Charts (10)
1. PM Orders by Day
2. PM Status Distribution
3. Checklist Status Distribution
4. Inspection Result Distribution
5. PM by Building
6. PM by Floor
7. PM by Asset
8. PM Completion Trend
9. Checklist -> Inspection drilldown
10. Inventory Usage for PM

## Reuse Strategy

The implementation should explicitly reuse the existing IM/JO patterns:
- filename parsing and scope extraction
- upload jobs / staging rows / uploaded files flow
- finalize route shape
- dashboard snapshot storage
- `/dashboard` route rendering
- theme system
- export / filtering patterns

Do not overload `jo_records` or `jo_dashboard_json`. MO/PM semantics differ enough that a dedicated maintenance schema is the correct boundary.

## Error Handling

Validation errors:
- reject files with module other than `MO`
- reject missing required MO columns
- reject unparseable critical timestamps when they prevent core KPI computation, or mark row invalid during staging

Ingestion resilience:
- preserve raw row in `normalized_row`
- tolerate optional blanks for attachment, checklist, inspection, stock, and guest fields
- avoid null/NaN propagation in KPI calculations

Dashboard resilience:
- if no PM rows exist, PM mode should show empty-state cards/charts, not crash
- if no MO rows exist, MO mode should do the same
- filters must reset correctly when switching hotel or dashboard identity

## Testing Strategy

Required tests for MVP:
- filename validation accepts `MO` and rejects invalid module codes
- row parser maps all 34 columns
- `type` derivation from `job_order`
- derived flag calculations for representative rows
- finalize route inserts `mo_records`
- finalize route writes `mo_dashboard_json`
- hotel dashboard with `module=mo` renders
- MO/PM switch changes KPI/chart sets correctly
- date filter works independently within MO and PM modes

Use the provided Maldives sample CSV as a representative fixture.

## Migration / Deployment Impact

Schema changes required:
- create `mo_records`
- create `mo_dashboard_json`
- create indexes for scope, type, created_datetime, status, category, building, asset, job_order
- update schema bootstrap and any migration automation

No customer onboarding flow change is required beyond allowing `MO` module data once schema is present.

## Risks and Constraints

Main risks:
- status normalization ambiguity from source data
- checklist / inspection semantics may vary by property
- some PM metrics may be sparse if checklist/inspection fields are often blank
- storing both MO and PM views in one dashboard JSON must remain simple enough to maintain

MVP mitigation:
- keep PM KPI/chart set smaller than MO
- use direct, auditable derived-field logic
- avoid corp-level MO/PM until hotel-level semantics are stable

## Recommended Implementation Order

1. Add schema and TypeScript types for `mo_records` and `mo_dashboard_json`
2. Extend upload/onboarding validation for `MO`
3. Extend finalize pipeline for MO ingestion and derived fields
4. Generate maintenance dashboard JSON with `MO` and `PM` scoped aggregates
5. Extend dashboard route and client rendering for `module=mo`
6. Add top `MO / PM` switch and hotel filters
7. Implement MO KPI/chart set
8. Implement PM KPI/chart set
9. Verify locally with the Maldives sample CSV
10. Push, deploy, and validate on target customer environments
