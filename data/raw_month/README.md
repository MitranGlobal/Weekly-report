# Input format: `data/raw_month/<YYYY-MM>.json`

One file per month. `scripts/build_month.py` reads it and writes `reports/monthly/<YYYY-MM>.json`,
which `month.html` (the calendar page) fetches client-side. Money in INR, plain numbers.

Each day uses the **same dedup rule as RUNBOOK step 1b / `data/raw_today/`**: CRM leads are deduped
(Meta-ad visitors only, tests removed, one contact counted once — here, once per month, on the first
day it appears within the month) and that deduped count, not Meta's own `lead` field, is what gets
added up as "leads to date". Never backfill a day by hand-counting a list — compute it the same way
every time, in code, or pull it fresh.

```json
{
 "month": "2026-11",
 "account": {"id": "392337929851918", "name": "mitranglobal ad account"},
 "currency": "INR",
 "days": [
  {"date": "2026-11-01", "meta": {"spend": 0, "impressions": 0, "link_clicks": 0, "leads": 0},
   "crm_leads_deduped": 0, "bookings": 0}
 ]
}
```

## What's intentionally left out, and why

- **Reach** is not included. Reach is de-duplicated people, not events — adding one day's reach to
  another's double-counts anyone reached on both days. There is no correct way to turn daily reach
  into a running "reach to date" total, so showing one would be exactly the kind of misleading number
  this file exists to avoid. (Meta can report reach for an arbitrary date range directly — that's a
  fresh query, not a sum of days — if a true month-to-date reach is ever needed.)
- **Bookings before today are a lower bound, not an exact count.** They come from querying the CRM's
  *current* "Appointment Booked" stage and filtering by `created_at` — a live snapshot. A booking made
  on, say, 10 Nov that has since moved to a later stage (won, lost, rescheduled) no longer shows up in
  that stage today, so it silently drops out of the day-10 count. `scripts/build_month.py` marks every
  day except today as `bookings_is_floor: true` for this reason. Only *today's* booking count (built by
  the same run that also builds `data/raw_today/`) is current-stage-complete and not undercounted.
  Don't quote a past day's booking number as final without this caveat.

## What `scripts/build_month.py build` computes

- Running (cumulative-from-day-1) totals for `spend`, `impressions`, `link_clicks`, `meta_leads`,
  `crm_leads_deduped` (used as `leads` — the final/headline number, same rule as everywhere else in
  this repo) and `bookings`, one row per day, so the calendar page can show "as of this date" totals
  with one lookup.
- A found vs. missing check: every date from the 1st to the last day present must appear, in order,
  with no gaps — the script refuses to build otherwise (a gap would make every later cumulative total
  wrong, silently).
