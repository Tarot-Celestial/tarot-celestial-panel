import { COUNTRY_OPTIONS } from "@/lib/countries";

export type CaptureJob = {
  id: string; request_id: string; lease_token: string; channel: "instagram" | "facebook" | "meta_form" | "whatsapp";
  kind: "message" | "comment" | "form"; account_id: string; thread_id: string | null; thread_key: string;
  source_id: string; source_at: string; latest_inbound_at: string; window_until: string | null; recipient_id: string | null;
  actor_user_id: string | null; actor_worker_id: string | null; market: string | null; opted_out: boolean; whatsapp_consent: boolean;
  session_id: string | null; lead_id: string | null; client_id: string | null; inbound_text: string | null;
};
export type ContactRoute = "clarify_request" | "ask_country" | "phone" | "oracle" | "public_invite" | "whatsapp_template";
export class DispatchDecision extends Error {
  constructor(public code: string, public outcome: "blocked" | "handoff" | "failed" | "uncertain" = "handoff") { super(code); }
}
export type SocialProof = {
  accountId: string; peerId: string | null; sourceId: string; sourceAt: string; text: string;
  privateAllowed: boolean; publicAllowed: boolean; lastReplyAt: string | null; senderPhone?: string;
  followsConsultation?: boolean;
  countryHistory?: { earlierHidden:boolean; events:{id:string; at:string; kind:"sent"|"country"|"other"}[] };
};
export type InstagramCountryPrompt = {route:"ask_country"; remote_id:string; completed_at:string};
const plain = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const countryNames = new Intl.DisplayNames(["es"], { type: "region" });
const names = new Map<string, string>();
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b), label = countryNames.of(code);
  if (label && label !== code && !["ZZ","EU","UN","XA","XB"].includes(code)) names.set(plain(label), code);
}
for (const country of COUNTRY_OPTIONS) {
  for (const label of [country.label, ...(country.aliases || [])]) names.set(plain(label), country.code);
}
for (const [alias, iso] of [["usa","US"],["eeuu","US"],["ee uu","US"],["united states","US"],["spain","ES"],["dominicana","DO"],["puerto rico","PR"]]) names.set(alias,iso);
const countries = new Set(names.values());
const regionAlternatives = [...names.keys()].filter(Boolean).sort((a,b) => b.length-a.length).join("|");
const locationStatement = new RegExp("\\b(?:(no|ya no) )?(soy de|estoy en|vivo en|escribo de|escribo desde|consultar desde|llamar desde|i live in|i am from|im from) (?:la |el |los )?(" + regionAlternatives + ")(?= |$)", "g");

export function explicitMarket(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim(), code = trimmed.toUpperCase();
  return countries.has(code) ? code : names.get(plain(trimmed)) || null;
}
/** Accept an entire country answer. A place named in someone else's story is not a reply to the question. */
export function countryAnswer(text:string):string|null {
  const answer = text.trim().replace(/^(?:hola[,!\s]+)?(?:desde|soy de|estoy en|vivo en|(?:te |les )?escribo desde)\s+(?:(?:el|la|los)\s+)?/iu,"");
  return names.get(plain(answer)) || (/^[A-Z]{2}$/.test(answer) ? explicitMarket(answer) : null);
}
export function readMessageMarket(text: string): {market: string | null; needsCountry: boolean} {
  const normalized = plain(text);
  const wholeAnswer = countryAnswer(text);
  if (wholeAnswer) return {market:wholeAnswer, needsCountry:false};
  const origins = new Set<string>(), locations = new Set<string>();
  const deniedOrigins = new Set<string>(), deniedLocations = new Set<string>();
  const demonyms: [RegExp,string][] = [
    [/\b(?:soy (?:de nacionalidad )?|soja )argentin[oa]\b/,"AR"], [/\bsoy puertorriquen[oa]\b/,"PR"],
    [/\bsoy espan(?:ol|ola)\b/,"ES"], [/\bsoy dominican[oa]\b/,"DO"], [/\bsoy chilen[oa]\b/,"CL"],
    [/\bsoy colombian[oa]\b/,"CO"], [/\bsoy estadounidense\b/,"US"],
  ];
  for (const [pattern,code] of demonyms) if (pattern.test(normalized) && !/\bno soy\b/.test(normalized)) origins.add(code);
  for (const [,negative,phrase,name] of normalized.matchAll(locationStatement)) {
    const code = names.get(name)!;
    const origin = ["soy de","i am from","im from"].includes(phrase);
    if (negative) (origin ? deniedOrigins : deniedLocations).add(code);
    else (origin ? origins : locations).add(code);
  }
  const candidates = locations.size ? locations : origins;
  const allowed = [...candidates].filter(code => !deniedLocations.has(code) && (locations.size || !deniedOrigins.has(code)));
  const market = allowed.length === 1 ? allowed[0] : null;
  return {market,needsCountry:!market && (candidates.size>0 || deniedOrigins.size>0 || deniedLocations.size>0)};
}
export function messageMarket(text: string): string | null {
  return readMessageMarket(text).market;
}
export function asksToStop(text: string): boolean {
  const value = plain(text);
  return /^(?:stop|unsubscribe|cancelar suscripcion|baja|borrame|no me interesa)(?: |$)/.test(value) ||
    /\b(?:no (?:me )?(?:escriban|escribas|contacten|contactes|envien|manden)|no quiero (?:mas )?(?:mensajes|publicidad|promociones)|dejen de escribirme|do not (?:contact|message|text) me|stop (?:texting|messaging))\b/.test(value);
}
export function consultationIntent(text: string, channel: CaptureJob["channel"], kind: CaptureJob["kind"], previousRoute: ContactRoute | null): "oracle" | "consultation" | "greeting" | null {
  const value = plain(text);
  if (!value || asksToStop(text) || /\b(?:reembolso|devolucion|denuncia|queja|urgencia|suicid|medicamento|chargeback|refund|no me interesa|factura|banco|proveedor|soporte tecnico)\w*/.test(value)) return null;
  if (/\b(?:no (?:me )?(?:funciona|abre|carga)|no consigo (?:entrar|registrarme)|ya (?:llame|pague|compre)|me (?:han )?cobrado|hablar con (?:una? )?(?:persona|agente|operador)|quiero agradecer|gracias por (?:la|tu|su) (?:consulta|lectura)|amarres?|recomiendo)\b/.test(value)) return null;
  const cannotCall = /\bno (?:quiero|puedo) (?:llamar|consultar por telefono)\b/;
  if (previousRoute === "phone" && /^(?:(?:hola|gracias|lo siento) )?no (?:quiero|puedo) llamar(?: (?:ahora|por telefono))?(?: (?:hay otra (?:opcion|forma)|que otra opcion hay|puedo consultar (?:online|en linea)))?$/.test(value)) return "oracle";
  const request = value.replace(cannotCall, "").trim();
  if (/\bno (?:quiero|necesito|deseo|busco|me gustaria)\b/.test(request)) return null;
  // A request for the digital reading has a destination even without a country.
  // A request to speak to a tarot reader online is a different service.
  if (/\b(?:quiero|quisiera|prefiero|busco|me interesa|como (?:entro|accedo)|puedo (?:entrar|acceder|probar)) (?:hacer |probar |usar |entrar (?:en |a )?|acceder (?:a )?)?(?:el |al |la |una |mi )?(?:oraculo|(?:primera )?tirada (?:online|en linea|del oraculo))\b/.test(request)) return "oracle";
  if (cannotCall.test(value)) return null;
  if (previousRoute === "ask_country" && messageMarket(text)) return "consultation";
  if (kind === "message" && ["instagram","facebook"].includes(channel) && /^(?:hola|buenas|buenos dias|buenas tardes|buenas noches|hello|hi)(?: que tal)?$/.test(value)) return previousRoute ? null : "greeting";
  const interested = /\b(?:quiero|quisiera|querria|queria|puedo|podria|podemos|necesito|puede|como|donde|cuanto|cuesta|vale|interesa|gustaria)\b.{0,55}\b(?:consulta\w*|lectura|tarot(?:istas?)?|tirada|oraculo|cartas|llamar|reading)\b/.test(value) ||
    /\b(?:precio|informacion|info|detalles|numero|telefono|horario) (?:de|sobre|para) (?:la |una |el |las )?(?:consulta|lectura|tarot|tirada|oraculo|llamar)\b/.test(value) ||
    /^(?:info|informacion|precio|quiero informacion|me interesa|como puedo consultar|consulta de tarot|cuanto cuesta la consulta)$/.test(value);
  return interested ? "consultation" : null;
}
export function openWindow(sourceAt: string, hours: number, now = Date.now()) {
  const t = Date.parse(sourceAt);
  return Number.isFinite(t) && t <= now && now - t < hours * 3600000;
}
export function socialReplyText(route: ContactRoute, value?: string, panelLink?: string) {
  switch (route) {
    case "clarify_request": return "¡Hola! Gracias por escribir a Tarot Celestial. ¿En qué podemos ayudarte?";
    case "public_invite": return "Gracias por escribir a Tarot Celestial. Envíanos un mensaje privado y te indicaremos cómo consultar desde tu país.";
    case "ask_country": return "Hola, somos el equipo de Tarot Celestial. ¿Desde qué país nos escribes? Así podemos indicarte cómo consultar.";
    case "phone": return "Puedes llamar a Tarot Celestial al " + value + " para consultar. " + (panelLink
      ? "Si quieres vincular esta conversación con tu ficha de cliente, puedes hacerlo en tu panel: " + panelLink
      : "Si necesitas ayuda, responde por aquí y continuamos en privado.");
    case "oracle": return "Puedes consultar desde tu país con el Oráculo de Tarot Celestial. La primera tirada es gratis al registrarte. Después puedes elegir las opciones de pago del panel. Entra aquí: " + value;
    default: throw new DispatchDecision("INVALID_TEMPLATE", "failed");
  }
}

type HistoryMessage = { id: string; fromMe: boolean; createdAt: string; text: string };
export function instagramCountryHistory(incoming:HistoryMessage,messages:HistoryMessage[],earlierHidden:boolean):SocialProof["countryHistory"] {
  const market = countryAnswer(incoming.text);
  if (!market) return undefined;
  return {earlierHidden,events:messages.map(message => ({id:message.id,at:message.createdAt,
    kind:message.fromMe ? "sent" : countryAnswer(message.text) === market ? "country" : "other"}))};
}
export function answersCommentPrompt(proof:SocialProof,prompt:InstagramCountryPrompt) {
  const history=proof.countryHistory, completed=Date.parse(prompt.completed_at);
  if (!history || !history.events.length || prompt.route !== "ask_country" || typeof prompt.remote_id !== "string" || !prompt.remote_id ||
      !openWindow(prompt.completed_at,24,Date.parse(proof.sourceAt)) || Date.parse(proof.sourceAt) <= completed) return false;
  const incoming=history.events[history.events.length-1];
  if (incoming.id!==proof.sourceId || incoming.kind!=="country" || incoming.at!==proof.sourceAt) return false;
  // Graph timestamps have second precision. Treat any other activity in that second as ambiguous.
  const threshold=Math.floor(completed/1000)*1000;
  if (proof.lastReplyAt && Date.parse(proof.lastReplyAt) >= threshold) return false;
  if (history.earlierHidden && !history.events.some(e=>Date.parse(e.at)<=threshold || (e.kind==="sent" && e.id===prompt.remote_id))) return false;
  return history.events.every(e=>Number.isFinite(Date.parse(e.at)) && (Date.parse(e.at)<threshold || e.kind==="country" ||
    (e.kind==="sent" && e.id===prompt.remote_id)));
}
/** The previous country DM, our confirmed line, and the same country again must be adjacent in live Graph history. */
export function alreadyAnsweredCountry(proof:SocialProof,attempt:{route:string; receipt_id?:string; source_id?:string; completed_at:string}|null) {
  const events = proof.countryHistory?.events;
  if (attempt?.route !== "phone" || !attempt.receipt_id || !events || events.length < 3) return false;
  const [first,sent,repeat] = events.slice(-3);
  const firstAt=Date.parse(first.at), sentAt=Date.parse(sent.at), repeatAt=Date.parse(repeat.at);
  return first.kind==="country" && first.id===attempt.source_id && sent.kind==="sent" && sent.id===attempt.receipt_id &&
    repeat.kind==="country" && repeat.id===proof.sourceId && firstAt<sentAt && sentAt<repeatAt && repeatAt-firstAt<=5*60000 &&
    Date.parse(attempt.completed_at)<repeatAt && (!proof.lastReplyAt || Date.parse(proof.lastReplyAt)<=Date.parse(attempt.completed_at));
}
/** Two consecutive DMs can split the request and country. Use only the adjacent, unanswered request. */
export function followsInstagramConsultation(incoming:HistoryMessage, messages:HistoryMessage[], lastReplyAt:string|null) {
  if (!messageMarket(incoming.text)) return false;
  const index = messages.findIndex(message => message.id === incoming.id);
  const prior = messages[index - 1];
  if (!prior || prior.fromMe) return false;
  const elapsed = Date.parse(incoming.createdAt) - Date.parse(prior.createdAt);
  if (!(elapsed > 0 && elapsed <= 5 * 60000) || (lastReplyAt && Date.parse(lastReplyAt) >= Date.parse(prior.createdAt))) return false;
  return consultationIntent(prior.text,"instagram","message",null) === "consultation";
}
/** Compare the actual inbound with the trigger. A manual/provider reply or later peer message cancels the prepared answer. */
export function verifyHistory(job: Pick<CaptureJob, "channel" | "kind" | "source_id" | "latest_inbound_at">,
  messages: HistoryMessage[], partial: boolean, lastReplyAt: string | null) {
  if (partial) throw new DispatchDecision("INCOMPLETE_HISTORY");
  const id = (value: string) => job.channel === "facebook" && job.kind === "comment" && /^\d+_\d+$/.test(value) ? value.split("_")[1] : value;
  const incoming = messages.find(msg => id(msg.id) === job.source_id && !msg.fromMe);
  if (!incoming || !incoming.text || !Number.isFinite(Date.parse(incoming.createdAt))) throw new DispatchDecision("INBOUND_UNVERIFIED");
  const t = Date.parse(incoming.createdAt);
  if (Math.abs(t - Date.parse(job.latest_inbound_at)) >= 60000 || !Number.isFinite(Date.parse(job.latest_inbound_at))) throw new DispatchDecision("INBOUND_TIME_CHANGED");
  const later = messages.filter(msg => msg.id !== incoming.id && Date.parse(msg.createdAt) >= t);
  if (lastReplyAt && Date.parse(lastReplyAt) >= t) throw new DispatchDecision("CONVERSATION_CHANGED");
  if (later.length) {
    if (job.channel === "instagram" && job.kind === "message" && later.every(msg => !msg.fromMe && Date.parse(msg.createdAt) > t)) {
      throw new DispatchDecision("NEWER_INSTAGRAM_DM","blocked");
    }
    throw new DispatchDecision("CONVERSATION_CHANGED");
  }
  return incoming;
}
