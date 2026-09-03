"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import type {WheelEntry} from "./raffle-wheel";
import {landingRotation} from "./raffle-wheel";
import {type CenterPrize,type CenterEntry,selectionLabel} from "./raffle-center";
import {useRaffleCenter} from "./useRaffleCenter";
import RaffleCanvas from "./RaffleCanvas";
import styles from "./CentralRaffleWheel.module.css";

function PrizeEditor({position,prize,busy,save}:{position:number;prize?:CenterPrize;busy:boolean;save:(position:number,name:string,previous:string|null)=>Promise<boolean>}){
 const [draft,setDraft]=useState<{name:string;base:string|null}|null>(null);
 const name=draft?.name??prize?.name??"";
 return <div className={styles.prizeRow}><label>Premio N{position}{position===1?" · Mayor valor":""}
  <input maxLength={200} value={name} disabled={busy||Boolean(prize?.selected_at)} placeholder="Nombre completo del premio" onChange={e=>setDraft({name:e.target.value,base:draft?draft.base:prize?.name??null})}/>
 </label><button type="button" disabled={busy||!name.trim()||Boolean(prize?.selected_at)||name===prize?.name}
  onClick={()=>void save(position,name,draft?draft.base:prize?.name??null).then(ok=>{if(ok)setDraft(null);})}>Guardar premio</button>
 {prize?.selected_at?<small>{prize.confirmed_at?"Confirmado":"Pendiente de confirmar"} · Número {prize.candidate_number}</small>:null}
 </div>;
}
const date=(s:string|null)=>s?new Date(s).toLocaleString("es-ES"):"—";

export default function CentralRaffleWheel({entries:initialEntries,title,raffleId,onClose}:{entries:WheelEntry[];title:string;raffleId:string;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),locked=useRef(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),mounted=useRef(true);
 const [busy,setBusy]=useState(false),[spinning,setSpinning]=useState(false);
 const {data,error,setError,loading,live,refresh,mutate}=useRaffleCenter(raffleId,locked,busy);
 const [selected,setSelected]=useState(""),[extraSlots,setExtraSlots]=useState(4);
 const [confirmSpin,setConfirmSpin]=useState(false),[cancelCheck,setCancelCheck]=useState(false);
 const [manual,setManual]=useState(false),[manualEntry,setManualEntry]=useState(""),[test,setTest]=useState(false),[simulate,setSimulate]=useState(true);
 const [query,setQuery]=useState(""),[manualQuery,setManualQuery]=useState(""),[visibleCount,setVisibleCount]=useState(50);
 const [notice,setNotice]=useState(""),[rotation,setRotation]=useState(0),[duration,setDuration]=useState(5200);
 const [spinPool,setSpinPool]=useState<CenterEntry[]|null>(null);
 const prizes=data?.prizes,entries=data?.entries,canManage=data?.canManage===true;
 const canSelect=data?.canSelect===true||canManage;
 const current=prizes?.find(p=>p.id===selected);
 const pending=prizes?.find(p=>p.selected_at&&!p.confirmed_at);
 const confirmed=useMemo(()=>prizes?.filter(p=>p.confirmed_at)||[],[prizes]);
 const eligible=useMemo(()=>entries?.filter(e=>e.eligible)||[],[entries]);
 const wheelEntries=spinPool||eligible;
 const unique=useMemo(()=>new Set(entries?.map(e=>e.clientId)).size,[entries]);
 const byId=useMemo(()=>new Map(entries?.map(e=>[e.id,e])),[entries]);
 const slots=Math.max(extraSlots,...(prizes?.map(p=>p.position)||[4]));
 const total=entries?.length??initialEntries.length;
 const filter=(list:CenterEntry[],value:string)=>{
  const q=value.trim().toLocaleLowerCase("es"),digits=q.replace(/\D/g,"");
  return list.filter(e=>`${e.number} ${e.name}`.toLocaleLowerCase("es").includes(q)||(canManage&&digits.length>=3&&(e.phone||"").replace(/\D/g,"").includes(digits)));
 };
 const filtered=useMemo(()=>filter(entries||[],query),[entries,query,canManage]);
 const manualMatches=useMemo(()=>filter(eligible,manualQuery),[eligible,manualQuery,canManage]);
 useEffect(()=>{setVisibleCount(50);},[query]);
 useEffect(()=>{if(current?.confirmed_at&&!spinning)setSpinPool(null);},[current?.confirmed_at,spinning]);
 useEffect(()=>{
  if(!prizes)return;
  setSelected(prev=>prizes.some(p=>p.id===prev)?prev:(pending?.id||prizes.find(p=>!p.confirmed_at)?.id||prizes[0]?.id||""));
 },[prizes,pending?.id]);
 useEffect(()=>{
  mounted.current=true;
  const d=dialog.current,focus=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  d?.showModal();document.body.style.overflow="hidden";
  return()=>{mounted.current=false;if(timer.current)clearTimeout(timer.current);d?.close();document.body.style.overflow=overflow;focus?.focus();};
 },[]);
 function release(){if(!mounted.current)return;locked.current=false;setBusy(false);setSpinning(false);}
 async function act(action:string,values:Record<string,unknown>={},message=""){
  if(locked.current||loading)return false;
  locked.current=true;setBusy(true);setError("");setNotice("");
  try{
   await mutate(action,{prize_id:current?.id,revision:current?.selection_revision,...values});
   if(mounted.current){setNotice(message);setCancelCheck(false);setManual(false);setManualEntry("");setSpinPool(null);}
   return true;
  }catch(e){
   if(mounted.current)setError(e instanceof Error?e.message:"No se pudo completar. Actualiza antes de reintentar.");
   return false;
  }finally{release();}
 }
 function selectPrize(id:string){
  setSelected(id);setManual(false);setCancelCheck(false);setConfirmSpin(false);setSpinPool(null);setNotice("");
 }
 async function spin(){
  if(locked.current||!current||current.selected_at||!eligible.length)return;
  locked.current=true;setBusy(true);setSpinning(true);setError("");setNotice("");setConfirmSpin(false);setManual(false);
  try{
   const next=await mutate("draw",{prize_id:current.id,revision:current.selection_revision});
   if(!mounted.current)return;
   const pool=next.spinEntries||[],candidate=next.prizes.find(p=>p.id===current.id);
   const index=pool.findIndex(e=>e.id===candidate?.candidate_entry_id);
   if(index<0)throw new Error("El resultado está guardado; actualiza para recuperarlo.");
   setSpinPool(pool);
   const ms=window.matchMedia("(prefers-reduced-motion: reduce)").matches?50:5200;
   setDuration(ms);setRotation(previous=>landingRotation(previous,index,pool.length));
   timer.current=setTimeout(()=>{timer.current=null;release();},ms+80);
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:"No se pudo girar.");release();}
 }
 const winnerName=current?.candidate_name||byId.get(current?.candidate_entry_id||"")?.name||"Cliente asignado";
 const disabled=busy||loading||!data;
 return <dialog ref={dialog} className={styles.dialog} aria-labelledby="raffle-wheel-title"
  onCancel={e=>{e.preventDefault();if(!locked.current)onClose();}}>
  <header className={styles.header}><div><span className={styles.eyebrow}>TAROT CELESTIAL / SORTEOS</span>
   <h2 id="raffle-wheel-title">Centro de selección de <em>ganadores</em></h2>
   <p>{title} · Premios reales, decisiones trazables</p>
  </div><button type="button" onClick={onClose} disabled={busy} aria-label="Cerrar ruleta">×</button></header>
  <div className={styles.topline}><span className={live?styles.online:styles.offline}>{live?"● Conectado a cambios":"○ Sin conexión en vivo · Actualiza si es necesario"}</span>
   <button type="button" disabled={disabled} onClick={()=>void refresh()}>Actualizar</button></div>
  <div className={styles.stats}>
   {[["Participaciones totales",total],["Participantes únicos",unique],["Números elegibles",eligible.length],["Ganadores confirmados",confirmed.length]].map(([label,n])=><div key={label}><span>{label}</span><strong>{n}</strong></div>)}
  </div>
  <div className={styles.rule}><div><b>Ganadores repetidos</b><p>La regla se aplica a la persona y a todos sus números. Nunca se borran participaciones.</p></div>
   <select aria-label="Ganadores repetidos" value={data?.raffle.allow_repeat_winners?"yes":"no"} disabled={disabled||!canManage||Boolean(pending)}
    onChange={e=>void act("rule",{allow_repeat_winners:e.target.value==="yes"},"Regla actualizada.")}>
    <option value="no">No permitir · Una persona, un premio</option><option value="yes">Permitir · Puede ganar otra vez</option>
   </select></div>
  {!canSelect&&!loading?<p className={styles.notice}>Los controles de confirmar, cancelar y asignar manualmente requieren el SQL actualizado de controles del sorteo. No vuelvas a girar el mismo premio si tiene un candidato pendiente.</p>:null}
  {prizes?.some(p=>p.selected_at&&!p.confirmed_at)?<div className={styles.pendingSummary}><b>Selecciones pendientes</b><p>Cada premio conserva su candidato. Puedes sortear otro premio sin perderlo; confirmar publica el resultado, cancelar libera solamente esa selección.</p>
   <div>{prizes.filter(p=>p.selected_at&&!p.confirmed_at).map(p=><button key={p.id} type="button" className={styles.pendingLink} disabled={busy} onClick={()=>selectPrize(p.id)}>Premio N{p.position} · #{p.candidate_number} · {p.id===selected?"Abierto":"Revisar ganador"}</button>)}</div></div>:null}
  {error?<div className={styles.error} role="alert">{error} <button type="button" disabled={busy} onClick={()=>void refresh()}>Recuperar estado guardado</button></div>:null}
  {notice?<p className={styles.notice} role="status">{notice}</p>:null}
  <div className={styles.layout}>
   <section className={styles.stage} aria-label="Ruleta del sorteo">
    <div className={styles.stageHeader}><span className={styles.eyebrow}>01 / SELECCIÓN ALEATORIA</span><span>{spinning?"SELECCIONANDO…":eligible.length+" NÚMEROS"}</span></div>
    <RaffleCanvas entries={wheelEntries} rotation={rotation} duration={duration} spinning={spinning}/>
    <label className={styles.prizeSelect}>Premio que se sorteará
     <select value={selected} disabled={disabled} onChange={e=>selectPrize(e.target.value)}>
      <option value="">Selecciona un premio guardado</option>
      {prizes?.map(p=><option key={p.id} value={p.id}>Premio N{p.position} · {p.name}{p.confirmed_at?" · Confirmado":p.selected_at?" · Pendiente de confirmar":""}</option>)}
     </select></label>
    {current?<div className={styles.prizePreview}><span>PREMIO N{current.position}</span><b>{current.name}</b><small>{current.confirmed_at?"Confirmado":current.selected_at?"Ganador provisional":"Pendiente de sortear"}</small></div>:null}
    {confirmSpin&&current?<div className={styles.confirmBox}><p>¿Sortear Premio N{current.position}: <b>{current.name}</b> entre {eligible.length} números elegibles?</p>
     <button type="button" disabled={disabled||Boolean(current.selected_at)} onClick={()=>void spin()}>Confirmar y girar</button><button type="button" disabled={busy} onClick={()=>setConfirmSpin(false)}>Volver</button></div>
     :<button type="button" className={styles.spinButton} disabled={disabled||!current||Boolean(current.selected_at)||!eligible.length} onClick={()=>{setManual(false);setConfirmSpin(true);}}>{spinning?"Seleccionando ganador…":"✦ Girar la ruleta"}</button>}
    {current?.selected_at&&!current.confirmed_at?<p className={styles.notice}>Este premio tiene un ganador provisional. Confírmalo o cancela su selección en los botones de abajo para volver a sortear este mismo premio.</p>:null}
    <p className={styles.hint}>Una oportunidad por número elegible. Selección aleatoria realizada en el servidor.</p>
    {current?.selected_at&&!spinning?<div key={current.id+":"+current.selection_revision} className={styles.result} role="status" aria-live="polite">
     <span>{current.confirmed_at?"GANADOR CONFIRMADO":"✦ GANADOR PROVISIONAL ✦"}</span>
     <strong>#{current.candidate_number}</strong><b>{winnerName}</b><p>{current.name}</p>
     <span className={current.is_test?styles.testBadge:styles.methodBadge}>{selectionLabel(current)}</span>
     <small>{current.confirmed_at?"Publicado · "+date(current.confirmed_at):"Pendiente de confirmar"}</small>
     {!current.confirmed_at&&canSelect?<><p className={styles.hint}>{current.simulation_only?"Solo simular: registra la prueba y libera el premio. No publica ni modifica saldos.":current.is_test?"Publicará PRUEBA en Panel Cliente y dejará este premio confirmado. No abona saldo.":"Publica el premio y el número anónimo en Panel Cliente. No abona minutos automáticamente."}</p>
      <div className={styles.actions}><button type="button" className={styles.spinButton} disabled={disabled} onClick={()=>void act("confirm",{},current.simulation_only?"Simulación registrada: premio disponible, sin publicación ni abonos.":"Ganador confirmado y publicado. Sin abonos automáticos.")}>{busy?"Guardando…":current.simulation_only?"Confirmar simulación":"Confirmar ganador"}</button>
       <button type="button" className={styles.cancelButton} disabled={disabled} onClick={()=>setCancelCheck(true)}>× Cancelar selección</button></div>
      {cancelCheck?<div className={styles.confirmBox}><p>¿Descartar este resultado?</p><button type="button" disabled={busy} onClick={()=>setCancelCheck(false)}>No</button><button type="button" disabled={busy} onClick={()=>void act("cancel",{},"Candidato descartado. El premio y las participaciones se conservan.")}>Sí, descartar</button></div>:null}
     </>:null}
    </div>:<div className={styles.standby} role="status">{loading?"Consultando premios existentes…":spinning?"Seleccionando ganador…":eligible.length?"El próximo ganador está por descubrirse":"No quedan números elegibles para nuevos premios."}</div>}
    {canSelect?<div className={styles.manualBox}><span className={styles.eyebrow}>02 / ASIGNACIÓN MANUAL · CENTRAL Y ADMIN</span>
     <button type="button" className={styles.manualButton} disabled={disabled||!current||Boolean(current.selected_at)||!eligible.length}
      onClick={()=>{setManual(v=>!v);setConfirmSpin(false);setManualEntry("");}}>Asignar ganador por nombre</button>
     {manual?<><p>Escribe el nombre y elige su número real. Esta selección se registra como Manual, no como un giro aleatorio. Solo se publica después de confirmar al ganador.</p>
      <label className={styles.check}><input type="checkbox" checked={test} onChange={e=>setTest(e.target.checked)} disabled={busy}/> Modo prueba</label>
      {test?<label className={styles.prizeSelect}>Al confirmar esta prueba<select value={simulate?"simulate":"publish"} disabled={busy} onChange={e=>setSimulate(e.target.value==="simulate")}>
       <option value="simulate">Solo simular · Sin publicar</option><option value="publish">Publicar prueba en Panel Cliente · Sin abono</option>
      </select></label>:null}
      <label className={styles.prizeSelect}>Nombre del ganador<input value={manualQuery} onChange={e=>{setManualQuery(e.target.value);setManualEntry("");}} placeholder={canManage?"Nombre, número o teléfono":"Escribe el nombre o número del participante"} disabled={busy}/></label>
      <div className={styles.manualList}>{manualMatches.slice(0,50).map(e=><button key={e.id} type="button" disabled={busy} aria-pressed={manualEntry===e.id} onClick={()=>setManualEntry(e.id)}><b>#{e.number}</b><span>{e.name}</span>{manualEntry===e.id?" ✓":""}</button>)}</div>
      {manualMatches.length>50?<small>Mostrando 50 de {manualMatches.length}. Afina la búsqueda.</small>:null}
      {!manualMatches.length?<p>No hay participantes elegibles con ese nombre. No se crean clientes ni números ficticios.</p>:null}
      <button type="button" className={styles.manualButton} disabled={disabled||!manualEntry||!byId.get(manualEntry)?.eligible} onClick={()=>void act("manual",{entry_id:manualEntry,is_test:test,simulation_only:test&&simulate},"Candidato manual seleccionado. Revisa antes de confirmar.")}>Seleccionar participante {manualEntry?"#"+byId.get(manualEntry)?.number:""}</button>
     </>:null}
    </div>:null}
   </section>
   <section className={styles.participants} aria-labelledby="raffle-participants-title"><span className={styles.eyebrow}>PARTICIPACIONES REALES</span>
    <h3 id="raffle-participants-title">Números participantes <span>{total}</span></h3>
    <label>Buscar número o cliente<input value={query} onChange={e=>setQuery(e.target.value)} placeholder={canManage?"Número, nombre o teléfono…":"Número o nombre…"}/></label>
    <p>{filtered.length} resultados · {eligible.length} elegibles</p>
    <ul>{filtered.slice(0,visibleCount).map(e=><li key={e.id} className={e.id===current?.candidate_entry_id?styles.selected:!e.eligible?styles.ineligible:undefined}>
     <b>#{e.number}</b><div><span>{e.name}</span><small>{e.won?(e.eligible?"🏆 Ya ganó · Puede repetir":"🏆 Ya ganó · No elegible"):"✓ Elegible"}</small></div></li>)}</ul>
    {filtered.length>visibleCount?<button type="button" onClick={()=>setVisibleCount(n=>n+50)}>Mostrar siguientes 50</button>:null}
    {!filtered.length?<p>No hay coincidencias.</p>:null}<small>Un cliente puede tener varios números. Ganar excluye todos ellos cuando no se permiten ganadores repetidos.</small>
   </section>
  </div>
  <section className={styles.history}><span className={styles.eyebrow}>03 / RESULTADOS CONFIRMADOS</span><h3>Historial de ganadores</h3>
   {!confirmed.length?<p>Aún no hay ganadores confirmados.</p>:<div className={styles.historyGrid}>{confirmed.map(p=><article key={p.id}>
    <span>Premio N{p.position} · {selectionLabel(p)}</span><h4>{p.name}</h4><strong>#{p.candidate_number}</strong><b>{p.candidate_name||"Cliente asignado"}</b><small>{date(p.confirmed_at)}</small>
    <small>Seleccionó: {p.selected_by_name||p.selected_by||"—"} · Confirmó: {p.confirmed_by_name||p.confirmed_by||"—"}</small>
   </article>)}</div>}
   {canManage?<details><summary>Registro de actividad · Últimos 100 eventos</summary><ol className={styles.audit}>{data?.audit.map(a=><li key={a.id}>
    <b>{({raffle_selected:"Candidato seleccionado",raffle_confirmed:"Ganador confirmado",raffle_cancelled:"Candidato descartado",raffle_simulated:"Simulación confirmada · Sin publicar",raffle_rule_changed:"Regla modificada",raffle_prize_saved:"Premio guardado"} as Record<string,string>)[a.action_type]||a.action_type}</b>
    <span>{a.payload.position?"Premio N"+a.payload.position:""} {a.payload.prize_name||""} {a.payload.number?" · #"+a.payload.number:""} {a.payload.name||""}</span>
    <small>{a.payload.method?selectionLabel({selection_method:a.payload.method,is_test:a.payload.is_test,simulation_only:a.payload.simulation_only})+" · ":""}{a.actor||"Trabajador registrado"} · {date(a.created_at)}</small>
   </li>)}</ol></details>:null}
  </section>
  <section className={styles.prizeSettings} aria-labelledby="prize-settings-title"><span className={styles.eyebrow}>04 / CONFIGURACIÓN EXISTENTE</span>
   <h3 id="prize-settings-title">Configurar premios</h3><p>Los nombres y las posiciones existentes se conservan. Solo se modifica un premio al pulsar su botón Guardar. El nombre se publicará: no incluyas datos de clientes.</p>
   {Array.from({length:slots},(_,i)=><PrizeEditor key={i+1} position={i+1} prize={prizes?.find(p=>p.position===i+1)} busy={disabled} save={(position,name,previous_name)=>act("save",{position,name,previous_name},"Premio guardado.")}/>)}
   <button type="button" disabled={disabled||slots>=100} onClick={()=>setExtraSlots(slots+1)}>+ Añadir otro premio</button>
  </section>
 </dialog>;
}
