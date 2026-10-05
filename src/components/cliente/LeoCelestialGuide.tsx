"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Check, Compass, EyeOff, Footprints, Gift, MessageCircle, RotateCw, Send, Sparkles, X, BellOff, Bell, ChevronLeft } from "lucide-react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { useRouletteSignal } from "@/hooks/useRouletteSignal";
import { isLeoCelestialEventDetail, LEO_CELESTIAL_EVENT, type LeoCelestialEventDetail } from "@/lib/leo-celestial-events";
import { leoContextForPath } from "@/lib/leo-celestial-intelligence";
import { emptyLeoSnapshot, leoAction, leoHelp, leoQuestion, leoSection, leoSelector, leoSpins, safeLeoPath, validLeoAction, LEO_SECTIONS, LEO_SELECT_ROULETTE, type LeoAction, type LeoSnapshot, type LeoTopic } from "@/lib/leo-guide";
import styles from "./LeoCelestialGuide.module.css";
const sb = supabaseClienteBrowser();
const TOPICS: Array<[LeoTopic,string]> = [['roulette','Mis giros'],['balance','Mi saldo'],['rank','Mi rango'],['daily','Bono diario'],['oracle','Oráculo'],['prizes','Mis premios']];
type Point = { x: number; y: number };
type Highlight = { left:number; top:number; width:number; height:number };
type Journey = { action: LeoAction; stage: 'looking'|'walking'|'arrived'|'missing'; tour: boolean; index: number };
export default function LeoCelestialGuide({ promoActive }: { promoActive: boolean }) {
  const pathname = usePathname(), router = useRouter();
  const [data,setData] = useState<LeoSnapshot>(emptyLeoSnapshot);
  const [open,setOpen] = useState(false), [hidden,setHidden] = useState(false), [muted,setMuted] = useState(false);
  const [expanded,setExpanded] = useState(false);
  const [motion,setMotion] = useState(false), [visible,setVisible] = useState(true), [loading,setLoading] = useState(false);
  const [topic,setTopic] = useState<LeoTopic>('context'), [question,setQuestion] = useState('');
  const [journey,setJourney] = useState<Journey|null>(null), [position,setPosition] = useState<Point|null>(null), [highlight,setHighlight] = useState<Highlight|null>(null);
  const [reaction,setReaction] = useState<LeoCelestialEventDetail|null>(null), [sleeping,setSleeping] = useState(false);
  const [uid,setUid] = useState<string|null>(null), [ready,setReady] = useState(false);
  const [imageFailed,setImageFailed] = useState(false);
  const abort = useRef<AbortController|null>(null), epoch = useRef(0), userRef = useRef<string|null>(null), readyRef = useRef(false);
  const focusReturn = useRef<HTMLElement|null>(null), panelRef = useRef<HTMLElement|null>(null), characterRef = useRef<HTMLButtonElement|null>(null);
  const lastReaction = useRef(''), prefEdited = useRef(false);
  const section = leoSection(pathname);
  const help = useMemo(()=>leoHelp(data,pathname,topic),[data,pathname,topic]);
  const spins = useMemo(()=>leoSpins(data.roulette),[data.roulette]);
  const usable = spins.filter(s=>s.playable).reduce((n,s)=>n+s.amount,0);
  const storageKey = (id:string) => `tc-leonaris-preferences:${id}`;
  const journeyKey = (id:string) => `tc-leonaris-journey:${id}`;

  const signal = useCallback(async (action:string, extra:Record<string,unknown>={})=>{
    try {
      const session=(await sb.auth.getSession()).data.session;
      if(!session) return;
      await fetch('/api/cliente/leo',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,pathname,context:leoContextForPath(pathname),...extra}),signal:AbortSignal.timeout(10000)});
    }catch{ /* Preferences also survive locally. */ }
  },[pathname]);
  const refresh = useCallback(async()=>{
    abort.current?.abort(); const controller=new AbortController();abort.current=controller;
    const version=++epoch.current;setLoading(true);
    const timeout=window.setTimeout(()=>controller.abort(),14000);
    try {
      const session=(await sb.auth.getSession()).data.session;
      if(!session){ if(version===epoch.current){setData(emptyLeoSnapshot());setUid(null);userRef.current=null;} return; }
      if(userRef.current!==session.user.id){
        userRef.current=session.user.id;setUid(session.user.id);setData(emptyLeoSnapshot());readyRef.current=false;prefEdited.current=false;
      }
      const get=async(path:string)=>{
        try {const r=await fetch(path,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:controller.signal}); const json=await r.json();return r.ok&&json.ok?json:null;} catch{return null;}
      };
      const [leo,roulette,ranks,bonus,oracle]=await Promise.all([get('/api/cliente/leo'),get('/api/cliente/ruleta'),get('/api/cliente/rangos'),get('/api/cliente/rank-benefits'),pathname==='/cliente/oraculo'?get('/api/cliente/oraculo'):Promise.resolve(null)]);
      if(version!==epoch.current) return;
      if(controller.signal.aborted){setData(emptyLeoSnapshot());return;}
      let pending: {level:number}|null=null;
      try { const saved=roulette?.cliente_id && JSON.parse(sessionStorage.getItem('tc-ruleta-pending:'+roulette.cliente_id)||'null');if(saved?.spin_id && [1,2,3,4,5].includes(saved.level))pending={level:saved.level}; }catch{}
      setData({pending,wallet:leo?.facts||null,roulette,ranks,bonuses:bonus?.bonuses||null,oracle:oracle?{credits:oracle.credits,freeAvailable:!!oracle.freeAvailable}:null,updatedAt:Date.now()});
      if(!readyRef.current){
        readyRef.current=true;
        let prefs=leo?.profile;
        try {const saved=localStorage.getItem(storageKey(session.user.id));if(saved)prefs=JSON.parse(saved);}catch{}
        if(!prefEdited.current){setHidden(!!prefs?.hidden);setMuted(!!prefs?.muted);}
        try {
          const pending=JSON.parse(sessionStorage.getItem(journeyKey(session.user.id))||'null');
          if(pending?.expires>Date.now()&&pending?.action?.path?.split('?')[0]===pathname&&validLeoAction(pending.action)){
            sessionStorage.removeItem(journeyKey(session.user.id));setJourney({action:pending.action,stage:'looking',tour:false,index:0});setOpen(true);setHidden(false);
          }
        }catch{}
      }
    } catch {
      if(version===epoch.current)setData(emptyLeoSnapshot());
    } finally {
      window.clearTimeout(timeout);
      if(version===epoch.current){setLoading(false);setReady(true);}
    }
  },[pathname]);
  useEffect(()=>{void refresh();return()=>{++epoch.current;abort.current?.abort();};},[refresh]);
  useRouletteSignal(sb,hidden?null:data.ranks?.cliente_id,refresh);
  useEffect(()=>{
    const {data:subscription}=sb.auth.onAuthStateChange((event)=>{
      if(event==='SIGNED_OUT'){++epoch.current;abort.current?.abort();setData(emptyLeoSnapshot());setUid(null);setJourney(null);setOpen(false);setReady(false);userRef.current=null;}
      if(event==='SIGNED_IN')void refresh();
    });return()=>subscription.subscription.unsubscribe();
  },[refresh]);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: no-preference)');
    const update=()=>setMotion(media.matches), visibility=()=>{setVisible(!document.hidden);if(!document.hidden)void refresh();};
    update();setVisible(!document.hidden);media.addEventListener('change',update);document.addEventListener('visibilitychange',visibility);
    const balances=()=>void refresh();window.addEventListener('tc-client-balances-changed',balances);
    let channel:BroadcastChannel|null=null;
    try{channel=new BroadcastChannel('tc-oracle-balance');channel.onmessage=balances;}catch{}
    return()=>{media.removeEventListener('change',update);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('tc-client-balances-changed',balances);channel?.close();};
  },[refresh]);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    const react=(event:Event)=>{const detail=(event as CustomEvent).detail;if(!isLeoCelestialEventDetail(detail)||detail.id&&detail.id===lastReaction.current)return;lastReaction.current=detail.id||'';setReaction(detail);setSleeping(false);void refresh();clearTimeout(timer);timer=setTimeout(()=>setReaction(null),10000);};
    window.addEventListener(LEO_CELESTIAL_EVENT,react);return()=>{clearTimeout(timer);window.removeEventListener(LEO_CELESTIAL_EVENT,react);};
  },[refresh]);
  useEffect(()=>{
    setTopic('context');setJourney(null);setPosition(null);setHighlight(null);setReaction(null);readyRef.current=false;
  },[pathname]);
  useEffect(()=>{
    const image=new window.Image();image.src='/leonaris-sprites.png';image.onerror=()=>setImageFailed(true);
    const timer=window.setTimeout(()=>setSleeping(true),60000);return()=>window.clearTimeout(timer);
  },[open,pathname]);
  useEffect(()=>{
    if(!open)return;
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);setJourney(null);focusReturn.current?.focus();}};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[open]);

  // A route may still be loading. Observe briefly, then explain a missing target.
  useEffect(()=>{
    if(!journey)return;
    const action=journey.action,selector=leoSelector(action.anchor);if(!selector)return;
    let target:HTMLElement|null=null,raf=0,disposed=false,scrolled=false;
    const timers:Array<ReturnType<typeof setTimeout>>=[];
    const place=()=>{
      if(!target?.isConnected){setHighlight(null);return;}
      const rect=target.getBoundingClientRect(),screenW=window.innerWidth,screenH=window.innerHeight;
      if(rect.bottom<0||rect.top>screenH){setHighlight(null);setPosition(null);return;}
      setHighlight({left:Math.max(4,rect.left-5),top:Math.max(4,rect.top-5),width:Math.min(rect.width+10,screenW-8),height:Math.min(rect.bottom,screenH-5)-Math.max(4,rect.top)+5});
      let x=rect.top>145?rect.left+rect.width/2-66:rect.left>145?rect.left-137:Math.min(screenW-135,rect.right-118);
      let y=rect.top>145?rect.top-133:Math.max(8,Math.min(screenH-145,rect.top+12));
      const panel=panelRef.current?.getBoundingClientRect();
      if(panel && x+132>panel.left && x<panel.right && y+142>panel.top && y<panel.bottom)y=Math.max(6,panel.top-145);
      setPosition({x:Math.max(6,x),y:Math.max(6,y)});
    };
    const find=()=>{
      if(disposed||scrolled)return;
      target=selector.split(',').map(part=>document.querySelector<HTMLElement>(part.trim())).find(el=>!!el && el.getBoundingClientRect().height>=8)||null;
      if(!target||target.getBoundingClientRect().height<8)return;
      scrolled=true;observer.disconnect();
      if(action.level)window.dispatchEvent(new CustomEvent(LEO_SELECT_ROULETTE,{detail:{level:action.level}}));
      target.scrollIntoView({behavior:motion?'smooth':'auto',block:'center'});
      setJourney(j=>j?{...j,stage:'walking'}:null);
      timers.push(setTimeout(place,motion?380:0));
      timers.push(setTimeout(()=>{if(!disposed){
        const control=target?.querySelector<HTMLElement>('[data-leo-spin], [data-leo-explore]');
        const panel=panelRef.current?.getBoundingClientRect();
        if(window.innerWidth<=600 && control && panel){const button=control.getBoundingClientRect();if(button.bottom>panel.top-18)window.scrollBy({top:button.bottom-panel.top+24,behavior:'auto'});}
        place();setJourney(j=>j?{...j,stage:'arrived'}:null);
      }},motion?1550:20));
    };
    const observer=new MutationObserver(()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;find();});});
    observer.observe(document.body,{childList:true,subtree:true});find();
    timers.push(setTimeout(()=>{observer.disconnect();if(!scrolled&&!disposed){setJourney(j=>j?{...j,stage:'missing'}:null);setHighlight(null);setPosition(null);}},8500));
    const adjust=()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;place();});};
    window.addEventListener('resize',adjust);window.addEventListener('scroll',adjust,{passive:true});
    return()=>{disposed=true;observer.disconnect();cancelAnimationFrame(raf);timers.forEach(clearTimeout);window.removeEventListener('resize',adjust);window.removeEventListener('scroll',adjust);};
  },[journey?.action.id,journey?.index,motion]);
  useEffect(()=>{if(!journey){setPosition(null);setHighlight(null);}},[journey]);

  function preferences(next:{hidden?:boolean;muted?:boolean}){
    const value={hidden:next.hidden??hidden,muted:next.muted??muted};prefEdited.current=true;setHidden(value.hidden);setMuted(value.muted);
    if(value.hidden){setOpen(false);setJourney(null);}
    try{if(uid)localStorage.setItem(storageKey(uid),JSON.stringify(value));}catch{}
    void signal('preference',value);
  }
  function show(){setExpanded(false);focusReturn.current=document.activeElement as HTMLElement;setOpen(true);setSleeping(false);setReaction(null);setTimeout(()=>panelRef.current?.focus(),20);}
  function go(action:LeoAction,tour=false,index=0){
    if(!validLeoAction(action))return;
    setExpanded(false);
    setSleeping(false);setReaction(null);setOpen(true);
    if(action.path.split('?')[0]!==pathname){
      if(uid)try{sessionStorage.setItem(journeyKey(uid),JSON.stringify({action,expires:Date.now()+30000}));}catch{}
      router.push(action.path);return;
    }
    setJourney({action,stage:'looking',tour,index});
  }
  const tourSteps=useMemo(()=>{
    const intro=leoAction('navigation','Tus accesos',pathname,'navigation','Estas son tus pestañas. Puedes moverte entre ellas y volver a pedirme ayuda en cualquiera.');
    if(section.key==='roulette')return [intro,...leoHelp(data,pathname,'roulette').actions];
    if(section.key==='ranks')return [intro,...leoHelp(data,pathname,'rank').actions.map(a=>({...a,path:pathname})),leoAction('ranks-content','Todos los rangos',pathname,'content','Cada tarjeta explica cómo alcanzar ese rango y sus ventajas. Abre «Extras según tu paquete» para ver el detalle.')];
    if(section.key==='dashboard')return [intro,...leoHelp(data,pathname,'balance').actions];
    return [intro,leoAction('section-content',section.label,pathname,'content',section.hint)];
  },[pathname,section.key,spins,data]);
  function ask(event:React.FormEvent){event.preventDefault();if(!question.trim())return;const intent=leoQuestion(question);setQuestion('');setJourney(null);setReaction(null);if(intent.startsWith('/')){const action=leoHelp(data,intent,'context').actions[0];if(action)go(action);}else{setTopic(intent as LeoTopic);void refresh();}}
  if(!ready||!uid)return null;
  if(hidden)return <button type="button" className={styles.restore} onClick={()=>{preferences({hidden:false});show();}}><Compass size={17}/> Mostrar Leonaris</button>;
  const walking=journey?.stage==='walking',pose=walking?'walk':reaction&&!muted?'celebrate':journey?.stage==='arrived'?'point':sleeping&&!open?'sleep':'idle';
  return <aside className={styles.guide} data-paused={!motion||!visible} data-journey={!!journey} aria-label="Leonaris, tu guía celestial">
    {highlight&&<div className={styles.highlight} style={highlight} aria-hidden="true"><span>✦ AQUÍ ES</span></div>}
    {open&&<section ref={panelRef} tabIndex={-1} className={styles.panel} data-expanded={expanded} aria-label="Ayuda de Leonaris">
      <header className={styles.header}><div className={styles.seal}><Sparkles size={19}/></div><div><strong>LEONARIS</strong><span>Tu guía celestial <i/></span></div><div className={styles.controls}>
        <button type="button" className={styles.resizeButton} onClick={()=>setExpanded(current=>!current)} aria-expanded={expanded} aria-label={expanded?"Reducir ayuda":"Ampliar ayuda"}>{expanded?"Reducir":"Ampliar"}</button>
        <button type="button" onClick={()=>preferences({muted:!muted})} aria-label={muted?'Activar avisos de Leonaris':'Silenciar avisos de Leonaris'} aria-pressed={muted} title={muted?'Activar avisos':'Silenciar avisos'}>{muted?<BellOff size={16}/>:<Bell size={16}/>}</button>
        <button type="button" onClick={()=>preferences({hidden:true})} aria-label="Ocultar Leonaris" title="Ocultar mascota"><EyeOff size={16}/></button>
        <button type="button" onClick={()=>{setOpen(false);setJourney(null);characterRef.current?.focus();}} aria-label="Cerrar ayuda"><X size={18}/></button>
      </div></header>
      <div className={styles.content}>
      {journey?<div className={styles.journeyBody}>
        <span className={styles.eyebrow}><Footprints size={13}/>{journey.tour?`PASO ${journey.index+1} DE ${tourSteps.length}`:'VAMOS JUNTAS'}</span>
        <h2>{journey.stage==='looking'?'Buscando tu recuadro…':journey.stage==='walking'?'Sígueme, es por aquí':journey.stage==='missing'?'Este recuadro no está disponible':journey.action.label}</h2>
        <p role="status">{journey.stage==='missing'?'Puede que esta sección todavía esté cargando o no tenga contenido para tu cuenta. Puedes actualizar la página o seguir explorando.':journey.action.explanation}</p>
        <div className={styles.journeyButtons}>{journey.tour&&journey.index>0&&<button onClick={()=>go(tourSteps[journey.index-1],true,journey.index-1)} aria-label="Paso anterior"><ChevronLeft size={17}/></button>}
          {journey.tour&&journey.index<tourSteps.length-1?<button className={styles.primary} onClick={()=>go(tourSteps[journey.index+1],true,journey.index+1)}>Siguiente <ArrowRight size={16}/></button>:<button className={styles.primary} onClick={()=>{setJourney(null);setOpen(false);}}>Ya lo tengo <Check size={16}/></button>}
          <button onClick={()=>setJourney(null)}>Terminar guía</button></div>
      </div>:<>
        <div className={styles.context}><span><i/> ESTÁS EN {section.label.toUpperCase()}</span><button type="button" onClick={()=>void refresh()} disabled={loading} aria-label="Actualizar información de Leonaris"><RotateCw size={13} className={loading?styles.refreshing:''}/></button></div>
        <div className={styles.topicGrid}>{TOPICS.map(([key,label])=><button key={key} type="button" data-active={topic===key} onClick={()=>{setTopic(key);setReaction(null);if(Date.now()-data.updatedAt>15000)void refresh();}}>{label}</button>)}</div>
        <div className={styles.answer} aria-busy={loading}>
          <span className={styles.eyebrow}><Sparkles size={12}/>{loading?'CONSULTANDO TU CUENTA':'UN PASO CADA VEZ'}</span>
          <h2>{reaction&&!muted?reaction.title:help.title}</h2>
          <p>{reaction&&!muted?reaction.message:help.message}</p>
          <div className={styles.actions}>{(reaction&&!muted&&safeLeoPath(reaction.href)?[leoAction('reaction',reaction.actionLabel||'Ver detalle',reaction.href,'content','Aquí puedes consultar el detalle de esta novedad.')]:help.actions).map((action,index)=><button type="button" key={action.id} className={index===0?styles.primary:styles.secondary} onClick={()=>go(action)}>{action.label}<ArrowRight size={15}/></button>)}</div>
          {help.note&&<small className={styles.note}>{help.note}</small>}
        </div>
        <div className={styles.tools}><button type="button" onClick={()=>go(tourSteps[0],true,0)}><Footprints size={16}/> Guíame aquí</button><button type="button" onClick={()=>setTopic('sections')}><Compass size={16}/> Explorar panel</button></div>
        <form className={styles.ask} onSubmit={ask}><label className={styles.srOnly} htmlFor="leonaris-question">¿En qué te ayudo?</label><input id="leonaris-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={180} placeholder="¿Qué giro tengo? ¿Dónde está mi premio?" autoComplete="off"/><button type="submit" disabled={!question.trim()} aria-label="Consultar a Leonaris"><Send size={17}/></button></form>
        <footer className={styles.footer}>Guía del panel · {loading?'actualizando':data.updatedAt?'consulta '+new Date(data.updatedAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'información pendiente'}</footer>
      </>}
      </div>
    </section>}
    <div className={styles.companion} style={position?{left:position.x,top:position.y,right:'auto',bottom:'auto'}:undefined}>
      {!open&&!journey&&!muted&&<button type="button" className={styles.teaser} onClick={show}>{reaction?<><Gift size={15}/>{reaction.title}</>:<><MessageCircle size={15}/>{data.pending?'Resultado por comprobar':usable?`${usable} giro${usable===1?'':'s'} · Te llevo`:'¿Te acompaño?'}</>}<span/></button>}
      <button ref={characterRef} type="button" className={styles.character} onClick={()=>{if(open){setOpen(false);setJourney(null);}else show();}} aria-label={open?'Minimizar ayuda de Leonaris':'Abrir ayuda de Leonaris'} aria-expanded={open}>
        <span className={styles.floor} aria-hidden="true"/>
        {imageFailed?<span className={styles.fallback} aria-hidden="true">🦁</span>:<span className={styles.sprite} data-pose={pose} aria-hidden="true"/>}
        <span className={styles.name}>LEONARIS <Sparkles size={9}/></span>
      </button>
    </div>
    <span className={styles.srOnly} role="status">{journey?.stage==='arrived'?journey.action.explanation:''}</span>
  </aside>;
}