import * as THREE from 'three';

export function interestProp(interests=[]){
  const text=interests.filter(x=>typeof x==='string').join(' ').toLowerCase();
  if(/\btennis\b/.test(text))return 'tennis';
  if(/\b(reading|books|literature|writing)\b/.test(text))return 'book';
  return null;
}

export function createInterestProp(kind){
  const group=new THREE.Group();group.name=kind==='tennis'?'Tennis racquet':'Book';
  const blue=new THREE.MeshStandardMaterial({color:0x3268da,roughness:.65});
  const cream=new THREE.MeshStandardMaterial({color:0xfff4df,roughness:.9});
  const add=(geometry,material,x,y,z)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.castShadow=true;group.add(mesh);return mesh;};
  if(kind==='tennis'){
    add(new THREE.CylinderGeometry(.045,.055,.48,12),blue,0,.18,0);
    const hoop=add(new THREE.TorusGeometry(.31,.035,8,32),blue,0,.75,0);hoop.scale.y=1.3;
    const points=[];
    for(let i=-4;i<=4;i++){
      const x=i*.06,y=i*.078;
      const height=.39*Math.sqrt(1-(x/.3)**2),width=.3*Math.sqrt(1-(y/.39)**2);
      points.push(x,.75-height,0,x,.75+height,0,-width,.75+y,0,width,.75+y,0);
    }
    const strings=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3)),new THREE.LineBasicMaterial({color:0xeaf0f6}));group.add(strings);
    add(new THREE.CylinderGeometry(.024,.024,.23,8),blue,0,.48,0);
    group.rotation.z=.25;
  }else{
    add(new THREE.BoxGeometry(.42,.53,.13),blue,0,.18,0);
    add(new THREE.BoxGeometry(.37,.47,.14),cream,.015,.18,0);
    add(new THREE.BoxGeometry(.42,.53,.025),blue,0,.18,.085);
    add(new THREE.BoxGeometry(.06,.15,.01),new THREE.MeshStandardMaterial({color:0xf4b766}),.1,.39,.104);
    group.rotation.set(-.2,0,-.2);
  }
  group.position.set(-.2,-.5,.3);
  return group;
}

export function disposeProp(group){
  group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});group.removeFromParent();
}
