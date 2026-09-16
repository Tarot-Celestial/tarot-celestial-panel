import { unstable_noStore as noStore } from "next/cache";

export type ClientPaymentProvider = "mollie";

export async function getActiveClientPaymentProvider(admin: any): Promise<ClientPaymentProvider> {
  const { data, error } = await admin
    .from("cliente_payment_settings")
    .select("provider")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.warn("[client-payment-settings] Mollie fallback:", error.message);
    return "mollie";
  }

  return String(data?.provider || "mollie").toLowerCase() === "mollie" ? "mollie" : "mollie";
}

/** Missing/unavailable configuration must never reopen checkout. */
export async function getClientWebPaymentsEnabled(admin: any): Promise<boolean> {
  noStore();
  const { data, error } = await admin.from("cliente_payment_settings")
    .select("web_payments_enabled").eq("id", "default").maybeSingle();
  if (error) {
    console.error("[client-payment-settings] Availability lookup failed", { code: error.code });
    return false;
  }
  return data?.web_payments_enabled === true;
}
