'use client';
import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import type { PetId } from '@/lib/central-assistant';

// Articulated procedural characters: every visible part is real lit geometry.
export default function Companion3D({pet,state,reduced,onUnavailable}:{pet:PetId;state:string;reduced:boolean;onUnavailable:()=>void}) {
  const host=useRef<HTMLSpanElement>(null),live=useRef({state,reduced});live.current={state,reduced};
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    const element=host.current;if(!element)return;
    let renderer:T.WebGLRenderer;
    try{renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch{onUnavailable();return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=T.SRGBColorSpace;
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.35;
    element.appendChild(renderer.domElement);renderer.domElement.style.cssText='width:100%;height:100%;display:block';
    const scene=new T.Scene(),camera=new T.PerspectiveCamera(30,1,.1,30);camera.position.set(0,1.9,6.2);camera.lookAt(0,1.45,0);
    scene.add(new T.HemisphereLight(0xe8e2ff,0x332044,2.7));
    const key=new T.DirectionalLight(0xffefda,4);key.position.set(-3,5,5);scene.add(key);
    const rim=new T.DirectionalLight(pet==='sol'?0xffae33:0x9970ff,5);rim.position.set(3,2,-3);scene.add(rim);
    const mat=(c:number,metal=.0,rough=.4)=>new T.MeshStandardMaterial({color:c,metalness:metal,roughness:rough});
    const skin=mat(pet==='sol'?0xffba46:0x50436b,.15),dark=mat(0x191827,.2),violet=mat(0x684cb1,.3),gold=mat(0xffce65,.65,.25),white=mat(0xfaf0e0),pupil=mat(0x151522),iris=mat(pet==='sol'?0x8b4927:0x29c6ff,.3);
    const flame=new T.MeshStandardMaterial({color:0xffa223,emissive:0xff6600,emissiveIntensity:.45,roughness:.3});
    const root=new T.Group();scene.add(root);root.rotation.y=-.23;
    function sphere(parent:T.Object3D,m:T.Material,x:number,y:number,z:number,sx:number,sy:number,sz:number){const mesh=new T.Mesh(new T.SphereGeometry(1,24,16),m);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);parent.add(mesh);return mesh;}
    function cone(parent:T.Object3D,m:T.Material,x:number,y:number,z:number,r:number,h:number,angle=0){const mesh=new T.Mesh(new T.ConeGeometry(r,h,20),m);mesh.position.set(x,y,z);mesh.rotation.z=angle;parent.add(mesh);return mesh;}
    function tube(parent:T.Object3D,m:T.Material,points:number[][],radius:number){const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p as [number,number,number])));const mesh=new T.Mesh(new T.TubeGeometry(curve,24,radius,8,false),m);parent.add(mesh);return mesh;}
    function fire(x:number,y:number,z:number,height:number,lean:number){
      const geometry=new T.SphereGeometry(1,24,24);const pos=geometry.attributes.position;
      for(let i=0;i<pos.count;i++){const v=(pos.getY(i)+1)/2;const taper=Math.pow(1-v,.6);pos.setXYZ(i,pos.getX(i)*.25*taper+lean*v*v,pos.getY(i)*height/2,pos.getZ(i)*.23*taper);}
      geometry.computeVertexNormals();const mesh=new T.Mesh(geometry,flame);mesh.position.set(x,y,z);head.add(mesh);
    }
    const torso=new T.Group();root.add(torso);sphere(torso,dark,0,1.04,0,.42,.48,.29);
    sphere(torso,violet,0,1.07,.245,.28,.32,.075);tube(torso,gold,[[0,.76,.31],[0,1.32,.31]],.015);
    for(const side of [-1,1]){tube(torso,gold,[[side*.28,1.3,.24],[side*.12,1.15,.33],[side*.21,1.03,.31]],.02);sphere(torso,gold,side*.28,.92,.25,.026,.026,.016);}
    const head=new T.Group();head.position.y=1.77;root.add(head);sphere(head,skin,0,0,0,.56,.53,.43);
    if(pet==='draco'){
      sphere(head,skin,0,-.2,.37,.37,.22,.23);
      for(const s of [-1,1]){cone(head,gold,s*.37,.51,-.13,.11,.45,-s*.35);sphere(head,dark,s*.13,-.15,.568,.034,.021,.017);}
      tube(root,skin,[[0,.8,-.16],[.35,.52,-.55],[.78,.48,-.4],[.96,.7,-.2]],.105);
      for(let i=0;i<4;i++)cone(root,violet,.35+i*.16,.62+i*.025,-.46,.065,.16);
    }else{
      for(let i=0;i<9;i++){const a=i/9*Math.PI*2;fire(Math.sin(a)*.36,.43+Math.cos(a)*.09,Math.cos(a)*.29,.8+(i%3)*.12,Math.sin(a)*.25);}
      sphere(head,flame,-.42,.07,-.1,.2,.48,.3);sphere(head,flame,.42,.07,-.1,.2,.48,.3);
      fire(.02,.75,-.08,.95,.23);
    }
    const eyes:T.Mesh[]=[];
    for(const s of [-1,1]){
      sphere(head,dark,s*.235,.055,.357,.186,.216,.094);
      const eye=sphere(head,white,s*.235,.065,.417,.143,.167,.052);eyes.push(eye);
      sphere(eye,iris,0,0,.55,.63,.72,.8);sphere(eye,pupil,0,0,1,.28,.55,.35);sphere(eye,white,-.22,.3,1.2,.19,.16,.12);
      tube(head,dark,[[s*.1,.26,.4],[s*.24,.3,.4],[s*.36,.26,.36]],.035);
      sphere(head,pet==='sol'?flame:violet,s*.39,-.19,.36,.09,.035,.025);
    }
    const mouth=sphere(head,dark,0,-.305,0.4,.1,.018,.018);
    mouth.position.z=pet==='draco'?.565:.396;
    // Headset and mic are solid curves and meshes, not painted details.
    tube(head,dark,[[-.55,0,0],[-.53,.36,0],[0,.58,0],[.53,.36,0],[.55,0,0]],.043);
    for(const s of [-1,1]){sphere(head,dark,s*.55,.015,0,.1,.17,.17);sphere(head,violet,s*.62,.015,0,.035,.11,.11);}
    tube(head,dark,[[.58,-.03,.02],[.54,-.27,.33],[.24,-.3,.53]],.023);sphere(head,gold,.23,-.3,.53,.07,.04,.04);
    const arms:T.Group[]=[],legs:T.Group[]=[],wings:T.Group[]=[];
    for(const s of [-1,1]){
      const arm=new T.Group();arm.position.set(s*.43,1.32,0);root.add(arm);arms.push(arm);
      sphere(arm,dark,s*.07,-.16,0,.14,.26,.15);sphere(arm,skin,s*.09,-.43,.025,.125,.13,.115);sphere(arm,gold,s*.09,-.31,.025,.14,.04,.12);
      const leg=new T.Group();leg.position.set(s*.19,.69,0);root.add(leg);legs.push(leg);
      sphere(leg,dark,0,-.21,0,.15,.3,.16);sphere(leg,white,0,-.49,.09,.18,.11,.28);sphere(leg,violet,0,-.46,.14,.175,.095,.24);
      if(pet==='draco'){
        const wing=new T.Group();wing.position.set(s*.32,1.3,-.22);root.add(wing);wings.push(wing);
        const shape=new T.Shape();shape.moveTo(0,0);shape.quadraticCurveTo(s*.25,.58,s*.72,.66);shape.lineTo(s*.65,.04);shape.quadraticCurveTo(s*.45,.22,s*.38,-.12);shape.quadraticCurveTo(s*.16,.12,0,-.25);shape.closePath();
        const mesh=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:.035,bevelEnabled:true,bevelThickness:.012,bevelSize:.015,bevelSegments:2,steps:1}),violet);wing.add(mesh);
        tube(wing,skin,[[0,0,0],[s*.27,.44,0],[s*.72,.66,0]],.04);tube(wing,skin,[[0,0,0],[s*.4,.2,0],[s*.65,.04,0]],.024);
      }
    }
    const star=new T.Mesh(new T.OctahedronGeometry(.09),gold);star.position.set(.17,1.25,.32);root.add(star);
    const prop=new T.Group();prop.visible=false;root.add(prop);sphere(prop,white,0,.35,-.1,.4,.32,.4);sphere(prop,white,0,.5,-.35,.32,.45,.1);
    const paper=new T.Mesh(new T.BoxGeometry(.7,.4,.025),white);paper.position.set(0,.98,.48);paper.rotation.x=-.3;prop.add(paper);
    for(let i=0;i<5;i++)tube(prop,dark,[[-.27,.85+i*.055,.5],[.27,.85+i*.055,.5]],.008);
    let frame=0,last=0,time=0,visible=true;const gaze={x:0,y:0};
    const pointer=(e:PointerEvent)=>{const r=element.getBoundingClientRect();gaze.x=T.MathUtils.clamp((e.clientX-r.x-r.width/2)/400,-.35,.35);gaze.y=T.MathUtils.clamp((e.clientY-r.y-r.height/2)/500,-.18,.18);};
    window.addEventListener('pointermove',pointer,{passive:true});
    const resize=new ResizeObserver(()=>{const r=element.getBoundingClientRect();if(r.width&&r.height){renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix();}});resize.observe(element);
    const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;});observer.observe(element);
    const lost=(e:Event)=>{e.preventDefault();onUnavailable();};renderer.domElement.addEventListener('webglcontextlost',lost);
    function draw(now:number){frame=requestAnimationFrame(draw);if(document.hidden||!visible||now-last<33)return;const dt=Math.min((now-last)/1000,.05);last=now;if(!live.current.reduced)time+=dt;
      const s=live.current.state,t=time,still=live.current.reduced,walk=!still&&s==='walking',dance=!still&&(s==='dancing'||s==='celebrating'),wave=!still&&s==='greeting',stretch=!still&&s==='stretching';
      root.position.y=still?0:Math.sin(t*(walk?12:2))*(walk?.035:.018)+(dance?Math.abs(Math.sin(t*7))*.16:0);
      root.rotation.y=still?-.23:s==='turning'?Math.sin(t*1.5)*1.6:-.23+(dance?Math.sin(t*5)*.4:walk?.45:Math.sin(t*.65)*.12);
      head.rotation.y=still?0:T.MathUtils.lerp(head.rotation.y,gaze.x,dt*5);head.rotation.x=still?0:s==='sleeping'?.2:gaze.y+(s==='listening'?Math.sin(t*2)*.06:0);head.rotation.z=s==='thinking'?.14:0;
      const blink=still?1:s==='sleeping'?.08:(t%4.3>4.13?.08:1);eyes.forEach(e=>e.scale.y=.167*blink);
      mouth.scale.y=s==='talking'&&!still?.025+Math.abs(Math.sin(t*14))*.045:.018;
      arms.forEach((a,i)=>{const sign=i===0?-1:1;a.rotation.x=walk?Math.sin(t*10+i*Math.PI)*.5:s==='break'?-.9:0;a.rotation.z=stretch?sign*2.6:dance?sign*(1.8+Math.sin(t*8)*.4):wave&&i===1?2.4+Math.sin(t*10)*.35:s==='pointing'&&i===1?1.5:sign*.1;});
      legs.forEach((l,i)=>{l.rotation.x=walk?Math.sin(t*10+i*Math.PI)*.6:s==='break'?-1.2:0;l.rotation.z=dance?Math.sin(t*6+i)*.14:0;});
      wings.forEach((w,i)=>{w.rotation.y=(i===0?1:-1)*(.12+(still?0:Math.sin(t*(dance?8:2))*.17));});prop.visible=s==='break';
      renderer.render(scene,camera);
    }
    frame=requestAnimationFrame(draw);setLoaded(true);
    return()=>{cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();window.removeEventListener('pointermove',pointer);renderer.domElement.removeEventListener('webglcontextlost',lost);scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
  },[pet,onUnavailable]);
  return <span ref={host} data-companion-3d={loaded?'ready':'loading'} style={{position:'absolute',inset:0,display:'block'}}/>;
}

