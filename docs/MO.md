# MO / CMO Dashboard Reference

Source of truth: `app/api/uploads/finalize/route.ts` (`buildMoKpis`, `moBenchmarkFor`), `app/dashboard/DashboardClient.tsx` (`buildMaintenanceKpis` — the actual live hotel-scope KPI list, `buildHotelMoCharts`, `buildCorpMoCharts`, `buildCorpMoKpis`, `CorpMoPerformanceTable`), and `lib/kpi-benchmarks.ts`. Titles/notes below are the live i18n text (`hmo_chart_titles`/`hmo_chart_notes` for hotel, `cmo_chart_titles`/`cmo_chart_notes` for corp — English). Formulas are not localized for most entries; the string shown is the literal from code.

**Unlike JO/CJO, MO and CMO KPIs are NOT identical sets** — they share 8 of 10 ids but differ in the last two (see Section 1).

**Long Charts membership** (`MO_LONG_CHART_IDS`): `mo-13, mo-14, mo-15, mo-16, mo-17, mo-18, cmo-13, cmo-14, cmo-15, cmo-16, cmo-17, cmo-18`. Everything else (mo-01..12, cmo-01..12) renders in Simple Charts.

---

## 0. Recommended: Highest Business Value (4 KPIs + 4 Charts)

### KPIs

| Rank | KPI | Why it's top-tier |
|---|---|---|
| 1 | **mo_completion_rate / cmo_kpi_02 — Completion Rate** | The core outcome metric — is maintenance actually getting fixed. Everything else on this dashboard is a diagnostic of why completion is or isn't happening. |
| 2 | **mo_open_rate / cmo_kpi_03 — Open Work Order Rate** | The clearest live-risk gauge: a rising open rate is the earliest signal of a backlog forming, well before it shows up in guest complaints or severity spikes. |
| 3 | **mo_severity_index / cmo_kpi_06 — Severity Index** | Weights the *seriousness* of outstanding issues, not just their count — a hotel with fewer but higher-severity open orders is a bigger operational risk than one with many trivial ones, and this is the only KPI that captures that. |
| 4 | **mo_guest_related (hotel) / cmo_kpi_05 — Guest Related Share (corp)** | Directly ties maintenance performance to guest experience risk. Note the hotel-level version is reported as a raw count (no fixed benchmark) while the corp version is a % share with a real threshold (≤6% good) — the corp view is the more decision-ready form of this metric. |

Deliberately excluded: mo_total_orders/cmo_kpi_01 and mo_daily_average/cmo_kpi_10 are scale-dependent volume counters with no benchmark; mo_peak_category/cmo_kpi_07 and mo_unique_categories/cmo_kpi_08 are useful context but secondary to the four above; mo_pending_cases and mo_category_span (hotel-only) are largely redundant with mo_open_rate and mo_unique_categories respectively (see Section 1 note).

### Charts

| Rank | Chart | Why it's top-tier |
|---|---|---|
| 1 | **cmo-13 / mo-13 — Category → Defects → Resolution Duration Distribution** | The MO equivalent of JO's best chart: plots category, the specific defect, *and* how long it takes to fix, all in one drill path. Finds exactly which category/defect combination is both high-volume and slow — the single best signal for where to put parts inventory or technician headcount. |
| 2 | **cmo-15 / mo-15 — Delayed Duration Distribution → Defects** | "Delayed" here means escalated/past-deadline — this is the SLA-risk chart. It isolates orders that have already blown their deadline and drills straight to which defects are causing it, skipping past the noise of on-time work entirely. |
| 3 | **cmo-04 — Hotel → Escalation Levels → Top Defects** | Corp-only, but the highest-leverage executive chart in the set — most hotels should show Level 0 dominant; any hotel with real Level 2+ volume concentrated in a few defects is an immediate intervention candidate, and the chart tells you exactly which defects to fix first. |
| 4 | **cmo-18 / mo-18 — Type → Department → Defects** | The only chart that separates reactive (MO) from preventive (PM) work and then attributes it to a department. A property running mostly MO with little PM is firefighting, not maintaining — this chart is the fastest way to see that pattern and know which department to invest preventive budget in. |

Honorable mention: **mo-09/cmo-09 (Work Order Duration Distribution)** is the simplest, most-glanceable health check in the whole set (one look tells you if the < 1h–4h buckets dominate) but didn't make the top 4 because mo-13/mo-14 already subsume it with an added defect-level drilldown.

---

## 1. KPIs

### 1a. MO (Hotel) — 10 KPIs

| ID | Name | Notes | Formula | Good | Watch | Bad |
|---|---|---|---|---|---|---|
| mo_total_orders | Total Work Orders | Total maintenance orders in the selected hotel scope. | `COUNT(*) WHERE type = MO` | — | — | Neutral; compare against hotel history and staffing plan. |
| mo_completion_rate | Completion Rate | Share of MO jobs completed. | `completed / total * 100 WHERE type = MO` | ≥ 95% | 90–94.9% | < 90% |
| mo_open_rate | Open Work Order Rate | Share of MO jobs still open. | `open / total * 100 WHERE type = MO` | ≤ 5% | 5–10% | > 10% |
| mo_cancelled_rate | Cancelled Order Rate | Share of MO jobs cancelled. | `cancelled / total * 100 WHERE type = MO` | ≤ 2% | 2–5% | > 5% |
| mo_severity_index | Severity Index | Average severity proxy from escalation/state. | `AVG(severity_weight) WHERE type = MO` | ≤ 1.80 pts | 1.81–2.40 pts | > 2.40 pts |
| mo_guest_related | Guest Related Orders | Orders marked guest-related (raw count). | `COUNT(*) guest_related = true WHERE type = MO` | — | — | Neutral; compare against guest-mix and period trend. |
| mo_peak_category | Top Category Share | Share owned by the top MO category. | `MAX(category_count) / total * 100 WHERE type = MO` | ≤ 20% | 20–30% | > 30% |
| mo_unique_categories | Active Categories | Distinct MO categories observed. | `COUNT(DISTINCT category) WHERE type = MO` | — | — | Neutral; scale-dependent, compare across like-for-like hotels. |
| mo_pending_cases | Open Orders | Open work orders awaiting completion (raw count). | `open = total - completed - cancelled WHERE type = MO` | — | — | Neutral; interpret against hotel size and trend. |
| mo_category_span | Category Coverage | Distinct categories active in the selected period. | `COUNT(DISTINCT category) WHERE type = MO` | — | — | Neutral; compare against historical breadth. |

**Observation:** `mo_category_span` computes the exact same value as `mo_unique_categories` (both `= activeCategories`) — they're two KPI cards showing identical numbers under different names. `mo_pending_cases` is also just the absolute-count version of `mo_open_rate`. Neither is wrong, but they add card-count without adding new information — worth consolidating in a future pass.

### 1b. CMO (Corp) — 10 KPIs

| ID | Name | Notes | Formula | Good | Watch | Bad |
|---|---|---|---|---|---|---|
| cmo_kpi_01 | Total Work Orders | Total MO work orders across all hotels in the chain. | `COUNT(*) WHERE type = MO GROUP BY chain` | — | — | Neutral; compare against chain plan and prior periods. |
| cmo_kpi_02 | Completion Rate | Share of MO orders completed across the chain. | `completed / total * 100 WHERE type = MO` | ≥ 95% | 90–94.9% | < 90% |
| cmo_kpi_03 | Open Work Order Rate | Share of MO orders still open across the chain. | `open / total * 100 WHERE type = MO` | ≤ 5% | 5–10% | > 10% |
| cmo_kpi_04 | Cancelled Order Rate | Share of MO orders cancelled across the chain. | `cancelled / total * 100 WHERE type = MO` | ≤ 2% | 2–5% | > 5% |
| cmo_kpi_05 | Guest Related Share | Share of guest-related MO orders across the chain (%, not raw count). | `guest_related_orders / total * 100 WHERE type = MO` | ≤ 6% | 6–10% | > 10% |
| cmo_kpi_06 | Severity Index | Average severity proxy across chain work orders. | `AVG(severity_weight) WHERE type = MO` | ≤ 1.80 pts | 1.81–2.40 pts | > 2.40 pts |
| cmo_kpi_07 | Top Category Share | Share contributed by the largest maintenance category. | `MAX(category_count) / total * 100 WHERE type = MO` | ≤ 20% | 20–30% | > 30% |
| cmo_kpi_08 | Active Categories | Distinct maintenance categories active across the chain. | `COUNT(DISTINCT category) WHERE type = MO` | — | — | Neutral; compare against peer hotels. |
| cmo_kpi_09 | Touched Assets | Distinct defect/asset combinations touched across the chain. | `COUNT(DISTINCT defect_or_asset) WHERE type = MO` | — | — | Neutral; compare against hotel portfolio mix. |
| cmo_kpi_10 | Daily Average Orders | Average daily MO volume across the selected period. | `COUNT(*) / active_days WHERE type = MO` | — | — | Neutral; trend-based, compare against historical baseline. |

---

## 2. MO (Hotel) — Simple Charts (12)

### mo-01 — 🟣 Top 10 Category by Status
- **Chart Type:** Pie/Donut drilldown (top 10 categories → job status)
- **Notes:** Top 10 maintenance categories by work-order volume. Click a category to drill into its job-status breakdown.
- **Formula:** `COUNT(*) BY category (top 10) DRILLDOWN COUNT(*) BY job_status WITHIN category WHERE type = MO`
- **Good/Bad:** Healthy — Completed dominant per category with Open + Cancelled < 15%. Warning — a category with a high open or cancelled share.

### mo-02 — 🟣 Work Order Status by Department
- **Chart Type:** Pie/Donut drilldown (job status → created-by department)
- **Notes:** Work order status distribution. Click a status to drill into the created-by departments responsible.
- **Formula:** `COUNT(*) BY job_status DRILLDOWN COUNT(*) BY created_by_department WITHIN status WHERE type = MO`
- **Good/Bad:** Good — overall completion ≥ 90%. Watch — 75–90%. Bad — < 75%, or a department concentrating Open/Pending orders.

### mo-03 — 🟣 Daily Work Order Trend
- **Chart Type:** Spline (single-series daily volume line)
- **Notes:** Daily MO volume trend split by hotel for chain-level comparison. *(Note text is a leftover from the corp cmo-03 origin of this chart — at hotel scope this is a single hotel's own daily trend, not a chain comparison; the `hotel_code` grouping in the formula is likewise vestigial at single-hotel scope.)*
- **Formula:** `COUNT(*) BY created_date, hotel_code WHERE type = MO`
- **Good/Bad:** Healthy — stable daily volume with no runaway backlog. Warning — sustained upward spikes or recurring peak days without staffing.

### mo-04 — 🟣 Top 10 Defect by Daily Trend
- **Chart Type:** Bar (2-level drilldown: top 10 defects → daily order trend)
- **Notes:** Top 10 maintenance defects by total volume. Click a defect bar to drill into its daily order trend.
- **Formula:** `COUNT(*) BY defect (top 10) DRILLDOWN COUNT(*) BY created_date WITHIN defect WHERE type = MO`
- **Good/Bad:** Healthy — defect counts flat or declining. Warning — a defect rising day-over-day (emerging systemic issue).

### mo-05 — 🟣 Top 10 Defect vs Resolution Hours
- **Chart Type:** Dual-axis Column + Line — defect count (bars) vs average resolution hours (line)
- **Notes:** Top 10 defects by total work orders (bars, left axis) vs average resolution time in hours (line, right axis).
- **Formula:** `Bars: COUNT(*) BY defect (top 10); Line: AVG(resolution_minutes) / 60 BY defect WHERE is_completed AND type = MO`
- **Good/Bad:** Good — average resolution ≤ 4h. Watch — 4–8h. Bad — a high-volume defect averaging > 8h (resource bottleneck).

### mo-06 — 🟣 Top 10 Category vs Resolution Hours
- **Chart Type:** Dual-axis Column + Line — category count (bars) vs average resolution hours (line)
- **Notes:** Top 10 maintenance categories by work order volume (bars, left axis) vs average resolution time in hours (line, right axis).
- **Formula:** `Bars: COUNT(*) BY category (top 10); Line: AVG(resolution_minutes) / 60 BY category WHERE type = MO`
- **Good/Bad:** Good — average resolution ≤ 4h. Watch — 4–8h. Bad — a high-volume category averaging > 8h.

### mo-07 — 🟣 Guest Related Orders
- **Chart Type:** Pie/Donut (2-slice: Guest Related vs Non Guest Related)
- **Notes:** Compares guest-related and non-guest-related MO demand by hotel.
- **Formula:** `COUNT(*) guest_related vs non_guest_related BY hotel_code WHERE type = MO`
- **Good/Bad:** Healthy — guest-related share low and resolved fastest. Warning — rising guest-related volume (complaint risk).

### mo-08 — 🟣 Severity Index
- **Chart Type:** Column (severity-tier distribution, color-coded)
- **Notes:** Average severity comparison across hotels.
- **Formula:** `AVG(severity_weight) BY hotel_code WHERE type = MO`
- **Good/Bad:** Good — severity index stable and low. Watch — gradual rise. Bad — a climbing index (escalating unresolved risk).

### mo-09 — 🟣 Work Order Duration Distribution
- **Chart Type:** Column (6 fixed duration buckets)
- **Notes:** Distribution of work orders by resolution time. X-axis = duration buckets (< 1h to 24h+), Y-axis = number of orders.
- **Formula:** `COUNT(*) GROUP BY CASE WHEN resolution_minutes < 60 THEN '< 1h' ... ELSE '24h+' END WHERE type = MO`
- **Good/Bad:** Healthy — majority of orders in the < 1h–4h buckets. Watch — a growing 8h+ share. Bad — a heavy 24h+ tail (process or resource bottleneck).

### mo-10 — 🟣 24-Hour Work Order Distribution
- **Chart Type:** Column (00:00–23:00)
- **Notes:** Number of work orders created by hour of day. Reveals peak maintenance request windows for staffing decisions.
- **Formula:** `COUNT(*) GROUP BY EXTRACT(HOUR FROM created_datetime) WHERE type = MO`
- **Good/Bad:** Healthy — request peaks fall within staffed shifts. Warning — peaks in low-coverage hours (adjust on-call and shift cover).

### mo-11 — 🟣 Top 10 Defect > 24 Hours
- **Chart Type:** Bar (2-level drilldown: top 10 chronic defects → 24-hour distribution)
- **Notes:** Top 10 defects by count of orders taking > 24 hours to resolve. Click a bar to drill into its 24-hour distribution.
- **Formula:** `COUNT(*) BY defect WHERE resolution_minutes >= 1440 AND type = MO DRILLDOWN COUNT(*) BY HOUR(created_datetime) WITHIN defect`
- **Good/Bad:** Healthy — count near zero. Watch — a few recurring defects. Bad — defects routinely breaching 24h (chronic failures).

### mo-12 — 🟣 Top Assets / Defects
- **Chart Type:** Treemap
- **Notes:** Treemap of the most frequent maintenance assets or defects at this hotel.
- **Formula:** `COUNT(*) BY defect_or_asset WHERE type = MO ORDER BY count DESC`
- **Good/Bad:** Healthy — no single asset or defect dominates. Warning — one tile much larger than the rest (target for preventive maintenance).

---

## 3. MO (Hotel) — Long Charts (6)

### mo-13 — 🟣 Category → Defects → Resolution Duration Distribution
- **Chart Type:** Column (3-level drilldown: category → defects → resolution duration buckets)
- **Notes:** Columns show total work orders by category. Click a category to see its top defects, then a defect to see its resolution (completed) duration distribution.
- **Formula:** `COUNT(*) BY category, then TOP defect WITHIN category, then COUNT(*) BY resolution_duration_bucket WITHIN defect WHERE type = MO`
- **Good/Bad:** Healthy — most defects resolve within the < 1h–4h buckets. Warning — an 8h+ or 24h+ tail concentrated in one category/defect (resourcing or parts-availability gap).

### mo-14 — 🟣 Resolution Duration Distribution → Defects
- **Chart Type:** Column (2-level drilldown: duration bucket → defects)
- **Notes:** Columns show total work orders by resolution (completed) duration bucket. Click a bucket to drill into its top defects.
- **Formula:** `COUNT(*) BY resolution_duration_bucket, then TOP defect WITHIN bucket WHERE type = MO`
- **Good/Bad:** Healthy — majority of orders in the < 1h–4h buckets. Warning — a growing 24h+ share (process or resource bottleneck).

### mo-15 — 🟣 Delayed Duration Distribution → Defects
- **Chart Type:** Column (2-level drilldown: delayed/escalated duration bucket → defects)
- **Notes:** Columns show total work orders by delayed (escalated, past-deadline) duration bucket. Click a bucket to drill into its top defects.
- **Formula:** `COUNT(*) BY delayed_duration_bucket, then TOP defect WITHIN bucket WHERE type = MO AND deadline_variance_minutes > 0`
- **Good/Bad:** Healthy — few or no delayed orders. Warning — a growing 8h+/24h+ delayed share (SLA and escalation risk).

### mo-16 — ⏰ 🟣 24-Hour Distribution → Defects
- **Chart Type:** Column (2-level drilldown: hour → defects)
- **Notes:** Columns show total work orders by hour of day (00:00–23:00). Click an hour to drill into its top defects.
- **Formula:** `COUNT(*) BY HOUR(created_datetime), then TOP defect WITHIN hour WHERE type = MO`
- **Good/Bad:** Healthy — request peaks fall within staffed shifts. Warning — peaks in low-coverage hours (adjust on-call and shift cover).

### mo-17 — 🟣 Floor → Defects
- **Chart Type:** Column (2-level drilldown: floor → defects)
- **Notes:** Columns show total work orders by floor. Click a floor to drill into its top defects.
- **Formula:** `COUNT(*) BY floor, then TOP defect WITHIN floor WHERE type = MO`
- **Good/Bad:** Healthy — defects spread evenly across floors. Warning — one floor concentrates a disproportionate defect volume (localized asset or infrastructure issue).

### mo-18 — 🟣 Type → Department → Defects
- **Chart Type:** Column (3-level drilldown: MO/PM type → created-by department → defects)
- **Notes:** Columns show total work orders by MO/PM type. Click a type to see its created-by department mix, then a department to drill into its top defects.
- **Formula:** `COUNT(*) BY type, then COUNT(*) BY created_by_department WITHIN type, then TOP defect WITHIN department WHERE type = MO OR type = PM`
- **Good/Bad:** Healthy — PM (preventive) share is substantial relative to MO (reactive). Warning — MO heavily dominates PM (reactive-maintenance-driven operation).

---

## 4. CMO (Corp) — Simple Charts (12)

### cmo-01 — Hotel → Department → Top Defects
- **Chart Type:** Pie/Donut drilldown (3-level: hotel → created-by department → top defects)
- **Notes:** Outer donut shows total MO work orders by hotel. Click a hotel slice to see its created-by department mix, then click a department to drill into its top defects.
- **Formula:** `COUNT(*) BY hotel_code, then COUNT(*) BY created_by_department, then TOP defect WITHIN department WHERE type = MO`
- **Good/Bad:** Healthy — defects spread across departments. Warning — one department concentrates a disproportionate defect volume.

### cmo-02 — Hotel → Guest/Non-Guest → Top Defects
- **Chart Type:** Column (3-level drilldown: hotel → guest/non-guest split → top defects)
- **Notes:** Columns show total MO work orders by hotel. Click a hotel to see the guest-related vs non-guest-related split, then click a slice to drill into its top defects.
- **Formula:** `COUNT(*) BY hotel_code, then COUNT(*) BY guest_related, then TOP defect WITHIN guest_related WHERE type = MO`
- **Good/Bad:** Healthy — non-guest-related preventive work dominates. Warning — a hotel with a high guest-related defect share (guest-impacting maintenance risk).

### cmo-03 — Hotel by Job Status vs Average Resolution Duration
- **Chart Type:** Dual-axis stacked Column + Spline — job status mix (stacked bars) vs average resolution duration in hours (smooth line)
- **Notes:** Stacked columns show job status mix per hotel; the line shows average resolution (completed) duration in hours per hotel.
- **Formula:** `COUNT(*) BY hotel_code, job_status (stacked); AVG(resolution_hours) BY hotel_code (line) WHERE type = MO`
- **Good/Bad:** Healthy — high completed share with a stable/low average duration. Warning — a hotel where duration is climbing along with a growing open/pending stack.

### cmo-04 — Hotel → Escalation Levels → Top Defects
- **Chart Type:** Pie/Donut drilldown (3-level: hotel → escalation level → top defects)
- **Notes:** Outer donut shows total MO work orders by hotel. Click a hotel to see its escalation-level mix, then click a level to drill into its top defects.
- **Formula:** `COUNT(*) BY hotel_code, then COUNT(*) BY escalation_level, then TOP defect WITHIN escalation_level WHERE type = MO`
- **Good/Bad:** Healthy — Level 0 dominates. Warning — a hotel with a growing share at Level 2+ concentrated in a few defects (systemic escalation risk).

### cmo-05 — Open Work Order Rate by Hotel
- **Chart Type:** Column — open % per hotel
- **Notes:** Compares open-order pressure by hotel.
- **Formula:** `open_orders / total_orders * 100 BY hotel_code WHERE type = MO`
- **Good/Bad:** Good — open rate ≤ 10%. Watch — 10–20%. Bad — > 20% (backlog pressure) at any hotel.

### cmo-06 — Worldmap Maintenance by Hotel
- **Chart Type:** Map (choropleth by country, hotel labels)
- **Notes:** Country-level map with hotel labels for chain-wide maintenance visibility.
- **Formula:** `Country Value = SUM(total_orders) GROUP BY country_code; Label = CONCAT(hotel_code, total_orders) list per country WHERE type = MO`
- **Good/Bad:** Healthy — balanced regional load. Warning — a property or region with outsized maintenance demand.

### cmo-07 — Guest Related Orders by Hotel
- **Chart Type:** Stacked bar (Guest Related vs Non Guest Related per hotel)
- **Notes:** Compares guest-related and non-guest-related MO demand by hotel.
- **Formula:** `COUNT(*) guest_related vs non_guest_related BY hotel_code WHERE type = MO`
- **Good/Bad:** Healthy — guest-related share low chain-wide. Warning — a hotel with rising guest-related volume (complaint risk).

### cmo-08 — Severity Index by Hotel
- **Chart Type:** Column
- **Notes:** Average severity comparison across hotels.
- **Formula:** `AVG(severity_weight) BY hotel_code WHERE type = MO`
- **Good/Bad:** Good — average severity low and stable. Bad — a hotel with elevated average severity.

### cmo-09 — Work Order Duration Distribution (Chain)
- **Chart Type:** Column (2-level drilldown: chain-wide duration bucket → per-hotel breakdown)
- **Notes:** Chain-wide distribution of work orders by resolution time. Click a bucket to see per-hotel breakdown.
- **Formula:** `COUNT(*) BY duration_bucket WHERE type = MO DRILLDOWN COUNT(*) BY hotel_code WITHIN bucket`
- **Good/Bad:** Healthy — majority of orders in the < 1h–4h buckets chain-wide. Watch — a growing 8h+ share. Bad — a heavy 24h+ tail at any hotel.

### cmo-10 — 24-Hour Work Order Distribution (Chain)
- **Chart Type:** Column (2-level drilldown: chain-wide hour → per-hotel breakdown)
- **Notes:** Chain-wide 24-hour work order distribution. Click an hour to see per-hotel breakdown.
- **Formula:** `COUNT(*) BY HOUR(created_datetime) WHERE type = MO DRILLDOWN COUNT(*) BY hotel_code WITHIN hour`
- **Good/Bad:** Healthy — chain request peaks fall within staffed shifts. Warning — peaks in low-coverage hours at specific hotels.

### cmo-11 — Top 10 Defect > 24 Hours (Chain)
- **Chart Type:** Bar (2-level drilldown: top 10 chronic defects chain-wide → per-hotel breakdown)
- **Notes:** Top 10 defects with resolution > 24 hours across the chain. Click a bar to see per-hotel breakdown.
- **Formula:** `COUNT(*) BY defect WHERE resolution_minutes >= 1440 AND type = MO DRILLDOWN COUNT(*) BY hotel_code WITHIN defect`
- **Good/Bad:** Healthy — count near zero. Watch — a few recurring defects. Bad — defects routinely breaching 24h at specific hotels (chronic failures).

### cmo-12 — Top Assets / Defects Across Chain
- **Chart Type:** Treemap
- **Notes:** Treemap of the most frequent maintenance assets or defects across the chain.
- **Formula:** `COUNT(*) BY defect_or_asset WHERE type = MO`
- **Good/Bad:** Healthy — no single asset or defect dominates the chain. Warning — one tile much larger (chain-wide preventive-maintenance target).

---

## 5. CMO (Corp) — Long Charts (6 + Hotel Performance table)

### cmo-13 — Hotel → Category → Defects → Resolution Duration Distribution
- **Chart Type:** Column (4-level drilldown: hotel → category → defects → resolution duration buckets)
- **Notes:** Columns show total MO work orders by hotel. Click a hotel to see its category mix, a category to see its top defects, then a defect to see its resolution (completed) duration distribution.
- **Formula:** `COUNT(*) BY hotel_code, then COUNT(*) BY category, then TOP defect WITHIN category, then COUNT(*) BY resolution_duration_bucket WITHIN defect WHERE type = MO`
- **Good/Bad:** Healthy — most defects resolve within the < 1h–4h buckets. Warning — an 8h+ or 24h+ tail concentrated in one category/defect (resourcing or parts-availability gap).

### cmo-14 — Hotel → Resolution Duration Distribution → Defects
- **Chart Type:** Column (3-level drilldown: hotel → resolution duration bucket → defects)
- **Notes:** Columns show total MO work orders by hotel. Click a hotel to see its resolution (completed) duration distribution, then click a bucket to drill into its top defects.
- **Formula:** `COUNT(*) BY hotel_code, then COUNT(*) BY resolution_duration_bucket, then TOP defect WITHIN bucket WHERE type = MO`
- **Good/Bad:** Healthy — majority of orders in the < 1h–4h buckets. Warning — a growing 24h+ share (process or resource bottleneck).

### cmo-15 — Hotel → Delayed Duration Distribution → Defects
- **Chart Type:** Column (3-level drilldown: hotel → delayed/escalated duration bucket → defects)
- **Notes:** Columns show total MO work orders by hotel. Click a hotel to see its delayed (escalated, past-deadline) duration distribution, then click a bucket to drill into its top defects.
- **Formula:** `COUNT(*) BY hotel_code, then COUNT(*) BY delayed_duration_bucket, then TOP defect WITHIN bucket WHERE type = MO AND deadline_variance_minutes > 0`
- **Good/Bad:** Healthy — few or no delayed orders. Warning — a growing 8h+/24h+ delayed share (SLA and escalation risk).

### cmo-16 — Hotel → 24-Hour Distribution → Defects
- **Chart Type:** Column (3-level drilldown: hotel → hour → defects)
- **Notes:** Columns show total MO work orders by hotel. Click a hotel to see its 24-hour creation distribution, then click an hour to drill into its top defects.
- **Formula:** `COUNT(*) BY hotel_code, then COUNT(*) BY HOUR(created_datetime), then TOP defect WITHIN hour WHERE type = MO`
- **Good/Bad:** Healthy — request peaks fall within staffed shifts. Warning — peaks in low-coverage hours (adjust on-call and shift cover).

### cmo-17 — Hotel → Floor → Defects
- **Chart Type:** Column (3-level drilldown: hotel → floor → defects)
- **Notes:** Columns show total MO work orders by hotel. Click a hotel to see its floor breakdown, then click a floor to drill into its top defects.
- **Formula:** `COUNT(*) BY hotel_code, then COUNT(*) BY floor, then TOP defect WITHIN floor WHERE type = MO`
- **Good/Bad:** Healthy — defects spread evenly across floors. Warning — one floor concentrates a disproportionate defect volume (localized asset or infrastructure issue).

### cmo-18 — Hotel → Type → Department → Defects
- **Chart Type:** Column (4-level drilldown: hotel → MO/PM type → created-by department → defects)
- **Notes:** Columns show total MO work orders by hotel. Click a hotel to see its MO/PM type split, a type to see its created-by department mix, then a department to drill into its top defects.
- **Formula:** `COUNT(*) BY hotel_code, then COUNT(*) BY type, then COUNT(*) BY created_by_department WITHIN type, then TOP defect WITHIN department WHERE type = MO OR type = PM`
- **Good/Bad:** Healthy — PM (preventive) share is substantial relative to MO (reactive). Warning — MO heavily dominates PM (reactive-maintenance-driven operation).

### Hotel Performance table (`CorpMoPerformanceTable`)
- **Chart Type:** Table (one row per hotel, sorted by computed Risk Rank, highest risk first)
- **Notes:** Columns: Orders, Completion %, Open Rate %, Guest Share %, Severity, Top Category (+ its share), Top Defect/Item, Daily Average, Risk Rank. Risk Rank is a weighted composite (`severity×25 + openRate×0.8 + guestShare×0.5 + topCategoryShare×0.4 + volumeFactor`) designed to surface the hotel most in need of attention at a glance, rather than just the busiest one.
- **Formula:** `orders=COUNT(*); completion=completed/total*100; openRate=open/total*100; guestShare=vip_total/total*100; severity=AVG(severity_weight); topCategoryShare=MAX(category_count)/total*100; dailyAverage=total/active_days — all BY hotel_code, then riskRank = severity*25 + openRate*0.8 + guestShare*0.5 + topCategoryShare*0.4 + volumeFactor`
- **Good/Bad:** Same per-column thresholds as the corresponding KPI (Section 1b) for Completion/Open/Severity/Guest Share; Risk Rank itself has no fixed threshold — use it purely as a relative ranking to decide which hotel to review first.
