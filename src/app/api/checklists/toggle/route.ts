import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const item_id = String(body.item_id || "");
    const checked = Boolean(body.checked);

    if (!item_id) return NextResponse.json({ ok: false, error: "MISSING_ITEM" }, { status: 400 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role, shift_type")
      .eq("user_id", uid)
      .maybeSingle();
    if (em) throw em;
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    const template_key = me.role === "central" ? "central" : "tarotista";

    const { data: sk, error: esk } = await admin.rpc("current_shift_key", {
      p_shift_type: me.shift_type || (me.role === "central" ? "tarde" : "noche"),
    });
    if (esk) throw esk;
    const shift_key = String(sk || "");

    const { data: resp, error: er } = await admin
      .from("checklist_responses")
      .upsert(
        { worker_id: me.id, template_key, shift_key },
        { onConflict: "worker_id,template_key,shift_key" }
      )
      .select("id")
      .maybeSingle();
    if (er) throw er;

    const response_id = resp!.id;

    await admin.from("checklist_response_items").upsert(
      {
        response_id,
        item_id,
        checked,
        checked_at: checked ? new Date().toISOString() : null,
      },
      { onConflict: "response_id,item_id" }
    );

    // ¿ya están todos?
    const { data: allMarks, error: emk } = await admin
      .from("checklist_response_items")
      .select("checked, item_id")
      .eq("response_id", response_id);
    if (emk) throw emk;

    // total items de la plantilla
    const { data: tpl, error: et } = await admin
      .from("checklist_templates")
      .select("id")
      .eq("template_key", template_key)
      .maybeSingle();
    if (et) throw et;

    const { data: tplItems, error: eti } = await admin
      .from("checklist_template_items")
      .select("id")
      .eq("template_id", tpl!.id);
    if (eti) throw eti;

    const total = (tplItems || []).length;
    const done = (tplItems || []).filter((ti: any) => {
      const mk = (allMarks || []).find((m: any) => String(m.item_id) === String(ti.id));
      return Boolean(mk?.checked);
    }).length;

    const completed = total > 0 && done === total;

    await admin
      .from("checklist_responses")
      .update({ completed_at: completed ? new Date().toISOString() : null })
      .eq("id", response_id);

    return NextResponse.json({ ok: true, shift_key, progress: { done, total }, completed });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
