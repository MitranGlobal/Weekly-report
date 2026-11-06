// Loads the dashboard's own published data and normalises it into flat rows.
// No Node or Netlify APIs here, so this file also runs in a browser for testing.

const CONCURRENCY = 12;

export const ACCOUNTS = [
  { id: '392337929851918', name: 'mitranglobal ad account', dashboard: 'mitranglobal ad account', campaignLabel: 'mitranglobal', aliases: ['main', 'mitranglobal', 'mitran global ad account', 'primary'] },
  { id: '730954635012236', name: 'Older ad account', dashboard: '730954635012236 (older)', campaignLabel: 'Older account', aliases: ['older', 'old', 'older account', 'legacy'] },
  { id: '951362586415730', name: 'mitranadaccount', dashboard: 'mitranadaccount', campaignLabel: null, aliases: ['mitranad', 'mitran ad account'] },
  // Lifetime and campaign totals only. No weekly report covers this account, so it has no dates.
  { id: null, name: 'MiTran Global 2', dashboard: 'MiTran Global 2', campaignLabel: 'MiTran Global 2', aliases: ['global 2', 'global2', 'mitran 2', 'mitranglobal2'] },
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

/**
 * Loads everything the bot can read.
 * @param {(path: string) => Promise<string>} fetchText returns the body of a site path such as "/meta".
 */
export async function loadData(fetchText) {
  const [metaHtml, indexJson] = await Promise.all([fetchText('/meta'), fetchText('/reports/index.json')]);
  const dashboard = extractDashboardData(metaHtml);
  const insights = extractInsights(metaHtml);
  const index = JSON.parse(indexJson);
  const list = index.reports ?? [];

  const reports = await mapLimit(list, CONCURRENCY, async (item) => normaliseReport(JSON.parse(await fetchText(`/reports/${item.report_date}.json`))));

  const weeks = reports.flatMap((r) => r.rows).sort((a, b) => a.week_start.localeCompare(b.week_start) || (a.source === 'primary' ? -1 : 1));
  const campaignWeeks = reports.flatMap((r) => r.campaigns).sort((a, b) => a.week_start.localeCompare(b.week_start));
  const narratives = reports.map((r) => r.narrative).sort((a, b) => b.report_date.localeCompare(a.report_date));

  const pulled = reports.map((r) => r.pulled_at).filter(Boolean).sort();
  return {
    dashboard,
    insights,
    weeks,
    campaignWeeks,
    narratives,
    latestReport: narratives[0]?.report_date ?? null,
    earliestWeek: weeks[0]?.week_start ?? null,
    latestWeek: weeks.reduce((m, w) => (w.week_end > m ? w.week_end : m), ''),
    pulledAt: pulled.at(-1) ?? null,
    reportCount: list.length,
  };
}
