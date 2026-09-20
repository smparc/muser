import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

export const CONVERSATION_SPOTS = [{x:0,z:1.8},{x:-5.7,z:.2},{x:5.7,z:.2},{x:-5,z:5.4},{x:5,z:5.4}];
export const OBSERVER_POSITION = {x:-6.2,z:-5.4};

export function createRoom(scene) {
  const group = new THREE.Group(); group.name = 'The commons'; scene.add(group);
  const material = color => new THREE.MeshStandardMaterial({color, roughness:.9});
  const cream=material(0xf0e7d9), stone=material(0xe2d9ca), blue=material(0x7895d2), lightBlue=material(0xc0d0ea), oak=material(0xc4a078), linen=material(0xf9f0e4), darkOak=material(0x9e7b55);
  const add = (geometry, mat, x,y,z, parent=group) => { const mesh=new THREE.Mesh(geometry,mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh; };
  const box = (w,h,d,mat,x,y,z,r=.14,parent=group) => add(new RoundedBoxGeometry(w,h,d,3,Math.min(r,w/3,h/3,d/3)),mat,x,y,z,parent);
  const cylinder = (r1,r2,h,mat,x,y,z) => add(new THREE.CylinderGeometry(r1,r2,h,48),mat,x,y,z);
  const floor = add(new THREE.PlaneGeometry(200,200),material(0xf0eee9),0,-.25,0);floor.rotation.x=-Math.PI/2;floor.castShadow=false;
  box(24,.32,20,stone,0,-.16,0,.15);
  box(23.5,.15,19.5,cream,0,.015,0,.07);
  // Low courtyard walls leave the characters visible when orbiting.
  box(23.5,1.5,.5,linen,0,.7,-9.2,.22);
  box(.5,.9,15,linen,-11.5,.4,-1.4,.22);
  box(.5,.9,15,linen,11.5,.4,-1.4,.22);
  const rug = cylinder(4.8,4.8,.025,material(0xd9c9b3),0,.12,1.1);rug.castShadow=false;
  const rugCenter = cylinder(4.6,4.6,.03,material(0xe9dcc7),0,.125,1.1);rugCenter.castShadow=false;
  for(const radius of [4.36,4.43,4.5]) {const ring=add(new THREE.TorusGeometry(radius,.016,4,100),linen,0,.147,1.1);ring.rotation.x=Math.PI/2;ring.castShadow=false;}
  // Blue lounge, soft cushions and a low shared table.
  box(6.4,.52,1.75,blue,1.4,.55,-3.5,.23);
  box(6.5,1.15,.44,blue,1.4,1.23,-4.12,.2);
  box(.45,.95,1.95,blue,-1.66,1.04,-3.4,.2);box(.45,.95,1.95,blue,4.47,1.04,-3.4,.2);
  for(let i=0;i<3;i++) box(1.85,.3,1.45,linen,-.65+i*2,.94,-3.37,.15);
  for(const [x,mat,tilt] of [[-.45,lightBlue,-.14],[2.7,lightBlue,.13],[3.65,linen,-.1]]) {const cushion=box(.92,.85,.25,mat,x,1.47,-3.79,.15);cushion.rotation.z=tilt;cushion.rotation.x=-.12;}
  cylinder(1.65,1.65,.18,oak,.5,.87,-.83);cylinder(.86,1.1,.74,darkOak,.5,.41,-.83);
  box(.75,.10,.52,blue,.7,1.01,-.9,.025);box(.73,.07,.51,linen,.67,1.08,-.89,.02);
  // A curved welcome counter and an observer who stays at the side of the conversation.
  cylinder(1.65,1.65,1.1,blue,-6.2,.7,-4.5);
  cylinder(1.7,1.7,.14,oak,-6.2,1.32,-4.5);
  const laptop=box(.8,.55,.055,material(0x526782),-6.15,1.66,-4.55,.025);laptop.rotation.x=-.18;
  box(.8,.05,.55,material(0x7185a0),-6.15,1.42,-4.27,.02);
  cylinder(.13,.2,.05,darkOak,-5.2,1.43,-4.35);
  add(new THREE.SphereGeometry(.25,24,16),new THREE.MeshStandardMaterial({color:0xffefba,emissive:0xffd375,emissiveIntensity:.45,roughness:.6}),-5.2,1.72,-4.35);
  const leafMat=[material(0x718c58),material(0x91a76e),material(0x4d7254)];
  function plant(x,z,size=1,base=0) {
    cylinder(.37*size,.29*size,.6*size,linen,x,base+.3*size,z);
    cylinder(.32*size,.32*size,.04*size,darkOak,x,base+.6*size,z);
    const trunk=cylinder(.045*size,.065*size,.85*size,darkOak,x,base+1.02*size,z);trunk.castShadow=false;
    for(let i=0;i<11;i++) {const angle=i*2.4;const y=base+(.9+i*.055)*size;
      const leaf=add(new THREE.SphereGeometry(1,10,8),leafMat[i%3],x+Math.cos(angle)*.26*size,y,z+Math.sin(angle)*.26*size);
      leaf.scale.set(.17*size,.36*size,.095*size);leaf.rotation.set(.35*Math.cos(angle),angle,-.65*Math.sin(angle));}
  }
  plant(.05,-.83,.48,.96);
  for(const [x,z,s] of [[-9,-6.8,1.7],[-3.5,-6.7,1.5],[5.9,-5.9,1.7],[8.5,-4.5,1.8],[9.3,2.5,1.8],[-9,2.8,1.7],[-7,7.5,1.3],[7,7.7,1.3]]) plant(x,z,s);
  // A pair of small side seats gives unoccupied Muses somewhere to gather.
  for(const side of [-1,1]) {cylinder(1.35,1.4,.65,lightBlue,side*7,.48,3.7);cylinder(1.27,1.27,.15,linen,side*7,.86,3.7);}
  // A little library and ceramics along the back edge keep the conversation floor clear.
  box(3.1,.16,.75,oak,7.5,.72,-8.2,.04);
  for(const x of [6.2,8.8])box(.16,.72,.62,darkOak,x,.36,-8.2,.03);
  const coral=material(0xd99c86),sage=material(0x91a98a);
  for(let i=0;i<7;i++){
    const book=box(.19,.45+(i%3)*.09,.38,[blue,linen,sage,coral][i%4],6.5+i*.24,1.03+(i%3)*.045,-8.2,.015);
    book.rotation.z=i===6?-.12:0;
  }
  cylinder(.17,.22,.42,coral,8.5,1.01,-8.2);
  plant(8.5,-8.2,.32,1.2);
  // A warm floor lamp beside the lounge, and two cups on the shared table.
  cylinder(.36,.4,.09,darkOak,-2.5,.13,-4.7);
  cylinder(.035,.035,2.6,darkOak,-2.5,1.46,-4.7);
  add(new THREE.CylinderGeometry(.35,.62,.55,24),new THREE.MeshStandardMaterial({color:0xffe7bd,emissive:0xffd58c,emissiveIntensity:.2,roughness:1}),-2.5,2.8,-4.7);
  for(const [x,z,mat] of [[1.25,-.35,coral],[-.35,-1.35,sage]]){
    cylinder(.13,.1,.2,mat,x,1.07,z);
    const handle=add(new THREE.TorusGeometry(.075,.02,6,16),mat,x+.14,1.07,z);handle.rotation.y=Math.PI/2;
    cylinder(.1,.1,.007,darkOak,x,1.174,z);
  }
  return group;
}
