const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),ts=require("typescript");
const source=fs.readFileSync("src/lib/server/office-atlas-publication.ts","utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

async function run({env="production",candidate={id:"run",version_id:"v1",format:"photo"},connection={},draft={},error,post="post"}={}) {
  const calls=[],exports={};
  class InstagramDraftError extends Error {}
  const db={rpc:async(name,params)=>{
    calls.push({name,params});
    return {data:name==="office_atlas_review_candidate"?candidate:post,error:null};
  }};
  vm.runInNewContext(code,{exports,process:{env:{VERCEL_ENV:env}},require(id) {
    if (id.endsWith("instagram-media")) return {InstagramDraftError,loadInstagramVersion:async(_db,id)=>{
      assert.equal(id,"v1");if(error)throw new InstagramDraftError(error);
      return {version:{status:"pendiente"},caption:"Texto verificado",alt_text:"Firma de marca",media:{type:"image/jpeg",sha:"digest"},...draft};
    }};
    if (id.endsWith("instagram-graph")) return {officeInstagramConnection:async()=>({username:"tarotcelestialof",account_id:"ig",persisted_account_id:"saved",connected_at:"generation",can_publish:true,...connection})};
    if (id.endsWith("instagram-worker")) return {processOfficeInstagram:async(_db,id)=>calls.push({name:"transport",id})};
    throw new Error(id);
  }});
  await exports.reviewAtlasPublication(db,"run");
  return calls;
}

test("el revisor prepara exactamente el archivo verificado, y sólo la aprobación SQL encola transporte",async()=>{
  const actions=await run();
  assert.deepEqual(actions.map(c=>c.name),["office_atlas_review_candidate","office_atlas_decide_publication","transport"]);
  assert.equal(actions[1].params.p_review.media_sha256,"digest");
  assert.equal(actions[1].params.p_review.caption,"Texto verificado");
  assert.equal(actions[2].id,"post");
  for(const input of [
    {connection:{can_publish:false,message:"Permiso pendiente"}},
    {connection:{username:"otra-cuenta"}},
    {draft:{media:{type:"video/mp4",sha:"incorrecto"}}},
    {error:"El adjunto es inválido"},
  ]) {
    const state=await run({...input,post:null});
    const decision=state.at(-1);
    assert.equal(decision.name,"office_atlas_decide_publication");
    assert.ok(decision.params.p_review.reason || decision.params.p_review.retry);
  }
  assert.deepEqual(await run({env:"preview"}),[]);
  assert.deepEqual((await run({candidate:null})).map(c=>c.name),["office_atlas_review_candidate"]);
});
