export type ClientPaymentProvider = "stripe" | "redsys";

export async function getActiveClientPaymentProvider(admin: any): Promise<ClientPaymentProvider> {
  const { data, error } = await admin
    .from("cliente_payment_settings")
    .select("provider")
    .eq("id", "default")
    .maybeSingle();

  // Conservamos Stripe como fallback para no cambiar el sistema existente si el SQL
  // todavía no se ha ejecutado o Supabase no está disponible temporalmente.
  if (error) {
    console.warn("[client-payment-settings] Stripe fallback:", error.message);
    return "stripe";
  }

  return String(data?.provider || "stripe").toLowerCase() === "redsys" ? "redsys" : "stripe";
}
