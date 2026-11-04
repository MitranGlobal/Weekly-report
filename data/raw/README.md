# Input format: `data/raw/<report_date>.json`

One file per Monday report. `scripts/build_week.py` reads it. Money in INR, plain numbers (no ₹ sign, no commas).

```json
{
 "report_date": "2026-11-09",          // the Monday the report is for
 "week_start": "2026-11-02",           // Monday of the week covered
 "week_end": "2026-11-08",             // Sunday of the week covered
 "account": {"id": "392337929851918", "name": "mitranglobal ad account"},
 "currency": "INR",
 "result_label": "bookings",           // what "results" means for these campaigns
 "pulled_at": "2026-11-09",
 "backfilled": false,
 "totals": {                           // account level; reach is de-duplicated
  "cur":  {"spend": 0, "impressions": 0, "reach": 0, "link_clicks": 0, "results": 0, "leads": 0, "purchases": 0},
  "prev": {"spend": 0, "impressions": 0, "reach": 0, "link_clicks": 0, "results": 0, "leads": 0, "purchases": 0}
 },
 "campaigns": [                        // every campaign that spent in either week
  {"id": "…", "name": "…", "objective": "OUTCOME_LEADS", "status": "ACTIVE", "daily_budget": 999,
   "result_type": "Website appointments scheduled",
   "cur":  {"spend": 0, "impressions": 0, "reach": 0, "link_clicks": 0, "results": 0, "leads": 0, "purchases": 0},
   "prev": {"spend": 0, "impressions": 0, "reach": 0, "link_clicks": 0, "results": 0, "leads": 0, "purchases": 0}}
 ],
 "daily": [                            // 7 rows, Monday to Sunday of the week covered
  {"date": "2026-11-02", "spend": 0, "impressions": 0, "link_clicks": 0, "leads": 0}
 ],
 "headline": "One sentence with the main number.",
 "tips": [{"type": "good|bad|warn", "title": "Short title", "text": "One or two sentences with real numbers."}],
 "actions": ["Action 1", "Action 2", "Action 3"]
}
```

A missing metric is `0`. `status` is the campaign's status when the data was pulled.
