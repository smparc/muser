import * as THREE from 'three';
import {interestProp,createInterestProp,disposeProp} from './muse-props.js';

// A reusable, articulated 3D Muse. No image planes or remote model downloads.
export function seedFor(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function createMuse({seed = 1, accessory = 'scarf', detail = 1, identity = seed, connectionStatus = 'connected'} = {}) {
  const root = new THREE.Group();
  root.name = 'Muse';
  const rig = new THREE.Group(); root.add(rig);
  const cream = new THREE.MeshStandardMaterial({color: 0xf5e8d1, roughness: .96});
  const faceMaterial = new THREE.MeshStandardMaterial({color: 0xf3d0ab, roughness: .84});
  const blue = new THREE.MeshStandardMaterial({color: 0x3268da, roughness: .88});
  const blueLight = new THREE.MeshStandardMaterial({color: 0x7195e1, roughness: .94});
  const leather = new THREE.MeshStandardMaterial({color: 0x9f744d, roughness: .85});
  const eyesMaterial = new THREE.MeshStandardMaterial({color: 0x211d1b, roughness: .22});
  const pink = new THREE.MeshStandardMaterial({color: 0xeebca9, roughness: 1});
  const white = new THREE.MeshBasicMaterial({color: 0xffffff});
  const identityMaterial = new THREE.MeshStandardMaterial({color: 0x7195e1, roughness: .72});
  const statusMaterial = new THREE.MeshBasicMaterial({color: 0x42b881, transparent: true, opacity: .82});
  // Segment counts scale with detail: on a phone the silhouette stays round without the extra triangles.
  const segments = Math.max(20, Math.round(44 * detail)), rings = Math.max(14, Math.round(30 * detail));
  const sphere = new THREE.SphereGeometry(1, segments, rings);
  const ball = (parent, material, scale, position) => {
    const m = new THREE.Mesh(sphere, material); m.scale.set(...scale); m.position.set(...position);
    m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  const curve = (parent, points, thickness, material) => {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(path, 22, thickness, 6, false), material);
    parent.add(m); return m;
  };

  ball(rig, cream, [.66, .85, .51], [0, 1.04, 0]);
  const head = new THREE.Group(); head.position.y = 1.94; rig.add(head);
  ball(head, cream, [.79, .78, .61], [0, 0, 0]);
  ball(head, faceMaterial, [.56, .48, .145], [0, -.03, .51]);
  const eyes = [];
  for (const side of [-1, 1]) {
    eyes.push(ball(head, eyesMaterial, [.058, .075, .038], [side * .22, .045, .642]));
    ball(head, white, [.017, .021, .012], [side * .22 - .014, .072, .673]);
    ball(head, pink, [.09, .05, .009], [side * .355, -.11, .621]);
  }
  const smile = curve(head, [[-.09, -.17, .655], [0, -.208, .662], [.09, -.17, .655]], .013, eyesMaterial);
  const mouth = ball(head, eyesMaterial, [.055, .033, .012], [0, -.183, .66]); mouth.visible = false;
  const arms = [], feet = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * .58, 1.38, 0); rig.add(shoulder);
    ball(shoulder, cream, [.23, .4, .25], [side * .12, -.25, .07]);
    arms.push(shoulder);
    const foot = new THREE.Group(); foot.position.set(side * .31, .22, .17); rig.add(foot);
    ball(foot, cream, [.28, .23, .38], [0, 0, .04]); feet.push(foot);
  }
  // The Muser mark is real blue piping on the belly.
  curve(rig, [[-.22, 1.07, .49], [-.10, 1.31, .505], [-.10, 1.08, .523], [.08, 1.30, .511], [.06, 1.07, .53], [.23, 1.24, .505]], .034, blue);
  const identityBadge = new THREE.Mesh(new THREE.CircleGeometry(.115, 20), identityMaterial);
  identityBadge.position.set(0, 1.02, .555); rig.add(identityBadge);
  const statusRing = new THREE.Mesh(new THREE.TorusGeometry(.64, .035, 8, 40), statusMaterial);
  statusRing.rotation.x = Math.PI / 2; statusRing.position.y = .055; rig.add(statusRing);
  const identityColor = new THREE.Color().setHSL((seedFor(identity) % 360) / 360, .62, .56);
  identityMaterial.color.copy(identityColor);
  const statusColors = {connected: 0x42b881, awaiting_first_request: 0xe1a63b, expired: 0x929aa5, revoked: 0x6d737c};
  const setConnectionState = ({owner = identity, status = 'connected'} = {}) => {
    identityMaterial.color.setHSL((seedFor(owner) % 360) / 360, .62, .56);
    statusMaterial.color.setHex(statusColors[status] ?? statusColors.expired);
    statusRing.visible = status !== 'revoked';
  };
  setConnectionState({owner: identity, status: connectionStatus});
  if (accessory === 'scarf') {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(.48, .105, 10, 36), blue);
    collar.rotation.x = Math.PI / 2; collar.position.set(0, 1.52, 0); collar.scale.z = .94; rig.add(collar);
    ball(rig, blue, [.115, .34, .066], [.29, 1.22, .5]);
    ball(rig, blueLight, [.10, .25, .06], [.41, 1.31, .45]);
  } else if (accessory === 'satchel') {
    curve(rig, [[-.56, 1.63, .04], [-.38, 1.45, .38], [.08, 1.15, .54], [.54, .79, .29]], .046, leather);
    const bag = ball(rig, leather, [.32, .3, .15], [.63, .66, .21]); bag.rotation.z = -.1;
    ball(rig, new THREE.MeshStandardMaterial({color: 0xba9265, roughness: .8}), [.28, .12, .06], [.63, .8, .35]);
    ball(rig, new THREE.MeshStandardMaterial({color: 0xe5bf7f, metalness: .5, roughness: .3}), [.035, .05, .015], [.63, .72, .405]);
  } else if (accessory === 'visor') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(.69, .065, 8, 40), blue); band.rotation.x = Math.PI / 2; band.position.y = .36; head.add(band);
    ball(head, blue, [.67, .045, .4], [0, .32, .45]);
    ball(head, blueLight, [.5, .018, .29], [0, .369, .44]);
  }

  let heldProp=null,heldKind=null;
  function setInterests(interests=[]){
    const kind=interestProp(interests);if(kind===heldKind)return;
    if(heldProp)disposeProp(heldProp);heldProp=null;heldKind=kind;
    if(kind){heldProp=createInterestProp(kind);arms[0].add(heldProp);}
  }
  return {
    root, rig, head, arms, feet, eyes, setConnectionState,setInterests,
    animate(time, {motion = 'idle', walking = 0, energy = 1, reducedMotion = false} = {}) {
      const t = time + (seed % 113) / 13;
      const animated = !reducedMotion;
      const talking = animated && motion === 'speaking';
      const listening = animated && motion === 'listening';
      const thinking = animated && motion === 'thinking';
      const greeting = animated && motion === 'greeting' && walking < .2;
      const phrase = Math.max(0,Math.sin(t * 1.3));
      const nod = Math.max(0,Math.sin(t * .85)) ** 8;
      const step = animated ? Math.sin(t * 8) * walking : 0;
      rig.position.y = animated ? Math.sin(t * 1.7) * .012 * energy + Math.abs(step) * .07 : 0;
      rig.rotation.z = animated ? Math.sin(t * 2) * .012 * energy : 0;
      head.rotation.x = talking ? Math.sin(t * 3) * .035 : listening ? nod * Math.sin(t * 5) * .09 : thinking ? -.06 : 0;
      head.rotation.z = listening ? Math.sin(t*.6)*.045 : talking ? Math.sin(t * 2) * .025 : 0;
      head.rotation.y = animated && walking < .2 ? Math.sin(t*.55)*.045 : 0;
      arms[0].rotation.z = -.12 - (talking ? phrase*(.28 + Math.sin(t * 3) * .12) : 0);
      arms[1].rotation.z = .12 + (greeting ? 1.7+Math.sin(t*9)*.18 : thinking ? .58 : talking ? phrase*(.5 + Math.sin(t * 3 + 1) * .2) : 0);
      arms[0].rotation.x = step * .45; arms[1].rotation.x = -step * .45 - (thinking ? .35 : 0);
      feet[0].position.y = .22 + Math.max(0, step) * .1;
      feet[1].position.y = .22 + Math.max(0, -step) * .1;
      const blink = animated && t % 4.7 > 4.53;
      eyes.forEach(eye => eye.scale.y = blink ? .014 : .075);
      smile.visible = !talking; mouth.visible = talking;
      mouth.scale.y = .025 + Math.abs(Math.sin(t * 11)) * .032;
    },
    dispose() {
      const geometries = new Set(), materials = new Set();
      root.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); if (o.isInstancedMesh) o.dispose(); });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
      root.removeFromParent();
    },
  };
}
