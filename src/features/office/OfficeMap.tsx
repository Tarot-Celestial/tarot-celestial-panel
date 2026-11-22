'use client';

import { useRef, useState, type CSSProperties } from 'react';
import {
  ArrowUpRight, BarChart3, BriefcaseBusiness, CalendarDays, CircleDollarSign, Compass, Crown,
  FileText, FlaskConical, Handshake, Headphones, Lightbulb, ListChecks, MapPin, Megaphone,
  Monitor, PenTool, ShieldCheck, Tags, Users, ZoomIn, ZoomOut,
} from 'lucide-react';
import { ATLAS_IDENTITY } from '@/lib/atlas-identity';
import { officeDepartments, type OfficeDepartment, type OfficeDepartmentId } from './catalog';
import { MapActivityLog, MapAgentLayer, useMapActivity } from './OfficeMapAgents';
import { stationName, type OfficeMapHandoff } from './office-map-activity';
import type { OfficeTask } from './model';
import styles from './OfficeMap.module.css';

const icons = {
  comercial: BriefcaseBusiness, 'captacion-reservas': CalendarDays, marketing: Megaphone,
  'creacion-contenido': PenTool, finanzas: CircleDollarSign, 'servicios-seguimiento': ListChecks,
  operaciones: Compass, inteligencia: BarChart3, clientes: Headphones, 'producto-id': FlaskConical,
  talento: Users, 'legal-documentacion': FileText, 'compras-alianzas': Handshake, estrategia: Lightbulb,
  'seguridad-accesos': ShieldCheck,
};

type OfficeMapProps = {
  view: 'map' | 'org';
  selectedId: string | null;
  onSelect: (id: OfficeDepartmentId) => void;
  onOpenOrg?: () => void;
  handoffs?: readonly OfficeMapHandoff[];
  loadingActivity?: boolean;
  activityError?: string | null;
  onOpenTask?: (id: string) => void;
  tasks?: readonly OfficeTask[];
};
const noHandoffs: readonly OfficeMapHandoff[] = [];

// Coordinates belong to the fixed architectural illustration, in percentages of its native size.
type Room = { x: number; y: number; width: number; height: number };

const roomPositions: Record<OfficeDepartmentId, Room> = {
  inteligencia: { x: 35.8, y: 14.9, width: 18, height: 17.8 },
  'legal-documentacion': { x: 64.6, y: 14.9, width: 18, height: 17.8 },
  'creacion-contenido': { x: 84.4, y: 14.9, width: 17.9, height: 17.8 },
  'compras-alianzas': { x: 14.9, y: 33.8, width: 18.4, height: 17.4 },
  'producto-id': { x: 35.2, y: 33.8, width: 18.3, height: 17.4 },
  marketing: { x: 65, y: 33.8, width: 18.1, height: 17.4 },
  'servicios-seguimiento': { x: 85.4, y: 33.8, width: 18.1, height: 17.4 },
  operaciones: { x: 14.1, y: 52.2, width: 19.1, height: 17 },
  finanzas: { x: 34.8, y: 52.2, width: 18.7, height: 17 },
  comercial: { x: 65.4, y: 52.2, width: 18.6, height: 17 },
  'seguridad-accesos': { x: 86, y: 52.2, width: 18.9, height: 17 },
  talento: { x: 13.3, y: 71.7, width: 19.6, height: 18.6 },
  estrategia: { x: 34.4, y: 71.7, width: 19.4, height: 18.6 },
  clientes: { x: 65.6, y: 71.7, width: 19.2, height: 18.6 },
  'captacion-reservas': { x: 86.5, y: 71.7, width: 19.5, height: 18.6 },
};

function accent(department: OfficeDepartment): CSSProperties {
  return { '--room-color': department.color } as CSSProperties;
}

function DepartmentButton({ department, selected, onSelect }: {
  department: OfficeDepartment; selected: boolean; onSelect: OfficeMapProps['onSelect'];
}) {
  const Icon = icons[department.id];
  return (
    <button type="button" className={styles.department} style={accent(department)} aria-pressed={selected} onClick={() => onSelect(department.id)}>
      <span className={styles.departmentIcon}><Icon size={18} strokeWidth={1.6} aria-hidden="true" /></span>
      <strong>{department.name}</strong><ArrowUpRight className={styles.openIcon} size={14} aria-hidden="true" />
    </button>
  );
}

export function OfficeMap({ view, selectedId, onSelect, onOpenOrg, handoffs = noHandoffs, loadingActivity, activityError, onOpenTask, tasks }: OfficeMapProps) {
  const [labels, setLabels] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [station, setStation] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const selected = officeDepartments.find(department => department.id === selectedId);
  const activity = useMapActivity(handoffs, view === 'map', loadingActivity);
  const moving = activity.playback?.event;
  const assigned = tasks?.filter(task => task.department_id === selectedId && task.status !== 'cancelado' && task.status !== 'completado');

  function selectRoom(id: OfficeDepartmentId) {
    setStation(null);
    onSelect(id);
  }

  function changeZoom(direction: number) {
    const next = Math.min(2, Math.max(1, zoom + direction * 0.25));
    const element = viewport.current;
    if (element) {
      const fractionX = (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth;
      const fractionY = (element.scrollTop + element.clientHeight / 2) / element.scrollHeight;
      requestAnimationFrame(() => element.scrollTo({
        left: fractionX * element.scrollWidth - element.clientWidth / 2,
        top: fractionY * element.scrollHeight - element.clientHeight / 2,
      }));
    }
    setZoom(next);
  }

  if (view === 'org') return (
    <section className={`${styles.root} ${styles.organisation}`} aria-label="Organigrama de Oficina Celestial">
      <div className={styles.executive}>
        <div className={styles.person}><span className={styles.alex}><Crown aria-hidden="true" size={20} /></span><span><strong>Álex</strong><small>Propietario</small></span></div>
        <span className={styles.line} aria-hidden="true" />
        <div className={styles.person}><span className={styles.atlas}><img src={ATLAS_IDENTITY.image} width={45} height={45} alt="" /></span><span><strong>Atlas</strong><small>Director operativo de IA</small></span></div>
      </div>
      <span className={styles.trunk} aria-hidden="true" />
      <div className={styles.branches} role="group" aria-label="Departamentos dirigidos por Atlas">
        {officeDepartments.map(dept => <DepartmentButton key={dept.id} department={dept} selected={selectedId === dept.id} onSelect={selectRoom} />)}
      </div>
    </section>
  );

  return (
    <section className={styles.root} aria-label="Plano interactivo de Oficina Celestial">
      <div className={styles.canvas}>
        <div className={styles.viewport} ref={viewport} aria-label="Salas y puestos del plano">
          <div className={styles.scene} style={{ width: `${zoom * 100}%` }} data-labels={labels}>
            <img className={styles.building} src="/office/plano-celestial.webp" width={1536} height={1024} alt="Maqueta isométrica de la Oficina Celestial, con dos alas de despachos a ambos lados del pasillo central." draggable={false} />
            {onOpenOrg ? <button type="button" className={styles.director} title="Ver el organigrama" onClick={onOpenOrg}><Crown size={12} aria-hidden="true" /><span>Dirección · Atlas</span></button> : <span className={styles.director}><Crown size={12} aria-hidden="true" />Dirección · Atlas</span>}
            {officeDepartments.map(dept => {
              const room = roomPositions[dept.id];
              const active = selectedId === dept.id;
              const position = { ...accent(dept), left: `${room.x}%`, top: `${room.y}%`, width: `${room.width}%`, height: `${room.height}%` };
              return (
                <div key={dept.id} className={styles.room} style={position} data-selected={active || undefined}>
                  <button type="button" className={styles.hotspot} aria-label={`Sala de ${dept.name}`} aria-pressed={active} title={dept.name} onClick={() => selectRoom(dept.id)}>
                    <span className={styles.roomTag}><span className={styles.pinDot} /><span className={styles.roomName}>{dept.shortName}</span></span>
                  </button>
                  {active && <button type="button" className={styles.seat} style={{ right: '4%', top: '19%' }} aria-label={`Seleccionar puesto de ${dept.name}`} title={`Puesto de ${dept.name}`} aria-pressed={station === dept.id} onClick={() => { setStation(dept.id); onSelect(dept.id); }}><Monitor size={12} aria-hidden="true" /></button>}
                </div>
              );
            })}
            <MapAgentLayer event={activity.selected} playback={activity.playback} finish={activity.finish}/>
          </div>
        </div>
        <div className={styles.tools}>
          <button type="button" aria-label="Mostrar nombres de salas" aria-pressed={labels} title="Mostrar nombres de salas" onClick={() => setLabels(!labels)}><Tags size={15} aria-hidden="true" /></button>
          <span className={styles.divider} />
          <button type="button" aria-label="Reducir plano" title="Reducir plano" disabled={zoom === 1} onClick={() => changeZoom(-1)}><ZoomOut size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Ampliar plano" title="Ampliar plano" disabled={zoom === 2} onClick={() => changeZoom(1)}><ZoomIn size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <div className={styles.mapFooter}>
        <span aria-live="polite"><MapPin size={14} aria-hidden="true" />{station === selectedId && selected ? `Puesto de ${selected.name}` : selected ? `Sala de ${selected.name}` : 'Selecciona una sala'}</span>
        <span aria-label={`Ampliación del plano, ${Math.round(zoom * 100)} por ciento`}>{Math.round(zoom * 100)} %</span>
      </div>
      {selected && assigned && <div className={styles.deskStatus}>
        <strong>Puesto de {selected.name}</strong>
        {moving?.from === selected.id ? <span>Recorrido registrado hacia {stationName(moving.to)}</span> : assigned.length > 0 ? <span>{assigned.length === 1 ? "Encargo abierto" : `${assigned.length} encargos abiertos`} · {onOpenTask ?
          <button type="button" onClick={() => onOpenTask(assigned[0].id)}>{assigned[0].objective}</button> : assigned[0].objective}</span> :
          <span>En espera · sin encargos abiertos</span>}
      </div>}
      <MapActivityLog activity={activity} loading={loadingActivity} error={activityError} open={onOpenTask}/>
      <div className={styles.mobileRooms} aria-label="Departamentos del plano">
        {officeDepartments.map(dept => <DepartmentButton key={dept.id} department={dept} selected={selectedId === dept.id} onSelect={selectRoom} />)}
      </div>
    </section>
  );
}

export default OfficeMap;
