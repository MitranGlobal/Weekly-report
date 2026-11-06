// The "R" in RAG for words: a small BM25 search over the glossary and report text.
// BM25 suits this corpus (a few hundred short passages full of exact terms like "CPM" and "IQR"),
// and it needs no embedding service or vector database.

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 3;
const STOP = new Set('a an and are as at be but by for from has have how i in is it its me my of on or our that the their them they this to was we what when where which who why will with you your do does did can could should would please tell show give about'.split(' '));

export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9₹%]+/g, ' ')
    .split(' ')
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

export function buildIndex(chunks) {
  const docs = chunks.map((c) => {
    const tokens = [...Array(TITLE_WEIGHT).fill(tokenize(c.title)).flat(), ...tokenize(c.text)];
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    return { chunk: c, tf, length: tokens.length };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avgLength = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
  return { docs, df, avgLength };
}

export function search(index, query, limit = 5) {
  const { docs, df, avgLength } = index;
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  return docs
    .map((d) => {
      let score = 0;
      for (const t of terms) {
        const f = d.tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / avgLength)));
      }
      return { chunk: d.chunk, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({ id: r.chunk.id, title: r.chunk.title, text: r.chunk.text, score: Math.round(r.score * 100) / 100 }));
}
