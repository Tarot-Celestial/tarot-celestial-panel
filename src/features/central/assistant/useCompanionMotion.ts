'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { safePosition } from '@/lib/central-assistant';

export function useCompanionMotion(enabled: boolean, busy: boolean) {
  const ref = useRef<HTMLDivElement>(null), target = useRef({x:0,y:0}), position = useRef({x:0,y:0}), velocity = useRef({x:0,y:0});
  const [moving,setMoving] = useState(false), [highlight,setHighlight] = useState<DOMRect|null>(null);
  const highlighted = useRef<HTMLElement|null>(null), expiry = useRef(0), ready = useRef(false), enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const move = useCallback((x:number,y:number) => { target.current = safePosition(x,y,window.innerWidth,window.innerHeight); },[]);
  const dock = useCallback(() => { highlighted.current=null;setHighlight(null);move(window.innerWidth-156,window.innerHeight-218); },[move]);
  const point = useCallback((element:HTMLElement|null) => {
    if (!element) { dock(); return false; }
    const rect=element.getBoundingClientRect();
    if (!rect.width || !rect.height) { dock(); return false; }
    highlighted.current=element;expiry.current=Date.now()+6500;setHighlight(rect);
    // Keep the character beside the target rather than over the target's hit area.
    const candidates=[{x:rect.right+16,y:rect.top},{x:rect.left-152,y:rect.top},{x:rect.right-136,y:rect.bottom+18}];
    const interactive=[...document.querySelectorAll<HTMLElement>('button,input,textarea,select,[role="dialog"]')].filter(el=>!el.closest('[data-companion-root]')).map(el=>el.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);
    const candidate=candidates.find(p=>p.x>=8&&p.x+136<window.innerWidth-8&&p.y>=72&&p.y+160<window.innerHeight&&!interactive.some(r=>p.x<r.right&&p.x+136>r.left&&p.y<r.bottom&&p.y+150>r.top));
    if(candidate&&enabledRef.current)move(candidate.x,candidate.y);else dock();
    highlighted.current=element;expiry.current=Date.now()+6500;setHighlight(rect);return true;
  },[dock,move]);
  useEffect(()=>{
    if(!ready.current){position.current=safePosition(window.innerWidth-156,window.innerHeight-218,window.innerWidth,window.innerHeight);target.current={...position.current};ready.current=true;}
    let raf=0,last=0,wasMoving=false;
    function frame(time:number){
      const dt=Math.min((time-last)/1000||1/60,0.032);last=time;
      const p=position.current,t=target.current,v=velocity.current;
      if(!enabledRef.current){p.x=t.x;p.y=t.y;v.x=0;v.y=0;}
      else { const damping=Math.exp(-14*dt);v.x=(v.x+(t.x-p.x)*65*dt)*damping;v.y=(v.y+(t.y-p.y)*65*dt)*damping;p.x+=v.x*dt;p.y+=v.y*dt; }
      const active=Math.abs(t.x-p.x)+Math.abs(t.y-p.y)>1;
      if(active!==wasMoving){wasMoving=active;setMoving(active);}
      if(ref.current){ref.current.style.transform=`translate3d(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px,0)`;ref.current.style.setProperty('--bubble-offset',`${Math.max(0,260-(p.x+136))}px`);ref.current.style.setProperty('--bubble-bottom',p.y<230?'auto':'164px');ref.current.style.setProperty('--bubble-top',p.y<230?'170px':'auto');if(Math.abs(v.x)>5)ref.current.style.setProperty('--facing',v.x<0?'-1':'1');}
      if(highlighted.current){if(Date.now()>expiry.current||!highlighted.current.isConnected){highlighted.current=null;setHighlight(null);}else setHighlight(highlighted.current.getBoundingClientRect());}
      raf=requestAnimationFrame(frame);
    }
    const resize=()=>{dock();position.current=safePosition(position.current.x,position.current.y,window.innerWidth,window.innerHeight);};
    const visibility=()=>{if(document.hidden){cancelAnimationFrame(raf);}else{last=0;raf=requestAnimationFrame(frame);}};
    raf=requestAnimationFrame(frame);window.addEventListener('resize',resize);document.addEventListener('visibilitychange',visibility);
    return()=>{cancelAnimationFrame(raf);window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);};
  },[dock]);
  useEffect(()=>{if(!enabled||busy)dock();},[enabled,busy,dock]);
  return {ref,moving,highlight,point,dock,move};
}
