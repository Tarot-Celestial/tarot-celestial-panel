import "server-only";

export async function allowOfficeDiscovery(db:any, channel:string, account:string, batch:string) {
  const {data,error} = await db.rpc("office_autonomy_check",{
    p_action:"capture_discovery",p_channel:channel,p_account:account,p_operation:batch+":"+channel+":"+account,p_reserve:true,
  });
  if (error || typeof data !== "string") throw new Error("OFFICE_AUTONOMY_UNAVAILABLE");
  return data === "allow";
}
