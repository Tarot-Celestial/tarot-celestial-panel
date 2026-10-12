'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, RefreshCw, Sparkles, Target, ThumbsDown, ThumbsUp, Trophy, X } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { validUuid } from '@/lib/central-assistant';
import type { LearningEpisode, LearningSummary } from '@/lib/companion-learning';
import styles from './CompanionLearning.module.css';

type LearningAction = { action: 'review' } | { action: 'start' | 'dismiss'; episodeId: string } | { action: 'feedback'; episodeId: string; value: 'helpful' | 'not_helpful'; note?: string };
type LearningReply = { ok: boolean; enabled: boolean; summary: LearningSummary | null; message?: string; unavailable?: string[]; error?: string };
type LearningSnapshot = { workerKey: string; enabled: boolean | null; summary: LearningSummary | null; message: string; unavailable: string[]; updatedAt: string | null };
const REVIEW_INTERVAL = 300000;

/** All learning requests are isolated to the current account, including late responses. */
export function useCompanionLearning({ workerId, ready, proactive, paneVisible, focusedEpisode, onObserved }: {
  workerId?: string | null;
  ready: boolean;
  proactive: boolean;
  paneVisible: boolean;
  focusedEpisode?: string | null;
  onObserved: (count: number) => void;
}) {
  const workerKey = workerId || '';
  const [snapshot, setSnapshot] = useState<LearningSnapshot | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const requestRunning = useRef(false);
  const accountId = useRef<string | null>(null);
  const observedBaseline = useRef<number | null>(null);
  const lastReview = useRef(0);
  const onObservedRef = useRef(onObserved);
  const focusedEpisodeRef = useRef(focusedEpisode);
  const requestAgain = useRef<(() => Promise<boolean>) | null>(null);
  onObservedRef.current = onObserved;
  focusedEpisodeRef.current = focusedEpisode;

  const request = useCallback(async (body?: LearningAction) => {
    if (!ready || requestRunning.current) return false;
    requestRunning.current = true;
    const requestedFocus = focusedEpisodeRef.current;
    const requestGeneration = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 45000);
    const current = () => requestGeneration === generation.current && !abort.signal.aborted;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!current()) return false;
      if (!data.session) throw new Error('Inicia sesión para consultar la evolución de tu compañero.');
      if (accountId.current && accountId.current !== data.session.user.id) {
        setSnapshot(null);
        observedBaseline.current = null;
      }
      accountId.current = data.session.user.id;
      if (body?.action === 'review') lastReview.current = Date.now();
      const response = await fetch(`/api/central/assistant/learning${validUuid(requestedFocus) ? `?episodeId=${encodeURIComponent(requestedFocus)}` : ''}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: abort.signal,
      });
      const result: LearningReply = await response.json();
      if (!current()) return false;
      if (!response.ok || !result.ok) {
        if ([401, 403, 404].includes(response.status)) {
          setSnapshot(null);
          observedBaseline.current = null;
        }
        throw new Error(result.error || 'No pude consultar la evolución. Inténtalo de nuevo.');
      }
      if (result.enabled && !result.summary) throw new Error('La evolución no llegó completa. Inténtalo de nuevo.');
      const count = result.summary?.observedCount ?? null;
      if (count !== null && observedBaseline.current !== null && count > observedBaseline.current) {
        onObservedRef.current(count - observedBaseline.current);
      }
      observedBaseline.current = count;
      setSnapshot({ workerKey, enabled: result.enabled, summary: result.summary, message: result.message || '', unavailable: result.unavailable || [], updatedAt: new Date().toISOString() });
      if (body) setNotice(body.action === 'start' ? 'Seguimiento iniciado. Ahora puedes realizar la acción; revisaré los resultados que se registren después.' : body.action === 'dismiss' ? 'Propuesta descartada.' : body.action === 'feedback' ? 'Corrección guardada. La tendré en cuenta en próximas sugerencias.' : 'Resultados revisados. Solo cuentan los cambios que puedo comprobar.');
      return true;
    } catch (cause) {
      if (requestGeneration === generation.current) setError(abort.signal.aborted ? 'La consulta ha tardado demasiado. Puedes reintentar.' : cause instanceof Error ? cause.message : 'No pude actualizar la evolución.');
      return false;
    } finally {
      clearTimeout(timeout);
      if (requestGeneration === generation.current) {
        requestRunning.current = false;
        controller.current = null;
        setPending(false);
        // A card may be opened while another request is in flight. Fetch its
        // episode once after that request, without resetting the XP baseline.
        if (requestedFocus !== focusedEpisodeRef.current) void requestAgain.current?.();
      }
    }
  }, [workerKey, ready]);
  requestAgain.current = request;

  useEffect(() => {
    generation.current++;
    controller.current?.abort();
    requestRunning.current = false;
    observedBaseline.current = null;
    accountId.current = null;
    lastReview.current = Date.now();
    setSnapshot(null);
    setPending(false);
    setError('');
    setNotice('');
    if (ready) void request();
    const auth = supabaseBrowser().auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (accountId.current && session && session.user.id !== accountId.current)) {
        generation.current++;
        controller.current?.abort();
        requestRunning.current = false;
        observedBaseline.current = null;
        accountId.current = null;
        setSnapshot(null);
        setError('');
        setNotice('');
        setPending(false);
      }
    });
    return () => {
      generation.current++;
      controller.current?.abort();
      requestRunning.current = false;
      auth.data.subscription.unsubscribe();
    };
  }, [request, ready]);

  useEffect(() => {
    if (ready && paneVisible) void request();
  }, [paneVisible, ready, request, focusedEpisode]);

  useEffect(() => {
    if (!ready || !proactive) return;
    const review = () => {
      if (!document.hidden && Date.now() - lastReview.current >= REVIEW_INTERVAL) void request({ action: 'review' });
    };
    const timer = setInterval(review, REVIEW_INTERVAL);
    document.addEventListener('visibilitychange', review);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', review); };
  }, [ready, proactive, request]);

  const owned = ready && snapshot?.workerKey === workerKey ? snapshot : null;
  return { summary: owned?.summary || null, enabled: owned?.enabled ?? null, message: owned?.message || '', unavailable: owned?.unavailable || [], updatedAt: owned?.updatedAt || null, error: ready ? error : '', notice: ready ? notice : '', pending, request };
}

type LearningController = ReturnType<typeof useCompanionLearning>;
const STATE_LABELS: Record<LearningEpisode['state'], string> = {
  suggested: 'Por probar', trying: 'En seguimiento', observed: 'Resultado registrado', no_result: 'Sin resultado observado', dismissed: 'Descartada', invalidated: 'Ya no es aplicable',
};
const CONFIDENCE_LABELS = { initial: 'Primeras pistas', emerging: 'Patrón por comprobar', supported: 'Más evidencia' };
function formatDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Date(value).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Episode({ episode, pending, onAction, onOpenClient, focused, nextStep }: {
  episode: LearningEpisode;
  pending: boolean;
  onAction: LearningController['request'];
  onOpenClient: (id: string) => void;
  focused: boolean;
  nextStep?: string;
}) {
  const [note, setNote] = useState(episode.feedback_note || '');
  const article = useRef<HTMLElement>(null);
  useEffect(() => { setNote(episode.feedback_note || ''); }, [episode.feedback_note]);
  useEffect(() => {
    if (focused) article.current?.scrollIntoView({ block: 'nearest' });
  }, [focused]);
  return <article ref={article} className={styles.episode} data-state={episode.state} data-focused={focused}>
    <div className={styles.episodeHeading}><span>{STATE_LABELS[episode.state]}</span><time dateTime={episode.created_at}>{formatDate(episode.created_at)}</time></div>
    <h4>{episode.title}</h4>
    <dl className={styles.reasoning}>
      <div><dt>Por qué lo propongo</dt><dd>{episode.reason}</dd></div>
      <div><dt>Qué espero observar</dt><dd>{episode.expected_outcome}</dd></div>
      {episode.evidence ? <div className={styles.evidence}><dt><Check size={13} /> Qué ocurrió</dt><dd>{episode.evidence.detail}<small>{formatDate(episode.evidence.occurredAt)} · Madrid</small></dd></div> : <div><dt>Qué ocurrió</dt><dd>{episode.state === 'suggested' ? 'Todavía no has iniciado el seguimiento.' : episode.state === 'trying' ? 'Aún espero un cambio comprobable en los datos.' : episode.state === 'no_result' ? 'Terminó el plazo sin un resultado registrado. Puede haber acciones que no consten en el panel.' : episode.state === 'invalidated' ? 'Los datos ya no permiten evaluar esta propuesta.' : 'La propuesta quedó descartada.'}</dd></div>}
      {nextStep && <div><dt>Qué ajustaré</dt><dd>{nextStep}</dd></div>}
    </dl>
    {episode.state === 'trying' && episode.deadline_at && <p className={styles.deadline}>Ventana de observación hasta {formatDate(episode.deadline_at)} · Madrid</p>}
    {episode.state === 'observed' && <p className={styles.caveat}>El cambio ocurrió después de la acción; no demuestra por sí solo que la sugerencia lo causara.</p>}
    <div className={styles.actions}>
      {episode.state === 'suggested' && <button className={styles.primary} disabled={pending} onClick={() => void onAction({ action: 'start', episodeId: episode.id })}><Target size={14} /> Iniciar seguimiento</button>}
      {validUuid(episode.client_id) && <button disabled={pending} onClick={() => onOpenClient(episode.client_id!)}>Abrir ficha <ArrowUpRight size={13} /></button>}
      {(episode.state === 'suggested' || episode.state === 'trying') && <button disabled={pending} onClick={() => void onAction({ action: 'dismiss', episodeId: episode.id })}><X size={13} /> Descartar</button>}
    </div>
    {episode.state !== 'invalidated' && <details className={styles.feedback}>
      <summary><ChevronDown size={14} /> {episode.feedback ? (episode.feedback === 'helpful' ? 'Me sirvió · editar corrección' : 'No me sirvió · editar corrección') : '¿Te ayudó esta sugerencia?'}</summary>
      <label>Qué debería repetir o cambiar <span>(opcional)</span><textarea value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Por ejemplo: la idea era buena, pero ya habíamos hablado hoy." /></label>
      <div className={styles.actions}>
        <button disabled={pending} aria-pressed={episode.feedback === 'helpful'} onClick={() => void onAction({ action: 'feedback', episodeId: episode.id, value: 'helpful', note: note.trim() })}><ThumbsUp size={13} /> Me sirvió</button>
        <button disabled={pending} aria-pressed={episode.feedback === 'not_helpful'} onClick={() => void onAction({ action: 'feedback', episodeId: episode.id, value: 'not_helpful', note: note.trim() })}><ThumbsDown size={13} /> No me sirvió</button>
      </div>
      {episode.feedback_note && <p className={styles.savedNote}>Tu última corrección: {episode.feedback_note}</p>}
    </details>}
  </article>;
}

export default function CompanionLearning({ learning, petName, proactive, focusedEpisode, onOpenClient }: {
  learning: LearningController;
  petName: string;
  proactive: boolean;
  focusedEpisode: string | null;
  onOpenClient: (id: string) => void;
}) {
  const { summary, error, notice, pending, enabled, message, unavailable } = learning;
  return <div className={styles.learning} aria-busy={pending}>
    <div className={styles.heading}><div><h3>La evolución de {petName}</h3><p>Experiencia privada, compartida contigo.</p></div><button disabled={pending} aria-label="Actualizar evolución" onClick={() => void learning.request()}><RefreshCw size={16} /></button></div>
    {error && <div className={styles.error} role="alert">{error} <button disabled={pending} onClick={() => void learning.request()}>Reintentar</button></div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {enabled === null && !error && <p className={styles.muted}>Cargando lo que estoy aprendiendo…</p>}
    {enabled === false && <div className={styles.empty}><Sparkles size={26} /><h4>La evolución está preparada</h4><p>{message || 'Falta activar el registro de aprendizaje. Tu compañero puede seguir ayudándote con sus funciones habituales.'}</p><button disabled={pending} onClick={() => void learning.request()}>Comprobar de nuevo</button></div>}
    {summary && <>
      <section className={styles.level} aria-label={`Nivel ${summary.level}: ${summary.title}`}>
        <div className={styles.levelTop}><span className={styles.levelBadge}><Trophy size={19} /> {summary.level}</span><div><span className={styles.eyebrow}>NIVEL {summary.level}</span><h4>{summary.title}</h4></div><span className={styles.totalXp}>{summary.xp} XP</span></div>
        <progress aria-label="Progreso al siguiente nivel" max={100} value={Math.min(100, Math.max(0, summary.progress))} />
        <div className={styles.progressCaption}><span>{summary.levelXp} / {summary.nextLevelXp} XP</span><span>Próximo nivel: {summary.level + 1}</span></div>
        <div className={styles.stats}><span><b>{summary.observedCount}</b> resultados</span><span><b>{summary.feedbackCount}</b> correcciones</span><span><b>{summary.tryingCount}</b> en seguimiento</span></div>
      </section>
      <p className={styles.intro}>Mejoro mis próximas sugerencias con los resultados registrados y tus correcciones. Inicia el seguimiento <strong>antes de actuar</strong>; abrir una ficha no confirma ningún resultado.</p>
      <details className={styles.rules}><summary>Cómo gano experiencia</summary><p>20 XP por resultado observado y 5 XP por una corrección, una sola vez por caso. Máximo 100 XP al día. Sin rachas, prisas ni premio por repetir acciones. Este XP pertenece al compañero y no es canjeable.</p><p>Tus valoraciones enseñan qué te resulta útil; los resultados se comprueban por separado en los datos.</p></details>
      {unavailable.length > 0 && <p className={styles.warning}>Hay fuentes pendientes: {unavailable.join(', ')}. La revisión puede estar incompleta.</p>}
      <div className={styles.review}><p>{proactive ? 'Reviso los resultados cada 5 minutos mientras el panel está visible.' : 'La revisión automática está pausada en Ajustes. Puedes revisar los resultados cuando quieras.'}</p><button disabled={pending} onClick={() => void learning.request({ action: 'review' })}><RefreshCw size={13} /> Revisar resultados</button></div>
      {summary.lessons.length > 0 && <section className={styles.lessons} aria-label="Lo que estoy aprendiendo"><h4><Sparkles size={15} /> Lo que estoy aprendiendo</h4>{summary.lessons.map(lesson => <article className={styles.lesson} key={lesson.strategy}><div><strong>{lesson.label}</strong><span>{CONFIDENCE_LABELS[lesson.confidence]}</span></div><p>{lesson.explanation}</p><p><b>Próximo ajuste:</b> {lesson.nextStep}</p><small>{lesson.attempts} intentos · {lesson.observed} resultados observados · {lesson.noResult} sin resultado · {lesson.helpful} útiles / {lesson.notHelpful} no útiles</small></article>)}</section>}
      <section className={styles.journal} aria-label="Diario de decisiones"><h4><Target size={15} /> Diario de decisiones</h4>{summary.recent.length ? summary.recent.map(episode => <Episode key={episode.id} episode={episode} pending={pending} onAction={learning.request} onOpenClient={onOpenClient} focused={episode.id === focusedEpisode} nextStep={summary.lessons.find(lesson => lesson.strategy === episode.strategy)?.nextStep} />) : <div className={styles.empty}><Target size={26} /><p>Todavía no hay casos que evaluar. Las próximas oportunidades de tu turno aparecerán aquí con un motivo y un resultado esperado.</p></div>}</section>
      {learning.updatedAt && <small className={styles.updated}>Última consulta: {formatDate(learning.updatedAt)} · Madrid</small>}
    </>}
  </div>;
}
