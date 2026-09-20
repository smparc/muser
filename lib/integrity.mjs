// The room's audit trail: who wrote what, and what the master's matches were actually built on.
// A Commonroom room is agents speaking for people. That only works if the human parts are human, so this report
// separates the three kinds of text in a room: a person's own profile, a Muse's message, and a fact from an app.
// It is deliberately honest about what GPTZero cannot tell us — short text gets no verdict, and low confidence says so.
import {NOW, all, one} from './http.mjs';
import {checksFor, MIN_CHARS} from './authenticity.mjs';

const MESSAGE_SAMPLE = 25;
// Evidence IDs the master cites (lib/master.mjs): person:<connection>, muse:<connection>, reply:<response>, fact:<id>.
const evidenceRef = id => {
  const [kind, rest] = String(id ?? '').split(':');
  return {kind, ref: rest ?? ''};
};

export async function roomIntegrity(db, m, n = NOW()) {
  const members = await all(db, "SELECT id,owner_id,owner_name AS name,role,profile_shared FROM room_members WHERE room_id=? ORDER BY role='host' DESC,joined_at", m.id);
  const connections = await all(db, 'SELECT id,name,owner_id FROM connections WHERE room_id=? AND revoked_at IS NULL AND expires_at>?', m.id, n);
  const responses = await all(db, 'SELECT r.id,r.connection_id,r.text,r.created_at,c.name FROM responses r JOIN connections c ON c.id=r.connection_id WHERE r.room_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 200', m.id);
  const matches = await all(db, "SELECT a_id,b_id,verdict,summary,evidence_json,updated_at FROM matches WHERE room_id=? AND verdict<>'no_match' ORDER BY verdict='match' DESC,updated_at DESC", m.id);

  const profileChecks = await checksFor(db, 'profile', members.map(p => p.owner_id));
  const replyChecks = await checksFor(db, 'reply', responses.map(r => r.id));
  const ownerOf = new Map(connections.map(c => [c.id, c.owner_id]));
  const agentName = new Map(connections.map(c => [c.id, c.name]));

  // People: the half that should read as human. profile_shared off means the room never sees it, so nothing is claimed.
  const people = members.map(p => ({
    member_id: p.id, name: p.name, role: p.role, shared: !!p.profile_shared,
    muses: connections.filter(c => c.owner_id === p.owner_id).map(c => c.name),
    profile: p.profile_shared ? profileChecks.get(p.owner_id) ?? null : null,
  }));

  // Messages: AI by design. The count that matters is how many could be classified at all.
  const labelled = responses.map(r => ({...r, check: replyChecks.get(r.id) ?? null})).filter(r => r.check && r.check.classification !== 'too_short');
  const tally = {AI_ONLY: 0, MIXED: 0, HUMAN_ONLY: 0, UNKNOWN: 0};
  let lowConfidence = 0;
  for (const r of labelled) {
    tally[r.check.classification in tally ? r.check.classification : 'UNKNOWN']++;
    if (r.check.confidence && r.check.confidence !== 'high') lowConfidence++;
  }

  // Matches: what the verdict was actually built on, per person. This is where provenance changes a decision.
  const decorated = matches.map(x => {
    const evidence = JSON.parse(x.evidence_json).map(e => {
      const {kind, ref} = evidenceRef(e.id);
      const written = kind === 'reply' ? replyChecks.get(ref) ?? null
        : kind === 'person' ? profileChecks.get(ownerOf.get(ref)) ?? null
        : null;
      const source = kind === 'person' ? 'a person\'s own profile' : kind === 'reply' ? 'a Muse message' : kind === 'fact' ? 'a fact from a connected app' : 'a Muse profile';
      return {id: e.id, side: e.connection_id, agent_name: agentName.get(e.connection_id) ?? 'A Muse', source, kind: e.kind, text: e.text, written_by: written};
    });
    const human = evidence.filter(e => e.written_by?.classification === 'HUMAN_ONLY').length;
    return {
      a: agentName.get(x.a_id) ?? 'A Muse', b: agentName.get(x.b_id) ?? 'A Muse',
      verdict: x.verdict, summary: x.summary, updated_at: x.updated_at, evidence,
      // A match resting only on machine-written text is weaker than one resting on what people wrote themselves.
      grounding: {human_written: human, total: evidence.length, unchecked: evidence.filter(e => !e.written_by).length},
    };
  });

  return {
    room: {id: m.id, name: m.name, role: m.role},
    checked_at: n,
    people,
    messages: {
      total: responses.length, labelled: labelled.length, unlabelled: responses.length - labelled.length,
      by_classification: tally, low_confidence: lowConfidence,
      recent: labelled.slice(0, MESSAGE_SAMPLE).map(r => ({id: r.id, agent_name: r.name, created_at: r.created_at, text: r.text.slice(0, 240), ...r.check})),
    },
    matches: decorated,
    // Said out loud, because a detector that is presented as infallible is worse than one with stated limits.
    limits: {
      min_chars: MIN_CHARS,
      note: `Authorship detection is least reliable on short, plain text: a message under ${MIN_CHARS} characters gets no verdict at all, and a brief factual one can read as human even when a model wrote it. Profiles are the stronger signal here, and each one is checked as the longest single passage its author wrote rather than as their fields glued together, which would read as machine text on its own. Treat a single message label as weak evidence.`,
      provider: 'GPTZero',
    },
  };
}

// Whether the room can say anything at all: without a key there are no verdicts to report.
export const integrityAvailable = env => !!env?.GPTZERO_API_KEY;
