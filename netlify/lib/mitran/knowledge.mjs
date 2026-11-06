// What the bot knows in words: definitions, formulas and the dashboard's layout.
// Definitions only. Live figures always come from reports.mjs, so nothing here goes stale.

const glossary = [
  ['Amount spent (spend)', 'Money Meta charged for delivering ads in the period, in INR. Taken as reported by Meta. Meta may adjust recent numbers slightly.'],
  ['Impressions', 'How many times ads were shown. One person can produce many impressions.'],
  ['Reach', 'How many different people saw the ads at least once. Reach cannot be added across weeks because the same person can appear in more than one week.'],
  ['Frequency', 'Average number of times each person saw the ads. Formula: frequency = impressions / reach. The weekly reports treat frequency above 2.5 in the first week as a warning sign of ad fatigue.'],
  ['Link clicks', 'Clicks on the ad link that lead to the website or landing page.'],
  ['CTR (click-through rate)', 'Share of impressions that led to a click, as a percentage. The dashboard shows two versions. Account and campaign CTR comes from the Meta export. Link click rate in the weekly reports is calculated as link clicks / impressions, so it reads lower when other clicks count in the Meta figure.'],
  ['Link click rate (link CTR)', 'Weekly report metric. Formula: link click rate = link clicks / impressions x 100.'],
  ['CPM (cost per mille)', 'Cost of 1,000 impressions. Formula: CPM = spend / impressions x 1000. A lower CPM means cheaper delivery, but it says nothing about whether the audience converts.'],
  ['CPC (cost per click)', 'Cost of one link click. Formula: CPC = spend / link clicks. Shown in the accounts table on the Overview tab.'],
  ['Results', 'The outcome a campaign was set up to get. The type varies: purchases, appointments or bookings, form leads, website leads, or link clicks. Results of different types should not be compared directly.'],
  ['Cost per result', 'Formula: cost per result = spend / results. The weekly reports call it "cost each". Campaigns with no tracked result have no cost per result and are shown as none tracked.'],
  ['Cost per lead', 'Formula: cost per lead = spend / leads.'],
  ['Purchases', 'Purchases Meta tracked and attributed to ads. The dashboard holds no revenue data, so ROAS (return on ad spend) cannot be calculated from it.'],
  ['ROAS (return on ad spend)', 'Revenue divided by ad spend. Not available here: neither the dashboard nor the weekly reports hold revenue figures.'],
  ['Leads', 'Lead events Meta tracked, such as form submissions.'],
  ['Appointments and bookings', 'Website appointments scheduled through lead campaigns. The dashboard says appointments and the weekly reports say bookings for the same kind of result.'],
  ['Page views and landing page rate', 'Page views are landing page views after a click. The Overview tab shows page views as a share of link clicks, which indicates how many clickers actually reached the page.'],
  ['Spend with no tracked result', 'Spend on campaigns that recorded no purchase or booking. It can mean a campaign truly failed or that tracking was missing. In the weekly reports it is called spend with no followed by the result type.'],
  ['Active days', 'Number of days in the report week with any spend, out of 7.'],
  ['Campaign goal and objective', 'The dashboard groups campaigns as Sales or Leads. Weekly reports show the Meta objective, for example OUTCOME_LEADS.'],
  ['Campaign status', 'Active or Paused. In the weekly reports the status is the status at the time the data was pulled, not during that week.'],
  ['Lookalike audience', 'People Meta finds who resemble a source audience, such as paying customers. 1% means the closest 1% match in the country.'],
  ['Customer list audience', 'An audience uploaded from existing customer records.'],
  ['Audience size', "Sizes shown are Meta's lower bound, so an audience of 1,000 means at least 1,000."],
  ['Creative', 'The ad itself, image or video. The Creatives tab compares the top 10 ads by spend on cost per result.'],
  ['Backfilled and History badges', 'Backfilled means the report was generated later from Meta data instead of on its Monday. History marks older weeks, which usually have no daily breakdown and sometimes no campaign breakdown.'],
];

const statistics = [
  ['n (sample size)', 'Number of campaigns behind a statistic. The EDA tab uses the 25 listed campaigns. Cost per result uses only campaigns with a tracked result.'],
  ['Mean (average)', 'Sum of the values divided by n. Heavily pulled by very large values, which is why cost per result should be reported with the median.'],
  ['Median', 'The middle value once sorted. Half the campaigns sit below it. It is the better measure of typical cost because cost per result is right-skewed.'],
  ['Standard deviation (std dev)', 'Typical distance of values from the mean. The dashboard uses the sample formula, dividing by n - 1.'],
  ['Q1, Q3 and IQR (quartiles)', 'Q1 is the 25th percentile, Q3 the 75th. IQR (interquartile range) = Q3 - Q1. The dashboard calculates percentiles by linear interpolation between sorted values.'],
  ['Outliers (IQR rule, Tukey fence)', 'A campaign is flagged as an outlier when its cost per result is above the fence: Q3 + 1.5 x IQR. Only the high side is flagged, never the low side, because only unusually expensive campaigns matter here. Cheap campaigns are never called outliers on this dashboard.'],
  ['Skew (skewness)', 'Measures how lopsided a distribution is. Positive skew means a long tail of large values. Formula: n / ((n-1)(n-2)) x sum of ((x - mean) / std dev) cubed. Above about 1 is strongly skewed.'],
  ['CV (coefficient of variation)', 'Formula: CV = std dev / mean, as a percentage. It compares spread between measures on different scales.'],
  ['Correlation (Pearson r)', 'Strength of a straight-line relationship between two measures, from -1 to +1. Near 0 means no linear link. Blue cells are positive and red negative. It covers campaigns with a tracked result, is sensitive to outliers, and does not prove cause.'],
  ['Pareto chart', 'Campaigns ranked by spend, with a line showing cumulative share of total. It shows how concentrated spend is.'],
  ['Distribution histogram', 'Counts campaigns in cost bands: under ₹100, ₹100-500, ₹500-1k, ₹1k-2k, ₹2k-5k and ₹5k+, stacked by Sales and Leads.'],
  ['Log scale', 'Each axis step multiplies the value, for example by 10. The cost-per-result chart and the spend vs results y-axis use it because values span from tens to tens of thousands of rupees.'],
  ['Cost bar colours', 'In the cost per result chart, green means under ₹100 for sales or under ₹700 for bookings. Red means above ₹1,000 for sales or above ₹1,500 for bookings. Grey is everything between.'],
];

const dataModel = [
  ['Data model overview', 'There are three sources. (1) The Meta Ads Performance dashboard at /meta holds lifetime snapshots: accounts, campaigns, monthly spend, creatives, audiences and overall KPIs. (2) The weekly reports at /weekly hold one JSON file per week with totals, this week vs last week, campaign rows, tips and a PDF. (3) Daily spend files in /reports/daily hold Meta daily spend, impressions, link clicks, leads and purchases for every ad account from January 2024 to 5 November 2026; newer weekly reports add their own daily rows after that.'],
  ['Weekly report dating rule', 'A report is dated on the Monday it was made and covers the 7 days before it, Monday to Sunday. Example: the report of 2 Nov 2026 covers 26 Oct to 1 Nov 2026. A new report for the main ad account is added every Monday.'],
  ['Ad accounts', 'Spend comes from four accounts: mitranglobal ad account (ID 392337929851918, the main account since April 2026); Older ad account (ID 730954635012236, Jan 2024 to Aug 2026); mitranadaccount (ID 951362586415730, Apr 2025 to Jan 2026); and MiTran Global 2 (ID 1959761918762314, which ran only from 10 to 28 Oct 2026). The dashboard says 6 accounts because two read-only accounts with no spend are left out of its tables.'],
  ['How weekly and lifetime totals reconcile', 'Each weekly report covers the account that ran ads that week, plus an also_spent list of other accounts. Daily data from Meta matches every one of those weekly figures to the rupee, and adds MiTran Global 2, which no weekly report covers. All four accounts together reproduce the dashboard lifetime total of ₹3,66,060.'],
  ['MiTran Global 2 and October 2026', 'MiTran Global 2 spent ₹16,102 between 10 and 28 Oct 2026, during the weeks the weekly reports say no ads ran. Those reports cover only the main account, so this spend appears only in the daily data and the dashboard.'],
  ['Monthly spend and how it is calculated', 'Weeks run Monday to Sunday and do not line up with months. Monthly and date-range figures are added up from real daily spend, so they are exact. Only spend after the daily data ends, from accounts other than the main one, would be split by days and marked estimated. The dashboard monthly chart is exact only for Sep and Oct 2026; its other months were read from a report chart and are approximate, so prefer the daily figures.'],
  ['Daily data coverage', 'Daily spend is available for every account from January 2024 to 5 November 2026. After that, the main account gets daily rows from each new weekly report.'],
  ['Spend invoice report', 'The invoice report sums Meta amount spent for a period and account, listing each week as a line. It is an internal summary, not a tax invoice. It holds no GST from Meta billing data. GST is shown only when asked for, labelled as an estimate. Official invoices are in Meta Business Settings under billing.'],
  ['Data gaps', 'Not available: revenue or ROAS, GST and billing records, ad-set level data, demographics, placements, and any platform other than Meta.'],
];

export const LOCATIONS = [
  { id: 'kpi_spend', page: '/meta', tab: 'p1', el: 'k1', title: 'Total spend KPI', where: 'Overview tab, top-left tile' },
  { id: 'kpi_impressions', page: '/meta', tab: 'p1', el: 'k2', title: 'Impressions and CTR KPI', where: 'Overview tab, top row' },
  { id: 'kpi_clicks', page: '/meta', tab: 'p1', el: 'k3', title: 'Link clicks and page views KPI', where: 'Overview tab, top row' },
  { id: 'kpi_purchases', page: '/meta', tab: 'p1', el: 'k4', title: 'Purchases KPI', where: 'Overview tab, top row' },
  { id: 'kpi_leads', page: '/meta', tab: 'p1', el: 'k5', title: 'Leads KPI', where: 'Overview tab, top row' },
  { id: 'spend_over_time', page: '/meta', tab: 'p1', el: 'cMon', title: 'Spending over time chart', where: 'Overview tab, large chart' },
  { id: 'key_insights', page: '/meta', tab: 'p1', el: 'ins1', title: 'Key insights', where: 'Overview tab, right of the spend chart' },
  { id: 'spend_by_account', page: '/meta', tab: 'p1', el: 'cAcc', title: 'Spend by account chart', where: 'Overview tab, middle row' },
  { id: 'sales_vs_leads', page: '/meta', tab: 'p1', el: 'cGoal', title: 'Sales vs lead campaigns chart', where: 'Overview tab, middle row' },
  { id: 'account_efficiency', page: '/meta', tab: 'p1', el: 'cEff', title: 'Account efficiency chart (CPM vs CTR)', where: 'Overview tab, middle row' },
  { id: 'accounts_table', page: '/meta', tab: 'p1', el: 'tAcc', title: 'Reach and outreach by account table', where: 'Overview tab, bottom' },
  { id: 'campaign_filters', page: '/meta', tab: 'p2', el: 'fAcc', title: 'Campaign filters (account, goal, status)', where: 'Campaign explorer tab, top' },
  { id: 'untracked_spend', page: '/meta', tab: 'p2', el: 'f4', title: 'Spend with no tracked result', where: 'Campaign explorer tab, top row' },
  { id: 'cost_per_result_chart', page: '/meta', tab: 'p2', el: 'cCpr', title: 'Cost per result by campaign chart', where: 'Campaign explorer tab, left chart' },
  { id: 'spend_vs_results', page: '/meta', tab: 'p2', el: 'cSc', title: 'Spend vs results chart', where: 'Campaign explorer tab, right chart' },
  { id: 'campaigns_table', page: '/meta', tab: 'p2', el: 'tCamp', title: 'Top campaigns by spend table', where: 'Campaign explorer tab, bottom' },
  { id: 'descriptive_stats', page: '/meta', tab: 'p3', el: 'tDesc', title: 'Descriptive statistics table', where: 'EDA & Statistics tab, top' },
  { id: 'pareto', page: '/meta', tab: 'p3', el: 'cPar', title: 'Pareto chart', where: 'EDA & Statistics tab, left chart' },
  { id: 'cost_distribution', page: '/meta', tab: 'p3', el: 'cHist', title: 'Cost per result distribution', where: 'EDA & Statistics tab, right chart' },
  { id: 'correlation', page: '/meta', tab: 'p3', el: 'corr', title: 'Correlation matrix', where: 'EDA & Statistics tab, lower left' },
  { id: 'outliers', page: '/meta', tab: 'p3', el: 'outl', title: 'Outliers (IQR rule)', where: 'EDA & Statistics tab, lower middle' },
  { id: 'eda_findings', page: '/meta', tab: 'p3', el: 'ins3', title: 'EDA findings', where: 'EDA & Statistics tab, lower right' },
  { id: 'creatives', page: '/meta', tab: 'p4', el: 'cCre', title: 'Creative performance chart', where: 'Creatives & Audiences tab, left chart' },
  { id: 'video_vs_image', page: '/meta', tab: 'p4', el: 'cFmt', title: 'Video vs image chart', where: 'Creatives & Audiences tab, right chart' },
  { id: 'audiences', page: '/meta', tab: 'p4', el: 'tAud', title: 'Audiences table', where: 'Creatives & Audiences tab, bottom left' },
  { id: 'recommendations', page: '/meta', tab: 'p4', el: 'rec', title: 'Recommendations', where: 'Creatives & Audiences tab, bottom right' },
];

const chunk = (group) => ([title, text]) => ({ id: `${group}:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, title, text });

/** Fixed knowledge plus text from the live data: report narratives and dashboard insights. */
export function buildChunks(data) {
  const fixed = [...glossary.map(chunk('term')), ...statistics.map(chunk('stat')), ...dataModel.map(chunk('model'))];
  const map = LOCATIONS.map((l) => ({ id: `where:${l.id}`, title: `Where to find: ${l.title}`, text: `${l.title} is on the ${l.page === '/meta' ? 'Meta Ads dashboard' : 'weekly reports page'}: ${l.where}. Location id: ${l.id}.` }));
  const weekly = data.narratives.filter((n) => n.headline).map((n) => ({
    id: `report:${n.report_date}`,
    title: `Weekly report ${n.report_date} (${n.week_start} to ${n.week_end}), ${n.account_name}`,
    text: [n.headline, ...n.tips.map((t) => `${t.title}: ${t.text}`), ...n.actions.map((a) => `Action: ${a}`)].join(' '),
  }));
  const insights = data.insights.map((i, n) => ({ id: `insight:${n}`, title: `Dashboard insight: ${i.title}`, text: `${i.title}: ${i.text}` }));
  return [...fixed, ...map, ...weekly, ...insights];
}
