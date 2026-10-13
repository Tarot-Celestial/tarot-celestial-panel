"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, Check, Compass, EyeOff, Footprints, Gift, MessageCircle, RotateCw, Send, Sparkles, X, BellOff, Bell, ChevronLeft, Brain, Trash2, ThumbsUp, ThumbsDown } from "lucide-react";
import { supabaseClienteBrowser } from "@/lib/supabase-browser";
import { useRouletteSignal } from "@/hooks/useRouletteSignal";
import { isLeoCelestialEventDetail, LEO_CELESTIAL_EVENT } from "@/lib/leo-celestial-events";
import { emptyLeoSnapshot, leoAction, leoHelp, leoSection, leoSelector, leoSpins, validLeoAction, LEO_SELECT_ROULETTE, type LeoAction, type LeoSnapshot, type LeoTopic } from "@/lib/leo-guide";
import { useLeonarisMotion } from "./useLeonarisMotion";
import { clampLeonaris } from "@/lib/leonaris-motion";
import type { LeoCompanion } from "@/lib/leonaris-companion";
import styles from "./LeoCelestialGuide.module.css";
const sb = supabaseClienteBrowser();
const TOPICS: Array<[LeoTopic,string]> = [['roulette','Mis giros'],['balance','Mi saldo'],['rank','Mi rango'],['daily','Bono diario'],['oracle','Oráculo'],['prizes','Mis premios']];
type Point = { x: number; y: number };
type Highlight = { left:number; top:number; width:number; height:number };
type Journey = { action: LeoAction; stage: 'looking'|'walking'|'arrived'|'missing'; tour: boolean; index: number };
type Answer = { id: string; title: string; message: string; actions: LeoAction[]; mode?: 'ai'|'guided' };
type Companion = LeoCompanion;
const emptyCompanion = (): Companion => ({displayName:null,memoryEnabled:false,style:'warm',memories:[],favoriteSections:[],learning:{helpful:0,unhelpful:0,visits:0,summary:'Todavía no hay aprendizaje registrado.'},greeting:null});
const safeAnswer = (value: unknown): Answer|null => {
  const answer=value as Answer|null;
  if(!answer || typeof answer.id!=='string' || typeof answer.title!=='string' || typeof answer.message!=='string')return null;
  return {id:answer.id,title:answer.title,message:answer.message,actions:Array.isArray(answer.actions)?answer.actions.filter(validLeoAction):[],mode:answer.mode==='ai'?'ai':answer.mode==='guided'?'guided':undefined};
};
export default function LeoCelestialGuide({ promoActive }: { promoActive: boolean }) {
  const pathname = usePathname(), router = useRouter();
  const [data,setData] = useState<LeoSnapshot>(emptyLeoSnapshot);
  const [open,setOpen] = useState(false), [hidden,setHidden] = useState(false), [muted,setMuted] = useState(false);
  const [expanded,setExpanded] = useState(false);
  const [motion,setMotion] = useState(false), [visible,setVisible] = useState(true), [loading,setLoading] = useState(false);
  const [topic,setTopic] = useState<LeoTopic>('context'), [question,setQuestion] = useState('');
  const [journey,setJourney] = useState<Journey|null>(null), [position,setPosition] = useState<Point|null>(null), [highlight,setHighlight] = useState<Highlight|null>(null);
  const [reaction,setReaction] = useState<Answer|null>(null), [sleeping,setSleeping] = useState(false), [waving,setWaving] = useState(false);
  const [companion,setCompanion] = useState<Companion>(emptyCompanion), [answer,setAnswer] = useState<Answer|null>(null);
  const [memoryOpen,setMemoryOpen] = useState(false), [memoryDraft,setMemoryDraft] = useState('');
  const [memoryAvailable,setMemoryAvailable] = useState<boolean|null>(null);
  const [chatBusy,setChatBusy] = useState(false), [saving,setSaving] = useState(false), [error,setError] = useState('');
  const [feedback,setFeedback] = useState<Record<string,boolean>>({}), [confirmForget,setConfirmForget] = useState(false);
  const [uid,setUid] = useState<string|null>(null), [ready,setReady] = useState(false);
  const [spriteSheet,setSpriteSheet] = useState<'loading'|'v2'|'legacy'|'unavailable'>('loading'), [blinking,setBlinking] = useState(false);
  const [activity,setActivity] = useState(0);
  const abort = useRef<AbortController|null>(null), epoch = useRef(0), userRef = useRef<string|null>(null), readyRef = useRef(false);
  const accountEpoch = useRef(0), mutationEpoch = useRef(0), requests = useRef(new Set<AbortController>());
  const chatEpoch = useRef(0), chatAbort = useRef<AbortController|null>(null), chatRequest = useRef<{uid:string;pathname:string;message:string;id:string}|null>(null);
  const currentPath = useRef(pathname);currentPath.current=pathname;
  const sessionMarker = useRef(''), visitRef = useRef(''), greetingSeen = useRef(new Set<string>()), profileRef = useRef({hidden:false,muted:false});
  const focusReturn = useRef<HTMLElement|null>(null), panelRef = useRef<HTMLElement|null>(null), characterRef = useRef<HTMLButtonElement|null>(null);
  const lastReaction = useRef(''), waveTimer = useRef<ReturnType<typeof setTimeout>|null>(null), focusTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const section = leoSection(pathname);
  const help = useMemo(()=>leoHelp(data,pathname,topic),[data,pathname,topic]);
  const spins = useMemo(()=>leoSpins(data.roulette),[data.roulette]);
  const usable = spins.filter(s=>s.playable).reduce((n,s)=>n+s.amount,0);
  const storageKey = (id:string) => `tc-leonaris-preferences:${id}`;
  const journeyKey = (id:string) => `tc-leonaris-journey:${id}`;

  const wake = useCallback(()=>{
    setSleeping(false);setWaving(true);setActivity(value=>value+1);
    if(waveTimer.current)clearTimeout(waveTimer.current);
    waveTimer.current=setTimeout(()=>setWaving(false),1800);
  },[]);
  const pet = useLeonarisMotion({uid,enabled:ready&&!hidden,motion,visible,journey:!!journey,onWake:wake});
  const clearAccount = useCallback((id:string|null, marker='')=>{
    ++accountEpoch.current;++epoch.current;++mutationEpoch.current;++chatEpoch.current;chatRequest.current=null;abort.current?.abort();requests.current.forEach(controller=>controller.abort());requests.current.clear();
    userRef.current=id;sessionMarker.current=marker;setUid(id);readyRef.current=false;setReady(false);visitRef.current='';greetingSeen.current.clear();lastReaction.current='';
    profileRef.current={hidden:false,muted:false};setHidden(false);setMuted(false);setData(emptyLeoSnapshot());setCompanion(emptyCompanion());setMemoryAvailable(null);setAnswer(null);setReaction(null);setQuestion('');setMemoryDraft('');setMemoryOpen(false);setConfirmForget(false);setFeedback({});setError('');setChatBusy(false);setSaving(false);setLoading(false);setOpen(false);setJourney(null);setPosition(null);setHighlight(null);setWaving(false);setSleeping(false);
    if(waveTimer.current)clearTimeout(waveTimer.current);if(focusTimer.current)clearTimeout(focusTimer.current);
  },[]);
  const applyLeo = useCallback((payload:any, id:string)=>{
    if(userRef.current!==id)return;
    if(payload?.profile){
      const value={hidden:!!payload.profile.hidden,muted:!!payload.profile.muted};profileRef.current=value;setHidden(value.hidden);setMuted(value.muted);
      if(value.hidden){setOpen(false);setJourney(null);}
      try{localStorage.setItem(storageKey(id),JSON.stringify(value));}catch{}
    }
    if(payload?.facts)setData(current=>({...current,wallet:payload.facts,updatedAt:Date.now()}));
    if(!payload?.companion)return;
    setMemoryAvailable(true);
    const source=payload.companion, next:Companion={
      displayName:typeof source.displayName==='string'?source.displayName:null,memoryEnabled:source.memoryEnabled===true,style:source.style==='concise'?'concise':'warm',
      memories:Array.isArray(source.memories)?source.memories.filter((item:any)=>typeof item?.id==='string'&&typeof item?.content==='string'):[],
      favoriteSections:Array.isArray(source.favoriteSections)?source.favoriteSections.filter((item:any)=>typeof item?.context==='string'&&typeof item?.label==='string'&&typeof item?.path==='string'):[],
      learning:{helpful:Math.max(0,Number(source.learning?.helpful)||0),unhelpful:Math.max(0,Number(source.learning?.unhelpful)||0),visits:Math.max(0,Number(source.learning?.visits)||0),summary:typeof source.learning?.summary==='string'?source.learning.summary:'Todavía no hay aprendizaje registrado.'},
      greeting:safeAnswer(source.greeting),
    };
    setCompanion(next);
    const greeting=next.greeting;
    if(!greeting||profileRef.current.muted||profileRef.current.hidden)return;
    const key=`tc-leonaris-greetings:${id}:${sessionMarker.current}`;
    try{const saved=JSON.parse(sessionStorage.getItem(key)||'[]');if(Array.isArray(saved))saved.filter(item=>typeof item==='string').forEach(item=>greetingSeen.current.add(item));}catch{}
    if(greetingSeen.current.has(greeting.id))return;
    greetingSeen.current.add(greeting.id);try{sessionStorage.setItem(key,JSON.stringify([...greetingSeen.current].slice(-40)));}catch{}
    setReaction(greeting);wake();
  },[wake]);
  const signal = useCallback(async (action:string, extra:Record<string,unknown>={}, quiet=false)=>{
    const id=userRef.current, account=accountEpoch.current;if(!id)return null;
    const controller=new AbortController();requests.current.add(controller);
    if(action==='chat')chatAbort.current=controller;
    let timedOut=false;const timeout=window.setTimeout(()=>{timedOut=true;controller.abort();},action==='chat'?45000:16000);
    const version=action==='visit'||action==='interaction'?mutationEpoch.current:++mutationEpoch.current;
    let message='No he podido confirmar la petición. Actualiza la información antes de volver a intentarlo.';
    try {
      const session=(await sb.auth.getSession()).data.session;
      if(!session||session.user.id!==id||account!==accountEpoch.current)return null;
      const response=await fetch('/api/cliente/leo',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,pathname,context:leoSection(pathname).key,...extra}),signal:controller.signal});
      const payload=await response.json();
      if(account!==accountEpoch.current||userRef.current!==id)return null;
      if(response.status===503)setMemoryAvailable(false);
      if(!response.ok||!payload.ok){if(typeof payload.error==='string'&&payload.error.length<=500)message=payload.error;throw new Error(message);}
      if(version===mutationEpoch.current)applyLeo(payload,id);
      return payload;
    }catch{
      if(account===accountEpoch.current&&!quiet&&(!controller.signal.aborted||timedOut))setError(timedOut?'La respuesta está tardando. Puedes volver a intentarlo; comprobaré la misma consulta.':message);
      return null;
    }finally{clearTimeout(timeout);requests.current.delete(controller);if(chatAbort.current===controller)chatAbort.current=null;}
  },[pathname,applyLeo]);
  const refresh = useCallback(async()=>{
    abort.current?.abort(); const controller=new AbortController();abort.current=controller;
    const version=++epoch.current,account=accountEpoch.current,mutation=mutationEpoch.current,id=userRef.current;if(!id)return;setLoading(true);
    const timeout=window.setTimeout(()=>controller.abort(),14000);
    try {
      const session=(await sb.auth.getSession()).data.session;
      if(!session||session.user.id!==id||account!==accountEpoch.current)return;
      const get=async(path:string)=>{
        try {const r=await fetch(path,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:controller.signal}); const json=await r.json();return r.ok&&json.ok?json:null;} catch{return null;}
      };
      const [leo,roulette,ranks,bonus,oracle]=await Promise.all([get('/api/cliente/leo'),get('/api/cliente/ruleta'),get('/api/cliente/rangos'),get('/api/cliente/rank-benefits'),pathname==='/cliente/oraculo'?get('/api/cliente/oraculo'):Promise.resolve(null)]);
      if(version!==epoch.current||account!==accountEpoch.current||userRef.current!==id||mutation!==mutationEpoch.current)return;
      if(controller.signal.aborted)return;
      setMemoryAvailable(!!leo?.companion);
      let pending: {level:number}|null=null;
      try { const saved=roulette?.cliente_id && JSON.parse(sessionStorage.getItem('tc-ruleta-pending:'+roulette.cliente_id)||'null');if(saved?.spin_id && [1,2,3,4,5].includes(saved.level))pending={level:saved.level}; }catch{}
      setData({pending,wallet:leo?.facts||null,roulette,ranks,bonuses:bonus?.bonuses||null,oracle:oracle?{credits:oracle.credits,freeAvailable:!!oracle.freeAvailable}:null,updatedAt:Date.now()});
      if(leo)applyLeo(leo,id);
      if(!readyRef.current){
        readyRef.current=true;
        // Persisted server preferences win. Local preferences are only an offline fallback.
        if(!leo?.profile)try{const prefs=JSON.parse(localStorage.getItem(storageKey(id))||'null');if(prefs){profileRef.current={hidden:!!prefs.hidden,muted:!!prefs.muted};setHidden(!!prefs.hidden);setMuted(!!prefs.muted);}}catch{}
        try {
          const pending=JSON.parse(sessionStorage.getItem(journeyKey(session.user.id))||'null');
          if(pending?.expires>Date.now()&&pending?.action?.path?.split('?')[0]===pathname&&validLeoAction(pending.action)){
            sessionStorage.removeItem(journeyKey(session.user.id));setJourney({action:pending.action,stage:'looking',tour:false,index:0});setOpen(true);setHidden(false);
          }
        }catch{}
      }
    } catch {
      if(version===epoch.current&&account===accountEpoch.current)setError('No puedo actualizar tu cuenta ahora. Puedes volver a intentarlo.');
    } finally {
      window.clearTimeout(timeout);
      if(version===epoch.current&&account===accountEpoch.current){setLoading(false);setReady(true);}
    }
  },[pathname,applyLeo]);
  useEffect(()=>{if(uid)void refresh();return()=>{++epoch.current;abort.current?.abort();};},[uid,refresh]);
  useRouletteSignal(sb,hidden?null:data.ranks?.cliente_id,refresh);
  useEffect(()=>{
    let active=true,revision=0;
    const accept=(session:any)=>{
      if(!active)return;
      const id=session?.user?.id||null;
      let marker=session?.user?.last_sign_in_at||'session';
      try{const encoded=session.access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');marker=JSON.parse(atob(encoded)).session_id||marker;}catch{}
      if(id!==userRef.current||(id&&marker!==sessionMarker.current))clearAccount(id,marker);
    };
    const {data:subscription}=sb.auth.onAuthStateChange((_event,session)=>{revision++;accept(session);});
    const initial=revision;void sb.auth.getSession().then(({data:session})=>{if(revision===initial)accept(session.session);}).catch(()=>accept(null));
    return()=>{active=false;subscription.subscription.unsubscribe();++epoch.current;++accountEpoch.current;abort.current?.abort();requests.current.forEach(controller=>controller.abort());if(waveTimer.current)clearTimeout(waveTimer.current);if(focusTimer.current)clearTimeout(focusTimer.current);};
  },[clearAccount]);
  useEffect(()=>{
    if(!uid||!ready||!visible||!companion.memoryEnabled||!memoryAvailable)return;
    const key=uid+':'+pathname;if(visitRef.current===key)return;visitRef.current=key;
    void signal('visit',{},true);
  },[uid,ready,visible,pathname,signal,companion.memoryEnabled,memoryAvailable]);
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
    const react=(event:Event)=>{const detail=(event as CustomEvent).detail;if(!isLeoCelestialEventDetail(detail)||detail.id&&detail.id===lastReaction.current)return;lastReaction.current=detail.id||'';void refresh();};
    // Browser events request fresh facts. Their title, message and prize amount are never displayed as proof.
    window.addEventListener(LEO_CELESTIAL_EVENT,react);return()=>window.removeEventListener(LEO_CELESTIAL_EVENT,react);
  },[refresh]);
  useEffect(()=>{
    setTopic('context');setJourney(null);setPosition(null);setHighlight(null);setAnswer(null);setReaction(null);setError('');readyRef.current=false;
  },[pathname]);
  useEffect(()=>{
    let disposed=false;
    const image=new window.Image();image.decoding='async';
    const legacy=()=>{if(disposed)return;image.onload=()=>{if(!disposed)setSpriteSheet('legacy');};image.onerror=()=>{if(!disposed)setSpriteSheet('unavailable');};image.src='/leonaris-sprites.png';};
    image.onload=async()=>{try{await image.decode();if(!disposed)setSpriteSheet('v2');}catch{legacy();}};
    image.onerror=legacy;image.src='/companions/leonaris-v2.png';
    return()=>{disposed=true;image.onload=null;image.onerror=null;};
  },[]);
  useEffect(()=>{
    if(!visible||open||hidden)return;
    const timer=window.setTimeout(()=>setSleeping(true),60000);return()=>window.clearTimeout(timer);
  },[open,pathname,activity,visible,hidden]);
  useEffect(()=>{
    setBlinking(false);
    if(spriteSheet!=='v2'||!ready||!motion||!visible||hidden||sleeping||chatBusy||waving||journey)return;
    let timer:ReturnType<typeof setTimeout>,disposed=false;
    const schedule=()=>{timer=setTimeout(()=>{if(disposed)return;setBlinking(true);timer=setTimeout(()=>{if(disposed)return;setBlinking(false);schedule();},160);},4600+Math.random()*3200);};
    schedule();return()=>{disposed=true;clearTimeout(timer);};
  },[spriteSheet,ready,motion,visible,hidden,sleeping,chatBusy,waving,journey]);
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
      const petWidth=pet.companionRef.current?.offsetWidth||160,petHeight=pet.companionRef.current?.offsetHeight||170;
      if(rect.bottom<0||rect.top>screenH){setHighlight(null);setPosition(null);return;}
      setHighlight({left:Math.max(4,rect.left-5),top:Math.max(4,rect.top-5),width:Math.min(rect.width+10,screenW-8),height:Math.min(rect.bottom,screenH-5)-Math.max(4,rect.top)+5});
      const roomAbove=rect.top>petHeight+20;
      let x=roomAbove?rect.left+rect.width/2-petWidth/2:rect.left>petWidth+15?rect.left-petWidth-10:Math.min(screenW-petWidth-8,rect.right-petWidth);
      let y=roomAbove?rect.top-petHeight-10:Math.max(8,Math.min(screenH-petHeight-8,rect.top+12));
      const panel=panelRef.current?.getBoundingClientRect();
      if(panel && x+petWidth>panel.left && x<panel.right && y+petHeight>panel.top && y<panel.bottom)y=Math.max(8,panel.top-petHeight-10);
      setPosition(clampLeonaris({x,y},{width:screenW,height:screenH,petWidth,petHeight}));
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

  async function preferences(next:{hidden?:boolean;muted?:boolean;memoryEnabled?:boolean;style?:'warm'|'concise'}){
    if(saving)return;const account=accountEpoch.current;setSaving(true);setError('');
    if(next.memoryEnabled!==undefined){++chatEpoch.current;chatAbort.current?.abort();chatRequest.current=null;setChatBusy(false);setAnswer(null);}
    const result=await signal('preference',next);
    if(account!==accountEpoch.current)return;
    setSaving(false);return result;
  }
  function show(){setExpanded(false);focusReturn.current=document.activeElement as HTMLElement;setOpen(true);wake();setMemoryOpen(false);if(reaction){setAnswer(reaction);setReaction(null);}if(focusTimer.current)clearTimeout(focusTimer.current);focusTimer.current=setTimeout(()=>panelRef.current?.focus(),20);}
  function go(action:LeoAction,tour=false,index=0){
    if(!validLeoAction(action))return;
    setExpanded(false);
    setSleeping(false);setReaction(null);setMemoryOpen(false);setOpen(true);
    if(companion.memoryEnabled&&memoryAvailable)void signal('interaction',{context:leoSection(action.path).key,pathname:leoSection(action.path).path},true);
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
  async function ask(event:FormEvent){
    event.preventDefault();const message=question.trim();if(!message||chatBusy)return;
    const account=accountEpoch.current,version=++chatEpoch.current;setChatBusy(true);setError('');setJourney(null);setReaction(null);wake();
    if(!chatRequest.current||chatRequest.current.uid!==uid||chatRequest.current.pathname!==pathname||chatRequest.current.message!==message)chatRequest.current={uid:uid!,pathname,message,id:crypto.randomUUID()};
    const result=await signal('chat',{message,requestId:chatRequest.current.id});
    if(account!==accountEpoch.current||version!==chatEpoch.current)return;
    const reply=safeAnswer(result?.answer);if(reply){chatRequest.current=null;if(currentPath.current===pathname){setAnswer(reply);setQuestion('');}}else if(result)setError('No he recibido una respuesta completa. Inténtalo de nuevo.');
    setChatBusy(false);
  }
  async function remember(event:FormEvent){
    event.preventDefault();const content=memoryDraft.trim();if(!content||saving||!companion.memoryEnabled)return;
    const account=accountEpoch.current;setSaving(true);setError('');
    const result=await signal('remember',{content});if(account!==accountEpoch.current)return;
    if(result)setMemoryDraft('');setSaving(false);
  }
  async function forget(memoryId?:string){
    if(saving)return;const account=accountEpoch.current;setSaving(true);setError('');
    ++chatEpoch.current;chatAbort.current?.abort();chatRequest.current=null;setChatBusy(false);setAnswer(null);
    const result=await signal(memoryId?'forget':'forget_all',memoryId?{memoryId}:{});
    if(account===accountEpoch.current){setSaving(false);setConfirmForget(false);if(result&&!memoryId){setFeedback({});setMemoryDraft('');}}
  }
  async function rate(helpful:boolean){
    if(!answer||saving||feedback[answer.id]!==undefined)return;
    const id=answer.id,account=accountEpoch.current;setSaving(true);setError('');
    const result=await signal('feedback',{answerId:id,helpful});
    if(account===accountEpoch.current){if(result)setFeedback(current=>({...current,[id]:helpful}));setSaving(false);}
  }
  if(!ready||!uid)return null;
  if(hidden)return <button type="button" className={styles.restore} disabled={saving} onClick={()=>void preferences({hidden:false}).then(result=>{if(result)show();})}><Compass size={17}/> Mostrar Leonaris</button>;
  const walking=journey?.stage==='walking';
  const pose=walking||pet.dragging?'walk':chatBusy&&spriteSheet==='v2'?'thinking':waving?'celebrate':journey?.stage==='arrived'?'point':sleeping&&!open&&!pet.playful?'sleep':blinking?'blink':spriteSheet==='v2'&&pet.lookDirection!=='front'?'look-'+pet.lookDirection:pet.playful?'point':'idle';
  const currentAnswer=answer||help,restPosition=position||pet.position;
  const nearLeft=restPosition?restPosition.x<170:false,nearTop=restPosition?restPosition.y<160:false;
  return <aside className={styles.guide} data-paused={!motion||!visible} data-journey={!!journey} aria-label="Leonaris, tu guía celestial">
    {highlight&&<div className={styles.highlight} style={highlight} aria-hidden="true"><span>✦ AQUÍ ES</span></div>}
    {open&&<section ref={panelRef} tabIndex={-1} className={styles.panel} data-expanded={expanded} aria-label="Ayuda de Leonaris">
      <header className={styles.header}><div className={styles.seal}><Sparkles size={19}/></div><div><strong>LEONARIS</strong><span>Tu guía celestial <i/></span></div><div className={styles.controls}>
        <button type="button" className={styles.resizeButton} onClick={()=>setExpanded(current=>!current)} aria-expanded={expanded} aria-label={expanded?"Reducir ayuda":"Ampliar ayuda"}>{expanded?"Reducir":"Ampliar"}</button>
        <button type="button" className={styles.memoryButton} onClick={()=>{setMemoryOpen(value=>!value);setJourney(null);setExpanded(true);setError('');}} aria-label="Memoria y preferencias" aria-pressed={memoryOpen} title="Memoria y preferencias"><Brain size={19}/></button>
        <button type="button" disabled={saving} onClick={()=>void preferences({muted:!muted})} aria-label={muted?'Activar avisos de Leonaris':'Silenciar avisos de Leonaris'} aria-pressed={muted} title={muted?'Activar avisos':'Silenciar avisos'}>{muted?<BellOff size={18}/>:<Bell size={18}/>}</button>
        <button type="button" disabled={saving} onClick={()=>void preferences({hidden:true})} aria-label="Ocultar Leonaris" title="Ocultar mascota"><EyeOff size={18}/></button>
        <button type="button" onClick={()=>{setOpen(false);setJourney(null);characterRef.current?.focus();}} aria-label="Cerrar ayuda"><X size={18}/></button>
      </div></header>
      <div className={styles.content}>
      {error&&<p className={styles.error} role="alert">{error}</p>}
      {memoryOpen?<section className={styles.memoryPanel} aria-labelledby="leonaris-memory-title">
        <button type="button" className={styles.backButton} onClick={()=>setMemoryOpen(false)}><ChevronLeft size={18} aria-hidden="true"/> Volver a la conversación</button>
        <h2 id="leonaris-memory-title">Lo que recuerdo de ti</h2>
        {memoryAvailable!==true?<div className={styles.memoryUnavailable} role="status"><p>No puedo consultar tu memoria ahora. Esto no significa que tus recuerdos se hayan borrado.</p><button type="button" className={styles.secondary} disabled={loading} onClick={()=>void refresh()}><RotateCw size={17}/> Volver a consultar</button></div>:<>
        <p>Controlas lo que guardo para acompañarte. Puedes desactivar la memoria o borrar los recuerdos cuando quieras.</p>
        <label className={styles.preferenceToggle}><input type="checkbox" checked={companion.memoryEnabled} disabled={saving} onChange={event=>void preferences({memoryEnabled:event.target.checked})}/><span>Activar memoria y personalización</span></label>
        {!companion.memoryEnabled&&<p className={styles.note}>La memoria está desactivada. No uso tus recuerdos ni registro tus visitas. Tus notas guardadas se conservan hasta que decidas borrarlas.</p>}
        <label className={styles.selectLabel} htmlFor="leonaris-style">Cómo prefieres mis respuestas</label>
        <select id="leonaris-style" value={companion.style} disabled={saving} onChange={event=>void preferences({style:event.target.value==='concise'?'concise':'warm'})}><option value="warm">Cercanas y explicadas</option><option value="concise">Breves y directas</option></select>
        <h3>Tus recuerdos guardados</h3>
        {!companion.memoryEnabled?<p className={styles.emptyMemory}>Tus notas están en pausa. Activa la memoria para consultarlas o utiliza «Borrar toda mi memoria» para eliminarlas.</p>:companion.memories.length?<ul className={styles.memories}>{companion.memories.map(memory=><li key={memory.id}><p>{memory.content}</p><button type="button" disabled={saving} onClick={()=>void forget(memory.id)} aria-label={'Olvidar: '+memory.content}><Trash2 size={18}/></button></li>)}</ul>:<p className={styles.emptyMemory}>Aún no has guardado ningún recuerdo.</p>}
        <form className={styles.rememberForm} onSubmit={remember}>
          <label htmlFor="leonaris-remember">Algo que quieres que recuerde</label>
          <textarea id="leonaris-remember" rows={2} maxLength={300} disabled={!companion.memoryEnabled||saving} value={memoryDraft} onChange={event=>setMemoryDraft(event.target.value)} placeholder="Por ejemplo: prefiero que me expliques los pasos uno a uno."/>
          <button className={styles.secondary} type="submit" disabled={!companion.memoryEnabled||saving||!memoryDraft.trim()}><Brain size={17} aria-hidden="true"/> Guardar este recuerdo</button>
        </form>
        <div className={styles.learning}>
          <h3>Cómo voy mejorando</h3><p>{companion.learning.summary}</p>
          <dl><div><dt>Visitas registradas</dt><dd>{companion.learning.visits}</dd></div><div><dt>Respuestas útiles</dt><dd>{companion.learning.helpful}</dd></div><div><dt>Por mejorar</dt><dd>{companion.learning.unhelpful}</dd></div></dl>
        </div>
        {!!companion.favoriteSections.length&&<div className={styles.favorites}><h3>Tus accesos habituales</h3>{companion.favoriteSections.map(favorite=>leoAction('favorite-'+favorite.context,favorite.label,favorite.path,'content','Vamos a esta sección.')).filter(validLeoAction).slice(0,3).map(action=><button key={action.id} type="button" onClick={()=>go(action)}>{action.label}<ArrowRight size={17}/></button>)}</div>}
        {confirmForget?<div className={styles.deleteConfirm}><p>¿Borrar los recuerdos y el aprendizaje guardado?</p><button type="button" disabled={saving} onClick={()=>void forget()}>Sí, borrar todo</button><button type="button" disabled={saving} onClick={()=>setConfirmForget(false)}>Cancelar</button></div>:<button type="button" className={styles.deleteMemory} disabled={saving} onClick={()=>setConfirmForget(true)}><Trash2 size={17}/> Borrar toda mi memoria</button>}
        </>}
        <button type="button" className={styles.backButton} onClick={pet.resetPosition}><Compass size={17}/> Devolver a Leonaris a su esquina</button>
      </section>:journey?<div className={styles.journeyBody}>
        <span className={styles.eyebrow}><Footprints size={13}/>{journey.tour?`PASO ${journey.index+1} DE ${tourSteps.length}`:'VAMOS JUNTAS'}</span>
        <h2>{journey.stage==='looking'?'Buscando tu recuadro…':journey.stage==='walking'?'Sígueme, es por aquí':journey.stage==='missing'?'Este recuadro no está disponible':journey.action.label}</h2>
        <p role="status">{journey.stage==='missing'?'Puede que esta sección todavía esté cargando o no tenga contenido para tu cuenta. Puedes actualizar la página o seguir explorando.':journey.action.explanation}</p>
        <div className={styles.journeyButtons}>{journey.tour&&journey.index>0&&<button onClick={()=>go(tourSteps[journey.index-1],true,journey.index-1)} aria-label="Paso anterior"><ChevronLeft size={17}/></button>}
          {journey.tour&&journey.index<tourSteps.length-1?<button className={styles.primary} onClick={()=>go(tourSteps[journey.index+1],true,journey.index+1)}>Siguiente <ArrowRight size={16}/></button>:<button className={styles.primary} onClick={()=>{setJourney(null);setOpen(false);}}>Ya lo tengo <Check size={16}/></button>}
          <button onClick={()=>setJourney(null)}>Terminar guía</button></div>
      </div>:<>
        <div className={styles.context}><span><i/> ESTÁS EN {section.label.toUpperCase()}</span><button type="button" onClick={()=>void refresh()} disabled={loading} aria-label="Actualizar información de Leonaris"><RotateCw size={13} className={loading?styles.refreshing:''}/></button></div>
        <div className={styles.topicGrid}>{TOPICS.map(([key,label])=><button key={key} type="button" data-active={!answer&&topic===key} onClick={()=>{setTopic(key);setAnswer(null);setReaction(null);if(Date.now()-data.updatedAt>15000)void refresh();}}>{label}</button>)}</div>
        <div className={styles.answer} aria-busy={loading||chatBusy} aria-live="polite">
          <span className={styles.eyebrow}><Sparkles size={14}/>{chatBusy?'PREPARANDO TU RESPUESTA':loading?'CONSULTANDO TU CUENTA':'UN PASO CADA VEZ'}</span>
          <h2>{currentAnswer.title}</h2>
          <p>{currentAnswer.message}</p>
          <div className={styles.actions}>{currentAnswer.actions.filter(validLeoAction).map((action,index)=><button type="button" key={action.id} className={index===0?styles.primary:styles.secondary} onClick={()=>go(action)}>{action.label}<ArrowRight size={17}/></button>)}</div>
          {!answer&&help.note&&<small className={styles.note}>{help.note}</small>}
          {answer?.mode&&<div className={styles.feedback} aria-label="Valorar la respuesta"><span>{feedback[answer.id]!==undefined?'Gracias, tendré en cuenta tu valoración.':'¿Te ha servido?'}</span><button type="button" disabled={saving||feedback[answer.id]!==undefined} aria-pressed={feedback[answer.id]===true} onClick={()=>void rate(true)}><ThumbsUp size={16}/> Sí</button><button type="button" disabled={saving||feedback[answer.id]!==undefined} aria-pressed={feedback[answer.id]===false} onClick={()=>void rate(false)}><ThumbsDown size={16}/> Mejorable</button></div>}
        </div>
        <div className={styles.tools}><button type="button" onClick={()=>go(tourSteps[0],true,0)}><Footprints size={17}/> Guíame aquí</button><button type="button" onClick={()=>{setTopic('sections');setAnswer(null);}}><Compass size={17}/> Explorar panel</button></div>
        <form className={styles.ask} onSubmit={ask}><label className={styles.srOnly} htmlFor="leonaris-question">¿En qué te ayudo?</label><input id="leonaris-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={600} disabled={chatBusy} placeholder="¿En qué te ayudo?" autoComplete="off"/><button type="submit" disabled={!question.trim()||chatBusy} aria-label="Consultar a Leonaris"><Send size={18}/></button></form>
        <footer className={styles.footer}>Información de tu cuenta · {loading?'actualizando':data.updatedAt?'consulta '+new Date(data.updatedAt).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'información pendiente'}{answer?.mode==='guided'&&<span>Respuesta guiada con los datos disponibles.</span>}</footer>
      </>}
      </div>
    </section>}
    <div ref={pet.companionRef} className={styles.companion} data-dragging={pet.dragging} data-playful={pet.playful} data-near-left={nearLeft} data-near-top={nearTop} style={restPosition?{left:restPosition.x,top:restPosition.y,right:'auto',bottom:'auto'}:undefined}>
      {!open&&!journey&&!muted&&!pet.dragging&&<button type="button" className={styles.teaser} style={restPosition?{position:'fixed',left:Math.max(8,Math.min(restPosition.x,window.innerWidth-288)),right:'auto',top:Math.max(8,Math.min(window.innerHeight-178,nearTop?restPosition.y+(pet.companionRef.current?.offsetHeight||170)+8:restPosition.y-160)),bottom:'auto'}:undefined} onClick={show}>{reaction?<><Gift size={18}/><span><strong>{reaction.title}</strong><small>{reaction.message}</small></span></>:<><MessageCircle size={18}/><span>{data.pending?'Resultado por comprobar':usable?`${usable} giro${usable===1?'':'s'} · Te llevo`:'¿Te acompaño?'}</span></>}</button>}
      <button ref={characterRef} type="button" className={styles.character} {...pet.characterHandlers} onClick={()=>{if(pet.consumeClick())return;wake();if(open){setOpen(false);setJourney(null);}else show();}} aria-label={open?'Minimizar ayuda de Leonaris':'Abrir ayuda de Leonaris'} aria-describedby="leonaris-move-help" aria-expanded={open}>
        <span className={styles.floor} aria-hidden="true"/>
        <span className={styles.look} aria-hidden="true">{spriteSheet==='unavailable'?<span className={styles.fallback}>🦁</span>:spriteSheet==='loading'?<span className={styles.loadingArt}/>:<span className={styles.sprite} data-sheet={spriteSheet} data-pose={pose}/>}</span>
        <span className={styles.name}>LEONARIS <Sparkles size={9}/></span>
      </button>
    </div>
    <span id="leonaris-move-help" className={styles.srOnly}>Puedes arrastrarme para cambiarme de sitio. Con el teclado, usa las flechas para moverme y la tecla Inicio para volver a la esquina.</span>
    <span className={styles.srOnly} role="status">{journey?.stage==='arrived'?journey.action.explanation:''}</span>
  </aside>;
}
