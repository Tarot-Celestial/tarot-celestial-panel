import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSLT1yIj5KRXABYpubiiM_9DQLqAT3zriTsW44S-SBvz_ZhjKJJu35pP9F4j-sT6Pt0hmRGsnqlulyM/pub?gid=1587355871&single=true&output=csv";

// ✅ FIX TYPESCRIPT
function parse(line: string): string[] {
  return line.split(",");
}

function formatDate(d: string): string | null {
  if (!d) return null;
  const parts = d.split("/");
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")}`;
}

function normalizeCodigo(c: string): string {
  if (!c) return "cliente";
  const val = c.trim().toLowerCase();
  return ["cliente","vip","promo"].includes(val) ? val : "cliente";
}

function hash(row: string): string {
  let h=0;
  for(let i=0;i<row.length;i++){
    h=(h<<5)-h+row.charCodeAt(i);
    h|=0;
  }
  return h.toString();
}

export async function POST() {
  try {
    const res = await fetch(SHEET_URL);
    const csv = await res.text();

    const rows = csv.split("\n").slice(1);

    const parsed = rows.map((row:string)=>{
      const c = parse(row);

      return {
        call_date: formatDate(c[0]),
        telefonista: c[1]?.trim(),
        tarotista: c[3]?.trim(),
        minutos: Number(c[4]) || 0,
        codigo: normalizeCodigo(c[5]),
        importe: Number(c[6]) || 0,
        captada: c[7]?.trim() === "TRUE",
        source_row_hash: hash(row)
      };
    });

    const clean = parsed.filter(r=>r.call_date);

    const { error } = await supabase
      .from("calls")
      .upsert(clean, { onConflict:"source_row_hash" });

    if(error){
      return NextResponse.json({ok:false,error:error.message});
    }

    return NextResponse.json({ok:true, inserted:clean.length});

  } catch(e:any){
    return NextResponse.json({ok:false,error:e.message});
  }
}
