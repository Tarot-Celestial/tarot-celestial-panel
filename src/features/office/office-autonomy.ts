export const autonomyActions = {
  capture_discovery: { label:"Sincronizar y descubrir contactos", channels:["instagram","facebook","meta_form","whatsapp"], departments:["captacion-reservas"] },
  capture_reply: { label:"Responder a un contacto", channels:["instagram","facebook","whatsapp","meta_form"], departments:["captacion-reservas","marketing"] },
  creative_brief: { label:"Preparar el briefing con IA", channels:["openai"], departments:["marketing"] },
  creative_copy: { label:"Redactar el borrador con IA", channels:["openai"], departments:["marketing","creacion-contenido"] },
  creative_art: { label:"Componer el entregable", channels:["internal"], departments:["marketing","creacion-contenido"] },
  instagram_publish: { label:"Publicar una versión aprobada", channels:["instagram"], departments:["marketing"] },
  booking_review: { label:"Revisar reservas", channels:["internal"], departments:["clientes","captacion-reservas"] },
  monthly_report: { label:"Actualizar un informe mensual", channels:["internal"], departments:["finanzas","inteligencia","estrategia"] },
} satisfies Record<string,{label:string;channels:string[];departments:string[]}>;

export const autonomyChannels:Record<string,string> = {internal:"Interno de Oficina",openai:"OpenAI",instagram:"Instagram",
  facebook:"Facebook",whatsapp:"WhatsApp",meta_form:"Formulario de Meta → WhatsApp"};
export const autonomyModes = {automatic:"Permitir con los controles vigentes",paused:"Poner en pausa",human:"Derivar a una persona"};
export type RuleScope = {department:string;action:string;channel:string;account:string};
export type AutonomyRule = RuleScope & {mode:keyof typeof autonomyModes;held:boolean;window_start:string|null;window_end:string|null;
  daily_actions:number|null;daily_usd:number|null;revision:number};
export type AutonomySnapshot = {as_of:string;rules:AutonomyRule[];accounts:{channel:string;account:string}[];
  estimated_usd:number;usage:{action:string;channel:string;operations:number;reserved_usd:number}[]};
export const anyScope:RuleScope = {department:"",action:"",channel:"",account:""};
export function ruleFor(rules:AutonomyRule[],scope:RuleScope):AutonomyRule {
  return rules.find(r=>r.department===scope.department && r.action===scope.action && r.channel===scope.channel && r.account===scope.account)
    || {...scope,mode:"automatic",held:false,window_start:null,window_end:null,daily_actions:null,daily_usd:null,revision:0};
}
export const actionLabel = (id:string) => autonomyActions[id as keyof typeof autonomyActions]?.label || id;
