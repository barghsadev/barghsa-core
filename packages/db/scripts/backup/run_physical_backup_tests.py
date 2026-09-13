"""Isolated Docker runner. Build barghsa-backup-audit:local first."""
import subprocess, uuid, time, json
from pathlib import Path
prefix = 'barghsa-backup-audit-' + uuid.uuid4().hex[:10]
network, minio, runner = prefix+'-net', prefix+'-s3', prefix+'-runner'
def cmd(*args):
 r=subprocess.run(['docker',*args],capture_output=True,text=True)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout.strip()
try:
 cmd('network','create',network)
 cmd('run','-d','--name',minio,'--network',network,'--network-alias','storage','-e','MINIO_ROOT_USER=audit-access','-e','MINIO_ROOT_PASSWORD=audit-secret-local-only','minio/minio','server','/data')
 time.sleep(2)
 result=subprocess.run(['docker','run','--rm','--name',runner,'--network',network,'--user','postgres','-e','BACKUP_S3_ENDPOINT=http://storage:9000','-e','BACKUP_ALLOW_HTTP=true','-e','BACKUP_S3_BUCKET=audit-backups','-e','BACKUP_S3_ACCESS_KEY=audit-access','-e','BACKUP_S3_SECRET_KEY=audit-secret-local-only','-v',str(Path(__file__).resolve().parent)+':/opt/backup:ro','-w','/opt/backup','barghsa-backup-audit:local','python3','-B','-m','unittest','-v','test_physical_backup'], timeout=600)
 raise SystemExit(result.returncode)
finally:
 for name in (runner,minio): subprocess.run(['docker','rm','-f',name],capture_output=True)
 subprocess.run(['docker','network','rm',network],capture_output=True)
