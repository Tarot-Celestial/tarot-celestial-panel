'use client';
import {useState} from 'react';
import {AtlasLauncher} from '@/features/admin/atlas/AtlasCharacter';
import {PanelInteractionContext} from '@/components/attendance/PanelInteractionContext';
export default function QA(){
  const [tab,setTab]=useState('Resumen'),[locked,setLocked]=useState(false),[mounted,setMounted]=useState(true);
  return <PanelInteractionContext.Provider value={!locked}><main style={{minHeight:'100vh',background:'#11101c',color:'#f5e8ff',padding:32}}>
    <h1>Panel · Prueba aislada</h1><p>Fichas y audio ficticios. No hay conexiones con operaciones reales.</p>
    <nav style={{display:'flex',gap:18,margin:'24px 0'}}>{['Reservas','CRM'].map(t=><button key={t} onClick={()=>setTab(t)}>{t} de prueba</button>)}<button onClick={()=>setLocked(!locked)}>{locked?'Desbloquear':'Bloquear'} panel</button><button onClick={()=>setMounted(!mounted)}>{mounted?'Desmontar':'Montar'} Atlas</button></nav>
    <section style={{padding:32,border:'1px solid #77628c',borderRadius:22,maxWidth:720}}><h2>{tab}</h2><label>Trabajo en curso<input aria-label="Trabajo en curso" style={{display:'block',background:'#21152e',marginTop:20,border:'1px solid #8c74a2',padding:12}}/></label></section>
    {mounted&&<AtlasLauncher workerId="worker-demo" onOpen={()=>setTab('Atlas')}/>}
  </main></PanelInteractionContext.Provider>;
}
