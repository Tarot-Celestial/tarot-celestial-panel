import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { generateAndStoreSocialImage, generateSingleSocialContent, generateSocialWeek } from "@/lib/server/social-ai";
import type { SocialProvider } from "@/lib/server/social-connections";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const provider = String(body.provider || "instagram") as SocialProvider;
    if (!(["instagram", "tiktok"] as string[]).includes(provider)) return NextResponse.json({ ok: false, error: "INVALID_PROVIDER" }, { status: 400 });
    const action = String(body.action || "single");
    if (action === "image") {
      const prompt = String(body.prompt || "").trim();
      if (!prompt) return NextResponse.json({ ok: false, error: "Escribe o genera primero el concepto visual." }, { status: 400 });
      const asset = await generateAndStoreSocialImage({
        provider,
        prompt: prompt.slice(0, 8000),
        label: String(body.label || "Creatividad IA").slice(0, 140),
        format: body.format === "vertical" || body.format === "landscape" ? body.format : "square",
        quality: body.quality === "high" || body.quality === "low" ? body.quality : "medium",
        createdBy: auth.me.id,
      });
      return NextResponse.json({ ok: true, asset });
    }
    if (action === "week") {
      const plan = await generateSocialWeek({
        provider,
        brief: String(body.brief || "").trim(),
        objective: String(body.objective || "").trim(),
        preferredTime: String(body.preferred_time || "19:30"),
        mode: body.mode === "mixed" ? "mixed" : "automatic",
        campaign: body.campaign || null,
      });
      return NextResponse.json({ ok: true, plan, models: { text: process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna", image: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2" } });
    }
    const result = await generateSingleSocialContent({
      provider,
      contentType: String(body.content_type || (provider === "instagram" ? "post" : "photo")),
      brief: String(body.brief || "").trim(),
      objective: String(body.objective || "").trim(),
      tone: String(body.tone || "premium, cercano y celestial"),
      cta: String(body.cta || "").trim(),
      campaign: body.campaign || null,
    });
    return NextResponse.json({ ok: true, result, models: { text: process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna", image: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || "Error generando contenido con IA") }, { status: 500 });
  }
}
