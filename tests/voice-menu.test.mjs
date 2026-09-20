// Proves the markup the Muse card produces for the voice menu, without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const HAYDEN='whtn8K2jpyL49m4VzNGr';

// Lifted verbatim from public/connect.js voicePicker().
function voicePicker(museId, voiceCatalog, state) {
  if (!voiceCatalog) return '<label class="voice-row">Voice<select disabled><option>Loading voices…</option></select></label>';
  if (!voiceCatalog.available) return '<label class="voice-row">Voice<select disabled><option>Not switched on for this Muser</option></select></label>';
  const current = (state.my_muses ?? []).find(m => m.id === museId)?.voice_id ?? '';
  const options = ['<option value="">Chosen for me</option>']
    .concat(voiceCatalog.voices.map(v => `<option value="${esc(v.id)}"${v.id === current ? ' selected' : ''}>${esc(v.name)}${v.category && v.category !== 'premade' ? ' · ' + esc(v.category) : ''}</option>`));
  const known = !current || voiceCatalog.voices.some(v => v.id === current);
  return `<label class="voice-row">Voice<select data-voice="${esc(museId)}">${options.join('')}</select></label>${known ? '' : '<p class="muted small">This Muse is set to a voice the server no longer offers. Pick another.</p>'}`;
}

const catalog={available:true,voices:[
 {id:'21m00Tcm4TlvDq8ikWAM',name:'Rachel',category:'premade'},
 {id:HAYDEN,name:"Hayden's voice",category:'cloned'},
]};

test('the menu lists your cloned voice and marks the chosen one',()=>{
  const html=voicePicker('muse1',catalog,{my_muses:[{id:'muse1',voice_id:HAYDEN}]});
  assert.match(html,/data-voice="muse1"/);
  assert.match(html,/<option value="">Chosen for me<\/option>/);
  assert.match(html,new RegExp(`<option value="${HAYDEN}" selected>Hayden&#39;s voice · cloned</option>`));
  assert.match(html,/<option value="21m00Tcm4TlvDq8ikWAM">Rachel<\/option>/,'stock voices carry no category suffix');
});

test('with no choice made, "Chosen for me" is what is selected',()=>{
  const html=voicePicker('muse1',catalog,{my_muses:[{id:'muse1',voice_id:null}]});
  assert.equal((html.match(/ selected/g)||[]).length,0);
});

test('the row is always present, and says why when voices are off',()=>{
  assert.match(voicePicker('m',null,{}),/Loading voices/);
  const off=voicePicker('m',{available:false,voices:[]},{});
  assert.match(off,/voice-row/,'the setting must still be visible');
  assert.match(off,/Not switched on/);
});

test('a voice the server dropped is called out rather than silently ignored',()=>{
  const html=voicePicker('muse1',catalog,{my_muses:[{id:'muse1',voice_id:'goneVoiceId123'}]});
  assert.match(html,/no longer offers/);
});
