'use client';
import { useEffect, useRef, useState } from 'react';
import { AtlasLauncher } from '@/features/admin/atlas/AtlasCharacter';
import AtlasPortrait from './AtlasPortrait';
import styles from './AtlasTarotistaGuide.module.css';
type Destination = 'resumen' | 'notificaciones' | 'clientes' | 'chat' | 'checklist' | 'facturas';
const sections: Array<{tab:Destination;title:string;detail:string}> = [
  {tab:'resumen',title:'Mi turno',detail:'Revisa tu estado y la actividad registrada.'},
  {tab:'notificaciones',title:'Avisos pendientes',detail:'Consulta las novedades de tu panel.'},
  {tab:'clientes',title:'Mis clientas',detail:'Abre las fichas que tienes autorizadas.'},
  {tab:'chat',title:'Hablar con el equipo',detail:'Abre tu chat con centrales y compañeras.'},
  {tab:'checklist',title:'Mi checklist',detail:'Comprueba las tareas de tu turno.'},
  {tab:'facturas',title:'Mi factura',detail:'Consulta el resumen disponible para tu cuenta.'},
];
export default function AtlasTarotistaGuide({workerId,onNavigate}:{workerId:string|null;onNavigate:(tab:Destination)=>void}) {
  const [open,setOpen]=useState(false);const panel=useRef<HTMLElement>(null);const previous=useRef<HTMLElement|null>(null);
  const close=()=>{setOpen(false);previous.current?.focus();};
  useEffect(()=>{if(open)panel.current?.focus();},[open]);
  return <>
    <AtlasLauncher workerId={workerId} paused={open} label="Abrir Atlas, tu guía de tarotista" onOpen={()=>{if(open){close();return;}previous.current=document.activeElement as HTMLElement;setOpen(true);}}/>
    {open?<section ref={panel} tabIndex={-1} role="dialog" aria-label="Atlas, tu guía del turno" className={styles.panel} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close();}}}>
      <header><div className={styles.portrait}><AtlasPortrait state="greeting"/></div><div><small>TU COMPAÑERO CELESTIAL</small><h2>Atlas</h2><p>Vamos a poner el turno en orden.</p></div><button type="button" onClick={close} aria-label="Cerrar Atlas">×</button></header>
      <p className={styles.intro}>Ojos abiertos y alas listas. Elige por dónde empezamos.</p>
      <nav aria-label="Ayuda de Atlas">{sections.map(item=><button type="button" key={item.tab} onClick={()=>{setOpen(false);onNavigate(item.tab);}}><strong>{item.title}<span aria-hidden="true">↗</span></strong><small>{item.detail}</small></button>)}</nav>
      <footer>Los accesos mantienen los permisos de tu panel.</footer>
    </section>:null}
  </>;
}
