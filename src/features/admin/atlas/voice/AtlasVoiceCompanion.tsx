'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square, Minus, X, Trash2 } from 'lucide-react';
import { useAtlasVoiceSession } from './useAtlasVoiceSession';
import styles from './AtlasVoiceCompanion.module.css';

export type CompanionVoiceState={busy:boolean;state:string;expanded:boolean};
export default function AtlasVoiceCompanion({onChange}:{onChange:(value:CompanionVoiceState)=>void}){
  const voice=useAtlasVoiceSession();
  const [expanded,setExpanded]=useState(true);
  const trigger=useRef<HTMLButtonElement>(null),heading=useRef<HTMLHeadingElement>(null);
  const pending=voice.proposals.find(p=>p.status==='pending');
  useEffect(()=>{onChange({busy:voice.busy,state:voice.state,expanded});},[voice.busy,voice.state,expanded,onChange]);
  useEffect(()=>{if(pending)setExpanded(true);},[pending?.id]);
  useEffect(()=>{if(expanded)heading.current?.focus({preventScroll:true});},[expanded]);
  const minimize=()=>{setExpanded(false);trigger.current?.focus({preventScroll:true});};
  const close=()=>{voice.stop();minimize();};
  return <>
    <div className={styles.dock}>
      <button ref={trigger} type="button" className={styles.trigger} data-live={voice.busy} aria-expanded={expanded} aria-controls="atlas-floating-voice" aria-label={expanded?'Minimizar controles de voz de Atlas':'Hablar con Atlas aquí'} onClick={()=>expanded?minimize():setExpanded(true)}><Mic size={15}/>{voice.busy?'Voz activa':'Hablar'}</button>
      {voice.busy&&<><button type="button" className={styles.icon} aria-label={voice.muted?'Reactivar micrófono de Atlas':'Pausar micrófono de Atlas'} aria-pressed={voice.muted} onClick={voice.toggleMuted}>{voice.muted?<Mic size={15}/>:<MicOff size={15}/>}</button><button type="button" className={styles.icon} aria-label="Terminar voz de Atlas" onClick={voice.stop}><Square size={13}/></button></>}
    </div>
    {expanded&&<section id="atlas-floating-voice" className={styles.bubble} data-companion-bubble="voice" aria-label="Voz de Atlas en el panel" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();}}}>
      <header className={styles.header}><div><span>CONTIGO EN EL PANEL</span><h2 ref={heading} tabIndex={-1}>Hablemos.</h2></div><div className={styles.tools}><button type="button" aria-label="Minimizar conversación sin terminar" title="Minimizar; la voz sigue activa" onClick={minimize}><Minus size={17}/></button><button type="button" aria-label="Cerrar conversación y micrófono" onClick={close}><X size={17}/></button></div></header>
      <div className={styles.body}>
        <p className={styles.state} role="status" data-live={voice.busy}><i/>{voice.state}{voice.busy&&<small>{Math.floor(voice.seconds/60)}:{String(voice.seconds%60).padStart(2,'0')} / 5:00</small>}</p>
        <span className={styles.badge}>PRUEBA · SOLO DATOS FICTICIOS</span>
        {!voice.busy&&<p className={styles.intro}>Activa el micrófono y háblame mientras sigues trabajando. Puedes minimizar esta burbuja; seguiré escuchándote.</p>}
        {(!voice.consent||!voice.busy)&&<label className={styles.consent}><input type="checkbox" checked={voice.consent} onChange={e=>voice.setConsent(e.target.checked)}/><span>Mi proyecto de Google es gratuito y sin facturación. Usaré datos ficticios; Google recibirá el audio durante la conversación.</span></label>}
        <div className={styles.actions}>{!voice.busy?<button type="button" className={styles.primary} disabled={!voice.status?.configured||!voice.consent} onClick={()=>void voice.start()}><Mic size={17}/>Activar micrófono</button>:<><button type="button" aria-pressed={voice.muted} onClick={voice.toggleMuted}>{voice.muted?<Mic size={16}/>:<MicOff size={16}/>} {voice.muted?'Reactivar':'Pausar'}</button><button type="button" className={styles.stop} onClick={voice.stop}><Square size={14}/>Terminar</button></>}</div>
        {voice.status&&!voice.status.configured&&<p className={styles.notice}>La conexión de Gemini todavía está pendiente de configurar.</p>}
        {voice.message&&<p className={styles.notice} role="status">{voice.message}</p>}
        <div className={styles.transcript} role="log" aria-label="Conversación con Atlas" aria-live="polite">{!voice.lines.length?<p>Prueba: «Atlas, busca a María Alba». Es una ficha inventada.</p>:voice.lines.slice(-2).map((line,i)=><article key={i} data-role={line.role}><strong>{line.role==='atlas'?'Atlas':'Tú'}</strong><p>{line.text}</p></article>)}</div>
        {!!voice.proposals.length&&<section className={styles.proposals} aria-label="Acciones simuladas">{voice.proposals.map(p=><article key={p.id}><strong>{p.title}</strong><p>{p.detail}</p>{p.status==='pending'?<div className={styles.actions}><button type="button" className={styles.primary} disabled={!voice.busy} onClick={()=>voice.resolve(p.id,true)}>Confirmar simulación</button><button type="button" onClick={()=>voice.resolve(p.id,false)}>Cancelar</button></div>:<small>{p.status==='confirmed'?'Simulación completada':'Cancelada'}</small>}</article>)}</section>}
        <details className={styles.notes}><summary>Tu guía para Atlas · {voice.notes.length}/5</summary><p>Preferencias guardadas en este navegador. Se envían a Google al iniciar; no reentrenan el modelo.</p><label htmlFor="atlas-floating-note">Una enseñanza, sin datos personales</label><textarea id="atlas-floating-note" maxLength={400} value={voice.draft} onChange={e=>voice.setDraft(e.target.value)} placeholder="Habla despacio y haz una pregunta cada vez."/><button type="button" disabled={!voice.status||!voice.draft.trim()||voice.notes.length>=5||voice.busy} onClick={()=>voice.saveNotes([...voice.notes,voice.draft.trim()])}>Guardar enseñanza</button><ul>{voice.notes.map((note,i)=><li key={i}><span>{note}</span><button type="button" disabled={voice.busy} aria-label={'Quitar enseñanza '+(i+1)} onClick={()=>voice.saveNotes(voice.notes.filter((_,index)=>index!==i))}><Trash2 size={14}/></button></li>)}</ul></details>
        <p className={styles.fine}>Al cerrar, salir de esta pestaña o bloquearse el panel, se cierra el micrófono. La prueba termina a los 5 minutos. No guardamos audio ni transcripciones.</p>
      </div>
    </section>}
  </>;
}
