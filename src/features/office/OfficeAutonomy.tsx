"use client";

import { useEffect, useRef, useState } from "react";
import { officeDepartments } from "./catalog";
import { officeRequest } from "./office-client";
import { actionLabel, anyScope, autonomyActions, autonomyChannels, autonomyModes, ruleFor,
  type AutonomyRule, type AutonomySnapshot, type RuleScope } from "./office-autonomy";
import s from "./OfficeMonthlyReport.module.css";

const endpoint = "/api/admin/office/autonomy";
const money = (value:number) => new Intl.NumberFormat("es-ES",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:4}).format(value);
const departmentName = (id:string) => officeDepartments.find(d=>d.id===id)?.name || "Oficina completa";
const modeName = {automatic:"Autorización vigente",paused:"En pausa",human:"Revisión humana"};
const timeText = (value:string|null) => value?.slice(0,5) || "";

function Editor({initial,onSave,busy}:{initial:AutonomyRule;onSave:(rule:AutonomyRule)=>void;busy:boolean}) {
  const [draft,setDraft] = useState(initial);
  const field = (patch:Partial<AutonomyRule>) => setDraft(prev=>({...prev,...patch}));
  function submit(e:React.FormEvent) {
    e.preventDefault();
    onSave({...draft,window_start:timeText(draft.window_start)||null,window_end:timeText(draft.window_end)||null});
  }
  return <form onSubmit={submit} className={s.controls}>
    <label>Tratamiento<select value={draft.mode} onChange={e=>field({mode:e.target.value as AutonomyRule["mode"]})}>
      {Object.entries(autonomyModes).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>
    <label>Desde · Madrid<input type="time" value={timeText(draft.window_start)} required={!!draft.window_end}
      onChange={e=>field({window_start:e.target.value||null})}/></label>
    <label>Hasta · Madrid<input type="time" value={timeText(draft.window_end)} required={!!draft.window_start}
      onChange={e=>field({window_end:e.target.value||null})}/></label>
    <label>Acciones por día<input type="number" min="0" max="100000" placeholder="Sin tope adicional" value={draft.daily_actions??""}
      onChange={e=>field({daily_actions:e.target.value===""?null:Number(e.target.value)})}/></label>
    <label>Presupuesto diario · USD<input type="number" min="0" max="100000" step="0.01" placeholder="Sin tope adicional" value={draft.daily_usd??""}
      onChange={e=>field({daily_usd:e.target.value===""?null:Number(e.target.value)})}/></label>
    <button type="submit" disabled={busy}>Guardar regla</button>
  </form>;
}

export default function OfficeAutonomy() {
  const [data,setData] = useState<AutonomySnapshot|null>(null);
  const [scope,setScope] = useState<RuleScope>(anyScope);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);
  const saving = useRef(false);
  useEffect(()=>{
    const ctl=new AbortController();
    officeRequest<AutonomySnapshot>(endpoint,{signal:ctl.signal}).then(value=>{if(!ctl.signal.aborted)setData(value);})
      .catch(e=>{if(!ctl.signal.aborted)setError(e.message);});
    return ()=>ctl.abort();
  },[]);
  async function load() {
    setData(await officeRequest<AutonomySnapshot>(endpoint));
  }
  async function save(rule:AutonomyRule,hold?:boolean) {
    if(saving.current) return;
    saving.current=true;setBusy(true);setError("");setNotice("");
    try {
      await officeRequest(endpoint,{method:"POST",body:JSON.stringify(hold!==undefined?{operation:"hold",held:hold,department:rule.department,revision:rule.revision}:{...rule,
        window_start:timeText(rule.window_start)||null,window_end:timeText(rule.window_end)||null})});
      await load();setNotice("Regla guardada.");
    } catch(e) { setError(e instanceof Error?e.message:"No se pudo guardar la regla."); }
    finally {saving.current=false;setBusy(false);}
  }
  const global = ruleFor(data?.rules || [],anyScope);
  const actions = Object.entries(autonomyActions).filter(([,a])=>!scope.department || a.departments.includes(scope.department));
  const action = autonomyActions[scope.action as keyof typeof autonomyActions];
  const channelList = Object.entries(autonomyChannels).filter(([key])=>!action || action.channels.includes(key));
  function choose(next:RuleScope) {setScope(next);setError("");setNotice("");}
  const selected=ruleFor(data?.rules || [],scope);
  const deptRule=ruleFor(data?.rules || [],{...anyScope,department:scope.department});
  const reserved=data?.usage.reduce((a,r)=>a+Number(r.reserved_usd),0)||0;
  return <section className={s.report} aria-labelledby="autonomy-heading">
    <header className={s.header}><div><p className={s.area}>Dirección de Oficina</p><h2 id="autonomy-heading">Autonomía</h2></div>
      <div className={s.controls}>
        <button type="button" disabled={busy} onClick={()=>{setError("");load().catch(e=>setError(e.message));}}>Actualizar</button>
        {data && <button type="button" disabled={busy} onClick={()=>save(global,!global.held)}>
          {global.held?"Retirar pausa general":"Pausar toda la Oficina"}</button>}
      </div></header>
    {error && <p className={s.notice} role="alert">{error}</p>}
    {notice && <p className={s.notice} role="status">{notice}</p>}
    {data ? <>
      <section className={s.section}><h3 className={s.subheading}>Actividad de hoy · Madrid</h3>
        <div className={s.cohort}><div>Control general<strong>{global.held?"Pausa general":modeName[global.mode]}</strong></div>
          <div>Operaciones iniciadas<strong>{data.usage.reduce((a,r)=>a+r.operations,0)}</strong></div>
          <div>Presupuesto reservado<strong>{money(reserved)}</strong></div><div>Coste estimado de IA<strong>{money(data.estimated_usd)}</strong></div></div>
        <p className={s.note}>La Oficina reserva hasta 0,10 USD antes de cada petición de IA. El coste estimado se calcula con los tokens que declara el proveedor y el precio del modelo. El motor mantiene su tope de 2,40 USD al día UTC. Un presupuesto aplicable también detiene las plantillas oficiales de WhatsApp cuyo coste aún se desconoce.</p>
      </section>
      <section className={s.section}><h3 className={s.subheading}>Regla de autonomía</h3>
        <p className={s.note}>Se combinan las reglas de Oficina, departamentos, acción, canal y cuenta. Una pausa se aplica al siguiente envío que aún pueda detenerse. Los recibos de acciones en curso siguen conciliándose.</p>
        <div className={s.controls}>
          <label>Departamento<select value={scope.department} onChange={e=>choose({...anyScope,department:e.target.value})}>
            <option value="">Toda la Oficina</option>{officeDepartments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Acción<select value={scope.action} onChange={e=>choose({...scope,action:e.target.value,channel:"",account:""})}>
            <option value="">Todas las acciones</option>{actions.map(([id,v])=><option key={id} value={id}>{v.label}</option>)}</select></label>
          <label>Canal<select value={scope.channel} onChange={e=>choose({...scope,channel:e.target.value,account:""})}>
            <option value="">Todos los canales</option>{channelList.map(([id,v])=><option key={id} value={id}>{v}</option>)}</select></label>
          {scope.channel!=="" && <label>Cuenta<select value={scope.account} onChange={e=>choose({...scope,account:e.target.value})}>
            <option value="">Todas las cuentas</option>{data.accounts.filter(a=>a.channel===scope.channel).map(a=>
            <option key={a.account} value={a.account}>{a.account}</option>)}
            {scope.account&&!data.accounts.some(a=>a.channel===scope.channel&&a.account===scope.account)&&<option>{scope.account}</option>}</select></label>}
          {scope.department && <button type="button" disabled={busy} onClick={()=>save(deptRule,!deptRule.held)}>
            {deptRule.held?"Retirar pausa de ":"Pausar "}{departmentName(scope.department)}</button>}
        </div>
        <p className={s.note}>Puedes dejar el horario vacío para cubrir las 24 horas. Una franja de noche termina al día siguiente. Los límites diarios se reinician a medianoche en Madrid.</p>
        <Editor key={JSON.stringify([scope,selected.revision])} initial={selected} busy={busy} onSave={save}/>
      </section>
      <section className={s.section}><h3 className={s.subheading}>Reglas guardadas</h3>
        {data.rules.length ? <div className={s.scroll}><table className={s.table}><thead><tr><th>Ámbito</th><th>Estado</th><th>Horario</th><th>Límites diarios</th><th></th></tr></thead>
          <tbody>{data.rules.map(r=><tr key={JSON.stringify([r.department,r.action,r.channel,r.account])}>
          <th scope="row">{[departmentName(r.department),r.action&&actionLabel(r.action),autonomyChannels[r.channel],r.account].filter(Boolean).join(" · ")}</th>
          <td>{r.held?"Pausa de emergencia · ":""}{modeName[r.mode]}</td><td>{r.window_start?timeText(r.window_start)+"–"+timeText(r.window_end):"24 h"}</td>
          <td>{[r.daily_actions!==null&&r.daily_actions+" acciones",r.daily_usd!==null&&money(r.daily_usd)].filter(Boolean).join(" · ")||"Sin tope adicional"}</td>
          <td><button type="button" onClick={()=>choose({department:r.department,action:r.action,channel:r.channel,account:r.account})}>Editar</button></td></tr>)}</tbody></table></div>
          : <p className={s.note}>Se aplican las autorizaciones y límites existentes de cada trabajo.</p>}
      </section>
    </> : !error && <p className={s.notice} role="status">Consultando reglas y uso…</p>}
  </section>;
}
