'use client';

import { Bell, Check, CircleHelp, Pause, Play, RefreshCw, Sparkles } from 'lucide-react';
import { atlasStamp } from './atlas-types';
import { atlasWatchMinutes, type AtlasWatchesController } from './atlas-watch-types';
import styles from './Atlas.module.css';

export function AtlasWatchPanel({ controller, onPromotions }: { controller: AtlasWatchesController; onPromotions: () => void }) {
  const { watches, loading, busy, error, stale, refresh, action } = controller;
  return <section className={`${styles.surface} ${styles.watchPanel}`} aria-label="Avisos de minutos de clientas">
    <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>Clientas en el radar</span><h2>Un aviso antes de quedarse sin minutos</h2></div><button type="button" className={styles.quietButton} disabled={loading || !!busy} onClick={refresh}><RefreshCw size={14} />Actualizar saldos</button></div>
    <p className={styles.watchIntro}>Atlas te avisa cuando el saldo total registrado llega al límite o baja de él, incluido cero. Suma los minutos FREE y normales.</p>
    {error ? <p className={styles.watchError} role="alert"><CircleHelp size={16} />{error}</p> : null}
    {watches.length ? <div className={styles.watchGrid}>{watches.map(watch => {
      const balance = watch.balance;
      const low = balance.state === 'known' && balance.total <= watch.threshold;
      const unseen = watch.enabled && watch.alert && !watch.alert.acknowledgedAt;
      return <article key={watch.id} className={styles.watchCard} data-alert={!!unseen} data-paused={!watch.enabled}>
        <div className={styles.watchHeading}><div><h3>{watch.clientName}</h3><span>Aviso con {watch.threshold} min o menos</span></div><span className={styles.watchStatus}>{!watch.enabled ? 'En pausa' : unseen ? 'Requiere atención' : low ? 'Saldo bajo' : balance.state === 'known' ? 'Seguimiento activo' : 'Sin comprobar'}</span></div>
        <div className={styles.watchBalance}><strong>{atlasWatchMinutes(watch)}</strong><span>{stale ? 'Último saldo · pendiente de actualizar' : balance.state === 'known' ? `${balance.free} FREE + ${balance.normal} normales` : 'No se interpreta como cero'}</span></div>
        {balance.state === 'known' && balance.observedAt ? <p className={styles.watchDate}>Comprobado: {atlasStamp(balance.observedAt)} · Ecuador</p> : null}
        {unseen ? <p className={styles.watchNotice}><Bell size={15} />{stale || balance.state !== 'known' ? 'Hay un aviso de saldo pendiente. Actualiza para comprobar los minutos actuales.' : balance.total === 0 ? 'Se ha quedado sin minutos. Puedes revisar una promoción.' : 'Ya está dentro del límite. Puedes revisar una promoción.'}</p> : watch.alert?.acknowledgedAt && watch.enabled ? <p className={styles.watchNotice}><Check size={15} />Aviso visto. El seguimiento continúa; el aviso se renovará cuando supere el límite y vuelva a bajar.</p> : null}
        {!watch.enabled ? <p className={styles.watchNotice}>Los avisos están pausados. Al reanudar, Atlas comprobará el saldo registrado.</p> : null}
        <div className={styles.watchActions}><button type="button" className={styles.primaryButton} onClick={onPromotions} disabled={!!busy}><Sparkles size={14} />Ver promociones</button>{unseen ? <button type="button" className={styles.quietButton} disabled={!!busy} onClick={() => void action({ action: 'acknowledge', alertId: watch.alert!.id })}><Check size={14} />Marcar aviso visto</button> : null}<button type="button" className={styles.quietButton} disabled={!!busy} onClick={() => void action({ action: 'set_enabled', watchId: watch.id, enabled: !watch.enabled })}>{watch.enabled ? <Pause size={13} /> : <Play size={13} />}{watch.enabled ? 'Pausar avisos' : 'Reanudar avisos'}</button></div>
      </article>;
    })}</div> : <p className={styles.noData}>{loading ? 'Consultando los seguimientos…' : error ? 'No se ha podido consultar la lista de seguimientos.' : 'Todavía no hay clientas con un aviso de saldo configurado.'}</p>}
    <p className={styles.watchScope}>Las promociones actuales se activan para el panel de clientes en general. Este aviso no activa una oferta individual ni envía mensajes a la clienta.</p>
  </section>;
}
