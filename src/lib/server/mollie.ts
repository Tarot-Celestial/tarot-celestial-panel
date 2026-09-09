export type MolliePayment = {
  id: string;
  status: string;
  amount: { currency: string; value: string };
  description?: string;
  metadata?: Record<string, any> | string | null;
  _links?: {
    checkout?: { href?: string | null } | null;
  };
};

function mollieApiKey() {
  const value = String(process.env.MOLLIE_API_KEY || "").trim();
  if (!value) throw new Error("Falta MOLLIE_API_KEY");
  return value;
}

async function mollieRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.mollie.com/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${mollieApiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json?.detail ||
      json?.title ||
      json?.message ||
      `MOLLIE_HTTP_${response.status}`;
    throw new Error(String(message));
  }
  return json as T;
}

export async function createMolliePayment(params: {
  amount: number;
  currency: "EUR" | "USD";
  description: string;
  redirectUrl: string;
  webhookUrl: string;
  metadata: Record<string, any>;
}) {
  const payment = await mollieRequest<MolliePayment>("/payments", {
    method: "POST",
    body: JSON.stringify({
      amount: {
        currency: params.currency,
        value: Number(params.amount).toFixed(2),
      },
      description: params.description,
      redirectUrl: params.redirectUrl,
      webhookUrl: params.webhookUrl,
      metadata: params.metadata,
    }),
  });

  const checkoutUrl = String(payment?._links?.checkout?.href || "").trim();
  if (!payment?.id || !checkoutUrl) throw new Error("MOLLIE_CHECKOUT_NO_DISPONIBLE");
  return { payment, checkoutUrl };
}

export function getMolliePayment(paymentId: string) {
  const id = String(paymentId || "").trim();
  if (!id) throw new Error("MOLLIE_PAYMENT_ID_INVALIDO");
  return mollieRequest<MolliePayment>(`/payments/${encodeURIComponent(id)}`, { method: "GET" });
}
