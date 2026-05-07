"use client";
import { useState } from 'react';

export default function CartaAstralPage() {
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<any>(null);

  async function submit(e:any){
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());

    const res = await fetch('/api/carta-astral', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    setResultado(data);
    setLoading(false);
  }

  return (
    <div style={{minHeight:'100vh',background:'#0f0f1a',color:'white',padding:'40px'}}>
      <div style={{maxWidth:800,margin:'0 auto'}}>
        <h1 style={{fontSize:48,fontWeight:700}}>Carta Astral Premium</h1>
        <p style={{opacity:.8,marginBottom:30}}>Recibe tu carta astral personalizada con interpretación híbrida IA + astrología.</p>

        <form onSubmit={submit} style={{display:'grid',gap:16,background:'#1a1a2e',padding:24,borderRadius:20}}>
          <input name="nombre" placeholder="Nombre" required style={inputStyle}/>
          <input name="email" type="email" placeholder="Email" required style={inputStyle}/>
          <input name="fecha" type="date" required style={inputStyle}/>
          <input name="hora" type="time" required style={inputStyle}/>
          <input name="ciudad" placeholder="Ciudad de nacimiento" required style={inputStyle}/>

          <button disabled={loading} style={buttonStyle}>
            {loading ? 'Generando carta...' : 'Generar Carta Astral'}
          </button>
        </form>

        {resultado?.ok && (
          <div style={{marginTop:30,background:'#1a1a2e',padding:24,borderRadius:20}}>
            <h2 style={{fontSize:32}}>{resultado.titulo}</h2>
            <pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit'}}>{resultado.texto}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

const inputStyle = {
  padding:'14px 16px',
  borderRadius:12,
  border:'1px solid #333',
  background:'#111827',
  color:'white'
} as const;

const buttonStyle = {
  padding:'16px',
  borderRadius:12,
  border:'none',
  background:'#7c3aed',
  color:'white',
  fontWeight:700,
  cursor:'pointer'
} as const;
