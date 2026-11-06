// The tools Claude can call, and the code that runs them.
// Files go straight to the browser. Claude sees only a summary, so it never retypes a figure.

import { buildCsvReport, buildInvoice, computeStatistics, DATASET_NAMES, isIsoDate, queryData } from './reports.mjs';
import { buildChunks, LOCATIONS } from './knowledge.mjs';
import { buildIndex, search } from './retrieval.mjs';

const MAX_ROWS_TO_MODEL = 40;

const periodProps = {
  start_date: { type: 'string', description: 'First day, YYYY-MM-DD. Omit with end_date for all time.' },
  end_date: { type: 'string', description: 'Last day, YYYY-MM-DD. For a month, use its first and last day.' },
  account: { type: 'string', description: 'Ad account name, ID or nickname (main, older, mitranad, global 2). Omit for all accounts.' },
};
const dataProps = {
  dataset: { type: 'string', enum: DATASET_NAMES, description: 'Dated (accept start_date/end_date): monthly = spend per calendar month per account, exact; daily = spend per day per account, Jan 2024 onward; weekly = one row per report week; campaigns_weekly = campaign rows per week. Lifetime only (no dates allowed): accounts = lifetime totals per account; campaigns_lifetime = the 25 listed campaigns; creatives = top 10 ads; audiences. For "spend in <month> by account" use monthly.' },
  ...periodProps,
  campaign: { type: 'string', description: 'Only campaigns whose name contains this text.' },
  goal: { type: 'string', enum: ['Sales', 'Leads'], description: 'campaigns_lifetime only.' },
  status: { type: 'string', description: 'Campaign status: Active or Paused.' },
};

export const TOOL_DEFS = [
  {
    name: 'search_knowledge',
    description: 'Searches definitions, formulas, statistics methods, the data model, dashboard layout, weekly report commentary and dashboard insights. Use it before explaining a term, method or data source. Holds no authoritative totals.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search words, e.g. "CPM formula" or "IQR outlier".' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'query_ad_data',
    description: 'Returns ad data for answering in chat: rows (capped), totals and coverage notes. Use for every figure you state about spend, results, campaigns, accounts, creatives or audiences.',
    input_schema: { type: 'object', properties: dataProps, required: ['dataset'], additionalProperties: false },
  },
  {
    name: 'create_csv_report',
    description: 'Builds a downloadable CSV for a date, month, range or ad account. The file appears in the chat automatically with every row; never paste rows into your reply.',
    input_schema: { type: 'object', properties: dataProps, required: ['dataset'], additionalProperties: false },
  },
  {
    name: 'create_spend_invoice',
    description: 'Builds the ad spend invoice report for a period and account: a printable page and a CSV, listing spend week by week with totals. The files appear in the chat automatically. It is an internal summary, not a tax invoice. Pass gst_percent only when the user asks for GST.',
    input_schema: { type: 'object', properties: { ...periodProps, gst_percent: { type: 'number', description: 'GST rate to add as a labelled estimate. Only when the user asks.' } }, additionalProperties: false },
  },
  {
    name: 'get_statistics',
    description: 'Calculates the EDA & Statistics tab: descriptive statistics, correlation matrix, IQR outliers, Pareto concentration, and video vs image medians, using the dashboard formulas.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'point_to_data',
    description: 'Shows the user where something is. Pass location_id for a dashboard tile, or report_date for a weekly report. A button that opens and highlights it appears in the chat automatically.',
    input_schema: { type: 'object', properties: { location_id: { type: 'string', enum: LOCATIONS.map((l) => l.id) }, report_date: { type: 'string', description: 'Monday report date, YYYY-MM-DD.' } }, additionalProperties: false },
  },
].map((t) => ({ ...t, eager_input_streaming: true }));

/**
 * Small schema check. With eager input streaming the API does not validate tool input,
 * so a truncated or wrong input must be caught here before a tool runs.
 */
export function validateInput(name, input) {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return `Unknown tool ${name}`;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return 'Input must be an object';
  const { properties, required = [] } = def.input_schema;
  for (const key of required) if (input[key] === undefined) return `Missing required field: ${key}`;
  for (const [key, value] of Object.entries(input)) {
    const prop = properties[key];
    if (!prop) return `Unknown field: ${key}`;
    if (typeof value !== prop.type) return `Field ${key} must be a ${prop.type}`;
    if (prop.enum && !prop.enum.includes(value)) return `Field ${key} must be one of: ${prop.enum.join(', ')}`;
  }
  return null;
}

/** Binds the tools to one loaded data snapshot. */
export function createToolbox(data, today) {
  const index = buildIndex(buildChunks(data));
  const handlers = {
    search_knowledge: ({ query }) => ({ results: search(index, query, 5) }),

    query_ad_data: (input) => {
      const r = queryData(data, input);
      const truncated = r.rows.length > MAX_ROWS_TO_MODEL;
      return { ...r, row_count: r.rows.length, rows: r.rows.slice(0, MAX_ROWS_TO_MODEL), rows_truncated: truncated, ...(truncated ? { hint: 'Only the first rows are shown. Totals cover all rows. Offer a CSV for the full list.' } : {}) };
    },

    create_csv_report: (input) => {
      const { summary, attachment } = buildCsvReport(data, input);
      if (!attachment) return { result: { ...summary, delivered: false, message: 'No rows match, so no file was created.' } };
      return { result: { ...summary, delivered: true, filename: attachment.filename }, events: [{ type: 'attachment', ...attachment }] };
    },

    create_spend_invoice: (input) => {
      const { summary, attachments } = buildInvoice(data, input, today);
      return { result: { ...summary, delivered: true, files: attachments.map((a) => a.filename) }, events: attachments.map((a) => ({ type: 'attachment', ...a })) };
    },

    get_statistics: () => computeStatistics(data),

    point_to_data: ({ location_id, report_date }) => {
      if (report_date) {
        if (!isIsoDate(report_date)) throw new Error('report_date must be YYYY-MM-DD.');
        const known = data.narratives.some((n) => n.report_date === report_date);
        if (!known) {
          const nearest = data.narratives.map((n) => n.report_date).sort((a, b) => Math.abs(Date.parse(a) - Date.parse(report_date)) - Math.abs(Date.parse(b) - Date.parse(report_date)))[0];
          throw new Error(`No report is dated ${report_date}. Weeks with no ads have no report. The nearest report is ${nearest}.`);
        }
        const url = `/weekly#${report_date}`;
        return { result: { url, where: `Weekly reports page, report of ${report_date}` }, events: [{ type: 'point', url, label: `Open report of ${report_date}` }] };
      }
      const loc = LOCATIONS.find((l) => l.id === location_id);
      if (!loc) throw new Error('Pass a location_id or a report_date.');
      const url = `${loc.page}#mitran=${loc.tab}:${loc.el}`;
      return { result: { url, title: loc.title, where: loc.where }, events: [{ type: 'point', url, label: `Show ${loc.title}` }] };
    },
  };

  /** Runs one tool. Returns the content for Claude, the browser events, and any error flag. */
  return function runTool(name, input) {
    const problem = validateInput(name, input);
    if (problem) return { content: JSON.stringify({ INVALID_INPUT: problem }), isError: true, events: [] };
    try {
      const out = handlers[name](input);
      const hasEnvelope = out && typeof out === 'object' && 'result' in out;
      return { content: JSON.stringify(hasEnvelope ? out.result : out), isError: false, events: (hasEnvelope && out.events) || [] };
    } catch (err) {
      return { content: JSON.stringify({ error: err.message }), isError: true, events: [] };
    }
  };
}
