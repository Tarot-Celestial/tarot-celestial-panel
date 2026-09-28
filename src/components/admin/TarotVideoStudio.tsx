"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clapperboard,
  Clock3,
  Film,
  ImagePlus,
  ListChecks,
  Loader2,
  Play,
  Send,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./TarotVideoStudio.module.css";

type Provider = "instagram" | "tiktok";
type Model = "wan3" | "seedance2_5" | "gen4.5";
type Resolution = "480p" | "720p" | "1080p";
type StudioResult = {
  url: string;
  title: string;
  model: Model;
  duration: number;
  format: "vertical" | "landscape";
  resolution: Resolution;
  prompt: string;
  prompt_scene_1?: string;
  prompt_scene_2?: string;
  task_ids?: string[];
  long_mode?: boolean;
  credits_estimate?: number;
};

type StudioJob = {
  job_id: string;
  provider: Provider;
  started_at: string;
  title: string;
  model: Model;
  duration: number;
  format: "vertical" | "landscape";
  resolution: Resolution;
  ratio: string;
  long_mode: boolean;
  credits_estimate: number;
  prompt: string;
  prompt_scene_1?: string;
  prompt_scene_2?: string;
  task_ids: string[];
  reference_urls: string[];
  use_first_frame: boolean;
};

type StudioTaskState = {
  id: string;
  status: string;
  failure?: string | null;
  failure_code?: string | null;
};

type ReferenceAsset = { name: string; url: string; size: number };

type Props = {
  provider: Provider;
  connected: boolean;
  onUseInEditor: (result: StudioResult) => void;
  onRefresh?: () => Promise<void> | void;
};

const MODEL_META: Record<Model, { name: string; max: number; min: number; note: string }> = {
  wan3: { name: "WAN 3.0", min: 2, max: 30, note: "Recomendado · hasta 30 s · referencias múltiples" },
  seedance2_5: { name: "Seedance 2.5", min: 4, max: 30, note: "Cinemático · hasta 30 s · referencias avanzadas" },
  "gen4.5": { name: "Gen-4.5", min: 2, max: 10, note: "Premium corto · 2–10 s" },
};

const COSTS: Record<Model, Record<Resolution, number>> = {
  wan3: { "480p": 5, "720p": 10, "1080p": 20 },
  seedance2_5: { "480p": 20, "720p": 30, "1080p": 68 },
  "gen4.5": { "480p": 12, "720p": 12, "1080p": 12 },
};

function clampDuration(model: Model, value: number) {
  const meta = MODEL_META[model];
  return Math.max(meta.min, Math.min(meta.max, Math.round(value || meta.min)));
}

export default function TarotVideoStudio({ provider, connected, onUseInEditor, onRefresh }: Props) {
  const [model, setModel] = useState<Model>("wan3");
  const [duration, setDuration] = useState(15);
  const [longMode, setLongMode] = useState(false);
  const [format, setFormat] = useState<"vertical" | "landscape">("vertical");
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [brief, setBrief] = useState("");
  const [contentType, setContentType] = useState("lectura_tarot");
  const [mood, setMood] = useState("místico premium, oscuro, violeta y dorado");
  const [camera, setCamera] = useState("acercamiento cinematográfico suave");
  const [pace, setPace] = useState("elegante y magnético");
  const [advanced, setAdvanced] = useState("");
  const [references, setReferences] = useState<ReferenceAsset[]>([]);
  const [useFirstFrame, setUseFirstFrame] = useState(false);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<StudioResult | null>(null);
  const [job, setJob] = useState<StudioJob | null>(null);
  const [taskStates, setTaskStates] = useState<StudioTaskState[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const activeJobRef = useRef<string | null>(null);

  const effectiveResolution: Resolution = model === "gen4.5" ? "720p" : resolution;
  const effectiveDuration = longMode ? 60 : clampDuration(model, duration);
  const creditEstimate = useMemo(() => {
    const seconds = longMode ? 60 : effectiveDuration;
    const raw = COSTS[model][effectiveResolution] * seconds;
    if (model === "seedance2_5") return Math.max(longMode ? 160 : 80, raw);
    return raw;
  }, [model, effectiveResolution, effectiveDuration, longMode]);

  async function accessToken() {
    const { data } = await supabaseBrowser().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Sesión de administrador no disponible");
    return token;
  }

  async function api(path: string, init?: RequestInit) {
    const token = await accessToken();
    const res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.error || "Error en IA Studio");
    return json;
  }

  function selectModel(next: Model) {
    setModel(next);
    if (next === "gen4.5") {
      setLongMode(false);
      setResolution("720p");
      setDuration((d) => Math.min(10, Math.max(2, d)));
    } else {
      setDuration((d) => Math.min(30, Math.max(next === "seedance2_5" ? 4 : 2, d)));
    }
  }

  function toggleLongMode(value: boolean) {
    setLongMode(value);
    if (value && model === "gen4.5") setModel("wan3");
  }

  async function uploadReferences(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []) as File[];
    event.target.value = "";
    if (!files.length) return;
    if (references.length + files.length > 10) {
      setError("Puedes usar hasta 10 imágenes de referencia por generación.");
      return;
    }
    setBusy("upload");
    setError("");
    setMessage("");
    try {
      const uploaded = await Promise.all(files.map(async (file) => {
        if (!file.type.startsWith("image/")) throw new Error(`${file.name}: solo se admiten imágenes.`);
        if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name}: supera el máximo de 12 MB.`);
        const form = new FormData();
        form.append("file", file);
        const json = await api("/api/admin/social-ai/reference", { method: "POST", body: form });
        return { name: file.name, url: json.asset.url, size: file.size } as ReferenceAsset;
      }));
      setReferences((current) => [...current, ...uploaded]);
      setMessage(`${uploaded.length} referencia${uploaded.length === 1 ? "" : "s"} añadida${uploaded.length === 1 ? "" : "s"}.`);
    } catch (e: any) {
      setError(e?.message || "No se pudieron subir las referencias");
    } finally {
      setBusy("");
    }
  }

  function jobStorageKey() {
    return `tc_tarot_video_studio_job_v3_${provider}`;
  }

  function statusLabel(status: string) {
    const value = String(status || "PENDING").toUpperCase();
    if (value === "PENDING") return "En cola en Runway";
    if (value === "RUNNING" || value === "PROCESSING") return "Runway está generando";
    if (value === "SUCCEEDED") return "Completada";
    if (value === "FAILED") return "Fallida";
    if (value === "CANCELED" || value === "CANCELLED") return "Cancelada";
    return value || "Preparando";
  }

  function taskPhase(status: string) {
    const value = String(status || "PENDING").toUpperCase();
    if (value === "SUCCEEDED") return 100;
    if (value === "RUNNING" || value === "PROCESSING") return 68;
    if (value === "PENDING") return 28;
    return 10;
  }

  function elapsedLabel(seconds: number) {
    const safe = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function finalizeJob(currentJob: StudioJob) {
    setProgress(currentJob.long_mode
      ? "Las dos escenas están listas. Montando el MP4 final de 60 segundos y guardándolo en la Biblioteca…"
      : "Runway terminó el vídeo. Guardando el MP4 final en la Biblioteca…");
    const json = await api("/api/admin/social-ai", {
      method: "POST",
      body: JSON.stringify({
        action: "video-studio-finalize",
        provider: currentJob.provider,
        task_ids: currentJob.task_ids,
        title: currentJob.title,
        model: currentJob.model,
        duration: currentJob.duration,
        long_mode: currentJob.long_mode,
        format: currentJob.format,
        resolution: currentJob.resolution,
        ratio: currentJob.ratio,
        credits_estimate: currentJob.credits_estimate,
        prompt: currentJob.prompt,
        prompt_scene_1: currentJob.prompt_scene_1 || "",
        prompt_scene_2: currentJob.prompt_scene_2 || "",
        reference_urls: currentJob.reference_urls,
        use_first_frame: currentJob.use_first_frame,
      }),
    });
    const asset = json.asset as StudioResult;
    setResult(asset);
    setJob(null);
    setTaskStates([]);
    setProgress("");
    activeJobRef.current = null;
    try { window.localStorage.removeItem(jobStorageKey()); } catch {}
    setMessage(currentJob.long_mode
      ? "Vídeo final de 60 s generado, unido y guardado en la Biblioteca multimedia."
      : "Vídeo generado y guardado en la Biblioteca multimedia.");
    await onRefresh?.();
  }

  async function monitorJob(currentJob: StudioJob) {
    activeJobRef.current = currentJob.job_id;
    setBusy("generate");
    let transientFailures = 0;
    try {
      while (activeJobRef.current === currentJob.job_id) {
        try {
          const json = await api("/api/admin/social-ai", {
            method: "POST",
            body: JSON.stringify({
              action: "video-studio-status",
              provider: currentJob.provider,
              task_ids: currentJob.task_ids,
            }),
          });
          const states = (Array.isArray(json.tasks) ? json.tasks : []) as StudioTaskState[];
          setTaskStates(states);
          transientFailures = 0;

          const failed = states.find((task) => ["FAILED", "CANCELED", "CANCELLED"].includes(String(task.status || "").toUpperCase()));
          if (failed) throw new Error(failed.failure || failed.failure_code || `Runway no pudo completar ${currentJob.long_mode ? "una de las escenas" : "el vídeo"}.`);

          const allDone = states.length === currentJob.task_ids.length && states.every((task) => String(task.status || "").toUpperCase() === "SUCCEEDED");
          if (allDone) {
            await finalizeJob(currentJob);
            return;
          }

          const done = states.filter((task) => String(task.status || "").toUpperCase() === "SUCCEEDED").length;
          if (currentJob.long_mode) {
            if (done === 0) setProgress("Runway está trabajando en las 2 escenas. Puedes dejar esta pantalla abierta; el panel seguirá consultando el estado.");
            else setProgress("Escena 1/2 lista. Esperando a que Runway termine la escena restante…");
          } else {
            setProgress("Runway está generando el vídeo. El panel consulta el estado automáticamente cada pocos segundos.");
          }
        } catch (pollError: any) {
          const message = String(pollError?.message || "");
          const isTerminal = /FAILED|CANCELED|CANCELLED|no pudo completar|SAFETY|moderation/i.test(message);
          if (isTerminal) throw pollError;
          transientFailures += 1;
          if (transientFailures >= 5) throw pollError;
          setProgress(`Conexión temporal con Runway. Reintentando automáticamente (${transientFailures}/5)…`);
        }
        await sleep(5500);
      }
    } catch (e: any) {
      activeJobRef.current = null;
      setProgress("");
      setError(e?.message || "No se pudo completar el vídeo");
    } finally {
      if (activeJobRef.current === currentJob.job_id) activeJobRef.current = null;
      setBusy("");
    }
  }

  async function generate() {
    if (!brief.trim()) {
      setError("Describe qué vídeo de tarot quieres crear.");
      return;
    }
    activeJobRef.current = null;
    setBusy("generate");
    setError("");
    setMessage("");
    setResult(null);
    setJob(null);
    setTaskStates([]);
    setElapsedSeconds(0);
    setProgress(longMode ? "Preparando la dirección creativa y creando las 2 tareas de Runway…" : "Preparando la dirección creativa y creando la tarea de Runway…");
    try {
      const json = await api("/api/admin/social-ai", {
        method: "POST",
        body: JSON.stringify({
          action: "video-studio-start",
          provider,
          model,
          duration: longMode ? 60 : effectiveDuration,
          long_mode: longMode,
          format,
          resolution: effectiveResolution,
          brief: brief.trim(),
          content_type: contentType,
          mood,
          camera,
          pace,
          advanced: advanced.trim(),
          reference_urls: references.map((x) => x.url),
          use_first_frame: useFirstFrame && !longMode,
        }),
      });
      const nextJob = json.job as StudioJob;
      setJob(nextJob);
      setTaskStates(nextJob.task_ids.map((id) => ({ id, status: "PENDING" })));
      try { window.localStorage.setItem(jobStorageKey(), JSON.stringify(nextJob)); } catch {}
      setProgress(nextJob.long_mode
        ? "Tareas creadas. Runway empieza a generar las 2 escenas de 30 segundos…"
        : "Tarea creada. Runway empieza a generar el vídeo…");
      await monitorJob(nextJob);
    } catch (e: any) {
      setProgress("");
      setError(e?.message || "No se pudo iniciar la generación del vídeo");
      setBusy("");
    }
  }

  async function sendToTikTok() {
    if (!result || provider !== "tiktok") return;
    setBusy("send");
    setError("");
    setMessage("");
    try {
      const saved = await api("/api/admin/social-content", {
        method: "POST",
        body: JSON.stringify({
          provider: "tiktok",
          content_type: "video",
          title: result.title || "Vídeo IA Studio",
          caption: "",
          media_urls: [result.url],
          privacy_level: "SELF_ONLY",
          publish_mode: "inbox",
          settings: {
            is_aigc: true,
            share_to_feed: true,
            brand_organic_toggle: true,
            ai_meta: {
              source: "tarot_video_studio",
              model: result.model,
              duration: result.duration,
              prompt: result.prompt,
              long_mode: result.long_mode,
            },
          },
        }),
      });
      if (!saved.item?.id) throw new Error("No se pudo crear el borrador para TikTok.");
      await api("/api/admin/social-publish", { method: "POST", body: JSON.stringify({ id: saved.item.id }) });
      setMessage("Vídeo enviado a la bandeja de TikTok para revisarlo y publicarlo manualmente.");
      await onRefresh?.();
    } catch (e: any) {
      setError(e?.message || "No se pudo enviar el vídeo a TikTok");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (!job) {
      setElapsedSeconds(0);
      return;
    }
    const started = new Date(job.started_at).getTime();
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [job]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(jobStorageKey());
      if (!raw) return;
      const restored = JSON.parse(raw) as StudioJob;
      if (!restored?.job_id || !Array.isArray(restored.task_ids) || !restored.task_ids.length) return;
      setJob(restored);
      setTaskStates(restored.task_ids.map((id) => ({ id, status: "PENDING" })));
      setProgress("Recuperando una generación de Runway que estaba en curso…");
      void monitorJob(restored);
    } catch {
      try { window.localStorage.removeItem(jobStorageKey()); } catch {}
    }
    return () => { activeJobRef.current = null; };
    // Se ejecuta una sola vez para recuperar un trabajo tras recargar la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.studio}>
      <section className={styles.hero}>
        <div>
          <span>VIDEO STUDIO · TAROT CELESTIAL</span>
          <h3>Un estudio de vídeo IA pensado solo para tarot</h3>
          <p>Crea piezas verticales o panorámicas con dirección cinematográfica, referencias visuales y hasta 60 segundos montados automáticamente.</p>
        </div>
        <div className={styles.heroMark}><Sparkles size={30} /><span>RUNWAY</span></div>
      </section>

      {(message || error) && <div className={`${styles.notice} ${error ? styles.error : styles.success}`}>{error || message}</div>}

      <div className={styles.layout}>
        <section className={styles.controls}>
          <div className={styles.sectionTitle}><WandSparkles size={18} /><div><b>1. Concepto</b><span>Cuéntale al estudio exactamente qué quieres transmitir.</span></div></div>
          <label className={styles.bigLabel}>Idea del vídeo
            <textarea rows={6} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Ej. Una lectura de tarot sobre una persona que aún piensa en ti. Empieza con una mano barajando cartas sobre una mesa oscura, velas violetas, tensión, y termina revelando Los Enamorados. Sin texto sobreimpreso." />
          </label>

          <div className={styles.grid3}>
            <label>Tipo de pieza<select value={contentType} onChange={(e) => setContentType(e.target.value)}>
              <option value="lectura_tarot">Lectura de tarot</option>
              <option value="amor">Amor y relaciones</option>
              <option value="carta_dia">Carta del día</option>
              <option value="horoscopo">Horóscopo / zodiaco</option>
              <option value="destino">Mensaje del destino</option>
              <option value="ritual">Ritual / velas / cristales</option>
              <option value="misterio_viral">Misterio / vídeo viral</option>
              <option value="promocion">Promoción de consulta</option>
            </select></label>
            <label>Atmósfera<select value={mood} onChange={(e) => setMood(e.target.value)}>
              <option>místico premium, oscuro, violeta y dorado</option>
              <option>íntimo, cálido, velas y sombras suaves</option>
              <option>celestial, etéreo, estrellas y luz dorada</option>
              <option>dramático, misterioso y de alto contraste</option>
              <option>realista, elegante y natural</option>
            </select></label>
            <label>Ritmo<select value={pace} onChange={(e) => setPace(e.target.value)}>
              <option>elegante y magnético</option>
              <option>lento y ceremonial</option>
              <option>dinámico para TikTok</option>
              <option>tensión creciente</option>
              <option>cinematográfico narrativo</option>
            </select></label>
          </div>

          <div className={styles.divider} />
          <div className={styles.sectionTitle}><Film size={18} /><div><b>2. Motor de vídeo</b><span>Elige calidad, duración y formato.</span></div></div>
          <div className={styles.modelGrid}>
            {(Object.keys(MODEL_META) as Model[]).map((key) => <button key={key} type="button" className={`${styles.modelCard} ${model === key ? styles.modelActive : ""}`} onClick={() => selectModel(key)}>
              <b>{MODEL_META[key].name}</b><span>{MODEL_META[key].note}</span>{key === "wan3" && <em>RECOMENDADO</em>}
            </button>)}
          </div>

          <div className={styles.modeRow}>
            <button type="button" className={!longMode ? styles.modeActive : ""} onClick={() => toggleLongMode(false)}>Clip único</button>
            <button type="button" className={longMode ? styles.modeActive : ""} onClick={() => toggleLongMode(true)} disabled={model === "gen4.5"}>60 s · 2 escenas de 30 s</button>
          </div>

          <div className={styles.grid4}>
            <label>Duración<select disabled={longMode} value={longMode ? 60 : effectiveDuration} onChange={(e) => setDuration(Number(e.target.value))}>
              {Array.from({ length: MODEL_META[model].max - MODEL_META[model].min + 1 }, (_, i) => MODEL_META[model].min + i).map((s) => <option key={s} value={s}>{s} segundos</option>)}
              {longMode && <option value={60}>60 segundos</option>}
            </select></label>
            <label>Formato<select value={format} onChange={(e) => setFormat(e.target.value as any)}><option value="vertical">9:16 · TikTok / Reels</option><option value="landscape">16:9 · Horizontal</option></select></label>
            <label>Resolución<select disabled={model === "gen4.5"} value={effectiveResolution} onChange={(e) => setResolution(e.target.value as Resolution)}><option value="480p">480p · ahorro</option><option value="720p">720p · recomendado</option><option value="1080p">1080p · máxima</option></select></label>
            <label>Cámara<select value={camera} onChange={(e) => setCamera(e.target.value)}>
              <option>acercamiento cinematográfico suave</option><option>travelling lateral lento</option><option>órbita suave alrededor de la mesa</option><option>cámara fija con movimiento interno</option><option>handheld muy sutil y realista</option><option>macro de cartas y manos</option>
            </select></label>
          </div>

          <div className={styles.costCard}>
            <div><span>Estimación Runway</span><strong>{creditEstimate} créditos</strong><small>≈ ${(creditEstimate * 0.01).toFixed(2)} USD antes de impuestos</small></div>
            <div><span>Salida</span><strong>{effectiveDuration}s · {format === "vertical" ? "9:16" : "16:9"}</strong><small>{MODEL_META[model].name} · {effectiveResolution}</small></div>
          </div>

          <div className={styles.divider} />
          <div className={styles.sectionTitle}><ImagePlus size={18} /><div><b>3. Referencias visuales</b><span>Fotos de tarotista, cartas, mesa, estética o local para mantener coherencia.</span></div></div>
          <label className={styles.uploadBox}>
            <UploadCloud size={24} />
            <b>{busy === "upload" ? "Subiendo referencias…" : "Subir imágenes de referencia"}</b>
            <span>PNG, JPG o WebP · hasta 10 imágenes · máx. 12 MB por archivo</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy === "upload"} onChange={uploadReferences} />
          </label>

          {references.length > 0 && <div className={styles.references}>
            {references.map((ref, index) => <article key={`${ref.url}-${index}`}><img src={ref.url} alt={ref.name} /><div><b>{ref.name}</b><span>Referencia {index + 1}</span></div><button type="button" onClick={() => setReferences((items) => items.filter((_, i) => i !== index))}><Trash2 size={14} /></button></article>)}
          </div>}
          <label className={styles.checkRow}><input type="checkbox" checked={useFirstFrame} disabled={!references.length || longMode} onChange={(e) => setUseFirstFrame(e.target.checked)} /><span>Usar la primera imagen como fotograma inicial{longMode ? " (no disponible en modo 60 s)" : ""}</span></label>
          <p className={styles.referenceHint}>{model === "gen4.5" ? "Gen-4.5 utiliza la primera referencia como imagen inicial. Para referencias múltiples, WAN 3.0 o Seedance 2.5 son mejores opciones." : "Las referencias se envían al modelo para mantener persona, cartas, ambiente y estilo visual coherentes."}</p>

          <div className={styles.divider} />
          <div className={styles.sectionTitle}><Clapperboard size={18} /><div><b>4. Dirección avanzada</b><span>Opcional. Añade instrucciones muy concretas sin reescribir todo el prompt.</span></div></div>
          <label className={styles.bigLabel}>Instrucciones extra<textarea rows={4} value={advanced} onChange={(e) => setAdvanced(e.target.value)} placeholder="Ej. Mantener exactamente la misma mujer de la referencia. Movimiento de manos natural. No inventar cartas. Evitar texto ilegible. La cámara debe acercarse al rostro al final." /></label>

          <button className={styles.generate} disabled={busy === "generate" || !brief.trim()} onClick={() => void generate()}>
            {busy === "generate" ? <Loader2 size={18} className={styles.spin} /> : <Sparkles size={18} />}
            {busy === "generate" ? (longMode ? "Generando 2 escenas y montando…" : "Generando vídeo…") : (longMode ? "Generar vídeo final de 60 s" : "Generar vídeo")}
          </button>
          {progress && !job && <div className={styles.progress}><Loader2 size={15} className={styles.spin} /><span>{progress}</span></div>}
          {job && <section className={styles.liveProgress}>
            <div className={styles.liveProgressTop}>
              <div className={styles.liveProgressTitle}><Loader2 size={18} className={styles.spin} /><div><b>Generación en curso</b><span>{progress || "Consultando Runway…"}</span></div></div>
              <div className={styles.timer}><Clock3 size={14} /><strong>{elapsedLabel(elapsedSeconds)}</strong></div>
            </div>
            <div className={styles.taskList}>
              {job.task_ids.map((id, index) => {
                const state = taskStates.find((task) => task.id === id);
                const status = String(state?.status || "PENDING").toUpperCase();
                const done = status === "SUCCEEDED";
                return <article key={id} className={`${styles.taskCard} ${done ? styles.taskDone : ""}`}>
                  <div className={styles.taskIcon}>{done ? <CheckCircle2 size={18} /> : <Loader2 size={18} className={styles.spin} />}</div>
                  <div className={styles.taskInfo}><b>{job.long_mode ? `Escena ${index + 1}/2 · 30 s` : `Vídeo · ${job.duration} s`}</b><span>{statusLabel(status)}</span><small>ID {id.slice(0, 8)}…</small></div>
                  <div className={styles.phaseBar} aria-label={`Fase ${taskPhase(status)} de 100`}><i style={{ width: `${taskPhase(status)}%` }} /></div>
                </article>;
              })}
            </div>
            <p className={styles.progressNote}><ListChecks size={13} /> Runway no publica un porcentaje exacto de render. Mostramos el estado real de cada tarea, su fase y el tiempo transcurrido. Puedes recargar la página: el seguimiento se recuperará automáticamente.</p>
          </section>}
        </section>

        <aside className={styles.preview}>
          <div className={styles.previewHeader}><div><span>RESULTADO</span><b>Preview final</b></div>{result && <em>{result.duration}s</em>}</div>
          {result ? <>
            <video src={result.url} controls playsInline preload="metadata" />
            <div className={styles.resultMeta}><div><span>Modelo</span><b>{MODEL_META[result.model]?.name || result.model}</b></div><div><span>Resolución</span><b>{result.resolution}</b></div><div><span>Formato</span><b>{result.format === "vertical" ? "9:16" : "16:9"}</b></div><div><span>Coste estimado</span><b>{result.credits_estimate || creditEstimate} cr.</b></div></div>
            <div className={styles.resultTitle}><Sparkles size={16} /><div><span>Dirección IA</span><b>{result.title}</b></div></div>
            <details className={styles.promptDetails}><summary>Ver prompt final</summary><p>{result.prompt}</p>{result.prompt_scene_2 && <><b>Escena 2</b><p>{result.prompt_scene_2}</p></>}</details>
            <div className={styles.previewActions}>
              <button className={styles.secondary} onClick={() => onUseInEditor(result)}><Play size={15} /> Pasar al editor</button>
              {provider === "tiktok" && <button className={styles.primary} disabled={!connected || busy === "send"} onClick={() => void sendToTikTok()}>{busy === "send" ? <Loader2 size={15} className={styles.spin} /> : <Send size={15} />} Enviar a TikTok</button>}
              <button className={styles.secondary} disabled={busy === "generate"} onClick={() => void generate()}><Sparkles size={15} /> Regenerar</button>
            </div>
            {provider === "tiktok" && !connected && <p className={styles.notConnected}>Conecta TikTok para poder enviarlo directamente a la bandeja.</p>}
          </> : job ? <div className={styles.processingPreview}>
            <div className={styles.processingOrb}><Loader2 size={34} className={styles.spin} /></div>
            <span>RUNWAY · EN PROCESO</span>
            <b>{job.long_mode ? "Generando 2 escenas de 30 segundos" : `Generando vídeo de ${job.duration} segundos`}</b>
            <strong>{elapsedLabel(elapsedSeconds)}</strong>
            <p>{progress || "El panel está consultando el estado automáticamente."}</p>
            <div className={styles.miniTasks}>{job.task_ids.map((id, index) => { const state = taskStates.find((task) => task.id === id); const status = String(state?.status || "PENDING").toUpperCase(); return <div key={id}><span>{job.long_mode ? `ESCENA ${index + 1}` : "VÍDEO"}</span><b>{statusLabel(status)}</b>{status === "SUCCEEDED" ? <CheckCircle2 size={15} /> : <Loader2 size={15} className={styles.spin} />}</div>; })}</div>
          </div> : <div className={styles.emptyPreview}><div><Film size={36} /></div><b>Tu vídeo aparecerá aquí</b><span>Configura la idea, referencias y duración. El estudio guardará automáticamente el resultado en tu Biblioteca.</span></div>}
        </aside>
      </div>
    </div>
  );
}
