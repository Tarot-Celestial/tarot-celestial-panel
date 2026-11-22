import { officeAccess, officeError, officeJson } from "@/lib/server/office-access";
import { captacionWhatsAppTemplate } from "@/lib/server/captacion-whatsapp";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const gate = await officeAccess(req);
    if (!gate.ok) return gate.response;
    const forms = () => gate.admin.from("office_capture_opportunities")
      .select("id", { count: "exact", head: true }).eq("channel", "meta_form").eq("kind", "form");
    const [all, consent, provider, coverage] = await Promise.all([
      forms(), forms().eq("whatsapp_consent", true), captacionWhatsAppTemplate(),
      gate.admin.rpc("office_form_whatsapp_coverage", { p_actor: gate.authUserId }),
    ]);
    if (all.error || consent.error || coverage.error) return officeError("No se pudo leer el permiso de los formularios.", 503);
    const { config, template, reason } = provider;
    // The configuration contains credentials. Export only the individual operator-facing states.
    const sender = config.from === "whatsapp:+14155238886" ? "sandbox" :
      /^whatsapp:\+[1-9]\d{7,14}$/.test(config.from) ? "configured" : "missing";
    const templateState = !config.sid ? "missing" : reason === "TEMPLATE_MISMATCH" ? "mismatch" :
      template?.status === "approved" ? "approved" : template ? "pending" : "unverified";
    return officeJson({ sender, template: templateState, ready: provider.ready,
      enabled: config.enabled, forms: all.count, consent: consent.count, coverage: coverage.data });
  } catch {
    return officeError("No se pudo comprobar WhatsApp para formularios.", 503);
  }
}
