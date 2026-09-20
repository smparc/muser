// Audio is opt-in per visit. Opening a room never voices its historical messages.
export class AudioReplyQueue {
  constructor(){this.room=null;this.seen=new Set();this.items=[];this.enabled=false;}
  update(state){
    const initial=this.room!==state.room.id;
    if(initial){this.room=state.room.id;this.seen.clear();this.items=[];this.enabled=false;}
    const tasks=new Map((state.tasks||[]).map(t=>[t.id,t.kind]));
    for(const r of [...(state.responses||[])].sort((a,b)=>a.created_at-b.created_at||a.id.localeCompare(b.id))){
      if(!initial&&this.enabled&&!this.seen.has(r.id)&&['conversation','round','question'].includes(r.kind||tasks.get(r.task_id))&&this.items.length<8)this.items.push(r);
      this.seen.add(r.id);
    }
    if(this.seen.size>1000)this.seen=new Set([...this.seen].slice(-500));
    return initial;
  }
  stop(){this.enabled=false;this.items=[];}
}

export function createRoomAudio({preview=false,onSpeaker=()=>{}}={}){
  const button=document.getElementById('roomAudioToggle'),status=document.getElementById('roomAudioStatus'),volume=document.getElementById('roomAudioVolume');
  const queue=new AudioReplyQueue();let state=null,context=null,gain=null,source=null,abort=null,version=0,running=false,enabling=false;
  const say=text=>{if(status.textContent!==text)status.textContent=text;};
  function stop(message='Room audio off'){
    version++;queue.stop();abort?.abort();abort=null;source?.stop();source=null;onSpeaker(null);
    button.setAttribute('aria-pressed','false');button.textContent='Enable room audio';say(message);
  }
  async function pump(){
    if(running||!queue.enabled||document.hidden)return;
    running=true;const turn=version;
    try{
      while(queue.enabled&&queue.items.length&&turn===version&&!document.hidden){
        const reply=queue.items.shift();say('Preparing voice…');abort=new AbortController();
        let response;
        for(let attempt=0;attempt<4;attempt++){
          response=await fetch(`/api/owner/rooms/${encodeURIComponent(queue.room)}/audio`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:reply.id}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(40000)])});
          if(response.status!==409)break;
          const error=await response.clone().json().catch(()=>({}));if(error.error!=='audio_pending')break;
          await new Promise(resolve=>setTimeout(resolve,1500));
          if(turn!==version)return;
        }
        if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.message||'Audio unavailable. Text chat is still available.');}
        const buffer=await context.decodeAudioData(await response.arrayBuffer());
        if(turn!==version||!queue.enabled||document.hidden)return;
        const c=state.connections.find(c=>c.id===reply.connection_id);
        source=context.createBufferSource();source.buffer=buffer;source.connect(gain);
        onSpeaker({connectionId:reply.connection_id,memberId:c?.member_id});say(`${c?.name||reply.name||'Muse'} is speaking`);
        const ended=new Promise(resolve=>{source.onended=resolve;});source.start();await ended;
        if(turn!==version)return;source=null;onSpeaker(null);
      }
      if(queue.enabled&&!queue.items.length)say('Audio is on. Waiting for a new Muse reply.');
    }catch(error){if(turn===version)stop(error.name==='AbortError'?'Audio paused. Enable to resume.':error.message);}
    finally{running=false;if(queue.enabled&&queue.items.length)void pump();}
  }
  button.onclick=async()=>{
    if(queue.enabled){stop();return;}
    if(enabling){say('Connecting room audio… Please wait.');return;}
    if(!state){say('Your room has not loaded. Sign in if prompted, then refresh the page.');return;}
    if(preview){say('Voice playback is available in your real room.');return;}
    if(state.room.archived_at){say('This room is archived. Open an active room to enable voices.');return;}
    enabling=true;const turn=version;button.textContent='Enabling audio…';button.setAttribute('aria-busy','true');say('Connecting room audio…');
    try{
      const Context=window.AudioContext||window.webkitAudioContext;if(!Context)throw Error('Your browser does not support room audio.');
      context ||= new Context();if(!gain){gain=context.createGain();gain.connect(context.destination);}gain.gain.value=Number(volume.value);
      let resumeTimeout;
      try{await Promise.race([context.resume(),new Promise((_,reject)=>{resumeTimeout=setTimeout(()=>reject(Error('The browser could not start audio. Click Enable room audio to try again.')),10000);})]);}finally{clearTimeout(resumeTimeout);}say('Connecting voices…');
      const response=await fetch(`/api/owner/rooms/${encodeURIComponent(queue.room)}/audio`,{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
      const config=await response.json();if(turn!==version)return;
      if(!response.ok)throw Error(config.message||'Unable to enable room audio.');
      if(!config.available)throw Error('Voices need the ElevenLabs server key. Text chat is ready.');
      if(!config.daily_character_limit)throw Error('Room audio is disabled by the daily character limit.');
      queue.enabled=true;button.setAttribute('aria-pressed','true');button.textContent='Mute room';say('Audio is on. Waiting for a new Muse reply.');
    }catch(error){if(turn===version)stop(error.message);}
    finally{enabling=false;button.setAttribute('aria-busy','false');}
  };
  volume.oninput=()=>{if(gain)gain.gain.value=Number(volume.value);};
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&(queue.enabled||enabling))stop('Audio paused while away. Enable to resume.');});
  addEventListener('pagehide',()=>{stop();void context?.suspend();});
  return {
    update(next){state=next;if(queue.update(next))stop('Enable audio to hear new Muse replies. Earlier messages stay silent.');
      if(preview)say('Preview is silent. Open your own room to enable Muse voices.');
      else if(next.room.archived_at)stop('Room archived · audio paused');else if(queue.items.length)void pump();},
    clear(message='Loading your room before audio can be enabled…'){stop(message);state=null;queue.room=null;queue.seen.clear();},
    pause(){if(queue.enabled||enabling)stop('Connection interrupted. Enable audio after reconnecting.');},
  };
}
