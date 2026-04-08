"use client";
import { useEffect, useState } from "react";

export default function CaptacionPanel({mode}:{mode?:string}) {
  const [items,setItems]=useState<any[]>([]);

  async function load(){
    const res=await fetch("/api/captacion/list",{cache:"no-store"});
    const json=await res.json();
    if(json.ok) setItems(json.items);
  }

  async function act(id:string,action:string){
    await fetch("/api/captacion/action",{
      method:"POST",
      body:JSON.stringify({lead_id:id,action}),
      headers:{ "Content-Type":"application/json" }
    });
    setItems(prev=>prev.filter(l=>l.id!==id));
  }

  useEffect(()=>{load();},[]);

  return (
    <div>
      <h2>Captación</h2>
      {items.map(l=>(
        <div key={l.id}>
          <div>{l.cliente_nombre}</div>
          <button onClick={()=>act(l.id,"contactado")}>Contactado</button>
          <button onClick={()=>act(l.id,"no_responde")}>No responde</button>
          <button onClick={()=>act(l.id,"no_interesado")}>No interesado</button>
          <button onClick={()=>act(l.id,"numero_invalido")}>Número inválido</button>
        </div>
      ))}
    </div>
  );
}
