import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";

const PROFILE_BUCKET = "central-profile-photos";

async function centralWorkers(admin: any) {
  const { data, error } = await admin
    .from("workers")
    .select("id,display_name")
    .eq("role", "central")
    .eq("is_active", true)
    .order("display_name");
  if (error) throw error;
  return data || [];
}

async function eligibleCentralIds(admin: any, cliente: any) {
  const eligible = new Set<string>();
  if (cliente?.captured_by_worker_id) eligible.add(String(cliente.captured_by_worker_id));
  if (cliente?.creado_por_worker_id) eligible.add(String(cliente.creado_por_worker_id));

  const [assignments, calls] = await Promise.all([
    admin
      .from("crm_client_capture_assignments")
      .select("created_by_worker_id,candidate_worker_id,captured_by_worker_id,responsible_worker_id")
      .eq("client_id", cliente.id),
    admin
      .from("rendimiento_llamadas")
      .select("telefonista_worker_id")
      .eq("cliente_id", String(cliente.id))
      .not("telefonista_worker_id", "is", null)
      .limit(100),
  ]);
  if (assignments.error) throw assignments.error;
  if (calls.error) throw calls.error;

  for (const row of assignments.data || []) {
    for (const key of ["created_by_worker_id", "candidate_worker_id", "captured_by_worker_id", "responsible_worker_id"]) {
      if (row[key]) eligible.add(String(row[key]));
    }
  }
  for (const row of calls.data || []) {
    if (row.telefonista_worker_id) eligible.add(String(row.telefonista_worker_id));
  }
  return eligible;
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente || !gate.admin) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const workers = await centralWorkers(gate.admin);
    const ids = workers.map((worker: any) => String(worker.id));
    if (!ids.length) return NextResponse.json({ ok: true, centrales: [] });

    const [profilesResult, reviewsResult, eligible] = await Promise.all([
      gate.admin
        .from("central_public_profiles")
        .select("worker_id,public_name,presentation,photo_path,is_published")
        .in("worker_id", ids),
      gate.admin
        .from("cliente_tarotista_reviews")
        .select("id,cliente_id,worker_id,rating,comment,status,created_at,updated_at")
        .in("worker_id", ids)
        .eq("status", "published")
        .order("created_at", { ascending: false }),
      eligibleCentralIds(gate.admin, gate.cliente),
    ]);
    if (profilesResult.error) throw profilesResult.error;
    if (reviewsResult.error) throw reviewsResult.error;

    const profiles = new Map((profilesResult.data || []).map((row: any) => [String(row.worker_id), row]));
    const reviews = reviewsResult.data || [];
    const centrales = workers.map((worker: any) => {
      const workerId = String(worker.id);
      const profile: any = profiles.get(workerId);
      const workerReviews = reviews.filter((review: any) => String(review.worker_id) === workerId);
      const mine = workerReviews.find((review: any) => String(review.cliente_id) === String(gate.cliente.id)) || null;
      const average = workerReviews.length
        ? workerReviews.reduce((sum: number, review: any) => sum + Number(review.rating || 0), 0) / workerReviews.length
        : 0;
      const photoUrl = profile?.photo_path
        ? gate.admin.storage.from(PROFILE_BUCKET).getPublicUrl(profile.photo_path).data.publicUrl
        : null;
      return {
        id: workerId,
        name: String(profile?.public_name || worker.display_name || "Central"),
        presentation: String(profile?.presentation || "Central de Tarot Celestial preparada para acompañarte y ayudarte durante tu consulta."),
        photoUrl,
        average,
        count: workerReviews.length,
        eligible: eligible.has(workerId),
        mine,
        reviews: workerReviews.slice(0, 30).map((review: any) => ({
          id: review.id,
          rating: review.rating,
          comment: review.comment,
          createdAt: review.created_at,
          isMine: String(review.cliente_id) === String(gate.cliente.id),
        })),
      };
    });

    return NextResponse.json({ ok: true, centrales });
  } catch (error) {
    console.error("[cliente/resenas][GET]", error);
    return NextResponse.json({ ok: false, error: "No se pudieron cargar las reseñas." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente || !gate.admin) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const workerId = String(body.workerId || "");
    const rating = Number(body.rating);
    const comment = String(body.comment || "").trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 500) {
      return NextResponse.json({ ok: false, error: "Datos de reseña no válidos." }, { status: 400 });
    }

    const [workers, eligible] = await Promise.all([
      centralWorkers(gate.admin),
      eligibleCentralIds(gate.admin, gate.cliente),
    ]);
    if (!workers.some((worker: any) => String(worker.id) === workerId)) {
      return NextResponse.json({ ok: false, error: "Central no válida." }, { status: 400 });
    }
    if (!eligible.has(workerId)) {
      return NextResponse.json({ ok: false, error: "Solo puedes valorar a una central que te haya atendido." }, { status: 403 });
    }

    const { error } = await gate.admin.from("cliente_tarotista_reviews").upsert({
      cliente_id: gate.cliente.id,
      worker_id: workerId,
      rating,
      comment,
      status: "published",
      updated_at: new Date().toISOString(),
    }, { onConflict: "cliente_id,worker_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[cliente/resenas][POST]", error);
    return NextResponse.json({ ok: false, error: "No se pudo guardar la reseña." }, { status: 500 });
  }
}
