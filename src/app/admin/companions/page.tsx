'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase-browser';
import AtlasPortrait from '@/components/atlas/AtlasPortrait';
type Knowledge = { topic: string; content: string; version: number };
type Worker = { id: string; display_name: string };
export default function CompanionAssignments() {
  const [knowledge,setKnowledge]=useState<Knowledge[]>([]),[topic,setTopic]=useState(''),[content,setContent]=useState('');
  const [workers,setWorkers] = useState<Worker[]>([]), [notice,setNotice] = useState(''), [busy,setBusy] = useState(false);
  async function request(body?: unknown) {
    const session = (await supabaseBrowser().auth.getSession()).data.session;
    const response = await fetch('/api/admin/companions', { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session?.access_token || ''}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || 'Necesitas una sesión de administrador.'); return data;
  }
  useEffect(() => { let active=true; request().then(d => { if(active){setWorkers(d.workers);setKnowledge(d.knowledge);} }).catch(e => {if(active)setNotice(e.message);}); return()=>{active=false;}; }, []);
  return <main style={{ maxWidth: 850, margin: '50px auto', padding: 24 }} className="tc-card">
    <Link href="/admin">← Volver a administración</Link>
    <header style={{display:'flex',alignItems:'center',gap:24,flexWrap:'wrap',margin:'24px 0'}}>
      <div style={{width:160,height:160}}><AtlasPortrait state="greeting"/></div>
      <div style={{flex:1,minWidth:220}}><small style={{color:'#e0bd7d'}}>TAROT CELESTIAL · ASISTENTE UNIVERSAL</small><h1>Atlas</h1><p>Una mirada atenta. Un toque de picardía.</p><p>Una misma identidad en el panel, con recuerdos, preferencias y permisos propios de cada cuenta.</p></div>
    </header>
    <p role="status">{notice}</p>
    <section><h2>Atlas en las centrales</h2><p>Disponible automáticamente para cada central. Sus paseos y animaciones se ajustan desde el propio asistente.</p>{workers.map(w=><div key={w.id} style={{display:'flex',justifyContent:'space-between',gap:12,padding:'12px 0',borderBottom:'1px solid #a98bd62b'}}><strong>{w.display_name}</strong><span style={{color:'#e7c68d'}}>✦ Atlas</span></div>)}</section>
    <section style={{marginTop:40}}><h2>Conocimiento aprobado</h2><p>Documenta los procesos que Atlas puede consultar. Cada publicación conserva la versión anterior.</p>
      <form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await request({action:'knowledge',topic,content});const d=await request();setKnowledge(d.knowledge);setNotice('Conocimiento publicado.');setTopic('');setContent('');}catch(e){setNotice(e instanceof Error?e.message:'No se pudo publicar.');}finally{setBusy(false);}}}>
        <label>Tema<input required maxLength={80} value={topic} onChange={e=>setTopic(e.target.value)} style={{display:'block',width:'100%',margin:'10px 0'}}/></label>
        <label>Proceso o indicación<textarea required maxLength={4000} rows={7} value={content} onChange={e=>setContent(e.target.value)} style={{display:'block',width:'100%',margin:'10px 0'}}/></label>
        <button className="tc-btn" disabled={busy||!topic.trim()||!content.trim()}>Publicar versión aprobada</button>
      </form>{knowledge.map(k=><details key={`${k.topic}:${k.version}`} style={{marginTop:16}}><summary>{k.topic} · versión {k.version}</summary><p style={{whiteSpace:'pre-wrap'}}>{k.content}</p><button type="button" onClick={()=>{setTopic(k.topic);setContent(k.content);}}>Preparar actualización</button></details>)}
    </section>
  </main>;
}
