export type OfficeMetaChannel = "instagram"|"facebook"|"whatsapp"|"meta_form";
export type OfficeMetaConversion = "unlinked"|"awaiting_proof"|"awaiting_purchase"|"prior_customer"|"first_purchase"|"linked_elsewhere";
export type OfficeMetaCounts = {
  opportunities:number; opened_opportunities:number; proof_pending:number;
  linked_clients:number; prior_clients:number; first_purchases:number; linked_elsewhere:number; pending:number;
};
export type OfficeMetaOpportunity = {
  id:string; display_name:string|null; channel:OfficeMetaChannel; kind:"message"|"comment"|"form"; source_at:string;
  latest_inbound_at:string; window_until:string|null; status:string; provider_error:string|null;
  thread_id:string|null; lead_id:string|null; has_receipt:boolean; opened:boolean; conversion:OfficeMetaConversion;
  first_purchase_at:string|null; first_purchase_source:string|null; first_purchase_status:string|null;
};
export type OfficeMetaReport = {
  ok:true; month:string; as_of:string; totals:OfficeMetaCounts;
  platforms:(OfficeMetaCounts & {platform:OfficeMetaChannel})[];
  states:{state:string;count:number}[]; purchases:{source:string;count:number}[];
  items:OfficeMetaOpportunity[]; next_cursor:string|null;
};
