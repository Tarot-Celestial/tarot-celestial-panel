"use client";

import { useState } from "react";
import { ArrowRight, BarChart3, Bell, Check, ChevronRight, CircleAlert, CircleDollarSign, Coins, Info, Target, Trophy, Zap } from "lucide-react";
import type { CentralDailyPerformance } from "@/lib/central-daily-performance";
import { PETS, type PetId } from "@/lib/central-assistant";
import CompanionCharacter from "./assistant/CompanionCharacter";
import CentralPerformanceChart from "./CentralPerformanceChart";
import styles from "./CentralDailyOverview.module.css";

export type DailyAction = { id:string; label:string; rewardXp:number; completed?:boolean; detail?:string; kind?:"payment"|"followup"|"capture"|"xp"|"level_reward"; rewardCoins?:number };
export type DailySummaryData = {
 title?:string; subtitle?:string; actions:DailyAction[]; completed:number; target:number|null;
 dailyXp?:number; dateLabel?:string; performance?:CentralDailyPerformance; loading?:boolean; error?:string;
};
export type MissionItem = { id:string; name:string; description:string; progress:number; target:number; rewardXp:number; completed?:boolean; claimed?:boolean; periodKey?:string };
export type RecentNotificationType = "urgent"|"opportunity"|"achievement"|"information"|"sale";
export type RecentNotification = { id:string; type:RecentNotificationType; title:string; description:string; createdAtLabel:string; observation?:string; actionLabel?:string };
export type CentralDailyOverviewData = {
 dailySummary:DailySummaryData; missions:MissionItem[]; notifications:RecentNotification[];
 notificationsLoading?:boolean; notificationsError?:string; notificationTotal?:number; missionsUnavailable?:boolean;
};
type Props = {
 data:CentralDailyOverviewData; onViewAllMissions?:()=>void; onViewAllNotifications?:()=>void;
 onClaimMission?:(missionId:string,periodKey:string)=>Promise<unknown>;
 companionPet?:PetId; operatorName?:string; onOpenCompanion?:()=>void;
};
const formatXp=(value:number)=>new Intl.NumberFormat("es-ES").format(value);
const percent=(value:number,target:number)=>target>0?Math.max(0,Math.min(100,Math.round(value/target*100))):0;
function NotificationIcon({type}:{type:RecentNotificationType}) {
 if(type==="urgent")return <CircleAlert size={21}/>;
 if(type==="opportunity")return <Target size={21}/>;
 if(type==="achievement")return <Trophy size={21}/>;
 if(type==="sale")return <CircleDollarSign size={21}/>;
 return <Info size={21}/>;
}
export default function CentralDailyOverview({data,onViewAllMissions,onViewAllNotifications,onClaimMission,companionPet,operatorName,onOpenCompanion}:Props) {
 const [claiming,setClaiming]=useState<string|null>(null),[claimError,setClaimError]=useState("");
 const summary=data.dailySummary;
 const petName=companionPet?PETS[companionPet].name:"tu compañero";
 const firstName=operatorName?.trim().split(/\s+/)[0];
 async function claim(mission:MissionItem) {
  if(claiming||!mission.periodKey||!onClaimMission)return;
  setClaiming(mission.id);setClaimError("");
  try{await onClaimMission(mission.id,mission.periodKey)}catch(error){setClaimError(error instanceof Error?error.message:"No se pudo reclamar la misión. Inténtalo de nuevo.")}finally{setClaiming(null)}
 }
 return <section className={styles.layout} aria-label="Actividad diaria de Central">
  <article className={"tc-glass "+styles.panel+" "+styles.summaryPanel} data-companion-landmark>
   <header className={styles.panelHeader}>
    <span className={styles.headerIcon} aria-hidden="true"><BarChart3 size={24}/></span>
    <div><h2>{summary.title||"Tu resumen de hoy"}</h2><p>{summary.subtitle||"Actividad registrada · Europe/Madrid"}</p></div>
    <span className={styles.liveBadge}>Actividad real</span>
   </header>
   <CentralPerformanceChart performance={summary.performance} loading={summary.loading} error={summary.error}/>
   <details className={styles.activityDetails}>
    <summary className={styles.summaryFooter}>
     <span><Zap size={24}/><strong>{summary.loading||summary.error?"—":formatXp(summary.dailyXp||0)} XP</strong><span>ganados {summary.dateLabel||"hoy"}</span></span>
     <span className={styles.viewActivity}>Ver mi actividad <ChevronRight size={18}/></span>
    </summary>
    <div className={styles.dailyActions}>
     <p className={styles.actionCount}>{summary.loading?"Cargando…":summary.error?"No se pudo cargar la actividad.":summary.completed+" "+(summary.completed===1?"acción registrada":"acciones registradas")}</p>
     {!summary.loading&&!summary.error&&summary.actions.map(action=><div className={styles.dailyAction} key={action.id}>
      <span className={styles.actionState} aria-hidden="true">{action.kind==="level_reward"?<Coins size={16}/>:action.completed?<Check size={16}/>:<ChevronRight size={16}/>}</span>
      <span>{action.label}{action.detail&&<small>{action.detail}</small>}</span>
      {action.rewardCoins? <strong>+{formatXp(action.rewardCoins)} Coins</strong>:action.rewardXp!==0?<strong>{action.rewardXp>0?"+":""}{formatXp(action.rewardXp)} XP</strong>:null}
     </div>)}
    </div>
   </details>
  </article>
  <article className={"tc-glass "+styles.panel+" "+styles.missionsPanel}>
   <header className={styles.panelHeader}><span className={styles.headerIcon} aria-hidden="true"><Target size={23}/></span><div><h2>Misiones activas</h2><p>Misiones vigentes · progreso actual.</p></div></header>
   {claimError&&<p className={styles.errorState} role="alert">{claimError}</p>}
   <div className={styles.missionList}>
    {summary.loading?<p className={styles.emptyState}>Consultando misiones…</p>:summary.error||data.missionsUnavailable?<p className={styles.emptyState}>Misiones temporalmente no disponibles. Puedes volver a sincronizar.</p>:!data.missions.length?<p className={styles.emptyState}>Ahora no tienes misiones activas. Tus próximos retos aparecerán aquí.</p>:data.missions.map(mission=>{
     const complete=mission.target>0&&mission.progress>=mission.target;
     return <div className={styles.mission} key={mission.id}>
      <div className={styles.missionTop}><h3>{mission.name}</h3><span>+{formatXp(mission.rewardXp)} XP</span></div>
      <p>{mission.description}</p>
      <div className={styles.missionProgressMeta}><span>{complete?"Completada":"En progreso"}</span><strong>{mission.progress} / {mission.target}</strong></div>
      <div className={styles.missionTrack} role="progressbar" aria-label={mission.name} aria-valuemin={0} aria-valuemax={mission.target||1} aria-valuenow={Math.min(mission.progress,mission.target||1)}><span style={{width:percent(mission.progress,mission.target)+"%"}}/></div>
      {complete&&<button className={styles.panelButton} type="button" disabled={mission.claimed||!!claiming||!mission.periodKey||!onClaimMission} onClick={()=>void claim(mission)}>{mission.claimed?"Recompensa reclamada":claiming===mission.id?"Reclamando…":"Reclamar recompensa"}<Check size={16}/></button>}
     </div>;
    })}
   </div>
   <button className={styles.textButton} type="button" onClick={onViewAllMissions}>Ver mis misiones <ArrowRight size={17}/></button>
  </article>
  <article className={"tc-glass "+styles.panel+" "+styles.companionPanel}>
   {companionPet&&<div className={styles.companionArt}><CompanionCharacter pet={companionPet} state="idle" portrait reduced/></div>}
   <div className={styles.companionCopy}><h2>{firstName?"Hola, "+firstName+".":"Hola."}<br/>¿Revisamos tu turno?</h2><p>{companionPet?petName:"Tu compañero"} está aquí para ayudarte cuando lo necesites.</p><button className={styles.panelButton} type="button" onClick={onOpenCompanion}>Hablar con {petName}<ArrowRight size={16}/></button></div>
  </article>
  <article className={"tc-glass "+styles.panel+" "+styles.notificationsPanel}>
   <header className={styles.panelHeader}><span className={styles.headerIcon} aria-hidden="true"><Bell size={23}/></span><div><h2>Notificaciones recientes</h2></div>{!data.notificationsLoading&&!data.notificationsError&&<span className={styles.pendingCount}>{data.notificationTotal??data.notifications.length} pendientes</span>}</header>
   <div className={styles.notificationList} aria-busy={data.notificationsLoading}>
    {data.notificationsLoading&&!data.notifications.length?<p className={styles.emptyState}>Consultando notificaciones…</p>:data.notificationsError?<p className={styles.errorState}>No se han podido actualizar las notificaciones.</p>:!data.notifications.length?<p className={styles.emptyState}>Estás al día. No hay notificaciones pendientes.</p>:null}
    {data.notifications.map(notification=><div className={styles.notification} data-type={notification.type} key={notification.id}>
     <span className={styles.notificationIcon} aria-hidden="true"><NotificationIcon type={notification.type}/></span>
     <div className={styles.notificationBody}><div className={styles.notificationTitleRow}><h3>{notification.title}</h3><span>{notification.createdAtLabel}</span></div><p>{notification.description}</p>{notification.observation&&<p className={styles.observation}>{notification.observation}</p>}
      {notification.actionLabel&&<button type="button" className={styles.textButton} onClick={onViewAllNotifications}>{notification.actionLabel}<ArrowRight size={15}/></button>}
     </div>
    </div>)}
   </div>
   <button className={styles.panelButton} type="button" onClick={onViewAllNotifications}>Ver todas las notificaciones <ArrowRight size={18}/></button>
  </article>
 </section>;
}
