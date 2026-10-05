import type { RouletteSummary } from "@/lib/ruleta";
import type { ClientRankGuide } from "@/lib/client-rank-guide";

export const LEO_SELECT_ROULETTE = "tc-leo-select-roulette";
export const LEO_SECTIONS = [
  { key: "dashboard", path: "/cliente/dashboard", label: "Inicio", hint: "Tus minutos, Coins y accesos principales." },
  { key: "promotions", path: "/cliente/precios-ofertas", label: "Precios y ofertas", hint: "Compara el precio final y todo lo que incluye cada paquete antes de comprar." },
  { key: "ranks", path: "/cliente/rangos", label: "Rangos del cliente", hint: "Consulta tu rango, tu progreso de los últimos 30 días y las ventajas de cada rango." },
  { key: "oracle", path: "/cliente/oraculo", label: "Oráculo", hint: "Elige tu consulta y revisa las tiradas disponibles antes de empezar." },
  { key: "roulette", path: "/cliente/ruleta", label: "Ruleta", hint: "Cada ruleta tiene sus propios giros. Te llevo a la que puedes utilizar." },
  { key: "raffle", path: "/cliente/sorteo", label: "Sorteo", hint: "Consulta los sorteos y las participaciones que aparecen en tu cuenta." },
  { key: "tarotists", path: "/cliente/tarotistas", label: "Tarotistas", hint: "Revisa los perfiles y la disponibilidad indicada antes de elegir con quién consultar." },
  { key: "reviews", path: "/cliente/resenas", label: "Reseñas", hint: "Consulta opiniones, valoraciones y los perfiles de las tarotistas." },
  { key: "ritual", path: "/cliente/ritual", label: "Mi ritual", hint: "Sigue las etapas y el historial de tus rituales desde este espacio." },
  { key: "notifications", path: "/cliente/notificaciones", label: "Notificaciones", hint: "Aquí puedes comprobar avisos de compras, premios y regalos. Usa el filtro de no leídas." },
  { key: "profile", path: "/cliente/perfil", label: "Perfil", hint: "Revisa tus datos y utiliza los controles del formulario para guardar tus cambios." },
] as const;
export const LEO_LEVEL_NAMES = ["", "Bronce Celestial", "Plata Celestial", "Corona Astral", "Ruleta Especial", "Ruleta Diamante"];
export type LeoTopic = "context" | "roulette" | "balance" | "rank" | "daily" | "oracle" | "prizes" | "sections" | "unknown";
export type LeoAction = { id: string; label: string; path: string; anchor: string; explanation: string; level?: number };
export type LeoSnapshot = {
  roulette: RouletteSummary | null;
  ranks: ClientRankGuide | null;
  wallet: { coins: number; minutes: number; oracleCredits: number | null; activePromotion: { name: string } | null } | null;
  bonuses: Array<{ id: string; name: string; claimed_today?: boolean; next_available_at?: string }> | null;
  oracle: { credits: number; freeAvailable: boolean } | null;
  pending?: { level: number } | null;
  updatedAt: number;
};
export type LeoHelp = { title: string; message: string; actions: LeoAction[]; note?: string };
export const emptyLeoSnapshot = (): LeoSnapshot => ({ roulette: null, ranks: null, wallet: null, bonuses: null, oracle: null, updatedAt: 0 });
export function leoSection(path: string) { return LEO_SECTIONS.find(s => path.split('?')[0].startsWith(s.path)) || LEO_SECTIONS[0]; }
const count = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
const money = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "USD" });
export function leoAction(id: string, label: string, path: string, anchor: string, explanation: string, level?: number): LeoAction { return { id, label, path, anchor, explanation, level }; }
export function leoSpins(summary: RouletteSummary | null) {
  if (!summary) return [];
  return [1, 2, 3, 4, 5].map(level => {
    const amount = count((summary as any)[`level_${level}_spins`]);
    const locked = level === 5 && !summary.diamond_access;
    const hasPrizes = summary.catalogue?.some(p => p.nivel === level);
    const playable = amount > 0 && !locked && !!hasPrizes && !!(summary as any)[`next_spin_${level}`];
    return { level, name: LEO_LEVEL_NAMES[level], amount, playable, reason: locked ? "Acceso Diamante no disponible" : !hasPrizes ? "Sin premios activos" : !playable && amount > 0 ? "Pendiente de disponibilidad" : amount ? "Listo para ti" : "Sin giros", action: leoAction(`roulette-${level}`, `Ver ${LEO_LEVEL_NAMES[level]}`, `/cliente/ruleta?nivel=${level}`, `roulette-${level}`, playable ? `Aquí tienes ${amount} giro${amount === 1 ? "" : "s"}. Revisa los premios y pulsa «Girar ahora» cuando estés lista.` : "Aquí puedes consultar el estado y los premios de esta ruleta.", level) };
  });
}
export function safeLeoPath(value: unknown): value is string {
  return typeof value === "string" && /^\/cliente\/(dashboard|precios-ofertas|rangos|oraculo|ruleta|sorteo|tarotistas|resenas|ritual|notificaciones|perfil)(?:[?#][^\s]*)?$/.test(value) && !value.includes('\\');
}
export function leoSelector(anchor: string): string | null {
  if (/^roulette-[1-5]$/.test(anchor)) return `[data-leo-anchor="${anchor}"]`;
  if (/^rank-(bronce|plata|oro|diamante)$/.test(anchor)) return `#rango-${anchor.slice(5)}`;
  const map: Record<string, string> = {
    content: '[data-leo-anchor="page-content"]', navigation: '[data-leo-anchor="navigation"]',
    coins: '#saldo-coins', minutes: '#saldo-minutes', rank: '[data-leo-anchor="rank-progress"]',
    daily: '[data-leo-anchor="daily-bonus"]', promotion: '[data-leo-anchor="promotion-featured"], [data-leo-anchor="active-promotion"]',
    recovery: '[data-leo-anchor="roulette-recovery"]', history: '[data-leo-anchor="roulette-history"]', prizes: '[data-leo-anchor="roulette-entitlements"]',
    tarotists: '[data-leo-page="/cliente/tarotistas"]', oracle: '[data-leo-page="/cliente/oraculo"]',
    profile: '[data-leo-page="/cliente/perfil"]', notifications: '[data-leo-page="/cliente/notificaciones"]',
    reviews: '[data-leo-page="/cliente/resenas"]', raffle: '[data-leo-page="/cliente/sorteo"]', ritual: '[data-leo-page="/cliente/ritual"]',
  };
  return map[anchor] || null;
}
export function validLeoAction(action: any): action is LeoAction { return !!action && safeLeoPath(action.path) && !!leoSelector(action.anchor) && typeof action.explanation === 'string' && action.explanation.length < 800 && typeof action.label === 'string' && (!action.level || [1,2,3,4,5].includes(action.level)); }
const sectionAction = (path: string, anchor = "content") => {
  const section = leoSection(path);
  return leoAction(section.key, `Ir a ${section.label}`, section.path, anchor, section.hint);
};
export function leoHelp(data: LeoSnapshot, path: string, topic: LeoTopic): LeoHelp {
  const section = leoSection(path);
  if (topic === "context") {
    const bySection: Record<string, LeoTopic> = { roulette: "roulette", ranks: "rank", oracle: "oracle", dashboard: "balance" };
    if (bySection[section.key]) return leoHelp(data, path, bySection[section.key]);
    if (section.key === "promotions") return { title: "Elige con toda la información", message: data.wallet?.activePromotion ? `La promoción «${data.wallet.activePromotion.name}» está activa. Vamos a revisar sus paquetes, minutos y extras.` : section.hint, actions: [sectionAction(path, data.wallet?.activePromotion ? 'promotion' : 'content')] };
    return { title: `Te acompaño en ${section.label}`, message: section.hint, actions: [sectionAction(path, section.key === 'reviews' || section.key === 'profile' || section.key === 'notifications' || section.key === 'tarotists' || section.key === 'raffle' || section.key === 'ritual' ? section.key : 'content')], note: "Puedes preguntarme por tus giros, saldo, rango o cómo moverte por el panel." };
  }
  if (topic === 'roulette') {
    if(data.pending) return { title: 'Vamos a comprobar tu último giro', message: 'Hay un resultado pendiente de confirmar. Utiliza «Comprobar giro pendiente» para recuperarlo sin gastar otro giro.', actions: [leoAction('recover','Comprobar mi resultado','/cliente/ruleta?nivel='+data.pending.level,'recovery','Pulsa «Comprobar giro pendiente». El sistema recuperará el resultado de ese mismo giro.',data.pending.level)] };
    if (!data.roulette) return { title: "Vamos a encontrar tus giros", message: "Ahora no puedo confirmar tus giros. Actualiza la información o abre Ruleta para consultarlos.", actions: [sectionAction('/cliente/ruleta')] };
    const rows = leoSpins(data.roulette).filter(s => s.amount > 0), playable = rows.filter(s => s.playable);
    return { title: playable.length ? "Estas son tus ruletas" : rows.length ? "Tus giros necesitan atención" : "Tus ruletas, al día", message: rows.length ? rows.map(s => `${s.name}: ${s.amount} giro${s.amount === 1 ? '' : 's'}${s.playable ? '' : ' (' + s.reason.toLowerCase() + ')'}`).join(' · ') : "No tienes giros pendientes en este momento. Puedes revisar tus premios anteriores o consultar qué incluye cada paquete.", actions: rows.length ? rows.map(s => s.action) : [...(data.roulette.history?.length ? [leoAction('history','Ver mis premios','/cliente/ruleta','history','Este es el historial de tus giros y premios confirmados.')] : [sectionAction('/cliente/ruleta')]),sectionAction('/cliente/precios-ofertas')], note: "Tu rango de cliente y el nivel de tu ruleta son distintos. Cada giro pertenece a una ruleta concreta." };
  }
  if (topic === 'balance') return { title: "Tu saldo, sin perderte", message: data.wallet ? `Tienes ${count(data.wallet.minutes)} minutos y ${count(data.wallet.coins).toLocaleString('es-ES')} Coins. Los minutos se usan para tus consultas; puedes revisar las opciones de tus Coins en Inicio.` : "No he podido confirmar tu saldo. Puedes volver a consultarlo o abrir Inicio.", actions: [leoAction('minutes','Ver mis minutos','/cliente/dashboard','minutes','Este es tu saldo de minutos. Aquí puedes comprobar los minutos disponibles.'),leoAction('coins','Ver mis Coins','/cliente/dashboard','coins','Este es tu saldo de Coins. Revisa las opciones de canje que aparecen en Inicio.')], note: "Los regalos y compras aparecen cuando el sistema confirma su acreditación." };
  if (topic === 'rank') {
    const guide = data.ranks;
    if (!guide) return { title: "Tu camino entre rangos", message: "Todavía no puedo confirmar tu progreso. En Rangos del cliente tienes las condiciones y ventajas actualizadas.", actions: [sectionAction('/cliente/rangos')] };
    const current = guide.ranks.find(r => r.key === guide.state.effective), next = guide.ranks.find(r => r.min_spend > guide.state.total);
    return { title: current ? `Tu rango actual es ${current.label}` : "Tu primer rango te espera", message: `Llevas ${money(guide.state.total)} en los últimos ${guide.window_days} días. ${next ? `Te faltan ${money(Math.max(0,next.min_spend-guide.state.total))} para alcanzar ${next.label} por compras.` : 'Has alcanzado el objetivo de gasto de Diamante.'}${guide.state.has_override ? ' Tu cuenta tiene una asignación especial de rango, independiente de ese progreso.' : ''}`, actions: [leoAction('rank-progress','Ver mi progreso','/cliente/rangos','rank','Esta barra muestra tu gasto dentro de los últimos 30 días y el objetivo siguiente.'),...(next ? [leoAction('rank-next',`Ventajas de ${next.label}`,'/cliente/rangos',`rank-${next.key}`,'Aquí tienes el requisito de gasto y las ventajas de este rango.')] : [])], note: "El período se mueve cada día; el gasto antiguo sale del cálculo." };
  }
  if (topic === 'daily') {
    const bonus = data.bonuses?.[0];
    return { title: bonus ? bonus.claimed_today ? "Tu bono de hoy ya está utilizado" : "Tienes un bono diario disponible" : "Tu bono diario Diamante", message: bonus ? bonus.claimed_today ? "Ya has recibido el bono de hoy. La sección indica cuándo vuelve a estar disponible, según el horario de Madrid." : `Puedes utilizar «${bonus.name}» una vez hoy. Te llevo a revisar los premios y confirmar su uso.` : data.bonuses ? "En este momento no aparece un bono diario disponible para tu cuenta. Consulta las condiciones de Diamante." : "No he podido confirmar el estado del bono. Consulta de nuevo antes de utilizarlo.", actions: [bonus ? leoAction('daily','Ver mi bono','/cliente/rangos','daily','Revisa el contenido del bono. Si está disponible, pulsa «Utilizar mi bono» para confirmarlo.') : sectionAction('/cliente/rangos') ] };
  }
  if (topic === 'oracle') return { title: "Tu próxima consulta al Oráculo", message: data.oracle ? `Tienes ${count(data.oracle.credits)} tiradas de pago disponibles.${data.oracle.freeAvailable ? ' Tu tirada gratuita también está disponible.' : ' Consulta en Oráculo cuándo vuelve a estar disponible la tirada gratuita.'}` : data.wallet?.oracleCredits != null ? `Tienes ${count(data.wallet.oracleCredits)} tiradas de pago. En Oráculo podrás comprobar también la disponibilidad gratuita y elegir tu consulta.` : "Abre Oráculo para consultar tus tiradas disponibles, elegir el tema y preparar tu pregunta.", actions: [sectionAction('/cliente/oraculo','oracle')], note: "Revisa el coste de la tirada elegida antes de confirmarla." };
  if (topic === 'prizes' && data.roulette && !data.roulette.history?.length && !data.roulette.entitlements?.length) return { title: 'Tus premios aparecerán aquí', message: 'Todavía no aparecen premios confirmados ni beneficios activos de ruleta en tu cuenta. Puedes consultar tus giros o revisar las notificaciones de tus compras.', actions: [sectionAction('/cliente/ruleta'),sectionAction('/cliente/notificaciones','notifications')] };
  if (topic === 'prizes') return { title: "Encuentra tus premios", message: "El historial de Ruleta recoge los resultados confirmados. Los premios con seguimiento o entregas pendientes se consultan en tus beneficios activos.", actions: [...(data.roulette?.history?.length ? [leoAction('history','Historial de premios','/cliente/ruleta','history','Aquí aparecen los resultados confirmados. Si acabas de girar, espera a que se confirme el premio.')] : []),...(data.roulette?.entitlements?.length ? [leoAction('entitlements','Beneficios activos','/cliente/ruleta','prizes','Aquí puedes revisar premios activos, próximos pasos y entregas pendientes.')] : []),sectionAction('/cliente/notificaciones','notifications')] };
  return { title: topic === 'unknown' ? "Vamos a concretarlo" : "¿Adónde vamos?", message: topic === 'unknown' ? "Puedo ayudarte con giros, premios, saldo, rangos, bonos y las secciones del panel. Elige una opción o prueba «¿Qué ruleta tengo?» o «¿Dónde está mi premio?»." : "Elige una sección y te acompaño hasta su contenido.", actions: LEO_SECTIONS.filter(s => s.key !== 'ritual' || data.ranks?.ranks.find(r => r.key === data.ranks?.state.effective)?.benefits.some(b => /Acceso.*ritual/i.test(b))).map(s => sectionAction(s.path)) };
}
export function leoQuestion(text: string): LeoTopic | string {
  const q = text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if (/premio|historial|regalo.*ruleta/.test(q)) return 'prizes';
  if (/giro|ruleta/.test(q)) return 'roulette';
  if (/bono|diari[oa]/.test(q)) return 'daily';
  if (/rango|bronce|plata|diamante|subir|nivel/.test(q)) return 'rank';
  if (/saldo|coin|minuto/.test(q)) return 'balance';
  if (/oraculo|tirada/.test(q)) return 'oracle';
  const match = LEO_SECTIONS.find(s => q.includes(s.label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(' ')[0]) || q.includes(s.key));
  if (/oferta|promo|precio|compr/.test(q)) return '/cliente/precios-ofertas';
  return match?.path || 'unknown';
}