// Vercel function: POST /api/mitran-chat
// Same assistant as netlify/functions/mitran-chat.mjs, running on Vercel. It also serves the copy of the
// dashboard on GitHub Pages (static hosting cannot run a backend), so it allows that site through CORS.
// Needs the ANTHROPIC_API_KEY environment variable in the Vercel project (Production and Preview).

import Anthropic from '@anthropic-ai/sdk';
import { loadData } from '../netlify/lib/mitran/data.mjs';
import { createToolbox } from '../netlify/lib/mitran/tools.mjs';
import { runAgent, sanitizeConversation } from '../netlify/lib/mitran/agent.mjs';

const DATA_TTL_MS = 10 * 60 * 1000; // New Monday reports appear within 10 minutes.
const DEADLINE_MS = 55 * 1000;
const MAX_BODY_CHARS = 60000;
const DEFAULT_MODEL = 'claude-opus-5-5';
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']);
const DEFAULT_DAILY_LIMIT = 200; // Questions per day. Override with MITRAN_DAILY_LIMIT.
const PER_IP_PER_MINUTE = 10;

// The production site that holds the data files, and the sites allowed to call this endpoint.
const PRIMARY_ORIGIN = 'https://weekly-report-henna.vercel.app';
const ALLOWED_HOSTS = new Set(['weekly-report-henna.vercel.app', 'mitranglobal.github.io']);

// Best-effort counters. They live in memory, so they reset when the function restarts and are not shared
// between instances. They stop runaway use; they are not an exact meter.
let cache = { at: 0, promise: null, key: '' };
const usage = { day: '', count: 0 };
const ipHits = new Map();

function claimDailySlot() {
  const limit = Number(process.env.MITRAN_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  if (usage.day !== day) { usage.day = day; usage.count = 0; }
  if (usage.count >= limit) return { allowed: false, limit };
  usage.count += 1;
  return { allowed: true, limit };
}

function underIpLimit(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 60000);
  if (hits.length >= PER_IP_PER_MINUTE) { ipHits.set(ip, hits); return false; }
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > 5000) for (const [k, v] of ipHits) if (!v.some((t) => now - t < 60000)) ipHits.delete(k);
  return true;
}

function getData(siteUrl) {
  if (cache.promise && cache.key === siteUrl && Date.now() - cache.at < DATA_TTL_MS) return cache.promise;
  const fetchText = async (path) => {
    const target = path === '/meta' ? '/meta.html' : path; // The page is a static file on Vercel.
    const res = await fetch(new URL(target, siteUrl));
    if (!res.ok) throw new Error(`Could not read ${target}: HTTP ${res.status}`);
    return res.text();
  };
  const promise = loadData(fetchText).catch((err) => {
    cache = { at: 0, promise: null, key: '' };
    throw err;
  });
  cache = { at: Date.now(), promise, key: siteUrl };
  return promise;
}

function corsHeaders(origin) {
  let host = '';
  try { host = new URL(origin).host; } catch { /* no origin */ }
  if (!origin || !(ALLOWED_HOSTS.has(host) || host.endsWith('.vercel.app'))) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

export default {
  async fetch(req) {
    const origin = req.headers.get('origin');
    const cors = corsHeaders(origin);
    const json = (status, body) => Response.json(body, { status, headers: cors });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json(405, { error: 'Use POST.' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json(503, { error: 'The assistant is not set up yet: ANTHROPIC_API_KEY is missing.' });

    if (origin && !cors['access-control-allow-origin']) return json(403, { error: 'This assistant only answers from its own site.' });

    const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    if (!underIpLimit(ip)) return json(429, { error: 'Too many questions at once. Please wait a minute.' });

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_CHARS) return json(413, { error: 'That conversation is too long. Start a new chat.' });
    let body;
    try { body = JSON.parse(rawBody); } catch { return json(400, { error: 'Invalid request.' }); }
    const messages = sanitizeConversation(body);
    if (!messages) return json(400, { error: 'Please type a question.' });

    const slot = claimDailySlot();
    if (!slot.allowed) return json(429, { error: `MiTran has answered its ${slot.limit} questions for today. Please try again tomorrow.` });

    // Always read the data from the production site, whichever site the visitor is on.
    const dataUrl = process.env.MITRAN_DATA_URL || PRIMARY_ORIGIN;
    const model = process.env.MITRAN_MODEL || DEFAULT_MODEL;
    const client = new Anthropic({ apiKey, maxRetries: 1 });
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        const deadline = AbortSignal.timeout(DEADLINE_MS);
        try {
          emit({ type: 'status', tool: 'loading' });
          const data = await getData(dataUrl);
          const today = new Date().toISOString().slice(0, 10);
          const usesFallback = FALLBACK_MODELS.has(model);
          const used = await runAgent({
            messages,
            emit,
            signal: deadline,
            runTool: createToolbox(data, today),
            isApiError: (err) => err instanceof Anthropic.APIError,
            volatileContext: `Today is ${today}. Data runs from ${data.earliestWeek} to ${data.dailyThrough || data.latestWeek}. Latest weekly report: ${data.latestReport}. The user is on page: ${String(body.page ?? '/').slice(0, 80)}.`,
            requestDefaults: {
              model,
              max_tokens: 4096,
              output_config: { effort: 'medium' },
              ...(usesFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
            },
            createStream: (params, signal) => (params.betas ? client.beta.messages.stream(params, { signal }) : client.messages.stream(params, { signal })),
          });
          console.log('mitran-chat usage', JSON.stringify({ model, ...used }));
          emit({ type: 'done' });
        } catch (err) {
          console.error('mitran-chat error', err);
          let message = 'Something went wrong. Please try again.';
          if (deadline.aborted) message = 'That took too long. Try a narrower question.';
          else if (err instanceof Anthropic.RateLimitError) message = 'The assistant is busy right now. Please try again in a minute.';
          else if (err instanceof Anthropic.AuthenticationError) message = 'The assistant is not set up correctly: the API key was rejected.';
          emit({ type: 'error', message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...cors, 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  },
};
