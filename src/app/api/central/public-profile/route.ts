import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminClient, workerFromRequest } from "@/lib/server/auth-worker";

export const runtime = "nodejs";

const BUCKET = "central-profile-photos";
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function reviewSummary(admin: ReturnType<typeof getAdminClient>, workerId: string) {
  const [stats, reviews] = await Promise.all([
    admin.from("central_review_stats").select("rating_sum,review_count").eq("worker_id", workerId).maybeSingle(),
    admin.from("cliente_tarotista_reviews").select("id,rating,comment,verified,created_at").eq("worker_id", workerId).eq("status", "published").order("created_at", { ascending: false }).limit(20),
  ]);
  if (stats.error) throw stats.error;
  if (reviews.error) throw reviews.error;
  const count = Number(stats.data?.review_count || 0);
  return {
    rating: count ? Number(stats.data?.rating_sum || 0) / count : 0,
    reviewCount: count,
    reviews: (reviews.data || []).map((row) => ({ id: row.id, rating: Number(row.rating), comment: String(row.comment || ""), verified: row.verified === true, createdAt: row.created_at })),
  };
}

async function workSchedule(admin: ReturnType<typeof getAdminClient>, workerId: string) {
  const { data, error } = await admin.from("shift_schedules").select("day_of_week,start_time,end_time,timezone").eq("worker_id", workerId).eq("active", true).order("day_of_week").order("start_time");
  if (error) throw error;
  return (data || []).map((row) => ({ dayOfWeek: Number(row.day_of_week), startTime: String(row.start_time).slice(0, 5), endTime: String(row.end_time).slice(0, 5), timezone: String(row.timezone || "Europe/Madrid") }));
}

function photoUrl(admin: ReturnType<typeof getAdminClient>, path: string | null | undefined) {
  if (!path) return null;
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me || me.role !== "central") {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("central_public_profiles")
      .select("public_name,presentation,photo_path,theme_variant,is_published,updated_at")
      .eq("worker_id", me.id)
      .maybeSingle();
    if (error) throw error;
    const [summary, schedule] = await Promise.all([reviewSummary(admin, me.id), workSchedule(admin, me.id)]);
    return NextResponse.json({
      ok: true,
      profile: {
        name: String(data?.public_name || me.display_name || "Central"),
        presentation: String(data?.presentation || ""),
        photoUrl: photoUrl(admin, data?.photo_path),
        team: String(me.team || ""),
        themeVariant: String(data?.theme_variant || "balanced"),
        schedule,
        isPublished: data?.is_published !== false,
        ...summary,
      },
    });
  } catch (error) {
    console.error("[central/public-profile][GET]", error);
    return NextResponse.json({ ok: false, error: "No se pudo cargar el perfil." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me || me.role !== "central") {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const form = await req.formData();
    const name = String(form.get("name") || "").trim();
    const presentation = String(form.get("presentation") || "").trim();
    const themeVariant = String(form.get("themeVariant") || "balanced");
    const fileValue = form.get("photo");
    const photo = fileValue instanceof File && fileValue.size ? fileValue : null;

    if (name.length < 2 || name.length > 60) {
      return NextResponse.json({ ok: false, error: "El nombre debe tener entre 2 y 60 caracteres." }, { status: 400 });
    }
    if (presentation.length > 700) {
      return NextResponse.json({ ok: false, error: "La presentación no puede superar 700 caracteres." }, { status: 400 });
    }
    if (!["balanced", "soft", "vivid"].includes(themeVariant)) {
      return NextResponse.json({ ok: false, error: "Tema de perfil no válido." }, { status: 400 });
    }
    if (photo && (!PHOTO_TYPES[photo.type] || photo.size > MAX_PHOTO_BYTES)) {
      return NextResponse.json({ ok: false, error: "Usa una imagen JPG, PNG o WebP de hasta 4 MB." }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: current, error: currentError } = await admin
      .from("central_public_profiles")
      .select("photo_path")
      .eq("worker_id", me.id)
      .maybeSingle();
    if (currentError) throw currentError;

    let nextPhotoPath = current?.photo_path || null;
    if (photo) {
      const extension = PHOTO_TYPES[photo.type];
      nextPhotoPath = `${me.id}/profile-${randomUUID()}.${extension}`;
      const bytes = Buffer.from(await photo.arrayBuffer());
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(nextPhotoPath, bytes, {
        contentType: photo.type,
        cacheControl: "31536000",
        upsert: false,
      });
      if (uploadError) throw uploadError;
    }

    const { error: profileError } = await admin.from("central_public_profiles").upsert({
      worker_id: me.id,
      public_name: name,
      presentation,
      photo_path: nextPhotoPath,
      theme_variant: themeVariant,
      is_published: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "worker_id" });
    if (profileError) {
      if (photo && nextPhotoPath) await admin.storage.from(BUCKET).remove([nextPhotoPath]);
      throw profileError;
    }

    if (photo && current?.photo_path && current.photo_path !== nextPhotoPath) {
      await admin.storage.from(BUCKET).remove([current.photo_path]);
    }

    const [summary, schedule] = await Promise.all([reviewSummary(admin, me.id), workSchedule(admin, me.id)]);
    return NextResponse.json({
      ok: true,
      profile: {
        name,
        presentation,
        photoUrl: photoUrl(admin, nextPhotoPath),
        team: String(me.team || ""),
        themeVariant,
        schedule,
        isPublished: true,
        ...summary,
      },
    });
  } catch (error) {
    console.error("[central/public-profile][POST]", error);
    return NextResponse.json({ ok: false, error: "No se pudo guardar el perfil." }, { status: 500 });
  }
}
