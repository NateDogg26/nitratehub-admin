#!/usr/bin/env python3
"""Read-only Keyra/Neighbourhood snapshots to the owner-only NitrateHub API.
No app database writes, no notification sends, no personal account fields.
"""
import base64,hashlib,json,os,sqlite3,sys,time,urllib.request
from datetime import datetime,timezone
from pathlib import Path
API='https://admin-api.nitratehub.xyz/ingest'
STATE=Path(os.environ.get('BRIDGE_STATE','/var/lib/nitratehub-bridge/state.json'))

def stamp(value):return datetime.fromtimestamp(float(value),timezone.utc).isoformat().replace('+00:00','Z')
def opaque(value):return hashlib.sha256(str(value).encode()).hexdigest()
def post(data):
 request=urllib.request.Request(API,data=json.dumps(data).encode(),headers={'Authorization':'Bearer '+os.environ['INGEST_SECRET'],'Content-Type':'application/json','User-Agent':'NitrateHub-Bridge/1.0'},method='POST')
 with urllib.request.urlopen(request,timeout=20) as response:
  if response.status!=200:raise RuntimeError('Ingestion failed')
def env_file(path):
 result={}
 for line in Path(path).read_text().splitlines():
  line=line.strip()
  if not line or line.startswith('#') or '=' not in line:continue
  key,value=line.split('=',1);result[key]=value.strip().strip('"').strip("'")
 return result

def keyra():
 config={'APNS_ENV':os.environ.get('KEYRA_APNS_ENV','development')}
 db=sqlite3.connect('file:/home/keyra/data/keyra.db?mode=ro',uri=True,timeout=10);db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON')
 rows=[dict(r) for r in db.execute('SELECT id,model,name,push_token,last_seen FROM devices WHERE revoked_at IS NULL')];db.close()
 environment='production' if config.get('APNS_ENV')=='production' else 'development'
 return [{'id':opaque('keyra:'+r['id']),'model':(r['model'] or 'Apple device')[:80],'deviceName':(r['name'] or '')[:100],'sourceIdentifier':str(r['id']),'token':r['push_token'] or '', 'environment':environment,'seen':r['last_seen']} for r in rows]

def neighbourhood():
 config=os.environ
 sys.path.insert(0,'/opt/neighbourhood/Backend')
 import psycopg
 from psycopg.rows import dict_row
 from nb import crypto
 crypto.configure()
 with psycopg.connect(config['DATABASE_URL'],row_factory=dict_row,options='-c default_transaction_read_only=on -c statement_timeout=10000') as db:
  rows=db.execute("SELECT d.id,d.device_name,d.token_cipher,d.environment,d.last_seen_at FROM devices d JOIN sessions s ON s.token=d.session_token WHERE d.platform='ios' AND d.enabled=TRUE AND s.expires>%s",(time.time(),)).fetchall()
 return [{'id':opaque('neighbourhood:'+r['id']),'model':'Apple device','deviceName':(r['device_name'] or '')[:100],'sourceIdentifier':str(r['id']),'token':crypto.reveal('devices',r['id'],'token',r['token_cipher']),'environment':r['environment'],'seen':r['last_seen_at']} for r in rows]

def device_id(app,row):return base64.urlsafe_b64encode(hashlib.sha256((app+':'+row['environment']+':'+row['token'].lower()).encode()).digest()).decode().rstrip('=')

def sync(app,rows,prior):
 current={};previous=prior.get(app,{})
 for row in rows:
  seen=float(row['seen']);event_id=row['id']+':'+str(int(seen))
  # Preserve the original activity time; importing an old device never makes it active today.
  if seen>=time.time()-90*86400 and previous.get('events',{}).get(row['id'])!=event_id:
   post({'type':'event','appId':app,'id':event_id,'installationId':row['id'],'name':'backend_activity','occurredAt':stamp(seen)})
  if row['token']:
   identifier=device_id(app,row);current[identifier]={'seen':seen,'id':identifier,'metadata':opaque(row['model']+row['deviceName']+row['sourceIdentifier']),'sourceIdentifier':row['sourceIdentifier'],'environment':row['environment']}
   if previous.get('devices',{}).get(identifier,{})!=current[identifier]:
    post({'type':'device','appId':app,'token':row['token'],'environment':row['environment'],'model':row['model'],'deviceName':row['deviceName'],'sourceIdentifier':row['sourceIdentifier'],'lastSeenAt':stamp(seen),'reactivate':identifier not in previous.get('devices',{})})
 for removed in set(previous.get('devices',{}))-set(current):
  old=previous['devices'][removed]
  if old.get('sourceIdentifier'):
   if any(d.get('sourceIdentifier')==old['sourceIdentifier'] and d.get('environment')==old['environment'] for d in current.values()):continue
   post({'type':'deviceRemoved','appId':app,'sourceIdentifier':old['sourceIdentifier'],'environment':old['environment']})
  else:post({'type':'deviceRemoved','appId':app,'id':removed})
 post({'type':'status','appId':app})
 prior[app]={'devices':current,'events':{r['id']:r['id']+':'+str(int(float(r['seen']))) for r in rows}}
 print(app+': synced '+str(len(rows))+' installations, '+str(len(current))+' push registrations',flush=True)

def main():
 if '--check' in sys.argv:
  for name,reader in [('keyra',keyra),('neighbourhood',neighbourhood)]:
   rows=reader();print(name+': read-only check OK; '+str(len(rows))+' eligible installations')
  return
 prior=json.loads(STATE.read_text()) if STATE.exists() else {}
 failed=False
 for app,reader in [('keyra',keyra),('neighbourhood',neighbourhood)]:
  try:sync(app,reader(),prior)
  except Exception as error:
   # Never log tokens, connection strings, decrypted fields, or HTTP bodies.
   print(app+': sync failed ('+type(error).__name__+')',file=sys.stderr,flush=True);failed=True
 STATE.parent.mkdir(parents=True,exist_ok=True)
 temporary=STATE.with_suffix('.tmp');temporary.write_text(json.dumps(prior));temporary.chmod(0o600);temporary.replace(STATE)
 if failed:raise SystemExit(1)
if __name__=='__main__':main()
