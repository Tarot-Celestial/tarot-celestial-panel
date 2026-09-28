const {test}=require('node:test');const assert=require('node:assert/strict');
const ts=require('typescript'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const output=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/campaigns.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mod={};vm.runInNewContext(output,{exports:mod,URL,Date});
const {normalizeCampaign,normalizeAudience,safeCampaignUrl,isTrustedPushEndpoint}=mod;
const base={title:'Aviso',message:'Mensaje',expires_at:'2030-01-01T00:00:00Z',channels:['panel'],audience:{mode:'all'}};
test('rejects unsafe links and images while allowing local and HTTPS destinations',()=>{
 for(const url of ['javascript:alert(1)','data:text/html,test','//evil.example','/\\evil.example','https://user:pass@example.com','http://example.com','/\n/evil'])assert.throws(()=>safeCampaignUrl(url));
 assert.equal(safeCampaignUrl('/cliente/precios-ofertas'),'/cliente/precios-ofertas');assert.equal(safeCampaignUrl('https://example.com/a'),'https://example.com/a');
});
test('WhatsApp is unavailable until an official transport is connected',()=>assert.throws(()=>normalizeCampaign({...base,channels:['whatsapp']})));
test('rejects missing, expired and malformed content',()=>{
 for(const patch of [{title:''},{message:''},{expires_at:'bad'},{expires_at:'2000-01-01'},{channels:[]},{title:'x'.repeat(101)}])assert.throws(()=>normalizeCampaign({...base,...patch}));
});
test('audiences validate identifiers, bounds and discard inactive filters',()=>{
 assert.throws(()=>normalizeAudience({mode:'selected',client_ids:[]}));assert.throws(()=>normalizeAudience({mode:'selected',client_ids:['bad']}));
 for(const value of [-1,0,731,1.5])assert.throws(()=>normalizeAudience({mode:'segment',inactive_days:value}));
 assert.equal(normalizeAudience({mode:'all',country:'España',inactive_days:30}).country,'');
 const id='11223344-5566-4777-8888-123456789012';assert.equal(normalizeAudience({mode:'selected',client_ids:[id,id]}).client_ids.length,1);
});
test('push endpoints cannot target arbitrary hosts or internal services',()=>{
 for(const url of ['http://fcm.googleapis.com/a','https://127.0.0.1/','https://fcm.googleapis.com.evil.test/a','https://evil.test','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a'])assert.equal(isTrustedPushEndpoint(url),false);
 for(const url of ['https://fcm.googleapis.com/fcm/send/a','https://updates.push.services.mozilla.com/wpush/v2/a','https://web.push.apple.com/a','https://wns2.notify.windows.com/a'])assert.equal(isTrustedPushEndpoint(url),true);
});
