const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/server/paypal-crm.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(env={},response={access_token:'PRIVATE-TOKEN'},status=200){
 const calls=[],logs=[],exports={};
 const context={exports,require:()=>({}),URL,Buffer,AbortSignal,Date,process:{env:{PAYPAL_ENVIRONMENT:'live',PAYPAL_CLIENT_ID:'client-value',PAYPAL_CLIENT_SECRET:'secret-value',PAYPAL_WEBHOOK_ID:'WH',PAYPAL_PUBLIC_BASE_URL:'https://panel.test',...env}},
 console:{log:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},
 fetch:async(url,init)=>{calls.push({url,init});if(response instanceof Error)throw response;return {ok:status>=200&&status<300,status,json:async()=>{if(response==='NOT_JSON')throw Error('invalid JSON');return response}};}};
 vm.runInNewContext(source,context);return {api:exports,calls,logs};
}
test('Connection test makes OAuth request only and never returns a token or credentials',async()=>{
 const h=harness();const result=await h.api.testPayPalConnection();assert.equal(h.calls.length,1);assert.ok(h.calls[0].url.endsWith('/v1/oauth2/token'));assert.equal(result.environment,'live');assert.equal(result.diagnostic_version,'PP-AUTH-2');
 for(const secret of ['PRIVATE-TOKEN','client-value','secret-value'])assert.ok(!JSON.stringify(result).includes(secret));assert.equal(h.logs.length,0);
});
test('Leading/trailing whitespace and enclosing quotes are normalized, actual credentials preserved',async()=>{
 const h=harness({PAYPAL_ENVIRONMENT:' live\n',PAYPAL_CLIENT_ID:' "client-value" \r\n',PAYPAL_CLIENT_SECRET:" 'secret-value' "});await h.api.testPayPalConnection();
 assert.equal(h.calls[0].url,'https://api-m.paypal.com/v1/oauth2/token');assert.equal(h.calls[0].init.headers.Authorization,'Basic '+Buffer.from('client-value:secret-value').toString('base64'));
});
test('Malformed and identical credentials are caught before PayPal requests',async()=>{
 for(const env of [{PAYPAL_CLIENT_ID:''},{PAYPAL_CLIENT_SECRET:'hidden…'},{PAYPAL_CLIENT_SECRET:'value\nvalue'},{PAYPAL_CLIENT_SECRET:'secret-value\\n'},{PAYPAL_CLIENT_SECRET:'client-value'}]){
 const h=harness(env);await assert.rejects(h.api.testPayPalConnection());assert.equal(h.calls.length,0);
 }
});
test('invalid_client gives actual environment and HTTP status without guessing which credential is wrong',async()=>{
 const h=harness({}, {error:'invalid_client',error_description:'secret-value PRIVATE-TOKEN'},401);
 await assert.rejects(h.api.testPayPalConnection(),e=>e.message.includes('LIVE · HTTP 401 · invalid_client')&&!e.message.includes('secret-value')&&!e.message.includes('PRIVATE-TOKEN'));
 assert.equal(h.logs.length,0);
});
test('Denial, rate limit, provider failure, malformed JSON and network errors are distinguished',async()=>{
 for(const [body,status,expected] of [[{error:'unauthorized_client'},401,'no autoriza'],[{},429,'limitado'],[{},503,'fallo de su servicio'],['NOT_JSON',502,'HTTP 502'],[{},200,'UNEXPECTED_RESPONSE'],[Error('secret-value'),0,'NETWORK']]){
 const h=harness({},body,status);await assert.rejects(h.api.testPayPalConnection(),e=>e.message.includes(expected)&&!e.message.includes('secret-value'));
 }
});
test('Unknown provider fields and descriptions are not echoed',async()=>{
 const h=harness({}, {error:'secret-value',error_description:'PRIVATE-TOKEN'},401);await assert.rejects(h.api.testPayPalConnection(),e=>e.message.includes('UNEXPECTED_RESPONSE')&&!e.message.includes('secret-value')&&!e.message.includes('PRIVATE-TOKEN'));
});
test('Sandbox remains Sandbox; no automatic fallback to a different account/environment',async()=>{
 const h=harness({PAYPAL_ENVIRONMENT:'sandbox'});await h.api.testPayPalConnection();assert.equal(h.calls[0].url,'https://api-m.sandbox.paypal.com/v1/oauth2/token');
 const bad=harness({PAYPAL_ENVIRONMENT:'secret-value'});await assert.rejects(bad.api.testPayPalConnection());assert.equal(bad.calls.length,0);
});
test('Creation does not run after failed authentication',async()=>{
 const h=harness({}, {error:'invalid_client'},401);await assert.rejects(h.api.paypalRequest('/v2/checkout/orders',{},'retry-id'));assert.equal(h.calls.length,1);
});
