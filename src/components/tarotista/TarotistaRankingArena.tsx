"use client";

import { useMemo, useState } from "react";
import {
  Award,
  Crown,
  HeartHandshake,
  Medal,
  RefreshCw,
  Repeat2,
  Sparkles,
  Target,
  Trophy,
  UsersRound,
} from "lucide-react";
import styles from "./TarotistaRankingArena.module.css";

type RankingKey = "captadas" | "cliente" | "repite";

type RankingRow = {
  worker_id?: string | null;
  display_name?: string | null;
  captadas_total?: number | string | null;
  pct_cliente?: number | string | null;
  pct_repite?: number | string | null;
};

type Props = {
  data: any;
  month: string;
  myWorkerId?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
};

const CATEGORIES: Array<{
  key: RankingKey;
  label: string;
  short: string;
  metric: keyof RankingRow;
  Icon: typeof UsersRound;
}> = [
  { key: "captadas", label: "Captadas", short: "Captadas", metric: "captadas_total", Icon: UsersRound },
  { key: "cliente", label: "Cliente", short: "Cliente", metric: "pct_cliente", Icon: HeartHandshake },
  { key: "repite", label: "Repite", short: "Repite", metric: "pct_repite", Icon: Repeat2 },
];

function monthLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!match) return value || "Periodo actual";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return value;
  const text = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function avatarIndex(value: unknown) {
  const text = String(value || "Tarotista");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return (hash % 8) + 1;
}

function avatarSrc(value: unknown) {
  return `/images/ranking-tarotistas/tarotista-${avatarIndex(value)}.svg`;
}

function categoryClass(key: RankingKey) {
  if (key === "captadas") return styles.tabCaptadas;
  if (key === "cliente") return styles.tabCliente;
  return styles.tabRepite;
}

function TarotistPortrait({ name, compact = false }: { name?: string | null; compact?: boolean }) {
  return (
    <span className={compact ? styles.portraitCompact : styles.portrait}>
      <img src={avatarSrc(name)} alt="" aria-hidden="true" />
    </span>
  );
}

function num(value: unknown) {
  return Number(value || 0) || 0;
}

function formatValue(key: RankingKey, value: unknown) {
  if (key === "captadas") return `${Math.round(num(value))}`;
  return `${num(value).toFixed(2)}%`;
}

function formatGap(key: RankingKey, value: number) {
  if (key === "captadas") {
    const rounded = Math.max(0, Math.ceil(value));
    return `${rounded} ${rounded === 1 ? "captación" : "captaciones"}`;
  }
  return `${Math.max(0, value).toFixed(2)} puntos`;
}

function rankClass(index: number) {
  if (index === 0) return styles.rankGold;
  if (index === 1) return styles.rankSilver;
  if (index === 2) return styles.rankBronze;
  return "";
}

export default function TarotistaRankingArena({ data, month, myWorkerId, refreshing = false, onRefresh }: Props) {
  const [activeKey, setActiveKey] = useState<RankingKey>("cliente");

  const config = CATEGORIES.find((item) => item.key === activeKey) || CATEGORIES[1];
  const leaderboards = data?.leaderboards || data?.top || {};
  const activeRows: RankingRow[] = Array.isArray(leaderboards?.[activeKey]) ? leaderboards[activeKey] : [];
  const topTen = activeRows.slice(0, 10);
  const topThree = activeRows.slice(0, 3);

  const myRow = useMemo(() => {
    if (data?.my && String(data.my.worker_id) === String(myWorkerId || data?.my?.worker_id || "")) return data.my as RankingRow;
    return activeRows.find((row) => String(row.worker_id) === String(myWorkerId || "")) || data?.my || null;
  }, [activeRows, data?.my, myWorkerId]);

  const myIndex = useMemo(
    () => activeRows.findIndex((row) => String(row.worker_id) === String(myWorkerId || myRow?.worker_id || "")),
    [activeRows, myWorkerId, myRow?.worker_id]
  );
  const myPosition = myIndex >= 0 ? myIndex + 1 : Number(data?.positions?.[activeKey] || 0) || null;
  const myValue = myRow ? num(myRow[config.metric]) : 0;
  const aheadRow = myIndex > 0 ? activeRows[myIndex - 1] : null;
  const behindRow = myIndex >= 0 && myIndex + 1 < activeRows.length ? activeRows[myIndex + 1] : null;
  const aheadValue = aheadRow ? num(aheadRow[config.metric]) : 0;
  const gap = aheadRow ? Math.max(0, aheadValue - myValue) : 0;
  const targetProgress = aheadRow && aheadValue > 0 ? Math.min(100, Math.max(0, (myValue / aheadValue) * 100)) : myPosition === 1 ? 100 : 0;

  const strongest = useMemo(() => {
    const entries = CATEGORIES.map((item) => ({ key: item.key, label: item.label, pos: Number(data?.positions?.[item.key] || 0) || null }))
      .filter((entry) => entry.pos !== null)
      .sort((a, b) => Number(a.pos) - Number(b.pos));
    return entries[0] || null;
  }, [data?.positions]);

  const bestPosition = strongest?.pos || null;
  const competitionZone = useMemo(() => {
    if (myIndex < 0) return [];
    const start = Math.max(0, myIndex - 1);
    return activeRows.slice(start, Math.min(activeRows.length, myIndex + 2));
  }, [activeRows, myIndex]);

  const participants = activeRows.length;
  const activeMetricValue = (row: RankingRow) => row?.[config.metric];
  const dataAvailable = participants > 0;

  return (
    <section className={styles.arena}>
      <header className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <div className={styles.heroIcon}><Trophy size={24} /></div>
          <div>
            <span className={styles.eyebrow}>ARENA COMPETITIVA · TAROT CELESTIAL</span>
            <h1>Ranking del mes</h1>
            <p>La carrera sigue abierta. Mantén el ritmo, protege tu posición y mira quién tienes justo delante.</p>
          </div>
        </div>

        <div className={styles.heroActions}>
          <div className={styles.heroChip}><Sparkles size={14} /><span>Datos reales</span></div>
          <div className={styles.heroChip}><Award size={14} /><span>{monthLabel(month)}</span></div>
          <button type="button" className={styles.refreshButton} onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? styles.spin : ""} />
            {refreshing ? "Actualizando" : "Actualizar"}
          </button>
        </div>
      </header>

      <div className={styles.summaryStrip}>
        <article>
          <span>Tu mejor posición actual</span>
          <strong>{bestPosition ? `#${bestPosition}` : "—"}</strong>
          <small>{strongest ? `${strongest.label} es tu categoría más fuerte` : "Sin posición disponible"}</small>
        </article>
        <article>
          <span>Competidores del mes</span>
          <strong>{participants}</strong>
          <small>Participantes reales en {config.label.toLowerCase()}</small>
        </article>
        <article>
          <span>Tu posición · {config.label}</span>
          <strong>{myPosition ? `#${myPosition}` : "—"}</strong>
          <small>{myRow ? formatValue(activeKey, myValue) : "Sin actividad registrada"}</small>
        </article>
        <article>
          <span>Próximo objetivo</span>
          <strong>{aheadRow ? `#${Math.max(1, Number(myPosition || 1) - 1)}` : myPosition === 1 ? "Líder" : "—"}</strong>
          <small>{aheadRow ? `Te separan ${formatGap(activeKey, gap)}` : myPosition === 1 ? "Defiende el primer puesto" : "Sin rival directo calculable"}</small>
        </article>
      </div>

      <nav className={styles.tabs} aria-label="Categorías del ranking">
        {CATEGORIES.map(({ key, label, Icon }, index) => (
          <button
            key={key}
            type="button"
            className={`${styles.tabButton} ${categoryClass(key)} ${activeKey === key ? styles.tabActive : ""}`}
            onClick={() => setActiveKey(key)}
            aria-pressed={activeKey === key}
          >
            <TarotistPortrait name={`categoria-${index + 1}`} compact />
            <span className={styles.tabIcon}><Icon size={18} /></span>
            <span className={styles.tabCopy}>
              <strong>{label}</strong>
              <small>{key === "captadas" ? "Nuevas conexiones" : key === "cliente" ? "Mejor rendimiento" : "Clientes que vuelven"}</small>
            </span>
            {data?.positions?.[key] ? <b>#{data.positions[key]}</b> : null}
          </button>
        ))}
      </nav>

      {!dataAvailable ? (
        <div className={styles.emptyState}>
          <Trophy size={34} />
          <h2>Todavía no hay clasificación</h2>
          <p>La competición aparecerá cuando exista actividad registrada para este periodo.</p>
        </div>
      ) : (
        <>
          <section className={styles.podiumStage}>
            <div className={styles.stars} aria-hidden="true" />
            <div className={styles.mountains} aria-hidden="true" />
            <div className={styles.stageHeader}>
              <div>
                <span className={styles.eyebrow}>PODIO · {config.label.toUpperCase()}</span>
                <h2>Las tres posiciones que marcan el ritmo</h2>
              </div>
              <div className={styles.provisionalBadge}>Clasificación provisional</div>
            </div>

            <div className={styles.podiumGrid}>
              {[1, 0, 2].map((sourceIndex, visualIndex) => {
                const row = topThree[sourceIndex];
                const position = sourceIndex + 1;
                const isMe = row && String(row.worker_id) === String(myWorkerId || myRow?.worker_id || "");
                const Icon = position === 1 ? Crown : Medal;
                return (
                  <article
                    key={`podium-${position}`}
                    className={`${styles.podiumCard} ${rankClass(sourceIndex)} ${visualIndex === 1 ? styles.podiumChampion : ""} ${isMe ? styles.podiumMe : ""}`}
                  >
                    <div className={styles.podiumAura} aria-hidden="true" />
                    <div className={styles.medalIcon}><Icon size={position === 1 ? 30 : 24} /></div>
                    <span className={styles.podiumPosition}>#{position}</span>
                    {row ? (
                      <>
                        <TarotistPortrait name={row.display_name} />
                        <strong>{row.display_name || "Tarotista"}</strong>
                        {isMe ? <span className={styles.youBadge}>TÚ</span> : null}
                        <b>{formatValue(activeKey, activeMetricValue(row))}</b>
                        <small>{config.short}</small>
                      </>
                    ) : (
                      <div className={styles.podiumVacant}>Sin participante</div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <div className={styles.contentGrid}>
            <section className={styles.leaderboardCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <span className={styles.eyebrow}>TOP 10 · {config.label.toUpperCase()}</span>
                  <h2>Clasificación general</h2>
                  <p>{participants} participantes con datos reales en el periodo.</p>
                </div>
                <Trophy size={26} />
              </div>

              <div className={styles.tableHeader} aria-hidden="true">
                <span>Puesto</span><span>Tarotista</span><span>Valor</span>
              </div>
              <div className={styles.rankingList}>
                {topTen.map((row, index) => {
                  const isMe = String(row.worker_id) === String(myWorkerId || myRow?.worker_id || "");
                  return (
                    <article key={String(row.worker_id || `${row.display_name}-${index}`)} className={`${styles.rankingRow} ${index === 0 ? styles.rowGold : index === 1 ? styles.rowSilver : index === 2 ? styles.rowBronze : ""} ${isMe ? styles.myRow : ""}`}>
                      <div className={`${styles.positionBadge} ${rankClass(index)}`}>{index + 1}</div>
                      <div className={styles.rowIdentity}>
                        <TarotistPortrait name={row.display_name} compact />
                        <div>
                          <strong>{row.display_name || "Tarotista"}</strong>
                          <small>{index === 0 ? "Lidera esta categoría" : isMe ? "Tu posición actual" : `Puesto #${index + 1}`}</small>
                        </div>
                        {isMe ? <span className={styles.youBadge}>TÚ</span> : null}
                      </div>
                      <div className={styles.rowValue}>{formatValue(activeKey, activeMetricValue(row))}</div>
                    </article>
                  );
                })}
              </div>

              {myPosition && myPosition > 10 && myRow ? (
                <div className={styles.outsideTopTen}>
                  <span>Tu posición</span>
                  <div className={styles.rowIdentity}>
                    <div className={styles.positionBadge}>{myPosition}</div>
                    <TarotistPortrait name={myRow.display_name} compact />
                    <div><strong>{myRow.display_name || "Tarotista"}</strong><small>Fuera del Top 10, pero dentro de la carrera.</small></div>
                    <span className={styles.youBadge}>TÚ</span>
                  </div>
                  <b>{formatValue(activeKey, myValue)}</b>
                </div>
              ) : null}
            </section>

            <aside className={styles.sideColumn}>
              <section className={styles.targetCard}>
                <div className={styles.targetIcon}><Target size={22} /></div>
                <span className={styles.eyebrow}>TU PRÓXIMO OBJETIVO</span>
                {myPosition === 1 ? (
                  <>
                    <h2>Estás liderando</h2>
                    <p>Ahora el objetivo es mantener la primera posición hasta el cierre del periodo.</p>
                    <div className={styles.leaderState}><Crown size={18} /> #1</div>
                  </>
                ) : aheadRow ? (
                  <>
                    <div className={styles.duelNames}>
                      <div><small>TÚ</small><strong>#{myPosition}</strong><span>{myRow?.display_name || "Tu posición"}</span></div>
                      <div className={styles.duelArrow}>→</div>
                      <div><small>OBJETIVO</small><strong>#{Math.max(1, Number(myPosition || 1) - 1)}</strong><span>{aheadRow.display_name || "Siguiente puesto"}</span></div>
                    </div>
                    <div className={styles.targetValues}>
                      <span>{formatValue(activeKey, myValue)}</span>
                      <span>{formatValue(activeKey, aheadValue)}</span>
                    </div>
                    <div className={styles.progressTrack}><span style={{ width: `${targetProgress}%` }} /></div>
                    <p className={styles.gapText}>Te separan <strong>{formatGap(activeKey, gap)}</strong> del puesto anterior.</p>
                  </>
                ) : (
                  <>
                    <h2>Sin rival directo</h2>
                    <p>Cuando haya suficientes datos reales, aquí verás la distancia exacta al siguiente puesto.</p>
                  </>
                )}
              </section>

              <section className={styles.zoneCard}>
                <div className={styles.sectionHeaderCompact}>
                  <div>
                    <span className={styles.eyebrow}>COMPETENCIA CERCANA</span>
                    <h3>Tu zona de carrera</h3>
                  </div>
                  <UsersRound size={20} />
                </div>
                <div className={styles.zoneList}>
                  {competitionZone.length ? competitionZone.map((row) => {
                    const index = activeRows.findIndex((item) => String(item.worker_id) === String(row.worker_id));
                    const isMe = String(row.worker_id) === String(myWorkerId || myRow?.worker_id || "");
                    return (
                      <div key={`zone-${row.worker_id}`} className={isMe ? styles.zoneMe : ""}>
                        <span>#{index + 1}</span>
                        <TarotistPortrait name={row.display_name} compact />
                        <strong>{row.display_name || "Tarotista"}</strong>
                        {isMe ? <b>TÚ</b> : null}
                        <em>{formatValue(activeKey, activeMetricValue(row))}</em>
                      </div>
                    );
                  }) : <p className={styles.zoneEmpty}>Sin competidores cercanos para mostrar.</p>}
                </div>
                {behindRow ? <small className={styles.defendNote}>Tienes competencia por detrás: {behindRow.display_name || "otro participante"} ocupa el puesto #{Number(myPosition || 0) + 1}.</small> : null}
              </section>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
