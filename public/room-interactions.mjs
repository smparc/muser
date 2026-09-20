// Pure presentation rules. Animation never queues work or calls a model.
export const SPEECH_MS = 14_000;
export const BUBBLE_MS = 32_000;
export const CONNECTION_MS = 180_000;

function idleStatus(c, now) {
  if(c.status==='not_connected')return 'Muse not connected yet';
  if(c.status==='revoked')return 'Muse disconnected';
  if(c.status==='expired'||(c.expires_at&&c.expires_at<=now))return 'Connection expired';
  if(c.status==='awaiting_first_request')return 'Waiting for first check-in';
  return c.last_inbox_at&&now-c.last_inbox_at<CONNECTION_MS?'Checked in · ready to meet':'Resting in the commons';
}

// A room member occupies one place, even before connecting a Muse or after disconnecting it.
// Multiple connectors remain available in management; the room shows the one in conversation.
function representMembers(state, actors, pairs, now) {
  if(!Array.isArray(state.members))return {actors,pairs};
  const members=new Map(state.members.map(m=>[m.id,m])), chosen=new Map(), visiblePairs=[];
  for(const pair of pairs){
    const a=actors.get(pair.first),b=actors.get(pair.second),am=a.connection.member_id,bm=b.connection.member_id;
    if(!members.has(am)||!members.has(bm)||am===bm||chosen.has(am)||chosen.has(bm))continue;
    chosen.set(am,a);chosen.set(bm,b);visiblePairs.push(pair);
  }
  const paired=new Set(visiblePairs.flatMap(p=>[p.first,p.second]));
  for(const member of members.values()){
    if(chosen.has(member.id))continue;
    const candidates=[...actors.values()].filter(a=>a.connection.member_id===member.id).sort((a,b)=>
      Number(b.active)-Number(a.active)||Number(b.connection.status==='awaiting_first_request')-Number(a.connection.status==='awaiting_first_request')||
      (b.reply?.created_at||b.connection.last_seen_at||b.connection.created_at||0)-(a.reply?.created_at||a.connection.last_seen_at||a.connection.created_at||0)||a.id.localeCompare(b.id));
    let actor=candidates[0];
    if(!actor){
      const disconnected=(state.connections||[]).some(c=>c.member_id===member.id&&c.status==='revoked');
      const connection={id:'member:'+member.id,member_id:member.id,name:`${member.name}'s Muse`,owner_name:member.name,mine:member.you,status:disconnected?'revoked':'not_connected',placeholder:true};
      actor={id:connection.id,connection,active:false,mode:'idle',status:idleStatus(connection,now),reply:null,partner:null,conversation:null};
    }
    if(actor.partner&&!paired.has(actor.id))actor={...actor,mode:'idle',status:idleStatus(actor.connection,now),reply:null,partner:null,conversation:null};
    chosen.set(member.id,actor);
  }
  return {actors:new Map([...chosen.values()].map(a=>[a.id,a])),pairs:visiblePairs};
}

export function describeRoom(state, interactions, {stale=false,signedOut=false}={}) {
  if(signedOut)return {label:'Sign in to enter',tone:'offline',detail:'Sign in to see your room.'};
  if(!state)return {label:stale?'Room unavailable':'Connecting…',tone:stale?'offline':'waiting',detail:stale?'Retrying the room connection.':'Loading your room.'};
  const people=state.members?.length??interactions.actors.size;
  // Members without a Muse stand in the room as placeholders; they are people, not Muses.
  const muses=[...interactions.actors.values()].filter(a=>!a.connection.placeholder).length;
  const connected=[...interactions.actors.values()].filter(a=>a.active).length;
  const counts=`${people} ${people===1?'person':'people'} · ${muses} ${muses===1?'Muse':'Muses'}`;
  if(stale)return {label:'Reconnecting…',tone:'offline',detail:`${counts} · last known state`};
  if(state.room.archived_at)return {label:'Room archived',tone:'offline',detail:`${counts} · conversations paused`};
  return {label:connected?'Room connected':'Room ready',tone:connected?'connected':'waiting',detail:`${counts} · ${connected} connected`};
}

export function deriveInteractions(state, now = Date.now()) {
  const memberIds=Array.isArray(state.members)?new Set(state.members.map(m=>m.id)):null;
  const connections = (state.connections || []).filter(c => c.status !== 'revoked'&&(!memberIds||memberIds.has(c.member_id))).slice().sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(connections.map(c => [c.id, c]));
  const tasks = state.tasks || [], replies = state.responses || [];
  const latest = new Map();
  for (const r of replies) if (!latest.has(r.connection_id) || latest.get(r.connection_id).created_at < r.created_at) latest.set(r.connection_id, r);
  const actors = new Map(connections.map(c => {
    const active = c.status === 'connected' && (!c.expires_at || c.expires_at > now);
    const status = idleStatus(c,now);
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
    (!memberIds||byId.get(c.first_id).member_id!==byId.get(c.second_id).member_id) &&
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
  const result=representMembers(state,actors,pairs,now);
  if(state.room?.archived_at)for(const actor of result.actors.values())actor.status='Room archived · conversations paused';
  return result;
}
