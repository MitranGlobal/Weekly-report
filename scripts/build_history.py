#!/usr/bin/env python3
"""Build history reports (weeks before the regular Monday reports) from data/history/*.tsv.

For each Monday–Sunday week with spend, the report uses the main ad account if it ran ads that week,
otherwise the account that did (the one with the most spend). Other accounts that also spent are noted.
Existing reports are never overwritten.

Usage: python3 scripts/build_history.py            # write data/raw/<date>.json for missing weeks, then build them
"""
import json, pathlib, datetime as dt, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_week as bw

ROOT = bw.ROOT
HIST = ROOT / "data/history"
MAIN = "392337929851918"
ACCOUNTS = {
    "392337929851918": "mitranglobal ad account",
    "730954635012236": "Older ad account",
    "951362586415730": "mitranadaccount",
}
LAST_WEEK_START = dt.date(2026, 9, 21)          # history ends with the report dated Mon 28 Sep 2026
PULLED = "2026-11-04"
# Daily totals we hold for the main account's last history week (21–27 Sep 2026).
DAILY = {"2026-09-21": (2177.09, 3056, 64, 11), "2026-09-22": (1855.46, 3015, 45, 4),
         "2026-09-23": (2360.43, 3892, 74, 5), "2026-09-24": (1954.52, 2136, 48, 3),
         "2026-09-25": (1301.74, 2098, 36, 6), "2026-09-26": (1681.1, 2747, 53, 8),
         "2026-09-27": (1915.46, 2604, 38, 4)}
KEYS = ["spend", "impressions", "reach", "link_clicks", "leads", "purchases"]


def zero():
    return {k: 0 for k in bw.METRICS}


def load_weeks(acc):
    out = {}
    for line in (HIST / f"{acc}.tsv").read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        p = line.split("\t")
        out[p[0]] = dict(zip(KEYS, [float(x) for x in p[1:7]]))
    return out


def load_campaigns():
    out = {}
    for line in (HIST / f"{MAIN}_campaigns.tsv").read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        w, cid, name, rtype, *nums = line.split("\t")
        n = [float(x) for x in nums]
        out.setdefault(w, []).append({"id": cid, "name": name, "rtype": rtype,
                                      "m": dict(spend=n[0], impressions=n[1], reach=n[2], link_clicks=n[3],
                                                results=n[4], leads=n[5], purchases=n[6])})
    return out


def money(v):
    return bw.inrc(v)


def auto_notes(r, label, also, other_type):
    """Plain-English notes from the numbers. No invented facts: everything comes from r."""
    c, p, ch = r["totals"]["cur"], r["totals"]["prev"], r["totals"]["change"]
    one = label[:-1] if label.endswith("s") else label
    tips = []
    if p["spend"] < 100:
        head = f"Ads ran after a break: {money(c['spend'])} spent"
    else:
        head = f"{money(c['spend'])} spent ({bw.chg(ch['spend'])} on the week before)"
    if c["results"]:
        head += f", {bw.num(c['results'])} {label} at {money(c['cost_per_result'])} each."
    else:
        head += f", no {label}."
    if c["leads"] and label not in ("leads",):
        head = head[:-1] + f"; {bw.num(c['leads'])} leads."

    if c["cost_per_result"] and p["cost_per_result"] and ch["cost_per_result"] is not None:
        v = ch["cost_per_result"]
        if v <= -20:
            tips.append({"type": "good", "title": f"Cheaper {label}",
                         "text": f"Cost per {one} fell to {money(c['cost_per_result'])} from {money(p['cost_per_result'])}."})
        elif v >= 20:
            tips.append({"type": "bad", "title": f"Costlier {label}",
                         "text": f"Cost per {one} rose to {money(c['cost_per_result'])} from {money(p['cost_per_result'])}."})
    if label == "purchases" and c["results"] >= 50 and c["cost_per_result"] and c["cost_per_result"] < 50:
        tips.append({"type": "warn", "title": "Unusually cheap purchases",
                     "text": f"{bw.num(c['results'])} purchases at {money(c['cost_per_result'])} each is far below other weeks. "
                             "Check them against payment records before relying on this week."})
    camps = [x for x in r["campaigns"] if x["cur"]["spend"] > 0 and not x["id"].startswith("other")]
    if camps:
        best = [x for x in camps if x["cur"]["results"] >= 2 and x["cur"]["cost_per_result"]]
        if best:
            b = min(best, key=lambda x: x["cur"]["cost_per_result"])
            tips.append({"type": "good", "title": "Best campaign this week",
                         "text": f"{b['name']}: {bw.num(b['cur']['results'])} {label} at {money(b['cur']['cost_per_result'])} each."})
        waste = [x for x in camps if x["cur"]["results"] == 0 and x["cur"]["spend"] >= 500]
        if waste:
            w = max(waste, key=lambda x: x["cur"]["spend"])
            tips.append({"type": "bad", "title": f"Spend with no {label}",
                         "text": f"{w['name']} spent {money(w['cur']['spend'])} without a {one}."})
    if c["frequency"] and c["frequency"] > 2.5:
        tips.append({"type": "warn", "title": "Same people seeing the ads often",
                     "text": f"Frequency was {bw.num(c['frequency'], 2)}: each person saw the ads that many times on average."})
    if c["link_ctr"] is not None and c["impressions"] >= 1000:
        if c["link_ctr"] < 0.8:
            tips.append({"type": "warn", "title": "Few clicks",
                         "text": f"Link click rate was {bw.num(c['link_ctr'], 2)}%, below 0.8%."})
        elif c["link_ctr"] >= 3:
            tips.append({"type": "good", "title": "Strong click rate",
                         "text": f"Link click rate was {bw.num(c['link_ctr'], 2)}%."})
    if other_type:
        tips.append({"type": "warn", "title": "Mixed campaign goals",
                     "text": f"Some campaigns aimed at {other_type[0]} ({bw.num(other_type[1])} this week); "
                             f"the headline counts {label} only."})
    for a in also:
        tips.append({"type": "warn", "title": "Another account also ran ads",
                     "text": f"{a['name']} ({a['id']}) spent {money(a['spend'])} this week. It is not included in these numbers."})
    return head, tips[:5]


def main():
    weeks = {a: load_weeks(a) for a in ACCOUNTS}
    camps = load_campaigns()
    all_w = sorted({w for a in weeks for w in weeks[a]})
    made, skipped = 0, 0
    for w in all_w:
        ws = dt.date.fromisoformat(w)
        if ws > LAST_WEEK_START:
            continue
        spenders = {a: weeks[a][w]["spend"] for a in ACCOUNTS if w in weeks[a] and weeks[a][w]["spend"] >= 1}
        if not spenders:
            continue
        acc = MAIN if MAIN in spenders else max(spenders, key=spenders.get)
        rd = (ws + dt.timedelta(days=7)).isoformat()
        if (ROOT / "data/raw" / f"{rd}.json").exists() or (ROOT / "reports" / f"{rd}.json").exists():
            skipped += 1
            continue
        pw = (ws - dt.timedelta(days=7)).isoformat()
        also = [{"id": a, "name": ACCOUNTS[a], "spend": s} for a, s in spenders.items() if a != acc]
        cur_t = {**zero(), **{k: weeks[acc].get(w, {}).get(k, 0) for k in KEYS}}
        prev_t = {**zero(), **{k: weeks[acc].get(pw, {}).get(k, 0) for k in KEYS}}

        campaigns, other_type = [], None
        if acc == MAIN:
            cw, cp = camps.get(w, []), camps.get(pw, [])
            by_type = {}
            for x in cw:
                by_type[x["rtype"]] = by_type.get(x["rtype"], 0) + x["m"]["spend"]
            label = max(by_type, key=by_type.get) if by_type else "bookings"
            rest = [t for t in by_type if t != label]
            if rest:
                other_type = (rest[0], sum(x["m"]["results"] for x in cw if x["rtype"] == rest[0]))
            cur_t["results"] = sum(x["m"]["results"] for x in cw if x["rtype"] == label)
            prev_t["results"] = sum(x["m"]["results"] for x in cp if x["rtype"] == label)
            ids = {}
            for x in cw + cp:
                ids.setdefault(x["id"], x)
            for cid, x in ids.items():
                cm = next((y["m"] for y in cw if y["id"] == cid), zero())
                pm = next((y["m"] for y in cp if y["id"] == cid), zero())
                if x["rtype"] != label:  # results of another goal don't count as this label
                    cm, pm = {**cm, "results": 0}, {**pm, "results": 0}
                campaigns.append({"id": cid, "name": x["name"] + ("" if x["rtype"] == label else f" ({x['rtype']})"),
                                  "objective": "", "status": "", "daily_budget": None,
                                  "result_type": x["rtype"], "cur": cm, "prev": pm})
            gap = cur_t["spend"] - sum(x["m"]["spend"] for x in cw)
            if gap >= 1:
                campaigns.append({"id": "other", "name": "Other campaigns (no longer listed by Meta)", "objective": "",
                                  "status": "", "daily_budget": None, "result_type": label,
                                  "cur": {**zero(), "spend": round(gap, 2)}, "prev": zero()})
        else:
            label = "purchases" if cur_t["purchases"] > 0 else ("leads" if cur_t["leads"] > 0 else "link clicks")
            key = {"purchases": "purchases", "leads": "leads", "link clicks": "link_clicks"}[label]
            cur_t["results"], prev_t["results"] = cur_t[key], prev_t[key]

        daily = []
        if w == "2026-09-21":
            for i in range(7):
                d = (ws + dt.timedelta(days=i)).isoformat()
                s, im, lc, ld = DAILY[d]
                daily.append({"date": d, "spend": s, "impressions": im, "link_clicks": lc, "leads": ld})

        raw = {"report_date": rd, "week_start": w, "week_end": (ws + dt.timedelta(days=6)).isoformat(),
               "account": {"id": acc, "name": ACCOUNTS[acc]}, "currency": "INR", "result_label": label,
               "pulled_at": PULLED, "backfilled": True, "history": True, "also_spent": also,
               "totals": {"cur": cur_t, "prev": prev_t}, "campaigns": campaigns, "daily": daily,
               "headline": "", "tips": [], "actions": []}
        r = bw.compute(raw)
        raw["headline"], raw["tips"] = auto_notes(r, label, also, other_type)
        (ROOT / "data/raw" / f"{rd}.json").write_text(json.dumps(raw, indent=1, ensure_ascii=False))
        bw.build(ROOT / "data/raw" / f"{rd}.json")
        made += 1
    print(f"history: built {made}, skipped {skipped} existing; index: {bw.write_index()} reports")


if __name__ == "__main__":
    main()
