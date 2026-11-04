# Monday Meta Ads report: runbook

This repo is the MiTran Global public reports site, deployed by Netlify from the `main` branch
(https://neon-bienenstitch-9b18e9.netlify.app). Every Monday a scheduled task adds one weekly report.

- `index.html`: landing page. `meta.html`: full Meta Ads dashboard (snapshot, 2 Nov 2026). `weekly.html`: weekly reports, by month.
- `data/raw/<YYYY-MM-DD>.json`: the input for one report (written by the Monday task).
- `data/history/` and `scripts/build_history.py`: one-off history reports (Jan 2024 – 28 Sep 2026), built from whichever
  ad account ran ads each week. The Monday task never edits or rebuilds these, and never runs `build --all`.
- `scripts/build_week.py`: turns an input into `reports/<date>.json`, `reports/files/MiTran-Meta-Weekly-<date>.pdf`, and refreshes `reports/index.json`.

## The Monday steps

`<date>` is the Monday the report is for. The report covers the 7 days Monday–Sunday before it, and compares them with the 7 days before that.

1. **Pull data** with the Meta Ads connector, ad account `392337929851918` ("mitranglobal ad account", the main account). Read only; never change campaigns.
   - Account totals, two weeks: `level=ad_account`, `time_range` = previous-week Monday → last Sunday (14 days), `time_increment="7"`,
     fields `amount_spent, impressions, reach, link_click, lead, omni_purchase`.
   - Campaigns, two weeks: `level=campaign`, same range and increment, filter `amount_spent GREATER_THAN 0`, limit 100,
     fields `id, name, objective, effective_status, daily_budget, amount_spent, impressions, reach, link_click, results, cost_per_result, lead, omni_purchase`.
   - Daily totals for the report week: `level=ad_account`, report-week Monday → Sunday, `time_increment="1"`, fields `amount_spent, impressions, link_click, lead`.
   - Also note any campaign that is ACTIVE now (`effective_status IN ACTIVE`), for the tips.
2. **Write `data/raw/<date>.json`** in the format in `data/raw/README.md`. `results` is the campaign's own result
   (website appointments scheduled = bookings). Account-level `results` = sum of campaign results for that week.
   Use account-level reach (it is de-duplicated); do not add campaign reach together.
3. **Check the numbers**: run `python3 scripts/build_week.py summary data/raw/<date>.json`. The account spend for each week must
   equal the sum of its campaigns (within ₹1) and the sum of the daily rows. If not, re-pull before going on.
4. **Write the tips** into the same file: `headline` (one sentence with the main number), 2–5 `tips`
   (`type` good / bad / warn, a short `title`, one or two sentences of `text` with real numbers), and exactly 3 `actions`.
   Things to look for: change in cost per booking; campaigns that spent without bookings; frequency above 2.5;
   link click rate falling; days with no spend; a new campaign in its first week (judge it gently); comparison with the
   best recent setup (08Sep26 booked at about ₹325). Plain English, no jargon. Every number in a tip must come from the summary.
5. **Build**: `python3 scripts/build_week.py build data/raw/<date>.json` (needs `reportlab` and `matplotlib`;
   `pip install --break-system-packages reportlab matplotlib` if missing).
6. **Publish**: commit `data/raw/<date>.json`, `reports/` and push to `main`. Netlify redeploys in about a minute.
   Check https://neon-bienenstitch-9b18e9.netlify.app/weekly.html#<date> loads if the network allows.
7. **Email the team** (only after the push succeeded), once, with Zapier → Email by Zapier → "Send Outbound Email"
   (`email_by_zapier_send_outbound_email`): to `Tech@mitranglobal.com, vidyashankar@mitranglobal.com` (these two only),
   from name "MiTran Global Reports", subject "Meta Ads weekly report: <week start> – <week end>", and a simple HTML body with
   the headline, a key-numbers table (this week / last week / change), the tips, the 3 actions, the report link and the PDF link
   `https://neon-bienenstitch-9b18e9.netlify.app/reports/files/MiTran-Meta-Weekly-<date>.pdf`.
8. **Tell the owner**: finish with a short summary: the week, spend, bookings, cost per booking, the headline, the
   3 actions, and the link `https://neon-bienenstitch-9b18e9.netlify.app/weekly.html#<date>`.

If the connector fails or the account is not reachable, do not publish an empty report. Say what failed in the summary.
If there was no spend, still publish the report (it records that the account was idle) with tips about restarting.

The site is public: the weekly reports and PDFs can be read by anyone with the link.
