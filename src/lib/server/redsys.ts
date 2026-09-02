import { createCipheriv, createHmac, timingSafeEqual } from "crypto";

// El TPV de CaixaBank/Cyberpac facilitado para este comercio usa SHA-256.
export const REDSYS_SIGNATURE_VERSION = "HMAC_SHA256_V1";

function requiredEnv(...names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  throw new Error(`Missing env var: ${names.join(" or ")}`);
}

function merchantSecret() {
  // Aceptamos ambos nombres para no romper una variable creada con el nombre anterior.
  return requiredEnv("REDSYS_SECRET_KEY", "REDSYS_MERCHANT_SECRET");
}

function decodeBase64Flexible(value: string) {
  const normalized = String(value || "")
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64");
}

function normalizeSignature(value: string) {
  return decodeBase64Flexible(value);
}

function zeroPadToBlock(value: Buffer, blockSize: number) {
  const targetLength = Math.ceil(value.length / blockSize) * blockSize;
  if (targetLength === value.length) return value;
  const padded = Buffer.alloc(targetLength, 0);
  value.copy(padded);
  return padded;
}

/**
 * HMAC_SHA256_V1 de Redsys:
 * 1) clave del comercio en Base64 -> bytes (24 bytes para 3DES)
 * 2) diversificación cifrando Ds_Order con 3DES-CBC, IV=0 y relleno a cero
 * 3) HMAC-SHA256 de Ds_MerchantParameters usando la clave diversificada
 * 4) resultado en Base64
 */
function deriveOrderKey(order: string) {
  const key = decodeBase64Flexible(merchantSecret());
  if (key.length !== 24) {
    throw new Error("REDSYS_SECRET_KEY_INVALIDA");
  }

  const orderBytes = zeroPadToBlock(Buffer.from(order, "utf8"), 8);
  const cipher = createCipheriv("des-ede3-cbc", key, Buffer.alloc(8, 0));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(orderBytes), cipher.final()]);
}

export function encodeMerchantParameters(parameters: Record<string, string>) {
  return Buffer.from(JSON.stringify(parameters), "utf8").toString("base64");
}

export function decodeMerchantParameters(encoded: string): Record<string, string> {
  const json = decodeBase64Flexible(encoded).toString("utf8");
  return JSON.parse(json);
}

export function createRedsysSignature(merchantParameters: string, order: string) {
  const diversifiedKey = deriveOrderKey(order);
  return createHmac("sha256", diversifiedKey)
    .update(merchantParameters, "utf8")
    .digest("base64");
}

export function verifyRedsysSignature(
  merchantParameters: string,
  signature: string,
  order: string,
) {
  const expected = normalizeSignature(createRedsysSignature(merchantParameters, order));
  const received = normalizeSignature(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function redsysEndpoint() {
  return String(process.env.REDSYS_ENV || "test").toLowerCase() === "production"
    ? "https://sis.redsys.es/sis/realizarPago"
    : "https://sis-t.redsys.es:25443/sis/realizarPago";
}

export function redsysMerchantCode() {
  return requiredEnv("REDSYS_MERCHANT_CODE");
}

export function redsysTerminal() {
  return String(process.env.REDSYS_TERMINAL || "1").trim();
}

export function redsysCurrency() {
  // El terminal de pruebas facilitado por CaixaBank está configurado en EUR (978).
  return String(process.env.REDSYS_CURRENCY || "978").trim();
}

export function redsysCurrencyLabel(): "EUR" | "USD" {
  return redsysCurrency() === "840" ? "USD" : "EUR";
}
