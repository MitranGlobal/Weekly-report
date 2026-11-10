# Monday Meta Ads report: runbook

This repo is the MiTran Global public reports site, deployed by Netlify from the `main` branch
(now hosted on GitHub Pages https://mitranglobal.github.io/Weekly-report/ and Vercel https://weekly-report-henna.vercel.app/; Netlify is retired). Every Monday a scheduled task adds one weekly report.

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
6. **Publish**: commit `data/raw/<date>.json`, `reports/` and push to `main`, committing as the GitHub account
   (`git -c user.name="MitranGlobal" -c user.email="300343567+MitranGlobal@users.noreply.github.com" commit ...`) so
   Netlify accepts the push from the private repo. Netlify redeploys in about a minute.
   Check https://weekly-report-henna.vercel.app/weekly.html#<date> loads if the network allows.
7. **Email the team** (only after the push succeeded), once, with Zapier → Email by Zapier → "Send Outbound Email"
   (`email_by_zapier_send_outbound_email`): to `Tech@mitranglobal.com, vidyashankar@mitranglobal.com` (these two only),
   from name "MiTran Global Reports", subject "Meta Ads weekly report: <week start> – <week end>", and a simple HTML body with
   the headline, a key-numbers table (this week / last week / change), the tips, the 3 actions, the report link and the PDF link
   `https://weekly-report-henna.vercel.app/reports/files/MiTran-Meta-Weekly-<date>.pdf` (also offer the GitHub Pages copy `https://mitranglobal.github.io/Weekly-report/reports/files/MiTran-Meta-Weekly-<date>.pdf`); the report links are `https://weekly-report-henna.vercel.app/weekly.html#<date>` and `https://mitranglobal.github.io/Weekly-report/weekly.html#<date>`.
   After sending, append one line to `data/email_log.tsv` (report_date, time sent IST, recipients, subject, `sent` or
   `failed: <reason>`), commit it as the GitHub account and push.
8. **Tell the owner**: finish with a short summary: the week, spend, bookings, cost per booking, the headline, the
   3 actions, and the links `https://weekly-report-henna.vercel.app/weekly.html#<date>` and `https://mitranglobal.github.io/Weekly-report/weekly.html#<date>`.

If the connector fails or the account is not reachable, do not publish an empty report. Say what failed in the summary.
If there was no spend, still publish the report (it records that the account was idle) with tips about restarting.

The repo is private. The site publishes only the pages and `reports/` (see netlify.toml); `data/` and `scripts/` are not served.

## MiTran chat assistant

A chat button on every page answers questions about this data. It is `mitran-chat.js`, loaded by one
`<script src="/mitran-chat.js" defer></script>` line before `</body>` in `index.html`, `meta.html` and `weekly.html`.
The server part is `netlify/functions/mitran-chat.mjs` and `netlify/lib/mitran/`. It reads the published `/meta` page and
`reports/` at run time, so a new Monday report reaches it with no extra step. The Monday task must not remove the script line,
`mitran-chat.js`, `netlify/` or `package.json`. It needs the `ANTHROPIC_API_KEY` environment variable in Netlify (Functions scope).
If `meta.html` is ever regenerated, keep the script line and the `const D={...}` data block, which the assistant reads.
`reports/daily/` holds daily spend per ad account from Meta (Jan 2024 to 5 Nov 2026, all four accounts with spend). It is a one-time
snapshot that makes the assistant's monthly and date-range totals exact. The Monday task does not update it and must not delete it;
the main account's newer days come from each report's own daily rows. Questions per day are capped at 200 (env `MITRAN_DAILY_LIMIT`).

## Monday check (11:13 AM IST)

A second scheduled task, "Monday report check", runs after the report. It confirms that the Monday task ran today, that
`data/raw/<date>.json`, `reports/<date>.json` and the PDF exist and add up, that Netlify is serving the latest commit, and
that `data/email_log.tsv` has a `sent` row for today. It emails the owner the result. It never emails the team and
never edits reports; if the Monday task did not run at all, it starts it once.
