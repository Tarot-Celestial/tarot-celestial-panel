import "server-only";
import crypto from "crypto";
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
        properties: {
          day_offset: { type: "integer", minimum: 0, maximum: 6 },
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
        },
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
    `Crea una pieza para ${input.provider}. Formatos permitidos: ${allowed}. Si se pide Reel/vídeo, devuelve también un guion accionable; si es imagen, reel_script puede quedar vacío. El visual_prompt debe describir una creatividad lista para generar con IA, sin inventar datos comerciales.`,
    JSON.stringify(input),
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

export async function generateAndStoreSocialImage(input: {
  provider: SocialProvider;
  prompt: string;
  label?: string;
  format?: "square" | "vertical" | "landscape";
  quality?: "low" | "medium" | "high";
  createdBy?: string | null;
}) {
  const size = input.format === "landscape" ? "1536x1024" : input.format === "vertical" ? "1024x1536" : "1024x1024";
  const quality = input.quality || "medium";
  const enhancedPrompt = `${BRAND_RULES}\nGenera SOLO la pieza visual. ${input.prompt}\nComposición profesional para redes sociales. Si incluyes texto, debe ser corto, en español y perfectamente legible. No inventes precios ni promociones que no aparezcan literalmente en el prompt.`;
  const buffer = await generateImageBase64(enhancedPrompt, size, quality);
  const bucket = process.env.SOCIAL_MEDIA_BUCKET?.trim() || "tc-social-media";
  const db = supabaseAdmin();
  const path = `${input.provider}/ai/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.png`;
  const { error: uploadError } = await db.storage.from(bucket).upload(path, buffer, {
    contentType: "image/png",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) throw new Error(`No se pudo guardar la imagen IA en Supabase Storage: ${uploadError.message}`);
  const { data: publicData } = db.storage.from(bucket).getPublicUrl(path);
  const publicUrl = publicData?.publicUrl;
  if (!publicUrl) throw new Error("Supabase no devolvió URL pública para la imagen IA.");
  await db.from("tc_social_library").insert({
    provider: input.provider,
    label: input.label || "Creatividad IA",
    media_type: "image",
    url: publicUrl,
    thumbnail_url: publicUrl,
    mime_type: "image/png",
    metadata: { ai_generated: true, model: imageModel(), prompt: input.prompt, format: input.format || "square", quality },
    created_by: input.createdBy || null,
  });
  return { url: publicUrl, path, bucket, model: imageModel() };
}
