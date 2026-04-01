import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSLT1yIj5KRXABYpubiiM_9DQLqAT3zriTsW44S-SBvz_ZhjKJJu35pP9F4j-sT6Pt0hmRGsnqlulyM/pub?gid=1587355871&single=true&output=csv";

function parse(line: string): string[] {
  return line.split(",");
}

function safe(v:any){ return (v||"").toString().trim(); }

function formatDate(d:string){
  if(!d) return null;
  const p=d.split("/");
  if(p.length!==3) return null;
  return `${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`;
}

// 🔥 FIX CODIGO (constraint)
function normalizeCodigo(v:string){
  const val = (v||"").toLowerCase();

  if(val.includes("vip")) return "vip";
  if(val.includes("promo")) return "promo";
  if(val.includes("rueda")) return "cliente"; // adaptar rueda → cliente
  return "cliente";
}

function hash(r:string){
  let h=0;
  for(let i=0;i<r.length;i++){h=(h<<5)-h+r.charCodeAt(i);h|=0;}
  return h.toString();
}

export async function POST(){
  try{

    const res = await fetch(SHEET_URL);
    const csv = await res.text();

    const lines = csv.split("\n").filter(l=>l.trim());
    const headers = parse(lines[0]).map(h=>h.toLowerCase());

    const find=(names:string[])=>headers.findIndex(h=>names.some(n=>h.includes(n)));

    const iFecha = find(["fecha"]);
    const iTel = find(["telefonista"]);
    const iTarot = find(["tarotista"]);
    const iMin = find(["tiempo"]);
    const iCodigo = find(["codigo"]);
    const iImporte = find(["importe"]);
    const iCapt = find(["captado"]);

    const rows = lines.slice(1);

    const data = rows.map(r=>{
      const c = parse(r);

      return {
        call_date: formatDate(safe(c[iFecha])),
        telefonista: safe(c[iTel]),
        tarotista: safe(c[iTarot]),
        minutos: Number(safe(c[iMin]))||0,
        codigo: normalizeCodigo(safe(c[iCodigo])),
        importe: Number(safe(c[iImporte]).replace("€","").replace(",", "."))||0,
        captada: safe(c[iCapt]).toUpperCase()==="TRUE",
        source_row_hash: hash(r)
      }
    }).filter(r=>r.call_date);

    const { error } = await supabase
      .from("calls")
      .upsert(data,{onConflict:"source_row_hash"});

    if(error){
      return NextResponse.json({ok:false,error:error.message},{status:500});
    }

    return NextResponse.json({ok:true, inserted:data.length});

  }catch(e:any){
    return NextResponse.json({ok:false,error:e.message},{status:500});
  }
}
