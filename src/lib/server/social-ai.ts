import "server-only";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { execFile } from "child_process";
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
  const days = Math.max(1, Math.min(31, Number(input.days || 7)));
  const postsPerDay = Math.max(0, Math.min(6, Number(input.postsPerDay || 0)));
  const reelsPerDay = Math.max(0, Math.min(6, Number(input.reelsPerDay || 0)));
  const storiesPerDay = Math.max(0, Math.min(10, Number(input.storiesPerDay || 0)));
  const total = days * (postsPerDay + reelsPerDay + storiesPerDay);
  if (input.provider !== "instagram") throw new Error("El planificador flexible está preparado para Instagram.");
  if (total <= 0) throw new Error("Indica al menos una pieza por día.");
  if (total > 90) throw new Error("El máximo permitido por plan es 90 piezas. Reduce días o cantidades por día.");

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
    await execFileAsync("ffmpeg", [
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
