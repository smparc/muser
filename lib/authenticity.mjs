// GPTZero provenance: who actually wrote the words in a room.
// Muse messages are AI by design, so a detector on them is transparency, not a warning. What matters is the other
// direction: the profile a person writes about themselves is the room's ground truth about a human, and the master
// matches people on it. A profile that reads as AI-generated is worth surfacing to everyone in the room.
// The API is optional everywhere: without a key the feature is simply absent, and a failed check never blocks a save.
import {NOW, digest, one, all, stmt} from './http.mjs';

const ENDPOINT = 'https://api.gptzero.me/v2/predict/text';
const TIMEOUT_MS = 10000;
// Sentence-level detection needs something to work with; below this a verdict would be noise, so we say so instead.
export const MIN_CHARS = 120;
export const KINDS = ['profile', 'reply'];

export function gptzeroFrom(env, {fetchImpl = fetch} = {}) {
  const key = env?.GPTZERO_API_KEY;
  if (!key) return null;
  return {
    async classify(text) {
      const document = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (document.length < MIN_CHARS) return {classification: 'too_short', ai_probability: null, confidence: null};
      const r = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {'x-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({document}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // The upstream status separates a bad key (401) from a rate limit (429); both look identical otherwise.
      if (!r.ok) throw Error(`GPTZero answered HTTP ${r.status}`);
      const doc = (await r.json())?.documents?.[0] ?? {};
      const probabilities = doc.class_probabilities ?? {};
      const ai = doc.completely_generated_prob ?? probabilities.ai ?? probabilities.mixed;
      return {
        classification: doc.document_classification ?? 'UNKNOWN',
        ai_probability: Number.isFinite(ai) ? Math.round(Math.min(1, Math.max(0, ai)) * 100) : null,
        confidence: doc.confidence_category ?? null,
      };
    },
  };
}

const view = row => row && {classification: row.classification, ai_probability: row.ai_probability, confidence: row.confidence, checked_at: row.checked_at};

// Checks one piece of text and remembers the verdict. Unchanged text is never re-sent, so a room costs one call per
// new message and one per profile edit. A failure keeps whatever was known before rather than dropping the verdict.
export async function checkText(db, client, kind, refId, text) {
  if (!client || !KINDS.includes(kind)) return null;
  const hash = await digest(String(text ?? '').replace(/\s+/g, ' ').trim());
  const existing = await one(db, 'SELECT * FROM text_checks WHERE kind=? AND ref_id=?', kind, refId);
  if (existing?.text_hash === hash) return view(existing);
  let result;
  try { result = await client.classify(text); }
  catch (err) { console.error('GPTZero check failed', err?.message); return view(existing); }
  const n = NOW();
  await stmt(db, 'INSERT INTO text_checks (kind,ref_id,text_hash,classification,ai_probability,confidence,checked_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(kind,ref_id) DO UPDATE SET text_hash=excluded.text_hash,classification=excluded.classification,ai_probability=excluded.ai_probability,confidence=excluded.confidence,checked_at=excluded.checked_at',
    kind, refId, hash, result.classification, result.ai_probability, result.confidence, n).run();
  return {...result, checked_at: n};
}

// A reply is checked after it is stored, so a Muse never waits for GPTZero to answer.
export async function checkReply(db, client, responseId) {
  const r = await one(db, 'SELECT id,text FROM responses WHERE id=?', responseId);
  if (r) await checkText(db, client, 'reply', r.id, r.text);
}

// The longest passage the person actually wrote, as one continuous piece.
// Not a concatenation of the profile fields: gluing two unrelated fragments together produces a document no human
// would write, and the classifier reads that seam as machine text. Measured here, the same honest paragraph scores
// HUMAN_ONLY at 2% alone and AI_ONLY at 100% once a second field is appended, so we only ever send real prose.
export const profileText = p => [p.working_on, p.seeking].map(v => String(v ?? '').trim()).sort((a, b) => b.length - a.length)[0] ?? '';

export async function checksFor(db, kind, ids) {
  const list = [...new Set(ids)].filter(Boolean);
  if (!list.length) return new Map();
  const rows = await all(db, `SELECT * FROM text_checks WHERE kind=? AND ref_id IN (${list.map(() => '?').join(',')})`, kind, ...list);
  return new Map(rows.map(r => [r.ref_id, view(r)]));
}

// Built per request: the client plus a way to run a check after the response has gone out (real background work).
export const authenticityRuntime = (env, waitUntil) => ({
  client: gptzeroFrom(env),
  background(work) {
    if (!waitUntil) return; // Sites and local dev drop background work; the check simply does not happen there.
    waitUntil(Promise.resolve(work).catch(err => console.error('GPTZero background check failed', err?.message)));
  },
});
