import type { WheelEntry } from "./raffle-wheel";
export type CenterEntry = WheelEntry & { eligible:boolean; won:boolean; phone?:string|null };
export type CenterPrize = {
 id:string; raffle_id:string; position:number; name:string;
 candidate_entry_id:string|null; candidate_number:number|null; candidate_client_id:string|null; candidate_name:string|null;
 selected_at:string|null; confirmed_at:string|null; selected_by:string|null; confirmed_by:string|null;
 selected_by_name:string|null; confirmed_by_name:string|null;
 selection_method:"roulette"|"manual"; is_test:boolean; simulation_only:boolean; selection_revision:number;
};
export type SelectionAudit = { id:string;action_type:string;created_at:string;actor:string|null;
 payload:{position?:number;prize_name?:string;number?:number;name?:string;method?:string;is_test?:boolean;simulation_only?:boolean} };
export type RaffleCenterState = { raffle:{id:string;title:string;allow_repeat_winners:boolean}; canManage:boolean; canSelect?:boolean;
 entries:CenterEntry[]; prizes:CenterPrize[]; audit:SelectionAudit[] };
export function selectionLabel(prize:{selection_method?:string;is_test?:boolean;simulation_only?:boolean}){
 return prize.selection_method==="manual" ? `Manual${prize.is_test?" · PRUEBA":""}${prize.simulation_only?" · Solo simular":""}` : "Ruleta · Aleatoria";
}
