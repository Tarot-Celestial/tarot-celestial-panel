export const ACTIVE_CONSULTATION_LINES = [
  { country: "Puerto Rico", flag: "🇵🇷", display: "+1 787 945 0710", href: "tel:+17879450710" },
  { country: "Estados Unidos", flag: "🇺🇸", display: "+1 786 539 4750", href: "tel:+17865394750" },
  { country: "España", flag: "🇪🇸", display: "93 050 25 86", href: "tel:+34930502586" },
] as const;

export const INSTAGRAM_REPLY_TEMPLATES = [
  {
    id: "oracle",
    title: "1 · Panel y Oráculo",
    description: "Invitación para registrarse y consultar desde la web.",
    text: "¡Hola! 💜 Puedes consultar nuestro Oráculo desde tu móvil, estés donde estés. Entra aquí y pulsa REGISTRARSE para crear tu cuenta:\n\nhttps://nextjs-boilerplate-one-azure-28.vercel.app/cliente/oraculo?source=instagram\n\nNo necesitas tener tu número registrado previamente. Si necesitas ayuda para entrar, escríbenos y te acompañamos.",
  },
  {
    id: "phone",
    title: "2 · Primera consulta gratis",
    description: "Las líneas activas y el acceso a nuestra web.",
    text: "¡Hola! 💜 Tu primera consulta es gratis. Puedes llamarnos con gusto a nuestras líneas activas:\n\n🇵🇷 Puerto Rico: +1 787 945 0710\n🇺🇸 Estados Unidos: +1 786 539 4750\n🇪🇸 España: 93 050 25 86\n\nTambién puedes entrar a nuestro sitio web:\nhttps://nextjs-boilerplate-one-azure-28.vercel.app/cliente/dashboard?source=instagram\n\nDinos desde qué país nos escribes y te ayudamos a elegir la mejor opción para ti.",
  },
] as const;

export type InstagramThread = {
  id: string;
  kind: "message" | "comment";
  name: string;
  username?: string | null;
  preview: string;
  updatedAt: string;
  unread?: number;
  permalink?: string | null;
};

export type InstagramMessage = {
  id: string;
  text: string;
  fromMe: boolean;
  createdAt: string;
  senderName?: string | null;
};

export type InstagramConnection = {
  username: string;
  connected: boolean;
  ready: boolean;
  message?: string | null;
};

export type InstagramInboxResult = {
  ok: true;
  connection: InstagramConnection;
  threads: InstagramThread[];
  nextCursor?: string | null;
  partialHint?: string | null;
};

export type InstagramMessagesResult = {
  ok: true;
  messages: InstagramMessage[];
  canReply: boolean;
  replyHint?: string | null;
  lastReplyAt: string | null;
  canPrivateReply?: boolean;
  privateReplyHint?: string | null;
  privateReplySent?: boolean;
  pendingSend?: { requestId: string; status: string; createdAt: string; text: string } | null;
  requestStatus?: "sent" | "failed" | "not_found" | "sending" | "uncertain" | "confirmed_sent" | "confirmed_not_sent" | null;
};
