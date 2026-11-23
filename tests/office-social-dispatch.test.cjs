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
  vm.runInNewContext(js,{exports,Date,Intl,URL,setTimeout,require(name) {
    if (name === "server-only") return {};
    if (name in imports) return imports[name];
    throw Error(name);
  }});
  return exports;
}
const policy = load("src/lib/server/office-social-policy.ts",{"@/lib/countries":load("src/lib/countries.ts")});
test("las rondas del cron vuelven a consultar los permisos y a reclamar los trabajos en origen", async t => {
  const route = load("src/app/api/cron/office-capture/route.ts", {
    "node:crypto": require("node:crypto"), "@/lib/admin/require-admin": {}, "@/lib/server/office-access": {},
    "@/lib/server/office-capture-discovery": {}, "@/lib/server/office-discovery-policy": {}, "@/lib/server/office-social-worker": {},
  });
  const { AsyncLocalStorage } = require("node:async_hooks");
  const { patchFetch } = require("next/dist/server/lib/patch-fetch");
  const storage = new AsyncLocalStorage(), entries = new Map();
  const incrementalCache = {
    fetchCacheKey: async url => url,
    get: async key => entries.get(key),
    set: async (key, value) => entries.set(key, { value, isStale: false }),
    lock: async () => async () => {},
  };
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let revision = 0;
  globalThis.fetch = async () => new Response(String(++revision));
  patchFetch({ staticGenerationAsyncStorage: storage, serverHooks: { DynamicServerError: Error } });
  function round() {
    return storage.run({
      pagePath: "/api/cron/office-capture/route", urlPathname: "/api/cron/office-capture",
      isStaticGeneration: false, forceDynamic: route.dynamic === "force-dynamic", revalidate: route.revalidate ?? false,
      fetchCache: route.fetchCache, incrementalCache,
    }, async () => {
      const headers = { Authorization: "Bearer local-fixture" };
      const settings = await fetch("https://database.invalid/connection", { headers });
      const claim = await fetch("https://database.invalid/rpc/claim", { method: "POST", headers, body: "{}" });
      return [await settings.text(), await claim.text()];
    });
  }
  assert.deepEqual(await round(), ["1", "2"]);
  assert.deepEqual(await round(), ["3", "4"]);
});
test("una ronda informa la etapa rechazada y conserva el canal sano sin revelar el error original", async () => {
  let failure = "connection";
  const sensitive = "mensaje privado de prueba";
  const failAt = stage => { if (failure === stage) throw { code: sensitive, message: sensitive }; };
  const graph = load("src/lib/server/office-social-graph.ts", {
    "./instagram-graph": { instagramConnection: async () => { failAt("connection"); return { accountId: "ig" }; } },
    "./instagram-sync": { ensureInstagramFresh: async () => { failAt("inbox"); return {}; } },
    "./facebook-graph": { facebookConnection: () => ({ accountId: "fb" }) },
    "./facebook-inbox": { ensureFacebookFresh: async () => ({}) },
    "./instagram-inbox": {}, "./office-instagram-graph": {}, "./facebook-diagnostics": {}, "./office-social-policy": policy,
  });
  const allow = async channel => { if (channel === "instagram") failAt("autonomy"); return true; };
  for (failure of ["connection", "autonomy", "inbox"]) {
    const [ig, fb] = await graph.syncOfficeSocialInboxes(allow);
    assert.deepEqual({ ...ig }, { channel: "instagram", state: "blocked", stage: failure, code: "UNAVAILABLE" });
    assert.equal(fb.state, "checked");
  }
  failure = "";
  assert.equal((await graph.syncOfficeSocialInboxes(allow))[0].state, "checked");
  assert.equal((await graph.syncOfficeSocialInboxes(async () => false))[0].state, "paused");
});
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
      if (name === "office_capture_instagram_comment_context") return {data:options.commentPrompts?.shift() ?? options.commentPrompt ?? null};
      if (["office_capture_claim_instagram_dm","office_capture_claim_instagram_comment"].includes(name)) return {data:args.p_source_id === job.source_id ? job : null};
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
  const transport = {readSocialProof:async()=>{
    const code=options.readErrors?.shift();
    if(code) throw new policy.DispatchDecision(code);
    return proof;
  },sendSocialReply:async(job,proof,body,mode,beforeSend)=>{
    if(beforeSend)await beforeSend(options.freshProof || proof);
    calls.push({name:"send",body,mode});
    if (options.lost) throw Object.assign(Error("timeout"),{code:"SEND_UNCERTAIN"});
    return "receipt";
  }};
  const worker = load("src/lib/server/office-social-worker.ts",{
    "@/lib/instagram-inbox":load("src/lib/instagram-inbox.ts"),
    "./office-social-policy":policy,"./office-social-graph":transport,
    "./office-social-whatsapp":{readWhatsAppProof:transport.readSocialProof,sendWhatsAppReply:transport.sendSocialReply,
      prepareFormReply:async()=>{throw new policy.DispatchDecision("WHATSAPP_CONSENT_REQUIRED");}},
    "./captacion-whatsapp":{CAPTACION_WHATSAPP_ORIGIN:"https://example.test"},
    "./office-meta-attribution":{confirmMetaPanelCode:async(_db,_opp,_source,t)=>/^TC-/.test(t)?"confirmed":"not_code",
      getMetaPanelLink:async(_db,_id,_site,to)=>{links.push(to);return "https://example.test/cliente/meta/test";}},
  });
  const replies=(account,sources)=>worker.dispatchInstagramWebhookReplies(db,account,sources);
  return {run:()=>worker.runOfficeSocialDispatch(db),webhook:(account,...ids)=>replies(account,ids.map(id=>({id,kind:"message"}))),replies,calls,links};
}
test("un comentario firmado solicita una sola respuesta por el canal autorizado",async()=>{
  const sources=[{kind:"comment",id:"in"},{kind:"comment",id:"in"}];
  const f=harness({job:{kind:"comment"},proof:{text:"Hola quiero mi primera consulta",publicAllowed:true}});
  await f.replies("biz",sources);
  assert.deepEqual(f.calls.filter(c=>c.name.startsWith("office_capture_claim")).map(c=>c.name),["office_capture_claim_instagram_comment"]);
  assert.deepEqual(f.calls.filter(c=>c.name==="send").map(c=>c.mode),["private"]);
  const mismatch=harness();
  await assert.rejects(mismatch.replies("biz",sources),/SOURCE_MISMATCH/);
  assert.equal(mismatch.calls.some(c=>c.name==="send"),false);
});
test("el webhook reclama el DM exacto una vez, respeta la revocación y no toca otra cuenta",async()=>{
  const f=harness();
  await f.webhook("biz","old","in","in");
  assert.deepEqual(f.calls.filter(c=>c.name==="office_capture_claim_instagram_dm").map(c=>c.args.p_source_id),["old","in"]);
  assert.equal(f.calls.filter(c=>c.name==="send").length,1);
  assert.equal(f.calls.some(c=>c.name==="office_capture_claim"),false);
  const other=harness();
  await assert.rejects(other.webhook("wrong-account","in"),/SOURCE_MISMATCH/);
  assert.equal(other.calls.some(c=>c.name==="send"),false);
  const paused=harness({pausedLate:true});
  await paused.webhook("biz","in");
  assert.equal(paused.calls.some(c=>c.name==="send"),false);
});
test("un DM aún invisible en Graph se vuelve a leer; si sigue pendiente el cron puede recuperarlo",async()=>{
  const temporary=harness({readErrors:["CONVERSATION_PENDING"]});
  await temporary.webhook("biz","in");
  assert.equal(temporary.calls.filter(c=>c.name==="send").length,1);
  const delayed=harness({readErrors:["INBOUND_UNVERIFIED","INBOUND_UNVERIFIED"]});
  await delayed.webhook("biz","in");
  assert.deepEqual(delayed.calls.map(c=>c.name),["office_capture_claim_instagram_dm"]);
  assert.equal((await delayed.run()).sent,1);
});
test("dos DMs seguidos unen la consulta con el país verificado y respetan respuestas humanas o empates",async()=>{
  const now=Date.now()-500;
  const a={id:"a",createdAt:new Date(now-3000).toISOString(),fromMe:false,text:"Quiero información de mi primera consulta gratis"};
  const b={id:"b",createdAt:new Date(now).toISOString(),fromMe:false,text:"Soy de Argentina"};
  const job={channel:"instagram",kind:"message",source_id:"a",latest_inbound_at:a.createdAt};
  assert.throws(()=>policy.verifyHistory(job,[a,b],false,null),err=>err.code==="NEWER_INSTAGRAM_DM"&&err.outcome==="blocked");
  for(const changed of [{...b,fromMe:true},{...b,createdAt:a.createdAt}]) {
    assert.throws(()=>policy.verifyHistory(job,[a,changed],false,null),err=>err.code==="CONVERSATION_CHANGED");
  }
  assert.equal(policy.followsInstagramConsultation(b,[a,b],null),true);
  assert.equal(policy.followsInstagramConsultation(b,[a,b],a.createdAt),false);
  assert.equal(policy.followsInstagramConsultation(b,[{...a,fromMe:true},b],null),false);
  assert.equal(policy.followsInstagramConsultation(b,[{...a,createdAt:new Date(now-310000).toISOString()},b],null),false);
  const followup=harness({proof:{text:b.text,followsConsultation:true}});
  await followup.webhook("biz","in");
  assert.deepEqual(followup.links,["oracle"]);
});
test("la línea depende del directorio habilitado, la alternativa en Argentina explica la primera tirada y posteriores pagos",async()=>{
  const f=harness();assert.equal((await f.run()).sent,1);
  assert.deepEqual(f.links,["oracle"]);assert.match(f.calls.find(c=>c.name==="send").body,/primera tirada es gratis.*pago/);
  for(const [country,iso,phone,offer] of [["España","ES","93 050 25 86",true],["España","ES","+34 930 502 586",true],
    ["Puerto Rico","PR","+1 787 945 0710",true],["Estados Unidos","US","+1 (786) 539-4750",true],
    ["Chile","CL","+56 2 3210 0942",false],["Puerto Rico","PR","+1 787 555 0100",false],["España","ES","+1 787 945 0710",false]]){
    const g=harness({proof:{text:"Quiero consultar, vivo en "+country},lines:{[iso]:{country:iso,enabled:true,phone}}});
    await g.run();
    const body=g.calls.find(c=>c.name==="send").body;
    assert.ok(body.includes(phone));assert.deepEqual(g.links,["panel"]);assert.equal(body.includes("primera consulta de tarot por teléfono es gratis"),offer);
  }
  const unavailable=harness({lookupError:true});assert.equal((await unavailable.run()).blocked,1);assert.equal(unavailable.links.length,0);
});
test("el Oráculo solicitado se ofrece directamente incluso con línea local y el enlace nunca sale en público",async()=>{
  for(const text of ["Quiero entrar al Oráculo","Vivo en España y prefiero una tirada online","No quiero llamar, quiero el Oráculo"]){
    const f=harness({proof:{text},lookupError:true});
    assert.equal((await f.run()).sent,1);assert.equal(f.calls.find(x=>x.name==="office_capture_begin").args.p_route,"oracle");
    assert.deepEqual(f.links,["oracle"]);
  }
  const pub=harness({job:{kind:"comment"},proof:{text:"Quiero el Oráculo",privateAllowed:false,publicAllowed:true}});
  assert.equal((await pub.run()).sent,1);assert.deepEqual(pub.links,[]);
  assert.equal(pub.calls.find(x=>x.name==="office_capture_begin").args.p_route,"public_invite");
});
test("una negativa a llamar tras un teléfono recibido ofrece la alternativa digital una sola vez en contexto",async()=>{
  const now=new Date(Date.now()-60000).toISOString(), earlier=new Date(Date.now()-2*86400000).toISOString();
  for(const [route,at,expected] of [["phone",now,1],["oracle",now,0],["phone",earlier,0],["ask_country",now,0]]){
    const f=harness({questions:[{route,completed_at:at}],proof:{text:"No puedo llamar, ¿hay otra opción?"}});
    assert.equal((await f.run()).sent,expected);
  }
  const support=harness({questions:[{route:"phone",completed_at:now}],proof:{text:"Quiero consultar pero no funciona el enlace"}});
  assert.equal((await support.run()).handoff,1);assert.deepEqual(support.links,[]);
});
test("un saludo privado se aclara sin canal de venta y un testimonio o una reacción no activa oferta",async()=>{
  const f=harness({job:{market:"ES"},proof:{text:"Buenas tardes"}});
  assert.equal((await f.run()).sent,1);assert.deepEqual(f.links,[]);
  assert.equal(f.calls.find(x=>x.name==="office_capture_begin").args.p_route,"clarify_request");
  assert.doesNotMatch(f.calls.find(x=>x.name==="send").body,/\+\d|http|país|gratis/);
  for(const text of ["Amén","Yes","Quiero agradecer la lectura","Quiero recomendar un amarre"]){
    const reaction=harness({job:{kind:"comment"},proof:{text}});
    assert.equal((await reaction.run()).handoff,1);assert.deepEqual(reaction.links,[]);
  }
});
test("el país desde el que escribe prevalece sobre la nacionalidad y una corrección ambigua no usa el país del CRM",async()=>{
  assert.equal(policy.messageMarket("Soy argentina, pero ahora vivo en España"),"ES");
  assert.equal(policy.messageMarket("No soy de España, te escribo desde España"),"ES");
  assert.equal(policy.messageMarket("Vivo en Guinea Ecuatorial"),"GQ");
  for (const text of ["Quiero consultar. Ya no vivo en España","Quiero consultar, vivo en Perú y vivo en Chile"]) {
    const f=harness({job:{market:"ES"},proof:{text},lines:{ES:{country:"ES",enabled:true,phone:"93 050 25 86"}}});
    assert.equal((await f.run()).sent,1);
    assert.equal(f.calls.find(x=>x.name==="office_capture_begin").args.p_route,"ask_country");
  }
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
test("la respuesta privada al comentario vincula el país del mismo autor incluso si lo escribió dos veces", async()=>{
  const time = Date.now()-3000, at=offset=>new Date(time+offset).toISOString();
  const prompt={route:"ask_country",remote_id:"ask",completed_at:at(-119500)};
  const older={route:"oracle",completed_at:at(-900000)};
  const history=[{id:"old-oracle",fromMe:true,createdAt:older.completed_at,text:"Tu enlace"},
    {id:"ask",fromMe:true,createdAt:at(-120000),text:"¿Desde qué país nos escribes?"},
    {id:"first",fromMe:false,createdAt:at(-60000),text:"Desde Puerto Rico"},
    {id:"in",fromMe:false,createdAt:at(0),text:"Puerto Rico"}];
  const proofFor=(messages,more=false)=>{
    const latest=messages.at(-1);
    return {sourceAt:latest.createdAt,sourceId:latest.id,text:latest.text,lastReplyAt:older.completed_at,
      countryHistory:policy.instagramCountryHistory(latest,messages,more)};
  };
  const pr={country:"PR",enabled:true,phone:"+1 787 945 0710"};
  for(const messages of [[...history.slice(0,2),{...history[2],id:"in"}],history,history.filter(m=>m.id!=="ask")]){
    const h=harness({proof:proofFor(messages),commentPrompt:prompt,questions:[older],lines:{PR:pr}});
    await h.webhook("biz","in","in");
    assert.equal(h.calls.filter(c=>c.name==="send").length,1);
    assert.match(h.calls.find(c=>c.name==="send").body,/787 945 0710/);
    assert.equal(h.calls.filter(c=>c.name==="office_capture_instagram_comment_context").length,2);
  }
  for(const text of ["Desde Puerto Rico","Hola, desde Puerto Rico","PUERTO RICO"])assert.equal(policy.countryAnswer(text),"PR");
  for(const text of ["Desde Puerto Rico o España","Mi amiga es de Puerto Rico","No estoy en Puerto Rico"])assert.equal(policy.countryAnswer(text),null);
  const human={id:"manual",fromMe:true,createdAt:at(-25000),text:"Te atiendo yo"};
  for(const scenario of [
    {proof:proofFor(history),commentPrompt:null}, {proof:proofFor(history),commentPrompt:{...prompt,completed_at:at(-90000000)}},
    {proof:proofFor([history[2],history[3]],true),commentPrompt:prompt},
    {proof:proofFor([...history.slice(0,-1),human,history.at(-1)]),commentPrompt:prompt},
    {proof:proofFor([...history.slice(0,-1),{...human,fromMe:false,text:"Necesito una persona"},history.at(-1)]),commentPrompt:prompt},
    {proof:proofFor(history),commentPrompt:prompt,freshProof:proofFor([...history.slice(0,-1),human,history.at(-1)])},
    {proof:proofFor(history),commentPrompts:[prompt,null]},
  ]) {
    const h=harness({...scenario,questions:[older],lines:{PR:pr}});
    assert.equal((await h.run()).handoff,1);assert.equal(h.calls.some(c=>c.name==="send"),false);
  }
});
test("una confirmación repetida tras la línea con su recibo exacto no duplica el teléfono ni abre un caso Comercial",async()=>{
  const time=Date.now()-60000,at=offset=>new Date(time+offset).toISOString();
  const attempt={route:"phone",receipt_id:"line",source_id:"a",completed_at:at(12500)};
  const history=[{id:"a",text:"Desde Puerto Rico",fromMe:false,createdAt:at(0)},
    {id:"line",text:"Puedes llamar",fromMe:true,createdAt:at(12000)},
    {id:"in",text:"Puerto Rico",fromMe:false,createdAt:at(21000)}];
  const countryProof=messages=>({text:messages.at(-1).text,sourceAt:messages.at(-1).createdAt,sourceId:"in",lastReplyAt:at(12200),
    countryHistory:policy.instagramCountryHistory(messages.at(-1),messages,false)});
  const h=harness({proof:countryProof(history),questions:[attempt]});
  assert.equal((await h.run()).blocked,1);assert.equal(h.calls.at(-1).args.p_reason,"COUNTRY_ALREADY_ANSWERED");
  assert.equal(h.calls.some(c=>c.name==="send"||c.name==="office_capture_begin"),false);
  for(const changed of [[...history.slice(0,2),{...history[2],text:"España"}],[history[0],{...history[1],id:"human"},history[2]]]){
    const g=harness({proof:countryProof(changed),questions:[attempt]});
    assert.equal((await g.run()).handoff,1);assert.equal(g.calls.some(c=>c.name==="send"),false);
  }
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
