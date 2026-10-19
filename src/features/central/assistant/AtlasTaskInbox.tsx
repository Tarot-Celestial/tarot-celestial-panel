'use client';
import { useRef, useState, type FormEvent } from 'react';
import { RefreshCw, ChevronRight, ListTodo } from 'lucide-react';
import { ATLAS_JOB_STATUSES, ATLAS_OUTCOMES, type AtlasJob, type AtlasOutcome } from '@/lib/central-atlas';
import styles from './CentralCompanion.module.css';

type Update = (body: unknown) => Promise<boolean>;
function Job({ job, saving, update, onNavigate }: { job: AtlasJob; saving: boolean; update: Update; onNavigate: (tab: string, id?: string) => void }) {
  const [result, setResult] = useState(''), [status, setStatus] = useState<'completed' | 'blocked' | null>(null);
  const [showOutcome, setShowOutcome] = useState(false), [client, setClient] = useState(job.client_ids[0] || '');
  const [channel, setChannel] = useState('whatsapp'), [outcome, setOutcome] = useState<AtlasOutcome>('responded');
  const [note, setNote] = useState(''), [next, setNext] = useState(''), [notice, setNotice] = useState('');
  const operation = useRef<{ key: string; id: string } | null>(null);
  const saveOutcome = async (event: FormEvent) => {
    event.preventDefault(); setNotice('');
    const body = { action: 'record_outcome', job_id: job.id, client_id: client, channel, outcome, note,
      next_contact_at: outcome === 'followup' && next ? new Date(next).toISOString() : null };
    const key = JSON.stringify(body);
    if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
    if (await update({ ...body, request_id: operation.current.id })) {
      operation.current = null; setNote(''); setNext(''); setShowOutcome(false); setNotice('Resultado registrado para Atlas.');
    }
  };
  return <article className={styles.card} data-priority={job.status === 'blocked' ? 'attention' : 'info'}>
    <div className={styles.cardHeading}><ListTodo size={15}/><strong>{job.title}</strong></div>
    <small>{ATLAS_JOB_STATUSES[job.status]}{job.due_at ? ` · ${new Date(job.due_at).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' })} Ecuador` : ''}</small>
    <p>{job.description}</p>
    {job.result && <p>Último resultado: {job.result}</p>}
    {!!job.clients?.length && <details><summary>{job.clients.length} contactos del encargo</summary><div className={styles.atlasClients}>{job.clients.map(item => <button key={item.id} onClick={() => onNavigate('mis-clientas', item.id)}>{item.name}<ChevronRight size={12}/></button>)}</div></details>}
    {!!job.lead_ids?.length && <small>{job.lead_ids.length} contactos asignados en Captación.</small>}
    <div className={styles.cardActions}>
      {job.kind !== 'task' && <button onClick={() => onNavigate(job.kind === 'recovery' ? 'recuperar-clientes' : 'captacion')}>Abrir {job.kind === 'recovery' ? 'Recuperación' : 'Captación'} <ChevronRight size={13}/></button>}
      {job.status !== 'in_progress' && <button disabled={saving} onClick={() => void update({ action: 'update_job', job_id: job.id, status: 'in_progress' })}>Empezar</button>}
      {!!job.client_ids.length && <button disabled={saving} onClick={() => { setShowOutcome(value => !value); setStatus(null); }}>Registrar resultado</button>}
      <button disabled={saving} onClick={() => { setStatus('completed'); setShowOutcome(false); }}>Completar</button>
      <button disabled={saving} onClick={() => { setStatus('blocked'); setShowOutcome(false); }}>Necesito ayuda</button>
    </div>
    {status && <form className={styles.form} onSubmit={event => { event.preventDefault(); void update({ action: 'update_job', job_id: job.id, status, result }).then(ok => { if (ok) { setStatus(null); setResult(''); setNotice('Atlas ya tiene tu actualización.'); } }); }}>
      <label>{status === 'completed' ? 'Qué has realizado' : 'Qué te impide continuar'}<textarea required maxLength={2000} value={result} onChange={event => setResult(event.target.value)}/></label>
      <button className={styles.primary} disabled={saving || !result.trim()}>Guardar {status === 'completed' ? 'resultado' : 'petición de ayuda'}</button>
      <button type="button" onClick={() => setStatus(null)}>Volver</button>
    </form>}
    {showOutcome && <form className={styles.form} onSubmit={saveOutcome}>
      <label>Contacto<select required value={client} onChange={event => setClient(event.target.value)}>{job.clients?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className={styles.formRow}><label>Canal<select value={channel} onChange={event => setChannel(event.target.value)}><option value="whatsapp">WhatsApp</option><option value="phone">Teléfono</option><option value="email">Correo</option><option value="other">Otro</option></select></label>
        <label>Resultado<select value={outcome} onChange={event => setOutcome(event.target.value as AtlasOutcome)}>{Object.entries(ATLAS_OUTCOMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {outcome === 'followup' && <label>Próximo contacto · hora de tu dispositivo<input type="datetime-local" required value={next} onChange={event => setNext(event.target.value)}/></label>}
      <label>Nota<textarea maxLength={2000} value={note} onChange={event => setNote(event.target.value)}/></label>
      <small>Este resultado deja constancia de lo que registras. Las compras se comprueban con el pago; las gestiones /30 se marcan en Recuperar clientes.</small>
      <button className={styles.primary} disabled={saving || !client}>Guardar resultado</button>
    </form>}
    {notice && <p role="status">{notice}</p>}
  </article>;
}
export default function AtlasTaskInbox({ jobs, loading, saving, error, truncated, refresh, update, onNavigate }: {
  jobs: AtlasJob[]; loading: boolean; saving: boolean; error: string; truncated: boolean; refresh: () => void; update: Update; onNavigate: (tab: string, id?: string) => void;
}) {
  return <section className={styles.atlasInbox} aria-label="Encargos de Atlas">
    <div className={styles.sectionTitle}><div><h3>Encargos de Atlas</h3><p>Tu trabajo compartido con administración</p></div><button aria-label="Actualizar encargos de Atlas" disabled={loading || saving} onClick={refresh}><RefreshCw size={15}/></button></div>
    {error ? <p className={styles.notice} role="alert">{error}</p> : loading ? <p>Consultando encargos…</p> : !jobs.length ? <p className={styles.notice}>No tienes encargos pendientes de Atlas.</p> : null}
    <div className={styles.cards}>{jobs.map(job => <Job key={job.id} job={job} saving={saving} update={update} onNavigate={onNavigate}/>)}</div>
    {truncated && <p className={styles.notice}>Se muestran los primeros 100 encargos pendientes.</p>}
  </section>;
}
