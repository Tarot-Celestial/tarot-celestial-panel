'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square, ArrowLeft, Sparkles, ShieldCheck, Trash2 } from 'lucide-react';
import AtlasPortrait from '@/components/atlas/AtlasPortrait';
import { usePanelInteraction } from '@/components/attendance/PanelInteractionContext';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { VoiceDemo, demoClients, demoStaff, type DemoProposal } from '@/lib/atlas-voice-demo';
import { AtlasLive } from './gemini-live';
import styles from './AtlasVoiceDemo.module.css';
type Status={configured:boolean;workerId:string;maxSeconds:number};
type Line={role:'user'|'atlas';text:string};
export default function AtlasVoiceDemo(){
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
  return <main className={styles.page}>
    <a className={styles.back} href="/admin"><ArrowLeft size={17}/>Volver al panel</a>
    <header className={styles.header}><div><span className={styles.eyebrow}>ATLAS · LABORATORIO DE VOZ</span><h1>Vamos a hablar.</h1><p>Practicamos juntos antes de llevar la voz a tu operativa.</p></div><span className={styles.badge}><ShieldCheck size={16}/>Solo datos ficticios</span></header>
    <div className={styles.grid}>
      <section className={styles.stage} aria-label="Controles de voz">
        <div className={styles.portrait}><AtlasPortrait state={state==='Atlas está hablando'?'dancing':busy?'thinking':'idle'}/></div>
        <span className={styles.status} role="status" data-live={busy}>{state}</span>
        <h2>Tu voz, mi atención.</h2><p>Puedes hablar de forma natural e interrumpirme. Las acciones de esta sala son simulaciones.</p>
        <div className={styles.controls}>
          {!busy?<button className={styles.primary} type="button" onClick={()=>void start()} disabled={!status?.configured||!consent}><Mic size={20}/>Hablar con Atlas</button>:<>
            <button type="button" onClick={()=>{const next=!muted;setMuted(next);live.current?.setMuted(next);}} aria-pressed={muted}>{muted?<Mic size={18}/>:<MicOff size={18}/>} {muted?'Reactivar micrófono':'Pausar micrófono'}</button>
            <button className={styles.stop} type="button" onClick={stop}><Square size={17}/>Terminar</button>
          </>}
        </div>
        <small>{busy?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · máximo 5 minutos`:'El micrófono se abre solo al pulsar Hablar con Atlas.'}</small>
        <label className={styles.consent}><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><span>He comprobado que el proyecto de Google es gratuito y sin facturación. Usaré solo datos ficticios; el audio se enviará a Google durante la conversación.</span></label>
        {status&&!status.configured?<p className={styles.notice}>La conexión de Gemini todavía está pendiente de configurar.</p>:null}
        {message?<p className={styles.notice} role="status">{message}</p>:null}
        <p className={styles.fine}>Al cambiar de pestaña o terminar, se cierra el micrófono. El panel no guarda el audio ni la transcripción. El cupo depende del proyecto de Google; agotarlo detiene la prueba.</p>
      </section>
      <section className={styles.conversation} aria-label="Conversación de prueba"><div className={styles.sectionTitle}><h2>La conversación</h2><span>Gemini Live</span></div>
        <div className={styles.transcript} role="log" aria-label="Transcripción" aria-live="polite">
          {!lines.length?<div className={styles.empty}><Sparkles size={24}/><h3>Empieza por algo sencillo</h3><p>«Atlas, busca a María Alba»</p><p>«Prepara un cobro de nivel 2 por 35 euros»</p><p>«Su última llamada fueron 30 FREE, no 40»</p></div>:lines.map((line,index)=><article key={index} data-role={line.role}><strong>{line.role==='atlas'?'Atlas':'Tú'}</strong><p>{line.text}</p></article>)}
        </div>
      </section>
    </div>
    <section className={styles.proposals} aria-label="Acciones simuladas"><div className={styles.sectionTitle}><h2>Revisamos antes de actuar</h2><span>Ninguna operación real</span></div>
      {!proposals.length?<p>Las propuestas aparecerán aquí con su destinatario y sus detalles.</p>:proposals.map(p=><article key={p.id}><div><strong>{p.title}</strong><p>{p.detail}</p></div>{p.status==='pending'?<div className={styles.controls}><button type="button" className={styles.primary} disabled={!busy} onClick={()=>resolve(p.id,true)}>Confirmar simulación</button><button type="button" onClick={()=>resolve(p.id,false)}>Cancelar</button></div>:<span className={styles.badge}>{p.status==='confirmed'?'Simulación completada':'Cancelada'}</span>}</article>)}
    </section>
    <div className={styles.bottom}>
      <section className={styles.card}><h2>Fichas del laboratorio</h2><p>Estos nombres y saldos están inventados.</p>{demoClients.map(c=><p key={c.id}><strong>{c.name}</strong><br/>{c.tags.join(' · ')} · {demo.current.balances[c.id]} FREE de prueba</p>)}<small>Equipo ficticio: {demoStaff.map(s=>s.name).join(' · ')}.</small></section>
      <section className={styles.card}><h2>Tu guía para Atlas</h2><p>Guarda hasta cinco preferencias de conversación. Se guardan solo en este navegador y se envían a Google al iniciar. No reentrenan el modelo.</p>
        <label htmlFor="atlas-voice-note">Una enseñanza, sin datos personales</label><textarea id="atlas-voice-note" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={400} placeholder="Por ejemplo: habla despacio y haz una pregunta cada vez."/>
        <button type="button" disabled={!status||!draft.trim()||notes.length>=5||busy} onClick={()=>saveNotes([...notes,draft.trim()])}>Guardar enseñanza</button>
        <ul>{notes.map((note,index)=><li key={index}><span>{note}</span><button type="button" disabled={busy} aria-label={`Quitar enseñanza ${index+1}`} onClick={()=>saveNotes(notes.filter((_,i)=>i!==index))}><Trash2 size={15}/></button></li>)}</ul>
      </section>
    </div>
  </main>;
}
