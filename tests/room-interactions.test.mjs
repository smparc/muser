import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveInteractions, SPEECH_MS, BUBBLE_MS} from '../public/room-interactions.mjs';
const now = 1_000_000;
function sample() {
  return {room: {}, connections: ['a','b','c'].map(id => ({id, name:id.toUpperCase(), status:'connected'})), conversations:[{id:'ab',first_id:'a',second_id:'b',status:'active'}], tasks:[{id:'t1',kind:'conversation',round_id:'ab',connection_id:'a',state:'answered',created_at:now-1000},{id:'t2',kind:'conversation',round_id:'ab',connection_id:'b',state:'queued',created_at:now}], responses:[{id:'r1',task_id:'t1',connection_id:'a',text:'Hello B',created_at:now-1000}]};
}
test('an actual latest reply makes one partner speak and the other listen', () => {
  const {actors,pairs}=deriveInteractions(sample(),now);
  assert.equal(pairs.length,1);assert.equal(actors.get('a').mode,'speaking');assert.equal(actors.get('b').mode,'listening');assert.equal(actors.get('a').reply.text,'Hello B');assert.equal(actors.get('c').partner,null);
});
test('duplicate polls do not restart speech; old replies and bubbles expire', () => {
  const s=sample();assert.equal(deriveInteractions(s,now).actors.get('a').mode,'speaking');
  const later=deriveInteractions(s,now+SPEECH_MS);assert.equal(later.actors.get('a').mode,'idle');
  assert.equal(deriveInteractions(s,now+BUBBLE_MS).actors.get('a').reply,null);
});
test('queued work does not claim speaking; only a recent fetch animates reply preparation', () => {
  const s=sample();s.responses=[];
  assert.equal(deriveInteractions(s,now).actors.get('b').mode,'idle');
  s.tasks[1].state='fetched';s.tasks[1].fetched_at=now;
  assert.equal(deriveInteractions(s,now).actors.get('b').mode,'thinking');
  assert.equal(deriveInteractions(s,now+181000).actors.get('b').mode,'idle');
});
test('stopped, archived, expired and revoked conversations cannot keep interacting', () => {
  for(const change of [s=>s.conversations[0].status='stopped',s=>s.room.archived_at=now,s=>s.connections[0].status='revoked',s=>s.connections[0].expires_at=now-1,s=>s.tasks[1].state='expired']) {
    const s=sample();change(s);assert.equal(deriveInteractions(s,now).pairs.length,0);
  }
});
test('completed conversations finish the last reply then leave the conversation area', () => {
  const s=sample();s.conversations[0].status='completed';assert.equal(deriveInteractions(s,now).pairs.length,1);assert.equal(deriveInteractions(s,now+BUBBLE_MS).pairs.length,0);
});
test('the newest eligible conversation wins when a Muse belongs to multiple threads', () => {
  const s=sample();s.conversations.push({id:'bc',first_id:'b',second_id:'c',status:'active',created_at:now+1});s.tasks.push({id:'t3',kind:'conversation',round_id:'bc',connection_id:'c',state:'queued',created_at:now+1});
  const result=deriveInteractions(s,now+2);assert.equal(result.pairs.length,1);assert.equal(result.pairs[0].conversation.id,'bc');assert.equal(result.actors.get('a').partner,null);
});
test('input ordering does not change which message is most recent',()=>{
  const s=sample();s.responses.unshift({id:'r2',task_id:'t2',connection_id:'b',text:'Hello A',created_at:now});
  assert.equal(deriveInteractions(s,now).actors.get('b').mode,'speaking');
});
