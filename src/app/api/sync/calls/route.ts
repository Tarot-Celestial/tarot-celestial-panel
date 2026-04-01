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

function norm(h: string){
  return h.toLowerCase().trim();
}

function formatDate(d: string){
  const [day,month,year]=d.split("/");
  return `${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")}`;
}

function hash(r:string){
  let h=0;
  for(let i=0;i<r.length;i++){h=(h<<5)-h+r.charCodeAt(i);h|=0;}
  return h.toString();
}

export async function POST(){
  const res = await fetch(SHEET_URL);
  const csv = await res.text();

  const lines = csv.split("\n").filter(l=>l.trim());
  const headers = parse(lines[0]).map(norm);

  const idx = (name:string[]) => headers.findIndex(h=>name.some(n=>h.includes(n)));

  const iFecha = idx(["fecha"]);
  const iTel = idx(["telefonista"]);
  const iTarot = idx(["tarotista"]);
  const iMin = idx(["tiempo"]); // 🔥 FIX
  const iCodigo = idx(["codigo"]);
  const iImporte = idx(["importe"]);
  const iCapt = idx(["captado"]); // 🔥 FIX

  const rows = lines.slice(1);

  const data = rows.map(r=>{
    const c = parse(r);
    return {
      call_date: formatDate(c[iFecha]),
      telefonista: c[iTel],
      tarotista: c[iTarot],
      minutos: Number(c[iMin])||0,
      codigo: (c[iCodigo]||"cliente").toLowerCase(),
      importe: Number((c[iImporte]||"0").replace("€","").replace(",","."))||0,
      captada: c[iCapt]==="TRUE",
      source_row_hash: hash(r)
    }
  });

  await supabase.from("calls").upsert(data,{onConflict:"source_row_hash"});

  return NextResponse.json({ok:true});
}
