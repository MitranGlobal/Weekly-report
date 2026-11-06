// Every number the bot states comes from this file: deterministic code, no AI.

import { ACCOUNTS, resolveAccount } from './data.mjs';

// ---------- small helpers ----------
const DAY = 86400000;
const toDay = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const round2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const sum = (xs) => xs.reduce((a, b) => a + (+b || 0), 0);
const ratio = (a, b, k = 1) => (b ? round2((a / b) * k) : null);
export const formatINR = (n) => (n == null ? '–' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return [`${ym}-01`, end];
}
function monthsBetween(start, end) {
  const out = [];
  let [y, m] = start.slice(0, 7).split('-').map(Number);
  const stop = end.slice(0, 7);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push(ym);
    if (ym >= stop) return out;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
}

/** Validates period and account inputs. Throws a message Claude can pass on or act on. */
export function resolveScope(data, { start_date, end_date, account } = {}) {
  if ((start_date && !isIsoDate(start_date)) || (end_date && !isIsoDate(end_date))) throw new Error('Dates must be real calendar dates in YYYY-MM-DD format.');
  if (start_date && end_date && start_date > end_date) throw new Error('start_date is after end_date.');
  let acct = null;
  if (account && !/^(all|all accounts|\*)$/i.test(String(account).trim())) {
    acct = resolveAccount(account);
    if (!acct) throw new Error(`Unknown ad account "${account}". Known accounts: ${ACCOUNTS.map((a) => a.name).join(', ')}.`);
  }
  const dated = Boolean(start_date || end_date);
  return { start: start_date || data.earliestWeek, end: end_date || data.latestWeek, dated, account: acct };
}

const matchesAccount = (row, acct) => !acct || row.account_id === acct.id;

// ---------- spend allocation ----------
/**
 * Works out how much of each week's spend falls inside a date range.
 *   exact     = whole week inside the range, or split using real daily rows
 *   estimated = week straddles the range with no daily rows, so split by days (spend x days / 7)
 */
export function allocateSpend(data, start, end, acct, { useKnownSplits = true } = {}) {
  const splits = useKnownSplits ? knownSplits(data) : new Map();
  const lines = [];
  for (const w of data.weeks) {
    if (!matchesAccount(w, acct) || w.week_end < start || w.week_start > end) continue;
    const inside = w.week_start >= start && w.week_end <= end;
    const split = w.source === 'primary' ? splits.get(w.week_start) : null;
    // Daily data for this account covering the whole week splits it exactly, by real days.
    const dayData = data.daily?.get(w.account_id);
    const dailyCovers = w.source !== 'daily_data' && dayData && dayData.from <= w.week_start && dayData.to >= w.week_end;
    let amount;
    let basis;
    if (inside) {
      amount = w.spend || 0;
      basis = 'exact';
    } else if (dailyCovers) {
      amount = 0;
      for (const d of dayData.days.values()) if (d.date >= w.week_start && d.date <= w.week_end && d.date >= start && d.date <= end) amount += d.spend;
      basis = 'exact';
    } else if (w.dailyUsable) {
      amount = sum(w.daily.filter((d) => d.date >= start && d.date <= end).map((d) => d.spend));
      basis = 'exact';
    } else if (split && toDay(end) === toDay(split.boundary) - 1) {
      amount = split.before;
      basis = 'exact (from dashboard month total)';
    } else if (split && start === split.boundary) {
      amount = split.after;
      basis = 'exact (from dashboard month total)';
    } else {
      const from = Math.max(toDay(w.week_start), toDay(start));
      const to = Math.min(toDay(w.week_end), toDay(end));
      amount = ((w.spend || 0) * (to - from + 1)) / 7;
      basis = amount ? 'estimated' : 'exact';
    }
    lines.push({ week_start: w.week_start, week_end: w.week_end, account_id: w.account_id, account_name: w.account_name, amount: round2(amount), basis, inside, source: w.source });
  }
  return lines;
}

const splitCache = new WeakMap();
/**
 * The dashboard marks some months as exact for the main account. If only one week in such a month
 * has to be estimated, the exact total reveals how that week really split across the month end.
 */
function knownSplits(data) {
  if (splitCache.has(data)) return splitCache.get(data);
  const splits = new Map();
  const main = { id: '392337929851918' };
  for (const row of data.dashboard.meta_monthly ?? []) {
    if (!row.Exact) continue;
    const [ms, me] = monthBounds(row.Month);
    const lines = allocateSpend(data, ms, me, main, { useKnownSplits: false });
    const estimated = lines.filter((l) => l.basis === 'estimated');
    if (estimated.length !== 1) continue;
    const week = data.weeks.find((w) => w.source === 'primary' && w.week_start === estimated[0].week_start && w.account_id === main.id);
    const inMonth = estimated[0].amount + (row.MainAccount - sum(lines.map((l) => l.amount)));
    if (!week || inMonth < 0 || inMonth > week.spend) continue;
    const startsBefore = week.week_start < ms;
    const boundary = startsBefore ? ms : new Date((toDay(me) + 1) * DAY).toISOString().slice(0, 10);
    splits.set(week.week_start, { boundary, before: round2(startsBefore ? week.spend - inMonth : inMonth), after: round2(startsBefore ? inMonth : week.spend - inMonth) });
  }
  splitCache.set(data, splits);
  return splits;
}

// ---------- datasets ----------
function filterWeeks(data, scope) {
  return data.weeks.filter((w) => matchesAccount(w, scope.account) && w.week_end >= scope.start && w.week_start <= scope.end);
}

function weeklyRows(data, scope) {
  // allocateSpend walks data.weeks with the same filter, so its lines match these rows one to one.
  const lines = allocateSpend(data, scope.start, scope.end, scope.account);
  return filterWeeks(data, scope).map((w, i) => ({
    week_start: w.week_start,
    week_end: w.week_end,
    report_date: w.report_date,
    account: w.account_name,
    account_id: w.account_id,
    spend_in_period_inr: lines[i].amount,
    period_basis: lines[i].basis,
    week_fully_in_period: lines[i].inside,
    spend_whole_week_inr: round2(w.spend),
    impressions: w.impressions ?? null,
    reach: w.reach ?? null,
    link_clicks: w.link_clicks ?? null,
    results: w.results ?? null,
    result_type: w.result_label || null,
    cost_per_result_inr: round2(w.cost_per_result),
    leads: w.leads ?? null,
    purchases: w.purchases ?? null,
    link_ctr_pct: round2(w.link_ctr),
    cpm_inr: round2(w.cpm),
    frequency: round2(w.frequency),
    record_type: w.source === 'primary' ? 'weekly report' : w.source === 'daily_data' ? 'built from daily data (no weekly report)' : 'other account, spend only',
  }));
}

function dailyRows(data, scope) {
  const out = [];
  for (const [id, acct] of data.daily ?? new Map()) {
    if (scope.account && scope.account.id !== id) continue;
    const name = ACCOUNTS.find((a) => a.id === id)?.name ?? id;
    for (const d of acct.days.values()) {
      if (d.date < scope.start || d.date > scope.end) continue;
      // Days with no spend and no delivery are left out to keep files short.
      if (!d.spend && !d.impressions) continue;
      out.push({ date: d.date, account: name, account_id: id, spend_inr: round2(d.spend), impressions: d.impressions, link_clicks: d.link_clicks, leads: d.leads, purchases: d.purchases });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account));
}

function monthlyRows(data, scope) {
  const accounts = scope.account ? [scope.account] : ACCOUNTS.filter((a) => a.id);
  const rows = [];
  for (const ym of monthsBetween(scope.start, scope.end)) {
    const [mStart, mEnd] = monthBounds(ym);
    const from = mStart < scope.start ? scope.start : mStart;
    const to = mEnd > scope.end ? scope.end : mEnd;
    for (const a of accounts) {
      const lines = allocateSpend(data, from, to, a);
      if (!lines.length) continue;
      const spend = sum(lines.map((l) => l.amount));
      const estimated = lines.some((l) => l.basis === 'estimated' && l.amount);
      const basis = estimated ? 'estimated (weeks crossing a month end split by days)' : 'exact';
      if (spend === 0) continue;
      rows.push({ month: ym, account: a.name, account_id: a.id, spend_inr: round2(spend), basis });
    }
  }
  return rows;
}

function accountRows(data, scope) {
  const total = data.dashboard.meta_kpis?.Spend || sum(data.dashboard.meta_accounts.map((a) => a.Spend));
  return data.dashboard.meta_accounts
    .filter((a) => !scope.account || a.Account === scope.account.dashboard)
    .map((a) => ({
      account: a.Account,
      lifetime_spend_inr: a.Spend,
      share_of_spend_pct: ratio(a.Spend, total, 100),
      impressions: a.Impressions,
      reach: a.Reach,
      frequency: ratio(a.Impressions, a.Reach),
      ctr_pct: a.CTR,
      cpm_inr: a.CPM,
      cpc_inr: ratio(a.Spend, a.LinkClicks),
      link_clicks: a.LinkClicks,
      purchases: a.Purchases,
      leads: a.Leads,
    }));
}

const textMatch = (value, q) => !q || String(value ?? '').toLowerCase().includes(String(q).toLowerCase());
const eqCI = (value, q) => !q || String(value ?? '').toLowerCase() === String(q).toLowerCase();

function campaignLifetimeRows(data, scope, f) {
  return data.dashboard.meta_campaigns
    .filter((c) => (!scope.account || c.Account === scope.account.campaignLabel) && textMatch(c.Campaign, f.campaign) && eqCI(c.Goal, f.goal) && eqCI(c.Status, f.status))
    .map((c) => ({ campaign: c.Campaign, account: c.Account, goal: c.Goal, status: c.Status, spend_inr: c.Spend, ctr_pct: c.CTR, results: c.Results, result_type: c.ResultType, cost_per_result_inr: c.CostPerResult }))
    .sort((a, b) => b.spend_inr - a.spend_inr);
}

function campaignWeeklyRows(data, scope, f) {
  return data.campaignWeeks
    .filter((c) => matchesAccount(c, scope.account) && c.week_end >= scope.start && c.week_start <= scope.end && (c.spend || c.results) && textMatch(c.campaign, f.campaign) && eqCI(c.status, f.status))
    .map((c) => ({ week_start: c.week_start, week_end: c.week_end, account: c.account_name, campaign: c.campaign, objective: c.objective, spend_inr: round2(c.spend), impressions: c.impressions, reach: c.reach, link_clicks: c.link_clicks, results: c.results, result_type: c.result_type, cost_per_result_inr: round2(c.cost_per_result), leads: c.leads, purchases: c.purchases, link_ctr_pct: round2(c.link_ctr), frequency: round2(c.frequency), current_status: c.status }));
}

function coverageNotes(data, dataset, scope, rows) {
  const notes = [];
  const g2 = ACCOUNTS.find((a) => a.name === 'MiTran Global 2');
  const g2Row = data.dashboard.meta_accounts.find((a) => a.Account === g2.dashboard);
  const g2Dated = data.daily?.has(g2.id);
  const datedSet = ['weekly', 'daily', 'monthly', 'campaigns_weekly'].includes(dataset);
  if (!g2Dated && datedSet && scope.account?.name === g2.name) notes.push(`${g2.name} has no dated data. Weekly reports never cover it, so only lifetime totals exist (use the accounts or campaigns_lifetime dataset).`);
  else if (!g2Dated && datedSet && !scope.account && g2Row) notes.push(`${g2.name} (₹${g2Row.Spend.toLocaleString('en-IN')} lifetime) is not included because no weekly report covers it, so its spend has no dates.`);
  if (datedSet && scope.dated && data.dailyThrough && scope.end > data.dailyThrough) notes.push(`Data runs to ${data.dailyThrough}. Days after that have no figures yet.`);
  if (dataset === 'daily') notes.push('Daily spend comes from Meta for every account. Days with no spend are left out.');
  if (dataset === 'weekly' && rows.some((r) => r.record_type.startsWith('built from daily'))) notes.push('Rows marked "built from daily data" cover spend no weekly report includes, such as MiTran Global 2 or days after the latest report.');
  if (dataset === 'campaigns_weekly' && !scope.account) notes.push('Campaign rows come from the weekly reports, which cover the main account (and older accounts in history weeks). MiTran Global 2 campaigns appear only in the campaigns_lifetime dataset.');
  if (dataset === 'weekly') notes.push('Reach cannot be added across weeks because the same person can appear in several weeks.');
  if (dataset === 'weekly' && rows.some((r) => r.record_type.startsWith('other account'))) notes.push('"Other account, spend only" rows come from the report\'s also_spent list, which holds spend but no other metrics, so click, lead and purchase totals here can be lower than the lifetime figures.');
  if (dataset === 'campaigns_weekly') notes.push('Campaign rows exist only in weekly reports that include a campaign breakdown. Many older weeks have account totals only.');
  if (dataset === 'audiences') notes.push("Audience sizes are Meta's lower bound.");
  if (dataset === 'creatives') notes.push('Top 10 ads by spend only, listed by format and cost per result.');
  return notes;
}

const DATASETS = {
  weekly: (d, s) => weeklyRows(d, s),
  daily: (d, s) => dailyRows(d, s),
  monthly: (d, s) => monthlyRows(d, s),
  accounts: (d, s) => accountRows(d, s),
  campaigns_lifetime: (d, s, f) => campaignLifetimeRows(d, s, f),
  campaigns_weekly: (d, s, f) => campaignWeeklyRows(d, s, f),
  creatives: (d) => (d.dashboard.meta_creatives ?? []).map((c) => ({ ad: c.Ad, format: c.Format, cost_per_result_inr: c.CostPerResult, result_type: c.ResultType })),
  audiences: (d) => (d.dashboard.meta_audiences ?? []).map((a) => ({ audience: a.Audience, type: a.Type, status: a.Status, size_min: a.Size })),
};
export const DATASET_NAMES = Object.keys(DATASETS);

function totalsFor(dataset, rows, scope) {
  if (!rows.length) return {};
  // Weeks can overlap the period's edges. Only spend can be split by day, so other totals would
  // silently include days outside the period; they are left out when that happens.
  if (dataset === 'weekly') {
    const partial = rows.some((r) => !r.week_fully_in_period);
    const t = { spend_inr: round2(sum(rows.map((r) => r.spend_in_period_inr))) };
    const estimated = round2(sum(rows.filter((r) => r.period_basis === 'estimated').map((r) => r.spend_in_period_inr)));
    if (estimated) t.estimated_part_inr = estimated;
    if (partial) return t;
    for (const k of ['impressions', 'link_clicks', 'leads', 'purchases']) t[k] = sum(rows.map((r) => r[k]));
    if (t.impressions) { t.cpm_inr = ratio(t.spend_inr, t.impressions, 1000); t.link_ctr_pct = ratio(t.link_clicks, t.impressions, 100); }
    if (t.link_clicks) t.cpc_inr = ratio(t.spend_inr, t.link_clicks);
    return t;
  }
  if (dataset === 'campaigns_weekly' && rows.some((r) => r.week_start < scope.start || r.week_end > scope.end)) {
    return { spend_whole_weeks_inr: round2(sum(rows.map((r) => r.spend_inr))) };
  }
  const spendKey = dataset === 'accounts' ? 'lifetime_spend_inr' : 'spend_inr';
  if (!(spendKey in rows[0])) return {};
  const t = { spend_inr: round2(sum(rows.map((r) => r[spendKey]))) };
  for (const k of ['impressions', 'link_clicks', 'leads', 'purchases']) if (k in rows[0]) t[k] = sum(rows.map((r) => r[k]));
  if (t.impressions) {
    t.cpm_inr = ratio(t.spend_inr, t.impressions, 1000);
    if (t.link_clicks != null) t.link_ctr_pct = ratio(t.link_clicks, t.impressions, 100);
  }
  if (t.link_clicks) t.cpc_inr = ratio(t.spend_inr, t.link_clicks);
  return t;
}

/** Runs a dataset query. Returns every row plus totals and coverage notes. */
const LIFETIME_ONLY = new Set(['accounts', 'campaigns_lifetime', 'creatives', 'audiences']);

export function queryData(data, input) {
  const dataset = input.dataset;
  if (!DATASETS[dataset]) throw new Error(`Unknown dataset "${dataset}". Options: ${DATASET_NAMES.join(', ')}.`);
  // Lifetime tables have no dates. Refusing dates here stops a lifetime total being reported as a month's figure.
  if (LIFETIME_ONLY.has(dataset) && (input.start_date || input.end_date)) {
    throw new Error(`The ${dataset} dataset holds lifetime totals only and cannot be filtered by date. For a date, month or range use monthly (spend per month per account), daily, weekly or campaigns_weekly.`);
  }
  const scope = resolveScope(data, input);
  const rows = DATASETS[dataset](data, scope, input);
  const notes = coverageNotes(data, dataset, scope, rows);
  if (dataset === 'weekly' && rows.some((r) => !r.week_fully_in_period)) notes.unshift('Some weeks only partly fall in this period. The total counts only days inside the period (spend_in_period_inr). Every other column is a whole-week figure, so no totals are given for them.');
  if (dataset === 'campaigns_weekly' && rows.some((r) => r.week_start < scope.start || r.week_end > scope.end)) notes.unshift('Some weeks only partly fall in this period. Campaign rows are whole-week figures, so the total may include days outside the period.');
  return { dataset, period: { start: scope.start, end: scope.end, dated: scope.dated }, account: scope.account?.name ?? 'All accounts', rows, totals: totalsFor(dataset, rows, scope), notes };
}

// ---------- CSV ----------
function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  // Stops a spreadsheet treating a campaign name as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  // BOM so Excel reads the file as UTF-8.
  return `﻿${[cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n')}\r\n`;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all';

export function buildCsvReport(data, input) {
  const result = queryData(data, input);
  const label = result.period.dated ? `${result.period.start}_to_${result.period.end}` : 'lifetime';
  return {
    summary: { dataset: result.dataset, period: result.period, account: result.account, row_count: result.rows.length, totals: result.totals, notes: result.notes },
    attachment: result.rows.length
      ? { kind: 'csv', filename: `mitran_${result.dataset}_${slug(result.account)}_${label}.csv`, mime: 'text/csv;charset=utf-8', content: toCsv(result.rows), rows: result.rows.length }
      : null,
  };
}

// ---------- spend invoice report ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function computeInvoice(data, input) {
  const scope = resolveScope(data, input);
  const gst = input.gst_percent ?? null;
  if (gst != null && !(gst >= 0 && gst <= 100)) throw new Error('gst_percent must be between 0 and 100.');

  const lines = allocateSpend(data, scope.start, scope.end, scope.account)
    .filter((l) => l.amount)
    .map((l) => ({ period: `${l.week_start} to ${l.week_end}`, account: l.account_name, account_id: l.account_id, amount: l.amount, basis: l.basis, description: l.inside ? 'Meta Ads spend' : 'Meta Ads spend, part of week' }));

  const notes = [];
  const g2 = ACCOUNTS.find((a) => a.name === 'MiTran Global 2');
  const g2Row = data.dashboard.meta_accounts.find((a) => a.Account === g2.dashboard);
  const g2InScope = (!scope.account || scope.account.name === g2.name) && !data.daily?.has(g2.id);
  if (g2InScope && g2Row) {
    if (!scope.dated) lines.push({ period: 'Undated (lifetime total)', account: g2.name, account_id: null, amount: g2Row.Spend, basis: 'exact', description: 'Meta Ads spend, lifetime total; no weekly dates available' });
    else notes.push(`${g2.name} (₹${g2Row.Spend.toLocaleString('en-IN')} lifetime) is excluded: no weekly report covers it, so its spend cannot be placed in this date range.`);
  }

  const subtotal = round2(sum(lines.map((l) => l.amount)));
  const estimatedAmount = round2(sum(lines.filter((l) => l.basis === 'estimated').map((l) => l.amount)));
  if (estimatedAmount) notes.push(`₹${estimatedAmount.toLocaleString('en-IN')} is estimated: weeks crossing the start or end date were split by days, because no daily data exists for them.`);

  const byAccount = {};
  for (const l of lines) byAccount[l.account] = (byAccount[l.account] || 0) + l.amount;
  const accountSummary = Object.entries(byAccount).map(([account, amount]) => ({ account, amount: round2(amount) })).sort((a, b) => b.amount - a.amount);

  const gstAmount = gst != null ? round2((subtotal * gst) / 100) : null;
  const total = round2(subtotal + (gstAmount || 0));
  const scopeName = scope.account?.name ?? 'All ad accounts';
  const reference = `MG-ADS-${scope.dated ? `${scope.start.replaceAll('-', '')}-${scope.end.replaceAll('-', '')}` : 'LIFETIME'}-${slug(scopeName).toUpperCase()}`;
  return { reference, scope: scopeName, start: scope.start, end: scope.end, dated: scope.dated, lines, accountSummary, subtotal, gst, gstAmount, total, estimatedAmount, notes, dataAsOf: data.pulledAt };
}

export function renderInvoiceHtml(inv, generatedOn) {
  const rows = inv.lines
    .map((l) => `<tr><td>${esc(l.period)}</td><td>${esc(l.account)}${l.account_id ? `<small>ID ${esc(l.account_id)}</small>` : ''}</td><td>${esc(l.description)}</td><td>${esc(l.basis)}</td><td class="r">${esc(formatINR(l.amount))}</td></tr>`)
    .join('');
  const acct = inv.accountSummary.map((a) => `<tr><td>${esc(a.account)}</td><td class="r">${esc(formatINR(a.amount))}</td></tr>`).join('');
  const notes = [
    'This is an internal spend report built from Meta Ads reporting data. It is not a tax invoice. For accounting and GST, use the billing invoices in Meta Business Settings.',
    'Amounts are "amount spent" as Meta reports them. Meta may adjust recent numbers slightly.',
    ...(inv.gst != null ? [`GST at ${inv.gst}% is an estimate requested for this report. It does not come from Meta billing data.`] : []),
    ...inv.notes,
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(inv.reference)}</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{font-family:"Segoe UI",Segoe,-apple-system,Roboto,Arial,sans-serif;color:#252423;background:#EAEAEA;margin:0;padding:24px;font-size:13px;line-height:1.45}
.sheet{background:#fff;max-width:860px;margin:0 auto;padding:36px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
header{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;border-bottom:3px solid #252423;padding-bottom:16px}
h1{font-size:22px;font-weight:600;margin:0 0 2px}h2{font-size:14px;font-weight:600;margin:24px 0 8px}.org{font-weight:600;font-size:15px}.muted{color:#605E5C}
dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0}dt{color:#605E5C}dd{margin:0;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th{text-align:left;font-weight:600;padding:6px 8px;border-bottom:2px solid #252423;white-space:nowrap}td{padding:6px 8px;border-bottom:1px solid #E1DFDD;vertical-align:top}td small{display:block;color:#605E5C}
.r{text-align:right;white-space:nowrap}.totals{margin:14px 0 0 auto;width:min(340px,100%)}.totals td{border:0;padding:3px 8px}.totals .grand td{border-top:2px solid #252423;font-weight:600;font-size:16px;padding-top:8px}
.banner{background:#FFF4CE;border-left:4px solid #D9B300;padding:8px 12px;margin:16px 0 0}ul{padding-left:18px;margin:6px 0 0}li{margin-bottom:4px}
.tbl{overflow-x:auto}button{font:inherit;font-weight:600;background:#252423;color:#fff;border:0;padding:8px 14px;border-radius:2px;cursor:pointer;margin:0 auto 12px;display:block}
@media print{body{background:#fff;padding:0}.sheet{box-shadow:none;max-width:none;padding:0}button{display:none}}
</style></head><body><button type="button" onclick="window.print()">Print or save as PDF</button><div class="sheet">
<header><div><div class="org">MiTran Global</div><h1>Ad Spend Invoice Report</h1><div class="muted">Meta Ads · amounts in INR</div></div>
<dl><dt>Reference</dt><dd>${esc(inv.reference)}</dd><dt>Period</dt><dd>${inv.dated ? `${esc(inv.start)} to ${esc(inv.end)}` : `Lifetime (${esc(inv.start)} to ${esc(inv.end)})`}</dd><dt>Scope</dt><dd>${esc(inv.scope)}</dd><dt>Generated</dt><dd>${esc(generatedOn)}</dd>${inv.dataAsOf ? `<dt>Data pulled</dt><dd>${esc(inv.dataAsOf)}</dd>` : ''}</dl></header>
<div class="banner"><strong>Not a tax invoice.</strong> This report summarises ad spend for internal use.</div>
<h2>Spend by account</h2><div class="tbl"><table><thead><tr><th>Account</th><th class="r">Amount</th></tr></thead><tbody>${acct || '<tr><td colspan="2">No spend in this period.</td></tr>'}</tbody></table></div>
<h2>Line items</h2><div class="tbl"><table><thead><tr><th>Period</th><th>Account</th><th>Description</th><th>Basis</th><th class="r">Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No spend in this period.</td></tr>'}</tbody></table></div>
<table class="totals"><tbody><tr><td>Subtotal</td><td class="r">${esc(formatINR(inv.subtotal))}</td></tr>${inv.gst != null ? `<tr><td>GST at ${esc(inv.gst)}% (estimate)</td><td class="r">${esc(formatINR(inv.gstAmount))}</td></tr>` : ''}<tr class="grand"><td>Total</td><td class="r">${esc(formatINR(inv.total))}</td></tr></tbody></table>
<h2>Notes</h2><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
</div></body></html>`;
}

export function buildInvoice(data, input, generatedOn) {
  const inv = computeInvoice(data, input);
  const base = inv.reference.toLowerCase();
  const csvRows = inv.lines.map((l) => ({ period: l.period, account: l.account, account_id: l.account_id, description: l.description, basis: l.basis, amount_inr: l.amount }));
  csvRows.push({ period: 'SUBTOTAL', amount_inr: inv.subtotal });
  if (inv.gst != null) csvRows.push({ period: `GST ${inv.gst}% (estimate)`, amount_inr: inv.gstAmount });
  csvRows.push({ period: 'TOTAL', amount_inr: inv.total });
  return {
    summary: { reference: inv.reference, scope: inv.scope, period: inv.dated ? { start: inv.start, end: inv.end } : 'lifetime', by_account: inv.accountSummary, line_count: inv.lines.length, subtotal_inr: inv.subtotal, gst_percent: inv.gst, gst_inr: inv.gstAmount, total_inr: inv.total, estimated_part_inr: inv.estimatedAmount, notes: inv.notes, is_tax_invoice: false },
    attachments: [
      { kind: 'invoice', filename: `${base}.html`, mime: 'text/html;charset=utf-8', content: renderInvoiceHtml(inv, generatedOn) },
      { kind: 'csv', filename: `${base}.csv`, mime: 'text/csv;charset=utf-8', content: toCsv(csvRows), rows: csvRows.length },
    ],
  };
}

// ---------- statistics (same formulas as the dashboard's EDA tab) ----------
const S = {
  mean: (a) => sum(a) / a.length,
  q(a, p) { const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * p, l = Math.floor(i), h = Math.ceil(i); return s[l] + (s[h] - s[l]) * (i - l); },
  std(a) { const m = S.mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); },
  skew(a) { const m = S.mean(a), s = S.std(a), n = a.length; return (n / ((n - 1) * (n - 2))) * sum(a.map((x) => ((x - m) / s) ** 3)); },
  corr(a, b) { const ma = S.mean(a), mb = S.mean(b); let n = 0, da = 0, db = 0; a.forEach((x, i) => { n += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; }); return n / Math.sqrt(da * db); },
};

export function computeStatistics(data) {
  const C = data.dashboard.meta_campaigns;
  const tr = C.filter((c) => c.CostPerResult != null);
  const describe = (name, a) => ({ variable: name, n: a.length, mean: round2(S.mean(a)), median: round2(S.q(a, 0.5)), std_dev: round2(S.std(a)), min: round2(Math.min(...a)), q1: round2(S.q(a, 0.25)), q3: round2(S.q(a, 0.75)), max: round2(Math.max(...a)), skew: round2(S.skew(a)), cv_pct: round2((S.std(a) / S.mean(a)) * 100) });
  const descriptive = [
    describe('Spend (INR)', C.map((c) => c.Spend)),
    describe('CTR (%)', C.map((c) => c.CTR)),
    describe('Results', C.map((c) => c.Results)),
    describe('Cost per result (INR)', tr.map((c) => c.CostPerResult)),
  ];
  const vars = { Spend: tr.map((c) => c.Spend), CTR: tr.map((c) => c.CTR), Results: tr.map((c) => c.Results), 'Cost/result': tr.map((c) => c.CostPerResult) };
  const names = Object.keys(vars);
  const correlation = names.map((a) => ({ variable: a, ...Object.fromEntries(names.map((b) => [b, round2(S.corr(vars[a], vars[b]))])) }));
  const cp = tr.map((c) => c.CostPerResult);
  const q1 = S.q(cp, 0.25), q3 = S.q(cp, 0.75), fence = q3 + 1.5 * (q3 - q1);
  const outliers = tr.filter((c) => c.CostPerResult > fence).map((c) => ({ campaign: c.Campaign, cost_per_result_inr: c.CostPerResult, result_type: c.ResultType }));
  const ranked = [...C].sort((a, b) => b.Spend - a.Spend);
  const total = sum(ranked.map((c) => c.Spend));
  let running = 0;
  const pareto = ranked.map((c, i) => { running += c.Spend; return { rank: i + 1, campaign: c.Campaign, spend_inr: c.Spend, cumulative_pct: round2((running / total) * 100) }; });
  const appt = (f) => (data.dashboard.meta_creatives ?? []).filter((c) => c.Format === f && c.ResultType === 'appointment').map((c) => c.CostPerResult);
  return {
    sample: `${C.length} listed campaigns; cost per result excludes ${C.length - tr.length} with no tracked result`,
    descriptive,
    correlation,
    outlier_rule: { q1: round2(q1), q3: round2(q3), iqr: round2(q3 - q1), fence: round2(fence), outliers },
    pareto_top5_pct: pareto[4]?.cumulative_pct ?? null,
    pareto,
    median_cost_per_appointment: { video: round2(S.q(appt('Video'), 0.5)), image: round2(S.q(appt('Image'), 0.5)) },
  };
}
