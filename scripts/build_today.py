#!/usr/bin/env python3
"""Build the live daily snapshot for the MiTran Global reports home page.

Input : data/raw_today/<date>.json   (see data/raw_today/README.md for the format)
Output: reports/daily_live/<date>.json   one dated snapshot (history)
        reports/daily_live/latest.json   what index.html actually fetches

Usage:
  python3 scripts/build_today.py summary data/raw_today/2026-11-18.json   # print + sanity-check the numbers
  python3 scripts/build_today.py build   data/raw_today/2026-11-18.json  # write the two JSON files

All arithmetic (the final lead count, cost per lead, the dedup sanity check) happens here, in code —
never by eye — because the whole point of this script is to stop a hand-counted lead total from ever
being wrong again.
"""
import json, sys, pathlib, datetime as dt

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW, REP = ROOT / "data/raw_today", ROOT / "reports/daily_live"


def inr(v, dec=0):
    if v is None:
        return "–"
    neg, v = v < 0, abs(v)
    whole, frac = f"{v:.{dec}f}".split(".") if dec else (f"{v:.0f}", "")
    if len(whole) > 3:  # Indian grouping 12,34,567
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts + [tail])
    return ("-" if neg else "") + "₹" + whole + ("." + frac if frac else "")


def num(v, dec=0):
    return "–" if v is None else f"{v:,.{dec}f}"


def compute(raw):
    for k in ("date", "account", "meta", "crm"):
        if k not in raw:
            sys.exit(f"missing '{k}'")

    meta = {k: float(raw["meta"].get(k) or 0) for k in
            ("spend", "impressions", "reach", "link_clicks", "leads", "purchases")}
    crm_in = raw["crm"]
    form_all = int(crm_in.get("form_fills_all") or 0)
    form_meta = int(crm_in.get("form_fills_meta") or 0)
    leads_unique = int(crm_in.get("leads_meta_unique") or 0)
    bookings = int(crm_in.get("bookings_created_today") or 0)

    # Sanity check from RUNBOOK step 1b, applied to one day: every submission is either kept
    # (a unique Meta-ad visitor) or dropped (a test, a repeat, or not from a Meta ad). This is the
    # check that would have caught 106-vs-78: a raw count that skips it is not trustworthy.
    dropped = form_all - form_meta
    sanity_ok = dropped >= 0 and form_meta >= leads_unique >= 0

    final_lead_count = leads_unique  # CRM, deduped, is the true number; Meta's own `lead` field undercounts.
    cost_per_lead = meta["spend"] / final_lead_count if final_lead_count else None
    cost_per_booking = meta["spend"] / bookings if bookings else None

    meta_vs_crm_gap = meta["leads"] - final_lead_count

    flags = []
    stale = raw.get("ad_sync_stale_days")
    if stale and stale > 1:
        flags.append({"level": "warn",
                      "text": f"CRM's Meta ad-spend sync is {int(stale)} days old. Lead and booking "
                              "counts above are live CRM data either way; only the CRM's own "
                              "cost-per-lead view may lag until it's resynced."})
    if not sanity_ok:
        flags.append({"level": "bad",
                       "text": "Form-submission numbers for today don't add up (form_fills_all should "
                               "equal kept + dropped) — re-pull before trusting this snapshot."})
    for n in raw.get("notes", []):
        flags.append({"level": "warn", "text": n})

    return {
        "date": raw["date"],
        "generated_at": raw.get("pulled_at") or dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "account": raw["account"], "currency": raw.get("currency", "INR"),
        "meta": meta,
        "crm": {"source": crm_in.get("source", ""), "form_fills_all": form_all, "form_fills_meta": form_meta,
                "leads_meta_unique": leads_unique, "bookings_created_today": bookings},
        "final_lead_count": final_lead_count,
        "cost_per_lead": cost_per_lead,
        "cost_per_booking": cost_per_booking,
        "reconciliation": {
            "meta_leads": meta["leads"], "crm_leads_deduped": final_lead_count,
            "match": meta_vs_crm_gap == 0, "gap": meta_vs_crm_gap,
            "note": "The CRM count (deduped: Meta-ad visitors only, tests removed, one contact "
                    "counted once) is used as the final lead count. Meta's own count is shown "
                    "alongside it for reference — Meta typically undercounts.",
        },
        "sanity_ok": sanity_ok,
        "flags": flags,
    }


def build(path):
    raw = json.loads(pathlib.Path(path).read_text())
    r = compute(raw)
    if not r["sanity_ok"]:
        sys.exit(f"{path}: sanity check failed — form_fills_all/meta/leads_meta_unique don't add up; "
                  "not writing reports/daily_live/. Re-pull the CRM numbers.")
    REP.mkdir(parents=True, exist_ok=True)
    text = json.dumps(r, indent=1, ensure_ascii=False)
    (REP / f"{r['date']}.json").write_text(text)
    (REP / "latest.json").write_text(text)
    print(f"built {r['date']}: spend {inr(r['meta']['spend'])}, final leads {r['final_lead_count']} "
          f"(Meta counted {num(r['meta']['leads'])}), bookings {r['crm']['bookings_created_today']}, "
          f"cost/lead {inr(r['cost_per_lead'], 2)}")
    if r["flags"]:
        for f in r["flags"]:
            print(f"  [{f['level']}] {f['text']}")


def summary(path):
    r = compute(json.loads(pathlib.Path(path).read_text()))
    m, c = r["meta"], r["crm"]
    print(f"Day {r['date']}  (generated {r['generated_at']})")
    print(f"  spend            {inr(m['spend'], 2)}")
    print(f"  impressions      {num(m['impressions'])}   reach {num(m['reach'])}   link clicks {num(m['link_clicks'])}")
    print(f"  Meta's own leads {num(m['leads'])}")
    print(f"  CRM form fills   {c['form_fills_all']} total -> {c['form_fills_meta']} from Meta ads, "
          f"tests removed -> {c['leads_meta_unique']} unique people")
    print(f"  FINAL lead count {r['final_lead_count']}   (Meta vs CRM gap: {r['reconciliation']['gap']:+.0f})")
    print(f"  bookings today   {c['bookings_created_today']}")
    print(f"  cost per lead    {inr(r['cost_per_lead'], 2)}   cost per booking {inr(r['cost_per_booking'], 2)}")
    print(f"  sanity check     {'OK' if r['sanity_ok'] else 'FAILED — do not publish'}")
    for f in r["flags"]:
        print(f"  [{f['level']}] {f['text']}")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("build", "summary"):
        sys.exit(__doc__)
    (build if sys.argv[1] == "build" else summary)(sys.argv[2])
