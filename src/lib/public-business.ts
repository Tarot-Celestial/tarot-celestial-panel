export const BUSINESS = {
  commercialName: "Tarot Celestial",
  legalName: "Alex Valentino Rivera Saldaña",
  taxId: "Z3163579-A",
  addressLines: ["C/ Sant Pere, 81", "Rubí, Barcelona", "España"],
  country: "España",
  email: "alexrivera200118@gmail.com",
  phoneDisplay: "+34 603 391 576",
  phoneHref: "+34603391576",
  website: "https://clientestarotcelestial.es",
} as const;

export const PRICES = [
  { minutes: 10, price: "12,00 €", description: "Consulta privada de 10 minutos." },
  { minutes: 20, price: "22,00 €", description: "Consulta privada de 20 minutos." },
  { minutes: 30, price: "26,00 €", description: "Consulta privada de 30 minutos." },
  { minutes: 40, price: "29,00 €", description: "Consulta privada de 40 minutos." },
  { minutes: 50, price: "32,00 €", description: "Consulta privada de 50 minutos." },
  { minutes: 60, price: "35,00 €", description: "Consulta privada de 60 minutos." },
] as const;

export const PUBLIC_LINKS = [
  { href: "/informacion-comercial", label: "Información comercial" },
  { href: "/terminos", label: "Términos y condiciones" },
  { href: "/privacidad", label: "Política de privacidad" },
  { href: "/aviso-legal", label: "Aviso legal" },
  { href: "/reembolsos", label: "Cancelaciones y reembolsos" },
] as const;
