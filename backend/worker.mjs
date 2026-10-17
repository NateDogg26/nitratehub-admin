const encoder = new TextEncoder();
const COOKIE = '__Host-nitrate_session';
const OWNER = '933806891786731640';
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const encode = obj => b64(encoder.encode(JSON.stringify(obj)));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async s => b64(await crypto.subtle.digest('SHA-256',encoder.encode(s)));
const cookie = (name,value,age) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const cookies = request => Object.fromEntries((request.headers.get('Cookie')||'').split(';').map(p=>p.trim().split('=')));
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const redirect = (url,cookieValue) => new Response(null,{status:302,headers:{Location:url,'Cache-Control':'no-store',...(cookieValue?{'Set-Cookie':cookieValue}:{})}});
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
async function body(request){ if(Number(request.headers.get('Content-Length'))>16384)fail('Request too large',413); const text=await request.text();if(encoder.encode(text).length>16384)fail('Request too large',413);try{return JSON.parse(text);}catch{fail('Invalid JSON');} }
export function validatePush(input){
  if(!input || typeof input!=='object')fail('Invalid notification');
  const {appId,environment,audience,title,body:message,sound,deviceIds}=input;
  if(typeof appId!=='string'||!['development','production'].includes(environment)||!['all','mine','selected'].includes(audience))fail('Invalid app, environment, or audience');
  if(typeof title!=='string'||!title.trim()||title.length>100||typeof message!=='string'||!message.trim()||message.length>1000)fail('A title and message are required (100 / 1000 characters maximum)');
  if(typeof sound!=='boolean'||!Array.isArray(deviceIds)||deviceIds.length>500||deviceIds.some(id=>typeof id!=='string'||id.length>100))fail('Invalid device selection');
  const payload=JSON.stringify({aps:{alert:{title:title.trim(),body:message.trim()},...(sound?{sound:'default'}:{})}});
  if(encoder.encode(payload).length>4096)fail('APNs payload exceeds 4096 bytes');
  return {appId,environment,audience,title:title.trim(),payload,deviceIds:[...new Set(deviceIds)]};
}
async function session(request,env){
  const value=cookies(request)[COOKIE];if(!value)fail('Authentication required',401);
  const row=await env.DB.prepare('SELECT user_id,username FROM sessions WHERE hash=? AND expires>?').bind(await digest(value),Date.now()).first();
  if(!row)fail('Authentication required',401);
  if(row.user_id!==OWNER||env.OWNER_DISCORD_ID!==OWNER)fail('Permission denied',403);
  return row;
}
async function oauth(request,env,path){
  if(!env.DISCORD_CLIENT_ID||!env.DISCORD_CLIENT_SECRET||env.OWNER_DISCORD_ID!==OWNER)fail('Discord sign-in is not configured yet',503);
  const callback=env.API_ORIGIN+'/auth/callback';
  if(path==='/auth/discord'){
    const state=random();await env.DB.prepare('INSERT INTO oauth_states(hash,expires) VALUES(?,?)').bind(await digest(state),Date.now()+600000).run();
    const url=new URL('https://discord.com/oauth2/authorize');url.search=new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,response_type:'code',scope:'identify',redirect_uri:callback,state}).toString();
    return redirect(url.href,cookie('__Host-nitrate_oauth',state,600));
  }
  const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
  if(!state||!code||cookies(request)['__Host-nitrate_oauth']!==state)return redirect(env.FRONTEND_ORIGIN+'/?error=oauth');
  const row=await env.DB.prepare('DELETE FROM oauth_states WHERE hash=? AND expires>? RETURNING hash').bind(await digest(state),Date.now()).first();
  if(!row)return redirect(env.FRONTEND_ORIGIN+'/?error=oauth');
  const token=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:callback}),signal:AbortSignal.timeout(15000)});
  if(!token.ok)return redirect(env.FRONTEND_ORIGIN+'/?error=oauth');
  const credentials=await token.json();
  const profile=await fetch('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+credentials.access_token},signal:AbortSignal.timeout(15000)});
  if(!profile.ok)return redirect(env.FRONTEND_ORIGIN+'/?error=oauth');
  const user=await profile.json();
  if(user.id!==OWNER)return redirect(env.FRONTEND_ORIGIN+'/?error=denied',cookie(COOKIE,'',0));
  const tokenValue=random();await env.DB.prepare('INSERT INTO sessions(hash,user_id,username,expires) VALUES(?,?,?,?)').bind(await digest(tokenValue),user.id,user.global_name||user.username,Date.now()+28800000).run();
  return redirect(env.FRONTEND_ORIGIN+'/',cookie(COOKIE,tokenValue,28800));
}
async function overview(env){
  const [apps,devices,daily,history,count]=await Promise.all([
    env.DB.prepare("SELECT a.*, (SELECT COUNT(*) FROM devices d WHERE d.app_id=a.id AND d.enabled=1) AS devices,(SELECT COUNT(DISTINCT installation_id) FROM events e WHERE e.app_id=a.id AND julianday(e.created_at)>=julianday('now','-7 days')) AS active FROM apps a ORDER BY name COLLATE NOCASE").all(),
    env.DB.prepare('SELECT id,app_id,environment,model,label,mine,enabled,last_seen FROM devices ORDER BY last_seen DESC LIMIT 10000').all(),
    env.DB.prepare("SELECT substr(created_at,1,10) AS day,COUNT(*) AS count FROM events WHERE julianday(created_at)>=julianday('now','-7 days') GROUP BY day ORDER BY day").all(),
    env.DB.prepare('SELECT * FROM sends ORDER BY created_at DESC LIMIT 100').all(),
    env.DB.prepare("SELECT COALESCE(SUM(accepted),0) AS count FROM sends WHERE julianday(created_at)>=julianday('now','-7 days')").first()
  ]);
  return json({apps:apps.results,devices:devices.results,history:history.results,daily:daily.results,accepted7d:count.count});
}
let cachedAPNs;
async function apnsJWT(env){
  const cacheKey=env.APNS_KEY_ID+env.APNS_TEAM_ID+env.APNS_PRIVATE_KEY;
  if(cachedAPNs?.key===cacheKey&&cachedAPNs.expires>Date.now())return cachedAPNs.jwt;
  const der=Uint8Array.from(atob(env.APNS_PRIVATE_KEY.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',der,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const input=encode({alg:'ES256',kid:env.APNS_KEY_ID})+'.'+encode({iss:env.APNS_TEAM_ID,iat:Math.floor(Date.now()/1000)});
  const jwt=input+'.'+b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(input)));
  cachedAPNs={key:cacheKey,jwt,expires:Date.now()+3000000};return jwt;
}
async function sendOne(env,device,app,payload,jwt,id){
  let status='unknown',reason='Network response unavailable';
  try{
    const response=await fetch(`https://${device.environment==='development'?'api.sandbox.push.apple.com':'api.push.apple.com'}/3/device/${device.token}`,{method:'POST',headers:{authorization:'bearer '+jwt,'apns-topic':app.bundle_id,'apns-push-type':'alert','apns-priority':'10','apns-expiration':'0','apns-id':crypto.randomUUID(),'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(15000)});
    status=response.ok?'accepted':'failed';reason=response.ok?'':(await response.json()).reason||`HTTP ${response.status}`;
    if(['BadDeviceToken','Unregistered','DeviceTokenNotForTopic'].includes(reason))await env.DB.prepare('UPDATE devices SET enabled=0 WHERE id=? AND token=?').bind(device.id,device.token).run();
  }catch{/* Ambiguous requests are never automatically retried. */}
  await env.DB.prepare('UPDATE deliveries SET status=?,reason=? WHERE send_id=? AND device_id=?').bind(status,reason,id,device.id).run();
  return status;
}
async function push(request,env){
  const input=validatePush(await body(request));
  if(!env.APNS_KEY_ID||!env.APNS_TEAM_ID||!env.APNS_PRIVATE_KEY)fail('APNs credentials have not been configured',503);
  const id=request.headers.get('Idempotency-Key');if(!id||!/^[0-9a-f-]{36}$/.test(id))fail('A UUID Idempotency-Key is required');
  const prior=await env.DB.prepare('SELECT * FROM sends WHERE id=?').bind(id).first();if(prior)return json(prior);
  const app=await env.DB.prepare('SELECT * FROM apps WHERE id=?').bind(input.appId).first();
  if(!app||!app.bundle_id||app.bundle_id==='VERIFY_BEFORE_ENABLING')fail('Verify this app’s APNs bundle ID first');
  const rows=await env.DB.prepare('SELECT * FROM devices WHERE app_id=? AND environment=? AND enabled=1').bind(input.appId,input.environment).all();
  const selected=new Set(input.deviceIds);
  // Always send only the reviewed IDs, even when new registrations arrive before submission.
  const devices=rows.results.filter(d=>selected.has(d.id)&&(input.audience!=='mine'||d.mine));
  if(!devices.length)fail('No eligible devices selected');
  if(devices.length!==selected.size)fail('Device audience changed. Refresh and review it again.',409);
  if(devices.length>500)fail('Send at most 500 devices per batch');
  const jwt=await apnsJWT(env); // Validate credentials before recording a send.
  try{
    await env.DB.batch([
      env.DB.prepare('INSERT INTO sends(id,app_id,title,audience,total,created_at) VALUES(?,?,?,?,?,?)').bind(id,app.id,input.title,input.audience,devices.length,new Date().toISOString()),
      ...devices.map(d=>env.DB.prepare("INSERT INTO deliveries(send_id,device_id,status) VALUES(?,?,'unknown')").bind(id,d.id))
    ]);
  }catch(error){const existing=await env.DB.prepare('SELECT * FROM sends WHERE id=?').bind(id).first();if(existing)return json(existing);throw error;}
  const counts={accepted:0,failed:0,unknown:0};
  for(let i=0;i<devices.length;i+=10){const statuses=await Promise.all(devices.slice(i,i+10).map(d=>sendOne(env,d,app,input.payload,jwt,id)));for(const s of statuses)counts[s]++;}
  await env.DB.prepare('UPDATE sends SET accepted=?,failed=?,unknown=?,status=? WHERE id=?').bind(counts.accepted,counts.failed,counts.unknown,counts.unknown?'incomplete':'completed',id).run();
  return json({id,total:devices.length,...counts});
}
async function ingest(request,env){
  // Server-to-server only. Never embed this key in a mobile application.
  if(!env.INGEST_SECRET||request.headers.get('Authorization')!=='Bearer '+env.INGEST_SECRET)fail('Permission denied',403);
  const input=await body(request);const app=await env.DB.prepare('SELECT id FROM apps WHERE id=?').bind(input.appId||'').first();if(!app)fail('Unknown app');
  if(input.type==='device'){
    if(typeof input.token!=='string'||!/^([a-f0-9]{2}){16,128}$/i.test(input.token)||!['development','production'].includes(input.environment)||typeof input.model!=='string'||input.model.length>80)fail('Invalid device');
    const id=await digest(app.id+':'+input.environment+':'+input.token.toLowerCase());
    await env.DB.prepare('INSERT INTO devices(id,app_id,token,environment,model,last_seen) VALUES(?,?,?,?,?,?) ON CONFLICT(app_id,token,environment) DO UPDATE SET model=excluded.model,last_seen=excluded.last_seen,enabled=1').bind(id,app.id,input.token.toLowerCase(),input.environment,input.model,new Date().toISOString()).run();
  }else if(input.type==='event'){
    if(typeof input.id!=='string'||input.id.length>100||!input.id||typeof input.installationId!=='string'||!input.installationId||input.installationId.length>100||typeof input.name!=='string'||!input.name||input.name.length>80)fail('Invalid event');
    await env.DB.prepare('INSERT OR IGNORE INTO events(id,app_id,installation_id,name,created_at) VALUES(?,?,?,?,?)').bind(app.id+':'+input.id,app.id,input.installationId,input.name,new Date().toISOString()).run();
  }else fail('Invalid ingestion type');
  await env.DB.prepare('UPDATE apps SET connected=1 WHERE id=?').bind(app.id).run();return json({ok:true});
}
async function handle(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/health')return json({ok:true,authConfigured:Boolean(env.DISCORD_CLIENT_ID&&env.DISCORD_CLIENT_SECRET),pushConfigured:Boolean(env.APNS_KEY_ID&&env.APNS_TEAM_ID&&env.APNS_PRIVATE_KEY)});
  if(path==='/ingest'&&request.method==='POST')return ingest(request,env);
  if(request.method==='GET'&&['/auth/discord','/auth/callback'].includes(path))return oauth(request,env,path);
  if(request.method!=='GET'&&request.headers.get('Origin')!==env.FRONTEND_ORIGIN)fail('Permission denied',403);
  const owner=await session(request,env);
  if(path==='/auth/me'&&request.method==='GET')return json({id:owner.user_id,username:owner.username});
  if(path==='/auth/logout'&&request.method==='POST'){
    await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await digest(cookies(request)[COOKIE])).run();const r=json({ok:true});r.headers.set('Set-Cookie',cookie(COOKIE,'',0));return r;
  }
  if(path==='/api/overview'&&request.method==='GET')return overview(env);
  if(path==='/api/push'&&request.method==='POST')return push(request,env);
  if(path.startsWith('/api/devices/')&&request.method==='PATCH'){
    const input=await body(request),id=decodeURIComponent(path.slice('/api/devices/'.length));
    if(input.mine!==undefined){if(typeof input.mine!=='boolean')fail('Invalid device flag');await env.DB.prepare('UPDATE devices SET mine=? WHERE id=?').bind(input.mine?1:0,id).run();}
    if(input.label!==undefined){if(typeof input.label!=='string'||input.label.length>80)fail('Invalid label');await env.DB.prepare('UPDATE devices SET label=? WHERE id=?').bind(input.label,id).run();}
    return json({ok:true});
  }
  return json({error:'Not found'},404);
}
export default {
  async fetch(request,env){
    let response;
    try{
      if(request.method==='OPTIONS')response=new Response(null,{status:204});else response=await handle(request,env);
    }catch(error){response=json({error:error.status?error.message:'Service temporarily unavailable'},error.status||500);}
    response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','no-referrer');
    if(request.headers.get('Origin')===env.FRONTEND_ORIGIN){response.headers.set('Access-Control-Allow-Origin',env.FRONTEND_ORIGIN);response.headers.set('Access-Control-Allow-Credentials','true');response.headers.set('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');response.headers.set('Access-Control-Allow-Headers','Content-Type,Idempotency-Key');response.headers.set('Vary','Origin');}
    return response;
  },
  async scheduled(controller,env){await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(Date.now()),env.DB.prepare('DELETE FROM oauth_states WHERE expires<?').bind(Date.now()),
    env.DB.prepare("DELETE FROM events WHERE julianday(created_at)<julianday('now','-90 days')"),
    env.DB.prepare("UPDATE sends SET accepted=(SELECT COUNT(*) FROM deliveries WHERE send_id=sends.id AND status='accepted'),failed=(SELECT COUNT(*) FROM deliveries WHERE send_id=sends.id AND status='failed'),unknown=(SELECT COUNT(*) FROM deliveries WHERE send_id=sends.id AND status='unknown'),status='interrupted' WHERE status='sending' AND julianday(created_at)<julianday('now','-1 hour')")
  ]);}
};
