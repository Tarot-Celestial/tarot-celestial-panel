'use client';
import { useState } from 'react';

export default function ChatPage(){
  const [view,setView]=useState<'list'|'chat'>('list');
  const [selected,setSelected]=useState<any>(null);

  const tarotistas=[
    {id:1,nombre:'Azul',estado:'libre'},
    {id:2,nombre:'Luna',estado:'ocupada'},
  ];

  if(view==='chat' && selected){
    return (
      <div style={{maxWidth:480,margin:'0 auto',height:'100vh',display:'flex',flexDirection:'column',background:'#0f0f0f',color:'#fff'}}>

        <div style={{padding:12,borderBottom:'1px solid #222',display:'flex',gap:10}}>
          <button onClick={()=>setView('list')}>←</button>
          <div>
            <div style={{fontWeight:600}}>{selected.nombre}</div>
            <div style={{fontSize:12,opacity:.6}}>{selected.estado}</div>
          </div>
        </div>

        <div style={{flex:1,overflowY:'auto',padding:12}}>
          <div style={{background:'#1f1f1f',padding:10,borderRadius:10,maxWidth:'80%'}}>
            Hola, soy {selected.nombre}
          </div>
        </div>

        <div style={{padding:10,borderTop:'1px solid #222'}}>
          <input placeholder="Escribe..." style={{width:'100%',padding:10,borderRadius:10,background:'#1f1f1f',border:'none',color:'#fff'}}/>
        </div>

      </div>
    )
  }

  return (
    <div style={{maxWidth:480,margin:'0 auto',background:'#0f0f0f',color:'#fff',height:'100vh'}}>
      {tarotistas.map(t=>(
        <div key={t.id} onClick={()=>{setSelected(t);setView('chat')}} style={{padding:16,borderBottom:'1px solid #222',display:'flex',justifyContent:'space-between'}}>
          <div>
            <div style={{fontWeight:600}}>{t.nombre}</div>
            <div style={{fontSize:12,opacity:.6}}>{t.estado}</div>
          </div>
          <div style={{width:10,height:10,borderRadius:'50%',background:t.estado==='libre'?'#22c55e':t.estado==='ocupada'?'#f59e0b':'#666'}}/>
        </div>
      ))}
    </div>
  )
}
