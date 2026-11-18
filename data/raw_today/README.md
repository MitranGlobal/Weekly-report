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
 "notes": []                            // any plain-English caveat for this run (connector hiccup, etc.)
}
```

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
