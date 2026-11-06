// Loads the dashboard's own published data and normalises it into flat rows.
// No Node or Netlify APIs here, so this file also runs in a browser for testing.

const CONCURRENCY = 12;

export const ACCOUNTS = [
  { id: '392337929851918', name: 'mitranglobal ad account', dashboard: 'mitranglobal ad account', campaignLabel: 'mitranglobal', aliases: ['main', 'mitranglobal', 'mitran global ad account', 'primary'] },
  { id: '730954635012236', name: 'Older ad account', dashboard: '730954635012236 (older)', campaignLabel: 'Older account', aliases: ['older', 'old', 'older account', 'legacy'] },
  { id: '951362586415730', name: 'mitranadaccount', dashboard: 'mitranadaccount', campaignLabel: null, aliases: ['mitranad', 'mitran ad account'] },
  // No weekly report covers this account. Its dates come from the daily data in reports/daily/.
  { id: '1959761918762314', name: 'MiTran Global 2', dashboard: 'MiTran Global 2', campaignLabel: 'MiTran Global 2', aliases: ['global 2', 'global2', 'mitran 2', 'mitranglobal2'] },
];

const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Accepts an ID, name, or nickname. Returns the account, or null when nothing matches. */
export function resolveAccount(text) {
  // "main account" and "older ad account" should match the nicknames "main" and "older".
  // The word "account" alone stays ambiguous, so it matches nothing.
  const q = squash(String(text ?? '').replace(/\b(ad\s+)?account\b/gi, ''));
  if (!q) return null;
  return (
    ACCOUNTS.find((a) => a.id === q || squash(a.name) === q || a.aliases.some((x) => squash(x) === q)) ||
    ACCOUNTS.find((a) => squash(a.name).includes(q) || a.aliases.some((x) => squash(x).includes(q))) ||
    null
  );
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Pulls the `const D={...}` data object out of the published /meta page. */
export function extractDashboardData(html) {
  const match = /const D=(\{.*?\});<\/script>/s.exec(html);
  if (!match) throw new Error('Could not find the data block in the /meta page');
  return JSON.parse(match[1]);
}

/** Pulls literal insight lines (['good','Title:','Text']) out of the /meta page script. */
export function extractInsights(html) {
  const found = [];
  const re = /\['(good|bad|warn|)','([^'\n]{2,80}:)','([^'\n]{5,400})'\]/g;
  let m;
  while ((m = re.exec(html))) found.push({ tone: m[1] || 'info', title: m[2].replace(/:$/, ''), text: m[3] });
  return found;
}

const metricKeys = ['spend', 'impressions', 'reach', 'link_clicks', 'results', 'leads', 'purchases', 'cost_per_result', 'cost_per_lead', 'link_ctr', 'cpm', 'frequency'];

function normaliseReport(r) {
  const cur = r.totals?.cur ?? {};
  const daily = (r.daily ?? []).map((d) => ({ date: d.date, spend: +d.spend || 0, impressions: +d.impressions || 0, link_clicks: +d.link_clicks || 0, leads: +d.leads || 0 }));
  const dailySum = daily.reduce((s, d) => s + d.spend, 0);
  const spend = +cur.spend || 0;
  const primary = {
    report_date: r.report_date,
    week_start: r.week_start,
    week_end: r.week_end,
    account_id: r.account?.id ?? null,
    account_name: r.account?.name ?? '',
    result_label: r.result_label ?? '',
    active_days: r.active_days ?? null,
    spend_without_results: r.spend_without_results ?? null,
    source: 'primary',
    pdf: r.pdf ? `/${r.pdf}` : null,
    daily,
    // Daily rows can only split a week if they really add up to the week's spend.
    dailyUsable: daily.length > 0 && (spend === 0 || (dailySum > 0 && Math.abs(dailySum - spend) <= 1)),
  };
  for (const k of metricKeys) primary[k] = cur[k] ?? null;

  // `also_spent` records money other accounts spent that week. Spend only, no other metrics.
  const others = (r.also_spent ?? []).map((a) => ({
    report_date: r.report_date,
    week_start: r.week_start,
    week_end: r.week_end,
    account_id: a.id,
    account_name: a.name,
    result_label: '',
    source: 'also_spent',
    pdf: null,
    daily: [],
    dailyUsable: false,
    spend: +a.spend || 0,
  }));

  const campaigns = (r.campaigns ?? []).map((c) => ({
    report_date: r.report_date,
    week_start: r.week_start,
    week_end: r.week_end,
    account_id: r.account?.id ?? null,
    account_name: r.account?.name ?? '',
    campaign_id: c.id ?? null,
    campaign: c.name,
    objective: c.objective ?? null,
    status: c.status ?? null,
    daily_budget: c.daily_budget ?? null,
    result_type: c.result_type ?? null,
    ...Object.fromEntries(metricKeys.map((k) => [k, c.cur?.[k] ?? null])),
    prev_spend: c.prev?.spend ?? null,
  }));

  const narrative = { report_date: r.report_date, week_start: r.week_start, week_end: r.week_end, account_name: r.account?.name ?? '', headline: r.headline ?? '', tips: r.tips ?? [], actions: r.actions ?? [] };
  return { rows: [primary, ...others], campaigns, narrative, pulled_at: r.pulled_at ?? null };
}

const DAY_MS = 86400000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const mondayOf = (iso) => { const t = Date.parse(`${iso}T00:00:00Z`); return isoDay(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS); };

/** Loads the per-day spend files in /reports/daily/. Missing files mean "no daily data", not an error. */
async function loadDaily(fetchText) {
  let index;
  try { index = JSON.parse(await fetchText('/reports/daily/index.json')); } catch { return new Map(); }
  const files = await mapLimit(index.accounts ?? [], 4, async (a) => {
    try { return JSON.parse(await fetchText(`/reports/daily/${a.account_id}.json`)); } catch { return null; }
  });
  const daily = new Map();
  for (const f of files) {
    if (!f?.account_id) continue;
    const days = new Map(f.days.map((d) => [d.date, { date: d.date, spend: +d.spend || 0, impressions: +d.impressions || 0, link_clicks: +d.link_clicks || 0, leads: +d.leads || 0, purchases: +d.purchases || 0 }]));
    daily.set(String(f.account_id), { from: f.covers?.from, to: f.covers?.to, days });
  }
  return daily;
}

/**
 * Loads everything the bot can read.
 * @param {(path: string) => Promise<string>} fetchText returns the body of a site path such as "/meta".
 */
export async function loadData(fetchText) {
  const [metaHtml, indexJson, daily] = await Promise.all([fetchText('/meta'), fetchText('/reports/index.json'), loadDaily(fetchText)]);
  const dashboard = extractDashboardData(metaHtml);
  const insights = extractInsights(metaHtml);
  const index = JSON.parse(indexJson);
  const list = index.reports ?? [];

  const reports = await mapLimit(list, CONCURRENCY, async (item) => normaliseReport(JSON.parse(await fetchText(`/reports/${item.report_date}.json`))));

  const weekRows = reports.flatMap((r) => r.rows);

  // Newer weekly reports carry their own daily rows. Add them so days after the daily snapshot are exact too.
  for (const w of weekRows) {
    if (w.source !== 'primary' || !w.dailyUsable || !w.account_id) continue;
    let acct = daily.get(w.account_id);
    if (!acct) { acct = { from: w.week_start, to: w.week_end, days: new Map() }; daily.set(w.account_id, acct); }
    for (const d of w.daily) if (!acct.days.has(d.date)) acct.days.set(d.date, { ...d, purchases: 0 });
    if (w.week_start < acct.from) acct.from = w.week_start;
    if (w.week_end > acct.to) acct.to = w.week_end;
  }

  // Spend that no weekly report covers (an account with no reports, or days after the last report)
  // becomes Monday-to-Sunday rows built from the daily data, so dated questions include it.
  const covered = new Set();
  for (const w of weekRows) for (let t = Date.parse(`${w.week_start}T00:00:00Z`); t <= Date.parse(`${w.week_end}T00:00:00Z`); t += DAY_MS) covered.add(`${w.account_id}|${isoDay(t)}`);
  const extra = new Map();
  for (const [id, acct] of daily) {
    const name = ACCOUNTS.find((a) => a.id === id)?.name ?? id;
    for (const d of acct.days.values()) {
      if (!d.spend || covered.has(`${id}|${d.date}`)) continue;
      const start = mondayOf(d.date);
      const key = `${id}|${start}`;
      if (!extra.has(key)) extra.set(key, { report_date: null, week_start: start, week_end: isoDay(Date.parse(`${start}T00:00:00Z`) + 6 * DAY_MS), account_id: id, account_name: name, result_label: '', source: 'daily_data', pdf: null, daily: [], dailyUsable: true, spend: 0, impressions: 0, link_clicks: 0, leads: 0, purchases: 0 });
      const row = extra.get(key);
      row.daily.push(d);
      for (const k of ['spend', 'impressions', 'link_clicks', 'leads', 'purchases']) row[k] += d[k];
    }
  }
  for (const row of extra.values()) {
    row.spend = Math.round(row.spend * 100) / 100;
    row.daily.sort((a, b) => a.date.localeCompare(b.date));
    // Only real spend becomes a row. A few paise of rounding noise is ignored.
    if (row.spend >= 1) weekRows.push(row);
  }

  const order = { primary: 0, also_spent: 1, daily_data: 2 };
  const weeks = weekRows.sort((a, b) => a.week_start.localeCompare(b.week_start) || order[a.source] - order[b.source]);
  const campaignWeeks = reports.flatMap((r) => r.campaigns).sort((a, b) => a.week_start.localeCompare(b.week_start));
  const narratives = reports.map((r) => r.narrative).sort((a, b) => b.report_date.localeCompare(a.report_date));

  const pulled = reports.map((r) => r.pulled_at).filter(Boolean).sort();
  return {
    dashboard,
    insights,
    daily,
    weeks,
    campaignWeeks,
    narratives,
    latestReport: narratives[0]?.report_date ?? null,
    earliestWeek: weeks[0]?.week_start ?? null,
    latestWeek: weeks.reduce((m, w) => (w.week_end > m ? w.week_end : m), ''),
    dailyThrough: [...daily.values()].reduce((m, a) => (a.to > m ? a.to : m), ''),
    pulledAt: pulled.at(-1) ?? null,
    reportCount: list.length,
  };
}
