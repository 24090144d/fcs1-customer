# IM / CIM Dashboard Reference

Source of truth: `app/dashboard/DashboardClient.tsx` (`hkpi_*`/`kpi_*` KPI blocks, `imHotelExecutiveCharts` im-01..10, `imHotelOverTimeCharts` im-11..16, `imHotelDrilldownCharts` im-17..26 + im-41..45, `imHotelOperationAnalysisCharts` im-27..39, `CORP_IM_TOP_MAP` cim-01..20, `CORP_IM_LONG_MAP` cim-22..26), `app/api/uploads/finalize/route.ts` (`buildImJson`'s stored im-46..69). IM is the largest module by chart count (93 hotel + corp charts, plus 20 KPIs), so — like CO — this reference uses compact tables rather than per-chart sections.

**IM and CIM KPI sets are NOT identical** (like MO/CMO, unlike JO/CJO) — hotel and corp each have their own distinct 10-KPI list built by different code paths, sharing only the general themes (closure rate, severity, VIP, SLA).

**Long Charts membership**: hotel `IM_LONG_CHART_IDS` = `im-41, im-42, im-43, im-44, im-45`; corp `CORP_IM_LONG_IDS` = `cim-22, cim-23, cim-24, cim-25, cim-26`. Corp Simple membership is the explicit `CORP_IM_TOP_IDS` allowlist (`cim-01..20`). Everything else in the hotel `im-01..39` (+ orphan `im-40`) and `im-46..69` ranges renders in hotel Simple Charts.

**Data-quality caveat for this doc:** unlike JO/MO/CO, most hotel IM chart notes in the source code do **not** carry an explicit numeric "Benchmark —" line. Where the source gives one, it's used verbatim. Where it doesn't, the Good/Bad column below applies the same numeric anchors already established by this module's own KPIs (closure ≥95% good, severity index ≤1.8 good, VIP share ≤6% good, SLA breach ≤3% good, critical rate ≤1% good, repeat rate ≤15% good) to whichever chart measures that same underlying metric, and falls back to a generic concentration/trend heuristic for pure distribution or ranking charts that have no natural pass/fail line.

**Known gap found while compiling this doc:** `im-40` ("Incident by Status → Department") exists as a stored chart definition with a title but a genuinely blank note and formula in source, and — unlike every other id in the `im-01..39` range — is not referenced by any of the four client-side hotel chart-group arrays (`imHotelExecutiveCharts`/`OverTimeCharts`/`DrilldownCharts`/`OperationAnalysisCharts`). It may not actually be reachable in the current dashboard grid; documented here for completeness with that caveat. Separately, `im-57` through `im-65` ("Chain — ... by Hotel") ship a placeholder note in source ("Chain comparison not available — only one hotel uploaded") that is clearly meant as a runtime fallback message, not permanent documentation text — this doc describes what each chart computes instead of reproducing that placeholder.

---

## 0. Recommended: Highest Business Value (4 KPIs + 4 Charts)

### KPIs

| Rank | KPI | Why it's top-tier |
|---|---|---|
| 1 | **hkpi_06/kpi_06 — Closure Rate** | The outcome metric — is the incident actually being resolved. Every other IM KPI is context for why closure is or isn't happening. |
| 2 | **hkpi_07/kpi_02 — Critical Incident Rate** | A severity-weighted risk gauge, not just a volume count — a hotel with few but critical incidents is a bigger brand/safety risk than one with many trivial ones, and only this KPI isolates that. |
| 3 | **hkpi_09/kpi_07 — VIP Closure Rate** | Ties incident resolution directly to premium-guest retention risk — a VIP incident left open is the single highest-cost failure mode in the whole IM set. |
| 4 | **kpi_05 (corp) / — SLA Breach Rate** *(hotel-side equivalent: hkpi_03 SLA Compliance)* | The operational-discipline metric — measures whether the team is meeting its own response commitments, independent of how severe or how many incidents there are. |

Deliberately excluded: hkpi_02/Incident Volume and hkpi_10/VIP Guest Incident Rate are scale- and mix-dependent counts with no universal pass/fail; hkpi_12/Department Incident Distribution and hkpi_15/Complaint Source Analysis are useful concentration diagnostics but secondary to the four outcome/risk metrics above; hkpi_14/Repeat Incident Rate is important but narrower in scope than Closure + Critical + VIP Closure combined.

### Charts

| Rank | Chart | Why it's top-tier |
|---|---|---|
| 1 | **cim-04 — Hotel → Department → Incident Category → Incident Items** | The deepest root-cause chain in the entire IM/CIM set (4 levels) — the only chart that carries an incident all the way from "which hotel" down to "which specific incident item," by way of the department that owns it. Built explicitly for root-cause governance. |
| 2 | **cim-12 / im-32-style — Hotel Risk Ranking (corp) / Department SLA Ranking (hotel)** | A weighted composite (severity + VIP + open + SLA), not a single raw count — built specifically to answer "which hotel/department needs intervention first," the same design principle as CO's Readiness Risk Index. |
| 3 | **im-31 — Repeat Room Failure Analysis** | The only chart that catches a guest-facing pattern invisible to every count-based chart: the *same room* failing repeatedly. A room with 3 incidents in a month is a maintenance/inspection failure, not three unrelated incidents — this chart is the only one built to surface exactly that. |
| 4 | **im-04 / cim-09 — VIP vs Non-VIP → 24-Hour Distribution** | Combines the two highest-stakes dimensions (VIP exposure and time-of-day coverage) in one chart — flags not just *that* VIP incidents are happening, but *when*, so staffing can be matched to actual VIP-risk hours rather than average hours. |

Honorable mention: **im-13/Severity Weighted Incident Score** is a genuinely good single-number risk trend but didn't make the top 4 because cim-12/im-32's ranking view already answers the "where" question that a trend line alone can't.

---

## 1. KPIs

### 1a. IM (Hotel) — 10 KPIs

| ID (alias) | Name | Notes | Formula | Good | Watch | Bad |
|---|---|---|---|---|---|---|
| hkpi_02 (im_kpi_01) | Incident Volume | Operational workload baseline for staffing and queue planning. | `COUNT(All Incidents)` | — | — | Neutral; compare against same-hotel history or chain average. |
| hkpi_03 (im_kpi_02) | Incident Resolution SLA Compliance | Portion of incidents resolved within SLA discipline rules. | `(Total Cases - SLA Breach Cases) / Total Cases * 100` | ≥ 95% | 90–94.9% | < 90% |
| hkpi_06 (im_kpi_03) | Closure Rate | Standard closure throughput KPI for execution health. | `Completed Cases / Total Cases * 100` | ≥ 95% | 90–94.9% | < 90% |
| hkpi_07 (im_kpi_04) | Critical Incident Rate | Share of critical-severity incidents indicating severe failure exposure. | `Critical Cases / Total Cases * 100` | ≤ 1% | 1–2% | > 2% |
| hkpi_08 (im_kpi_05) | Guest Complaint Severity Index | Average severity intensity of all incident cases (Low=1…Critical=4). | `Severity Score Sum / Total Cases` | ≤ 1.80 pts | 1.81–2.40 pts | > 2.40 pts |
| hkpi_09 (im_kpi_06) | VIP Closure Rate | Resolution quality for VIP-impact incidents. | `VIP Completed Cases / VIP Cases * 100` | ≥ 95% | 90–94.9% | < 90% |
| hkpi_10 (im_kpi_07) | VIP Guest Incident Rate | Premium guest incident exposure for brand-protection monitoring. | `VIP Cases / Total Cases * 100` | ≤ 6% | 6–10% | > 10% |
| hkpi_12 (im_kpi_08) | Department Incident Distribution | Concentration in top department; high concentration implies bottleneck risk. | `Top Department Cases / Total Cases * 100` | ≤ 30% | 30–45% | > 45% |
| hkpi_14 (im_kpi_09) | Repeat Incident Rate | Repeat load share for longitudinal comparison with historical baselines. | `Repeat Incident Cases / Total Cases * 100` | ≤ 15% | 15–25% | > 25% |
| hkpi_15 (im_kpi_10) | Complaint Source Analysis | Top complaint-source concentration to prioritize channel-level fixes. | `Top Complaint Source Cases / Total Cases * 100` | ≤ 35% | 35–50% | > 50% |

### 1b. CIM (Corp) — 10 KPIs

| ID (display order) | Name | Notes | Formula | Good | Watch | Bad |
|---|---|---|---|---|---|---|
| kpi_09 (cim_kpi_01) | Total Incident Volume | Total number of incidents in the selected period, chain-wide. | `COUNT(All Incidents)` | ≤ 800 | 801–1200 | > 1200 *(thresholds should be tuned by property scale)* |
| kpi_02 (cim_kpi_02) | Critical Incident Rate | Share of incidents classified as Critical, chain-wide. | `Critical Cases / Total Cases * 100` | ≤ 1% | 1–2% | > 2% |
| kpi_03 (cim_kpi_03) | Hotel Benchmark Index | Average cross-hotel benchmark index for fair chain-level comparison. | `AVG per-hotel [100 - (Severity*40 + VIP*30 + SLA*30)]` | ≥ 85 | 75–84.9 | < 75 |
| kpi_04 (cim_kpi_04) | VIP Incident Exposure | Portion of incidents involving VIP guests; tracks premium-service risk. | `VIP Cases / Total Cases * 100` | ≤ 6% | 6–10% | > 10% |
| kpi_05 (cim_kpi_05) | SLA Breach Rate | Operational discipline KPI based on breach/late/overdue-like statuses. | `SLA Breach Cases / Total Cases * 100` | ≤ 3% | 3–5% | > 5% |
| kpi_06 (cim_kpi_06) | Closure Rate | Percentage of incidents that reached completed/closed state, chain-wide. | `Completed Cases / Total Cases * 100` | ≥ 95% | 90–94.9% | < 90% |
| kpi_07 (cim_kpi_07) | VIP Closure Rate | Resolution efficiency for VIP incidents, chain-wide. | `VIP Completed Cases / VIP Cases * 100` | ≥ 95% | 90–94.9% | < 90% |
| kpi_08 (cim_kpi_08) | Repeat Guest Complaint Rate | Recurrence pressure indicator tied to loyalty/retention risk. | `Repeat Complaint Cases / Total Cases * 100` | ≤ 15% | 15–25% | > 25% |
| kpi_01 (cim_kpi_09) | Corporate Risk Score | Composite corporate health index balancing severity, VIP exposure, and SLA breach risk. | `100 - [(AvgSeverity/4*45) + (VIPExposure*30) + (SLABreachRate*25)]` | ≥ 85 | 70–84.9 | < 70 |
| kpi_10 (cim_kpi_10) | Root Cause Concentration | Concentration of incident volume in top 5 categories. | `Top 5 Incident Categories Cases / Total Cases * 100` | ≤ 45% | 45–60% | > 60% |

Note: display order for CIM deliberately puts kpi_09 (Total Incident Volume) first as `cim_kpi_01`, ahead of kpi_01 (Corporate Risk Score) which displays 9th as `cim_kpi_09` — this is an intentional dashboard-layout choice made in an earlier session, not a numbering error.

---

## 2. IM (Hotel) — Simple Charts (63, + 1 orphan)

| ID | Name | Chart Type | Notes | Formula | Good/Bad |
|---|---|---|---|---|---|
| im-01 | 🟣 Daily Incident Trend | Spline | Daily incident count over the period. | `COUNT by DATE(created_date)` | Healthy: stable or declining trend. Warning: sustained upward spike. |
| im-02 | 🟣 VIP → Top 10 Incident Case | Pie/Donut drilldown | VIP/Non-VIP split with drilldown to top 10 incident cases per segment. | `Level 1 = COUNT by VIP segment; Level 2 = TOP 10 incident items by segment` | Good: VIP share ≤ 6%. Watch: 6–10%. Bad: > 10%. |
| im-03 | ⏰ 24 Hour Distribution > Department > Incident Items | Column drilldown (3-level) | Hourly incident volume with drilldown to department then incident items. | `COUNT by hour, then department, then item` | Healthy: demand within staffed hours. Warning: peaks in low-coverage hours. |
| im-04 | ⏰ 🟣 VIP vs Non-VIP → 24-Hour Distribution | Column drilldown | Click VIP or Non-VIP to drill into its 24-hour incident distribution. | `COUNT by vip_flag; drilldown: COUNT by created_hour` | Good: VIP share ≤ 6%. Watch: 6–10%. Bad: > 10%. |
| im-05 | 🟣 Incident Resolution SLA Compliance | Column drilldown | SLA compliance with drilldown into department → severity → case. | `SLA met / total` | Good: ≥ 95%. Watch: 90–94.9%. Bad: < 90%. |
| im-06 | Severity Breakdown | Column drilldown | Incident count by severity with drilldown into status. | `COUNT by severity` | Good: severity index ≤ 1.8. Watch: 1.81–2.4. Bad: > 2.4. |
| im-07 | 🟣 Incident Root Cause Flow | Sankey | Flow diagram from department through category to incident item. | `Root-cause flow proxy` | Healthy: flow spread across paths. Warning: one path carries a disproportionate share (single root cause). |
| im-08 | Category vs Status | Stacked bar | Status mix stacked across top incident categories. | `COUNT by incident_category and incident_status` | Healthy: Completed dominant per category. Warning: a category with a high open/pending share. |
| im-09 | 🟣 Gauge — Closure Rate | Gauge (pie-based) | Closure rate gauge with drilldown into status → case. | `Completed Cases / Total Cases * 100` | Good: ≥ 95%. Watch: 90–94.9%. Bad: < 90%. |
| im-10 | Gauge — VIP Closure Rate | Gauge (pie-based) | VIP closure rate gauge with drilldown into VIP code → status → case. | `VIP Completed Cases / VIP Cases * 100` | Good: ≥ 95%. Watch: 90–94.9%. Bad: < 90%. |
| im-11 | Daily Incident Volume | Areaspline | Daily volume with drilldown into department. | `COUNT by DATE(created_date)` | Healthy: stable or declining trend. Warning: sustained upward spike. |
| im-12 | Weekly Incident Volume | Column drilldown | Weekly volume with drilldown into department. | `COUNT by ISO week` | Healthy: flat or declining week-over-week. Warning: rising trend. |
| im-13 | 🟣 Severity Weighted Incident Score | Spline | Weighted daily severity score (4×Critical + 3×High + 2×Medium + 1×Low). | `4*Critical + 3*High + 2*Medium + 1*Low by date` | Healthy: score stable/declining. Warning: sustained upward trend (escalating risk mix). |
| im-14 | Monthly Incident Volume | Column drilldown | Monthly aggregate with drilldown into department. | `COUNT by month` | Healthy: stable month-over-month. Warning: sustained growth beyond seasonal norms. |
| im-15 | Incidents by Day of Week | Column drilldown | Volume by weekday with drilldown into department. | `COUNT by day of week` | Healthy: demand matches weekly staffing plan. Warning: a day consistently overloaded. |
| im-16 | Incident Forecast Prediction | Spline | 7-day moving-average forecast by category. | `7-day moving average forecast` | Healthy: forecast flat or declining. Warning: forecast trending upward. |
| im-17 | 🟣 Closure Rate by Category | Column drilldown | Closure rate with drilldown into category → status. | `Completed / total by category` | Good: ≥ 95%. Watch: 90–94.9%. Bad: < 90%. |
| im-18 | 🟣 Top Incident Categories | Bar drilldown | Top categories with drilldown into item name. | `TOP categories by count` | Healthy: volume spread across categories. Warning: one category disproportionately dominant. |
| im-19 | 🟣 Top 15 Incident Items | Bar drilldown | Top 15 items with drilldown into incident location. | `TOP items by count` | Healthy: volume spread across items. Warning: one item disproportionately dominant. |
| im-20 | Category × Severity | Column | Category breakdown by severity with case drilldown. | `COUNT by category x severity` | Good: severity index ≤ 1.8 per category. Watch: 1.81–2.4. Bad: > 2.4. |
| im-21 | 🟣 Top 10 Rooms by Incidents | Bar drilldown | Rooms with the most incidents, drilldown into item name. | `TOP rooms by incident count` | Healthy: no room is a repeat offender. Warning: a room recurring across periods (maintenance flag). |
| im-22 | VIP Type -> Top 10 Incident | Column drilldown | VIP/Non-VIP split with drilldown into top 10 items per type. | `Level 1 = COUNT by VIP type; Level 2 = TOP 10 items within type` | Good: VIP share ≤ 6%. Watch: 6–10%. Bad: > 10%. |
| im-23 | Incidents by Category | Column drilldown | Category volume with drilldown into item name. | `COUNT by category` | Healthy: volume spread across categories. Warning: one category disproportionately dominant. |
| im-24 | Severity Distribution | Pie/Donut drilldown | Severity split with drilldown into category. | `COUNT by severity` | Good: severity index ≤ 1.8. Watch: 1.81–2.4. Bad: > 2.4. |
| im-25 | Status Distribution | Pie/Donut drilldown | Status split with drilldown into department. | `COUNT by status` | Good: Completed ≥ 95%. Watch: 90–94.9%. Bad: < 90%. |
| im-26 | Incident Source → Department | Column drilldown | Complaint source with drilldown into department. | `COUNT by source -> department` | Healthy: Unknown source ≤ 5%. Warning: > 15% (source data quality gap). |
| im-27 | 🟣 Incident Aging Bucket | Column drilldown | Status with drilldown into aging bucket. | `Aging proxy by status` | Healthy: most open cases in the youngest aging bucket. Warning: a growing share in the oldest bucket (stale open cases). |
| im-28 | Incidents by Hour of Day | Column drilldown | Hourly volume with drilldown into department. | `COUNT by HOUR(incident_datetime)` | Healthy: peaks fall within staffed hours. Warning: peaks in low-coverage hours. |
| im-29 | 🟣 Open vs Closed SLA Breach | Column drilldown | Status with drilldown into SLA breach flag. | `SLA breach proxy split` | Good: SLA breach ≤ 3%. Watch: 3–5%. Bad: > 5%. |
| im-30 | 🟣 Guest Journey Incident Stage | Column drilldown | Arrival/Stay/Departure stage with drilldown into category. | `Stage proxy split` | Healthy: incidents spread across journey stages. Warning: one stage (e.g. arrival) concentrating incidents. |
| im-31 | 🟣 Repeat Room Failure Analysis | Packed bubble | Rooms with repeat incidents, drilldown into item name. | `Packed bubble by repeat room failures` | Healthy: few or no repeat rooms. Warning: a room repeatedly failing (maintenance/inspection gap). |
| im-32 | 🟣 Department SLA Ranking | Bar drilldown | Departments ranked by SLA breach, drilldown into case. | `Pending-rate proxy by department` | Good: SLA breach ≤ 3%. Watch: 3–5%. Bad: > 5% for a department. |
| im-33 | 🟣 Complaint Source Risk Ranking | Bar drilldown | Complaint sources ranked by risk, drilldown into severity. | `Source risk proxy` | Healthy: risk spread across sources. Warning: one source disproportionately high-risk. |
| im-34 | 🟣 Department Incident Burden Score | Treemap | Department burden sized by incident volume/category mix. | `Treemap of department burden` | Healthy: burden spread across departments (top department ≤ 30%). Warning: one department > 45% of burden. |
| im-35 | Investigation Completion Quality | Pie/Donut drilldown (also a gauge in `GAUGE_CHARTS`) | Investigation completion gauge, drilldown into case. | `Completion gauge proxy` | Good: ≥ 95% investigations completed. Watch: 90–94.9%. Bad: < 90%. |
| im-36 | 🟣 VIP Repeat Incident Analysis | Heatmap | VIP repeat pattern by item name. | `VIP repeat proxy heatmap` | Healthy: few or no VIP repeats. Warning: a VIP guest/room recurring (retention risk). |
| im-37 | Booking Source Risk Analysis | Bubble | Booking source risk, drilldown into severity. | `Booking source risk proxy` | Healthy: risk spread across booking sources. Warning: one source disproportionately high-risk. |
| im-38 | Corporate Guest Complaint Ranking | Bar drilldown | Company/corporate accounts ranked by complaints, drilldown into category. | `Corporate complaint proxy` | Healthy: complaints spread across accounts. Warning: one corporate account disproportionately represented. |
| im-39 | Shift Handover Incident Analysis | X-range | Incident hour vs department shown as a shift-window timeline. | `Shift window proxy` | Healthy: incidents evenly distributed across shifts. Warning: a shift-change window concentrating incidents (handover gap). |
| im-40 | 🟣 Incident by Status → Department *(⚠ possibly unreachable — see note above)* | Pie/Donut | Status/department split; note and formula are blank in source. | *(not defined in source)* | Not determinable — no benchmark text or formula exists in source for this id. |
| im-46 | 🟣 Incidents by Category | Column | All incident categories ranked by volume. | `COUNT by incident_category ORDER BY count DESC` | Healthy: volume spread across categories. Warning: one category disproportionately dominant. |
| im-47 | 🟣 Severity Distribution | Pie/Donut | Proportional share of each severity level. | `COUNT by severity ÷ Total × 100` | Good: severity index ≤ 1.8. Watch: 1.81–2.4. Bad: > 2.4. |
| im-48 | 🟣 Status by Hotel | Pie/Donut | Status split; note and formula are blank in source. | *(not defined in source)* | Good: Completed ≥ 95%. Watch: 90–94.9%. Bad: < 90% *(inferred from title)*. |
| im-49 | 🟣 Daily Incident Trend | Spline | Daily incident volume; identifies spikes and weekly rhythms. | `COUNT by DATE(created_date)` | Healthy: stable or declining trend. Warning: sustained upward spike. |
| im-50 | 🟣 Monthly Incident Volume | Column | Monthly aggregate incident count. | `COUNT by MONTH(created_date)` | Healthy: stable month-over-month. Warning: sustained growth beyond seasonal norms. |
| im-51 | 🟣 Incidents by Day of Week | Column | Incident distribution by day of the week. | `COUNT by DAYOFWEEK(created_date)` | Healthy: demand matches weekly staffing plan. Warning: a day consistently overloaded. |
| im-52 | 🟣 Top 15 Incident Items | Bar | The 15 most-reported incident item types. | `COUNT by incident_item_name ORDER BY count DESC LIMIT 15` | Healthy: volume spread across items. Warning: one item disproportionately dominant. |
| im-53 | 🟣 Top 10 Rooms by Incidents | Bar | Rooms with the most incidents. | `COUNT by room_no ORDER BY count DESC LIMIT 10` | Healthy: no room is a repeat offender. Warning: a room recurring (maintenance flag). |
| im-54 | 🟣 Category × Status | Stacked column | Status breakdown within the top 8 categories. | `COUNT by (incident_category, incident_status) for top 8 categories` | Healthy: Completed dominant per category. Warning: a category with a high open/pending share. |
| im-55 | 🟣 Category × Severity | Column | Severity distribution for the top 5 incident categories. | `COUNT by (incident_category, severity) for top 5 categories` | Good: severity index ≤ 1.8 per category. Watch: 1.81–2.4. Bad: > 2.4. |
| im-56 | 🟣 Closure Rate by Category | Column | Percentage of incidents resolved within each category. | `COUNT(Completed) ÷ COUNT(all) × 100 per category` | Good: ≥ 95%. Watch: 90–94.9%. Bad: < 90%. |
| im-63 | 🟣 Department × Category Heatmap | Heatmap | Incident density across departments and categories. | *(not defined in source)* | Healthy: density spread across cells. Warning: one department/category cell dominates. |
| im-64 | 🟣 Weekly Incident Volume | Column | Weekly incident count for multi-week trend/seasonality. | `COUNT by ISO week (YYYY-Www)` | Healthy: flat or declining week-over-week. Warning: rising trend. |
| im-66 | 🟣 Incidents by Hour of Day | Column | 24-hour incident distribution for staffing decisions. | `COUNT by HOUR(incident_datetime)` | Healthy: peaks fall within staffed hours. Warning: peaks in low-coverage hours. |
| im-67 | 🟣 Gauge — Closure Rate | Gauge (pie-based) | Overall closure rate gauge. | `Completed ÷ Total × 100` | Good: ≥ 95%. Watch: 90–94.9%. Bad: < 90%. |
| im-68 | 🟣 Gauge — VIP Closure Rate | Gauge (pie-based) | Overall VIP closure rate gauge. | `Completed VIP ÷ Total VIP × 100` | Good: ≥ 95%. Watch: 90–94.9%. Bad: < 90%. |
| im-69 | 🟣 Gauge — Avg Severity Score | Gauge (pie-based) | Overall average severity score gauge. | `(Low×1 + Medium×2 + High×3 + Critical×4) ÷ Total` | Good: ≤ 1.80 pts. Watch: 1.81–2.40 pts. Bad: > 2.40 pts. |
| im-57 | 🟣 Chain — Total Incidents by Hotel | Column | Cross-hotel comparison of total incident volume. | `COUNT per hotel` | Healthy: balanced volume across hotels relative to size. Warning: one hotel generating outsized volume. |
| im-58 | 🟣 Chain — Closure Rate by Hotel | Column | Cross-hotel comparison of closure rate. | `Completed ÷ Total × 100 per hotel` | Good: every hotel ≥ 95%. Watch: 90–94.9%. Bad: a hotel < 90%. |
| im-59 | 🟣 Chain — VIP Incident Share by Hotel | Column | Cross-hotel comparison of VIP incident share. | `VIP Incidents ÷ Total × 100 per hotel` | Good: ≤ 6% per hotel. Watch: 6–10%. Bad: > 10% at any hotel. |
| im-60 | 🟣 Chain — Avg Severity Score by Hotel | Column | Cross-hotel comparison of weighted average severity. | `Weighted avg severity score per hotel` | Good: ≤ 1.80 pts. Watch: 1.81–2.40 pts. Bad: > 2.40 pts at any hotel. |
| im-61 | 🟣 Chain — Category Mix by Hotel | Column | Cross-hotel comparison of category composition as % of total. | `COUNT by category per hotel as % of total` | Healthy: similar category mix across hotels. Warning: a hotel with an outlier category concentration. |
| im-62 | 🟣 Chain — Pending Rate by Hotel | Column | Cross-hotel comparison of pending-case rate. | `Pending ÷ Total × 100 per hotel` | Good: ≤ 5% per hotel. Watch: 5–10%. Bad: > 10% at any hotel. |
| im-65 | 🟣 Chain — Repeat Incident Rate by Hotel | Column | Cross-hotel comparison of repeat-incident rate. | `Incidents in repeated room+category+item groups ÷ Total × 100 per hotel` | Good: ≤ 15% per hotel. Watch: 15–25%. Bad: > 25% at any hotel. |

Note: `im-57` through `im-65` are genuinely designed as *cross-hotel* comparisons, but render on the **hotel-scoped** dashboard (their id range sits inside `IM_COMPARISON_IDS`, part of the single-hotel "operation analysis" grid) — on a single-hotel view these effectively show one bar. The real cross-hotel version of this comparison lives in the CIM (corp) charts below.

---

## 3. IM (Hotel) — Long Charts (5)

| ID | Name | Chart Type | Notes | Formula | Good/Bad |
|---|---|---|---|---|---|
| im-41 | Incident Category > Incident Items | Column drilldown (2-level) | Category volume with drilldown into incident items. | `COUNT by incident category with item drilldown` | Healthy: volume spread across categories/items. Warning: one category/item disproportionately dominant. |
| im-42 | Department > Incident Category > Incident Items | Column drilldown (3-level) | Department volume with drilldown into category then item. | `COUNT by department with category and item drilldown` | Healthy: volume spread across departments/categories. Warning: one department/category disproportionately dominant. |
| im-43 | Incident Category > Incident Item Name > Average Completed Duration (Hour) | Column drilldown (3-level) | Category → item, with average completed-duration-in-hours as the leaf metric. | `L1 COUNT by category; L2 COUNT by item within category; L3 AVG completed duration hours for item` | Good: avg completed duration ≤ 4h. Watch: 4–8h. Bad: > 8h for a high-volume item. |
| im-44 | ⏰ 24 Hour Distribution > Incident Category > Incident Items | Column drilldown (3-level) | Hourly volume with drilldown into category then item. | `COUNT by hour, then category, then item` | Healthy: demand within staffed hours. Warning: peaks in low-coverage hours concentrated in one category/item. |
| im-45 | ⏰ 24 Hour Distribution > Department > Incident Items | Column drilldown (3-level) | Hourly volume with drilldown into department then item. | `COUNT by hour, then department, then item` | Healthy: demand within staffed hours. Warning: peaks in low-coverage hours concentrated in one department/item. |

---

## 4. CIM (Corp) — Simple Charts (20)

| ID | Name | Chart Type | Notes | Formula | Good/Bad |
|---|---|---|---|---|---|
| cim-01 | 🟢 Hotel Incident → Top 10 Incident Item | Column/Pie drilldown (2-level) | Hotel totals with drilldown to top 10 incident items per hotel. | `L1 = COUNT(incident_case) BY hotel_code; L2 = TOP 10 COUNT(incident_case) BY incident_item_name per hotel` | Good: top 3 items ≤ 45% of hotel incidents. Bad: top 3 items > 60% (concentration risk). |
| cim-02 | 🟢 Total Incident vs Status by Hotel | Stacked column | Hotel volume and status mix compared to detect closure imbalance. | `COUNT(incident_case) BY hotel_code, incident_status` | Good: Completed ≥ 95% and Pending ≤ 5%. Bad: Pending > 10% at any hotel. |
| cim-03 | 🟢 VIP Closure Rate vs VIP Incident by Hotel | Dual-axis column/line | VIP volume (bars) vs VIP closure rate (line) by hotel. | `VIP Incidents = COUNT(vip_code valid) BY hotel; VIP Closure % = VIP Completed / VIP Incidents * 100` | Good: VIP closure ≥ 95%. Bad: < 90% at any hotel. |
| cim-04 | ⏰ Hotel → Department → Incident Category → Incident Items | Column drilldown (4-level) | Hotel totals drilling to department, then category, then item — root-cause governance. | `L1 COUNT BY hotel_code; L2 COUNT BY department per hotel; L3 COUNT BY category per hotel+department; L4 COUNT BY item per hotel+department+category` | Good: top category ≤ 20% of hotel incidents. Bad: top category > 35%. |
| cim-05 | 🟢 Chain — Repeat Incident Rate by Hotel | Bar | Recurrence pressure by hotel to flag unresolved systemic issues. | `Repeat Rate % = repeat_count / total_cases * 100 per hotel` | Good: ≤ 15%. Watch: 15–25%. Bad: > 25%. |
| cim-06 | 🟢 Worldmap Incident by Hotel | Map | Country-level map with hotel-level labels for cross-region visibility. | `Country Value = SUM(total_cases) GROUP BY country_code; Label = CONCAT(hotel_code, incident_count) list per country` | Good: no single country > 50% of chain incidents. Bad: one country > 70%. |
| cim-07 | 🟢 Hotel → Department | Column drilldown (2-level) | Hotel totals with drilldown into department. | `L1 COUNT BY hotel_code; L2 COUNT BY department per hotel` | Good: no department > 25% of hotel incidents. Bad: > 40%. |
| cim-08 | 🟢 Hotel → Source of Complaint | Column drilldown (2-level) | Hotel totals with drilldown into complaint source. | `L1 COUNT BY hotel_code; L2 COUNT BY source_of_complaint per hotel` | Good: Unknown source ≤ 5%. Bad: > 15%. |
| cim-09 | 🟢 VIP vs Non-VIP by Hotel | Stacked bar | VIP and non-VIP load compared by hotel. | `VIP = COUNT(vip_code valid); Non-VIP = total_cases - VIP; GROUP BY hotel_code` | Good: VIP share ≤ 6%. Watch: 6–10%. Bad: > 10%. |
| cim-10 | 🟢 Hotel → Booking Source | Column drilldown (2-level) | Hotel totals with drilldown into booking source. | `L1 COUNT BY hotel_code; L2 COUNT BY booking_source per hotel` | Good: Unknown booking ≤ 5%. Bad: > 15%. |
| cim-11 | 🟢 Multi-Hotel Benchmark Scorecard | Table/Matrix | Executive matrix comparing risk, critical, VIP, SLA, and trend in one panel. | `Risk Score = (Critical*5) + (High*3) + (VIP*4) + (SLA Breach*3) + (Open*2) + volume_adjust` | Good: risk score ≤ 60. Watch: 60–100. Bad: > 100. |
| cim-12 | 🟢 Hotel Risk Ranking | Bar (composite score) | Hotels ranked by weighted risk for intervention priority. | `Hotel Risk = Severity Score + (VIP*4) + (Open*2) + (SLA*3)` | Good: high-risk hotel count reducing period-over-period. Bad: top hotel risk growing > 10% WoW. |
| cim-13 | 🟢 Severity vs Volume Quadrant | Bubble/Scatter | Strategic risk quadrant — volume (x) vs severity (y), VIP as bubble size. | `X=COUNT(cases), Y=AVG(severity score), Bubble=VIP cases, Color=country/region` | Good: no hotel in the high-volume + high-severity quadrant. Bad: multiple hotels cluster there. |
| cim-14 | 🟢 Regional Risk Heatmap | Heatmap | Region matrix comparing critical, VIP, SLA breach, and trend intensity. | `Regional KPI = AVG(metric by hotel in region); Regional Risk = aggregate of weighted KPI intensities` | Good: all risk cells trend down or stay green. Bad: ≥ 2 metrics red in the same region. |
| cim-15 | 🟢 Department Risk Heatmap | Heatmap | Department risk intensity by hotel for governance targeting. | `Department Risk Proxy = COUNT(cases) by hotel_code + department (or weighted severity where available)` | Good: top department ≤ 20% of hotel total. Bad: > 35%. |
| cim-16 | 🟢 Root Cause Pareto Chart | Pareto (bar + cumulative line) | Root causes ranked with cumulative contribution line for prioritization. | `Bars = COUNT(incident_category/item); Cumulative % = running_total / total_cases * 100` | Good: top 5 causes ≤ 45% cumulative. Bad: top 5 > 60%. |
| cim-17 | 🟣 Top Incident → Daily Trend (Chain) | Bar drilldown | Most-reported incident items chain-wide, drilldown into daily trend. | `COUNT by incident_item_name (chain); drilldown: COUNT by created_date` | Healthy: demand spread across items. Warning: one item dominating chain volume or spiking on a given day. |
| cim-18 | 🟢 Hotel x Department Matrix | Matrix/Heatmap | Cross-hotel department matrix for benchmarking and imbalance detection. | `Matrix Cell = COUNT(incident_case) GROUP BY hotel_code, department` | Good: cross-hotel variance balanced. Bad: one department dominates across multiple hotels. |
| cim-19 | 🟢 Chain Weekly Incident Trend | Spline (with moving average) | Weekly chain-level trend with 4-week moving average. | `Weekly Incidents = SUM(total) GROUP BY ISO_WEEK; Moving Avg = 4-week rolling average` | Good: moving average flat or declining. Bad: rising > 10% WoW. |
| cim-20 | 🟣 Top Incident vs Completion Rate (Chain) | Dual-axis bar/line | Top 10 incident items by volume (bars) with completion rate % (line). | `Bars: COUNT by incident_item_name (chain); Line: completed / total × 100% per item` | Good: high-volume items also have high completion rate. Bad: a high-volume item with a low completion rate. |

---

## 5. CIM (Corp) — Long Charts (5)

| ID | Name | Chart Type | Notes | Formula | Good/Bad |
|---|---|---|---|---|---|
| cim-22 | Hotel → Incident Category → Incident Items | Column drilldown (3-level) | Hotel volume drilling to category then item for root-cause review. | `L1 COUNT BY hotel_code; L2 COUNT BY category per hotel; L3 COUNT BY item per category` | Healthy: volume spread across categories/items. Warning: one category/item disproportionately dominant. |
| cim-23 | Hotel → Department → Incident Category → Incident Items | Column drilldown (4-level) | Hotel volume drilling to department, category, then item for ownership tracing. | `L1 COUNT BY hotel_code; L2 COUNT BY department per hotel; L3 COUNT BY category per department; L4 COUNT BY item per category` | Good: top category ≤ 20% within a department. Bad: > 35%. |
| cim-24 | Hotel → Incident Category → Top Average Completed Duration (Hour) by Incident Item | Column drilldown (3-level) | Hotel → category, with average completed-duration leaf metric to expose slow items. | `L1 COUNT BY hotel_code; L2 COUNT BY category per hotel; L3 AVG(completed_duration_hours) BY item per category` | Good: avg completed duration ≤ 4h. Watch: 4–8h. Bad: > 8h for a high-volume item. |
| cim-25 | ⏰ Hotel → 24 Hour Distribution → Incident Category → Incident Items | Column drilldown (4-level) | Hotel → hour, then category, then item — time-of-day demand with root-cause detail. | `L1 COUNT BY hotel_code; L2 COUNT BY hour per hotel; L3 COUNT BY category per hour; L4 COUNT BY item per category` | Healthy: demand within staffed hours. Warning: peaks in low-coverage hours concentrated in one category/item. |
| cim-26 | ⏰ Hotel → 24 Hour Distribution → Department → Incident Items | Column drilldown (4-level) | Hotel → hour, then department, then item — time-of-day demand for staffing review. | `L1 COUNT BY hotel_code; L2 COUNT BY hour per hotel; L3 COUNT BY department per hour; L4 COUNT BY item per department` | Healthy: demand within staffed hours. Warning: peaks in low-coverage hours concentrated in one department/item. |
