const {test}=require("node:test");
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript"),vm=require("node:vm");
const service=path.join(__dirname,"../src/lib/server");
const source=(name,mocks)=>{
 const out={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(service,name+".ts"),"utf8"),
   {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out,require:k=>{
   if(k==="server-only")return {};if(k in mocks)return mocks[k];throw Error(k);},console,Date});return out;
};
const parser=source("whatsapp-attention",{}), policy=source("office-social-policy",{"@/lib/countries":{COUNTRY_OPTIONS:[]}});
const peer="34600000001@s.whatsapp.net", own="34600000002@s.whatsapp.net", personal="34600000003@s.whatsapp.net", group="120365@g.us";
const sec=Math.floor(Date.now()/1000)-60;
const chat=(id,lastText)=>({id,isGroup:id.endsWith("@g.us"),name:"Fixture",lastTs:sec,lastText,lastFromMe:false});
const msg=(chat,id,text,ts=sec,fromMe=false)=>({id,chatJid:chat.id,fromMe,ts,kind:"text",text});
function setup(options={}){
 const calls=[],batches=[];
 const chats=options.chats || [chat(peer,"Quiero una lectura de tarot"),chat(personal,"¿Me mandas el informe de la consulta médica?"),chat(group,"Quiero una lectura de tarot")];
 const histories=options.histories || Object.fromEntries(chats.map(c=>[c.id,[msg(c,c.id.split("@")[0],c.lastText)]]));
 const db={from(table){
   assert.equal(table,"office_capture_opportunities");
   const b={select(){return b;},eq(){return b;},in(){return {data:options.known || [],error:null};}};return b;
 },async rpc(name,args){
   if(name==="office_capture_discover")return {data:{processed:9},error:null};
   assert.equal(name,"office_capture_record_whatsapp");batches.push(args);return {data:args.p_rows.length,error:null};
 }};
 const gateway={whatsappGatewayConfig:()=>({configured:options.configured!==false,mode:"shared"}),async whatsappGatewayFetch(url,init){
   assert.ok(!init?.method || init.method==="GET");calls.push(url);
   if(url.endsWith("/attention")){
     if(options.offline)return {status:503,json:{error:"LOCAL_GATEWAY_OFFLINE"}};
     const unreads=chats.filter(c=>!options.read && histories[c.id]?.some(m=>!m.fromMe));
     return {status:200,json:{ok:true,session:"central",account_id:own,rev:"fixture",server_time:new Date().toISOString(),
       unread_total:unreads.length,unread_chats:unreads.length,items:unreads.map(c=>{
         const m=histories[c.id].filter(m=>!m.fromMe).at(-1);
         return {id:c.id,name:c.name,unread:1,last_incoming_id:m.id,last_incoming_at:new Date(m.ts*1000).toISOString()};
       })}};
   }
   if(url.endsWith("/chats"))return {status:200,json:{ok:true,chats}};
   if(url.endsWith("/status"))return {status:200,json:{ok:true,state:"connected",session:"central",me:{id:options.switchAccount?personal:own}}};
   const c=chats.find(c=>url.includes(encodeURIComponent(c.id)));
   assert.ok(c);return {status:200,json:{ok:true,chat:c,messages:histories[c.id]}};
 }};
 const mod=source("office-capture-discovery",{"./admin-access":{},"./whatsapp-attention":parser,"./whatsapp-gateway":gateway,"./office-social-policy":policy});
 return {discover:()=>mod.discoverOfficeCapture(db),calls,batches,mod};
}
test("only explicit business inquiries are persisted; group and family texts never enter the private source batch",async()=>{
 const f=setup(),r=await f.discover();assert.equal(r.whatsapp.state,"connected");assert.equal(r.database.processed,9);
 assert.equal(f.batches.length,1);const rows=f.batches[0].p_rows;assert.equal(rows.length,1);assert.equal(rows[0].thread_key,peer);
 assert.equal(f.batches[0].p_account,own);assert.equal(rows[0].source_at,new Date(sec*1000).toISOString());
 assert.ok(!f.calls.some(url=>url.includes(encodeURIComponent(group))));
 assert.equal(f.mod.whatsAppBusinessInterest("¿Precio?"),false);
 assert.equal(f.mod.whatsAppBusinessInterest("¿Cuánto cuesta una tirada de cartas?"),true);
});
test("verified followups in previously qualified read chats carry the human receipt for SQL takeover",async()=>{
 const c=chat(peer,"Argentina"),histories={[peer]:[msg(c,"my-first","¿País?",sec-60,true),msg(c,"reply","Argentina")]};
 const f=setup({chats:[c],histories,known:[{thread_key:peer}],read:true});await f.discover();
 const row=f.batches[0].p_rows[0];assert.equal(row.source_id,"reply");assert.equal(row.last_own_id,"my-first");assert.equal(row.business_interest,false);
 const changed=setup({chats:[c],histories,known:[{thread_key:peer}],read:true,switchAccount:true});
 assert.equal((await changed.discover()).whatsapp.state,"unavailable");assert.equal(changed.batches.length,0);
});
test("missing configuration and offline gateway preserve independently verified CRM discovery",async()=>{
 for(const [options,expected] of [[{configured:false},"not_configured"],[{offline:true},"offline"]]){
   const f=setup(options),r=await f.discover();assert.equal(r.whatsapp.state,expected);assert.equal(r.database.processed,9);assert.equal(f.batches.length,0);
 }
});
test("social metadata feed never receives private text while the service-only sink carries the exact source",async()=>{
 const native=[],office=[],db={from(t){assert.equal(t,"tc_social_inbox_activity");return {async upsert(rows){native.push(...rows);return {error:null};}};},
   async rpc(name,args){assert.equal(name,"office_capture_record_social");office.push(args);return {data:1,error:null};}};
 const mod=source("social-inbox-activity",{"@/lib/supabase-admin":{supabaseAdmin:()=>db}});
 await mod.recordSocialActivity("instagram","100",[{kind:"message",remoteId:"message",threadRemoteId:"peer",occurredAt:new Date(sec*1000).toISOString(),text:"TC-FIXTURE"}]);
 assert.equal(native.length,1);assert.ok(!JSON.stringify(native).includes("TC-"));assert.equal(office[0].p_rows[0].body,"TC-FIXTURE");
});
