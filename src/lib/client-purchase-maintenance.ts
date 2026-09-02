// Independent of the selected gateway and reward catalogue. Re-enable only
// together with the purchase buttons after the payment service is verified.
export const CLIENT_MINUTE_PURCHASE_MAINTENANCE = true;
export const CLIENT_WEB_PURCHASE_CODE = "Cliente web";
export const CLIENT_PURCHASE_MAINTENANCE_MESSAGE =
  'La compra web está temporalmente en mantenimiento. Llama a Tarot Celestial e indica el código "Cliente web" para que te apliquen los mismos precios de la web. El cobro se realizará manualmente por teléfono.';

export const CLIENT_PURCHASE_CALL_OPTIONS = [
  { country: "Puerto Rico", flag: "🇵🇷", number: "+1 787 945 0710", href: "tel:+17879450710" },
  { country: "Estados Unidos", flag: "🇺🇸", number: "+1 786 539 4750", href: "tel:+17865394750" },
  { country: "España", flag: "🇪🇸", number: "93 050 25 86", href: "tel:+34930502586" },
] as const;
