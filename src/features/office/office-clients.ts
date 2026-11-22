export type OfficeCaptureStage = "captured" | "pending";
export interface OfficeCaptureTotals {
  ok: true;
  total_clients: number;
  captured_clients: number;
}
export interface OfficeClientRow {
  id: string;
  display_name: string;
  country: string | null;
  created_at: string | null;
  account_linked: boolean;
  capture_stage: OfficeCaptureStage;
  first_purchase_at: string | null;
}
export interface OfficeClientList {
  ok: true;
  items: OfficeClientRow[];
  next_cursor: string | null;
}
export interface OfficeClientPurchase {
  id: string;
  source: string;
  at: string;
  status: string;
  amount: number | null;
  currency: string | null;
}
export interface OfficeClientReservation {
  id: string;
  source: "reservas" | "first_tarotist_reservations";
  at: string | null;
  status: string;
  tarotist_name: string | null;
}
export interface OfficeClientCapture {
  lead_id: string;
  origin: string | null;
  status: string | null;
  created_at: string | null;
  next_contact_at: string | null;
}
export interface OfficeClientDetail {
  ok: true;
  client: OfficeClientRow & { origin: string | null };
  first_purchase: OfficeClientPurchase | null;
  reservations: OfficeClientReservation[];
  reservations_has_more: boolean;
  next_reservations_cursor: string | null;
  capture: OfficeClientCapture | null;
}
