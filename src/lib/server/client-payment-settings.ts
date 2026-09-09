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
