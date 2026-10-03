import "server-only";
import { randomUUID } from "crypto";
import { existsSync, promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { SocialProvider } from "@/lib/server/social-connections";

const BRAND_RULES = `
Marca: Tarot Celestial.
Idioma: español natural.
Identidad: premium, celestial, oscura, violeta, negro y dorado; elegante, cercana y visual.
Objetivo habitual: captar consultas, fidelizar y comunicar promociones de Tarot Celestial.
Reglas: nunca inventes precios, descuentos, minutos, promociones, fechas, teléfonos ni condiciones. Usa únicamente los datos explícitos del briefing o de la promoción seleccionada. Si un dato no está, no lo supongas.
Evita promesas garantizadas sobre adivinación, salud, dinero o resultados personales. Usa lenguaje de entretenimiento, orientación y experiencia.
Los captions deben ser publicables, claros, con CTA y hashtags relevantes sin spam.
`;

function apiKey() {
  const value = process.env.OPENAI_API_KEY?.trim();
  if (!value) throw new Error("Falta OPENAI_API_KEY en Vercel para usar el generador de IA.");
  return value;
}
function textModel() {
  return process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-5.6-luna";
}
function imageModel() {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2";
}
function runwayApiKey() {
  const value = process.env.RUNWAYML_API_SECRET?.trim() || process.env.RUNWAY_API_KEY?.trim();
  if (!value) throw new Error("Falta RUNWAYML_API_SECRET en Vercel para generar Reels automáticos con Runway.");
  return value;
}
function runwayModel() {
  return process.env.RUNWAY_VIDEO_MODEL?.trim() || "gen4.5";
}

const execFileAsync = promisify(execFile);

function ffmpegExecutable() {
  const explicit = process.env.FFMPEG_PATH?.trim();
  const candidates = [
    explicit,
    typeof ffmpegStatic === "string" ? ffmpegStatic : "",
    path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
    "/var/task/node_modules/ffmpeg-static/ffmpeg",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `FFMPEG_BINARY_NOT_FOUND. El binario de ffmpeg-static no está disponible en esta función de Vercel. Rutas comprobadas: ${candidates.join(", ")}`
  );
}

function storyMusicUrl() {
  return process.env.SOCIAL_STORY_AUDIO_URL?.trim() || "";
}

function storyMusicEnabled() {
  return /^(1|true|yes)$/i.test(process.env.SOCIAL_STORY_ENABLE_MUSIC?.trim() || "true");
}

function storyVideoDuration() {
  const n = Number(process.env.SOCIAL_STORY_VIDEO_DURATION || 7);
  return Number.isFinite(n) ? Math.max(5, Math.min(15, n)) : 7;
}

function storyMusicVolume() {
  const n = Number(process.env.SOCIAL_STORY_AUDIO_VOLUME || 0.75);
  return Number.isFinite(n) ? Math.max(0.1, Math.min(1.5, n)) : 0.75;
}

function shouldRenderStoryVideo(provider: SocialProvider, contentType?: string) {
  return provider === "instagram" && String(contentType || "").toLowerCase() === "story" && storyMusicEnabled() && Boolean(storyMusicUrl());
}

function extractResponseText(json: any) {
  if (typeof json?.output_text === "string" && json.output_text.trim()) return json.output_text;
  const texts: string[] = [];
  for (const item of json?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content?.text === "string") texts.push(content.text);
    }
  }
  return texts.join("\n").trim();
}

async function structuredResponse(name: string, schema: any, developer: string, user: string) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: textModel(),
      input: [
        { role: "developer", content: [{ type: "input_text", text: `${BRAND_RULES}\n${developer}` }] },
        { role: "user", content: [{ type: "input_text", text: user }] },
      ],
      text: { format: { type: "json_schema", name, strict: true, schema } },
    }),
  });
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || `OpenAI Responses API ${response.status}`);
  const text = extractResponseText(json);
  if (!text) throw new Error("OpenAI no devolvió contenido estructurado.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OpenAI devolvió una respuesta que no se pudo interpretar como plan social.");
  }
}

const itemProperties = {
  day_offset: { type: "integer", minimum: 0, maximum: 60 },
  time: { type: "string", pattern: "^[0-2][0-9]:[0-5][0-9]$" },
  content_type: { type: "string" },
  title: { type: "string" },
  hook: { type: "string" },
  caption: { type: "string" },
  hashtags: { type: "array", items: { type: "string" }, maxItems: 12 },
  cta: { type: "string" },
  visual_prompt: { type: "string" },
  reel_script: { type: "string" },
  requires_video: { type: "boolean" },
};

const singleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "content_type", "hook", "caption", "hashtags", "cta", "visual_prompt", "reel_script"],
  properties: {
    title: { type: "string" },
    content_type: { type: "string" },
    hook: { type: "string" },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" }, maxItems: 12 },
    cta: { type: "string" },
    visual_prompt: { type: "string" },
    reel_script: { type: "string" },
  },
};

const seriesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["strategy_summary", "items"],
  properties: {
    strategy_summary: { type: "string" },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "content_type", "hook", "caption", "hashtags", "cta", "visual_prompt", "reel_script"],
        properties: {
          title: { type: "string" },
          content_type: { type: "string" },
          hook: { type: "string" },
          caption: { type: "string" },
          hashtags: { type: "array", items: { type: "string" }, maxItems: 12 },
          cta: { type: "string" },
          visual_prompt: { type: "string" },
          reel_script: { type: "string" },
        },
      },
    },
  },
};

const weekSchema = {
  type: "object",
  additionalProperties: false,
  required: ["strategy_summary", "items"],
  properties: {
    strategy_summary: { type: "string" },
    items: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day_offset", "time", "content_type", "title", "hook", "caption", "hashtags", "cta", "visual_prompt", "reel_script", "requires_video"],
        properties: itemProperties,
      },
    },
  },
};

const flexiblePlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["strategy_summary", "items"],
  properties: {
    strategy_summary: { type: "string" },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 120,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day_offset", "time", "content_type", "title", "hook", "caption", "hashtags", "cta", "visual_prompt", "reel_script", "requires_video"],
        properties: itemProperties,
      },
    },
  },
};

export async function generateSingleSocialContent(input: {
  provider: SocialProvider;
  contentType: string;
  brief: string;
  objective?: string;
  tone?: string;
  cta?: string;
  campaign?: any;
}) {
  const allowed = input.provider === "instagram" ? "post, reel, story, carousel" : "video, photo";
  return structuredResponse(
    "tarot_celestial_social_post",
    singleSchema,
    `Crea una pieza para ${input.provider}. Formatos permitidos: ${allowed}. Si se pide Reel/vídeo, devuelve también un guion accionable; si es imagen, reel_script puede quedar vacío. El visual_prompt debe describir una creatividad lista para generar con IA, sin inventar datos comerciales. Si el formato es story, el visual_prompt debe pedir una historia vertical 9:16 muy llamativa, bien encuadrada, con tipografía grande y legible, jerarquía clara, composición completa hasta el borde, sin cajas vacías ni huecos innecesarios, y con márgenes seguros para la interfaz de Instagram. Hazla visualmente más premium, magnética y moderna, con composición impactante, brillo sutil, jerarquía fuerte, CTA integrado dentro de la pieza y aspecto muy compartible. IMPORTANTE: en las stories todo el mensaje debe ir integrado dentro de la imagen; no dependas de texto externo. Para stories devuelve caption="" y cta="" salvo que el usuario pida explícitamente un texto aparte. Si el formato es post, debe ser visualmente potente y de alto contraste.` ,
    JSON.stringify(input),
  );
}

export async function generateSocialSeries(input: {
  provider: SocialProvider;
  contentType: string;
  brief: string;
  objective?: string;
  tone?: string;
  cta?: string;
  piecesCount: number;
  campaign?: any;
}) {
  const allowed = input.provider === "instagram" ? "post, reel, story, carousel" : "video, photo";
  const piecesCount = Math.max(1, Math.min(20, Number(input.piecesCount || 1)));
  return structuredResponse(
    "tarot_celestial_social_series",
    seriesSchema,
    `Crea una serie de ${piecesCount} piezas para ${input.provider}. Formatos permitidos: ${allowed}. Todas las piezas deben compartir coherencia de estilo y tema, pero no duplicarse. Cada pieza debe aportar un ángulo distinto. Si el usuario pide una serie sobre horóscopos, signos o zodiaco, reparte bien la serie entre signos, grupos de signos, elementos o ideas complementarias para que parezca una colección real. Si se piden stories, el visual_prompt de cada pieza debe pedir una historia vertical 9:16 muy llamativa, bien encuadrada, con tipografía grande y legible, jerarquía clara, composición completa hasta el borde, sin cajas vacías ni huecos innecesarios, y con márgenes seguros para la interfaz de Instagram. Hazla visualmente más premium, magnética y moderna, con composición impactante, brillo sutil, jerarquía fuerte, CTA integrado dentro de la pieza y aspecto muy compartible. IMPORTANTE: en las stories todo el mensaje debe ir integrado dentro de la imagen; no dependas de texto externo. Para stories devuelve caption="" y cta="" salvo que el usuario pida explícitamente un texto aparte. Si se piden reels/vídeos, cada reel_script debe ser accionable y visualmente potente.`,
    JSON.stringify({ ...input, piecesCount }),
  );
}

export async function generateSocialWeek(input: {
  provider: SocialProvider;
  brief: string;
  objective?: string;
  preferredTime?: string;
  mode?: "automatic" | "mixed";
  campaign?: any;
}) {
  const automatic = input.mode !== "mixed";
  const formatRule = input.provider === "instagram"
    ? automatic
      ? "Usa solo post o story con imagen estática para que todo pueda programarse automáticamente."
      : "Combina post, story y reel. Los reels deben marcar requires_video=true y llevar guion."
    : automatic
      ? "Usa solo photo para que todo pueda programarse automáticamente con imágenes generadas."
      : "Combina photo y video. Los vídeos deben marcar requires_video=true y llevar guion.";
  return structuredResponse(
    "tarot_celestial_social_week",
    weekSchema,
    `Diseña exactamente 7 piezas, una por día, day_offset 0..6 sin repetir. ${formatRule} Usa una estrategia equilibrada: valor, interacción, prueba social/branding, promoción cuando el briefing la incluya y CTA. Hora preferida: ${input.preferredTime || "19:30"}.`,
    JSON.stringify(input),
  );
}

function validateFlexiblePlan(result: any, input: { days: number; postsPerDay: number; reelsPerDay: number; storiesPerDay: number }) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const expectedTotal = input.days * (input.postsPerDay + input.reelsPerDay + input.storiesPerDay);
  if (items.length !== expectedTotal) throw new Error(`La IA devolvió ${items.length} piezas y se esperaban exactamente ${expectedTotal}. Vuelve a intentarlo.`);
  for (let day = 0; day < input.days; day += 1) {
    const dayItems = items.filter((item: any) => Number(item?.day_offset) === day);
    const count = (type: string) => dayItems.filter((item: any) => String(item?.content_type || "") === type).length;
    if (count("post") !== input.postsPerDay) throw new Error(`El día ${day + 1} no tiene exactamente ${input.postsPerDay} publicaciones.`);
    if (count("reel") !== input.reelsPerDay) throw new Error(`El día ${day + 1} no tiene exactamente ${input.reelsPerDay} reels.`);
    if (count("story") !== input.storiesPerDay) throw new Error(`El día ${day + 1} no tiene exactamente ${input.storiesPerDay} stories.`);
  }
  return result;
}

export async function generateSocialCalendarPlan(input: {
  provider: SocialProvider;
  brief: string;
  objective?: string;
  preferredTime?: string;
  days: number;
  postsPerDay: number;
  reelsPerDay: number;
  storiesPerDay: number;
  campaign?: any;
}) {
  const days = Math.max(1, Math.min(90, Number(input.days || 7)));
  const postsPerDay = Math.max(0, Math.min(6, Number(input.postsPerDay || 0)));
  const reelsPerDay = Math.max(0, Math.min(6, Number(input.reelsPerDay || 0)));
  const storiesPerDay = Math.max(0, Math.min(10, Number(input.storiesPerDay || 0)));
  const total = days * (postsPerDay + reelsPerDay + storiesPerDay);
  if (input.provider !== "instagram") throw new Error("El planificador flexible está preparado para Instagram.");
  if (total <= 0) throw new Error("Indica al menos una pieza por día.");
  if (total > 120) throw new Error("El máximo permitido por plan es 120 piezas. Reduce días o cantidades por día.");

  const result = await structuredResponse(
    "tarot_celestial_social_calendar_plan",
    flexiblePlanSchema,
    `Diseña un calendario exacto para Instagram.
Devuelve exactamente ${total} piezas.
Días cubiertos: day_offset 0..${days - 1}.
Cada día debe incluir exactamente:
- ${postsPerDay} piezas con content_type="post" y requires_video=false.
- ${reelsPerDay} piezas con content_type="reel" y requires_video=true.
- ${storiesPerDay} piezas con content_type="story" y requires_video=false.
No inventes formatos extra ni cambies las cantidades.
Asigna horas realistas sin repetir dentro del mismo día. Las stories pueden ir antes, los posts a media mañana/tarde y los reels a tarde/noche.
Hora orientativa base: ${input.preferredTime || "19:30"}.
Cada caption debe ser listo para publicar, excepto en stories donde debe ir vacío salvo necesidad explícita del briefing. El visual_prompt debe servir para generar una imagen estática. En stories, todo el texto principal debe ir integrado visualmente en la propia imagen. En los reels, el reel_script debe ser completo y accionable para Runway.`,
    JSON.stringify({ ...input, days, postsPerDay, reelsPerDay, storiesPerDay, total }),
  );

  return validateFlexiblePlan(result, { days, postsPerDay, reelsPerDay, storiesPerDay });
}

async function generateImageBase64(prompt: string, size: string, quality: string) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: imageModel(),
      prompt,
      size,
      quality,
      output_format: "png",
    }),
  });
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message || `OpenAI Images API ${response.status}`);
  const b64 = json?.data?.[0]?.b64_json;
  if (b64) return Buffer.from(b64, "base64");
  const url = json?.data?.[0]?.url;
  if (url) {
    const asset = await fetch(url);
    if (!asset.ok) throw new Error("OpenAI generó la imagen pero no se pudo descargar.");
    return Buffer.from(await asset.arrayBuffer());
  }
  throw new Error("OpenAI no devolvió la imagen generada.");
}

async function downloadBuffer(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo descargar el archivo generado (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function renderStoryVideoFromImage(imageBuffer: Buffer) {
  const music = storyMusicUrl();
  if (!music) return null;
  const audioBuffer = await downloadBuffer(music);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tc-story-"));
  const imagePath = path.join(tempDir, "story.png");
  const audioPath = path.join(tempDir, "music.mp3");
  const outputPath = path.join(tempDir, "story.mp4");
  await fs.writeFile(imagePath, imageBuffer);
  await fs.writeFile(audioPath, audioBuffer);
  const duration = storyVideoDuration();
  const fps = 25;
  const frames = duration * fps;
  const filter = [
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920`,
    `zoompan=z='min(zoom+0.0009,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${fps}`,
    `format=yuv420p`
  ].join(',');
  try {
    await execFileAsync(ffmpegExecutable(), [
      "-y",
      "-loop", "1",
      "-i", imagePath,
      "-i", audioPath,
      "-t", String(duration),
      "-vf", filter,
      "-af", `volume=${storyMusicVolume()}`,
      "-r", String(fps),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "160k",
      "-shortest",
      outputPath,
    ]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

export async function generateAndStoreSocialImage(input: {
  provider: SocialProvider;
  prompt: string;
  label?: string;
  format?: "square" | "vertical" | "landscape";
  quality?: "low" | "medium" | "high";
  contentType?: string;
  createdBy?: string | null;
}) {
  const size = input.format === "landscape" ? "1536x1024" : input.format === "vertical" ? "1024x1536" : "1024x1024";
  const quality = input.quality || "medium";
  const isStory = String(input.contentType || "").toLowerCase() === "story";
  const formatPrompt = isStory
    ? "Es una historia de Instagram final. Debe ser 9:16, con gancho inmediato, estética premium, composición centrada y muy llamativa, texto grande y perfectamente legible, CTA integrado en la imagen, sin huecos vacíos y con margen seguro para la interfaz superior e inferior de Instagram."
    : "Composición profesional para redes sociales.";
  const enhancedPrompt = `${BRAND_RULES}
Genera SOLO la pieza visual. ${formatPrompt} ${input.prompt}
Si incluyes texto, debe ser corto, en español y perfectamente legible. No inventes precios ni promociones que no aparezcan literalmente en el prompt.`;
  const buffer = await generateImageBase64(enhancedPrompt, size, quality);
  const bucket = process.env.SOCIAL_MEDIA_BUCKET?.trim() || "tc-social-media";
  const db = supabaseAdmin();
  const basePath = `${input.provider}/ai/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
  const imagePath = `${basePath}.png`;
  const { error: uploadError } = await db.storage.from(bucket).upload(imagePath, buffer, {
    contentType: "image/png",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) throw new Error(`No se pudo guardar la imagen IA en Supabase Storage: ${uploadError.message}`);
  const { data: publicData } = db.storage.from(bucket).getPublicUrl(imagePath);
  const imageUrl = publicData?.publicUrl;
  if (!imageUrl) throw new Error("Supabase no devolvió URL pública para la imagen IA.");

  if (shouldRenderStoryVideo(input.provider, input.contentType)) {
    const videoBuffer = await renderStoryVideoFromImage(buffer);
    if (videoBuffer) {
      const videoPath = `${basePath}.mp4`;
      const { error: videoUploadError } = await db.storage.from(bucket).upload(videoPath, videoBuffer, {
        contentType: "video/mp4",
        cacheControl: "31536000",
        upsert: false,
      });
      if (videoUploadError) throw new Error(`No se pudo guardar la story con música en Supabase Storage: ${videoUploadError.message}`);
      const { data: videoPublicData } = db.storage.from(bucket).getPublicUrl(videoPath);
      const videoUrl = videoPublicData?.publicUrl;
      if (!videoUrl) throw new Error("Supabase no devolvió URL pública para la story con música.");
      await db.from("tc_social_library").insert({
        provider: input.provider,
        label: input.label || "Story IA con música",
        media_type: "video",
        url: videoUrl,
        thumbnail_url: imageUrl,
        mime_type: "video/mp4",
        metadata: { ai_generated: true, model: imageModel(), prompt: input.prompt, format: input.format || "vertical", quality, engine: "openai+ffmpeg", story_music: true, story_music_url: storyMusicUrl(), duration: storyVideoDuration() },
        created_by: input.createdBy || null,
      });
      return { url: videoUrl, path: videoPath, bucket, model: imageModel(), media_type: "video", thumbnail_url: imageUrl, story_music: true, duration: storyVideoDuration() };
    }
  }

  await db.from("tc_social_library").insert({
    provider: input.provider,
    label: input.label || "Creatividad IA",
    media_type: "image",
    url: imageUrl,
    thumbnail_url: imageUrl,
    mime_type: "image/png",
    metadata: { ai_generated: true, model: imageModel(), prompt: input.prompt, format: input.format || "square", quality, engine: "openai" },
    created_by: input.createdBy || null,
  });
  return { url: imageUrl, path: imagePath, bucket, model: imageModel(), media_type: "image", thumbnail_url: imageUrl, story_music: false };
}

async function runwayRequest(pathname: string, init?: RequestInit) {
  const response = await fetch(`https://api.dev.runwayml.com${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${runwayApiKey()}`,
      "X-Runway-Version": "2024-11-06",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message || json?.message || json?.error || `Runway API ${response.status}`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return json;
}

async function waitForRunwayTask(taskId: string, timeoutMs = 260000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const task = await runwayRequest(`/v1/tasks/${encodeURIComponent(taskId)}`);
    const status = String(task?.status || "").toUpperCase();
    if (status === "SUCCEEDED") return task;
    if (["FAILED", "CANCELED", "CANCELLED"].includes(status)) {
      const reason = task?.failure || task?.failureCode || task?.error || `Runway terminó con estado ${status}`;
      throw new Error(typeof reason === "string" ? reason : JSON.stringify(reason));
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Runway sigue procesando el vídeo y superó el tiempo máximo de espera. Inténtalo de nuevo en unos minutos.");
}



type TarotStudioModel = "wan3" | "seedance2_5" | "gen4.5";
type TarotStudioResolution = "480p" | "720p" | "1080p";
type TarotStudioFormat = "vertical" | "landscape";

const tarotVideoPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "master_prompt", "scene_1_prompt", "scene_2_prompt", "scene_1_audio", "scene_2_audio"],
  properties: {
    title: { type: "string" },
    master_prompt: { type: "string", maxLength: 700 },
    scene_1_prompt: { type: "string", maxLength: 1500 },
    scene_2_prompt: { type: "string", maxLength: 1500 },
    scene_1_audio: { type: "string", maxLength: 1800 },
    scene_2_audio: { type: "string", maxLength: 1800 },
  },
};

function studioModel(value: unknown): TarotStudioModel {
  const model = String(value || "wan3");
  return model === "seedance2_5" || model === "gen4.5" ? model : "wan3";
}

function studioDuration(model: TarotStudioModel, value: unknown, longMode: boolean) {
  if (longMode) {
    if (model === "gen4.5") throw new Error("Gen-4.5 no admite el modo de 60 segundos. Usa WAN 3.0 o Seedance 2.5.");
    return 60;
  }
  const raw = Math.round(Number(value || 10));
  const min = model === "seedance2_5" ? 4 : 2;
  const max = model === "gen4.5" ? 10 : 30;
  return Math.max(min, Math.min(max, raw));
}

function studioRatio(model: TarotStudioModel, format: TarotStudioFormat, resolution: TarotStudioResolution) {
  if (model === "gen4.5") return format === "landscape" ? "1280:720" : "720:1280";
  if (resolution === "1080p") return format === "landscape" ? "1920:1080" : "1080:1920";
  if (resolution === "480p") {
    // WAN 3.0 and Seedance 2.5 use different documented 480p dimensions.
    if (model === "wan3") return format === "landscape" ? "832:480" : "480:832";
    return format === "landscape" ? "854:480" : "480:854";
  }
  return format === "landscape" ? "1280:720" : "720:1280";
}

function studioCredits(model: TarotStudioModel, resolution: TarotStudioResolution, seconds: number) {
  const table: Record<TarotStudioModel, Record<TarotStudioResolution, number>> = {
    wan3: { "480p": 5, "720p": 10, "1080p": 20 },
    seedance2_5: { "480p": 20, "720p": 30, "1080p": 68 },
    "gen4.5": { "480p": 12, "720p": 12, "1080p": 12 },
  };
  const raw = table[model][model === "gen4.5" ? "720p" : resolution] * seconds;
  if (model === "seedance2_5") return Math.max(seconds > 30 ? 160 : 80, raw);
  return raw;
}

async function buildTarotVideoPlan(input: {
  brief: string;
  contentType: string;
  mood: string;
  camera: string;
  pace: string;
  advanced?: string;
  format: TarotStudioFormat;
  duration: number;
  longMode: boolean;
  referenceCount: number;
  audioEnabled: boolean;
  audioDirection?: string;
}) {
  return structuredResponse(
    "tarot_celestial_video_direction",
    tarotVideoPlanSchema,
    `Actúas como director creativo y director de fotografía especializado EXCLUSIVAMENTE en vídeos de tarot para Tarot Celestial.
Convierte el briefing en instrucciones visuales precisas para un generador de vídeo. La prioridad es conseguir movimiento humano natural, manos anatómicamente coherentes, cartas de tarot creíbles, continuidad de vestuario/escenario y una estética premium realista.
Identidad visual habitual: negro, violeta profundo, azul noche y dorado; velas, mesa de tarot, humo muy sutil, cristales o elementos celestiales solo cuando encajen. Evita que todo parezca fantasía artificial: debe poder parecer contenido real de una marca premium de tarot.
No inventes precios, promociones, teléfonos ni condiciones. No prometas resultados adivinatorios garantizados. Evita texto generado dentro del vídeo salvo que el usuario lo pida expresamente, porque el texto de modelos de vídeo puede salir ilegible.
Describe con precisión sujeto, escenario, luz, óptica/cámara, movimiento corporal, manos, cartas, ritmo y transición final.
Si hay referencias visuales, indica que deben conservar identidad, rasgos, ropa, cartas, mesa, iluminación o estilo según lo que sea visible.
Si audioEnabled es true, integra también la dirección sonora en los prompts: ambiente realista, efectos coherentes y cualquier diálogo pedido por el usuario. No inventes frases habladas si el usuario no las ha solicitado. Respeta audioDirection. Para piezas de 60 s, mantén continuidad de ambiente, voz, intensidad y paisaje sonoro entre escena 1 y escena 2.

REGLAS ESTRICTAS PARA MODO 60 s:
- Son DOS clips técnicos de 30 s, pero narrativamente deben ser UNA SOLA GRABACIÓN de 60 s.
- master_prompt SOLO puede contener identidad visual, sujeto, vestuario, escenario, iluminación, cámara, tono y reglas de continuidad. NO metas en master_prompt el guion hablado completo, la cronología completa ni acciones que puedan repetirse en ambas escenas.
- scene_1_prompt contiene EXCLUSIVAMENTE lo que ocurre y se dice entre 0:00 y 0:30.
- scene_2_prompt contiene EXCLUSIVAMENTE lo que ocurre y se dice entre 0:30 y 1:00. Nunca repitas una frase, introducción, revelación, extracción de carta o acción ya ejecutada en scene_1_prompt.
- Si el briefing o advanced incluye un guion completo de 60 s, DIVÍDELO en dos mitades naturales. La escena 2 debe empezar por la frase siguiente a la última frase de la escena 1, nunca desde el principio.
- La escena 1 debe terminar en una postura/acción que pueda continuar físicamente. La escena 2 debe comenzar desde ESA MISMA postura, no desde una pose inicial.
- Si una carta ya fue revelada en la escena 1, en escena 2 esa carta YA ESTÁ REVELADA y permanece siendo la misma. No volver a barajar, sacar, girar ni revelar otra vez.
- El primer fotograma real de la escena 2 será aportado por el sistema a partir del último fotograma de la escena 1; escribe scene_2_prompt asumiendo que esa continuidad visual ya existe.
- En escena 2 usa verbos de continuidad: “continúa hablando”, “mantiene la carta”, “prosigue el gesto”; evita “empieza”, “saca”, “presenta de nuevo”, “revela”.
- Para voz: scene_1_prompt y scene_2_prompt deben incluir únicamente las frases habladas de su mitad. No duplicar saludo, introducción ni consejo.
- scene_1_audio contiene SOLO la dirección sonora y el diálogo que debe oírse entre 0:00 y 0:30.
- scene_2_audio contiene SOLO la dirección sonora y el diálogo que debe oírse entre 0:30 y 1:00. Debe continuar con la misma voz, pero NO puede repetir ninguna frase de scene_1_audio.
- Si audioDirection contiene un guion o frases habladas, DIVÍDELO entre scene_1_audio y scene_2_audio; nunca copies audioDirection completo en ambas escenas.
- Si audioEnabled es false, scene_1_audio y scene_2_audio deben ser cadenas vacías.
- El acento, timbre y estilo de voz sí deben conservarse entre ambas escenas; el texto hablado NO.

Mantén master_prompt por debajo de 700 caracteres y cada prompt de escena por debajo de 1500 caracteres: prioriza acciones, diálogo exacto y continuidad sobre adjetivos redundantes.
Devuelve master_prompt como dirección global compacta; scene_1_prompt y scene_2_prompt deben ser prompts autónomos y no redundantes. En modo corto, scene_2_prompt debe ser cadena vacía y scene_2_audio también.`,
    JSON.stringify(input),
  );
}

function runwayOutputUrl(task: any) {
  const firstOutput = Array.isArray(task?.output) ? task.output[0] : null;
  return typeof firstOutput === "string"
    ? firstOutput
    : (firstOutput?.url || firstOutput?.uri || firstOutput?.src || null);
}

async function createStudioRunwayTask(input: {
  model: TarotStudioModel;
  prompt: string;
  duration: number;
  ratio: string;
  resolution: TarotStudioResolution;
  referenceUrls: string[];
  useFirstFrame?: boolean;
  audioEnabled?: boolean;
  audioDirection?: string;
}) {
  const refs = input.referenceUrls.filter((x) => /^https:\/\//i.test(x)).slice(0, input.model === "gen4.5" ? 1 : 10);
  const promptLimit = input.model === "gen4.5" ? 1000 : input.model === "wan3" ? 2500 : 15000;
  const audioDirection = String(input.audioDirection || "").trim();
  const audioSuffix = input.audioEnabled && input.model !== "gen4.5"
    ? `\nAUDIO NATIVO: genera una pista sonora sincronizada con la escena. ${audioDirection || "Ambiente místico realista, efectos naturales de la escena y sin voces aleatorias."}`
    : "";
  const audioBudget = Math.min(audioSuffix.length, Math.floor(promptLimit * 0.35));
  const visualBudget = Math.max(400, promptLimit - audioBudget);
  const promptText = `${input.prompt.slice(0, visualBudget)}${audioSuffix.slice(0, audioBudget)}`.slice(0, promptLimit);

  if (input.model === "gen4.5") {
    const body: Record<string, any> = {
      model: "gen4.5",
      promptText,
      ratio: input.ratio,
      duration: input.duration,
    };
    if (refs[0]) {
      body.promptImage = refs[0];
      return runwayRequest("/v1/image_to_video", { method: "POST", body: JSON.stringify(body) });
    }
    return runwayRequest("/v1/text_to_video", { method: "POST", body: JSON.stringify(body) });
  }

  if (input.useFirstFrame && refs[0]) {
    const keyframeRatio = input.model === "wan3" ? `auto_${input.resolution}` : input.ratio;
    return runwayRequest("/v1/image_to_video", {
      method: "POST",
      body: JSON.stringify({
        model: input.model,
        promptText,
        promptImage: refs[0],
        ratio: keyframeRatio,
        duration: input.duration,
        audio: Boolean(input.audioEnabled),
      }),
    });
  }

  const body: Record<string, any> = {
    model: input.model,
    promptText,
    ratio: input.ratio,
    duration: input.duration,
    audio: Boolean(input.audioEnabled),
  };
  // Direct Runway video endpoints use `references` for image references.
  if (refs.length) body.references = refs.map((uri) => ({ uri }));
  return runwayRequest("/v1/text_to_video", { method: "POST", body: JSON.stringify(body) });
}

async function extractAndStoreStudioContinuityFrame(input: {
  provider: SocialProvider;
  videoUrl: string;
}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tc-video-continuity-"));
  try {
    const inputPath = path.join(tempDir, "scene-1.mp4");
    const framePath = path.join(tempDir, "scene-1-last-frame.jpg");
    await fs.writeFile(inputPath, await downloadBuffer(input.videoUrl));

    try {
      // Tomamos un fotograma apenas antes del final para evitar frames negros de cierre.
      await execFileAsync(ffmpegExecutable(), [
        "-y", "-sseof", "-0.20", "-i", inputPath,
        "-frames:v", "1", "-q:v", "2", framePath,
      ]);
    } catch (error: any) {
      throw new Error(`No se pudo extraer el último fotograma de la escena 1 para encadenar la escena 2. ${error?.message || ""}`.trim());
    }

    const frame = await fs.readFile(framePath);
    const bucket = process.env.SOCIAL_MEDIA_BUCKET?.trim() || "tc-social-media";
    const db = supabaseAdmin();
    const storagePath = `${input.provider}/ai-studio/continuity/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.jpg`;
    const { error } = await db.storage.from(bucket).upload(storagePath, frame, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw new Error(`No se pudo guardar el fotograma de continuidad: ${error.message}`);
    const { data } = db.storage.from(bucket).getPublicUrl(storagePath);
    if (!data?.publicUrl) throw new Error("Supabase no devolvió URL pública para el fotograma de continuidad.");
    return data.publicUrl;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

function studioStorageTargetBytes() {
  // Mantener el MP4 final claramente por debajo del límite habitual de 50 MB
  // de Supabase Free. Se puede subir este objetivo en Vercel con
  // SOCIAL_VIDEO_TARGET_MB si el proyecto/bucket permite archivos mayores.
  const requestedMb = Number(process.env.SOCIAL_VIDEO_TARGET_MB || 32);
  const safeMb = Number.isFinite(requestedMb) ? Math.max(12, Math.min(200, requestedMb)) : 32;
  return Math.floor(safeMb * 1_000_000);
}

function parseStorageLimitBytes(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const raw = String(value || "").trim();
  if (!raw) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB)$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2].toUpperCase();
  const multiplier = unit === "GB" ? 1_000_000_000 : unit === "MB" ? 1_000_000 : 1_000;
  return Math.floor(amount * multiplier);
}

async function resolveStudioStorageTargetBytes(db: any, bucket: string) {
  const configuredTarget = studioStorageTargetBytes();
  try {
    const { data } = await db.storage.getBucket(bucket);
    const bucketLimit = parseStorageLimitBytes(data?.file_size_limit ?? data?.fileSizeLimit);
    if (bucketLimit > 0) {
      // Dejamos un 20 % de margen para no chocar contra el límite exacto del bucket.
      return Math.max(8_000_000, Math.min(configuredTarget, Math.floor(bucketLimit * 0.8)));
    }
  } catch {
    // Si no podemos leer la configuración del bucket, usamos el objetivo seguro local.
  }
  return configuredTarget;
}

function studioTargetVideoBitrateKbps(durationSeconds: number, targetBytes: number) {
  // Reservamos margen para audio, cabeceras MP4 y pequeñas variaciones del encoder.
  const duration = Math.max(1, durationSeconds);
  const totalKbps = Math.floor((targetBytes * 8) / duration / 1000);
  return Math.max(900, Math.min(8_000, totalKbps - 320));
}

async function stitchStudioVideos(urls: string[], durationSeconds: number, targetBytes: number) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tc-video-studio-"));
  const paths: string[] = [];
  try {
    for (let i = 0; i < urls.length; i += 1) {
      const inputPath = path.join(tempDir, `scene-${i + 1}.mp4`);
      await fs.writeFile(inputPath, await downloadBuffer(urls[i]));
      paths.push(inputPath);
    }

    const outputPath = path.join(tempDir, "final.mp4");

    if (paths.length === 1) {
      const original = await fs.readFile(paths[0]);
      if (original.byteLength <= targetBytes) {
        return { buffer: original, originalBytes: original.byteLength, finalBytes: original.byteLength, optimized: false };
      }

      const videoKbps = studioTargetVideoBitrateKbps(durationSeconds, targetBytes);
      try {
        await execFileAsync(ffmpegExecutable(), [
          "-y", "-i", paths[0],
          "-c:v", "libx264", "-preset", "veryfast",
          "-b:v", `${videoKbps}k`, "-maxrate", `${videoKbps}k`, "-bufsize", `${videoKbps * 2}k`,
          "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "128k",
          "-movflags", "+faststart",
          outputPath,
        ]);
      } catch (error: any) {
        throw new Error(`El vídeo se generó correctamente, pero FFmpeg no pudo optimizarlo para Supabase Storage. ${error?.message || ""}`.trim());
      }

      const optimized = await fs.readFile(outputPath);
      return { buffer: optimized, originalBytes: original.byteLength, finalBytes: optimized.byteLength, optimized: true };
    }

    const listPath = path.join(tempDir, "concat.txt");
    const copyPath = path.join(tempDir, "joined-copy.mp4");
    const quoteForConcat = (value: string) => value.replace(/'/g, "'\\''");
    await fs.writeFile(listPath, paths.map((x) => `file '${quoteForConcat(x)}'`).join("\n"));

    // Primero intentamos concatenación sin recodificar: es rápida y conserva calidad.
    // Si el resultado supera el objetivo seguro para Storage, recodificamos después.
    let originalBytes = 0;
    try {
      await execFileAsync(ffmpegExecutable(), [
        "-y", "-f", "concat", "-safe", "0", "-i", listPath,
        "-c", "copy", "-movflags", "+faststart", copyPath,
      ]);
      const stat = await fs.stat(copyPath);
      originalBytes = stat.size;
      if (stat.size <= targetBytes) {
        const buffer = await fs.readFile(copyPath);
        return { buffer, originalBytes: stat.size, finalBytes: stat.size, optimized: false };
      }
    } catch {
      // Si los clips no son compatibles con stream-copy, continuamos directamente
      // con una recodificación uniforme.
    }

    const videoKbps = studioTargetVideoBitrateKbps(durationSeconds, targetBytes);
    try {
      await execFileAsync(ffmpegExecutable(), [
        "-y", "-f", "concat", "-safe", "0", "-i", listPath,
        "-c:v", "libx264", "-preset", "veryfast",
        "-b:v", `${videoKbps}k`, "-maxrate", `${videoKbps}k`, "-bufsize", `${videoKbps * 2}k`,
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        outputPath,
      ]);
    } catch (error: any) {
      throw new Error(`No se pudieron unir y optimizar las escenas con FFmpeg (${ffmpegExecutable()}). ${error?.message || ""}`.trim());
    }

    const buffer = await fs.readFile(outputPath);
    if (buffer.byteLength > targetBytes * 1.08) {
      throw new Error(
        `El montaje final ocupa ${(buffer.byteLength / 1_000_000).toFixed(1)} MB tras optimizarlo. ` +
        `Reduce SOCIAL_VIDEO_TARGET_MB o aumenta el límite del bucket de Supabase.`
      );
    }
    return { buffer, originalBytes: originalBytes || buffer.byteLength, finalBytes: buffer.byteLength, optimized: true };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

export async function startTarotVideoStudio(input: {
  provider: SocialProvider;
  model?: string;
  duration?: number;
  longMode?: boolean;
  format?: TarotStudioFormat;
  resolution?: TarotStudioResolution;
  brief: string;
  contentType?: string;
  mood?: string;
  camera?: string;
  pace?: string;
  advanced?: string;
  referenceUrls?: string[];
  useFirstFrame?: boolean;
  audioEnabled?: boolean;
  audioDirection?: string;
  audioScene1?: string;
  audioScene2?: string;
  createdBy?: string | null;
}) {
  const model = studioModel(input.model);
  const longMode = Boolean(input.longMode);
  const duration = studioDuration(model, input.duration, longMode);
  const format: TarotStudioFormat = input.format === "landscape" ? "landscape" : "vertical";
  const resolution: TarotStudioResolution = model === "gen4.5"
    ? "720p"
    : input.resolution === "480p" || input.resolution === "1080p" ? input.resolution : "720p";
  const referenceUrls = Array.isArray(input.referenceUrls) ? input.referenceUrls.filter(Boolean).slice(0, 10) : [];
  const ratio = studioRatio(model, format, resolution);
  const audioEnabled = model !== "gen4.5" && input.audioEnabled !== false;
  const audioDirection = audioEnabled ? String(input.audioDirection || "").trim().slice(0, 2000) : "";
  const plan = await buildTarotVideoPlan({
    brief: input.brief.slice(0, 6000),
    contentType: input.contentType || "lectura_tarot",
    mood: input.mood || "místico premium, oscuro, violeta y dorado",
    camera: input.camera || "acercamiento cinematográfico suave",
    pace: input.pace || "elegante y magnético",
    advanced: input.advanced || "",
    format,
    duration,
    longMode,
    referenceCount: referenceUrls.length,
    audioEnabled,
    audioDirection,
  });

  const globalVisualDirection = `VIDEO TAROT CELESTIAL · DIRECCIÓN GLOBAL. ${plan.master_prompt}`;
  const scene1Prompt = longMode
    ? `${globalVisualDirection}\nESCENA 1/2 · SOLO 0:00–0:30. Ejecuta únicamente esta primera mitad. NO adelantes ni repitas contenido de la segunda mitad. ${plan.scene_1_prompt}`
    : `${globalVisualDirection}\n${plan.scene_1_prompt}`;

  const clipDuration = longMode ? 30 : duration;
  // En 60 s se crea SOLO la escena 1. La escena 2 se crea después, usando el
  // último fotograma REAL de la escena 1 como promptImage. Esto evita que Runway
  // interprete dos prompts paralelos como dos vídeos que empiezan desde cero.
  const scene1AudioDirection = audioEnabled
    ? String(plan.scene_1_audio || audioDirection || "").trim().slice(0, 1800)
    : "";
  const scene2AudioDirection = audioEnabled
    ? String(plan.scene_2_audio || "").trim().slice(0, 1800)
    : "";

  const scene1Task = await createStudioRunwayTask({
    model,
    prompt: scene1Prompt,
    duration: clipDuration,
    ratio,
    resolution,
    referenceUrls,
    useFirstFrame: Boolean(input.useFirstFrame) && Boolean(referenceUrls[0]),
    audioEnabled,
    audioDirection: scene1AudioDirection,
  });
  const scene1TaskId = String(scene1Task?.id || "").trim();
  if (!scene1TaskId) throw new Error("Runway no devolvió el identificador de la escena 1.");

  return {
    job_id: randomUUID(),
    provider: input.provider,
    started_at: new Date().toISOString(),
    title: String(plan.title || "Vídeo Tarot Celestial IA"),
    model,
    duration,
    format,
    resolution,
    ratio,
    long_mode: longMode,
    credits_estimate: studioCredits(model, resolution, duration),
    prompt: String(plan.master_prompt || ""),
    prompt_scene_1: String(plan.scene_1_prompt || ""),
    prompt_scene_2: String(plan.scene_2_prompt || ""),
    task_ids: [scene1TaskId],
    reference_urls: referenceUrls,
    use_first_frame: Boolean(input.useFirstFrame),
    audio_enabled: audioEnabled,
    audio_direction: audioDirection,
    audio_scene_1: scene1AudioDirection,
    audio_scene_2: scene2AudioDirection,
    continuity_frame_url: null,
    chained_generation: longMode,
  };
}

export async function continueTarotVideoStudio(input: {
  provider: SocialProvider;
  scene1TaskId: string;
  model?: string;
  resolution?: TarotStudioResolution;
  ratio?: string;
  promptScene2: string;
  audioEnabled?: boolean;
  audioDirection?: string;
  audioScene2?: string;
}) {
  const scene1TaskId = String(input.scene1TaskId || "").trim();
  if (!scene1TaskId) throw new Error("Falta la tarea de la escena 1 para crear la continuidad.");

  const scene1Task = await runwayRequest(`/v1/tasks/${encodeURIComponent(scene1TaskId)}`);
  const scene1Status = String(scene1Task?.status || "").toUpperCase();
  if (scene1Status !== "SUCCEEDED") {
    throw new Error(`La escena 1 todavía no está terminada. Estado: ${scene1Status || "PENDING"}.`);
  }
  const scene1OutputUrl = String(runwayOutputUrl(scene1Task) || "").trim();
  if (!scene1OutputUrl) throw new Error("Runway terminó la escena 1 pero no devolvió su vídeo.");

  const model = studioModel(input.model);
  if (model === "gen4.5") throw new Error("Gen-4.5 no admite el modo de continuidad de 60 segundos.");
  const resolution: TarotStudioResolution = input.resolution === "480p" || input.resolution === "1080p" ? input.resolution : "720p";
  const ratio = String(input.ratio || studioRatio(model, "vertical", resolution));
  const audioEnabled = input.audioEnabled !== false;
  // Nunca reutilizar el guion de audio completo de la escena 1 en la escena 2.
  // Para trabajos nuevos llega audioScene2 ya dividido por el planificador. El
  // fallback conserva solo el estilo sonoro de trabajos antiguos.
  const audioDirection = audioEnabled
    ? String(input.audioScene2 || input.audioDirection || "").trim().slice(0, 1800)
    : "";

  const continuityFrameUrl = await extractAndStoreStudioContinuityFrame({
    provider: input.provider,
    videoUrl: scene1OutputUrl,
  });

  const scene2Only = String(input.promptScene2 || "").trim();
  if (!scene2Only) throw new Error("La dirección creativa no contiene la segunda mitad del vídeo.");

  const continuityPrompt = `VIDEO TAROT CELESTIAL · ESCENA 2/2 · SOLO 0:30–1:00.\n` +
    `El promptImage es el ÚLTIMO FOTOGRAMA REAL de la escena 1. CONTINÚA exactamente desde ese instante: misma persona, rostro, ropa, pose, manos, carta, objetos, encuadre, distancia de cámara, iluminación y movimiento. ` +
    `NO reinicies la escena. NO repitas saludo, introducción, barajado, extracción, giro ni revelación de carta. Si la carta ya está visible, mantenla visible y siendo exactamente la misma. ` +
    `NO vuelvas a decir ninguna frase de los primeros 30 segundos. Continúa únicamente con la segunda mitad del diálogo y la acción. ` +
    `La voz debe retomar desde la PRIMERA FRASE NUEVA de la segunda mitad; no saludes, no presentes la carta otra vez y no reinicies el consejo. ` +
    `La primera acción debe ser la continuación física inmediata del fotograma de entrada.\n` +
    scene2Only;

  const scene2Task = await createStudioRunwayTask({
    model,
    prompt: continuityPrompt,
    duration: 30,
    ratio,
    resolution,
    referenceUrls: [continuityFrameUrl],
    useFirstFrame: true,
    audioEnabled,
    audioDirection,
  });
  const scene2TaskId = String(scene2Task?.id || "").trim();
  if (!scene2TaskId) throw new Error("Runway no devolvió el identificador de la escena 2.");

  return {
    scene2_task_id: scene2TaskId,
    continuity_frame_url: continuityFrameUrl,
    scene1_output_url: scene1OutputUrl,
  };
}

export async function getTarotVideoStudioStatus(taskIds: string[]) {
  const ids = Array.from(new Set(taskIds.map((id) => String(id || "").trim()).filter(Boolean))).slice(0, 4);
  if (!ids.length) throw new Error("No hay tareas de Runway para consultar.");

  const tasks = await Promise.all(ids.map(async (id) => {
    const task = await runwayRequest(`/v1/tasks/${encodeURIComponent(id)}`);
    const status = String(task?.status || "PENDING").toUpperCase();
    const failure = task?.failure || task?.error || null;
    return {
      id,
      status,
      created_at: task?.createdAt || null,
      failure_code: task?.failureCode || null,
      failure: typeof failure === "string" ? failure : failure ? JSON.stringify(failure) : null,
      output_url: status === "SUCCEEDED" ? String(runwayOutputUrl(task) || "") || null : null,
    };
  }));

  return { tasks };
}

export async function finalizeTarotVideoStudio(input: {
  provider: SocialProvider;
  taskIds: string[];
  outputUrls?: string[];
  title?: string;
  model?: string;
  duration?: number;
  format?: TarotStudioFormat;
  resolution?: TarotStudioResolution;
  ratio?: string;
  longMode?: boolean;
  creditsEstimate?: number;
  prompt?: string;
  promptScene1?: string;
  promptScene2?: string;
  referenceUrls?: string[];
  useFirstFrame?: boolean;
  audioEnabled?: boolean;
  audioDirection?: string;
  audioScene1?: string;
  audioScene2?: string;
  createdBy?: string | null;
}) {
  const taskIds = Array.from(new Set((input.taskIds || []).map((id) => String(id || "").trim()).filter(Boolean))).slice(0, 4);
  if (!taskIds.length) throw new Error("No hay tareas de Runway para finalizar.");

  // El cliente ya recibe las URLs de salida cuando las tareas pasan a SUCCEEDED.
  // Usarlas aquí evita volver a consultar Runway durante la fase de montaje, que es
  // independiente y puede tardar varios segundos. Se mantiene fallback para clientes antiguos.
  let outputUrls = Array.isArray(input.outputUrls)
    ? input.outputUrls.map((url) => String(url || "").trim()).filter(Boolean).slice(0, taskIds.length)
    : [];

  if (outputUrls.length !== taskIds.length) {
    const completed = await Promise.all(taskIds.map(async (id) => {
      const task = await runwayRequest(`/v1/tasks/${encodeURIComponent(id)}`);
      const status = String(task?.status || "").toUpperCase();
      if (status !== "SUCCEEDED") {
        if (["FAILED", "CANCELED", "CANCELLED"].includes(status)) {
          const reason = task?.failure || task?.failureCode || task?.error || `Runway terminó con estado ${status}`;
          throw new Error(typeof reason === "string" ? reason : JSON.stringify(reason));
        }
        throw new Error(`Runway todavía está procesando la tarea ${id}. Estado actual: ${status || "PENDING"}.`);
      }
      return task;
    }));
    outputUrls = completed.map(runwayOutputUrl).filter(Boolean).map(String);
  }

  if (outputUrls.length !== taskIds.length) throw new Error("Runway terminó la generación pero falta alguna salida de vídeo.");

  const model = studioModel(input.model);
  const longMode = Boolean(input.longMode);
  const duration = studioDuration(model, input.duration, longMode);
  const format: TarotStudioFormat = input.format === "landscape" ? "landscape" : "vertical";
  const resolution: TarotStudioResolution = model === "gen4.5"
    ? "720p"
    : input.resolution === "480p" || input.resolution === "1080p" ? input.resolution : "720p";
  const ratio = String(input.ratio || studioRatio(model, format, resolution));
  const referenceUrls = Array.isArray(input.referenceUrls) ? input.referenceUrls.filter(Boolean).slice(0, 10) : [];
  const creditsEstimate = Number(input.creditsEstimate || studioCredits(model, resolution, duration));

  const bucket = process.env.SOCIAL_MEDIA_BUCKET?.trim() || "tc-social-media";
  const db = supabaseAdmin();
  const storageTargetBytes = await resolveStudioStorageTargetBytes(db, bucket);
  const mountedVideo = await stitchStudioVideos(outputUrls, duration, storageTargetBytes);
  const buffer = mountedVideo.buffer;
  const storagePath = `${input.provider}/ai-studio/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.mp4`;
  const { error: uploadError } = await db.storage.from(bucket).upload(storagePath, buffer, {
    contentType: "video/mp4",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) throw new Error(`No se pudo guardar el vídeo final en Supabase Storage: ${uploadError.message}`);
  const { data: publicData } = db.storage.from(bucket).getPublicUrl(storagePath);
  const publicUrl = publicData?.publicUrl;
  if (!publicUrl) throw new Error("Supabase no devolvió URL pública para el vídeo final.");

  const title = String(input.title || "Vídeo Tarot Celestial IA").slice(0, 140);
  await db.from("tc_social_library").insert({
    provider: input.provider,
    label: title,
    media_type: "video",
    url: publicUrl,
    thumbnail_url: referenceUrls[0] || null,
    mime_type: "video/mp4",
    metadata: {
      ai_generated: true,
      source: "tarot_video_studio",
      model,
      duration,
      format,
      resolution,
      ratio,
      long_mode: longMode,
      scenes: taskIds.length,
      credits_estimate: creditsEstimate,
      reference_urls: referenceUrls,
      use_first_frame: Boolean(input.useFirstFrame),
      audio_enabled: Boolean(input.audioEnabled),
      audio_direction: String(input.audioDirection || ""),
      audio_scene_1: String(input.audioScene1 || ""),
      audio_scene_2: String(input.audioScene2 || ""),
      prompt: String(input.prompt || ""),
      prompt_scene_1: String(input.promptScene1 || ""),
      prompt_scene_2: String(input.promptScene2 || ""),
      runway_output_urls: outputUrls,
      task_ids: taskIds,
      storage_optimized: mountedVideo.optimized,
      original_size_bytes: mountedVideo.originalBytes,
      final_size_bytes: mountedVideo.finalBytes,
      storage_target_bytes: storageTargetBytes,
    },
    created_by: input.createdBy || null,
  });

  return {
    url: publicUrl,
    path: storagePath,
    bucket,
    title,
    model,
    duration,
    format,
    resolution,
    ratio,
    long_mode: longMode,
    credits_estimate: creditsEstimate,
    audio_enabled: Boolean(input.audioEnabled),
    audio_direction: String(input.audioDirection || ""),
    audio_scene_1: String(input.audioScene1 || ""),
    audio_scene_2: String(input.audioScene2 || ""),
    prompt: String(input.prompt || ""),
    prompt_scene_1: String(input.promptScene1 || ""),
    prompt_scene_2: String(input.promptScene2 || ""),
    task_ids: taskIds,
  };
}

// Compatibilidad con llamadas antiguas. IA Studio usa ahora start/status/finalize para no
// mantener una petición HTTP abierta durante varios minutos.
export async function generateTarotVideoStudio(input: {
  provider: SocialProvider;
  model?: string;
  duration?: number;
  longMode?: boolean;
  format?: TarotStudioFormat;
  resolution?: TarotStudioResolution;
  brief: string;
  contentType?: string;
  mood?: string;
  camera?: string;
  pace?: string;
  advanced?: string;
  referenceUrls?: string[];
  useFirstFrame?: boolean;
  audioEnabled?: boolean;
  audioDirection?: string;
  createdBy?: string | null;
}) {
  const job = await startTarotVideoStudio(input);
  await waitForRunwayTask(job.task_ids[0]);

  const taskIds = [...job.task_ids];
  if (job.long_mode) {
    const continued = await continueTarotVideoStudio({
      provider: input.provider,
      scene1TaskId: taskIds[0],
      model: job.model,
      resolution: job.resolution,
      ratio: job.ratio,
      promptScene2: job.prompt_scene_2,
      audioEnabled: job.audio_enabled,
      audioDirection: job.audio_direction,
      audioScene2: job.audio_scene_2,
    });
    taskIds.push(continued.scene2_task_id);
    await waitForRunwayTask(continued.scene2_task_id);
  }

  return finalizeTarotVideoStudio({
    provider: input.provider,
    taskIds,
    title: job.title,
    model: job.model,
    duration: job.duration,
    format: job.format,
    resolution: job.resolution,
    ratio: job.ratio,
    longMode: job.long_mode,
    creditsEstimate: job.credits_estimate,
    prompt: job.prompt,
    promptScene1: job.prompt_scene_1,
    promptScene2: job.prompt_scene_2,
    referenceUrls: job.reference_urls,
    useFirstFrame: job.use_first_frame,
    audioEnabled: job.audio_enabled,
    audioDirection: job.audio_direction,
    audioScene1: job.audio_scene_1,
    audioScene2: job.audio_scene_2,
    createdBy: input.createdBy,
  });
}

export async function generateAndStoreSocialVideo(input: {
  provider: SocialProvider;
  prompt: string;
  label?: string;
  format?: "vertical" | "square" | "landscape";
  duration?: number;
  createdBy?: string | null;
}) {
  const ratio = input.format === "landscape" ? "1280:720" : input.format === "square" ? "1080:1080" : "720:1280";
  const duration = [5, 8, 10].includes(Number(input.duration)) ? Number(input.duration) : 5;

  const created = await runwayRequest("/v1/image_to_video", {
    method: "POST",
    body: JSON.stringify({
      model: runwayModel(),
      promptText: `${BRAND_RULES}\nGenera un vídeo corto para redes sociales. ${input.prompt}`,
      ratio,
      duration,
    }),
  });

  const taskId = String(created?.id || "").trim();
  if (!taskId) throw new Error("Runway no devolvió el identificador de la tarea.");
  const task = await waitForRunwayTask(taskId);

  const firstOutput = Array.isArray(task?.output) ? task.output[0] : null;
  const outputUrl = typeof firstOutput === "string"
    ? firstOutput
    : (firstOutput?.url || firstOutput?.uri || firstOutput?.src || null);
  if (!outputUrl) throw new Error("Runway terminó la tarea pero no devolvió la URL del vídeo generado.");

  const buffer = await downloadBuffer(String(outputUrl));
  const bucket = process.env.SOCIAL_MEDIA_BUCKET?.trim() || "tc-social-media";
  const db = supabaseAdmin();
  const path = `${input.provider}/ai/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.mp4`;
  const { error: uploadError } = await db.storage.from(bucket).upload(path, buffer, {
    contentType: "video/mp4",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) throw new Error(`No se pudo guardar el vídeo IA en Supabase Storage: ${uploadError.message}`);
  const { data: publicData } = db.storage.from(bucket).getPublicUrl(path);
  const publicUrl = publicData?.publicUrl;
  if (!publicUrl) throw new Error("Supabase no devolvió URL pública para el vídeo IA.");
  await db.from("tc_social_library").insert({
    provider: input.provider,
    label: input.label || "Reel IA",
    media_type: "video",
    url: publicUrl,
    thumbnail_url: null,
    mime_type: "video/mp4",
    metadata: {
      ai_generated: true,
      model: runwayModel(),
      prompt: input.prompt,
      format: input.format || "vertical",
      duration,
      engine: "runway-rest",
      output_url: outputUrl,
      task_id: taskId,
    },
    created_by: input.createdBy || null,
  });
  return { url: publicUrl, path, bucket, model: runwayModel(), duration, task_id: taskId };
}
