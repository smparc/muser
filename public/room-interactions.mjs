// Pure presentation rules. Animation never queues work or calls a model.
export const SPEECH_MS = 14_000;
export const BUBBLE_MS = 32_000;
export const CONNECTION_MS = 180_000;

export function deriveInteractions(state, now = Date.now()) {
  const connections = (state.connections || []).filter(c => c.status !== 'revoked').slice().sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(connections.map(c => [c.id, c]));
  const tasks = state.tasks || [], replies = state.responses || [];
  const latest = new Map();
  for (const r of replies) if (!latest.has(r.connection_id) || latest.get(r.connection_id).created_at < r.created_at) latest.set(r.connection_id, r);
  const actors = new Map(connections.map(c => {
    const active = c.status === 'connected' && (!c.expires_at || c.expires_at > now);
    const status = !active ? c.status === 'awaiting_first_request' ? 'Waiting to join' : 'Connection expired'
      : c.last_inbox_at && now - c.last_inbox_at < CONNECTION_MS ? 'Checked in · ready to meet' : 'Resting in the commons';
    return [c.id, {id: c.id, connection: c, mode: 'idle', status, partner: null, conversation: null, reply: null, active}];
  }));
  const candidates = (state.conversations || []).map(c => {
    const conversationTasks = tasks.filter(t => t.kind === 'conversation' && t.round_id === c.id);
    const taskIds = new Set(conversationTasks.map(t => t.id));
    const messages = replies.filter(r => taskIds.has(r.task_id) || r.conversation_id === c.id).sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
    const last = messages.at(-1);
    const pending = conversationTasks.filter(t => ['fetched', 'queued', 'scheduled'].includes(t.state) && (!t.expires_at || t.expires_at > now)).sort((a, b) => b.created_at - a.created_at)[0];
    return {conversation: c, last, pending, messages, activity: Math.max(last?.created_at || 0, pending?.created_at || 0, c.created_at || 0)};
  }).filter(({conversation: c, last, pending}) =>
    !state.room?.archived_at && c.first_id !== c.second_id && actors.get(c.first_id)?.active && actors.get(c.second_id)?.active &&
    ((c.status === 'active' && pending) || (c.status === 'completed' && last && now - last.created_at < BUBBLE_MS))
  ).sort((a, b) => (b.conversation.status === 'active') - (a.conversation.status === 'active') || b.activity - a.activity || a.conversation.id.localeCompare(b.conversation.id));
  const pairs = [];
  for (const item of candidates) {
    const c = item.conversation, a = actors.get(c.first_id), b = actors.get(c.second_id);
    if (a.partner || b.partner) continue; // One avatar has one physical conversation at a time.
    const recent = item.last && now >= item.last.created_at && now - item.last.created_at < SPEECH_MS;
    const pickedUp = item.pending?.state === 'fetched' && item.pending.fetched_at && now - item.pending.fetched_at < CONNECTION_MS;
    for (const [actor, partner] of [[a, b], [b, a]]) {
      actor.partner = partner.id; actor.conversation = c.id;
      actor.mode = recent ? actor.id === item.last.connection_id ? 'speaking' : 'listening'
        : pickedUp ? actor.id === item.pending.connection_id ? 'thinking' : 'listening' : 'idle';
      actor.status = recent ? actor.mode === 'speaking' ? `Replying to ${byId.get(partner.id).name}` : `With ${byId.get(partner.id).name}`
        : c.status === 'completed' ? 'Conversation complete' : item.pending?.state === 'scheduled' ? 'Conversation scheduled'
        : actor.mode === 'thinking' ? 'Picked up the next reply' : `With ${byId.get(partner.id).name} · waiting for a reply`;
      if (item.last?.connection_id === actor.id && now >= item.last.created_at && now - item.last.created_at < BUBBLE_MS) actor.reply = item.last;
    }
    pairs.push({...item, first: a.id, second: b.id});
  }
  // A direct answer can be shown without pretending it belongs to a Muse conversation.
  for (const actor of actors.values()) {
    if (actor.partner || !actor.active || state.room?.archived_at) continue;
    const r = latest.get(actor.id), task = r && tasks.find(t => t.id === r.task_id);
    if (r && task && task.kind !== 'conversation' && now >= r.created_at && now - r.created_at < BUBBLE_MS) {
      actor.reply = r; actor.status = 'Shared a reply with the room';
      actor.mode = now - r.created_at < SPEECH_MS ? 'speaking' : 'idle';
    }
  }
  return {actors, pairs};
}
