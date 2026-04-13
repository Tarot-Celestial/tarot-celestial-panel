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
  { code: "ES", dialCode: "+34", label: "España", hint: "612 345 678" },
  { code: "US", dialCode: "+1", label: "Estados Unidos", hint: "786 539 4750" },
  { code: "EE", dialCode: "+372", label: "Estonia" },
  { code: "SZ", dialCode: "+268", label: "Esuatini", aliases: ["Swazilandia"] },
  { code: "ET", dialCode: "+251", label: "Etiopía" },
  { code: "PH", dialCode: "+63", label: "Filipinas" },
  { code: "FI", dialCode: "+358", label: "Finlandia" },
  { code: "FJ", dialCode: "+679", label: "Fiyi" },
  { code: "FR", dialCode: "+33", label: "Francia" },
  { code: "GA", dialCode: "+241", label: "Gabón" },
  { code: "GM", dialCode: "+220", label: "Gambia" },
  { code: "GE", dialCode: "+995", label: "Georgia" },
  { code: "GH", dialCode: "+233", label: "Ghana" },
  { code: "GD", dialCode: "+1", label: "Granada" },
  { code: "GR", dialCode: "+30", label: "Grecia" },
  { code: "GT", dialCode: "+502", label: "Guatemala" },
  { code: "GN", dialCode: "+224", label: "Guinea" },
  { code: "GQ", dialCode: "+240", label: "Guinea Ecuatorial" },
  { code: "GW", dialCode: "+245", label: "Guinea-Bisáu", aliases: ["Guinea-Bissau"] },
  { code: "GY", dialCode: "+592", label: "Guyana" },
  { code: "HT", dialCode: "+509", label: "Haití" },
  { code: "HN", dialCode: "+504", label: "Honduras" },
  { code: "HU", dialCode: "+36", label: "Hungría" },
  { code: "IN", dialCode: "+91", label: "India" },
  { code: "ID", dialCode: "+62", label: "Indonesia" },
  { code: "IQ", dialCode: "+964", label: "Irak" },
  { code: "IR", dialCode: "+98", label: "Irán" },
  { code: "IE", dialCode: "+353", label: "Irlanda" },
  { code: "IS", dialCode: "+354", label: "Islandia" },
  { code: "MH", dialCode: "+692", label: "Islas Marshall" },
  { code: "SB", dialCode: "+677", label: "Islas Salomón" },
  { code: "IL", dialCode: "+972", label: "Israel" },
  { code: "IT", dialCode: "+39", label: "Italia" },
  { code: "JM", dialCode: "+1", label: "Jamaica" },
  { code: "JP", dialCode: "+81", label: "Japón" },
  { code: "JO", dialCode: "+962", label: "Jordania" },
  { code: "KZ", dialCode: "+7", label: "Kazajistán" },
  { code: "KE", dialCode: "+254", label: "Kenia" },
  { code: "KG", dialCode: "+996", label: "Kirguistán" },
  { code: "KI", dialCode: "+686", label: "Kiribati" },
  { code: "KW", dialCode: "+965", label: "Kuwait" },
  { code: "LA", dialCode: "+856", label: "Laos" },
  { code: "LS", dialCode: "+266", label: "Lesoto" },
  { code: "LV", dialCode: "+371", label: "Letonia" },
  { code: "LB", dialCode: "+961", label: "Líbano" },
  { code: "LR", dialCode: "+231", label: "Liberia" },
  { code: "LY", dialCode: "+218", label: "Libia" },
  { code: "LI", dialCode: "+423", label: "Liechtenstein" },
  { code: "LT", dialCode: "+370", label: "Lituania" },
  { code: "LU", dialCode: "+352", label: "Luxemburgo" },
  { code: "MK", dialCode: "+389", label: "Macedonia del Norte" },
  { code: "MG", dialCode: "+261", label: "Madagascar" },
  { code: "MY", dialCode: "+60", label: "Malasia" },
  { code: "MW", dialCode: "+265", label: "Malaui", aliases: ["Malawi"] },
  { code: "MV", dialCode: "+960", label: "Maldivas" },
  { code: "ML", dialCode: "+223", label: "Malí" },
  { code: "MT", dialCode: "+356", label: "Malta" },
  { code: "MA", dialCode: "+212", label: "Marruecos" },
  { code: "MU", dialCode: "+230", label: "Mauricio" },
  { code: "MR", dialCode: "+222", label: "Mauritania" },
  { code: "MX", dialCode: "+52", label: "México" },
  { code: "FM", dialCode: "+691", label: "Micronesia" },
  { code: "MD", dialCode: "+373", label: "Moldavia" },
  { code: "MC", dialCode: "+377", label: "Mónaco" },
  { code: "MN", dialCode: "+976", label: "Mongolia" },
  { code: "ME", dialCode: "+382", label: "Montenegro" },
  { code: "MZ", dialCode: "+258", label: "Mozambique" },
  { code: "NA", dialCode: "+264", label: "Namibia" },
  { code: "NR", dialCode: "+674", label: "Nauru" },
  { code: "NP", dialCode: "+977", label: "Nepal" },
  { code: "NI", dialCode: "+505", label: "Nicaragua" },
  { code: "NE", dialCode: "+227", label: "Níger" },
  { code: "NG", dialCode: "+234", label: "Nigeria" },
  { code: "NO", dialCode: "+47", label: "Noruega" },
  { code: "NZ", dialCode: "+64", label: "Nueva Zelanda" },
  { code: "OM", dialCode: "+968", label: "Omán" },
  { code: "NL", dialCode: "+31", label: "Países Bajos", aliases: ["Holanda"] },
  { code: "PK", dialCode: "+92", label: "Pakistán" },
  { code: "PW", dialCode: "+680", label: "Palaos" },
  { code: "PS", dialCode: "+970", label: "Palestina" },
  { code: "PA", dialCode: "+507", label: "Panamá" },
  { code: "PG", dialCode: "+675", label: "Papúa Nueva Guinea" },
  { code: "PY", dialCode: "+595", label: "Paraguay" },
  { code: "PE", dialCode: "+51", label: "Perú" },
  { code: "PL", dialCode: "+48", label: "Polonia" },
  { code: "PT", dialCode: "+351", label: "Portugal" },
  { code: "GB", dialCode: "+44", label: "Reino Unido" },
  { code: "CF", dialCode: "+236", label: "República Centroafricana" },
  { code: "CZ", dialCode: "+420", label: "República Checa", aliases: ["Chequia"] },
  { code: "DO", dialCode: "+1", label: "República Dominicana", hint: "829 555 1234" },
  { code: "CD", dialCode: "+243", label: "República Democrática del Congo" },
  { code: "RW", dialCode: "+250", label: "Ruanda" },
  { code: "RO", dialCode: "+40", label: "Rumanía", aliases: ["Rumania"] },
  { code: "RU", dialCode: "+7", label: "Rusia" },
  { code: "WS", dialCode: "+685", label: "Samoa" },
  { code: "KN", dialCode: "+1", label: "San Cristóbal y Nieves" },
  { code: "SM", dialCode: "+378", label: "San Marino" },
  { code: "VC", dialCode: "+1", label: "San Vicente y las Granadinas" },
  { code: "LC", dialCode: "+1", label: "Santa Lucía" },
  { code: "ST", dialCode: "+239", label: "Santo Tomé y Príncipe" },
  { code: "SN", dialCode: "+221", label: "Senegal" },
  { code: "RS", dialCode: "+381", label: "Serbia" },
  { code: "SC", dialCode: "+248", label: "Seychelles" },
  { code: "SL", dialCode: "+232", label: "Sierra Leona" },
  { code: "SG", dialCode: "+65", label: "Singapur" },
  { code: "SY", dialCode: "+963", label: "Siria" },
  { code: "SO", dialCode: "+252", label: "Somalia" },
  { code: "LK", dialCode: "+94", label: "Sri Lanka" },
  { code: "ZA", dialCode: "+27", label: "Sudáfrica" },
  { code: "SD", dialCode: "+249", label: "Sudán" },
  { code: "SS", dialCode: "+211", label: "Sudán del Sur" },
  { code: "SE", dialCode: "+46", label: "Suecia" },
  { code: "CH", dialCode: "+41", label: "Suiza" },
  { code: "SR", dialCode: "+597", label: "Surinam" },
  { code: "TH", dialCode: "+66", label: "Tailandia" },
  { code: "TW", dialCode: "+886", label: "Taiwán" },
  { code: "TZ", dialCode: "+255", label: "Tanzania" },
  { code: "TJ", dialCode: "+992", label: "Tayikistán" },
  { code: "TL", dialCode: "+670", label: "Timor Oriental" },
  { code: "TG", dialCode: "+228", label: "Togo" },
  { code: "TO", dialCode: "+676", label: "Tonga" },
  { code: "TT", dialCode: "+1", label: "Trinidad y Tobago" },
  { code: "TN", dialCode: "+216", label: "Túnez" },
  { code: "TM", dialCode: "+993", label: "Turkmenistán" },
  { code: "TR", dialCode: "+90", label: "Turquía" },
  { code: "TV", dialCode: "+688", label: "Tuvalu" },
  { code: "UA", dialCode: "+380", label: "Ucrania" },
  { code: "UG", dialCode: "+256", label: "Uganda" },
  { code: "UY", dialCode: "+598", label: "Uruguay" },
  { code: "UZ", dialCode: "+998", label: "Uzbekistán" },
  { code: "VU", dialCode: "+678", label: "Vanuatu" },
  { code: "VA", dialCode: "+379", label: "Vaticano" },
  { code: "VE", dialCode: "+58", label: "Venezuela" },
  { code: "VN", dialCode: "+84", label: "Vietnam" },
  { code: "YE", dialCode: "+967", label: "Yemen" },
  { code: "DJ", dialCode: "+253", label: "Yibuti" },
  { code: "ZM", dialCode: "+260", label: "Zambia" },
  { code: "ZW", dialCode: "+263", label: "Zimbabue" },
  { code: "PR", dialCode: "+1", label: "Puerto Rico", hint: "787 945 0710" },
];

function digitsOnly(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeCode(code: string | null | undefined) {
  return String(code || "").trim().toUpperCase();
}

export function getCountryByCode(code: string | null | undefined): CountryOption {
  const normalized = normalizeCode(code);
  return COUNTRY_OPTIONS.find((item) => item.code === normalized) || COUNTRY_OPTIONS.find((item) => item.code === DEFAULT_COUNTRY_CODE) || COUNTRY_OPTIONS[0];
}

export function getCountryByLabelOrCode(value: string | null | undefined): CountryOption {
  const raw = String(value || "").trim();
  if (!raw) return getCountryByCode(DEFAULT_COUNTRY_CODE);
  const normalizedCode = normalizeCode(raw);
  const byCode = COUNTRY_OPTIONS.find((item) => item.code === normalizedCode);
  if (byCode) return byCode;

  const lowered = raw.toLocaleLowerCase("es-ES");
  const byLabel = COUNTRY_OPTIONS.find((item) => item.label.toLocaleLowerCase("es-ES") === lowered || (item.aliases || []).some((alias) => alias.toLocaleLowerCase("es-ES") === lowered));
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
  const selected = typeof country === "string" ? getCountryByLabelOrCode(country) : country || getCountryByCode(DEFAULT_COUNTRY_CODE);
  const raw = String(value || "").trim();
  const digits = digitsOnly(raw);
  if (!digits) return "";
  if (raw.startsWith("+")) return `+${digits}`;
  const prefixDigits = digitsOnly(selected.dialCode);
  if (!prefixDigits) return `+${digits}`;
  if (digits.startsWith(prefixDigits) && digits.length > prefixDigits.length + 4) return `+${digits}`;
  return `+${prefixDigits}${digits}`;
}

export function splitPhoneByCountry(phone: string | null | undefined, fallbackCountry?: CountryOption | string | null) {
  const fallback = typeof fallbackCountry === "string" ? getCountryByLabelOrCode(fallbackCountry) : fallbackCountry || getCountryByCode(DEFAULT_COUNTRY_CODE);
  const digits = digitsOnly(phone);
  if (!digits) {
    return {
      country: fallback,
      localPhone: "",
      internationalPhone: "",
    };
  }

  const sorted = [...COUNTRY_OPTIONS].sort((a, b) => digitsOnly(b.dialCode).length - digitsOnly(a.dialCode).length);
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
