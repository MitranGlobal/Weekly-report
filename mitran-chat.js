// MiTran chat widget. Add one line to any page:
//   <script src="/mitran-chat.js" defer></script>
// It lives in a shadow DOM, so its styles cannot clash with the dashboard's, or the other way round.
(function () {
  'use strict';
  if (window.__mitranChatLoaded) return;
  window.__mitranChatLoaded = true;

  var ENDPOINT = '/api/mitran-chat';
  var STORE_KEY = 'mitran-chat-v1';
  var MAX_STORED_CHARS = 1500000;

  var SUGGESTIONS = [
    'How much did we spend per ad account?',
    'Download a CSV of October 2026 spend',
    'Create an ad spend invoice report for 2026',
    'What does CPM mean, and where do I see it?',
  ];
  var STATUS_TEXT = {
    loading: 'Reading the latest reports…',
    search_knowledge: 'Looking that up…',
    query_ad_data: 'Checking the data…',
    create_csv_report: 'Building your CSV…',
    create_spend_invoice: 'Building your invoice report…',
    get_statistics: 'Running the statistics…',
    point_to_data: 'Finding it on the dashboard…',
  };

  var CSS = '\
:host{all:initial}\
*{box-sizing:border-box}\
.launcher,.panel{font-family:"Segoe UI",Segoe,-apple-system,Roboto,Arial,sans-serif;color:#252423;font-size:14px;line-height:1.45}\
.launcher{position:fixed;right:20px;bottom:52px;z-index:2147483000;display:flex;align-items:center;gap:8px;height:46px;padding:0 16px 0 7px;border:0;border-radius:23px;background:#252423;color:#fff;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.28)}\
.launcher:hover{background:#3B3A39}\
.mark{width:32px;height:32px;border-radius:50%;flex:none;background:linear-gradient(135deg,#F2C811,#E8A90E);display:grid;place-items:center;font-weight:800;color:#252423;font-size:14px}\
.panel{position:fixed;right:20px;bottom:52px;z-index:2147483000;width:min(440px,calc(100vw - 32px));height:min(680px,calc(100vh - 76px));display:flex;flex-direction:column;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 10px 36px rgba(0,0,0,.32)}\
.panel[hidden],.launcher[hidden]{display:none}\
.head{display:flex;align-items:center;gap:10px;padding:11px 12px;background:#252423;color:#fff;flex:none}\
.head .t{flex:1;min-width:0}\
.head b{display:block;font-size:15px;font-weight:600}\
.head small{display:block;color:#C8C6C4;font-size:12px}\
.icon{all:unset;box-sizing:border-box;cursor:pointer;width:32px;height:32px;display:grid;place-items:center;border-radius:4px;color:#C8C6C4;font:400 13px "Segoe UI",Roboto,Arial,sans-serif}\
.icon:hover{background:#3B3A39;color:#fff}\
.icon svg{width:17px;height:17px}\
.log{flex:1;min-height:0;overflow-y:auto;padding:14px 12px;background:#F3F2F1;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}\
.msg{max-width:92%;padding:9px 12px;border-radius:8px;overflow-wrap:anywhere}\
.user{align-self:flex-end;background:#252423;color:#fff;white-space:pre-wrap}\
.bot{align-self:flex-start;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.1)}\
.bot p{margin:0 0 8px}.bot p:last-child{margin-bottom:0}\
.bot ul,.bot ol{margin:0 0 8px;padding-left:20px}.bot li{margin-bottom:3px}\
.bot a{color:#0B6CC7}\
.bot code{background:#F3F2F1;padding:0 4px;border-radius:3px;font-size:12.5px}\
.bot h4{margin:0 0 6px;font-size:14px;font-weight:600}\
.tw{overflow-x:auto;margin:0 0 8px}\
.tw:last-child{margin-bottom:0}\
table{border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums;width:100%}\
th{text-align:left;font-weight:600;padding:4px 7px;border-bottom:2px solid #252423;white-space:nowrap}\
td{padding:4px 7px;border-bottom:1px solid #E1DFDD}\
.err{align-self:flex-start;background:#FDE7E9;border-left:4px solid #C4314B;padding:9px 12px;border-radius:4px;max-width:92%}\
.status{align-self:flex-start;color:#605E5C;font-size:13px;padding:0 4px;display:flex;align-items:center;gap:8px}\
.dot{width:8px;height:8px;border-radius:50%;background:#118DFF;animation:p 1s infinite ease-in-out}\
@keyframes p{50%{opacity:.25}}\
.file{align-self:flex-start;width:min(100%,340px);background:#fff;border-radius:8px;border-left:4px solid #1AAB40;padding:9px 12px;box-shadow:0 1px 2px rgba(0,0,0,.1)}\
.file.inv{border-left-color:#E66C37}\
.file .n{font-weight:600;font-size:13px;overflow-wrap:anywhere}\
.file .m{color:#605E5C;font-size:12px;margin:1px 0 8px}\
.acts{display:flex;gap:6px;flex-wrap:wrap}\
.btn{font:inherit;font-size:13px;font-weight:600;border:1px solid #252423;background:#252423;color:#fff;padding:5px 11px;border-radius:3px;cursor:pointer;min-height:32px}\
.btn:hover{background:#3B3A39}\
.btn.ghost{background:#fff;color:#252423}\
.btn.ghost:hover{background:#F3F2F1}\
.point{align-self:flex-start;background:#fff;color:#0B6CC7;border:1px solid #0B6CC7}\
.point:hover{background:#E8F3FF}\
.intro{padding:2px 4px 4px;color:#3B3A39}\
.intro b{font-weight:600;font-size:15px;display:block;margin-bottom:3px;color:#252423}\
.chips{display:flex;flex-direction:column;gap:6px;align-items:stretch}\
.chip{font:inherit;font-size:13px;text-align:left;background:#fff;border:1px solid #E1DFDD;border-radius:6px;padding:8px 11px;cursor:pointer;color:#252423}\
.chip:hover{border-color:#118DFF;background:#F5FAFF}\
form{display:flex;gap:8px;padding:10px 12px 6px;border-top:1px solid #E1DFDD;background:#fff;flex:none}\
textarea{flex:1;min-width:0;resize:none;font:inherit;font-size:14px;color:#252423;background:#fff;border:1px solid #8A8886;border-radius:4px;padding:7px 9px;height:38px;max-height:110px}\
.send{flex:none;width:38px;height:38px;border:0;border-radius:4px;background:#118DFF;color:#fff;cursor:pointer;display:grid;place-items:center}\
.send svg{width:18px;height:18px}\
.send:hover{background:#0B6CC7}\
.send:disabled{background:#C8C6C4;cursor:default}\
.fine{padding:0 12px 8px;background:#fff;color:#605E5C;font-size:11px;flex:none}\
button:focus-visible,textarea:focus-visible,a:focus-visible{outline:2px solid #118DFF;outline-offset:1px}\
@media (max-width:560px){.panel{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0}.launcher{right:16px;bottom:48px}}\
@media (prefers-reduced-motion:reduce){.dot{animation:none}}';

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  // ---------- safe markdown: escape everything first, then add a small allowed set ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function safeHref(url) {
    if (/^\/(?!\/)/.test(url)) return url;
    if (/^https:\/\//i.test(url)) return url;
    return null;
  }
  function inline(text) {
    var codes = [];
    var s = esc(text).replace(/`([^`\n]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (all, label, url) {
      var href = safeHref(url.replace(/&amp;/g, '&'));
      if (!href) return label;
      var ext = /^https:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return '<a href="' + esc(href) + '"' + ext + '>' + label + '</a>';
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
  }
  function cells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
  }
  function renderMarkdown(md) {
    var lines = String(md).split(/\r?\n/);
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') > -1) {
        var head = cells(line);
        i += 2;
        var body = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { body.push(cells(lines[i])); i++; }
        out.push('<div class="tw"><table><thead><tr>' + head.map(function (h) { return '<th>' + inline(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          body.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      var h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h) { out.push('<h4>' + inline(h[1]) + '</h4>'); i++; continue; }
      if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
        var ordered = /^\s*\d+[.)]\s+/.test(line);
        var items = [];
        while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
          items.push('<li>' + inline(lines[i].replace(/^\s*(?:[-*]|\d+[.)])\s+/, '')) + '</li>');
          i++;
        }
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
        continue;
      }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) { para.push(inline(lines[i])); i++; }
      if (para.length) out.push('<p>' + para.join('<br>') + '</p>');
      else { out.push('<p>' + inline(lines[i]) + '</p>'); i++; }
    }
    return out.join('');
  }

  // ---------- pointing at data: /meta#mitran=p3:tDesc opens the tab and highlights the tile ----------
  function highlightFromHash() {
    var m = /^#mitran=(p\d):([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m) return;
    var tab = document.querySelector('.tab[data-p="' + m[1] + '"]');
    if (tab) tab.click();
    var target = document.getElementById(m[2]);
    if (!target) return;
    var tile = target.closest('.tile') || target;
    setTimeout(function () {
      // Charts built while their tab was hidden have no size until they are told to resize.
      var page = document.getElementById(m[1]);
      if (page && window.Chart && window.Chart.getChart) {
        page.querySelectorAll('canvas').forEach(function (c) {
          var chart = window.Chart.getChart(c);
          if (chart) chart.resize();
        });
      }
      var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      tile.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
      var before = { outline: tile.style.outline, offset: tile.style.outlineOffset };
      tile.style.outline = '3px solid #F2C811';
      tile.style.outlineOffset = '2px';
      setTimeout(function () { tile.style.outline = before.outline; tile.style.outlineOffset = before.offset; }, 3500);
    }, 150);
  }
  function goTo(url) {
    var dest = new URL(url, location.href);
    if (dest.origin !== location.origin) return;
    var samePage = dest.pathname.replace(/\.html$/, '') === location.pathname.replace(/\.html$/, '');
    location.href = dest.pathname + dest.hash;
    if (samePage) highlightFromHash();
  }

  // ---------- state ----------
  var state = { open: false, items: [] }; // items: {kind:'user'|'bot'|'error'|'file'|'point', ...}
  function load() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
      if (saved && Array.isArray(saved.items)) state = { open: !!saved.open, items: saved.items };
    } catch (e) { /* storage blocked: start fresh */ }
  }
  function save() {
    try {
      var text = JSON.stringify(state);
      if (text.length > MAX_STORED_CHARS) {
        // Keep the conversation and drop the largest stored files.
        text = JSON.stringify({ open: state.open, items: state.items.filter(function (it) { return it.kind !== 'file'; }) });
      }
      sessionStorage.setItem(STORE_KEY, text);
    } catch (e) { /* storage full or blocked: the chat still works */ }
  }

  // ---------- build the UI ----------
  var host = document.createElement('div');
  host.id = 'mitran-chat';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' + CSS + '</style>' +
    '<button class="launcher" type="button" aria-haspopup="dialog"><span class="mark" aria-hidden="true">M</span>Ask MiTran</button>' +
    '<section class="panel" role="dialog" aria-label="MiTran chat" hidden>' +
      '<div class="head"><span class="mark" aria-hidden="true">M</span><div class="t"><b>MiTran</b><small>Ask about your ad data</small></div>' +
        '<button class="icon new" type="button" title="Start a new chat" aria-label="Start a new chat">New</button>' +
        '<button class="icon close" type="button" title="Close" aria-label="Close chat">' + ICON_CLOSE + '</button></div>' +
      '<div class="log" role="log" aria-live="polite" tabindex="0"></div>' +
      '<form><textarea rows="1" maxlength="2000" placeholder="Ask about spend, campaigns or terms…" aria-label="Your question"></textarea>' +
        '<button class="send" type="submit" aria-label="Send">' + ICON_CHAT + '</button></form>' +
      '<div class="fine">Figures come from the report data. MiTran can make mistakes, so check anything important.</div>' +
    '</section>';

  var launcher = root.querySelector('.launcher');
  var panel = root.querySelector('.panel');
  var log = root.querySelector('.log');
  var form = root.querySelector('form');
  var input = root.querySelector('textarea');
  var sendBtn = root.querySelector('.send');
  var busy = false;
  var statusEl = null;

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function blobUrl(file) { return URL.createObjectURL(new Blob([file.content], { type: file.mime })); }
  function download(file) {
    var a = document.createElement('a');
    a.href = blobUrl(file);
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
  }

  function fileCard(file) {
    var card = document.createElement('div');
    var isInvoice = file.kind === 'invoice';
    card.className = 'file' + (isInvoice ? ' inv' : '');
    var name = document.createElement('div');
    name.className = 'n';
    name.textContent = file.filename;
    var meta = document.createElement('div');
    meta.className = 'm';
    var size = Math.max(1, Math.round(file.content.length / 1024));
    meta.textContent = isInvoice ? 'Printable invoice report, ' + size + ' KB' : 'CSV, ' + (file.rows != null ? file.rows + ' rows, ' : '') + size + ' KB';
    var acts = document.createElement('div');
    acts.className = 'acts';
    if (isInvoice) {
      var view = document.createElement('button');
      view.type = 'button';
      view.className = 'btn';
      view.textContent = 'Open to print or save as PDF';
      view.addEventListener('click', function () {
        var url = blobUrl(file);
        if (!window.open(url, '_blank')) download(file);
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      });
      acts.appendChild(view);
    }
    var dl = document.createElement('button');
    dl.type = 'button';
    dl.className = isInvoice ? 'btn ghost' : 'btn';
    dl.textContent = isInvoice ? 'Download' : 'Download CSV';
    dl.addEventListener('click', function () { download(file); });
    acts.appendChild(dl);
    card.append(name, meta, acts);
    return card;
  }

  function renderItem(it) {
    var el;
    if (it.kind === 'user') { el = document.createElement('div'); el.className = 'msg user'; el.textContent = it.text; }
    else if (it.kind === 'bot') { el = document.createElement('div'); el.className = 'msg bot'; el.innerHTML = renderMarkdown(it.text); }
    else if (it.kind === 'error') { el = document.createElement('div'); el.className = 'err'; el.textContent = it.text; }
    else if (it.kind === 'file') { el = fileCard(it.file); }
    else if (it.kind === 'point') {
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'btn point';
      el.textContent = it.label;
      el.addEventListener('click', function () { goTo(it.url); });
    }
    return el;
  }

  function renderIntro() {
    var intro = document.createElement('div');
    intro.className = 'intro';
    intro.innerHTML = '<b>Hi, I\'m MiTran.</b>I can find figures, explain terms and methods, and build CSV or ad spend invoice reports.';
    log.appendChild(intro);
    var chips = document.createElement('div');
    chips.className = 'chips';
    SUGGESTIONS.forEach(function (q) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip';
      c.textContent = q;
      c.addEventListener('click', function () { ask(q); });
      chips.appendChild(c);
    });
    log.appendChild(chips);
  }

  function renderAll() {
    log.textContent = '';
    if (!state.items.length) renderIntro();
    state.items.forEach(function (it) { var el = renderItem(it); if (el) log.appendChild(el); });
    scrollDown();
  }

  function setStatus(tool) {
    clearStatus();
    statusEl = document.createElement('div');
    statusEl.className = 'status';
    var dot = document.createElement('span');
    dot.className = 'dot';
    statusEl.append(dot, document.createTextNode(STATUS_TEXT[tool] || 'Thinking…'));
    log.appendChild(statusEl);
    scrollDown();
  }
  function clearStatus() { if (statusEl) { statusEl.remove(); statusEl = null; } }

  function setOpen(open) {
    state.open = open;
    panel.hidden = !open;
    launcher.hidden = open;
    save();
    if (open) { renderAll(); input.focus(); } else { launcher.focus(); }
  }
  function setBusy(v) { busy = v; sendBtn.disabled = v; }

  function push(item) {
    state.items.push(item);
    var clearChips = log.querySelector('.intro');
    if (clearChips) { log.textContent = ''; }
    var el = renderItem(item);
    if (el) { if (statusEl) log.insertBefore(el, statusEl); else log.appendChild(el); }
    scrollDown();
    return el;
  }

  // Sends the visible conversation. Files and buttons stay in the browser, never in the request.
  function conversation() {
    return state.items
      .filter(function (it) { return it.kind === 'user' || it.kind === 'bot'; })
      .map(function (it) { return { role: it.kind === 'user' ? 'user' : 'assistant', content: it.text }; });
  }

  async function ask(question) {
    var text = String(question || '').trim();
    if (!text || busy) return;
    setBusy(true);
    push({ kind: 'user', text: text });
    input.value = '';
    input.style.height = '';
    setStatus('thinking');

    var current = null;
    var currentEl = null;
    function handle(ev) {
      if (ev.type === 'text') {
        if (!current) { current = { kind: 'bot', text: '' }; currentEl = push(current); }
        current.text += ev.text;
        currentEl.innerHTML = renderMarkdown(current.text);
        clearStatus();
        scrollDown();
      } else if (ev.type === 'status') {
        setStatus(ev.tool);
      } else if (ev.type === 'turn') {
        current = null;
        currentEl = null;
      } else if (ev.type === 'attachment') {
        push({ kind: 'file', file: { kind: ev.kind, filename: ev.filename, mime: ev.mime, content: ev.content, rows: ev.rows } });
      } else if (ev.type === 'point') {
        push({ kind: 'point', url: ev.url, label: ev.label });
      } else if (ev.type === 'error') {
        clearStatus();
        push({ kind: 'error', text: ev.message });
      }
    }

    try {
      var res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: conversation(), page: location.pathname }),
      });
      if (!res.ok) {
        var problem = res.status === 429 ? 'You are asking quickly. Please wait a minute and try again.' : 'The assistant is unavailable right now.';
        try { var j = await res.json(); if (j && j.error) problem = j.error; } catch (e) { /* use the default message */ }
        throw new Error(problem);
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      for (;;) {
        var part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        var nl;
        while ((nl = buffer.indexOf('\n')) > -1) {
          var line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) handle(JSON.parse(line));
        }
      }
    } catch (err) {
      clearStatus();
      push({ kind: 'error', text: (err && err.message && !/fetch|network|JSON/i.test(err.message)) ? err.message : 'Could not reach the assistant. Check your connection and try again.' });
    } finally {
      clearStatus();
      setBusy(false);
      save();
      input.focus();
    }
  }

  // ---------- wire up ----------
  launcher.addEventListener('click', function () { setOpen(true); });
  root.querySelector('.close').addEventListener('click', function () { setOpen(false); });
  root.querySelector('.new').addEventListener('click', function () { if (busy) return; state.items = []; save(); renderAll(); input.focus(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); }
    e.stopPropagation();
  });
  input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight + 2, 110) + 'px'; });
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  window.addEventListener('hashchange', highlightFromHash);

  function mount() {
    document.body.appendChild(host);
    load();
    panel.hidden = !state.open;
    launcher.hidden = state.open;
    if (state.open) renderAll();
    // Wait for the full page: clicking a dashboard tab before its charts finish setting up breaks them.
    if (document.readyState === 'complete') highlightFromHash();
    else window.addEventListener('load', highlightFromHash, { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
