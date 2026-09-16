export const CLIENT_WEB_PURCHASE_CODE = "CLIENTE";
export const CLIENT_PURCHASE_MAINTENANCE_MESSAGE =
  'Pagos web temporalmente en mantenimiento. Para realizar tu compra, llama a nuestra central e indica el código “CLIENTE”.';

export const CLIENT_PURCHASE_CALL_OPTIONS = [
  { country: "Puerto Rico", flag: "🇵🇷", number: "+1 787 945 0710", href: "tel:+17879450710" },
  { country: "Estados Unidos", flag: "🇺🇸", number: "+1 786 539 4750", href: "tel:+17865394750" },
  { country: "España", flag: "🇪🇸", number: "93 050 25 86", href: "tel:+34930502586" },
] as const;
