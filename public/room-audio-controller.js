// Initialize controls independently of Three.js and the WebGL renderer so that
// a scene-loading failure cannot leave an apparently clickable, inert button.
import {createRoomAudio} from './room-audio.js';
export let audioSpeaker=null;
export const audio=createRoomAudio({
  preview:new URLSearchParams(location.search).get('preview')==='1',
  onSpeaker:speaker=>{audioSpeaker=speaker;},
});
