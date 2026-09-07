import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";
const PROFILE_BUCKET = "central-profile-photos";

async function centralWorkers(admin: any) {
  const { data, error } = await admin.from("workers").select("id,display_name,team").eq("role", "central").eq("is_active", true).order("display_name");
  if (error) throw error;
  return data || [];
}

async function experienceMap(admin: any, cliente: any, workerIds: string[]) {
  const relationship = new Set<string>();
  if (cliente?.captured_by_worker_id) relationship.add(String(cliente.captured_by_worker_id));
  if (cliente?.creado_por_worker_id) relationship.add(String(cliente.creado_por_worker_id));
  const [assignments, calls, used] = await Promise.all([
    admin.from("crm_client_capture_assignments").select("created_by_worker_id,candidate_worker_id,captured_by_worker_id,responsible_worker_id").eq("client_id", cliente.id),
    admin.from("rendimiento_llamadas").select("id,telefonista_worker_id,fecha_hora").eq("cliente_id", String(cliente.id)).in("telefonista_worker_id", workerIds).order("fecha_hora", { ascending: false }).limit(300),
    admin.from("cliente_tarotista_reviews").select("worker_id,verification_reference").eq("cliente_id", cliente.id).not("verification_reference", "is", null),
  ]);
  if (assignments.error) throw assignments.error;
  if (calls.error) throw calls.error;
  if (used.error) throw used.error;
  for (const row of assignments.data || []) for (const key of ["created_by_worker_id", "candidate_worker_id", "captured_by_worker_id", "responsible_worker_id"]) if (row[key]) relationship.add(String(row[key]));
  const usedRefs = new Set((used.data || []).map((row: any) => String(row.verification_reference)));
  const result = new Map<string, { reference: string; interactionId: string | null; source: string }>();
  for (const row of calls.data || []) {
    const workerId = String(row.telefonista_worker_id || "");
    const reference = `call:${row.id}`;
    if (workerId && !usedRefs.has(reference) && !result.has(workerId)) result.set(workerId, { reference, interactionId: String(row.id), source: "rendimiento_llamadas" });
  }
  for (const workerId of relationship) {
    const reference = `relationship:${cliente.id}:${workerId}`;
    if (!result.has(workerId) && !usedRefs.has(reference)) result.set(workerId, { reference, interactionId: null, source: "relacion_verificada" });
  }
  return result;
}

function photoUrl(admin: any, path?: string | null) {
  return path ? admin.storage.from(PROFILE_BUCKET).getPublicUrl(path).data.publicUrl : null;
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente || !gate.admin) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const workers = await centralWorkers(gate.admin);
    const ids = workers.map((row: any) => String(row.id));
    if (!ids.length) return NextResponse.json({ ok: true, centrales: [], recentReviews: [] });

    const [profilesResult, reviewsResult, mineResult, statsResult, schedulesResult, experiences] = await Promise.all([
      gate.admin.from("central_public_profiles").select("worker_id,public_name,presentation,photo_path,theme_variant,is_published").in("worker_id", ids),
      gate.admin.from("cliente_tarotista_reviews").select("id,worker_id,rating,comment,verified,created_at").in("worker_id", ids).eq("status", "published").order("created_at", { ascending: false }).limit(300),
      gate.admin.from("cliente_tarotista_reviews").select("id,worker_id,rating,comment,status,created_at,updated_at").eq("cliente_id", gate.cliente.id).in("worker_id", ids).neq("status", "deleted").order("created_at", { ascending: false }),
      gate.admin.from("central_review_stats").select("worker_id,rating_sum,review_count,star_1,star_2,star_3,star_4,star_5").in("worker_id", ids),
      gate.admin.from("shift_schedules").select("worker_id,day_of_week,start_time,end_time,timezone").in("worker_id", ids).eq("active", true).order("day_of_week"),
      experienceMap(gate.admin, gate.cliente, ids),
    ]);
    for (const result of [profilesResult, reviewsResult, mineResult, statsResult, schedulesResult]) if (result.error) throw result.error;
    const profiles = new Map((profilesResult.data || []).map((row: any) => [String(row.worker_id), row]));
    const stats = new Map((statsResult.data || []).map((row: any) => [String(row.worker_id), row]));
    const ownIds = new Set((mineResult.data || []).map((row: any) => String(row.id)));
    const publicReviews = (reviewsResult.data || []).map((row: any) => ({ id: row.id, workerId: String(row.worker_id), rating: Number(row.rating), comment: String(row.comment || ""), verified: row.verified === true, createdAt: row.created_at, isMine: ownIds.has(String(row.id)) }));
    const centrales = workers.map((worker: any) => {
      const id = String(worker.id); const profile: any = profiles.get(id); const stat: any = stats.get(id) || {};
      const count = Number(stat.review_count || 0); const mine = (mineResult.data || []).find((row: any) => String(row.worker_id) === id) || null;
      return {
        id, name: String(profile?.public_name || worker.display_name || "Central"), team: String(worker.team || ""), themeVariant: String(profile?.theme_variant || "balanced"),
        presentation: String(profile?.presentation || "Central de Tarot Celestial preparada para acompañarte durante tu consulta."), photoUrl: photoUrl(gate.admin, profile?.photo_path),
        schedule: (schedulesResult.data || []).filter((row: any) => String(row.worker_id) === id).map((row: any) => ({ dayOfWeek: Number(row.day_of_week), startTime: String(row.start_time).slice(0,5), endTime: String(row.end_time).slice(0,5), timezone: String(row.timezone || "Europe/Madrid") })),
        average: count ? Number(stat.rating_sum || 0) / count : 0, count,
        distribution: [1,2,3,4,5].map((star) => Number(stat[`star_${star}`] || 0)),
        canCreateReview: experiences.has(id), mine,
        reviews: publicReviews.filter((review: any) => review.workerId === id).slice(0, 30),
      };
    });
    return NextResponse.json({ ok: true, centrales, recentReviews: publicReviews.slice(0, 40) });
  } catch (error) {
    console.error("[cliente/resenas][GET]", error);
    return NextResponse.json({ ok: false, error: "No se pudieron cargar las reseñas." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente || !gate.admin) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const workerId = String(body.workerId || ""); const reviewId = String(body.reviewId || ""); const rating = Number(body.rating); const comment = String(body.comment || "").trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 500) return NextResponse.json({ ok: false, error: "Datos de reseña no válidos." }, { status: 400 });
    const workers = await centralWorkers(gate.admin);
    if (!workers.some((row: any) => String(row.id) === workerId)) return NextResponse.json({ ok: false, error: "Central no válida." }, { status: 400 });
    if (reviewId) {
      const { data: current, error: currentError } = await gate.admin.from("cliente_tarotista_reviews").select("id").eq("id", reviewId).eq("cliente_id", gate.cliente.id).eq("worker_id", workerId).neq("status", "deleted").maybeSingle();
      if (currentError) throw currentError;
      if (!current) return NextResponse.json({ ok: false, error: "Esa reseña no pertenece a tu cuenta." }, { status: 403 });
      const { error } = await gate.admin.from("cliente_tarotista_reviews").update({ rating, comment, status: "published", updated_at: new Date().toISOString() }).eq("id", reviewId);
      if (error) throw error;
    } else {
      const experiences = await experienceMap(gate.admin, gate.cliente, workers.map((row: any) => String(row.id)));
      const experience = experiences.get(workerId);
      if (!experience) return NextResponse.json({ ok: false, error: "Necesitas una atención nueva y verificada para publicar otra reseña." }, { status: 403 });
      const { error } = await gate.admin.from("cliente_tarotista_reviews").insert({ cliente_id: gate.cliente.id, worker_id: workerId, rating, comment, status: "published", verified: true, verification_source: experience.source, verification_reference: experience.reference, interaction_id: experience.interactionId, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[cliente/resenas][POST]", error);
    return NextResponse.json({ ok: false, error: "No se pudo guardar la reseña." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente || !gate.admin) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const reviewId = String((await req.json().catch(() => ({}))).reviewId || "");
    if (!reviewId) return NextResponse.json({ ok: false, error: "Reseña no válida." }, { status: 400 });
    const { data, error } = await gate.admin.from("cliente_tarotista_reviews").update({ status: "deleted", updated_at: new Date().toISOString() }).eq("id", reviewId).eq("cliente_id", gate.cliente.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, error: "Esa reseña no pertenece a tu cuenta." }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[cliente/resenas][DELETE]", error);
    return NextResponse.json({ ok: false, error: "No se pudo eliminar la reseña." }, { status: 500 });
  }
}
