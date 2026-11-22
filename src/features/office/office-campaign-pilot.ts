export type PilotCampaign = {
  id: string;
  name: string | null;
};
export type PilotMoney = {
  currency: string | null;
  receipts: number;
  first_count: number;
  first_gross: number | null;
  gross: number | null;
  confirmed: number | null;
  refund_flagged: number;
};
export type PilotTouch = {
  kind: "automated" | "whatsapp" | "commercial";
  at: string;
  route: string;
  operator?: string | null;
};
export type PilotBuyer = {
  client_id: string;
  lead_id: string;
  contact_at: string;
  channel: string;
  purchase_at: string;
  source: string;
  amount: number | null;
  currency: string | null;
  status: string;
  handling: PilotTouch[] | null;
  call_operator: string | null;
};
export type PilotSpend = {
  source: "meta_insights" | "ads_manager_csv";
  account_id: string;
  currency: string;
  zone: string;
  from: string;
  through: string;
  amount: number;
  checked_at: string;
  worker?: string | null;
  file_sha256?: string;
};
export type PilotReport = {
  ok: true;
  month: string;
  campaigns: PilotCampaign[];
  selected: PilotCampaign | null;
  zone: string;
  as_of: string;
  period_from: string;
  period_through: string;
  contacts: number;
  first_buyers: number;
  cost_first_buyers: number;
  amounts: PilotMoney[];
  buyers: PilotBuyer[];
  unattributed_first_purchases: number;
  next_cursor: string | null;
  spend: PilotSpend | null;
  spend_reason: string | null;
  cpa: number | null;
};
