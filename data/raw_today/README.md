# Input format: `data/raw_today/<date>.json`

One file per **India calendar day** (00:00–24:00 IST). `scripts/build_today.py` reads it and writes
`reports/daily_live/<date>.json` + `reports/daily_live/latest.json`, which `index.html` (the live home
page) fetches client-side. Money in INR, plain numbers (no ₹ sign, no commas). This is a same-day,
partial-day snapshot — it is rebuilt several times during the day as more is spent and more leads come in.

```json
{
 "date": "2026-11-18",                 // the India day this snapshot covers
 "pulled_at": "2026-11-18T11:05:00+05:30",
 "account": {"id": "392337929851918", "name": "mitranglobal ad account"},
 "currency": "INR",
 "meta": {                              // Meta Ads, level=ad_account, time_range = this day only
  "spend": 0, "impressions": 0, "reach": 0, "link_clicks": 0, "leads": 0, "purchases": 0
 },
 "crm": {                               // CRM cross-check, same method as RUNBOOK step 1b, for THIS day only
  "source": "Condtioning Lead 2.0 form, India day, Meta-ad visitors only, tests excluded, each contact counted once",
  "form_fills_all": 0,                  // every submission of the form today
  "form_fills_meta": 0,                 // from Meta ads, tests removed
  "leads_meta_unique": 0,               // unique people — the number used as "final" below
  "bookings_created_today": 0           // Lead Management "Appointment Booked", created today, tests removed
 },
 "ad_sync_stale_days": 0,               // from get_ad_connection_health; 0 or null if synced today/yesterday
 "notes": [],                           // any plain-English caveat for this run (connector hiccup, etc.)
 "campaigns_month_range": {"since": "2026-11-01", "until": "2026-11-18"},  // the MTD window used below
 "campaigns": [                         // optional: every campaign with any spend this month-to-date,
                                         // ACTIVE or PAUSED. Powers the carousel on meta.html's Campaign
                                         // explorer tab. Omit, or leave as [], if this run didn't pull it.
  {
   "id": "120252477836170412",          // campaign id, used only to tell same-named campaigns apart
   "name": "Schedule | ADV | Video | 13Nov26",
   "status": "ACTIVE",                  // effective_status
   "objective": "OUTCOME_LEADS",
   "daily_budget": 999,                 // plain number, INR
   "created_time": "2026-11-13",        // date only
   "last_active": "2026-11-18",         // date of its most recent spend (updated_time, date only)
   "spend_today": 647.31, "impressions_today": 365, "clicks_today": 9, "ctr_today": 2.47,   // today only; 0/null if not active today
   "spend_mtd": 5060.53, "impressions_mtd": 4144, "clicks_mtd": 117, "ctr_mtd": 2.82          // this month to date
  }
 ]
}
```

## Campaign rows

Two pulls, both `ads_get_ad_entities`, `level=campaign`:

1. **Today's slice**: `date_preset=today` (or `time_range` = today only), filter `effective_status IN
   ACTIVE` — gives `spend_today`/`impressions_today`/`clicks_today`/`ctr_today` for whatever's running
   right now.
2. **Month-to-date**: `time_range` = `{"since": "<1st of this month>", "until": "<today>"}`, filter
   `amount_spent GREATER_THAN 0`, fields `name, effective_status, objective, daily_budget, amount_spent,
   impressions, clicks, ctr, created_time, updated_time` — this is the list that actually shows what's
   been running this month, paused or not. **Don't filter this one by `effective_status`** — a paused
   campaign that spent earlier this month still belongs in the list, which is the whole point of pulling
   it (a same-day-only or active-only list misses everything that ran and stopped).

Merge by campaign id: every campaign from pull 2 gets a row; if it also appears in pull 1, fill in its
`*_today` fields, otherwise those are `0`/`null`. When two campaigns share the same name, append a short
disambiguator to `name` (e.g. `" (b)"`) using `created_time` order, oldest first, so the dashboard's card
titles stay distinct. Strip the `₹`/`%` and unwrap `{value, unit}` objects before writing: every number
in this file is a plain number. Sort the array by `spend_mtd` descending before writing it.

## What `scripts/build_today.py build` computes (deterministic — do not hand-count leads)

- `final_lead_count` = `crm.leads_meta_unique` (the CRM, deduped — Meta's own `lead` field undercounts,
  same conclusion as RUNBOOK step 1b and every recent weekly report). Meta's count is kept alongside
  it for reference, never added to it.
- `cost_per_lead` = `meta.spend` ÷ `final_lead_count` (null if zero leads so far).
- `cost_per_booking` = `meta.spend` ÷ `crm.bookings_created_today` (null if zero bookings so far).
- A sanity line: `form_fills_all` must equal kept (`form_fills_meta`) + dropped (tests + non-Meta), the
  same check RUNBOOK step 1b asks for every week — print it and look at it before committing.
- `flags`: a warning if `ad_sync_stale_days` > 1 (CRM's Meta ad-spend sync is stale — leads/bookings are
  still live, only the CRM's own cost-per-lead calc may lag), or if `meta.leads` and
  `crm.leads_meta_unique` disagree by more than a couple either way (worth a second look, not
  necessarily wrong — Meta can lag by a few hours).

A missing metric is `0`. Never publish a run where the Meta Ads or CRM pull itself failed — leave
`reports/daily_live/latest.json` as it was and say so in the task's own log instead.
