// Netlify function: POST /api/mitran-chat
// Receives the conversation and streams the answer back as newline-delimited JSON.

import Anthropic from '@anthropic-ai/sdk';
import { loadData } from '../lib/mitran/data.mjs';
import { createToolbox } from '../lib/mitran/tools.mjs';
import { runAgent, sanitizeConversation } from '../lib/mitran/agent.mjs';

const DATA_TTL_MS = 10 * 60 * 1000; // New Monday reports appear within 10 minutes.
const DEADLINE_MS = 55 * 1000; // Netlify stops streaming functions at 60 seconds.
const MAX_BODY_CHARS = 60000;
const DEFAULT_MODEL = 'claude-opus-5-5';
// Models that accept the "fallbacks" setting on the Claude API.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']);

let cache = { at: 0, promise: null };

function getData(siteUrl) {
  if (cache.promise && Date.now() - cache.at < DATA_TTL_MS) return cache.promise;
  const fetchText = async (path) => {
    const res = await fetch(new URL(path, siteUrl));
    if (!res.ok) throw new Error(`Could not read ${path}: HTTP ${res.status}`);
    return res.text();
  };
  const promise = loadData(fetchText).catch((err) => {
    cache = { at: 0, promise: null }; // A failed load must not stay cached.
    throw err;
  });
  cache = { at: Date.now(), promise };
  return promise;
}

const json = (status, body) => Response.json(body, { status });

export default async (req, context) => {
  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(503, { error: 'The assistant is not set up yet: ANTHROPIC_API_KEY is missing.' });

  const siteUrl = context.site?.url || new URL(req.url).origin;
  const origin = req.headers.get('origin');
  if (origin) {
    const allowed = [new URL(siteUrl).host, new URL(req.url).host];
    let host = '';
    try { host = new URL(origin).host; } catch { /* treated as not allowed below */ }
    if (!allowed.includes(host)) return json(403, { error: 'This assistant only answers from its own site.' });
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_CHARS) return json(413, { error: 'That conversation is too long. Start a new chat.' });
  let body;
  try { body = JSON.parse(rawBody); } catch { return json(400, { error: 'Invalid request.' }); }
  const messages = sanitizeConversation(body);
  if (!messages) return json(400, { error: 'Please type a question.' });

  const model = Netlify.env.get('MITRAN_MODEL') || DEFAULT_MODEL;
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const deadline = AbortSignal.timeout(DEADLINE_MS);
      try {
        emit({ type: 'status', tool: 'loading' });
        const data = await getData(siteUrl);
        const today = new Date().toISOString().slice(0, 10);
        const usesFallback = FALLBACK_MODELS.has(model);
        const usage = await runAgent({
          messages,
          emit,
          signal: deadline,
          runTool: createToolbox(data, today),
          isApiError: (err) => err instanceof Anthropic.APIError,
          volatileContext: `Today is ${today}. Weeks with data run from ${data.earliestWeek} to ${data.latestWeek}. Latest weekly report: ${data.latestReport}. The user is on page: ${String(body.page ?? '/').slice(0, 80)}.`,
          requestDefaults: {
            model,
            max_tokens: 4096, // A deliberate cost ceiling for a public endpoint.
            output_config: { effort: 'medium' },
            ...(usesFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
          },
          createStream: (params, signal) => (params.betas ? client.beta.messages.stream(params, { signal }) : client.messages.stream(params, { signal })),
        });
        console.log('mitran-chat usage', JSON.stringify({ model, ...usage }));
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

  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
};

export const config = {
  path: '/api/mitran-chat',
  method: 'POST',
  // Limits each visitor to 10 questions a minute, because every question costs API credit.
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 10 },
};
