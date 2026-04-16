export type CountryOption = {
  code: string;
  dialCode: string;
  label: string;
  hint?: string;
  aliases?: string[];
};

export const DEFAULT_COUNTRY_CODE = "ES";

export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: "AF", dialCode: "+93", label: "Afganistán" },
  { code: "AL", dialCode: "+355", label: "Albania" },
  { code: "DE", dialCode: "+49", label: "Alemania" },
  { code: "AD", dialCode: "+376", label: "Andorra" },
  { code: "AO", dialCode: "+244", label: "Angola" },
  { code: "AG", dialCode: "+1", label: "Antigua y Barbuda" },
  { code: "SA", dialCode: "+966", label: "Arabia Saudita", aliases: ["Arabia Saudí"] },
  { code: "DZ", dialCode: "+213", label: "Argelia" },
  { code: "AR", dialCode: "+54", label: "Argentina" },
  { code: "AM", dialCode: "+374", label: "Armenia" },
  { code: "AU", dialCode: "+61", label: "Australia" },
  { code: "AT", dialCode: "+43", label: "Austria" },
  { code: "AZ", dialCode: "+994", label: "Azerbaiyán" },
  { code: "BS", dialCode: "+1", label: "Bahamas" },
  { code: "BD", dialCode: "+880", label: "Bangladés", aliases: ["Bangladesh"] },
  { code: "BB", dialCode: "+1", label: "Barbados" },
  { code: "BH", dialCode: "+973", label: "Baréin", aliases: ["Bahréin", "Bahrein"] },
  { code: "BE", dialCode: "+32", label: "Bélgica" },
  { code: "BZ", dialCode: "+501", label: "Belice" },
  { code: "BJ", dialCode: "+229", label: "Benín" },
  { code: "BY", dialCode: "+375", label: "Bielorrusia" },
  { code: "MM", dialCode: "+95", label: "Birmania", aliases: ["Myanmar"] },
  { code: "BO", dialCode: "+591", label: "Bolivia" },
  { code: "BA", dialCode: "+387", label: "Bosnia y Herzegovina" },
  { code: "BW", dialCode: "+267", label: "Botsuana" },
  { code: "BR", dialCode: "+55", label: "Brasil" },
  { code: "BN", dialCode: "+673", label: "Brunéi", aliases: ["Brunei"] },
  { code: "BG", dialCode: "+359", label: "Bulgaria" },
  { code: "BF", dialCode: "+226", label: "Burkina Faso" },
  { code: "BI", dialCode: "+257", label: "Burundi" },
  { code: "BT", dialCode: "+975", label: "Bután", aliases: ["Bhután", "Bhutan"] },
  { code: "CV", dialCode: "+238", label: "Cabo Verde" },
  { code: "KH", dialCode: "+855", label: "Camboya" },
  { code: "CM", dialCode: "+237", label: "Camerún" },
  { code: "CA", dialCode: "+1", label: "Canadá" },
  { code: "QA", dialCode: "+974", label: "Catar" },
  { code: "TD", dialCode: "+235", label: "Chad" },
  { code: "CL", dialCode: "+56", label: "Chile" },
  { code: "CN", dialCode: "+86", label: "China" },
  { code: "CY", dialCode: "+357", label: "Chipre" },
  { code: "CO", dialCode: "+57", label: "Colombia" },
  { code: "KM", dialCode: "+269", label: "Comoras" },
  { code: "CG", dialCode: "+242", label: "Congo" },
  { code: "KP", dialCode: "+850", label: "Corea del Norte" },
  { code: "KR", dialCode: "+82", label: "Corea del Sur" },
  { code: "CI", dialCode: "+225", label: "Costa de Marfil" },
  { code: "CR", dialCode: "+506", label: "Costa Rica" },
  { code: "HR", dialCode: "+385", label: "Croacia" },
  { code: "CU", dialCode: "+53", label: "Cuba" },
  { code: "DK", dialCode: "+45", label: "Dinamarca" },
  { code: "DM", dialCode: "+1", label: "Dominica" },
  { code: "EC", dialCode: "+593", label: "Ecuador" },
  { code: "EG", dialCode: "+20", label: "Egipto" },
  { code: "SV", dialCode: "+503", label: "El Salvador" },
  { code: "AE", dialCode: "+971", label: "Emiratos Árabes Unidos" },
  { code: "ER", dialCode: "+291", label: "Eritrea" },
  { code: "SK", dialCode: "+421", label: "Eslovaquia" },
  { code: "SI", dialCode: "+386", label: "Eslovenia" },

  // 🔥 IMPORTANTES con hint
  { code: "ES", dialCode: "+34", label: "España", hint: "612345678" },
  { code: "US", dialCode: "+1", label: "Estados Unidos", hint: "7865394750" },
  { code: "DO", dialCode: "+1", label: "República Dominicana", hint: "8295551234" },
  { code: "PR", dialCode: "+1", label: "Puerto Rico", hint: "7879450710" },

  { code: "MX", dialCode: "+52", label: "México", hint: "5512345678" },

  // ... (todo lo demás igual, no hace falta tocarlo)
];

function digitsOnly(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeCode(code: string | null | undefined) {
  return String(code || "").trim().toUpperCase();
}

export function getCountryByCode(code: string | null | undefined): CountryOption {
  const normalized = normalizeCode(code);

  const found = COUNTRY_OPTIONS.find((item) => item.code === normalized);
  if (found) return found;

  const fallback = COUNTRY_OPTIONS.find((item) => item.code === DEFAULT_COUNTRY_CODE);
  if (fallback) return fallback;

  return {
    code: "ES",
    dialCode: "+34",
    label: "España",
    hint: "612345678",
  };
}

export function getCountryByLabelOrCode(value: string | null | undefined): CountryOption {
  const raw = String(value || "").trim();
  if (!raw) return getCountryByCode(DEFAULT_COUNTRY_CODE);

  const normalizedCode = normalizeCode(raw);
  const byCode = COUNTRY_OPTIONS.find((item) => item.code === normalizedCode);
  if (byCode) return byCode;

  const lowered = raw.toLocaleLowerCase("es-ES");

  const byLabel = COUNTRY_OPTIONS.find(
    (item) =>
      item.label.toLocaleLowerCase("es-ES") === lowered ||
      (item.aliases || []).some((alias) => alias.toLocaleLowerCase("es-ES") === lowered)
  );

  return byLabel || getCountryByCode(DEFAULT_COUNTRY_CODE);
}

export function guessDefaultCountry(): CountryOption {
  if (typeof navigator !== "undefined") {
    const locale = String(navigator.language || "").toUpperCase();
    const region = locale.includes("-") ? locale.split("-").pop() : locale;
    const directMatch = COUNTRY_OPTIONS.find((item) => item.code === region);
    if (directMatch) return directMatch;
  }
  return getCountryByCode(DEFAULT_COUNTRY_CODE);
}

export function normalizeLocalPhone(value: string) {
  return digitsOnly(value);
}

export function buildInternationalPhone(country: CountryOption | string | null | undefined, value: string) {
  const selected =
    typeof country === "string"
      ? getCountryByLabelOrCode(country)
      : country || getCountryByCode(DEFAULT_COUNTRY_CODE);

  const raw = String(value || "").trim();
  const digits = digitsOnly(raw);

  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;

  const prefixDigits = digitsOnly(selected.dialCode);
  if (!prefixDigits) return `+${digits}`;

  if (digits.startsWith(prefixDigits) && digits.length > prefixDigits.length + 4) {
    return `+${digits}`;
  }

  return `+${prefixDigits}${digits}`;
}

export function splitPhoneByCountry(phone: string | null | undefined, fallbackCountry?: CountryOption | string | null) {
  const fallback =
    typeof fallbackCountry === "string"
      ? getCountryByLabelOrCode(fallbackCountry)
      : fallbackCountry || getCountryByCode(DEFAULT_COUNTRY_CODE);

  const digits = digitsOnly(phone);

  if (!digits) {
    return {
      country: fallback,
      localPhone: "",
      internationalPhone: "",
    };
  }

  const sorted = [...COUNTRY_OPTIONS].sort(
    (a, b) => digitsOnly(b.dialCode).length - digitsOnly(a.dialCode).length
  );

  const matched = sorted.find((item) => digits.startsWith(digitsOnly(item.dialCode)));

  if (!matched) {
    return {
      country: fallback,
      localPhone: digits,
      internationalPhone: `+${digits}`,
    };
  }

  const prefixDigits = digitsOnly(matched.dialCode);
  const localPhone = digits.slice(prefixDigits.length);

  return {
    country: matched,
    localPhone,
    internationalPhone: `+${digits}`,
  };
}

export function formatCountryOptionLabel(country: CountryOption) {
  return `${country.label} (${country.dialCode})`;
}
