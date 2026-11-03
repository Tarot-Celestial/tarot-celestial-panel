'use client';
import { Mic, MicOff, Square, ArrowLeft, Sparkles, ShieldCheck, Trash2 } from 'lucide-react';
import AtlasPortrait from '@/components/atlas/AtlasPortrait';
import { demoClients, demoStaff } from '@/lib/atlas-voice-demo';
import { useAtlasVoiceSession } from './useAtlasVoiceSession';
import styles from './AtlasVoiceDemo.module.css';

export default function AtlasVoiceDemo(){
  const {status,state,message,consent,setConsent,busy,muted,seconds,lines,proposals,notes,draft,setDraft,saveNotes,start,stop,resolve,toggleMuted,balances}=useAtlasVoiceSession();
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
            <button type="button" onClick={toggleMuted} aria-pressed={muted}>{muted?<Mic size={18}/>:<MicOff size={18}/>} {muted?'Reactivar micrófono':'Pausar micrófono'}</button>
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
      <section className={styles.card}><h2>Fichas del laboratorio</h2><p>Estos nombres y saldos están inventados.</p>{demoClients.map(c=><p key={c.id}><strong>{c.name}</strong><br/>{c.tags.join(' · ')} · {balances[c.id]} FREE de prueba</p>)}<small>Equipo ficticio: {demoStaff.map(s=>s.name).join(' · ')}.</small></section>
      <section className={styles.card}><h2>Tu guía para Atlas</h2><p>Guarda hasta cinco preferencias de conversación. Se guardan solo en este navegador y se envían a Google al iniciar. No reentrenan el modelo.</p>
        <label htmlFor="atlas-voice-note">Una enseñanza, sin datos personales</label><textarea id="atlas-voice-note" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={400} placeholder="Por ejemplo: habla despacio y haz una pregunta cada vez."/>
        <button type="button" disabled={!status||!draft.trim()||notes.length>=5||busy} onClick={()=>saveNotes([...notes,draft.trim()])}>Guardar enseñanza</button>
        <ul>{notes.map((note,index)=><li key={index}><span>{note}</span><button type="button" disabled={busy} aria-label={`Quitar enseñanza ${index+1}`} onClick={()=>saveNotes(notes.filter((_,i)=>i!==index))}><Trash2 size={15}/></button></li>)}</ul>
      </section>
    </div>
  </main>;
}
