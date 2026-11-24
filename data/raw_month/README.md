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
 "lead_methodology": "crm_deduped",
 "bookings_available": true,
 "days": [
  {"date": "2026-11-01", "meta": {"spend": 0, "impressions": 0, "link_clicks": 0, "leads": 0},
   "crm_leads_deduped": 0, "bookings": 0}
 ]
}
```

`lead_methodology` and `bookings_available` are file-level, not per-day — a month is either fully
covered by the CRM cross-check or it isn't:

- `"lead_methodology": "crm_deduped"` (default if omitted) — every day in this month was cross-checked
  against the CRM the way RUNBOOK step 1b describes. `crm_leads_deduped` is the real, reconciled count.
- `"lead_methodology": "meta_only"` — this month predates the cross-check (it started 18 Nov 2026).
  There is no CRM-deduped number for these days; `crm_leads_deduped` is set to Meta's own `lead` field
  as the only figure that exists, and `build_month.py` labels it a lower bound in the output and in
  `month.html`'s banner. **Never quietly relabel a `meta_only` month's leads as "final" — that is
  exactly the kind of mistake (106 vs 78) this whole system exists to prevent.**
- `"bookings_available": false` — no day-level booking data exists for this month at all (set this
  alongside `meta_only` for historical months); `bookings` can be `0` as a placeholder and is ignored.
  `month.html` shows "N/A", not a zero, so it's never mistaken for "no bookings happened."

Months before April 2026 are not built at all: Meta's lifetime data confirms this ad account had zero
spend before then, so there is nothing to report. `month.html`'s "previous month" button stops there.

## What's intentionally left out, and why

- **Reach** is not included. Reach is de-duplicated people, not events — adding one day's reach to
  another's double-counts anyone reached on both days. There is no correct way to turn daily reach
  into a running "reach to date" total, so showing one would be exactly the kind of misleading number
  this file exists to avoid. (Meta can report reach for an arbitrary date range directly — that's a
  fresh query, not a sum of days — if a true month-to-date reach is ever needed.)
- **Bookings** — set `"bookings_methodology": "created_any_booked_stage"` (file-level; used from Nov 2026).
  A booking is a CRM deal created that day (tests removed) that has reached "Appointment Booked" **or any
  later stage** (Reschedule, Show up, No show up, Payment done, Won). Pull each of those stages with
  `query_opportunities` and bucket by `created_at`. Moved-on deals still count, so past days are exact and
  `bookings_is_floor` is false. Cross-check: Appointment Booked + Show up + No show up for the month's
  leads must equal the Lead Management board for the month.
- **Legacy method (`stage_snapshot`, the default when the field is omitted): bookings before today are a lower bound, not an exact count.** They come from querying the CRM's
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
