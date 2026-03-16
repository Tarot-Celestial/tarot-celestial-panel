import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const popup_id = body.popup_id;
    const consumidos_free = Number(body.consumidos_free || 0);
    const consumidos_normales = Number(body.consumidos_normales || 0);

    const admin = adminClient();

    const { data: popup, error } = await admin
      .from("crm_call_popups")
      .select("*")
      .eq("id", popup_id)
      .maybeSingle();

    if (error) throw error;
    if (!popup) {
      return NextResponse.json({ ok: false, error: "POPUP_NOT_FOUND" });
    }

    const enviados_free = popup.minutos_free_pendientes || 0;
    const enviados_normales = popup.minutos_normales_pendientes || 0;

    const restantes_free = Math.max(0, enviados_free - consumidos_free);
    const restantes_normales = Math.max(0, enviados_normales - consumidos_normales);

    if (restantes_free > 0 || restantes_normales > 0) {
      const { error: updateClienteError } = await admin.rpc(
        "crm_devolver_minutos",
        {
          p_cliente_id: popup.cliente_id,
          p_free: restantes_free,
          p_normales: restantes_normales
        }
      );

      if (updateClienteError) throw updateClienteError;
    }

    await admin
      .from("crm_call_popups")
      .update({
        visible: false,
        closed: true,
        minutos_free_consumidos: consumidos_free,
        minutos_normales_consumidos: consumidos_normales
      })
      .eq("id", popup_id);

    return NextResponse.json({
      ok: true,
      restantes_free,
      restantes_normales
    });

  } catch (e:any) {
    return NextResponse.json({
      ok:false,
      error:e.message
    });
  }
}
