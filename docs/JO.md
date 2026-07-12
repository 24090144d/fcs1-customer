# JO / CJO Dashboard Reference

Source of truth: `app/api/uploads/finalize/route.ts` (`buildJoKpis`, `buildJoEac`, `buildJoCharts`, `joBenchmarkFor`), `app/dashboard/DashboardClient.tsx` (`buildCorpJoCharts`, client-injected `hotelJo01Chart`/`02`/`03`/`04`/`06`, `hotelJo2326Charts`, `hotelJo2728Charts`), and `lib/kpi-benchmarks.ts`. Titles/notes below are the live i18n text (`chart_titles_jo`/`chart_notes_jo`, English). Formulas are **not** localized — the string shown is always the literal from code, identical for hotel and corp.

**CJO KPIs reuse the exact same 10 KPI definitions as JO** (same ids, formulas, and benchmark thresholds) — the only difference is the underlying dataset is aggregated across the whole chain instead of a single hotel.

**Long Charts membership** (`JO_LONG_CHART_IDS`): `jo-23, jo-24, jo-25, jo-26, cjo-22, cjo-23, cjo-24, cjo-25, cjo-26, cjo-28`. Everything else renders in Simple Charts.

---

## 0. Recommended: Highest Business Value (4 KPIs + 4 Charts)

Out of the full set (10 KPIs, 24 JO/22 CJO Simple Charts, 4 JO/6 CJO Long Charts), these are the ones worth watching first — each earns its place by driving a *specific, unambiguous action* rather than just describing volume.

### KPIs

| Rank | KPI | Why it's top-tier |
|---|---|---|
| 1 | **kpi_02 — Completion Rate** | The single clearest measure of "is the service actually getting delivered." Every other KPI is a diagnostic of *why* completion is or isn't happening — this is the outcome metric leadership reads first. |
| 2 | **kpi_03 — SLA Compliance** | Ties directly to guest-facing commitments and brand/contractual standards. Unlike Completion Rate, this captures *timeliness*, not just eventual closure — a job completed 3 days late still hurts the guest even if it counts as "completed." |
| 3 | **kpi_05 — Escalation Rate** | A leading indicator, not a lagging one — escalations spike *before* guest complaints and reviews do. Low escalation with high completion means the team is genuinely in control, not just clearing a backlog under pressure. |
| 4 | **kpi_09 — Avg Resolution (min)** | Speed-to-resolution correlates most tightly with guest satisfaction scores of any duration metric available (more so than response time alone, since guests care about the problem being *fixed*, not just acknowledged). |

Deliberately excluded: kpi_01/kpi_10 are scale-dependent volume counters with no fixed benchmark (useful for context, not for a go/no-go read); kpi_04/kpi_06/kpi_07/kpi_08 are valuable secondary diagnostics but each is a narrower slice of what kpi_02/03/05/09 already surface.

### Charts

| Rank | Chart | Why it's top-tier |
|---|---|---|
| 1 | **jo-04 / CJO equivalent — Item Category vs Average Service Duration** | The only chart that plots *volume and speed on the same category axis simultaneously*. A category can look fine on either metric alone — this is what actually finds the "high demand + slow" combination that represents the biggest single opportunity for staffing or process investment. |
| 2 | **cjo-02 — Hotel → Escalation Rate by Service Category → Escalation Rate by Service Item** | Plots a *rate*, not a count, so it isn't biased toward whichever category happens to have the most volume. Drills all the way to the individual service item driving escalations — turns "we have an escalation problem" into "fix how we handle toilet-clog requests at LGM," a directly actionable finding. |
| 3 | **cjo-27 — SLA Compliance by Hotel** *(mirrors kpi_03 across the chain)* | The fastest chart in the whole set for an executive to scan and know which property needs intervention this week — one bar per hotel, one clear threshold (≥95% good, <85% bad). Pairs naturally with kpi_03 as its drill-in view. |
| 4 | **cjo-04 — Hotel → Delayed Duration Distribution → Assigned Department → Assigned To** | The only chart that carries accountability all the way to an individual assignee. Duration-bucket → department → person means a manager can go from "we have long delays" to "these three specific delays sit with this specific person" without leaving the chart — closes the loop from metric to performance conversation. |

Honorable mentions that didn't make the cut only because they overlap with #1–#4 above: **jo-11/cjo-01** (demand concentration by category/item — subsumed by jo-04's dual volume+duration view), **jo-01/cjo-22** (24-hour delayed distribution — useful for shift coverage, but a staffing-planning tool rather than a root-cause finder).

---

## 1. KPIs (10 — shared by JO and CJO)

| ID | Name | Notes | Formula | Good | Watch | Bad |
|---|---|---|---|---|---|---|
| kpi_01 | Total Job Orders | Total volume of job orders in scope. | `COUNT(JobOrder)` | — | — | No fixed benchmark; compare against same-hotel history or chain average. |
| kpi_02 | Completion Rate | Percentage of jobs completed successfully. | `SUM(completed_flag)/COUNT(*)*100` | ≥ 95% | 90–94.9% | < 90% |
| kpi_03 | SLA Compliance | Completed jobs delivered within SLA. | `(1-SUM(sla_breach_flag)/SUM(completed_flag))*100` | ≥ 95% | 90–94.9% | < 90% |
| kpi_04 | Timeout Rate | Percentage of jobs ending in timeout. | `SUM(timeout_flag)/COUNT(*)*100` | ≤ 1% | 1–2% | > 2% |
| kpi_05 | Escalation Rate | Share of jobs escalated for intervention. | `SUM(escalated_flag)/COUNT(*)*100` | ≤ 3% | 3–5% | > 5% |
| kpi_06 | Reassignment Rate | Share of jobs reassigned across teams. | `SUM(reassigned_flag)/COUNT(*)*100` | ≤ 5% | 5–10% | > 10% |
| kpi_07 | Avg Response (min) | Average minutes from create to acknowledge. | `AVG(response_min)` | ≤ 30 min | 31–60 min | > 60 min |
| kpi_08 | P90 Response (min) | 90th percentile of response time. | `P90(response_min)` | ≤ 60 min | 61–120 min | > 120 min |
| kpi_09 | Avg Resolution (min) | Average minutes from create to completion. | `AVG(resolution_min)` | ≤ 240 min | 241–480 min | > 480 min |
| kpi_10 | Total Quantity | Total requested quantity across all jobs. | `SUM(quantity)` | — | — | Scale-dependent; compare against the same hotel or prior periods. |

Direction: kpi_02/03 higher-is-better; kpi_04/05/06/07/08/09 lower-is-better; kpi_01/10 are neutral volume metrics with no fixed threshold.

---

## 2. JO (Hotel) — Simple Charts (24)

### jo-01 — 🟢 24-Hour Delayed Job Distribution → Top Service Items
- **Chart Type:** Column (2-level drilldown: hour → top 10 delayed service items)
- **Notes:** Delayed jobs (delay > 0) by hour of day (00:00–23:00). Click an hour to drill into the top 10 delayed service items for that hour.
- **Formula:** `COUNT(*) WHERE delay > 0 GROUP BY HOUR(created_datetime); drilldown: TOP 10 COUNT(*) BY service_item`
- **Good/Bad:** Healthy — delayed count near zero and flat across hours. Warning — delay spikes clustered in specific hours (add peak-hour coverage).

### jo-02 — 🟢 Delayed Duration Distribution → Top Service Items
- **Chart Type:** Column (2-level drilldown: 7 fixed duration buckets → top service items)
- **Notes:** Columns show delayed job counts grouped by delay-duration bucket. Click a bucket to drill into the top service items within that delay range.
- **Formula:** `COUNT(*) WHERE delay_duration > 0 BY duration_bucket; drilldown: TOP 10 COUNT(*) BY service_item`
- **Good/Bad:** Good — most delays < 15 min with few items repeating. Watch — a bucket ≥ 1h holds > 20% of delays. Bad — 4h+/8h+ buckets are non-trivial and dominated by one or two items (systemic bottleneck).

### jo-03 — 🟢 Top Service Items → Completed Job Duration Distribution
- **Chart Type:** Bar (2-level drilldown: top 10 items by completed jobs → duration buckets)
- **Notes:** Top 10 service items by completed jobs. Click an item bar to drill into its completed-job duration distribution.
- **Formula:** `COUNT(*) WHERE completed BY service_item; drilldown: COUNT(*) BY duration_bucket`
- **Good/Bad:** Good — most completed jobs in the ≤ 30 min buckets. Watch — a growing 1–4h share. Bad — a heavy 4h+ tail for a high-volume item (slow execution).

### jo-04 — 🟢 Item Category vs Average Service Duration
- **Chart Type:** Dual-axis Column (colorful, per-category) + Line — job count (primary axis) vs average resolution duration in minutes (secondary axis)
- **Notes:** Colored bars show job count per service category; the line shows average service (resolution) duration in minutes for that category.
- **Formula:** `COUNT(*) BY service_item_category; AVG(completed_datetime - created_datetime) BY service_item_category`
- **Good/Bad:** Good — high-volume categories have low average duration. Watch — a category combines high volume with rising duration. Bad — a low-volume category has a disproportionately long average duration (process bottleneck).

### jo-05 — 🟣 Service Category → Service Items
- **Chart Type:** Pie/Donut drilldown (category → top service items)
- **Notes:** Click a service category slice to drill down into top service items by volume.
- **Formula:** `COUNT(*) by category then item`
- **Good/Bad:** Healthy — no single item dominates a category. Warning — one item is a large share of a high-volume category (recurring strain).

### jo-06 — ⏰ 🟢 Job Status by 24-Hour Job Distribution
- **Chart Type:** Column (2-level drilldown: status → 24-hour distribution)
- **Notes:** Job statuses ranked by total count (bar). Click a status to drill into its 24-hour distribution.
- **Formula:** `COUNT(*) BY job_status; drilldown: COUNT(*) BY HOUR(created_datetime)`
- **Good/Bad:** Good — most jobs completed/closed and 24-h spread flat. Watch — timeout or delayed count > 10% of total. Bad — a growing open/pending share or timeout spike in specific hours.

### jo-07 — 🟣 SLA Compliance vs Jobs Trend
- **Chart Type:** Dual-axis Column + Spline — weekly job volume (bars) vs SLA % (line), ascending week order
- **Notes:** Compares weekly incoming volume with SLA performance in ascending week order.
- **Formula:** `COUNT(*) and SLA% by created_week`
- **Good/Bad:** Good — SLA ≥ 95% held through peak weeks. Watch — 85–95%. Bad — SLA < 85% or dropping on surge weeks.

### jo-08 — 🟣 Timeout Trend
- **Chart Type:** Column — weekly timeout volume
- **Notes:** Weekly timeout volume trend to detect service interruptions early.
- **Formula:** `SUM(timeout_flag) by created_week`
- **Good/Bad:** Healthy — flat or falling timeout count near zero. Warning — any upward timeout spike week-over-week.

### jo-09 — 🟣 Status vs Top 10 Departments
- **Chart Type:** Stacked column — job status mix across top 10 departments
- **Notes:** Vertical stacked view of status mix across the top 10 departments by volume.
- **Formula:** `COUNT(*) by department and status`
- **Good/Bad:** Healthy — Open + Pending < 15% per department. Warning — a department above 30% Open/Pending (queue congestion).

### jo-10 — 🟣 Top 10 Service Category Volume
- **Chart Type:** Dual-axis Column + Spline — job count (bars) vs close rate % (line)
- **Notes:** Shows demand and close rate by top service categories.
- **Formula:** `COUNT(*) and completed% by category`
- **Good/Bad:** Good — high-volume categories close ≥ 90%. Watch — 75–90%. Bad — a high-volume category closing < 75% (critical gap).

### jo-11 — 🟢 Top Service Item Category → 24-Hour Job Distribution
- **Chart Type:** Column (2-level drilldown: category → 24-hour distribution)
- **Notes:** Top 10 service item categories ranked by total job count (column). Click a category to drill into its 24-hour distribution.
- **Formula:** `COUNT(*) BY service_item_category; drilldown: COUNT(*) BY HOUR(created_datetime)`
- **Good/Bad:** Good — top category ≤ 30% of total jobs and 24-h spread even. Watch — one category dominates > 40%. Bad — a single category > 50% with a sharp peak hour (staffing gap).

### jo-12 — 🟣 Top 10 Assigned Department Volume
- **Chart Type:** Bar
- **Notes:** Shows departments receiving the highest assignment load.
- **Formula:** `COUNT(*) by assigned_department`
- **Good/Bad:** Healthy — assignment load balanced across departments. Warning — one department above ~30% of assignments (overload/burnout risk).

### jo-13 — 🟣 Top 10 Created By Department Volume
- **Chart Type:** Bar
- **Notes:** Shows request-origin departments generating the most JOs.
- **Formula:** `COUNT(*) by created_by_department`
- **Good/Bad:** Healthy — requests spread across source departments. Warning — one source department dominates (upstream process gap).

### jo-14 — Top 10 Completed Department Volume
- **Chart Type:** Bar
- **Notes:** Shows departments completing the highest JO volume.
- **Formula:** `COUNT(*) by completed_department`
- **Good/Bad:** Healthy — completion share ≈ assignment share per department. Warning — completion share well below assignment share (execution bottleneck).

### jo-15 — 🟣 Top Location Volume
- **Chart Type:** Bar
- **Notes:** Highlights locations with the largest JO demand.
- **Formula:** `COUNT(*) by location`
- **Good/Bad:** Healthy — demand spread across locations. Warning — one location is a clear hotspot needing dedicated staffing or preventive action.

### jo-16 — 🟣 Escalation by Department *(⚠ title/content mismatch — see note)*
- **Chart Type:** Pie/Donut drilldown (category → top service items)
- **Notes:** Displayed title reads "Escalation by Department," but the chart's actual data/note (`buildDrilldownDonut('jo-16', 'Avg Response by Service Category → Service Items', ...)`) is the **average first-response time by category**, not escalation or department data. This is a stale i18n title left over from an earlier chart-id reshuffle — the id/content pairing itself is correct and stable, only the *displayed title* is wrong.
- **Formula:** `AVG(response_min) by category then item`
- **Good/Bad:** No benchmark line currently set for this content (the i18n note text describes escalation, not response time — recommend re-pointing the title to match the real content, or vice versa, in a future fix).

### jo-17 — 🟣 Reassignment by Department *(⚠ title/content mismatch — see note)*
- **Chart Type:** Pie/Donut drilldown (category → top service items)
- **Notes:** Displayed title reads "Reassignment by Department," but the chart's actual data (`buildDrilldownDonut('jo-17', 'Avg Resolution by Service Category → Service Items', ...)`) is the **average end-to-end resolution time by category**, not reassignment or department data. Same stale-title issue as jo-16.
- **Formula:** `AVG(resolution_min) by category then item`
- **Good/Bad:** No benchmark line currently set for this content (the i18n note text describes reassignment, not resolution time — recommend re-pointing the title to match the real content, or vice versa, in a future fix).

### jo-18 — 🟣 SLA Breach Minutes by Service Category
- **Chart Type:** Pie/Donut drilldown (category → top service items)
- **Notes:** Total breach minutes by category with item drilldown.
- **Formula:** `SUM(sla_breach_min) by category then item`
- **Good/Bad:** Healthy — breach minutes near zero and evenly low. Warning — minutes concentrated in a few categories (highest SLA and financial risk).

### jo-19 — 🟣 Escalation by Service Category
- **Chart Type:** Pie/Donut drilldown (category → top service items)
- **Notes:** Escalation concentration by category with item-level drilldown.
- **Formula:** `SUM(escalated_flag) by category then item`
- **Good/Bad:** Good — escalation ≤ 5%. Watch — 5–10%. Bad — > 10% concentrated in specific categories.

### jo-20 — Top Reassignment by Department
- **Chart Type:** Bar
- **Notes:** Departments with the highest reassignment volume.
- **Formula:** `SUM(reassigned_flag) by department`
- **Good/Bad:** Good — reassignment ≤ 5%. Watch — 5–15%. Bad — > 15% (accountability gaps and added cycle time).

### jo-21 — 🟣 Resolution Time by Department *(⚠ title/content mismatch — see note)*
- **Chart Type:** Pie/Donut drilldown (category → top service items)
- **Notes:** Displayed title reads "Resolution Time by Department," but the chart's actual data (`buildDrilldownDonut('jo-21', 'Response P90 by Service Category → Service Items', ...)`) is the **P90 (tail) first-response time by category**, not resolution time or department data. Same stale-title issue as jo-16/jo-17.
- **Formula:** `P90(response_min) by category then item`
- **Good/Bad:** No benchmark line currently set for this content (the i18n note text describes resolution time, not P90 response — recommend re-pointing the title to match the real content, or vice versa, in a future fix).

### jo-22 — 🟣 Resolution P90 by Service Category
- **Chart Type:** Pie/Donut drilldown (category → top service items)
- **Notes:** P90 resolution time showing worst-case completion behavior by category and item.
- **Formula:** `P90(resolution_min) by category then item`
- **Good/Bad:** Good — P90 resolution ≤ 60 min. Watch — 60–120 min. Bad — > 120 min (worst-case completions driving complaints).

### jo-27 — ⏰ 🟣 Job Status → 24-Hour Jobs Distribution
- **Chart Type:** Column (2-level drilldown: status → 24-hour distribution)
- **Notes:** Job count by status. Click a status bar to drill into its 24-hour distribution.
- **Formula:** `COUNT(*) BY job_status; drilldown: COUNT(*) BY HOUR(created_datetime)`
- **Good/Bad:** Healthy — Completed/Closed dominate and Open + Pending < 15%. Warning — a large Open/Pending status at specific hours.

### jo-28 — ⏰ 🟣 Overdue Jobs by Item Category → 24-Hour Jobs Distribution
- **Chart Type:** Column (2-level drilldown: category → 24-hour distribution)
- **Notes:** Overdue job count (delay > 0) by service item category. Click a category bar to drill into its 24-hour distribution.
- **Formula:** `COUNT(delay > 0) BY service_item_category; drilldown: COUNT(*) BY HOUR(created_datetime)`
- **Good/Bad:** Healthy — overdue count near zero. Warning — overdue (delay > 0) concentrated in a category or hour band.

---

## 3. JO (Hotel) — Long Charts (4)

### jo-23 — 🟣 24-Hour Completed Jobs → Completion Duration
- **Chart Type:** Column (2-level drilldown: hour → completion duration bucket)
- **Notes:** Completed jobs by hour of day. Click a bar to drill into completion duration distribution for that hour.
- **Formula:** `COUNT(completed) BY HOUR(created_datetime); drilldown: COUNT(*) BY completion_duration_bucket`
- **Good/Bad:** Healthy — completions track staffed hours with most in low-duration buckets. Warning — completion peak in thinly-staffed hours or a long-duration tail.

### jo-24 — 🟣 24-Hour Acknowledged Jobs → Response Duration
- **Chart Type:** Column (2-level drilldown: hour → response duration bucket)
- **Notes:** Acknowledged jobs by hour of day. Click a bar to drill into response duration distribution for that hour.
- **Formula:** `COUNT(acknowledged) BY HOUR(created_datetime); drilldown: COUNT(*) BY response_duration_bucket`
- **Good/Bad:** Good — response ≤ 5 min in peak hours. Watch — 5–15 min. Bad — > 15 min where demand is highest.

### jo-25 — 🟣 24-Hour Escalated Jobs → Overdue Duration
- **Chart Type:** Column (2-level drilldown: hour → overdue duration bucket)
- **Notes:** Escalated jobs by hour of day. Click a bar to drill into overdue duration distribution for that hour.
- **Formula:** `COUNT(escalated) BY HOUR(created_datetime); drilldown: COUNT(*) BY delay_duration_bucket`
- **Good/Bad:** Healthy — few escalations with short overdue minutes. Warning — escalations cluster in specific hours with long overdue durations.

### jo-26 — 🟣 24-Hour Jobs Distribution → Top Item Category
- **Chart Type:** Column (2-level drilldown: hour → top service item categories)
- **Notes:** Total jobs by hour of day. Click a bar to drill into the top service item categories for that hour.
- **Formula:** `COUNT(*) BY HOUR(created_datetime); drilldown: COUNT(*) BY service_item_category`
- **Good/Bad:** Healthy — hourly demand matches the staffing curve. Warning — demand peaks where coverage is thin (review shift boundaries).

---

## 4. CJO (Corp) — Simple Charts (22)

### cjo-01 — 🟢 Hotel → Top Category → Top Service Items
- **Chart Type:** Pie/Donut drilldown (3-level: hotel → top category → top service items)
- **Notes:** Outer donut shows total JO volume by hotel. Click a hotel to see its top service categories, then a category to see its top service items.
- **Formula:** `COUNT(*) BY hotel_code DRILLDOWN TOP service_item_category DRILLDOWN TOP service_item`
- **Good/Bad:** Healthy — demand spread evenly across hotels. Warning — one hotel generating outsized JO volume (capacity review).

### cjo-02 — 🟢 Hotel → Escalation Rate by Service Category → Escalation Rate by Service Item
- **Chart Type:** Column (3-level drilldown: hotel → category escalation rate % → item escalation rate %)
- **Notes:** Columns show total job volume per hotel. Click a hotel to see escalation rate (%) by service category, then click a category to see escalation rate (%) by service item.
- **Formula:** `COUNT(*) BY hotel_code; escalated / total * 100 BY service_item_category per hotel; escalated / total * 100 BY service_item per category`
- **Good/Bad:** Good — category/item escalation rate ≤ 10%. Watch — 10–25%. Bad — > 25% concentrated in one category or item (systemic escalation driver).

### cjo-03 — ⏰ 🟢 Hotel Jobs → 24-Hour Distribution → Top 10 Service Items
- **Chart Type:** Column (3-level drilldown: hotel → 24-hour distribution → top 10 service items)
- **Notes:** Columns show total jobs per hotel. Click a hotel to drill into its 24-hour job distribution, then click an hour to see the top 10 service items for that hour.
- **Formula:** `COUNT(*) BY hotel_code; drilldown: COUNT(*) BY created_hour; drilldown: TOP 10 COUNT(*) BY service_item`
- **Good/Bad:** Healthy — demand spread across hours. Warning — extreme peak hours driving concentrated item demand.

### cjo-04 — ⏰ 🟢 Hotel → Delayed Duration Distribution → Assigned Department → Assigned To
- **Chart Type:** Column (4-level drilldown: hotel → duration bucket → assigned department → assigned user)
- **Notes:** Delayed jobs (delay > 0) by hotel, drilling into duration bucket, then assigned department, then assigned user.
- **Formula:** `COUNT(delay_duration > 0) BY hotel_code DRILLDOWN duration_bucket DRILLDOWN assigned_to_department DRILLDOWN assigned_to_user`
- **Good/Bad:** Healthy — delayed jobs concentrated in shorter buckets (< 30 min). Warning — high volume in the 4h+/8h+ buckets under a single department or user.

### cjo-05 — 🟢 Escalation Rate by Hotel
- **Chart Type:** Column — escalation % per hotel
- **Notes:** Escalation comparison for service stability review.
- **Formula:** `escalated_jobs / total_jobs * 100 BY hotel_code`
- **Good/Bad:** Good — escalation ≤ 5% per hotel. Watch — 5–10%. Bad — > 10% at any hotel.

### cjo-06 — Worldmap Job Order by Hotel
- **Chart Type:** Map (choropleth by country, hotel labels)
- **Notes:** Country-level map with hotel labels for chain-wide JO visibility.
- **Formula:** `Country Value = SUM(total_jobs) GROUP BY country_code; Label = CONCAT(hotel_code, total_jobs) list per country`
- **Good/Bad:** Healthy — balanced regional demand. Warning — a property or region with outsized JO load.

### cjo-07 — 🟢 Top Service Items → Daily Trend (Chain)
- **Chart Type:** Bar (2-level drilldown: top 10 items chain-wide → daily trend)
- **Notes:** Ranks the most requested service items across all chain hotels. Click an item bar to see its daily job count trend.
- **Formula:** `COUNT(*) by service_item (chain); drilldown: COUNT(*) by created_date`
- **Good/Bad:** Healthy — demand spread across service items. Warning — one item dominating chain volume or spiking on a given day.

### cjo-08 — 🟢 Avg Response Minutes by Hotel
- **Chart Type:** Bar
- **Notes:** Average create-to-acknowledge latency by hotel.
- **Formula:** `AVG(response_min) BY hotel_code`
- **Good/Bad:** Good — average response ≤ 5 min. Watch — 5–15 min. Bad — > 15 min at any hotel.

### cjo-09 — 🟢 P90 Response Minutes by Hotel
- **Chart Type:** Bar
- **Notes:** Tail response time comparison by hotel.
- **Formula:** `P90(response_min) BY hotel_code`
- **Good/Bad:** Good — P90 response ≤ 15 min. Watch — 15–30 min. Bad — > 30 min (chronic slow-response hotel).

### cjo-10 — 🟢 Avg Resolution Minutes by Hotel
- **Chart Type:** Bar
- **Notes:** Average create-to-complete duration by hotel.
- **Formula:** `AVG(resolution_min) BY hotel_code`
- **Good/Bad:** Good — average create-to-complete ≤ 30 min. Watch — 30–60 min. Bad — > 60 min.

### cjo-11 — 🟢 Total Quantity by Hotel
- **Chart Type:** Bar
- **Notes:** Compares requested quantity load across hotels.
- **Formula:** `SUM(quantity) BY hotel_code`
- **Good/Bad:** Healthy — balanced quantity load across hotels. Warning — a hotel with concentrated demand needing resource reallocation.

### cjo-12 — ⏰ 🟢 Delayed Status by Hotel → 24-Hour Delayed Job Distribution
- **Chart Type:** Column (2-level drilldown: hotel → 24-hour delayed distribution)
- **Notes:** Delayed job count (delay_duration > 0) per hotel. Click a bar to see its 24-hour delayed job distribution.
- **Formula:** `COUNT(delay > 0) BY hotel_code; drilldown: COUNT(*) BY created_hour`
- **Good/Bad:** Healthy — delayed count near zero. Warning — a hotel or hour band concentrating delayed jobs.

### cjo-13 — ⏰ 🟢 Completed Status by Hotel → 24-Hour Completed Job Distribution
- **Chart Type:** Column (2-level drilldown: hotel → 24-hour completed distribution)
- **Notes:** Completed job count per hotel. Click a bar to see its 24-hour completed job distribution.
- **Formula:** `COUNT(completed) BY hotel_code; drilldown: COUNT(*) BY created_hour` *(the app's stored formula string is currently blank for this chart — a known gap; this is the logical equivalent of what the chart computes)*
- **Good/Bad:** Healthy — completions track staffed hours. Warning — completion peaks in thin-coverage hours.

### cjo-14 — ⏰ 🟢 Timeout Status by Hotel → 24-Hour Timeout Job Distribution
- **Chart Type:** Column (2-level drilldown: hotel → 24-hour timeout distribution)
- **Notes:** Timeout job count per hotel. Click a bar to see its 24-hour timeout job distribution.
- **Formula:** `COUNT(timeout) BY hotel_code; drilldown: COUNT(*) BY created_hour` *(the app's stored formula string is currently blank for this chart — a known gap; this is the logical equivalent of what the chart computes)*
- **Good/Bad:** Healthy — timeout near zero. Warning — timeout clustered at specific hotels or hours.

### cjo-15 — 🟢 Hotel Job Volume → Job Status → Completed Duration Distribution
- **Chart Type:** Column (3-level drilldown: hotel → job status → completion duration bucket)
- **Notes:** Columns show total job volume per hotel. Click a hotel to drill into its job status breakdown, then click a status to see the completion duration distribution (< 15 min to 8+ h).
- **Formula:** `COUNT(*) BY hotel_code; COUNT(*) BY job_status per hotel; COUNT(*) BY dur_bucket per status`
- **Good/Bad:** Healthy — majority of completions < 1h. Warning — significant volume in 4–8h or 8h+ buckets.

### cjo-16 — 🟢 Top Service Categories by Hotel
- **Chart Type:** Stacked bar (category series per hotel)
- **Notes:** Compares top JO categories across hotels.
- **Formula:** `COUNT(*) BY hotel_code, service_item_category`
- **Good/Bad:** Healthy — category demand spread. Warning — concentrated category pressure at a specific hotel.

### cjo-17 — 🟢 Top Service Items by Hotel
- **Chart Type:** Stacked bar (item series per hotel)
- **Notes:** Compares top JO items across hotels.
- **Formula:** `COUNT(*) BY hotel_code, service_item`
- **Good/Bad:** Healthy — varied item mix. Warning — one item dominating a hotel (candidate to standardize or pre-procure).

### cjo-18 — Department Load by Hotel
- **Chart Type:** Stacked column (department series per hotel)
- **Notes:** Department-origin JO load by hotel.
- **Formula:** `COUNT(*) BY hotel_code, department_name`
- **Good/Bad:** Healthy — requests spread across origin departments. Warning — one origin department dominating (upstream gap).

### cjo-19 — 🟢 Assigned Department Load by Hotel
- **Chart Type:** Stacked column (assigned department series per hotel)
- **Notes:** Assigned department comparison across hotels.
- **Formula:** `COUNT(*) BY hotel_code, assigned_to_department`
- **Good/Bad:** Healthy — balanced assignment across departments. Warning — a department absorbing disproportionate execution load.

### cjo-20 — Created By Department Demand by Hotel
- **Chart Type:** Stacked column (created-by department series per hotel)
- **Notes:** Source department demand comparison across hotels.
- **Formula:** `COUNT(*) BY hotel_code, created_by_department`
- **Good/Bad:** Healthy — demand spread across source departments. Warning — a concentrated demand source (target for preventive action).

### cjo-21 — 🟢 Completed By Department Throughput by Hotel
- **Chart Type:** Stacked column (completed-by department series per hotel)
- **Notes:** Completion ownership comparison across hotels.
- **Formula:** `COUNT(*) BY hotel_code, completed_by_department`
- **Good/Bad:** Healthy — completion share ≈ assignment share. Warning — completion lagging assignment (execution bottleneck).

### cjo-27 — 🟢 SLA Compliance by Hotel
- **Chart Type:** Column — SLA % per hotel
- **Notes:** Hotel-level SLA compliance comparison.
- **Formula:** `sla_compliant_completed / completed_jobs * 100 BY hotel_code`
- **Good/Bad:** Good — every hotel SLA ≥ 95%. Watch — 85–95%. Bad — any hotel < 85%.

---

## 5. CJO (Corp) — Long Charts (6 + Hotel Performance table)

### cjo-22 — ⏰ 🟢 24-Hour VIP Jobs Distribution → Top Service Items
- **Chart Type:** Column (2-level drilldown: hour → top service items for VIP jobs)
- **Notes:** VIP job volume by hour of day across the chain. Click a bar to drill into the top service items requested by VIP guests at that hour.
- **Formula:** `COUNT(*) WHERE is_vip BY created_hour; drilldown: COUNT(*) BY service_item`
- **Good/Bad:** Healthy — VIP demand within staffed hours and handled fast. Warning — VIP peaks in thin-coverage hours (premium-guest risk).

### cjo-23 — ⏰ 🟢 24-Hour Completed Jobs → Completion Duration Range
- **Chart Type:** Column (2-level drilldown: hour → completion duration bucket)
- **Notes:** Completed job volume by hour of day across the chain. Click a bar to see the completion duration range (mins) distribution for that hour.
- **Formula:** `COUNT(completed) BY created_hour; drilldown: COUNT(*) BY duration_bucket`
- **Good/Bad:** Healthy — completions in staffed hours with most short-duration. Warning — long-duration share rising at peak hours.

### cjo-24 — ⏰ 🟢 24-Hour Acknowledged Jobs → Response Time Distribution
- **Chart Type:** Column (2-level drilldown: hour → response time bucket)
- **Notes:** Acknowledged job volume by hour of day across the chain. Click a bar to see the response time range (mins) distribution for that hour.
- **Formula:** `COUNT(acknowledged) BY created_hour; drilldown: COUNT(*) BY response_bucket`
- **Good/Bad:** Good — response ≤ 5 min at peak hours. Watch — 5–15 min. Bad — > 15 min where demand is highest.

### cjo-25 — ⏰ 🟢 24-Hour Escalated Jobs → Overdue Duration Distribution
- **Chart Type:** Column (2-level drilldown: hour → overdue duration bucket)
- **Notes:** Escalated job volume by hour of day across the chain. Click a bar to see the overdue duration range (mins) distribution for that hour.
- **Formula:** `COUNT(escalated) BY created_hour; drilldown: COUNT(*) BY overdue_bucket`
- **Good/Bad:** Healthy — few escalations with short overdue minutes. Warning — escalations cluster at specific hours with long overdue durations.

### cjo-26 — ⏰ 🟢 24-Hour Jobs Distribution → Top Item Category
- **Chart Type:** Column (2-level drilldown: hour → top service item categories)
- **Notes:** Total job volume by hour of day across the chain. Click a bar to see the top service item categories for that hour.
- **Formula:** `COUNT(*) BY created_hour; drilldown: COUNT(*) BY service_item_category`
- **Good/Bad:** Healthy — hourly demand matches the chain staffing curve. Warning — demand peaks where coverage is thin.

### cjo-28 — ⏰ 🟢 Overdue Jobs by Item Category → 24-Hour Jobs Distribution
- **Chart Type:** Column (2-level drilldown: category → 24-hour distribution)
- **Notes:** Overdue job count (delay > 0) by service item category across the chain. Click a category bar to drill into its 24-hour distribution.
- **Formula:** `COUNT(delay > 0) BY service_item_category; drilldown: COUNT(*) BY created_hour`
- **Good/Bad:** Healthy — overdue near zero. Warning — overdue (delay > 0) concentrated in a category or hour.

### Hotel Performance table (`CorpJoPerformanceTable`)
- **Chart Type:** Table (one row per hotel)
- **Notes:** Per-hotel snapshot of Jobs, Completion %, SLA %, Timeout %, Escalation %, Avg Response (min), Avg Resolution (min) — each column sourced from the same kpi_01–kpi_10 values used in the KPI cards, sorted alphabetically by hotel code.
- **Formula:** `jobs=COUNT(*); completion=kpi_02; sla=kpi_03; timeout=kpi_04; escalation=kpi_05; response=kpi_07; resolution=kpi_09 — all BY hotel_code`
- **Good/Bad:** Same per-column thresholds as the corresponding KPI (see Section 1) — use this table to spot which specific hotel is driving a chain-level KPI outlier.
