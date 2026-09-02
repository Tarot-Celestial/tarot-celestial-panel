import { createCipheriv, createHmac, timingSafeEqual } from "crypto";

export const REDSYS_SIGNATURE_VERSION = "HMAC_SHA512_V2";

function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function base64UrlFromBuffer(value: Buffer) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizeSignature(value: string) {
  return String(value || "").trim().replace(/=+$/g, "");
}

/**
 * Redsys HMAC_SHA512_V2 diversifies the merchant key with AES-128-CBC.
 * The configured secret is treated as text and adjusted to exactly 16 chars.
 */
function deriveOrderKey(order: string) {
  const secret = requiredEnv("REDSYS_SECRET_KEY");
  const keyText = secret.length >= 16 ? secret.slice(0, 16) : secret.padEnd(16, "0");

  const cipher = createCipheriv(
    "aes-128-cbc",
    Buffer.from(keyText, "utf8"),
    Buffer.alloc(16, 0),
  );

  const encrypted = Buffer.concat([cipher.update(order, "utf8"), cipher.final()]);

  // Redsys V2 uses the Base64 text of the diversified key as the HMAC key.
  return encrypted.toString("base64");
}

export function encodeMerchantParameters(parameters: Record<string, string>) {
  return base64UrlFromBuffer(Buffer.from(JSON.stringify(parameters), "utf8"));
}

export function decodeMerchantParameters(encoded: string): Record<string, string> {
  const text = Buffer.from(encoded, "base64url").toString("utf8");
  return JSON.parse(text);
}

export function createRedsysSignature(merchantParameters: string, order: string) {
  const diversifiedKeyBase64 = deriveOrderKey(order);
  return createHmac("sha512", Buffer.from(diversifiedKeyBase64, "utf8"))
    .update(merchantParameters, "utf8")
    .digest("base64url");
}

export function verifyRedsysSignature(merchantParameters: string, signature: string, order: string) {
  const expected = Buffer.from(normalizeSignature(createRedsysSignature(merchantParameters, order)), "utf8");
  const received = Buffer.from(normalizeSignature(signature), "utf8");
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
  // 840 = USD. El terminal Redsys debe tener habilitada esta divisa.
  return String(process.env.REDSYS_CURRENCY || "840").trim();
}
