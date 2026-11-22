import { createHash } from "node:crypto";
import type { PilotSpend } from "@/features/office/office-campaign-pilot";

export function dateInZone(date:Date, timeZone:string) {
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  return ["year","month","day"].map(key=>parts.find(p=>p.type===key)!.value).join("-");
}
export function validZone(zone:unknown):zone is string {
  if (typeof zone!=="string" || zone.length>80 || !(zone==="UTC" || /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){1,2}$/.test(zone))) return false;
  try { dateInZone(new Date(0),zone);return true; } catch { return false; }
}
export function periodFor(month:string,zone:string,now:Date) {
  const start=month+"-01";
  const last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
  const today=dateInZone(now,zone);
  return {from:start,through:today<last?today:last};
}
const numericId=(value:unknown):value is string=>typeof value==="string" && /^\d{1,40}$/.test(value);
const amount=(value:unknown):value is string=>typeof value==="string" && /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value);
const isoCurrency=(value:unknown):value is string=>typeof value==="string" && /^[A-Z]{3}$/.test(value);

export async function readPilotSpend(campaign:string,month:string,now:Date):Promise<{spend:PilotSpend|null;reason:string|null;zone:string|null;account:string|null;currency:string|null}> {
  let zone:string|null=null, account:string|null=null, currency:string|null=null;
  const missing=(reason:string)=>({spend:null,reason,zone,account,currency});
  if (!numericId(campaign)) return missing("not_campaign");
  const token=(process.env.META_ADS_READ_TOKEN || process.env.META_ACCESS_TOKEN || "").trim();
  if (!token) return missing("not_connected");
  const version=/^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION||"")?process.env.META_GRAPH_API_VERSION:"v24.0";
  const deadline=Date.now()+8500;
  async function get(path:string,params:Record<string,string>) {
    const url=new URL("https://graph.facebook.com/"+version+"/"+path);
    for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
    const r=await fetch(url,{method:"GET",headers:{Authorization:"Bearer "+token},cache:"no-store",redirect:"error",
      signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
    const result=await r.json().catch(()=>null);
    if (!r.ok || !result || result.error) {
      const code=Number(result?.error?.code);
      throw new Error([10,100,190,200].includes(code)||r.status===403||r.status===401?"no_access":"provider_unavailable");
    }
    return result;
  }
  try {
    const owner=await get(campaign,{fields:"id,account_id"});
    if (owner.id!==campaign || !numericId(owner.account_id)) return missing("unverified_account");
    account=owner.account_id;
    const info=await get("act_"+account,{fields:"account_id,currency,timezone_name"});
    if (info.account_id!==account || !validZone(info.timezone_name) || !isoCurrency(info.currency)) return missing("unverified_account");
    zone=info.timezone_name;currency=info.currency;
    const period=periodFor(month,info.timezone_name,now);
    if (period.through<period.from) return missing("not_started");
    const insights=await get(campaign+"/insights",{level:"campaign",fields:"campaign_id,account_id,account_currency,spend,date_start,date_stop",
      time_range:JSON.stringify({since:period.from,until:period.through}),limit:"2"});
    if (!Array.isArray(insights.data) || insights.data.length!==1 || insights.paging?.next) return missing("no_period_total");
    const row=insights.data[0];
    if (row.campaign_id!==campaign || row.account_id!==account || row.account_currency!==info.currency || !amount(row.spend)
        || row.date_start!==period.from || row.date_stop!==period.through) return missing("unverified_period");
    return {spend:{source:"meta_insights",account_id:owner.account_id,currency:info.currency,zone:info.timezone_name,...period,amount:Number(row.spend),checked_at:now.toISOString()},reason:null,zone,account,currency};
  } catch(e) { return missing(e instanceof Error && e.message==="no_access"?"no_access":"provider_unavailable"); }
}

function records(csv:string,separator:string) {
  const rows:string[][]=[];let row:string[]=[],value="",quoted=false,closed=false;
  for(let i=0;i<csv.length;i++) {
    const c=csv[i];
    if (quoted) {
      if (c!=='"') value+=c;
      else if (csv[i+1]==='"') {value+='"';i++;}
      else {quoted=false;closed=true;}
    } else if(c===separator || c==="\n" || c==="\r") {
      row.push(value.trim());value="";closed=false;
      if(c!==separator) {if(row.some(Boolean))rows.push(row);row=[];if(c==="\r" && csv[i+1]==="\n") i++;}
    } else if(c==='"' && !value && !closed) quoted=true;
    else if(closed) {if(c!==" " && c!=="\t") throw new Error("CSV mal delimitado.");}
    else value+=c;
  }
  if(quoted)throw new Error("CSV con comillas sin cerrar.");
  row.push(value.trim());if(row.some(Boolean))rows.push(row);
  return rows;
}
const norm=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
function csvNumber(value:string) {
  let clean=value.trim();
  if (/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[,.]\d{1,2})?$/.test(clean)) clean=clean.replace(/[ \u00a0\u202f]/g,"");
  // The export may use 1.234,56 or 1,234.56. A solitary 1,234 is ambiguous.
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(clean)) clean=clean.replace(/\./g,"").replace(",",".");
  else if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(clean)) clean=clean.replace(/,/g,"");
  else if (/^\d{1,3}[,.]\d{3}$/.test(clean)) throw new Error("El separador del importe es ambiguo.");
  else clean=clean.replace(",",".");
  if (!amount(clean)) throw new Error("El gasto de la fila debe ser un importe numérico positivo o cero.");
  return clean;
}
function csvDay(raw:string) {
  const es=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso=es?es[3]+"-"+es[2]+"-"+es[1]:raw;
  if (!/^\d{4}-\d\d-\d\d$/.test(iso) || !Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0,10)!==iso) throw new Error("Usa fechas ISO o día/mes/año en la exportación.");
  return iso;
}
export function parsePilotCsv(bytes:Buffer,campaign:string,month:string,zone:string,now:Date) {
  if (!numericId(campaign)||!validZone(zone)||!bytes.length||bytes.length>524288) throw new Error("Revisa la campaña, la zona y el tamaño del CSV.");
  const csv=new TextDecoder("utf-8",{fatal:true}).decode(bytes).replace(/^\uFEFF/,"");
  const rowsets=[",",";","\t"].map(sep=>{try{return records(csv,sep);}catch{return [];}});
  const options=rowsets.filter(rows=>rows.length>=2 && rows[0].some(h=>/^(?:campaign id|id de (?:la )?campana|identificador de (?:la )?campana)$/.test(norm(h))));
  if(options.length!==1)throw new Error("Incluye la columna identificador de campaña en el CSV de Meta.");
  const [rawHeader,...rows]=options[0],headers=rawHeader.map(norm);
  function field(expr:RegExp,optional=false) {
    const ids=headers.flatMap((h,i)=>expr.test(h)?[i]:[]);
    if (ids.length>1 || (!optional && !ids.length)) throw new Error("Faltan columnas o hay columnas duplicadas en el CSV.");
    return ids[0]??-1;
  }
  const ci=field(/^(?:campaign id|id de (?:la )?campana|identificador de (?:la )?campana)$/);
  const ai=field(/^(?:account id|ad account id|(?:id|identificador) de (?:la )?cuenta(?: publicitaria)?)$/);
  const si=field(/^(?:reporting starts|reporting start|inicio del informe|inicio de los informes|fecha de inicio del informe)$/);
  const ei=field(/^(?:reporting ends|reporting end|fin del informe|fin de los informes|fecha de fin del informe)$/);
  const vi=field(/^(?:amount spent|importe gastado|cantidad gastada)(?: \([a-z]{3}\))?$/);
  const mi=field(/^(?:currency|account currency|divisa|moneda|divisa de la cuenta|moneda de la cuenta)$/,true);
  const selected=rows.filter(row=>row[ci]===campaign);
  if(selected.length!==1 || selected[0].length!==headers.length) throw new Error("Exporta una sola fila agregada para esta campaña y período, sin desgloses.");
  const line=selected[0],embedded=headers[vi].match(/\(([a-z]{3})\)$/)?.[1].toUpperCase();
  const currency=mi>=0?line[mi].toUpperCase():embedded;
  if(!isoCurrency(currency) || (embedded && currency!==embedded) || !numericId(line[ai])) throw new Error("La cuenta y la moneda deben constar explícitamente y coincidir.");
  const from=csvDay(line[si]),through=csvDay(line[ei]),period=periodFor(month,zone,now);
  if(from!==period.from || through<from || through>period.through)throw new Error("El período debe comenzar el día uno del mes elegido y terminar en una fecha ya alcanzada.");
  return {campaign,account:line[ai],from,through,currency,zone,amount:csvNumber(line[vi]),sha256:createHash("sha256").update(bytes).digest("hex")};
}
