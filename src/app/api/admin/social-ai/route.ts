import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  generateAndStoreSocialImage,
  generateAndStoreSocialVideo,
  generateSingleSocialContent,
  generateSocialCalendarPlan,
  generateSocialWeek,
} from "@/lib/server/social-ai";
import type { SocialProvider } from "@/lib/server/social-connections";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const provider = String(body.provider || "instagram") as SocialProvider;
    if (!( ["instagram", "tiktok"] as string[]).includes(provider)) return NextResponse.json({ ok: false, error: "INVALID_PROVIDER" }, { status: 400 });
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

    if (action === "video") {
      const prompt = String(body.prompt || "").trim();
      if (!prompt) return NextResponse.json({ ok: false, error: "Escribe primero el guion o prompt del Reel." }, { status: 400 });
      const asset = await generateAndStoreSocialVideo({
        provider,
        prompt: prompt.slice(0, 8000),
        label: String(body.label || "Reel IA").slice(0, 140),
        format: body.format === "landscape" || body.format === "square" ? body.format : "vertical",
        duration: Number(body.duration || 5),
        createdBy: auth.me.id,
      });
      return NextResponse.json({ ok: true, asset });
    }

    if (action === "plan") {
      const plan = await generateSocialCalendarPlan({
        provider,
        brief: String(body.brief || "").trim(),
        objective: String(body.objective || "").trim(),
        preferredTime: String(body.preferred_time || "19:30"),
        days: Number(body.days || 7),
        postsPerDay: Number(body.posts_per_day || 0),
        reelsPerDay: Number(body.reels_per_day || 0),
        storiesPerDay: Number(body.stories_per_day || 0),
        campaign: body.campaign || null,
      });
      return NextResponse.json({
        ok: true,
        plan,
        models: {
          text: process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna",
          image: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
          video: process.env.RUNWAY_VIDEO_MODEL || "gen4.5",
        },
      });
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
      return NextResponse.json({ ok: true, plan, models: { text: process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna", image: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2", video: process.env.RUNWAY_VIDEO_MODEL || "gen4.5" } });
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
    return NextResponse.json({ ok: true, result, models: { text: process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna", image: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2", video: process.env.RUNWAY_VIDEO_MODEL || "gen4.5" } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || "Error generando contenido con IA") }, { status: 500 });
  }
}
