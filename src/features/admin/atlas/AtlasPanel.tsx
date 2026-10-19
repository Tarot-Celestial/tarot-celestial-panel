'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronRight, CircleHelp, Clock3, Eye, ListChecks, LockKeyhole, MessageCircle, RefreshCw, Send, Sparkles, Target, Trash2 } from 'lucide-react';
import { parseRecoveryMission, recoveryMissionPhase, recoveryMissionTime } from '@/lib/recovery-mission';
import { AtlasCharacter } from './AtlasCharacter';
import { useAtlas } from './useAtlas';
import { AtlasWatchPanel } from './AtlasWatchPanel';
import { atlasUnreadWatches, atlasWatchMinutes, type AtlasWatchesController } from './atlas-watch-types';
import { atlasInternalHref, atlasNumber, atlasProgress, atlasStamp, type AtlasAnomaly, type AtlasCard, type AtlasJob, type AtlasMission, type AtlasOverview, type AtlasProposal, type AtlasSignal } from './atlas-types';
import styles from './Atlas.module.css';

const suggestions = [
  { label: 'Cómo vamos hoy', text: 'Atlas, ¿cómo vamos hoy y qué necesita mi atención?', icon: Eye },
  { label: 'Activar una promo', text: 'Atlas, ayúdame a activar una promoción. Muéstrame las disponibles.', icon: Sparkles },
  { label: 'Preparar 10 contactos', text: 'Atlas, prepara 10 contactos para recuperar y repartir a las centrales. Explícame la prioridad.', icon: ListChecks },
  { label: 'Entender la producción', text: 'Atlas, ¿qué patrones ves en la producción y qué podemos mejorar para superar los 300 € diarios?', icon: Target },
];
const money = (value: number | null) => value === null ? '—' : value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const jobStates: Record<string, string> = { pending: 'Pendiente', in_progress: 'En marcha', completed: 'Completado', blocked: 'Bloqueado', cancelled: 'Cancelado' };
const proposalStates: Record<string, string> = { executed: 'Acción confirmada', completed: 'Acción confirmada', cancelled: 'Propuesta cancelada', expired: 'Propuesta caducada', executing: 'Comprobando ejecución', failed: 'No completada' };

function Metric({ eyebrow, value, caption, progress, met = false, source }: { eyebrow: string; value: string; caption: string; progress?: number; met?: boolean; source?: string }) {
  return <div className={styles.metric} data-met={met}>
    <span className={styles.eyebrow}>{eyebrow}</span><strong>{value}{met ? <Check size={20} aria-label="Meta alcanzada" /> : null}</strong>
    {progress !== undefined ? <div className={styles.progress} aria-hidden="true"><span style={{ width: `${progress}%` }} /></div> : null}
    <small>{caption}</small>
    {source ? <details className={styles.evidence}><summary>Qué se contabiliza</summary><p>{source}</p></details> : null}
  </div>;
}

function Anomaly({ anomaly }: { anomaly: AtlasAnomaly }) {
  const labels: Record<string, string> = { id: 'Registro', client_id: 'Clienta', contacted_at: 'Contacto', captured_at: 'Captación', worker_id: 'Central' };
  return <article className={styles.signal} data-severity="attention"><span className={styles.signalMark} aria-hidden="true">✦</span><div><h3>{anomaly.title}</h3><p>{anomaly.description}</p><details className={styles.evidence}><summary>Revisar registros relacionados</summary><div className={styles.anomalyRecords}>{(anomaly.evidence || []).slice(0, 20).map((row, index) => <dl key={String(row.id || row.client_id || index)}>{Object.entries(row).map(([key, value]) => <div key={key}><dt>{labels[key] || key}</dt><dd>{key.endsWith('_at') && typeof value === 'string' ? `${atlasStamp(value)} · Ecuador` : typeof value === 'string' || typeof value === 'number' ? value : JSON.stringify(value)}</dd></div>)}</dl>)}</div></details></div></article>;
}

function MissionCard({ mission, overview }: { mission: AtlasMission; overview: AtlasOverview }) {
  let valid: ReturnType<typeof parseRecoveryMission> | null = null;
  try { valid = parseRecoveryMission(mission); } catch { /* An incomplete source is not a zero count. */ }
  const name = mission.worker_name || overview.workers?.find(worker => worker.id === mission.worker_id)?.display_name || 'Central';
  const phase = recoveryMissionPhase(valid);
  const labels: Record<string, string> = { unavailable: 'Sin datos verificados', disabled: 'Sin misión asignada', rest: 'Descanso de misión', before_shift: 'Antes del turno', before_notice: 'Turno iniciado', active: 'Misión en curso', behind: 'Revisar el ritmo', complete: '30 gestiones completadas', ended: 'Turno terminado' };
  return <article className={styles.mission} data-attention={phase === 'behind'}>
    <div className={styles.missionTitle}><span className={styles.initial}>{name.slice(0, 1)}</span><div><h3>{name}</h3><span>{labels[phase]}</span></div><span className={styles.statusDot} /></div>
    {valid?.enabled ? <>
      <p className={styles.shift}>{recoveryMissionTime(valid.starts_at)}–{recoveryMissionTime(valid.ends_at)} · Ecuador</p>
      <div className={styles.missionNumbers}><div><strong>{valid.managed}<small>/{valid.target}</small></strong><span>gestiones</span></div><div><strong>{valid.recovered}<small>/{valid.recovery_target}</small></strong><span>recuperaciones</span></div><div><strong>{valid.awarded_xp}</strong><span>XP acreditados</span></div></div>
      <div className={styles.progress} aria-hidden="true"><span style={{ width: `${atlasProgress(valid.managed, valid.target)}%` }} /></div>
      <p className={styles.missionHint}>{phase === 'rest' ? 'Sin cuota ni avisos durante el fin de semana.' : phase === 'behind' ? `Referencia a esta hora: ${valid.expected_managed} gestiones. Revisa el contexto con la central.` : 'Gestiones y compras confirmadas se contabilizan por separado.'}</p>
    </> : <p className={styles.missionHint}>{valid ? 'Esta central no tiene una misión activa configurada.' : 'Actualiza para consultar el progreso real de esta central.'}</p>}
  </article>;
}

function Signal({ signal, onPrompt }: { signal: AtlasSignal; onPrompt: (text: string) => void }) {
  const href = atlasInternalHref(signal.href);
  return <article className={styles.signal} data-severity={signal.severity || 'info'}><span className={styles.signalMark} aria-hidden="true">✦</span><div><h3>{signal.title}</h3><p>{signal.description}</p>
    {signal.evidence?.length ? <details className={styles.evidence}><summary>Ver evidencia</summary><ul>{signal.evidence.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></details> : null}
    {signal.prompt ? <button type="button" className={styles.textButton} onClick={() => onPrompt(signal.prompt!)}>Revisar con Atlas <ChevronRight size={14} /></button> : href ? <a className={styles.textButton} href={href}>Ver registros <ChevronRight size={14} /></a> : null}
  </div></article>;
}

function ActionCard({ card, disabled, onPrompt }: { card: AtlasCard; disabled: boolean; onPrompt: (text: string) => void }) {
  const href = atlasInternalHref(card.href);
  const content = <><span><strong>{card.title}</strong>{card.description ? <small>{card.description}</small> : null}</span><ArrowRight size={17} /></>;
  if (card.prompt) return <button type="button" className={styles.actionCard} disabled={disabled} onClick={() => onPrompt(card.prompt!)}>{content}</button>;
  if (href) return <a className={styles.actionCard} href={href}>{content}</a>;
  return <div className={styles.actionCard}>{content}</div>;
}

function Proposal({ proposal, busy, onAction }: { proposal: AtlasProposal; busy: string; onAction: (action: 'execute' | 'cancel_proposal', id: string, password?: string) => Promise<boolean> }) {
  const [password, setPassword] = useState('');
  const pending = proposal.status === 'pending';
  const execute = async () => { const input = password; setPassword(''); await onAction('execute', proposal.id, input || undefined); };
  return <section className={styles.proposal} aria-label={`Propuesta: ${proposal.title}`}>
    <span className={styles.eyebrow}>{pending ? 'Acción preparada' : 'Registro de acción'}</span><h3>{proposal.title}</h3>
    {proposal.description ? <p>{proposal.description}</p> : null}
    <dl>{(proposal.details || []).map((detail, index) => <div key={`${index}:${detail.label}`}><dt>{detail.label}</dt><dd>{String(detail.value)}</dd></div>)}</dl>
    {pending ? <>
      {proposal.requiresPassword ? <label className={styles.password}><span><LockKeyhole size={14} /> Nueva contraseña</span><input type="password" value={password} minLength={8} maxLength={128} autoComplete="new-password" onChange={event => setPassword(event.target.value)} placeholder="Mínimo 8 caracteres" disabled={!!busy} /><small>Solo se envía al ejecutar. No se guarda en la conversación.</small></label> : null}
      <div className={styles.proposalActions}><button type="button" className={styles.primaryButton} onClick={() => void execute()} disabled={!!busy || !!proposal.requiresPassword && password.length < 8}>{busy === proposal.id ? 'Comprobando…' : 'Ejecutar esta acción'}<ArrowRight size={15} /></button><button type="button" className={styles.quietButton} disabled={!!busy} onClick={() => { setPassword(''); void onAction('cancel_proposal', proposal.id); }}>Cancelar</button></div>
    </> : <div className={styles.receipt}>{proposal.status === 'completed' ? <Check size={16} /> : proposal.status === 'executing' ? <Clock3 size={16} /> : <CircleHelp size={16} />}{proposalStates[proposal.status] || proposal.status}</div>}
  </section>;
}

function Jobs({ jobs, overview }: { jobs: AtlasJob[]; overview: AtlasOverview | null }) {
  if (!jobs.length) return <div className={styles.empty}><ListChecks size={24} /><h3>El próximo encargo empieza contigo</h3><p>Pide a Atlas que prepare seguimientos o distribuya contactos. Aquí verás responsable, plazo y resultado.</p></div>;
  return <div className={styles.jobs}>{jobs.map(job => <article className={styles.job} key={job.id}>
    <div className={styles.jobHeading}><span className={styles.jobStatus} data-state={job.status}>{jobStates[job.status] || job.status}</span><small>{job.worker_name || overview?.workers?.find(worker => worker.id === job.worker_id)?.display_name || 'Equipo de centrales'}</small></div>
    <h3>{job.title}</h3>{job.description ? <p>{job.description}</p> : null}{job.result ? <p className={styles.jobResult}><Check size={14} />{job.result}</p> : null}
    <span className={styles.timestamp}><Clock3 size={12} />{job.due_at ? `Plazo: ${atlasStamp(job.due_at)}` : `Creado: ${atlasStamp(job.created_at)}`}</span>
  </article>)}</div>;
}

export default function AtlasPanel({ watches, initialView = 'chat' }: { watches?: AtlasWatchesController; initialView?: 'chat' | 'supervision' } = {}) {
  const atlas = useAtlas();
  const [view, setView] = useState<'chat' | 'supervision' | 'memory'>(initialView);
  const [draft, setDraft] = useState('');
  const [memoryDraft, setMemoryDraft] = useState('');
  const [deletingMemory, setDeletingMemory] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const [followConversation, setFollowConversation] = useState(true);
  const openingPromotions = useRef(false);
  const previousEpoch = useRef(atlas.identityEpoch);
  useEffect(() => {
    if (previousEpoch.current !== atlas.identityEpoch) { setDraft(''); setMemoryDraft(''); setDeletingMemory(''); previousEpoch.current = atlas.identityEpoch; }
  }, [atlas.identityEpoch]);
  useEffect(() => { if (followConversation && conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight; }, [atlas.messages, atlas.busy, followConversation]);
  const preparePrompt = (text: string) => { setView('chat'); setDraft(text); window.setTimeout(() => input.current?.focus(), 0); };
  const submit = async (text = draft) => {
    const sent = text.trim(); if (!sent || atlas.busy) return;
    setFollowConversation(true);
    if (await atlas.chat(sent)) setDraft(current => current.trim() === sent ? '' : current);
  };
  const chooseCard = (text: string) => { setDraft(text); void submit(text); };
  const overview = atlas.overview;
  const revenue = atlasNumber(overview?.revenue?.today);
  const captures = atlasNumber(overview?.acquisition?.count);
  const revenueGoal = atlasNumber(overview?.revenue?.goal) || 300;
  const captureGoal = atlasNumber(overview?.acquisition?.goal) || 10;
  const jobs = atlas.jobs.length ? atlas.jobs : overview?.pendingJobs || [];
  const pendingCount = overview?.pendingJobs ? overview.pendingJobs.length : overview ? jobs.filter(job => ['pending', 'in_progress', 'blocked'].includes(job.status)).length : null;
  // The shared watcher owns these notices, including acknowledgements made after the overview loaded.
  const alerts = (overview?.alerts || []).filter(alert => !watches || !alert.id.startsWith('minutes:'));
  const insights = overview?.insights || [];
  const anomalies = overview?.anomalies || [];
  const missions = overview?.missions || [];
  const watchAlerts = watches ? atlasUnreadWatches(watches.watches) : [];
  const showPromotions = async () => {
    setView('chat');
    if (atlas.busy || openingPromotions.current) return;
    openingPromotions.current = true;
    const identity = atlas.identityEpoch;
    try {
      const previousAssistant = [...atlas.messages].reverse().find(message => message.role === 'assistant');
      const protectedFlow = previousAssistant?.sensitiveFollowup || previousAssistant?.proposal?.kind === 'change_password' && ['pending', 'executing'].includes(previousAssistant.proposal.status);
      // Leave only the protected conversation context; the password proposal remains unchanged.
      if (protectedFlow && !await atlas.chat('otra cosa')) return;
      if (previousEpoch.current !== identity) return;
      const text = 'Atlas, muéstrame las promociones disponibles.';
      setDraft(text);
      await submit(text);
    } finally { openingPromotions.current = false; }
  };

  return <section className={styles.atlas} aria-label="Atlas, asistente de administración">
    <header className={styles.hero}>
      <div className={styles.heroStars} aria-hidden="true">✦<span>✧</span><i>✦</i></div>
      <div className={styles.identity}><AtlasCharacter thinking={!!atlas.busy} /><div><span className={styles.eyebrow}>Tu mano derecha · Tarot Celestial</span><h1>Atlas<span>✦</span></h1><p>Vamos a resolverlo, juntos.</p></div></div>
      <div className={styles.connection}><span className={styles.connectionBadge} data-stale={atlas.stale}><span />{atlas.loading ? 'Consultando el panel' : atlas.stale ? 'Pendiente de actualizar' : overview ? 'Conectado a tu panel' : 'Esperando datos'}</span><small>{overview?.updatedAt ? `${atlasStamp(overview.updatedAt)} · Ecuador` : 'Los datos aparecerán al conectar'}</small><button type="button" className={styles.quietButton} onClick={atlas.refresh} disabled={atlas.loading || !!atlas.busy}><RefreshCw size={14} className={atlas.loading ? styles.spin : ''} />Actualizar</button></div>
    </header>
    <div className={styles.metrics}>
      <Metric eyebrow="Facturación del equipo · hoy" value={money(revenue)} caption={revenue === null ? 'Aún no hay datos verificados' : `Objetivo conjunto: superar ${money(revenueGoal)}`} progress={atlasProgress(revenue, revenueGoal)} met={revenue !== null && revenue > revenueGoal} source={overview?.revenue?.source} />
      <Metric eyebrow="Captaciones del equipo · mes" value={captures === null ? '—' : `${captures} / ${captureGoal}`} caption={captures === null ? 'Aún no hay datos verificados' : `Objetivo mensual conjunto · ${overview?.acquisition?.month || 'mes en curso'}`} progress={atlasProgress(captures, captureGoal)} met={captures !== null && captures >= captureGoal} source={overview?.acquisition?.source} />
      <Metric eyebrow="Encargos por resolver" value={pendingCount === null ? '—' : String(pendingCount)} caption="Responsable, plazo y resultado en un lugar" />
    </div>
    {atlas.error ? <div className={styles.error} role="alert"><CircleHelp size={18} /><span>{atlas.error}</span><button type="button" onClick={atlas.refresh} disabled={atlas.loading || !!atlas.busy}>Actualizar datos</button></div> : null}
    {overview?.unavailable?.length ? <div className={styles.partial}><CircleHelp size={15} /><span>Hay fuentes pendientes: {overview.unavailable.join(' · ')}. Los datos no disponibles se muestran con —.</span></div> : null}
    <nav className={styles.tabs} aria-label="Secciones de Atlas">
      <button type="button" aria-current={view === 'chat' ? 'page' : undefined} onClick={() => setView('chat')}><MessageCircle size={16} />Conversación</button>
      <button type="button" aria-current={view === 'supervision' ? 'page' : undefined} onClick={() => setView('supervision')}><ListChecks size={16} />Supervisión y encargos{alerts.length + watchAlerts.length ? <span>{alerts.length + watchAlerts.length}</span> : null}</button>
      <button type="button" aria-current={view === 'memory' ? 'page' : undefined} onClick={() => setView('memory')}><Sparkles size={16} />Nuestra memoria</button>
    </nav>
    {watchAlerts.length && view !== 'supervision' ? <div className={styles.watchBanner} role="status"><span><strong>{watchAlerts[0].clientName}: {atlasWatchMinutes(watchAlerts[0])}</strong><small>{watches?.stale ? 'Último saldo pendiente de actualizar.' : 'Atlas ha detectado el límite de minutos que configuraste.'}{watchAlerts.length > 1 ? ` Hay ${watchAlerts.length} avisos pendientes.` : ''}</small></span><button type="button" className={styles.quietButton} onClick={() => setView('supervision')}>Revisar aviso <ArrowRight size={14} /></button></div> : null}

    {view === 'chat' ? <div className={styles.workspace}>
      <section className={styles.chat} aria-label="Conversación con Atlas">
        <div className={styles.chatHeader}><div><span className={styles.tinyStar}>✦</span><strong>Atlas</strong><span className={styles.chatSubtitle}>Contexto, decisiones y acciones</span></div><span className={styles.privateBadge}><LockKeyhole size={12} />Admin</span></div>
        <div className={styles.messages} ref={conversation} role="log" aria-label="Mensajes de Atlas" aria-live="polite" aria-relevant="additions" onScroll={event => { const el = event.currentTarget; setFollowConversation(el.scrollHeight - el.scrollTop - el.clientHeight < 100); }}>
          {!atlas.messages.length ? <div className={styles.welcome}><AtlasCharacter small /><span className={styles.eyebrow}>Un poco más de claridad, juntos</span><h2>¿Qué resolvemos hoy?</h2><p>Puedo ayudarte con las centrales, preparar una promoción, revisar una clienta o convertir un pendiente en un encargo concreto.</p><div className={styles.suggestions}>{suggestions.map(item => <button type="button" key={item.label} onClick={() => preparePrompt(item.text)}><item.icon size={16} /><span>{item.label}</span><ArrowRight size={14} /></button>)}</div></div> : atlas.messages.map(message => <article className={styles.message} data-role={message.role} key={message.id}>
            <span className={styles.messageAuthor}>{message.role === 'assistant' ? '✦ Atlas' : 'Tú'}</span><div className={styles.messageText}>{message.text}</div>
            {message.cards?.length ? <div className={styles.actionCards}>{message.cards.map(card => <ActionCard key={card.id} card={card} disabled={!!atlas.busy} onPrompt={chooseCard} />)}</div> : null}
            {message.proposal ? <Proposal key={`${atlas.identityEpoch}:${message.proposal.id}`} proposal={message.proposal} busy={atlas.busy} onAction={atlas.action} /> : null}
          </article>)}
          {atlas.busy ? <div className={styles.thinking} role="status"><span /><span /><span /><small>Atlas está comprobando los datos…</small></div> : null}
        </div>
        <form className={styles.composer} onSubmit={event => { event.preventDefault(); void submit(); }}>
          <label className={styles.srOnly} htmlFor="atlas-message">Tu mensaje para Atlas</label><textarea ref={input} id="atlas-message" value={draft} maxLength={3000} rows={2} placeholder="Atlas, ayúdame con…" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
          <div className={styles.composerFooter}><span>{atlas.aiConfigured === false ? 'Funciones guiadas disponibles · conversación IA pendiente de configurar' : 'Enter para enviar · Mayús + Enter para una nueva línea'}</span><button type="submit" className={styles.sendButton} disabled={!draft.trim() || !!atlas.busy || atlas.loading} aria-label="Enviar mensaje a Atlas"><Send size={17} /></button></div>
        </form>
      </section>
      <aside className={styles.brief} aria-label="Resumen operativo"><div className={styles.sectionHeading}><span className={styles.eyebrow}>En el radar</span><Eye size={16} /></div><h2>El equipo, de un vistazo</h2><p className={styles.muted}>Progreso registrado. Horarios de Ecuador.</p>
        {missions.length ? missions.map(mission => <MissionCard key={mission.worker_id} mission={mission} overview={overview!} />) : <p className={styles.noData}>{atlas.loading ? 'Consultando las misiones…' : overview?.missions === null ? 'Las misiones no están disponibles en esta consulta.' : 'No hay misiones para mostrar.'}</p>}
        {alerts.slice(0, 3).map(signal => <Signal key={signal.id} signal={signal} onPrompt={preparePrompt} />)}
        <button type="button" className={styles.textButton} onClick={() => setView('supervision')}>Abrir supervisión <ArrowRight size={14} /></button>
      </aside>
    </div> : null}

    {view === 'supervision' ? <div className={styles.supervision}>
      {watches ? <AtlasWatchPanel controller={watches} onPromotions={showPromotions} /> : null}
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Observar · organizar · comprobar</span><h2>Que cada pendiente tenga un siguiente paso</h2></div><button type="button" className={styles.primaryButton} onClick={() => preparePrompt('Atlas, prepara un encargo para mejorar la recuperación de esta semana. Muéstrame el plan y sus responsables.')}><ListChecks size={16} />Preparar un encargo</button></div>
      <div className={styles.missionGrid}>{missions.map(mission => <MissionCard key={mission.worker_id} mission={mission} overview={overview!} />)}</div>
      <div className={styles.analysisGrid}><section className={styles.surface}><h2>Requiere atención <span>{alerts.length}</span></h2>{alerts.length ? alerts.map(signal => <Signal key={signal.id} signal={signal} onPrompt={preparePrompt} />) : <p className={styles.noData}>{overview ? 'No hay alertas en esta consulta.' : 'Conecta los datos para revisar las alertas.'}</p>}</section>
        <section className={styles.surface}><h2>Qué nos dicen los datos</h2>{insights.length ? insights.map(signal => <Signal key={signal.id} signal={signal} onPrompt={preparePrompt} />) : <p className={styles.noData}>Atlas mostrará aquí hallazgos respaldados por los registros disponibles.</p>}<button type="button" className={styles.textButton} onClick={() => preparePrompt(suggestions[3].text)}>Analizar la producción <ArrowRight size={14} /></button></section></div>
      <section className={styles.surface}><div className={styles.sectionHeading}><h2>Encargos a las centrales</h2><span className={styles.muted}>La mascota acompaña; el registro confirma.</span></div><Jobs jobs={jobs} overview={overview} /></section>
      {anomalies.length ? <section className={styles.surface}><div className={styles.sectionHeading}><h2>Registros que conviene revisar</h2><span className={styles.muted}>Señales con evidencia; requieren contexto.</span></div>{anomalies.map(anomaly => <Anomaly key={anomaly.id} anomaly={anomaly} />)}</section> : null}
      {overview?.history?.length ? <section className={styles.surface}><div className={styles.sectionHeading}><h2>Últimos días registrados</h2><span className={styles.muted}>Equipo completo · Ecuador</span></div><div className={styles.tableWrap}><table><caption className={styles.srOnly}>Resultados diarios del equipo</caption><thead><tr><th scope="col">Día</th><th scope="col">Facturación</th><th scope="col">Compras</th><th scope="col">Captaciones</th><th scope="col">Gestiones</th><th scope="col">Recuperaciones</th></tr></thead><tbody>{overview.history.slice(-14).reverse().map(day => <tr key={day.day}><th scope="row">{day.day}</th><td>{money(atlasNumber(day.revenue))}</td><td>{atlasNumber(day.purchases) ?? '—'}</td><td>{atlasNumber(day.captures) ?? '—'}</td><td>{atlasNumber(day.managed) ?? '—'}</td><td>{atlasNumber(day.recovered) ?? '—'}</td></tr>)}</tbody></table></div></section> : null}
    </div> : null}

    {view === 'memory' ? <section className={styles.memorySection}>
      <div className={styles.memoryIntro}><span className={styles.eyebrow}>Continuidad con criterio</span><h2>Lo que quieres que Atlas recuerde</h2><p>Preferencias y decisiones que puedes revisar y retirar. Por ejemplo: «Avísame cuando un problema se repita, salvo que sea urgente».</p>
        <form onSubmit={event => { event.preventDefault(); const text = memoryDraft.trim(); if (text) { preparePrompt(`Atlas, recuerda que ${text}`); setMemoryDraft(''); } }}><label htmlFor="atlas-memory">Añadir una preferencia</label><textarea id="atlas-memory" rows={3} value={memoryDraft} maxLength={1000} onChange={event => setMemoryDraft(event.target.value)} placeholder="Atlas, recuerda que…" /><button type="submit" className={styles.primaryButton} disabled={!memoryDraft.trim()}><Sparkles size={15} />Preparar en la conversación</button></form>
        <div className={styles.memoryRules}><span className={styles.eyebrow}>Objetivos compartidos</span><p>Superar 300 € de facturación diaria entre todas las centrales.</p><p>Al menos 10 captaciones mensuales del equipo.</p><p>30 gestiones y 5 recuperaciones por central en su misión de lunes a viernes.</p></div>
      </div>
      <div className={styles.memoryList}>{atlas.memories.length ? atlas.memories.map(memory => <article className={styles.memory} key={memory.id}><span className={styles.tinyStar}>✦</span><div><p>{memory.content}</p><small>{atlasStamp(memory.updated_at || memory.created_at)} · Ecuador</small>{deletingMemory === memory.id ? <div className={styles.deleteConfirm}><span>¿Retirar esta memoria?</span><button type="button" disabled={!!atlas.busy} onClick={async () => { if (await atlas.action('delete_memory', memory.id)) setDeletingMemory(''); }}>Retirar</button><button type="button" onClick={() => setDeletingMemory('')}>Conservar</button></div> : null}</div><button type="button" className={styles.iconButton} aria-label="Retirar esta memoria" onClick={() => setDeletingMemory(memory.id)} disabled={!!atlas.busy}><Trash2 size={16} /></button></article>) : <div className={styles.empty}><Sparkles size={28} /><h3>Una memoria que construimos contigo</h3><p>Las preferencias guardadas aparecerán aquí. Las cifras del negocio se consultan en sus registros.</p></div>}</div>
    </section> : null}
  </section>;
}
