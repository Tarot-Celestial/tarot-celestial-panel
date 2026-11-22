export type OfficeCohortOrigin = "meta_lead" | "web_registration" | "referral" | "instagram" | "facebook" |
  "whatsapp" | "manual" | "other_recorded" | "unknown";
export type OfficeCohortOriginBasis = "historical" | "current_only" | "unknown";

export type OfficeCohortMoney = {
  purchases: number;
  gross: number | null;
  confirmed: number | null;
  refund_flagged: number | null;
  refund_unknown_count: number;
  unresolved_count: number;
};
export type OfficeCohortCurrency = {
  currency: string | null;
  first: OfficeCohortMoney;
  month_to_date: OfficeCohortMoney;
  lifetime_to_cutoff: OfficeCohortMoney;
};
export type OfficeCohortReport = {
  month: string;
  zone: "Europe/Madrid";
  as_of: string;
  captured_clients: number;
  origins: { origin: OfficeCohortOrigin; basis: OfficeCohortOriginBasis; captured_clients: number; amounts: OfficeCohortCurrency[] }[];
  totals: OfficeCohortCurrency[];
};
