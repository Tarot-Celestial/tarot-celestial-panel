export type MolliePayment = {
  id: string;
  status: string;
  paidAt?: string;
  failedAt?: string;
  canceledAt?: string;
  expiredAt?: string;
  amount: { currency: string; value: string };
  description?: string;
  metadata?: Record<string, any> | string | null;
  details?: Record<string, any> | null;
  failureReason?: string | null;
  _links?: {
    checkout?: { href?: string | null } | null;
    paymentLink?: { href?: string | null } | null;
  };
};

export type MolliePaymentLink = {
  id: string;
  description?: string;
  amount?: { currency: string; value: string } | null;
  paidAt?: string | null;
  archived?: boolean;
  reusable?: boolean;
  redirectUrl?: string | null;
  webhookUrl?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
  _links?: {
    paymentLink?: { href?: string | null } | null;
    self?: { href?: string | null } | null;
  };
};

type MolliePaymentList = {
  count?: number;
  _embedded?: { payments?: MolliePayment[] };
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
    signal: AbortSignal.timeout(15000),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json?.detail ||
      json?.title ||
      json?.message ||
      `MOLLIE_HTTP_${response.status}`;
    const error: any = new Error(String(message));
    error.status = response.status;
    error.mollie = json;
    throw error;
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
  idempotencyKey?: string;
}) {
  const payment = await mollieRequest<MolliePayment>("/payments", {
    method: "POST",
    headers: params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {},
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

export async function createMolliePaymentLink(params: {
  amount: number;
  currency: "EUR" | "USD";
  description: string;
  redirectUrl: string;
  webhookUrl: string;
  idempotencyKey?: string;
}) {
  const paymentLink = await mollieRequest<MolliePaymentLink>("/payment-links", {
    method: "POST",
    headers: params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {},
    body: JSON.stringify({
      amount: {
        currency: params.currency,
        value: Number(params.amount).toFixed(2),
      },
      description: params.description,
      redirectUrl: params.redirectUrl,
      webhookUrl: params.webhookUrl,
      reusable: false,
    }),
  });

  const paymentLinkUrl = String(paymentLink?._links?.paymentLink?.href || "").trim();
  if (!paymentLink?.id || !paymentLinkUrl) throw new Error("MOLLIE_PAYMENT_LINK_NO_DISPONIBLE");
  return { paymentLink, paymentLinkUrl };
}

export function getMolliePayment(paymentId: string) {
  const id = String(paymentId || "").trim();
  if (!id) throw new Error("MOLLIE_PAYMENT_ID_INVALIDO");
  return mollieRequest<MolliePayment>(`/payments/${encodeURIComponent(id)}`, { method: "GET" });
}

export function getMolliePaymentLink(paymentLinkId: string) {
  const id = String(paymentLinkId || "").trim();
  if (!/^pl_[a-zA-Z0-9]+$/.test(id)) throw new Error("MOLLIE_PAYMENT_LINK_ID_INVALIDO");
  return mollieRequest<MolliePaymentLink>(`/payment-links/${encodeURIComponent(id)}`, { method: "GET" });
}

export async function getMolliePaymentLinkPayments(paymentLinkId: string) {
  const id = String(paymentLinkId || "").trim();
  if (!/^pl_[a-zA-Z0-9]+$/.test(id)) throw new Error("MOLLIE_PAYMENT_LINK_ID_INVALIDO");
  const result = await mollieRequest<MolliePaymentList>(`/payment-links/${encodeURIComponent(id)}/payments?limit=50&sort=desc`, { method: "GET" });
  return Array.isArray(result?._embedded?.payments) ? result._embedded!.payments! : [];
}
