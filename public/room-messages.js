// Read-only transcript: reuse room polling; fetch older pages only on request.
export function createRoomMessages({preview=false}={}) {
  const $=id=>document.getElementById(id), box=$('roomMessages'), list=$('messageList'), scroll=$('messageScroll');
  const summary=box.querySelector('summary'), older=$('olderMessages'), badge=$('messageBadge');
  let room=null, rows=new Map(), names=new Map(), hasMore=false, loading=false, unread=0, generation=0;
  const ordered=()=>[...rows.values()].sort((a,b)=>a.created_at-b.created_at||(a.id<b.id?-1:a.id>b.id?1:0));
  function close(){box.open=false;if(location.hash==='#messages')history.replaceState(null,'',location.pathname+location.search);}
  function open(){box.open=true;}
  function clear(){generation++;room=null;rows.clear();unread=0;hasMore=false;loading=false;close();render();}
  function render({prepend=false}={}) {
    const top=scroll.scrollTop,height=scroll.scrollHeight,atBottom=height-top-scroll.clientHeight<50;
    const items=ordered(),fragment=document.createDocumentFragment();
    for(const r of items){
      const article=document.createElement('article');article.className='room-message';
      const header=document.createElement('div'),name=document.createElement('b'),time=document.createElement('time'),text=document.createElement('p');
      name.textContent=names.get(r.connection_id)||r.name||'Muse';
      const date=new Date(r.created_at);time.dateTime=date.toISOString();time.textContent=date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});time.title=date.toLocaleString();
      text.textContent=r.text;header.append(name,time);article.append(header,text);fragment.append(article);
    }
    if(!items.length){const empty=document.createElement('p');empty.className='messages-empty';empty.textContent=room?'A quiet moment. When your Muses reply, their messages will appear here.':'Connect to your room to see its conversations.';fragment.append(empty);}
    list.replaceChildren(fragment);older.hidden=!hasMore;older.disabled=loading;
    badge.hidden=!unread;badge.textContent=unread>99?'99+':String(unread);badge.setAttribute('aria-label',`${unread} unread messages`);
    if(prepend)scroll.scrollTop=top+scroll.scrollHeight-height;
    else if(atBottom)scroll.scrollTop=scroll.scrollHeight;
    else scroll.scrollTop=top;
  }
  function update(state){
    const initial=room!==state.room.id,incoming=state.responses||[];
    const emptied=!preview&&rows.size>0&&!incoming.length;
    if(initial){generation++;rows.clear();room=state.room.id;hasMore=!preview&&incoming.length===200;unread=0;}
    names=new Map(state.connections.map(c=>[c.id,c.name]));
    // Reset the window after a long absence so older pages never hide a gap.
    if(rows.size&&incoming.length&&!incoming.some(r=>rows.has(r.id))&&!preview){rows.clear();hasMore=incoming.length===200;}
    if(emptied){generation++;rows.clear();hasMore=false;unread=0;loading=false;}
    let changed=initial||emptied;
    for(const r of incoming){if(!rows.has(r.id)){changed=true;if(!initial&&!box.open)unread++;}rows.set(r.id,r);}
    if(preview&&rows.size>20)for(const r of ordered().slice(0,-20))rows.delete(r.id);
    $('messageStatus').textContent=preview?'Sample dialogue · no tokens used':state.room.archived_at?'Archived room history':'Live replies from the room';
    if(changed)render();
  }
  older.onclick=async()=>{
    if(loading||!room||preview)return;loading=true;older.disabled=true;$('messageError').hidden=true;
    const version=generation;
    try{
      const query=new URLSearchParams({room,before:ordered()[0].id});
      const response=await fetch('/api/owner/messages?'+query,{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
      if(version!==generation)return;
      if(response.status===401||response.status===404){clear();return;}
      if(!response.ok)throw Error('Could not load earlier messages. Please try again.');
      const data=await response.json();if(version!==generation)return;
      for(const r of data.messages)rows.set(r.id,r);hasMore=data.has_more;render({prepend:true});
    }catch(error){if(version===generation){$('messageError').textContent=error.message;$('messageError').hidden=false;}}
    finally{if(version===generation){loading=false;older.disabled=false;}}
  };
  box.addEventListener('toggle',()=>{summary.setAttribute('aria-expanded',String(box.open));list.setAttribute('aria-live',box.open?'polite':'off');if(box.open){unread=0;badge.hidden=true;scroll.scrollTop=scroll.scrollHeight;}});
  $('closeMessages').onclick=()=>{close();summary.focus();};
  document.addEventListener('pointerdown',e=>{if(box.open&&!box.contains(e.target))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&box.open){close();summary.focus();}});
  document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&(a.dataset.nav==='messages'||a.getAttribute('href')==='#messages')&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();open();}});
  addEventListener('hashchange',()=>{if(location.hash==='#messages')open();});
  if(location.hash==='#messages')open();
  render();return {update,clear,open,close};
}
