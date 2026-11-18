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
1b. **Cross-check leads and bookings in the CRM** (connector `clarity_claude`, read only). Meta under-counts leads, so the
   CRM count is the true lead number and goes in the report next to Meta's. Do it the same way every week:
   - The opt-in form is **"Condtioning Lead 2.0"** (form id `b1107448-dbc0-4084-a096-8ad05a76f6b6`, the form on learn.mitranglobal.com).
     Its leads appear in Lead Management at stage "New Lead Capture". (The form named "Lead Capture Form" is not the live one.)
   - Pull `query_form_submissions` with that `form_id`, **one call per India day** (Mon–Sun): `created_after` = previous day
     `T18:30:00Z`, `created_before` = that day `T18:30:00Z`, `limit` 200. One call per day keeps the list short enough to read in full.
   - Keep only Meta-ad visitors (`has_fbclid` true or `utm_source=fb-ad` in `landing_url`). Drop internal tests (email ending
     `@mitranglobal.com`, or a name containing "test"). Count each `contact_id` once, on the first day it appears.
   - Sanity check: the counts must add up (kept + dropped + repeats = all rows). `get_form_performance` for the form gives a rough
     weekly total (it uses UTC days, so it can differ by a few).
   - Bookings: `query_opportunities` with `stage` "Appointment Booked", `order_by` created_at; count the report week's records,
     excluding tests ("redphone", "testingmg", @mitranglobal.com). This should equal Meta's bookings; if not, report both.
   - CRM ad sync: `get_ad_connection_health`. If `last_report_date` is older than yesterday, say in the owner summary that the
     CRM's Meta data is stale and must be synced in Lead Generation → Ad Launcher → Settings (there is no sync tool for the task).
   - Write the result into the `crm` block of the input file (see `data/raw/README.md`) and use the CRM lead count and
     cost per CRM lead (spend ÷ CRM leads) in the headline, a tip and the email table, next to Meta's count.
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

## Daily live tracking (home page)

`index.html` is now the live home page: today's spend and leads, auto-refreshing, not the weekly report.
A separate scheduled task, "Daily live tracking update", keeps it current — the weekly Monday task above
is unchanged and still owns `weekly.html` and the PDF reports.

- `data/raw_today/<date>.json`: one file per **India day** (00:00–24:00 IST), written fresh each run (see
  `data/raw_today/README.md` for the format). Like `data/raw/`, this folder is the private input and is
  not meant to be served.
- `scripts/build_today.py`: turns that input into `reports/daily_live/<date>.json` (a dated snapshot) and
  `reports/daily_live/latest.json` (what `index.html` actually fetches, client-side, every 5 minutes while
  a visitor has the page open). `reports/` is already published on both GitHub Pages and Vercel, so this
  sits alongside the weekly `reports/<date>.json` files.
- The lead count rule is exactly RUNBOOK step 1b, applied to one day instead of one week: pull Meta Ads
  account-level totals for today (`time_range` = today only, read-only, account `392337929851918` only),
  then cross-check the CRM the same way — form "Condtioning Lead 2.0" (`b1107448-dbc0-4084-a096-8ad05a76f6b6`),
  `query_form_submissions` for the India day (`created_after` = yesterday `T18:30:00Z`, `created_before` =
  today `T18:30:00Z`), keep Meta-ad visitors only, drop tests, count each `contact_id` once. **The CRM
  (deduped) count is `final_lead_count`** — the number shown as "Leads today" — with Meta's own `lead`
  field shown next to it for reference, since Meta usually undercounts. This is the same conclusion as
  every recent weekly report (e.g. 16 Nov: 59 CRM-deduped vs 43 Meta); see the note at the bottom of this
  file about `claude/reporting-rules.md`, which said the opposite before this was corrected.
  Bookings = CRM "Appointment Booked" opportunities `created_at` today, tests removed, same as RUNBOOK 1b.
  Check `get_ad_connection_health`; if `last_report_date` is more than a day old, pass that into
  `ad_sync_stale_days` in the raw file so the home page shows the warning.
- Build with `python3 scripts/build_today.py build data/raw_today/<date>.json`. It refuses to write
  `reports/daily_live/` if the submissions don't add up (`form_fills_all` ≠ kept + dropped) — re-pull
  instead of forcing it. Never hand-count the lead total; the script's arithmetic is the whole point.
- Commit and push `data/raw_today/<date>.json` and `reports/daily_live/` as the GitHub account, same as
  the weekly task. No team email for this one — it just updates the live page, several times a day.
- If the Meta Ads or CRM pull itself fails, do not touch `reports/daily_live/latest.json` — leave the
  last good snapshot live and just note the failure in the run's own log. A day with genuinely zero
  spend and zero leads is still valid and should be published (same rule as an idle week).
- The "Daily live tracking update" scheduled task runs every 3 hours and is separate from the Monday task;
  update one without touching the other.

## MiTran chat assistant

A chat button on every page answers questions about this data. It is `mitran-chat.js`, loaded by one
`<script src="/mitran-chat.js" defer></script>` line before `</body>` in `index.html`, `meta.html` and `weekly.html`.
The server part is `netlify/functions/mitran-chat.mjs` and `netlify/lib/mitran/`. It reads the published `/meta` page and
`reports/` at run time, so a new Monday report reaches it with no extra step. The Monday task must not remove the script line,
`mitran-chat.js`, `netlify/` or `package.json`. It needs the `ANTHROPIC_API_KEY` environment variable in Netlify (Functions scope).
**Now that Netlify is retired**, the assistant runs as a Vercel function, `api/mitran-chat.mjs` (config in `vercel.json`), which reuses
`netlify/lib/mitran/`. It needs `ANTHROPIC_API_KEY` in the Vercel project (Settings > Environment Variables, Production). Optional:
`MITRAN_MODEL`, `MITRAN_DAILY_LIMIT`. GitHub Pages is static and cannot run a backend, so `mitran-chat.js` makes the Pages copy call
`https://weekly-report-henna.vercel.app/api/mitran-chat` (the function allows that origin). The daily cap there is an in-memory,
best-effort counter. Keep `api/` and `vercel.json` when editing.
If `meta.html` is ever regenerated, keep the script line and the `const D={...}` data block, which the assistant reads.
`reports/daily/` holds daily spend per ad account from Meta (Jan 2024 to 5 Nov 2026, all four accounts with spend). It is a one-time
snapshot that makes the assistant's monthly and date-range totals exact. The Monday task does not update it and must not delete it;
the main account's newer days come from each report's own daily rows. Questions per day are capped at 200 (env `MITRAN_DAILY_LIMIT`).

## Monday check (11:13 AM IST)

A second scheduled task, "Monday report check", runs after the report. It confirms that the Monday task ran today, that
`data/raw/<date>.json`, `reports/<date>.json` and the PDF exist and add up, that Netlify is serving the latest commit, and
that `data/email_log.tsv` has a `sent` row for today. It emails the owner the result. It never emails the team and
never edits reports; if the Monday task did not run at all, it starts it once.
