export type ClientPaymentProvider = "stripe" | "redsys";

export async function getActiveClientPaymentProvider(admin: any): Promise<ClientPaymentProvider> {
  const { data, error } = await admin
    .from("cliente_payment_settings")
    .select("provider")
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    console.warn("[client-payment-settings] Falling back to Redsys:", error.message);
    return "redsys";
  }

  return String(data?.provider || "redsys").toLowerCase() === "stripe" ? "stripe" : "redsys";
}
