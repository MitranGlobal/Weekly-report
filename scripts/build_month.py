#!/usr/bin/env python3
"""
Build the monthly cumulative-to-date report (calendar view).

Reads data/raw_month/<YYYY-MM>.json (one row per day, same CRM-dedup rule as
data/raw_today and build_today.py — see data/raw_month/README.md) and writes
reports/monthly/<YYYY-MM>.json: every day plus a running (cumulative-from-day-1)
total for spend, impressions, link_clicks, meta_leads, leads (= crm_leads_deduped,
the final/headline number) and bookings.

Refuses to write output if the day list has a gap or is out of order, since a
missing day would silently corrupt every later cumulative total. This mirrors
build_today.py's refuse-to-publish-on-failure design, for the same reason: a
wrong number is worse than a late one.

Usage:
  python3 scripts/build_month.py build  data/raw_month/2026-11.json
  python3 scripts/build_month.py summary data/raw_month/2026-11.json
"""
import json
import sys
import datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def inr(n):
    n = round(float(n))
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if n < 0 else "") + "₹" + s


def num(n):
    return f"{n:,}"


def check_contiguous(days):
    dates = [d["date"] for d in days]
    parsed = [dt.date.fromisoformat(d) for d in dates]
    if parsed != sorted(parsed):
        return False, "days are not in ascending date order"
    for a, b in zip(parsed, parsed[1:]):
        if (b - a).days != 1:
            return False, f"gap between {a.isoformat()} and {b.isoformat()} — every day must be present"
    return True, None


def compute(raw):
    days = raw["days"]
    ok, err = check_contiguous(days)
    if not ok:
        return None, err

    # "crm_deduped" (default): every report built from 18 Nov 2026 onward, where
    # the CRM cross-check (RUNBOOK step 1b) ran for every day. "meta_only": months
    # before the cross-check existed — Meta's own lead count is all there is, and
    # it must never be relabeled or presented as the deduped figure.
    lead_methodology = raw.get("lead_methodology", "crm_deduped")
    bookings_available = raw.get("bookings_available", True)
    # "created_any_booked_stage" (from Nov 2026): a booking is a CRM deal created that day that has
    # reached Appointment Booked OR any later stage (Reschedule, Show up, No show up, Payment done,
    # Won). Deals that moved on after the session still count, so past days are NOT a floor.
    # "stage_snapshot" (legacy): only deals still sitting in "Appointment Booked" — a lower bound.
    bookings_methodology = raw.get("bookings_methodology", "stage_snapshot")
    bookings_is_exact = bookings_methodology == "created_any_booked_stage"

    out_days = []
    cum = {"spend": 0.0, "impressions": 0, "link_clicks": 0,
           "meta_leads": 0, "leads": 0, "bookings": 0}
    last_index = len(days) - 1
    for i, d in enumerate(days):
        m = d["meta"]
        cum["spend"] += float(m["spend"])
        cum["impressions"] += int(m["impressions"])
        cum["link_clicks"] += int(m["link_clicks"])
        cum["meta_leads"] += int(m["leads"])
        cum["leads"] += int(d["crm_leads_deduped"])
        if bookings_available:
            cum["bookings"] += int(d["bookings"])

        is_today = bool(d.get("is_today")) or i == last_index
        out_days.append({
            "date": d["date"],
            "day": {
                "spend": round(float(m["spend"]), 2),
                "impressions": int(m["impressions"]),
                "link_clicks": int(m["link_clicks"]),
                "meta_leads": int(m["leads"]),
                "leads": int(d["crm_leads_deduped"]),
                "bookings": int(d["bookings"]) if bookings_available else None,
            },
            "cumulative": {
                "spend": round(cum["spend"], 2),
                "impressions": cum["impressions"],
                "link_clicks": cum["link_clicks"],
                "meta_leads": cum["meta_leads"],
                "leads": cum["leads"],
                "bookings": cum["bookings"] if bookings_available else None,
                "cost_per_lead": round(cum["spend"] / cum["leads"], 2) if cum["leads"] else None,
                "cost_per_booking": (round(cum["spend"] / cum["bookings"], 2)
                                     if bookings_available and cum["bookings"] else None),
            },
            "bookings_is_floor": bookings_available and not is_today and not bookings_is_exact,
        })

    notes = [
        "reach is intentionally not included: daily reach cannot be summed into a valid "
        "running total (it would double-count people reached on more than one day).",
    ]
    if lead_methodology == "crm_deduped":
        notes.insert(0,
            "leads = CRM-deduped final count (Meta-ad visitors, tests removed, one contact "
            "counted once). meta_leads is Meta's own figure, kept only for reference — it "
            "undercounts, same as every other report in this repo.")
    else:
        notes.insert(0,
            "This month predates the CRM cross-check (it started 18 Nov 2026). 'leads' here "
            "is Meta's own lead count, not CRM-deduped — it is known to undercount, same as "
            "Meta's figure does everywhere else in this repo. Treat it as a lower bound, not "
            "the final/reconciled number.")
    if bookings_available and bookings_is_exact:
        notes.append(
            "bookings = CRM deals created that day (tests removed) that have reached Appointment "
            "Booked or any later stage (Reschedule, Show up, No show up, Payment done, Won), so a "
            "booking that has since moved on is still counted on the day it was made.")
    elif bookings_available:
        notes.append(
            "bookings for every day except the most recent are a lower bound: they come from "
            "the CRM's current pipeline-stage snapshot, so a booking that has since moved to "
            "another stage no longer counts on the day it was made. See "
            "data/raw_month/README.md.")
    else:
        notes.append(
            "bookings are not available for this month — reliable booking-by-day data only "
            "exists from 18 Nov 2026 onward, when the daily live tracker started.")

    result = {
        "month": raw["month"],
        "account": raw["account"],
        "currency": raw.get("currency", "INR"),
        "lead_methodology": lead_methodology,
        "bookings_available": bookings_available,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "notes": notes,
        "days": out_days,
    }
    return result, None


def build(path):
    raw = json.load(open(path))
    result, err = compute(raw)
    if err:
        print(f"REFUSING TO PUBLISH: {err}")
        sys.exit(1)
    out_dir = ROOT / "reports" / "monthly"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{raw['month']}.json"
    out_path.write_text(json.dumps(result, indent=1))
    print(f"wrote {out_path}")
    last = result["days"][-1]
    bk = last['cumulative']['bookings']
    bk_str = "n/a" if bk is None else f"{num(bk)}" + (" (floor)" if last["bookings_is_floor"] else "")
    print(f"through {last['date']}: spend {inr(last['cumulative']['spend'])}, "
          f"leads {num(last['cumulative']['leads'])} (meta {num(last['cumulative']['meta_leads'])}), "
          f"bookings {bk_str}")


def summary(path):
    raw = json.load(open(path))
    result, err = compute(raw)
    if err:
        print(f"would refuse to publish: {err}")
        sys.exit(1)
    print(f"Month: {result['month']}  ({len(result['days'])} days, "
          f"lead_methodology={result['lead_methodology']}, bookings_available={result['bookings_available']})")
    for d in result["days"]:
        c = d["cumulative"]
        bk = "n/a" if c["bookings"] is None else f"{c['bookings']:>3}{'*' if d['bookings_is_floor'] else ''}"
        print(f"{d['date']}  day: spend {inr(d['day']['spend']):>10}  leads {d['day']['leads']:>3}"
              f"   |  to-date: spend {inr(c['spend']):>12}  leads {c['leads']:>4}"
              f"  bookings {bk}")
    print("* = lower bound (current pipeline-stage snapshot, see README)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == "build":
        build(path)
    elif cmd == "summary":
        summary(path)
    else:
        print(__doc__)
        sys.exit(1)
