#!/usr/bin/env python3
"""Install only the standalone NitrateHub bridge and timer; leave app services untouched."""
from pathlib import Path
import os,shutil,subprocess,pwd
from bridge import env_file
if os.geteuid()!=0:raise SystemExit('Run this installer with sudo.')
source=Path(__file__).resolve().parent
for folder in ['/opt/nitratehub-bridge','/var/lib/nitratehub-bridge']:
 Path(folder).mkdir(parents=True,exist_ok=True);Path(folder).chmod(0o755 if folder.startswith('/opt/') else 0o700)
for filename,target,mode in [
 ('bridge.py','/opt/nitratehub-bridge/bridge.py',0o644),
 ('nitratehub-bridge.service','/etc/systemd/system/nitratehub-bridge.service',0o644),
 ('nitratehub-bridge.timer','/etc/systemd/system/nitratehub-bridge.timer',0o644),
 ('.env.integration','/etc/nitratehub-bridge.env',0o600)]:
 shutil.copyfile(source/filename,target);os.chmod(target,mode);os.chown(target,0,0)
identity=pwd.getpwnam('neighbourhood-api')
os.chown('/var/lib/nitratehub-bridge',identity.pw_uid,identity.pw_gid)
keyra_environment=env_file('/home/keyra/.env').get('APNS_ENV','development')
if keyra_environment not in ('development','production'):raise SystemExit('Unknown Keyra APNs environment')
with open('/etc/nitratehub-bridge.env','a') as config:config.write('KEYRA_APNS_ENV='+keyra_environment+'\n')
environment=os.environ.copy();environment.update(env_file('/etc/neighbourhood/backend.env'));environment.update(env_file('/etc/nitratehub-bridge.env'))
subprocess.run(['runuser','-u','neighbourhood-api','--','/opt/neighbourhood/.venv/bin/python','/opt/nitratehub-bridge/bridge.py','--check'],check=True,env=environment)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','nitratehub-bridge.timer'],check=True)
subprocess.run(['systemctl','start','nitratehub-bridge.service'],check=True)
print('Bridge installed. No app service was restarted.')
