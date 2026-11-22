const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { createHash, randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");

function load(file, imports = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname,"..",file),"utf8");
  const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{exports,Date,Intl,URL,require(name) {
    if (name === "server-only") return {};
    if (name in imports) return imports[name];
    throw Error(name);
  }});
  return exports;
}
const policy = load("src/lib/server/office-social-policy.ts",{"@/lib/countries":load("src/lib/countries.ts")});
function harness(options = {}) {
  const now = new Date(Date.now()-3000).toISOString();
  const job = {id:"op",request_id:"req",lease_token:"lease",channel:"instagram",kind:"message",account_id:"biz",source_id:"in",inbound_text:null,
    source_at:now,latest_inbound_at:now,actor_user_id:"admin",actor_worker_id:"worker",...options.job};
  const proof = {peerId:"peer",sourceAt:now,sourceId:"in",accountId:"biz",text:"¿Cómo puedo consultar desde Argentina?",privateAllowed:true,publicAllowed:false,...options.proof};
  const calls = [], links = [];
  const db = {
    async rpc(name,args) {
      calls.push({name,args});
      if (name === "office_capture_claim") return {data:job};
      if (name === "office_capture_begin" && options.revoked) return {data:null};
      if (name === "office_autonomy_dispatch") return {data:!options.pausedLate};
      return {data:true};
    },
    from(table) {
      let country;
      return {
        select(){return this;}, eq(key,v){if(key==="country")country=v;return this;}, lt(){return this;}, order(){return this;},
        async limit(){return {data:table==="office_capture_attempts" ? options.questions || [] : options.past || []};},
        async maybeSingle(){return options.lookupError ? {error:{}} : {data:options.lines?.[country] || null};},
      };
    },
  };
  const transport = {readSocialProof:async()=>proof,sendSocialReply:async(job,proof,body,mode,beforeSend)=>{
    if(beforeSend)await beforeSend();
    calls.push({name:"send",body,mode});
    if (options.lost) throw Object.assign(Error("timeout"),{code:"SEND_UNCERTAIN"});
    return "receipt";
  }};
  const worker = load("src/lib/server/office-social-worker.ts",{
    "./office-social-policy":policy,"./office-social-graph":transport,
    "./office-social-whatsapp":{readWhatsAppProof:transport.readSocialProof,sendWhatsAppReply:transport.sendSocialReply,
      prepareFormReply:async()=>{throw new policy.DispatchDecision("WHATSAPP_CONSENT_REQUIRED");}},
    "./captacion-whatsapp":{CAPTACION_WHATSAPP_ORIGIN:"https://example.test"},
    "./office-meta-attribution":{confirmMetaPanelCode:async(_db,_opp,_source,t)=>/^TC-/.test(t)?"confirmed":"not_code",
      getMetaPanelLink:async(_db,_id,_site,to)=>{links.push(to);return "https://example.test/cliente/meta/test";}},
  });
  return {run:()=>worker.runOfficeSocialDispatch(db),calls,links};
}
test("la línea depende del directorio habilitado, la alternativa en Argentina explica la primera tirada y posteriores pagos",async()=>{
  const f=harness();assert.equal((await f.run()).sent,1);
  assert.deepEqual(f.links,["oracle"]);assert.match(f.calls.find(c=>c.name==="send").body,/primera tirada es gratis.*pago/);
  for(const [country,iso,phone] of [["España","ES","93 050 25 86"],["Puerto Rico","PR","+1 787 945 0710"],["Chile","CL","+56 2 3210 0942"]]){
    const g=harness({proof:{text:"Quiero consultar, vivo en "+country},lines:{[iso]:{country:iso,enabled:true,phone}}});
    await g.run();assert.ok(g.calls.find(c=>c.name==="send").body.includes(phone));assert.deepEqual(g.links,["panel"]);
  }
  const unavailable=harness({lookupError:true});assert.equal((await unavailable.run()).blocked,1);assert.equal(unavailable.links.length,0);
});
test("un país solo responde a una pregunta enviada; saludo en comentario, datos de terceros y rechazo no disparan llamadas",async()=>{
  const direct=harness({proof:{text:"Argentina"}});assert.equal((await direct.run()).handoff,1);
  const answer=harness({proof:{text:"Argentina"},questions:[{route:"ask_country",completed_at:new Date(Date.now()-60000).toISOString()}]});
  assert.equal((await answer.run()).sent,1);assert.deepEqual(answer.links,["oracle"]);
  for(const [text,kind] of [["Hola","comment"],["Hola, soy del banco","message"],["No me interesa el tarot","message"]]){
    const g=harness({job:{kind},proof:{text}});await g.run();assert.equal(g.calls.some(c=>c.name==="send"),false);
  }
  assert.equal(policy.messageMarket("Quiero consultar, soja argentina"),"AR");
  assert.equal(policy.messageMarket("Quiero consultar, mi hermana vive en Chile"),null);
  const follow=harness({proof:{text:"Quiero consultar"},past:[{inbound_text:"Hola, vivo en Chile",source_at:new Date(Date.now()-60000).toISOString()}],
    lines:{CL:{country:"CL",enabled:true,phone:"+56 2 3210 0942"}}});
  await follow.run();assert.deepEqual(follow.links,["panel"]);
});
test("un comentario sin DM solo invita al privado; una baja, un código, un operador o una revocación no envían",async()=>{
  const pub=harness({job:{kind:"comment"},proof:{privateAllowed:false,publicAllowed:true}});await pub.run();
  assert.deepEqual(pub.links,[]);const sent=pub.calls.find(c=>c.name==="send");assert.equal(sent.mode,"public");assert.doesNotMatch(sent.body,/http|\d/);
  const stop=harness({job:{inbound_text:"Por favor no me escriban más"}});await stop.run();assert.ok(stop.calls.some(c=>c.name==="office_capture_optout"));assert.ok(!stop.calls.some(c=>c.name==="send"));
  for(const settings of [{proof:{text:"TC-111111111111"}},{revoked:true},{job:{opted_out:true}},{job:{actor_user_id:null}},
    {job:{kind:"form",channel:"meta_form"}},{proof:{sourceAt:new Date(Date.now()-25*3600000).toISOString()}}]){
    const g=harness(settings);await g.run();assert.equal(g.calls.some(c=>c.name==="send"),false);
  }
  const current=new Date().toISOString(), args={channel:"instagram",kind:"message",source_id:"in",latest_inbound_at:current};
  const incoming={id:"in",fromMe:false,createdAt:current,text:"quiero consultar"};
  assert.throws(()=>policy.verifyHistory(args,[incoming,{...incoming,id:"ours",fromMe:true}],false,null),/CONVERSATION_CHANGED/);
});
test("el recibo sigue a un único despacho y un timeout conserva incertidumbre",async()=>{
  const f=harness({lost:true});const totals=await f.run();assert.equal(totals.uncertain,1);
  assert.deepEqual(f.calls.map(c=>c.name),["office_capture_claim","office_capture_begin","office_autonomy_dispatch","send","office_capture_finish"]);
  assert.equal(f.calls.at(-1).args.p_receipt,null);assert.equal(f.calls.at(-1).args.p_outcome,"uncertain");
});
test("el cambio de autonomía posterior al begin evita el transporte en la misma solicitud",async()=>{
  const f=harness({pausedLate:true});assert.equal((await f.run()).handoff,1);
  assert.equal(f.calls.some(c=>c.name==="send"),false);
  assert.equal(f.calls.find(c=>c.name==="office_autonomy_dispatch").args.p_request,"req");
  assert.equal(f.calls.at(-1).args.p_receipt,null);
});
test("la respuesta privada a un comentario con país utiliza la línea o el Oráculo general, sin atribución de un hilo DM",async()=>{
  for(const [text,lines,expected] of [["Quiero consultar, soy argentina",{},/example\.test\/cliente\/oraculo/],
    ["Quiero consultar, soy de Puerto Rico",{PR:{country:"PR",phone:"+1 787 945 0710",enabled:true}},/787 945 0710/]]){
    const f=harness({job:{kind:"comment"},proof:{text,privateAllowed:true,publicAllowed:true},lines});
    assert.equal((await f.run()).sent,1);const send=f.calls.find(c=>c.name==="send");
    assert.equal(send.mode,"private");assert.match(send.body,expected);assert.doesNotMatch(send.body,/undefined|\/cliente\/meta/);assert.deepEqual(f.links,[]);
  }
});
test("gateway comprueba última entrada y remitente y reutiliza su recibo tras la respuesta",async()=>{
  const {sendOfficeReply}=await import(pathToFileURL(path.resolve(__dirname,"../whatsapp-gateway/office-reply.mjs")));
  const now=Math.floor(Date.now()/1000)-4, peer="12345678901@s.whatsapp.net", sender="12345678902@s.whatsapp.net",calls=[];
  const inbound={id:"m",chatJid:peer,fromMe:false,kind:"text",text:"¿Cómo puedo consultar?",ts:now};
  const command={operationId:randomUUID(),jid:peer,senderId:sender,inboundId:"m",inboundAt:new Date(now*1000).toISOString(),
    sourceHash:createHash("sha256").update(inbound.text).digest("hex"),text:"Hola"};
  const session={id:"central",me:{id:sender,phone:"12345678902"},requireConnected(){},store:{canonical:v=>v,getMessages:()=>[inbound]},
    sock:{async sendMessage(jid,body,{messageId}){calls.push(jid);return {key:{id:messageId}};}}};
  let known=null;
  const journal={lookup:()=>known,claim:({messageId})=>{known={messageId};return {claimed:true};},setStatus:(_id,status)=>({...known,status})};
  for(const patch of [{senderId:"other"},{jid:"123@g.us"},{inboundId:"old"},{sourceHash:"1".repeat(64)}]){
    await assert.rejects(sendOfficeReply(session,{...command,...patch},journal));
  }
  assert.equal(calls.length,0);assert.equal((await sendOfficeReply(session,command,journal)).status,"accepted");
  await sendOfficeReply(session,command,journal);assert.equal(calls.length,1);
});

test("los permisos de comentario y mensaje se comprueban en su cuenta; no se publica ni se reintenta si cambió el hilo",async()=>{
  const now=new Date(Date.now()-6000).toISOString();
  const job={id:"op",request_id:"req",thread_id:"thread",channel:"instagram",kind:"comment",account_id:"100",source_id:"30",
    recipient_id:"222",actor_user_id:"admin",latest_inbound_at:now};
  const context={account:{accountId:"100"},row:{id:"thread",kind:"comment",remote_id:"30",recipient_id:"222",private_reply_sent:false,last_reply_at:null},
    loaded:{recipientId:null,messages:[{id:"30",createdAt:now,text:"Quiero consultar",fromMe:false}],incompleteHistory:false}};
  const grants=["instagram_business_manage_comments","instagram_business_manage_messages"];
  const facebookGrants=["pages_messaging","pages_manage_engagement"];
  let fbPrivate=false, posted=0;
  class InstagramError extends Error {}
  class FacebookError extends Error {}
  const fakeSend=async(actor,request,verify)=>{
    await verify(context.account,context.row,context.loaded);
    posted++;return {ok:true,messageId:"receipt"};
  };
  const graph=load("src/lib/server/office-social-graph.ts",{
    "./office-social-policy":policy,
    "./instagram-graph":{InstagramError,instagramGraph:async()=>({data:grants.map(permission=>({permission,status:"granted"}))})},
    "./facebook-graph":{FacebookError,facebookGraph:async()=>({id:"30",can_reply_privately:fbPrivate})},
    "./facebook-diagnostics":{facebookReplyPermissions:async()=>facebookGrants},
    "./office-instagram-graph":{verifyOfficeInstagramIdentity:async()=>({ids:["100"]})},
    "./instagram-sync":{},"./instagram-inbox":{instagramOfficeHistory:async()=>context,instagramSend:fakeSend},
    "./facebook-inbox":{facebookOfficeHistory:async()=>context,facebookSend:fakeSend},
  });
  let proof=await graph.readSocialProof(job);assert.equal(proof.privateAllowed,true);
  grants.pop();proof=await graph.readSocialProof(job);assert.equal(proof.publicAllowed,true);assert.equal(proof.privateAllowed,false);
  assert.equal((await graph.readSocialProof({...job,channel:"facebook"})).privateAllowed,false);
  fbPrivate=true;assert.equal((await graph.readSocialProof({...job,channel:"facebook"})).privateAllowed,true);
  await assert.rejects(graph.readSocialProof({...job,account_id:"unrelated"}),/SOURCE_CHANGED/);
  await assert.rejects(graph.readSocialProof({...job,recipient_id:"unrelated"}),/RECIPIENT_UNVERIFIED/);
  context.loaded.messages[0].text="Ahora quiero otra cosa";
  await assert.rejects(graph.sendSocialReply(job,proof,"respuesta","public"),/SOURCE_CHANGED/);assert.equal(posted,0);
  context.loaded.incompleteHistory=true;await assert.rejects(graph.readSocialProof(job),/INCOMPLETE_HISTORY/);
});
