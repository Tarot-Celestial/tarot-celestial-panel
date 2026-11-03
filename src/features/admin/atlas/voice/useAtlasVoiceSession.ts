'use client';
import { useEffect, useRef, useState } from 'react';
import { usePanelInteraction } from '@/components/attendance/PanelInteractionContext';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { VoiceDemo, type DemoProposal } from '@/lib/atlas-voice-demo';
import { AtlasLive } from './gemini-live';
type Status={configured:boolean;workerId:string;maxSeconds:number};
type Line={role:'user'|'atlas';text:string};
export function useAtlasVoiceSession(){
  const interactive=usePanelInteraction();
  const [status,setStatus]=useState<Status|null>(null),[state,setState]=useState('Comprobando sesión'),[message,setMessage]=useState('');
  const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[muted,setMuted]=useState(false),[seconds,setSeconds]=useState(0);
  const [lines,setLines]=useState<Line[]>([]),[proposals,setProposals]=useState<DemoProposal[]>([]),[notes,setNotes]=useState<string[]>([]),[draft,setDraft]=useState('');
  const live=useRef<AtlasLive|null>(null),demo=useRef(new VoiceDemo()),epoch=useRef(0),access=useRef(''),identity=useRef(''),mounted=useRef(true);
  const stop=()=>{live.current?.stop();live.current=null;demo.current.cancelPending();setProposals([...demo.current.proposals]);setBusy(false);setMuted(false);};
  useEffect(()=>{
    mounted.current=true;const db=supabaseBrowser();let check=0;
    const load=async(session:any)=>{
      const request=++check,uid=session?.user?.id||'';
      if(identity.current!==uid){epoch.current++;live.current?.stop();live.current=null;demo.current=new VoiceDemo();setLines([]);setProposals([]);setNotes([]);setDraft('');setConsent(false);setBusy(false);setStatus(null);identity.current=uid;}
      access.current=session?.access_token||'';
      if(!access.current){setState('Inicia sesión como administrador');return;}
      try{
        const response=await fetch('/api/admin/atlas/voice',{headers:{authorization:`Bearer ${access.current}`},cache:'no-store'});
        const data=await response.json();if(!mounted.current||request!==check)return;
        if(!response.ok){live.current?.stop();setBusy(false);setStatus(null);setMessage(data.error||'No se pudo comprobar la sesión.');setState('Sin acceso');return;}
        setStatus(data);if(!live.current)setState('Listo para practicar');
      }catch{if(mounted.current&&request===check){setMessage('No se pudo comprobar la conexión. Recarga la página para reintentar.');setStatus(null);}}
    };
    void db.auth.getSession().then(({data})=>load(data.session));
    const {data:listener}=db.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>{if(mounted.current)void load(session);},0);});
    const hidden=()=>{if(document.hidden){live.current?.stop('Micrófono cerrado al salir de esta pestaña.');demo.current.cancelPending();setProposals([...demo.current.proposals]);setBusy(false);}};
    document.addEventListener('visibilitychange',hidden);
    const pagehide=()=>live.current?.stop();
    window.addEventListener('pagehide',pagehide);
    return()=>{mounted.current=false;epoch.current++;check++;live.current?.stop();listener.subscription.unsubscribe();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',pagehide);};
  },[]);
  useEffect(()=>{
    setNotes([]);setDraft('');
    if(!status?.workerId)return;
    try{const saved=JSON.parse(localStorage.getItem('atlas-voice-demo-notes:v1:'+status.workerId)||'[]');if(Array.isArray(saved))setNotes(saved.filter(x=>typeof x==='string'&&x.length<=400).slice(0,5));}catch{setMessage('No se pudieron recuperar las notas guardadas en este navegador.');}
  },[status?.workerId]);
  useEffect(()=>{if(!busy)return;const start=Date.now();const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return()=>clearInterval(timer);},[busy]);
  useEffect(()=>{if(!interactive){live.current?.stop('Micrófono cerrado al bloquearse el panel.');setBusy(false);}},[interactive]);
  const saveNotes=(next:string[])=>{
    if(!status)return;
    try{localStorage.setItem('atlas-voice-demo-notes:v1:'+status.workerId,JSON.stringify(next));setNotes(next);setDraft('');setMessage('Guía guardada en este navegador. Se usará en la próxima conversación.');}
    catch{setMessage('El navegador no permite guardar la guía.');}
  };
  const start=async()=>{
    if(!interactive||!status?.configured||!consent||busy)return;
    const run=++epoch.current;demo.current=new VoiceDemo();setProposals([]);setLines([]);setMessage('');setBusy(true);setMuted(false);setSeconds(0);
    const current=()=>mounted.current&&epoch.current===run;
    const session=new AtlasLive({
      onState:s=>{if(current()){setState(s);if(s==='Desconectado'){setBusy(false);demo.current.cancelPending();setProposals([...demo.current.proposals]);}}},
      onText:(role,text)=>{if(current())setLines(previous=>{const list=previous.slice(-99),last=list.at(-1);if(last?.role===role)list[list.length-1]={role,text:(last.text+text).slice(-6000)};else list.push({role,text:text.slice(0,6000)});return list;});},
      onTool:call=>{if(!current())return {error:'Sesión cerrada.'};const result=demo.current.run(call.id,call.name,call.args);setProposals(demo.current.proposals.map(p=>({...p})));return result;},
      onCancel:ids=>{if(current()){ids.forEach(id=>demo.current.resolve(id,false));setProposals(demo.current.proposals.map(p=>({...p})));}},
      onError:error=>{if(current())setMessage(error);}
    });
    live.current=session;await session.start(access.current,notes);
  };
  const resolve=(id:string,confirm:boolean)=>{const result=demo.current.resolve(id,confirm);setProposals(demo.current.proposals.map(p=>({...p})));live.current?.sendResult(result);};
  const toggleMuted=()=>{const next=!muted;setMuted(next);live.current?.setMuted(next);};
  return {status,state,message,consent,setConsent,busy,muted,seconds,lines,proposals,notes,draft,setDraft,saveNotes,start,stop,resolve,toggleMuted,balances:demo.current.balances};
}
