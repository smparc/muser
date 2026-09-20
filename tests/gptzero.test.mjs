import test from 'node:test';import assert from 'node:assert/strict';
import {handle} from '../lib/api.mjs';
import {gptzeroFrom, checkText, checkReply, checksFor, profileText, MIN_CHARS} from '../lib/authenticity.mjs';
import {onboard, sqliteD1, origin} from './helpers.mjs';
// GPTZero provenance: a person's profile should read as human; Muse replies are AI by design and say so.
const h = sqliteD1();
const sam = {id: 'owner-sam', name: 'Sam'};
onboard(h.sql, [sam]);
async function req(path, method = 'GET', body, owner, token, runtime = {}) {
  const headers = new Headers({Origin: origin});
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', 'Bearer ' + token);
  const r = await handle(new Request(origin + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)}), h.db, owner ?? null, runtime);
  return {status: r.status, body: await r.json()};
}
const longProfile = {interests: ['climbing', 'typescript'], working_on: 'A route-finding app for boulderers, mostly evenings and weekends after work. '.repeat(3), seeking: 'Someone who has shipped an app store release before and can tell me what I am walking into.'};
// A stub GPTZero: records what it was asked and answers with whatever the test sets.
function stub(answer = {documents: [{document_classification: 'HUMAN_ONLY', completely_generated_prob: 0.04, confidence_category: 'high'}]}, status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({url, key: init.headers['x-api-key'], document: JSON.parse(init.body).document});
    return {ok: status < 400, status, json: async () => answer};
  };
  return {calls, client: gptzeroFrom({GPTZERO_API_KEY: 'test-key'}, {fetchImpl})};
}

test('no key means the feature is absent, not broken', async () => {
  assert.equal(gptzeroFrom({}), null);
  assert.equal(await checkText(h.db, null, 'profile', sam.id, 'anything'), null);
});

test('a classification is stored, and unchanged text is never sent twice', async () => {
  const {calls, client} = stub();
  const text = profileText(longProfile);
  const first = await checkText(h.db, client, 'profile', sam.id, text);
  assert.equal(first.classification, 'HUMAN_ONLY');
  assert.equal(first.ai_probability, 4);
  assert.equal(first.confidence, 'high');
  assert.equal(calls[0].url, 'https://api.gptzero.me/v2/predict/text');
  assert.equal(calls[0].key, 'test-key');
  const again = await checkText(h.db, client, 'profile', sam.id, text);
  assert.equal(calls.length, 1, 'the same text is not re-sent');
  assert.equal(again.classification, 'HUMAN_ONLY');
  // Edited text is checked again and replaces the verdict.
  const edited = stub({documents: [{document_classification: 'AI_ONLY', completely_generated_prob: 0.98, confidence_category: 'high'}]});
  const changed = await checkText(h.db, edited.client, 'profile', sam.id, text + ' Now rewritten by a model.');
  assert.equal(changed.classification, 'AI_ONLY');
  assert.equal(changed.ai_probability, 98);
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM text_checks WHERE kind='profile'").get().n, 1, 'one row per subject');
});

test('text too short for a verdict says so instead of guessing', async () => {
  const {calls, client} = stub();
  const r = await checkText(h.db, client, 'reply', 'reply-short', 'Sounds good.');
  assert.equal(r.classification, 'too_short');
  assert.equal(r.ai_probability, null);
  assert.equal(calls.length, 0, 'nothing is sent to GPTZero below ' + MIN_CHARS + ' characters');
});

test('an API failure keeps the previous verdict and never throws', async () => {
  const {client} = stub({}, 401);
  const kept = await checkText(h.db, client, 'profile', sam.id, 'a'.repeat(MIN_CHARS + 10));
  assert.equal(kept.classification, 'AI_ONLY', 'the last known verdict survives');
  const none = await checkText(h.db, client, 'reply', 'reply-unknown', 'b'.repeat(MIN_CHARS + 10));
  assert.equal(none, null);
});

test('saving a profile records who wrote it, and the room shows it per person', async () => {
  const {client} = stub();
  const runtime = {authenticity: {client, background: work => work}};
  const saved = await req('/api/owner/profile', 'PUT', longProfile, sam, null, runtime);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.authenticity.classification, 'HUMAN_ONLY');
  const state = (await req('/api/owner/state', 'GET', undefined, sam, null, runtime)).body;
  const me = state.members.find(m => m.you);
  assert.equal(me.profile_written_by, 'HUMAN_ONLY');
  assert.equal(me.profile_ai_probability, 4);
  // The room never exposes owner IDs to carry the verdict.
  assert.ok(!JSON.stringify(state.members).includes(sam.id));
});

test('a profile save still succeeds when GPTZero is down', async () => {
  const {client} = stub({}, 500);
  const saved = await req('/api/owner/profile', 'PUT', {...longProfile, seeking: 'Someone who has shipped to the app store and survived the review process.'}, sam, null, {authenticity: {client, background: work => work}});
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profile.seeking, 'Someone who has shipped to the app store and survived the review process.');
});

test('a Muse reply is checked after it is answered, and the verdict reaches the room', async () => {
  const {client} = stub({documents: [{document_classification: 'AI_ONLY', completely_generated_prob: 0.99, confidence_category: 'high'}]});
  const pending = [];
  const runtime = {authenticity: {client, background: work => pending.push(work)}};
  const issued = await req('/api/owner/connections', 'POST', {agent_name: "Sam's Muse"}, sam, null, runtime);
  const key = issued.body.access_token;
  const task = (await req('/api/v1/me/tasks', 'GET', undefined, null, key, runtime)).body.tasks[0];
  const text = 'Sam builds a route-finding app for boulderers and is looking for someone who has shipped an app store release before. '.repeat(2);
  const posted = await req(`/api/v1/tasks/${task.id}/response`, 'POST', {client_message_id: 'm1', nonce: task.nonce, text}, null, key, runtime);
  assert.equal(posted.status, 201);
  await Promise.all(pending); // the check runs after the reply is answered
  const check = (await checksFor(h.db, 'reply', [posted.body.response_id])).get(posted.body.response_id);
  assert.equal(check.classification, 'AI_ONLY');
  assert.equal(check.ai_probability, 99);
  const state = (await req('/api/owner/state', 'GET', undefined, sam, null, runtime)).body;
  assert.equal(state.responses.find(r => r.id === posted.body.response_id).authenticity.classification, 'AI_ONLY');
});

test('checkReply on a missing response is a no-op', async () => {
  const {client} = stub();
  await checkReply(h.db, client, 'reply_nope');
  assert.equal(h.sql.prepare("SELECT count(*) AS n FROM text_checks WHERE ref_id='reply_nope'").get().n, 0);
});

test('a profile is checked as one real passage, never as glued-together fields', () => {
  // Measured against the live API: the same honest paragraph scores HUMAN_ONLY (2% AI) on its own and AI_ONLY
  // (100% AI, high confidence) once a second field is appended. The seam between two fragments reads as machine text,
  // so only the longest thing the person actually wrote is ever sent.
  const p = {working_on: 'building a little route finding app, half finished, ugly ui but it works on my phone', seeking: 'someone who has shipped', interests: ['bouldering']};
  assert.equal(profileText(p), p.working_on);
  assert.ok(!profileText(p).includes(p.seeking));
  assert.ok(!profileText(p).includes('bouldering'));
  // Whichever field is longer is the one checked.
  assert.equal(profileText({working_on: 'short', seeking: 'a much longer passage about what I am looking for'}), 'a much longer passage about what I am looking for');
  assert.equal(profileText({}), '');
});
