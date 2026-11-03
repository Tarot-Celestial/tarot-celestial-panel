'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Download, History, MoonStar, Pause, Play, RefreshCw, SendHorizontal, Shuffle, Sparkles, Square, Volume2, X } from 'lucide-react';
import ClienteLayout from '@/components/cliente/ClienteLayout';
import ClientPurchaseAction from '@/components/cliente/ClientPurchaseAction';
import { supabaseClienteBrowser } from '@/lib/supabase-browser';
import { clientLoginHref } from '@/lib/client-entry';
import { ClientPurchaseError, prepareClientPurchase } from '@/lib/client-purchase-checkout';
import { ORACLE_TOPICS, ORACLE_SPREADS, ORACLE_SPREAD_BY_ID, type OracleTopic } from '@/lib/oracle-catalog';
import { useOracleNarration } from './useOracleNarration';
import styles from './Room.module.css';

const sb = supabaseClienteBrowser();
type Card = { position: string; cardId: string; cardName: string; cardImage: string; keyword: string; advice: string; interpretation: string; selectedPosition: number };
type Draw = { id: string; tema: OracleTopic; cardId: string; cardName: string; cardImage: string; keyword: string; advice: string; message: string; isFree: boolean; drawType: string; question: string; cards: Card[]; conclusion: string; revealedAt: string };
type Session = { drawKey: string; drawType: string; shuffleId: string; question: string; context: string; cards: Card[]; requiredCards: number; status: string };
type QuestionState = { includedAvailable: boolean; extra: number; total: number };
type ChatMessage = { id: string; role: string; contenido: string };
type HistoryRow = { id: string; card_name: string; titulo: string; draw_type: string; is_free: boolean; revealed_at: string; created_at: string };
type Snapshot = { ok: boolean; error?: string; message?: string; freeAvailable: boolean; freeState?: { remainingSeconds: number; nextFreeAt: string | null }; credits: number; latestDraw: Draw | null; activeSession: Session | null; questionState: QuestionState; mensajes: ChatMessage[]; history: HistoryRow[] };
const EMPTY_QUESTIONS: QuestionState = { includedAvailable: false, extra: 0, total: 0 };
const dateLabel = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'Lectura guardada';

function TarotCard({ card, selected, onClick }: { card: Card; selected: boolean; onClick: () => void }) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setBroken(false); setLoaded(false); }, [card.cardImage]);
  return <button type="button" className={styles.tarotCard} onClick={onClick} aria-pressed={selected} aria-label={`${card.position}: ${card.cardName}. Leer interpretación`}>
    <span className={styles.cardFace}>{!loaded && <span className={styles.cardFallback}><MoonStar/><b>{card.cardName}</b><small>{card.keyword}</small></span>}{!broken && card.cardImage && <img src={card.cardImage} alt={card.cardName} style={{ opacity: loaded ? 1 : 0 }} onLoad={() => setLoaded(true)} onError={() => { setBroken(true); setLoaded(false); }} referrerPolicy="no-referrer"/>}</span>
    <strong>{card.cardName}</strong><small>{card.position}</small>
  </button>;
}

export default function ClienteOraculoPage() {
  const [topic, setTopic] = useState<OracleTopic>('general');
  const [mode, setMode] = useState('free_daily');
  const [stage, setStage] = useState<'ready' | 'select' | 'result'>('ready');
  const [draw, setDraw] = useState<Draw | null>(null), [session, setSession] = useState<Session | null>(null);
  const [cards, setCards] = useState<Card[]>([]), [selected, setSelected] = useState(0), [shuffleId, setShuffleId] = useState('');
  const [credits, setCredits] = useState(0), [freeAvailable, setFreeAvailable] = useState(false), [nextFree, setNextFree] = useState<string | null>(null), [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [initialQuestion, setInitialQuestion] = useState(''), [question, setQuestion] = useState('');
  const [questionState, setQuestionState] = useState<QuestionState>(EMPTY_QUESTIONS), [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]), [historyOpen, setHistoryOpen] = useState(false), [motion, setMotion] = useState(true);
  const [pendingCheckoutUrl, setPendingCheckoutUrl] = useState<string | null>(null);
  const locked = useRef(false), alive = useRef(true), generation = useRef(0), owner = useRef<string | null>(null), currentDraw = useRef('');
  const spread = ORACLE_SPREAD_BY_ID[mode] || ORACLE_SPREADS[0];
  const activeCard = cards[selected] || cards[0];
  const reading = activeCard?.interpretation || draw?.message || '';
  const voice = useOracleNarration(stage === 'result' ? [activeCard?.position, activeCard?.cardName, reading, activeCard?.advice].filter(Boolean).join('. ') : '');

  async function request(body?: Record<string, unknown>, id = '') {
    const { data } = await sb.auth.getSession();
    if (!data.session) { window.location.href = clientLoginHref('oraculo', window.location.search); throw new Error('Tu sesión ha caducado.'); }
    const epoch = generation.current;
    const response = await fetch('/api/cliente/oraculo' + (id ? `?drawId=${encodeURIComponent(id)}` : ''), { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(25000) });
    const json = await response.json();
    if (!alive.current || epoch !== generation.current) throw new Error('SESSION_CHANGED');
    if (!response.ok || !json.ok) throw new Error(json.message || ({ NO_ORACLE_CREDITS: 'No tienes tiradas compradas disponibles.', DRAW_CHANGED: 'La tirada cambió en otra pestaña. Recupera el estado para continuar.', DRAW_READY_TO_COMPLETE: 'Las cartas ya están elegidas. Pulsa completar lectura.', FREE_DRAW_RECHARGING: 'Tu carta gratuita todavía se está recargando.' } as Record<string, string>)[json.error] || 'No se pudo completar la consulta. Recupera el estado antes de volver a intentarlo.');
    return json;
  }
  function balances(j: Snapshot) { setCredits(Number(j.credits || 0)); setFreeAvailable(Boolean(j.freeAvailable)); setNextFree(j.freeState?.nextFreeAt || null); if(j.questionState) setQuestionState(j.questionState); }
  function showDraw(d: Draw) {
    currentDraw.current = d.id; setDraw(d); setTopic(d.tema || 'general'); setMode(d.isFree ? 'free_daily' : d.drawType); setSession(null); setSelected(0);
    setCards(d.isFree ? [{ position: 'Mensaje del día', cardId: d.cardId, cardName: d.cardName, cardImage: d.cardImage, keyword: d.keyword, advice: d.advice, interpretation: d.message, selectedPosition: 0 }] : d.cards || []);
    setStage('result'); setQuestion('');
  }
  function showSession(s: Session) { setSession(s); setMode(s.drawType); setTopic(ORACLE_SPREAD_BY_ID[s.drawType]?.topic || 'general'); setCards(s.cards || []); setShuffleId(s.shuffleId); setInitialQuestion(s.question); setStage('select'); setSelected(0); }
  async function load(id = '') {
    try { setLoading(true); setError(''); const j = await request(undefined, id) as Snapshot; balances(j); setMessages(j.mensajes || []); setHistory(j.history || []);
      if (id && !j.latestDraw) throw new Error('No se ha encontrado esta lectura.');
      if (j.activeSession && !id) showSession(j.activeSession);
      else if (j.latestDraw) showDraw(j.latestDraw);
      else { currentDraw.current = ''; setDraw(null); setCards([]); setStage('ready'); setMode(j.freeAvailable ? 'free_daily' : 'clarity'); }
    } catch(e) { report(e); } finally { if(alive.current) setLoading(false); }
  }
  function report(e: unknown) { if(alive.current && (e as Error)?.message !== 'SESSION_CHANGED') setError((e as Error)?.name === 'TimeoutError' ? 'La conexión ha tardado demasiado. Recupera el estado: tu lectura puede haberse guardado.' : (e as Error)?.message || 'No se pudo completar la consulta.'); }
  async function run(label: string, action: () => Promise<void>) {
    if(locked.current) return; locked.current = true; setBusy(label); setError('');
    try { await action(); } catch(e) { report(e); } finally { locked.current = false; if(alive.current) setBusy(''); }
  }
  useEffect(() => {
    alive.current = true; void load();
    const { data } = sb.auth.onAuthStateChange((_event, s) => {
      const id = s?.user.id || null;
      if(owner.current !== null && owner.current !== id) { ++generation.current; currentDraw.current = ''; setDraw(null); setCards([]); setMessages([]); setHistory([]); setQuestion(''); setInitialQuestion(''); setPendingCheckoutUrl(null); setCredits(0); setQuestionState(EMPTY_QUESTIONS); window.setTimeout(() => { if(alive.current) void load(); }, 0); }
      owner.current = id;
    });
    const refresh = async () => { if(locked.current || document.hidden) return; try { const j = await request(undefined, currentDraw.current); balances(j); } catch { /* Keep last verified balance; a visible retry remains available. */ } };
    const timer = window.setInterval(refresh, 30000); window.addEventListener('focus', refresh);
    return () => { alive.current = false; ++generation.current; data.subscription.unsubscribe(); window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => { const tick = () => setCountdown(nextFree ? Math.max(0, Math.ceil((Date.parse(nextFree) - Date.now()) / 1000)) : 0); tick(); const t = window.setInterval(tick, 1000); return () => window.clearInterval(t); }, [nextFree]);
  useEffect(() => { const m = window.matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setMotion(!m.matches); update(); m.addEventListener('change', update); return () => m.removeEventListener('change', update); }, []);
  const countdownLabel = `${String(Math.floor(countdown / 3600)).padStart(2, '0')}:${String(Math.floor(countdown / 60) % 60).padStart(2, '0')}:${String(countdown % 60).padStart(2, '0')}`;
  const frozen = loading || !!busy || stage === 'select';
  function chooseTopic(next: OracleTopic) { setTopic(next); if(mode !== 'free_daily') { const preferred: Record<OracleTopic, string> = { general: 'clarity', amor: 'love', dinero: 'work', familia: 'family', energia: 'energy', decisiones: 'decision' }; setMode(preferred[next]); } setStage('ready'); setCards([]); setInitialQuestion(''); voice.stop(); }
  function newReading() { voice.stop(); setStage('ready'); setCards([]); setMode(freeAvailable ? 'free_daily' : 'clarity'); if (!freeAvailable) setTopic('general'); setQuestion(''); setInitialQuestion(''); setError(''); }
  async function start() {
    await run('Barajando las cartas…', async () => {
      voice.stop(); setCards([]); setSelected(0);
      if(mode === 'free_daily') { const j = await request({ action: 'shuffle', tema: topic }); balances(j); if(!j.freeAvailable) throw new Error('Tu carta gratuita todavía se está recargando.'); setShuffleId(j.shuffleId); setSession(null); setStage('select'); }
      else { const j = await request({ action: 'premium_start', drawType: mode, question: initialQuestion.trim() || spread.question, context: '' }); setCredits(j.credits); showSession(j.session); }
    });
  }
  async function pick(position: number) {
    await run('Revelando tu carta…', async () => {
      const j = await request(session ? { action: 'premium_pick', drawKey: session.drawKey, position } : { action: 'reveal', tema: topic, shuffleId, position });
      if(session && !j.completed) { showSession(j.session); setCredits(j.credits); return; }
      showDraw(j.draw); setMessages([]); setCredits(j.credits); setQuestionState(s => ({ ...s, includedAvailable: true, total: s.extra + 1 })); if(!session) setFreeAvailable(false);
      const saved = await request(undefined, j.draw.id); balances(saved); setHistory(saved.history || []);
    });
  }
  async function complete() { if(session) await run('Completando lectura…', async () => { const j = await request({ action: 'premium_retry', drawKey: session.drawKey }); showDraw(j.draw); const saved = await request(undefined, j.draw.id); balances(saved); setMessages(saved.mensajes || []); setHistory(saved.history || []); }); }
  async function ask() { if(!draw || !question.trim()) return; await run('Consultando el Oráculo…', async () => { const j = await request({ action: 'question', drawId: draw.id, pregunta: question.trim() }); setMessages(j.mensajes || []); setQuestionState(j.questionState); setQuestion(''); }); }
  async function buyQuestions() { await run('Preparando pago…', async () => {
    setPendingCheckoutUrl(null); const { data } = await sb.auth.getSession(); if(!data.session) throw new Error('Vuelve a iniciar sesión para comprar.');
    const epoch = generation.current; const isCurrent = () => alive.current && epoch === generation.current;
    try { const url = await prepareClientPurchase({ auth: sb.auth, session: data.session, packId: 'oracle_questions_3', isCurrent }); if(url && isCurrent()) window.location.href = url; }
    catch(e) { if(isCurrent() && e instanceof ClientPurchaseError) setPendingCheckoutUrl(e.pendingUrl || null); throw e; }
  }); }
  function saveCopy() {
    if(!draw) return;
    const text = ['Tarot Celestial · Tu lectura', dateLabel(draw.revealedAt), draw.question, ...cards.map(c => `${c.position} · ${c.cardName}\n${c.interpretation}\n${c.advice}`), draw.conclusion, ...messages.map(m => `${m.role === 'user' ? 'Tu pregunta' : 'Oráculo'}: ${m.contenido}`), 'Interpretación simbólica para la reflexión personal.'].filter(Boolean).join('\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'tarot-celestial-lectura.txt'; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <ClienteLayout title="Tu sala de consulta" immersive>
    <div className={styles.room} data-motion={motion}>
      <header className={styles.header}><div><span className={styles.eyebrow}><MoonStar size={15}/> TAROT CELESTIAL</span><h1>Tu sala de consulta</h1><p>Un momento para escuchar, interpretar y reflexionar.</p></div><div className={styles.headerActions}><span className={styles.creditPill}><Sparkles size={16}/>{credits} {credits === 1 ? 'tirada comprada' : 'tiradas compradas'}</span><button onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen} aria-label="Historial de lecturas"><History size={20}/></button></div></header>
      <nav className={styles.topics} aria-label="Enfoque de la lectura">{ORACLE_TOPICS.map(t => <button key={t.id} onClick={() => chooseTopic(t.id)} aria-pressed={topic === t.id} disabled={frozen}>{t.label}</button>)}</nav>
      <div className={styles.toolbar}><label>Tu tirada<select aria-label="Tipo de tirada" value={mode} disabled={frozen} onChange={e => { setMode(e.target.value); setStage('ready'); setCards([]); setInitialQuestion(''); if(e.target.value !== 'free_daily') setTopic(ORACLE_SPREAD_BY_ID[e.target.value]?.topic || 'general'); }}><option value="free_daily">Carta del día · 1 carta gratis</option>{ORACLE_SPREADS.map(s => <option key={s.id} value={s.id}>{s.label} · {s.positions.length} {s.positions.length === 1 ? 'carta' : 'cartas'}</option>)}</select></label><span className={styles.deckLabel}><BookOpen size={17}/> Tarot clásico · 78 cartas</span><span className={styles.daily}>{freeAvailable ? <><i/> Tu carta diaria está disponible</> : countdown > 0 ? `Próxima carta gratis en ${countdownLabel}` : 'Carta diaria · cada 24 horas'}</span></div>
      {error && <div className={styles.error} role="alert">{error}<button disabled={!!busy} onClick={() => load()}><RefreshCw size={15}/> Recuperar estado</button>{pendingCheckoutUrl && <Link href={pendingCheckoutUrl}>Revisar pago pendiente</Link>}</div>}
      {historyOpen && <section className={styles.history} aria-label="Historial de lecturas"><div><h2>Tus lecturas guardadas</h2><button aria-label="Cerrar historial" onClick={() => setHistoryOpen(false)}><X size={20}/></button></div><p>Se guardan automáticamente. Volver a leerlas no consume tiradas.</p>{history.length ? <div className={styles.historyList}>{history.map(h => <button key={h.id} disabled={!!busy || loading} onClick={() => { setHistoryOpen(false); void load(h.id); }}><span>{h.is_free ? h.card_name : ORACLE_SPREAD_BY_ID[h.draw_type]?.label || h.titulo}</span><small>{dateLabel(h.revealed_at || h.created_at)}</small><ArrowRight size={15}/></button>)}</div> : <p>Todavía no tienes lecturas guardadas.</p>}<small>Se muestran tus 30 lecturas más recientes.</small></section>}
      <div className={styles.consultation}>
        <section className={styles.stage} aria-label="Mesa de tu consulta" data-stage={stage} aria-busy={!!busy || loading}>
          <img className={styles.guide} src="/images/oracle/guide.webp" alt="Guía virtual ilustrada en una mesa de tarot violeta" fetchPriority="high"/>
          <span className={styles.guideBadge}><Sparkles size={14}/> Guía virtual</span>
          <button className={styles.motion} onClick={() => setMotion(!motion)} aria-label={motion ? 'Pausar animaciones' : 'Activar animaciones'} aria-pressed={motion}>{motion ? <Pause size={16}/> : <Play size={16}/>}</button>
          <div className={styles.table}>
            {loading ? <div className={styles.tableNotice} role="status">Preparando tu sala…</div> : stage === 'ready' ? <div className={styles.welcome}><span className={styles.ornament}>✦</span><h2>Este momento es para ti</h2><p>Elige una intención. Baraja y descubre las cartas a tu ritmo.</p><div className={styles.closedDeck} aria-hidden="true"><span/><span/><span/></div></div> : stage === 'select' ? <div className={styles.selection}><p>{session ? `Elige la carta ${Math.min(cards.length + 1, session.requiredCards)} de ${session.requiredCards} · ${spread.positions[cards.length] || 'Lectura preparada'}` : 'Elige la carta que te llame la atención'}</p>{session && cards.length >= session.requiredCards ? <button className={styles.goldButton} disabled={!!busy} onClick={complete}>Completar lectura</button> : <div className={styles.fan}>{Array.from({ length: 21 }, (_, n) => <button key={n} className={styles.cardBack} disabled={!!busy || cards.some(c => c.selectedPosition === n)} aria-label={`Elegir carta ${n + 1}`} onClick={() => pick(n)}><span>☾</span>{cards.some(c => c.selectedPosition === n) && <Check size={18}/>}</button>)}</div>}{cards.length > 0 && <div className={styles.picked}>{cards.map(c => <span key={c.position}>{c.position}: {c.cardName}</span>)}</div>}</div> : <div className={styles.cards} data-count={cards.length}>{cards.map((c, i) => <TarotCard key={`${c.position}-${c.cardId}`} card={c} selected={selected === i} onClick={() => setSelected(i)}/>)}</div>}
            {!!busy && <p className={styles.busy} role="status"><Sparkles size={14}/>{busy}</p>}
          </div>
          <div className={styles.voiceBar}>{stage === 'result' ? <><button disabled={!voice.available} onClick={voice.play}><Volume2 size={18}/>{voice.state === 'speaking' ? 'Pausar narración' : voice.state === 'paused' ? 'Reanudar narración' : 'Escuchar interpretación'}</button>{voice.state !== 'idle' && <button aria-label="Detener narración" onClick={voice.stop}><Square size={15}/></button>}</> : <span><MoonStar size={16}/> Tu espacio de calma</span>}<small>{stage === 'result' && !voice.available ? 'Narración: requiere una voz española local' : 'Guía virtual · interpretación simbólica'}</small></div>
          {voice.error && <p role="status" className={styles.voiceError}>{voice.error}</p>}
        </section>
        <aside className={styles.side}>
          <section className={styles.reading} aria-label="Interpretación de tu lectura">
            <span className={styles.eyebrow}>{stage === 'result' ? activeCard?.position : 'TU INTENCIÓN'}</span><h2>{stage === 'result' ? 'Tu lectura' : stage === 'select' ? 'Escoge con calma' : 'Prepara tu consulta'}</h2><div className={styles.divider}>✦</div>
            {stage === 'result' && draw ? <><h3>{activeCard?.cardName}</h3><p className={styles.prose}>{reading}</p><div className={styles.insight}><Sparkles size={21}/><div><h3>Tu siguiente paso</h3><p>{activeCard?.advice || draw.advice}</p></div></div>{cards.length > 1 && <details><summary>Ver la lectura completa</summary>{cards.map(c => <article key={c.position}><h3>{c.position} · {c.cardName}</h3><p>{c.interpretation}</p></article>)}<p>{draw.conclusion}</p></details>}<div className={styles.readingActions}><button onClick={saveCopy}><Download size={16}/> Guardar copia</button><button onClick={newReading} disabled={!!busy}><Shuffle size={16}/> Nueva tirada</button></div><small className={styles.saved}><Check size={13}/> Guardada en tu historial</small></> : stage === 'select' ? <><p>Las cartas se van revelando al elegirlas. Cada posición aporta una perspectiva distinta.</p><p className={styles.subtle}>{session ? 'Tu tirada comprada está reservada y se recuperará al volver al panel.' : 'Esta carta utiliza tu tirada gratuita de hoy.'}</p>{session && <ol className={styles.positions}>{spread.positions.map((p, i) => <li key={p} data-complete={i < cards.length}>{p}{i < cards.length && <Check size={14}/>}</li>)}</ol>}<button className={styles.textButton} onClick={() => load()} disabled={!!busy}><RefreshCw size={15}/> Recuperar tirada guardada</button></> : <><p>{mode === 'free_daily' ? 'Una carta gratuita cada 24 horas para hacer una pausa y mirar tu día desde otra perspectiva.' : spread.description}</p>{mode !== 'free_daily' && <label className={styles.questionLabel}>¿Qué te gustaría explorar?<textarea value={initialQuestion} onChange={e => setInitialQuestion(e.target.value)} placeholder={spread.question} maxLength={400} disabled={loading || !!busy}/></label>}<div className={styles.cost}><span>{mode === 'free_daily' ? 'Carta del día' : `${spread.positions.length} cartas · 1 pregunta incluida`}</span><strong>{mode === 'free_daily' ? 'Gratis' : '1 tirada de tu saldo'}</strong></div>{mode === 'free_daily' && !freeAvailable ? <><p className={styles.subtle}>{countdown ? `Tu próxima carta gratis estará lista en ${countdownLabel}.` : 'La carta gratuita se está recargando.'}</p><button className={styles.goldButton} onClick={() => setMode('clarity')} disabled={loading}>Explorar tiradas</button></> : mode !== 'free_daily' && credits < 1 ? <Link className={styles.goldButton} href="/cliente/precios-ofertas">Ver packs de tiradas <ArrowRight size={16}/></Link> : <button className={styles.goldButton} onClick={start} disabled={loading || !!busy}><Shuffle size={17}/>{busy || (mode === 'free_daily' ? 'Usar mi carta gratis' : 'Empezar mi tirada')}</button>}<small className={styles.subtle}>{mode !== 'free_daily' ? 'La tirada se reserva al empezar. Podrás continuarla si cierras el panel.' : 'No se descuenta ninguna tirada comprada.'}</small><Link className={styles.textButton} href="/cliente/precios-ofertas">Consultar packs y precios <ArrowRight size={14}/></Link></>}
          </section>
          <section className={styles.oracle} aria-label="Oráculo de tu lectura"><div className={styles.oracleHeading}><h2>Oráculo de tu lectura</h2>{stage === 'result' && questionState.includedAvailable && <span>1 pregunta incluida</span>}</div><p>Profundiza en las cartas que han salido.</p>{stage === 'result' && draw ? <><div className={styles.conversation} role="log" aria-label="Conversación de esta lectura" aria-live="polite">{messages.map(m => <div key={m.id} className={m.role === 'user' ? styles.userMessage : styles.oracleMessage}><small>{m.role === 'user' ? 'Tu pregunta' : 'Oráculo'}</small><p>{m.contenido}</p></div>)}</div>{questionState.total > 0 ? <><label className={styles.questionLabel}><span className={styles.srOnly}>Pregunta sobre esta tirada</span><textarea value={question} onChange={e => setQuestion(e.target.value)} maxLength={500} placeholder="¿Qué te gustaría aclarar?" disabled={!!busy}/></label><button className={styles.goldButton} onClick={ask} disabled={!!busy || !question.trim()}><SendHorizontal size={16}/>{busy === 'Consultando el Oráculo…' ? busy : 'Preguntar al Oráculo'}</button><small>{questionState.includedAvailable ? 'Se usará la pregunta incluida.' : 'Se usará 1 pregunta extra.'} {questionState.extra} preguntas extra disponibles.</small></> : <div className={styles.moreQuestions}><p>Tu respuesta y tu lectura siguen guardadas.</p><strong>3 preguntas adicionales · 2,00 €</strong><ClientPurchaseAction checkoutEnabled><button className={styles.goldButton} onClick={buyQuestions} disabled={!!busy}>{busy === 'Preparando pago…' ? busy : 'CONTINUAR HABLANDO CON EL ORÁCULO'}</button></ClientPurchaseAction><small>Compra opcional. Verás el importe antes de pagar.</small></div>}</> : <div className={styles.oracleEmpty}><MoonStar size={22}/><p>Tu pregunta incluida se abrirá al completar la tirada.</p></div>}</section>
        </aside>
      </div>
      <footer className={styles.footer}><span>Interpretación simbólica para la reflexión personal.</span><Link href="/cliente/dashboard"><ArrowLeft size={13}/> Volver a mi panel</Link><a href="/images/oracle/CREDITS.txt" target="_blank" rel="noopener noreferrer">Sobre las imágenes</a></footer>
    </div>
  </ClienteLayout>;
}
