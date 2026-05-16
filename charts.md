# IM Dashboard — KPI & Chart Reference

Module: **Incident Management (IM)**  
Dashboard schema: `im-v1`  
Source fields used: `incident_status`, `severity`, `incident_category`, `incident_item_name`, `room_no`, `created_date`, `nights`

---

## Key Performance Indicators (10 KPIs)

Displayed as two rows of 5 accent cards at the top of the dashboard.  
Values recompute in real time when a date-range filter is applied (except KPI 08, which always shows the full-period value).

---

### KPI 01 — Incident Volume

| | |
|---|---|
| **Display** | Integer, e.g. `314 cases` |
| **Availability** | Always |
| **Note** | Total number of incidents logged in the selected period. |
| **Formula** | `COUNT(all incidents)` |

---

### KPI 02 — Closure Rate

| | |
|---|---|
| **Display** | Percentage to 1 decimal place, e.g. `95.5%` |
| **Availability** | Always |
| **Note** | Percentage of incidents resolved (status = Completed) out of all incidents. The primary operational efficiency indicator. |
| **Formula** | `Completed ÷ Total × 100` |

---

### KPI 03 — Open Backlog Rate

| | |
|---|---|
| **Display** | Percentage to 1 decimal place, e.g. `0.3%` |
| **Availability** | Always |
| **Note** | Percentage of incidents still open or pending — not yet completed or cancelled. The complement of Closure Rate minus the Cancelled share. |
| **Formula** | `(Total − Completed − Cancelled) ÷ Total × 100` |

---

### KPI 04 — Pending Cases

| | |
|---|---|
| **Display** | Integer, e.g. `1 cases` |
| **Availability** | Always |
| **Note** | Count of incidents currently open or in a pending status (any status that is neither Completed nor Cancelled). |
| **Formula** | `COUNT(incident_status ∉ {Completed, Cancelled})` |

Relationship: `Pending = Total − Completed − Cancelled`

---

### KPI 05 — Cancelled Cases

| | |
|---|---|
| **Display** | Integer, e.g. `13 cases` |
| **Availability** | Always |
| **Note** | Count of incidents that were withdrawn or cancelled before resolution. A rising count may indicate duplicate logging or guest complaint withdrawals. |
| **Formula** | `COUNT(incident_status = "Cancelled")` |

---

### KPI 06 — VIP Incident Share

| | |
|---|---|
| **Display** | N/A |
| **Availability** | Requires a `VIP Code` column in the CSV |
| **Note** | Share of incidents linked to VIP guests. Enables targeted VIP service tracking. Not available until the CSV includes a `VIP Code` field with non-placeholder values. |
| **Formula** | `COUNT(VIP Code is non-blank and not placeholder) ÷ Total × 100` |

Placeholder values treated as blank: `–`, `—`, `N/A`, `NA`, `None`, `null` (case-insensitive).

---

### KPI 07 — VIP Closure Rate

| | |
|---|---|
| **Display** | N/A |
| **Availability** | Requires a `VIP Code` column in the CSV |
| **Note** | Closure rate restricted to VIP incidents only. Measures service delivery for the highest-priority guests. |
| **Formula** | `COUNT(Completed AND VIP) ÷ COUNT(VIP) × 100` |

---

### KPI 08 — Repeat Incident Rate

| | |
|---|---|
| **Display** | Percentage to 1 decimal place, e.g. `21.7%` |
| **Availability** | Always |
| **Note** | Share of incidents belonging to a repeated room + category + item combination. High rates indicate unresolved root causes or recurring maintenance failures. This KPI always shows the full-period value even when a date filter is active. |
| **Formula** | `Incidents in groups(room_no + incident_category + incident_item_name) with count > 1 ÷ Total × 100` |

**How groups work:** Every unique combination of `(room_no, incident_category, incident_item_name)` forms a group. If that group appears more than once in the data, every incident in the group is counted as a repeat.

---

### KPI 09 — Avg First Response Time

| | |
|---|---|
| **Display** | N/A |
| **Availability** | Requires response/investigation timestamp columns in the CSV |
| **Note** | Average time (in minutes) between incident creation and first response. Not available until the CSV includes columns for both `created_date` and a first-response or investigation timestamp. |
| **Formula** | `AVG(first_response_timestamp − created_date) in minutes` |

---

### KPI 10 — Avg Severity Score

| | |
|---|---|
| **Display** | Decimal to 2 places, e.g. `1.99 pts` |
| **Availability** | Always |
| **Note** | Weighted average severity score across all incidents. A score above 2.5 indicates an elevated proportion of High/Critical incidents and warrants management attention. |
| **Formula** | `(count(Low)×1 + count(Medium)×2 + count(High)×3 + count(Critical)×4) ÷ Total incidents` |

Severity weights: **Low = 1 · Medium = 2 · High = 3 · Critical = 4**

---

## Executive Analysis Charts (4 EAC)

Displayed 2 per row directly below the KPIs. All 4 charts are **filterable** — they rebuild from `raw_daily` buckets when a date range is applied.

---

### EAC 01 — Incident Status Distribution

| | |
|---|---|
| **Chart type** | Donut pie (innerSize 45%) |
| **Filterable** | Yes |
| **Note** | Distribution of all incidents by current status. Completed = resolved; Cancelled = withdrawn; any other status = open/pending. |
| **Formula** | `COUNT(incidents) grouped by incident_status` |

Slices are sorted by count descending. Fixed colours: Completed = `#22c55e` (green), Cancelled = `#94a3b8` (slate).

---

### EAC 02 — Severity Breakdown

| | |
|---|---|
| **Chart type** | Column |
| **Filterable** | Yes |
| **Note** | Count of incidents at each severity level. Critical and High require immediate management attention. |
| **Formula** | `COUNT(incidents) grouped by severity` |

Fixed order: **Critical → High → Medium → Low**.  
Fixed colours: Critical = `#dc3545`, High = `#fd7e14`, Medium = `#ffc107`, Low = `#28a745`.  
Only severity levels present in the data are shown.

---

### EAC 03 — Daily Incident Volume

| | |
|---|---|
| **Chart type** | Area spline |
| **Filterable** | Yes |
| **Note** | Daily incident count over the period. Spikes indicate high-activity days; review staffing and root causes on those dates. |
| **Formula** | `COUNT(incidents) grouped by DATE(created_date)` |

Each data point = one calendar day. Days with zero incidents are omitted from the x-axis (no data in that day's bucket).

---

### EAC 04 — Top Incident Categories

| | |
|---|---|
| **Chart type** | Horizontal bar |
| **Filterable** | Yes |
| **Note** | Most frequent incident categories. Front Office and Housekeeping typically dominate; focus improvement efforts here. |
| **Formula** | `COUNT(incidents) grouped by incident_category ORDER BY count DESC LIMIT 10` |

Shows up to 10 categories. Categories are ranked by total incident count across the full period; rank is preserved when a date filter is applied.

---

## Core Charts — General Manager View (20 Charts)

Displayed 2 per row. Charts marked **Full Period** cannot be rebuilt from daily buckets and always show the complete dataset regardless of any date filter applied.

---

### Chart 01 — Incidents by Category

| | |
|---|---|
| **Chart type** | Column |
| **Filterable** | Yes |
| **Note** | All incident categories ranked by volume. Prioritise the top categories for process improvement and training. |
| **Formula** | `COUNT by incident_category ORDER BY count DESC` |

Shows all categories (no limit). Sorted by count descending.

---

### Chart 02 — Severity Distribution

| | |
|---|---|
| **Chart type** | Donut pie (innerSize 50%) |
| **Filterable** | Yes |
| **Note** | Proportional share of each severity level. Medium and above indicate operational risk requiring management visibility. |
| **Formula** | `COUNT by severity ÷ Total × 100` |

Fixed order and colours same as EAC 02.

---

### Chart 03 — Status Distribution

| | |
|---|---|
| **Chart type** | Donut pie (innerSize 50%) |
| **Filterable** | Yes |
| **Note** | Proportion of incidents in each status. A high Completed share signals operational efficiency. |
| **Formula** | `COUNT by incident_status ÷ Total × 100` |

---

### Chart 04 — Daily Incident Trend

| | |
|---|---|
| **Chart type** | Spline |
| **Filterable** | Yes |
| **Note** | Daily incident volume. Use to identify spikes, busy days, and weekly rhythms for staffing optimisation. |
| **Formula** | `COUNT by DATE(created_date)` |

---

### Chart 05 — Monthly Incident Volume

| | |
|---|---|
| **Chart type** | Column |
| **Filterable** | Yes |
| **Note** | Monthly aggregate incident count. Useful for period-over-period comparison and trend analysis. |
| **Formula** | `COUNT by MONTH(created_date)` |

Month key format: `YYYY-MM`. Data labels show the exact count above each bar.

---

### Chart 06 — Incidents by Day of Week

| | |
|---|---|
| **Chart type** | Column |
| **Filterable** | Yes |
| **Note** | Incident distribution by day of the week. Identifies the busiest operational days for staffing planning. |
| **Formula** | `COUNT by DAYOFWEEK(created_date)` |

Day order: Sun → Mon → Tue → Wed → Thu → Fri → Sat.

---

### Chart 07 — Top 15 Incident Items

| | |
|---|---|
| **Chart type** | Horizontal bar |
| **Filterable** | **No (Full Period)** |
| **Note** | The 15 most-reported incident item types. Repeated appearance of specific items signals a systemic issue requiring targeted maintenance or process change. |
| **Formula** | `COUNT by incident_item_name ORDER BY count DESC LIMIT 15` |

Source field: `incident_item_name`.

---

### Chart 08 — Top 10 Rooms by Incidents

| | |
|---|---|
| **Chart type** | Horizontal bar |
| **Filterable** | **No (Full Period)** |
| **Note** | Rooms with the most incidents. Frequent incidents in the same room may indicate unresolved maintenance issues, room condition problems, or a particular guest profile pattern. |
| **Formula** | `COUNT by room_no ORDER BY count DESC LIMIT 10` |

Labels displayed as "Room X" where X is the room number from `room_no`.

---

### Chart 09 — Category × Status (Stacked)

| | |
|---|---|
| **Chart type** | Stacked column |
| **Filterable** | **No (Full Period)** |
| **Note** | Status breakdown within the top 8 categories. Categories with a high open/pending proportion need process attention and follow-up. |
| **Formula** | `COUNT by (incident_category, incident_status) for top 8 categories by total volume` |

Each column = one category; stacked segments = status values. Fixed colours for Completed and Cancelled; other statuses use default palette.

---

### Chart 10 — Category × Severity (Top 5)

| | |
|---|---|
| **Chart type** | Grouped column |
| **Filterable** | **No (Full Period)** |
| **Note** | Severity distribution for the top 5 incident categories. Highlights which categories carry the highest operational risk. |
| **Formula** | `COUNT by (incident_category, severity) for top 5 categories by total volume` |

Groups: one cluster per category, one bar per severity level (Critical/High/Medium/Low). Fixed severity colours.

---

### Chart 11 — Closure Rate by Category (%)

| | |
|---|---|
| **Chart type** | Column |
| **Filterable** | **No (Full Period)** |
| **Note** | Percentage of incidents resolved within each category. Categories below 90% may indicate process gaps, resourcing issues, or delayed escalation. |
| **Formula** | `COUNT(incident_status = "Completed") ÷ COUNT(all) × 100 per category, for top 10 categories` |

Y-axis capped at 100%. Data labels show `XX.X%`.

---

### Chart 12 — High + Critical Incidents Daily

| | |
|---|---|
| **Chart type** | Spline (red, `#ef4444`) |
| **Filterable** | Yes |
| **Note** | Daily count of High and Critical severity incidents. Sustained elevation signals systemic risk requiring escalation. Any day above zero should be reviewed. |
| **Formula** | `COUNT(severity IN {High, Critical}) by DATE(created_date)` |

---

### Chart 13 — Severity by Month (Stacked)

| | |
|---|---|
| **Chart type** | Stacked column |
| **Filterable** | **No (Full Period)** |
| **Note** | Monthly incident volume stacked by severity. Increasing Critical/High share month-over-month indicates rising operational risk requiring management escalation. |
| **Formula** | `COUNT by (MONTH(created_date), severity)` |

Stack order: Critical (bottom) → High → Medium → Low (top). Fixed severity colours.

---

### Chart 14 — Top 5 Categories — Daily Trend

| | |
|---|---|
| **Chart type** | Multi-series spline |
| **Filterable** | Yes |
| **Note** | Daily volume trend for the top 5 incident categories. Detect category-specific spikes and diverging trends to support targeted interventions. |
| **Formula** | `COUNT by (DATE(created_date), incident_category) for the top 5 categories by total volume` |

One line per category. Categories ranked by total count over the full period; same 5 categories shown regardless of date filter.

---

### Chart 15 — Severity Daily Trend

| | |
|---|---|
| **Chart type** | Multi-series spline |
| **Filterable** | Yes |
| **Note** | Daily incident count per severity level. Track whether High/Critical incidents are increasing over time relative to lower severity incidents. |
| **Formula** | `COUNT by (DATE(created_date), severity)` |

One line per severity level. Only severity levels with at least one incident are shown. Fixed severity colours.

---

### Chart 16 — Repeat Incident Rate by Category (%)

| | |
|---|---|
| **Chart type** | Column (amber, `#f59e0b`) |
| **Filterable** | **No (Full Period)** |
| **Note** | Percentage of incidents in each category that share the same `(room_no, incident_category, incident_item_name)` combination with at least one other incident. High repeat rates indicate unresolved root causes within that category. |
| **Formula** | `Incidents in groups(room_no + category + item_name) with count > 1 ÷ category total × 100` |

Only categories with at least one incident are shown. Y-axis capped at 100%.

**Relationship to KPI 08:** KPI 08 uses the same grouping logic but aggregates across all categories; Chart 16 breaks it down per category.

---

### Chart 17 — Incident Heatmap (Weekday × Month)

| | |
|---|---|
| **Chart type** | Heatmap |
| **Filterable** | **No (Full Period)** |
| **Note** | Incident density by day of week and month. Dark cells mark the highest-volume weekday/month combinations. Use to plan seasonal staffing adjustments. |
| **Formula** | `COUNT by (MONTH(created_date), DAYOFWEEK(created_date))` |

X-axis = months (`YYYY-MM`). Y-axis = day of week (Sun–Sat, reversed so Sunday is at the top).  
Colour scale: light blue (`#e0f2fe`) = low volume → dark navy (`#1e3a5f`) = high volume.  
Cell value = incident count for that weekday/month combination.

---

### Chart 18 — Guest Stay Length Distribution

| | |
|---|---|
| **Chart type** | Column |
| **Filterable** | **No (Full Period)** |
| **Note** | Distribution of incidents by guest stay length (number of nights) at the time the incident was logged. Longer stays often correlate with higher incident counts. |
| **Formula** | `COUNT by nights bucket: 0, 1, 2, 3, 4, 5+` |

Source field: `nights` (numeric). Bucketing rules:
- `0 nights` — 0 or negative
- `1 night` — exactly 1
- `2 nights` — exactly 2
- `3 nights` — exactly 3
- `4 nights` — exactly 4
- `5+ nights` — 5 or more

Incidents with no `nights` value are excluded.

---

### Chart 19 — Category Share (Pie)

| | |
|---|---|
| **Chart type** | Pie |
| **Filterable** | Yes |
| **Note** | Proportional share of the top 10 incident categories. Use to identify where management focus is most needed at a glance. |
| **Formula** | `COUNT by incident_category ÷ Total × 100, for top 10 categories` |

Limited to top 10 categories. Percentages are relative to the top-10 total, not the full dataset.

---

### Chart 20 — High + Critical Incidents by Category

| | |
|---|---|
| **Chart type** | Column (red, `#ef4444`) |
| **Filterable** | **No (Full Period)** |
| **Note** | Count of High and Critical incidents per category. Categories with many critical incidents require immediate priority attention and root-cause analysis. |
| **Formula** | `COUNT(severity IN {High, Critical}) by incident_category, for top 10 categories` |

---

## Date Filter Behaviour

| Filter state | KPIs | EAC charts | GM charts |
|---|---|---|---|
| **No filter** | Full period | Full period | Full period |
| **Filter active** | Recomputed from `raw_daily` (except KPI 08) | Rebuilt from filtered daily buckets | Filterable = rebuilt; Non-filterable = full period + "Full Period" badge |

Filterable charts (recompute on client from `raw_daily`):
`eac_01, eac_02, eac_03, eac_04, chart_01, chart_02, chart_03, chart_04, chart_05, chart_06, chart_12, chart_14, chart_15, chart_19`

Full-period only (always show complete dataset):
`chart_07, chart_08, chart_09, chart_10, chart_11, chart_13, chart_16, chart_17, chart_18, chart_20`

---

## Field Mapping Reference

| Dashboard field | CSV column |
|---|---|
| Status | `incident_status` |
| Severity | `severity` |
| Category | `incident_category` |
| Item | `incident_item_name` |
| Room | `room_no` |
| Date | `created_date` |
| Nights | `nights` |
| Repeat key | `room_no + incident_category + incident_item_name` |
| VIP *(not yet available)* | `VIP Code` |
| First response *(not yet available)* | response/investigation timestamp |
