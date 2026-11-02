// Read-only deployment gate. Never creates an order, captures or sends messages.
const REQUIRED=['CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DECLINED','PAYMENT.CAPTURE.DENIED'];
const EXPECTED_URL='https://clientestarotcelestial.es/api/webhooks/paypal-cliente';
async function verify(env=process.env,request=fetch){
 const value=k=>{let v=String(env[k]||'').trim();if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1).trim();return v;};
 if(value('PAYPAL_CUSTOMER_CHECKOUT_ACCOUNT')!=='client_business_v1')return {active:false};
 const mode=value('PAYPAL_CUSTOMER_ENVIRONMENT'),client=value('PAYPAL_CUSTOMER_CLIENT_ID'),secret=value('PAYPAL_CUSTOMER_CLIENT_SECRET'),webhook=value('PAYPAL_CUSTOMER_WEBHOOK_ID'),merchant=value('PAYPAL_CUSTOMER_MERCHANT_ID');
 if(!['live','sandbox'].includes(mode)||!client||!secret||!webhook||!merchant||/\s/.test(merchant)||client===secret)throw Error('LEONARIS_CONFIGURATION_INCOMPLETE');
 if(env.VERCEL_ENV==='production'&&mode!=='live')throw Error('LEONARIS_PRODUCTION_REQUIRES_LIVE');
 const base=mode==='live'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
 let response;try{response=await request(base+'/v1/oauth2/token',{method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:'Basic '+Buffer.from(client+':'+secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});}catch{throw Error('LEONARIS_AUTH_NETWORK');}
 const token=await response.json().catch(()=>null);if(!response.ok||!token?.access_token)throw Error('LEONARIS_AUTH_FAILED_HTTP_'+response.status);
 try{response=await request(base+'/v1/notifications/webhooks/'+encodeURIComponent(webhook),{method:'GET',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+token.access_token}});}catch{throw Error('LEONARIS_WEBHOOK_NETWORK');}
 const data=await response.json().catch(()=>null);if(!response.ok)throw Error('LEONARIS_WEBHOOK_FAILED_HTTP_'+response.status);
 if(data?.id!==webhook||data?.url!==EXPECTED_URL)throw Error('LEONARIS_WEBHOOK_MISMATCH');
 const events=new Set((data.event_types||[]).filter(e=>e.status!=='DISABLED').map(e=>e.name));
 if(REQUIRED.some(e=>!events.has(e)))throw Error('LEONARIS_WEBHOOK_EVENTS_MISSING');
 return {active:true,environment:mode,oauth_verified:true,webhook_verified:true,merchant_configured:true,payment_flow_verified:false};
}
module.exports={verify};
if(require.main===module)verify().then(result=>console.log('[PayPal Leonaris preflight]',JSON.stringify(result))).catch(error=>{console.error('[PayPal Leonaris preflight]',/^LEONARIS_[A-Z0-9_]+$/.test(error.message)?error.message:'LEONARIS_CHECK_FAILED');process.exitCode=1;});
