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

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: me, error: em } = await admin
      .from("workers")
      .select("id, role, display_name, team, shift_type")
      .eq("user_id", uid)
      .maybeSingle();

    if (em) throw em;
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });

    const template_key = me.role === "central" ? "central" : "tarotista";

    // shift_key actual (según shift_type guardado)
    const { data: sk, error: esk } = await admin.rpc("current_shift_key", {
      p_shift_type: me.shift_type || (me.role === "central" ? "tarde" : "noche"),
    });
    if (esk) throw esk;
    const shift_key = String(sk || "");

    // template + items
    const { data: tpl, error: et } = await admin
      .from("checklist_templates")
      .select("id, template_key, title")
      .eq("template_key", template_key)
      .maybeSingle();
    if (et) throw et;
    if (!tpl) return NextResponse.json({ ok: false, error: "NO_TEMPLATE" }, { status: 500 });

    const { data: items, error: ei } = await admin
  .from("checklist_template_items")
  .select("id, sort, label, description, is_active")
  .eq("template_id", tpl.id)
  .eq("is_active", true)
  .order("sort", { ascending: true });
    if (ei) throw ei;

    // response (crear si no existe)
    const { data: resp, error: er1 } = await admin
      .from("checklist_responses")
      .upsert(
        { worker_id: me.id, template_key, shift_key },
        { onConflict: "worker_id,template_key,shift_key", ignoreDuplicates: true }
      )
      .select("id, completed_at, created_at")
      .maybeSingle();

    if (er1) throw er1;

    // marks
    const { data: marks, error: emk } = await admin
      .from("checklist_response_items")
      .select("item_id, checked, checked_at")
      .eq("response_id", resp!.id);
    if (emk) throw emk;

    const byItem: Record<string, any> = {};
    for (const m of marks || []) byItem[String(m.item_id)] = m;

    const out = (items || []).map((it: any) => ({
      id: it.id,
      sort: it.sort,
      label: it.label,
      description: it.description || null,
      checked: Boolean(byItem[String(it.id)]?.checked),
      checked_at: byItem[String(it.id)]?.checked_at || null,
    }));

    const doneCount = out.filter((x: any) => x.checked).length;
    const total = out.length;

    return NextResponse.json({
      ok: true,
      worker: { id: me.id, role: me.role, display_name: me.display_name, team: me.team },
      template: { template_key: tpl.template_key, title: tpl.title },
      shift_key,
      response: { id: resp!.id, completed_at: resp!.completed_at || null },
      items: out,
      progress: { done: doneCount, total },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
