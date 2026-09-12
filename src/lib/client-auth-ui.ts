import type { CountryOption } from "@/lib/countries";

const EXACT_LOCAL_LENGTHS: Record<string, number> = {
  ES: 9,
  US: 10,
  PR: 10,
  DO: 10,
  MX: 10,
};

export function countryFlag(code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "🌐";
  return String.fromCodePoint(...[...normalized].map((letter) => 127397 + letter.charCodeAt(0)));
}

export function localPhoneMaxLength(country: CountryOption) {
  return EXACT_LOCAL_LENGTHS[country.code] || Math.max(7, 15 - country.dialCode.replace(/\D/g, "").length);
}

export function validateLocalPhone(country: CountryOption, value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "Escribe tu número de teléfono.";

  const exactLength = EXACT_LOCAL_LENGTHS[country.code];
  if (exactLength && digits.length !== exactLength) {
    return `El número de ${country.label} debe tener ${exactLength} dígitos.`;
  }

  const internationalLength = country.dialCode.replace(/\D/g, "").length + digits.length;
  if (internationalLength < 7 || internationalLength > 15) {
    return "Revisa el número: la longitud no parece válida.";
  }

  return "";
}

export function friendlyAuthError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error || "");
  const normalized = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (normalized.includes("INVALID_LOGIN_CREDENTIALS")) return "Teléfono o contraseña incorrectos.";
  if (normalized.includes("CLIENTE_NO_ENCONTRADO")) return "No encontramos una cuenta asociada a ese teléfono.";
  if (normalized.includes("TELEFONO_INVALIDO") || normalized.includes("PHONE_NOT_FOUND") || normalized.includes("TELEFONO_NO_VALIDO")) {
    return "Revisa el teléfono e inténtalo de nuevo.";
  }
  if (normalized.includes("PASSWORD_TOO_SHORT")) return "La contraseña debe tener al menos 6 caracteres.";
  if (normalized.includes("PASSWORDS_DO_NOT_MATCH")) return "Las contraseñas no coinciden.";
  if (normalized.includes("DATOS_INCOMPLETOS")) return "Completa todos los datos para continuar.";
  if (normalized.includes("OTP") && normalized.includes("EXPIRED")) return "El código ha caducado. Solicita uno nuevo.";
  if (normalized.includes("OTP") || normalized.includes("CODIGO")) return "El código no es válido. Revísalo e inténtalo otra vez.";
  if (normalized.includes("RATE") || normalized.includes("TOO_MANY")) return "Has realizado varios intentos. Espera un momento y vuelve a probar.";
  if (normalized.includes("FETCH") || normalized.includes("NETWORK")) return "No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.";

  return fallback;
}
