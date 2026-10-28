import type { SupabaseClient } from '@supabase/supabase-js';
import { CENTRAL_METRICS, CENTRAL_TIMEZONE, addDate, centralPeriod, coveredMetric, ecuadorDate, metric, type CentralMetricKey, type CentralStatisticsResponse, type CentralWorkConfig } from '@/lib/central-statistics';
import { configuredXpProgress } from '@/lib/xp-levels';
import { loadXpLevelConfiguration } from '@/lib/server/xp-level-config';
import { centralHours, latestOverrides, type WorkAdjustment, type WorkOverride, type WorkSession, type WorkVersion } from './central-statistics-hours';

async function pages<T>(builder: () => any): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await builder().range(offset, offset + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
}
type RawWorker = { id: string; display_name: string; role: string; is_active: boolean; salary_base: number; xp_total: number } & Record<CentralMetricKey, number>;
type RawReport = { workers: RawWorker[]; totals: CentralStatisticsResponse['totals']; payment_days: Array<{worker_id:string;date:string;payments_count:number;payments_amount:number}>; coverage: Partial<Record<CentralMetricKey,string|null>> };
const SOURCE_LABELS:Partial<Record<CentralMetricKey,string>>={recovery_attempts:'Intentos de recuperación',recovery_counted:'Gestiones de recuperación válidas',capture_actions:'Gestiones de captación',captures_confirmed:'Captaciones confirmadas',xp_earned:'XP aplicado',notes_written:'Notas de seguimiento',unique_clients:'Clientes con gestiones registradas',payments_during_session_count:'Cobros durante la conexión',payments_during_session_amount:'Importe cobrado durante la conexión'};

export async function loadCentralStatistics(db: SupabaseClient, month: string, now = new Date()): Promise<CentralStatisticsResponse> {
  const period = centralPeriod(month, now);
  const previousMonth = period.previous_start.slice(0, 7);
  const nextMonth = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),1)).toISOString().slice(0,10);
  const planningMonth=ecuadorDate(now).slice(0,7);
  const planningEnd=new Date(Date.UTC(Number(planningMonth.slice(0,4)),Number(planningMonth.slice(5))+12,1)).toISOString().slice(0,10);
  const [currentResult, previousResult, sessionRows, versionRows, overrideRows, adjustmentRows, coverageResult, levelConfig] = await Promise.all([
    db.rpc('tc_central_statistics', { p_from: period.current_start, p_to: period.current_end }),
    db.rpc('tc_central_statistics', { p_from: period.previous_start, p_to: period.previous_end }),
    pages<WorkSession>(() => db.from('attendance_panel_sessions').select('id,worker_id,started_at,ended_at,expires_at,close_reason').lt('started_at', period.current_end).gt('expires_at', period.previous_start).order('started_at').order('id')),
    pages<WorkVersion>(() => db.from('central_work_config_versions').select('*').order('effective_from').order('id')),
    pages<WorkOverride>(() => db.from('central_workday_overrides').select('*').gte('work_date', addDate(`${previousMonth}-01`,-7)).lt('work_date', addDate(planningEnd,7)).order('created_at').order('id')),
    pages<WorkAdjustment>(() => db.from('central_time_adjustments').select('*').gte('work_date', `${previousMonth}-01`).lt('work_date', nextMonth).order('created_at').order('id')),
    db.from('central_statistics_activation').select('activated_at').eq('singleton',true).single(),
    loadXpLevelConfiguration(db),
  ]);
  if (currentResult.error) throw currentResult.error;
  if (previousResult.error) throw previousResult.error;
  if (coverageResult.error) throw coverageResult.error;
  const current = currentResult.data as RawReport, previous = previousResult.data as RawReport;
  const coverageStart = coverageResult.data?.activated_at || null;
  current.coverage.payments_during_session_count=current.coverage.payments_during_session_amount=coverageStart;
  previous.coverage.payments_during_session_count=previous.coverage.payments_during_session_amount=coverageStart;
  const previousById = new Map(previous.workers.map(w => [w.id,w]));
  const sourceValue = (report: RawReport, row: RawWorker | undefined, key: CentralMetricKey, from: string, to: string) => {
    // A source introduced later cannot establish a zero for an earlier month.
    const sourceStart = report.coverage[key];
    if (Object.prototype.hasOwnProperty.call(report.coverage,key) && (!sourceStart || Date.parse(sourceStart)>=Date.parse(to))) return null;
    return Number(row?.[key] || 0);
  };
  const workers = current.workers.map(row => {
    const old = previousById.get(row.id);
    const versions = versionRows.filter(v => v.worker_id===row.id);
    const v = versions[versions.length-1];
    const config: CentralWorkConfig = {
      version_id:v?.id||null,effective_from:v?.effective_from||null,timezone:CENTRAL_TIMEZONE,
      monthly_salary_eur:Number(v?.monthly_salary_eur??row.salary_base??0),overtime_hourly_rate_eur:v?.overtime_hourly_rate_eur==null?null:Number(v.overtime_hourly_rate_eur),
      weekday_start:v?.weekday_start?.slice(0,5)||null,weekday_end:v?.weekday_end?.slice(0,5)||null,weekend_start:v?.weekend_start?.slice(0,5)||'09:00',weekend_end:v?.weekend_end?.slice(0,5)||'15:00',
    };
    const hourInputs = {workerId:row.id,coverageStart,now:now.getTime(),sessions:sessionRows,versions:versionRows,overrides:overrideRows,adjustments:adjustmentRows};
    const hours=centralHours({...hourInputs,from:period.current_start,to:period.current_end,payments:current.payment_days});
    const previousHours=centralHours({...hourInputs,from:period.previous_start,to:period.previous_end});
    const coverage:string[]=[];
    if (!coverageStart || Date.parse(coverageStart)>Date.parse(period.current_start)) coverage.push(coverageStart?`Horas registradas desde ${coverageStart}; el tramo anterior del mes no está medido por este sistema.`:'Todavía no hay sesiones registradas por el nuevo control de conexión.');
    if (!v) coverage.push('Horario sin configurar: el tiempo conectado se muestra sin clasificar.');
    if (hours.pending_weekend_days.length) coverage.push('Hay fines de semana pendientes de asignar; esas horas no se clasifican como extras.');
    if (adjustmentRows.some(a=>a.worker_id===row.id&&a.work_date.startsWith(month))) coverage.push('Incluye correcciones administrativas auditadas, separadas de las sesiones originales.');
    const metrics=Object.fromEntries(CENTRAL_METRICS.map(key=>{
      // These are current queue sizes, not reconstructable historical snapshots.
      if(key==='leads_assigned'||key==='pending_followups') return [key,metric(month===ecuadorDate(now).slice(0,7)?Number(row[key]||0):null,null)];
      let complete=true;
      for (const [report,from,to,label] of [[current,period.current_start,period.current_end,'actual'],[previous,period.previous_start,period.previous_end,'anterior']] as const) {
        const start=report.coverage[key];
        if(Object.prototype.hasOwnProperty.call(report.coverage,key)&&(!start||Date.parse(start)>Date.parse(from))) complete=false;
        if(start&&Date.parse(start)>Date.parse(from)&&Date.parse(start)<Date.parse(to)) coverage.push(`${SOURCE_LABELS[key]||'Actividad registrada'}: registro parcial del periodo ${label}, desde ${new Intl.DateTimeFormat('es',{timeZone:CENTRAL_TIMEZONE,dateStyle:'short'}).format(new Date(start))}; comparación no disponible.`);
      }
      return [key,coveredMetric(sourceValue(current,row,key,period.current_start,period.current_end),sourceValue(previous,old,key,period.previous_start,period.previous_end),complete)];
    })) as CentralStatisticsResponse['workers'][number]['metrics'];
    const level=configuredXpProgress(Number(row.xp_total||0),levelConfig.levels,levelConfig.tiers);
    return {
      id:row.id,display_name:row.display_name||'Sin nombre',role:row.role,is_active:row.is_active!==false,metrics,
      hours:{worked_minutes:hours.worked_minutes,ordinary_minutes:hours.ordinary_minutes,outside_schedule_minutes:hours.outside_schedule_minutes,break_minutes:null,previous_worked_minutes:previousHours.worked_minutes,coverage_start:coverageStart,unclassified_minutes:hours.unclassified_minutes,pending_weekend_days:hours.pending_weekend_days,extra_amount:hours.extra_amount,adjustment_minutes:hours.adjustment_minutes,estimate_only:true as const},
      xp:{total:Number(row.xp_total||0),level:level.level,progress_percent:level.maxed?100:Math.min(100,Math.round(level.current/Math.max(1,level.span)*100)),next_level_xp:level.next},
      config,weekend_days:[...latestOverrides(overrideRows.filter(o=>o.worker_id===row.id)).values()].filter(o=>o.is_working).map(o=>o.work_date),coverage:[...new Set(coverage)],day_breakdown:hours.days,
      adjustments:adjustmentRows.filter(a=>a.worker_id===row.id&&a.work_date.startsWith(month)).map(a=>({id:a.id,date:a.work_date,minutes:a.minutes,category:a.category,reason:a.reason,created_at:a.created_at,created_by:a.created_by})),
    };
  });
  return {ok:true,month,timezone:CENTRAL_TIMEZONE,period,workers,totals:current.totals,
    coverage:[
      'Incluye la actividad de todas las marcas y cobros completados en euros. Las notas de seguimiento excluyen eventos automáticos identificados y pueden incluir notas generadas al registrar una gestión.',
      'Las horas fuera del horario previsto son una medida operativa. Su calificación legal, recargos y pago requieren revisión; cualquier importe mostrado es una estimación.',
      'Las captaciones se atribuyen a la primera gestión válida y se cuentan por fecha de confirmación. El XP usa solo el registro aplicado.',
      'Cartera asignada y seguimientos pendientes muestran el estado actual únicamente en el mes en curso; no hay registros históricos comparables.',
      'Cobros en sesión: cobros atribuidos a la central que además ocurrieron durante su conexión. Los pagos web automáticos se presentan separados.',
      'Los intentos de recuperación anteriores al 19/10/2026 no tienen el mismo registro detallado. Las notas y mensajes no se usan para inferir horas de trabajo.',
    ],templates:{morning:{start:'07:00',end:'15:00',timezone:CENTRAL_TIMEZONE,assigned:false}}};
}
