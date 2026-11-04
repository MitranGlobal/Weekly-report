#!/usr/bin/env python3
"""Build a weekly Meta Ads report for the MiTran Global reports site.

Input : data/raw/<report_date>.json   (see data/raw/README.md for the format)
Output: reports/<report_date>.json      data the weekly.html page renders
        reports/files/MiTran-Meta-Weekly-<report_date>.pdf   the downloadable report
        reports/index.json              list of all reports (newest first)

Usage:
  python3 scripts/build_week.py summary data/raw/2026-11-09.json   # print the numbers (to write tips from)
  python3 scripts/build_week.py build   data/raw/2026-11-09.json   # build one report
  python3 scripts/build_week.py build   --all                      # rebuild every report
"""
import json, sys, pathlib, datetime as dt, io

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW, REP, FILES = ROOT / "data/raw", ROOT / "reports", ROOT / "reports/files"
FONTS = ROOT / "scripts/fonts"
METRICS = ["spend", "impressions", "reach", "link_clicks", "results", "leads", "purchases"]


# ---------- numbers ----------
def derive(t):
    t = {k: float(t.get(k) or 0) for k in METRICS}
    s, im, r = t["spend"], t["impressions"], t["reach"]
    t["cost_per_result"] = s / t["results"] if t["results"] else None
    t["cost_per_lead"] = s / t["leads"] if t["leads"] else None
    t["link_ctr"] = t["link_clicks"] / im * 100 if im else None
    t["cpm"] = s / im * 1000 if im else None
    t["frequency"] = im / r if r else None
    return t


def pct(cur, prev):
    if cur is None or prev is None or prev == 0:
        return None
    return (cur - prev) / prev * 100


def compute(raw):
    cur, prev = derive(raw["totals"]["cur"]), derive(raw["totals"]["prev"])
    keys = METRICS + ["cost_per_result", "cost_per_lead", "link_ctr", "cpm", "frequency"]
    change = {k: pct(cur[k], prev[k]) for k in keys}
    camps = []
    for c in raw.get("campaigns", []):
        cc, cp = derive(c["cur"]), derive(c["prev"])
        if cc["spend"] == 0 and cp["spend"] == 0:
            continue
        camps.append({**{k: c.get(k) for k in ("id", "name", "objective", "status", "daily_budget", "result_type")},
                      "cur": cc, "prev": cp, "spend_change": pct(cc["spend"], cp["spend"])})
    camps.sort(key=lambda c: (-c["cur"]["spend"], -c["prev"]["spend"]))
    no_result = sum(c["cur"]["spend"] for c in camps if c["cur"]["spend"] > 0 and c["cur"]["results"] == 0)
    return {
        "report_date": raw["report_date"], "week_start": raw["week_start"], "week_end": raw["week_end"],
        "prev_week_start": (d(raw["week_start"]) - dt.timedelta(days=7)).isoformat(),
        "prev_week_end": (d(raw["week_start"]) - dt.timedelta(days=1)).isoformat(),
        "account": raw["account"], "currency": raw.get("currency", "INR"),
        "result_label": raw.get("result_label", "results"),
        "pulled_at": raw.get("pulled_at"), "backfilled": raw.get("backfilled", False),
        "totals": {"cur": cur, "prev": prev, "change": change},
        "spend_without_results": no_result,
        "active_days": sum(1 for x in raw.get("daily", []) if float(x.get("spend") or 0) > 0),
        "campaigns": camps, "daily": raw.get("daily", []),
        "headline": raw.get("headline", ""), "tips": raw.get("tips", []), "actions": raw.get("actions", []),
        "pdf": f"reports/files/MiTran-Meta-Weekly-{raw['report_date']}.pdf",
    }


def d(s):
    return dt.date.fromisoformat(s)


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


def fdate(s, year=False):
    x = d(s)
    return f"{x.day} {x:%b}" + (f" {x.year}" if year else "")


def chg(v, inverse=False):
    if v is None:
        return "–"
    return f"{'+' if v > 0 else ''}{v:.0f}%"


# ---------- PDF ----------
def build_pdf(r, path):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether)
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    pdfmetrics.registerFont(TTFont("DV", str(FONTS / "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont("DVB", str(FONTS / "DejaVuSans-Bold.ttf")))
    INK, MUTED, LINE = colors.HexColor("#252423"), colors.HexColor("#605E5C"), colors.HexColor("#E1DFDD")
    GREEN, RED, GOLD, BLUE = (colors.HexColor(x) for x in ("#107C10", "#C4314B", "#B88A00", "#118DFF"))
    st = lambda **k: ParagraphStyle("x", fontName=k.pop("f", "DV"), fontSize=k.pop("s", 9.5),
                                    leading=k.pop("l", 13), textColor=k.pop("c", INK), **k)
    H1, SUB, H2 = st(f="DVB", s=17, l=21), st(s=9.5, c=MUTED), st(f="DVB", s=11.5, l=15, spaceBefore=8, spaceAfter=4)
    BODY, SMALL = st(), st(s=8, l=10.5, c=MUTED)

    t, cur, prev, ch = r["totals"], r["totals"]["cur"], r["totals"]["prev"], r["totals"]["change"]
    rl = r["result_label"]
    story = [
        Paragraph("MiTran Global · Meta Ads weekly report", SMALL),
        Paragraph(f"Week of {fdate(r['week_start'])} – {fdate(r['week_end'], True)}", H1),
        Paragraph(f"{r['account']['name']} · report date {fdate(r['report_date'], True)} · "
                  f"compared with {fdate(r['prev_week_start'])} – {fdate(r['prev_week_end'])} · amounts in INR", SUB),
        Spacer(1, 8),
    ]
    if r["headline"]:
        story += [Table([[Paragraph(r["headline"], st(f="DVB", s=10.5, l=14))]], colWidths=[180 * mm],
                        style=[("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F2F1")),
                               ("LINEBEFORE", (0, 0), (0, -1), 3, BLUE),
                               ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 6),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]), Spacer(1, 6)]

    rows = [("Amount spent", inr(cur["spend"]), inr(prev["spend"]), chg(ch["spend"])),
            (rl.capitalize(), num(cur["results"]), num(prev["results"]), chg(ch["results"])),
            (f"Cost per {rl[:-1] if rl.endswith('s') else rl}", inr(cur["cost_per_result"]), inr(prev["cost_per_result"]), chg(ch["cost_per_result"])),
            ("Leads", num(cur["leads"]), num(prev["leads"]), chg(ch["leads"])),
            ("Reach", num(cur["reach"]), num(prev["reach"]), chg(ch["reach"])),
            ("Impressions", num(cur["impressions"]), num(prev["impressions"]), chg(ch["impressions"])),
            ("Link clicks", num(cur["link_clicks"]), num(prev["link_clicks"]), chg(ch["link_clicks"])),
            ("Link click rate", num(cur["link_ctr"], 2) + ("%" if cur["link_ctr"] is not None else ""),
             num(prev["link_ctr"], 2) + ("%" if prev["link_ctr"] is not None else ""), chg(ch["link_ctr"])),
            ("Frequency", num(cur["frequency"], 2), num(prev["frequency"], 2), chg(ch["frequency"])),
            ("Cost per 1,000 impressions", inr(cur["cpm"]), inr(prev["cpm"]), chg(ch["cpm"]))]
    data = [["Metric", "This week", "Last week", "Change"]] + [list(x) for x in rows]
    kt = Table(data, colWidths=[62 * mm, 40 * mm, 40 * mm, 38 * mm])
    kt.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "DV", 9), ("FONT", (0, 0), (-1, 0), "DVB", 9),
                            ("LINEBELOW", (0, 0), (-1, 0), 1, INK), ("LINEBELOW", (0, 1), (-1, -1), .4, LINE),
                            ("ALIGN", (1, 0), (-1, -1), "RIGHT"), ("TOPPADDING", (0, 0), (-1, -1), 3.5),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5)]))
    story += [Paragraph("Key numbers", H2), kt]

    if r["tips"]:
        story.append(Paragraph("What the numbers say", H2))
        col = {"good": GREEN, "bad": RED, "warn": GOLD}
        for tip in r["tips"]:
            story += [Table([[Paragraph(f"<font name='DVB'>{tip['title']}.</font> {tip['text']}", BODY)]],
                            colWidths=[180 * mm],
                            style=[("LINEBEFORE", (0, 0), (0, -1), 3, col.get(tip.get("type"), BLUE)),
                                   ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 3),
                                   ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]), Spacer(1, 4)]
    if r["actions"]:
        story.append(Paragraph("This week's actions", H2))
        for i, a in enumerate(r["actions"], 1):
            story.append(Paragraph(f"<font name='DVB'>{i}.</font> {a}", st(leftIndent=10, spaceAfter=2)))

    if any(float(x.get("spend") or 0) for x in r["daily"]):
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib import font_manager
        font_manager.fontManager.addfont(str(FONTS / "DejaVuSans.ttf"))
        plt.rcParams["font.family"] = "DejaVu Sans"
        labels = [f"{d(x['date']):%a}\n{d(x['date']).day}" for x in r["daily"]]
        vals = [float(x.get("spend") or 0) for x in r["daily"]]
        fig, ax = plt.subplots(figsize=(7.1, 2.1), dpi=200)
        ax.bar(labels, vals, color="#118DFF", width=.6)
        for i, v in enumerate(vals):
            if v:
                ax.text(i, v, inr(v), ha="center", va="bottom", fontsize=7, color="#252423")
        ax.spines[["top", "right", "left"]].set_visible(False)
        ax.set_yticks([]); ax.tick_params(axis="x", labelsize=7.5, length=0)
        ax.set_ylim(0, max(vals) * 1.22)
        fig.tight_layout()
        buf = io.BytesIO(); fig.savefig(buf, format="png"); plt.close(fig); buf.seek(0)
        story += [KeepTogether([Paragraph("Daily spend", H2), Image(buf, width=180 * mm, height=53 * mm)])]

    if r["campaigns"]:
        cs = st(s=8, l=10)
        data = [["Campaign", "Status now", "Spend", rl.capitalize(), "Cost each", "Link CTR", "Freq."]]
        for c in r["campaigns"]:
            x = c["cur"]
            data.append([Paragraph(c["name"], cs), (c.get("status") or "").title(), inr(x["spend"]), num(x["results"]),
                         inr(x["cost_per_result"]), (num(x["link_ctr"], 2) + "%") if x["link_ctr"] is not None else "–",
                         num(x["frequency"], 2)])
        ct = Table(data, colWidths=[62 * mm, 18 * mm, 22 * mm, 18 * mm, 22 * mm, 20 * mm, 18 * mm], repeatRows=1)
        ct.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "DV", 8), ("FONT", (0, 0), (-1, 0), "DVB", 8),
                                ("LINEBELOW", (0, 0), (-1, 0), 1, INK), ("LINEBELOW", (0, 1), (-1, -1), .4, LINE),
                                ("ALIGN", (2, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
        story += [Paragraph("Campaigns this week", H2), ct,
                  Paragraph("Campaigns listed if they spent this week or last week. Cost each = spend ÷ "
                            f"{rl}. Link CTR = link clicks ÷ impressions.", SMALL)]

    note = (f"Source: Meta Ads, account {r['account']['id']}, pulled {fdate(r['pulled_at'], True)}. "
            "Meta may still adjust recent numbers by a few percent. "
            f"{'Backfilled report, written after the week ended. ' if r['backfilled'] else ''}"
            "Reach is de-duplicated at account level.")
    story += [Spacer(1, 10), Paragraph(note, SMALL)]

    def deco(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#252423")); canvas.rect(0, A4[1] - 6 * mm, A4[0], 6 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor("#F2C811")); canvas.rect(0, A4[1] - 6 * mm, 30 * mm, 6 * mm, fill=1, stroke=0)
        canvas.setFont("DV", 7.5); canvas.setFillColor(MUTED)
        canvas.drawString(15 * mm, 9 * mm, "MiTran Global · public reports")
        canvas.drawRightString(A4[0] - 15 * mm, 9 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=16 * mm,
                            title=f"Meta Ads weekly report {r['report_date']}", author="MiTran Global")
    doc.build(story, onFirstPage=deco, onLaterPages=deco)


# ---------- index ----------
def write_index():
    items = []
    for f in sorted(REP.glob("20??-??-??.json"), reverse=True):
        r = json.loads(f.read_text())
        c = r["totals"]["cur"]
        items.append({"report_date": r["report_date"], "week_start": r["week_start"], "week_end": r["week_end"],
                      "spend": c["spend"], "results": c["results"], "leads": c["leads"],
                      "cost_per_result": c["cost_per_result"], "headline": r["headline"],
                      "result_label": r["result_label"], "pdf": r["pdf"]})
    (REP / "index.json").write_text(json.dumps({"updated": dt.date.today().isoformat(), "reports": items},
                                               indent=1, ensure_ascii=False))
    return len(items)


def build(path):
    raw = json.loads(pathlib.Path(path).read_text())
    for k in ("report_date", "week_start", "week_end", "account", "totals"):
        if k not in raw:
            sys.exit(f"{path}: missing '{k}'")
    if d(raw["report_date"]).weekday() != 0:
        sys.exit(f"{path}: report_date must be a Monday")
    r = compute(raw)
    FILES.mkdir(parents=True, exist_ok=True)
    (REP / f"{r['report_date']}.json").write_text(json.dumps(r, indent=1, ensure_ascii=False))
    build_pdf(r, ROOT / r["pdf"])
    print(f"built {r['report_date']}: spend {inr(r['totals']['cur']['spend'])}, "
          f"{num(r['totals']['cur']['results'])} {r['result_label']}, pdf {r['pdf']}")


def summary(path):
    r = compute(json.loads(pathlib.Path(path).read_text()))
    c, p, ch = r["totals"]["cur"], r["totals"]["prev"], r["totals"]["change"]
    print(f"Week {r['week_start']}..{r['week_end']} vs {r['prev_week_start']}..{r['prev_week_end']}")
    for k in ["spend", "results", "cost_per_result", "leads", "cost_per_lead", "reach", "impressions",
              "link_clicks", "link_ctr", "frequency", "cpm"]:
        print(f"  {k:16} {num(c[k], 2):>12} {num(p[k], 2):>12}  {chg(ch[k])}")
    print(f"  spend with no {r['result_label']}: {inr(r['spend_without_results'])}; active days {r['active_days']}/7")
    for x in r["campaigns"]:
        a, b = x["cur"], x["prev"]
        print(f"  - {x['name']} [{x['status']}]: spend {inr(a['spend'])} (prev {inr(b['spend'])}), "
              f"{num(a['results'])} {r['result_label']} at {inr(a['cost_per_result'])} (prev {num(b['results'])} at "
              f"{inr(b['cost_per_result'])}), link CTR {num(a['link_ctr'], 2)}%, freq {num(a['frequency'], 2)}")


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in ("build", "summary"):
        sys.exit(__doc__)
    if sys.argv[1] == "summary":
        summary(sys.argv[2])
    elif sys.argv[2] == "--all":
        for f in sorted(RAW.glob("20??-??-??.json")):
            build(f)
        print(f"index: {write_index()} reports")
    else:
        build(sys.argv[2])
        print(f"index: {write_index()} reports")
