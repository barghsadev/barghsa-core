#!/usr/bin/env python3
"""Exercise already-built production images using disposable Docker resources.

Build tags barghsa-audit-{api,worker,web}:f18 with Dockerfile.base's
production/worker targets and Dockerfile.web before running this script.
No host ports, checkout mounts, external providers, or existing databases.
"""
import json
import subprocess
import time
import uuid


prefix = "barghsa-image-test-" + uuid.uuid4().hex[:10]
containers = []
database_url = "postgresql://postgres:test-only@database:5432/audit"


def docker(*args, input=None, check=True, timeout=45):
    result = subprocess.run(["docker", *args], input=input, text=True,
                            capture_output=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f"docker {args[0]} failed: {result.stderr} {result.stdout}")
    return result


def sql(statement):
    return docker("exec", "-i", prefix + "-db", "psql", "-U", "postgres",
                  "-d", "audit", "-At", "-v", "ON_ERROR_STOP=1", input=statement).stdout.strip()


def eventually(predicate, seconds=25):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.2)
    raise AssertionError("Timed out waiting for expected container/database state")


def run_app(kind, suffix=None, extra=()):
    name = prefix + "-" + (suffix or kind)
    containers.append(name)
    docker("run", "-d", "--name", name, "--network", prefix, "--read-only",
           "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
           "-e", "DATABASE_URL=" + database_url, *extra,
           "barghsa-audit-" + kind + ":f18")
    inspection = json.loads(docker("inspect", name).stdout)[0]
    assert inspection["Config"]["User"] == "node"
    assert inspection["HostConfig"]["ReadonlyRootfs"]
    return name


def ready(name):
    return docker("exec", name, "node", "healthcheck.js", check=False).returncode == 0


def probe(name, port, path):
    js = (f'fetch("http://127.0.0.1:{port}{path}").then(async r=>'
          'console.log(JSON.stringify({status:r.status,warning:r.headers.get("x-health-warning"),body:await r.json()})))')
    return json.loads(docker("exec", name, "node", "-e", js).stdout)


def finish(name, code=0):
    docker("kill", "--signal=TERM", name)
    assert docker("wait", name).stdout.strip() == str(code)


def seed_work(sequence):
    invoice = f"10000000-0000-4000-8000-{sequence:012d}"
    notice = f"20000000-0000-4000-8000-{sequence:012d}"
    sql(f"""
      INSERT INTO invoices(id,profile_id,total_amount,state,due_at)
        VALUES ('{invoice}','10000000-0000-4000-8000-000000000000',1000,'Unpaid',NOW()-INTERVAL '1 day');
      INSERT INTO notification_outbox(id,profile_id,user_id,event_key,payload,channels,idempotency_key,idempotency_version,status)
        VALUES ('{notice}','10000000-0000-4000-8000-000000000000','image-audit','wallet.topup_completed','{{}}',ARRAY['in_app'],'{notice}',2,'queued');
      INSERT INTO notification_job(outbox_id,channel) VALUES ('{notice}','in_app');
    """)
    return invoice, notice


def assert_committed(invoice, notice):
    assert sql(f"SELECT state FROM invoices WHERE id='{invoice}'") == "Overdue"
    assert sql(f"SELECT status FROM notification_outbox WHERE id='{notice}'") == "delivered"
    assert sql(f"SELECT count(*) FROM in_app_notifications WHERE delivery_key='outbox:{notice}'") == "1"


try:
    docker("network", "create", prefix)
    containers.append(prefix + "-db")
    docker("run", "-d", "--name", prefix + "-db", "--network", prefix,
           "--network-alias", "database", "-e", "POSTGRES_PASSWORD=test-only",
           "-e", "POSTGRES_DB=audit", "postgres:17-alpine")
    eventually(lambda: docker("exec", prefix + "-db", "pg_isready", "-U", "postgres", check=False).returncode == 0)
    migration = ('const p=require("path");const {spawnSync}=require("child_process");'
                 'process.exit(spawnSync(process.execPath,[p.join(p.dirname(require.resolve("@barghsa/db")),"migrate.js")],{stdio:"inherit"}).status??1)')
    docker("run", "--rm", "--read-only", "--network", prefix,
           "-e", "DATABASE_URL=" + database_url, "barghsa-audit-worker:f18", "node", "-e", migration)
    api = run_app("api", extra=("-e", "APP_PUBLIC_URL=https://app.example.test",
                  "-e", "PAYMENT_GATEWAY_MERCHANT_ID=test-no-payment-requests",
                  "-e", "REDIS_URL=redis://unavailable:6379"))
    web = run_app("web")
    worker = run_app("worker")
    for name in [api, web, worker]:
        eventually(lambda: ready(name))
    response = probe(api, 4000, "/api/health/ready")
    assert response["status"] == 200
    assert "redis-unavailable" in (response["warning"] or "")
    print("PASS non-root/read-only boot, packaged migrations, optional Redis fallback", flush=True)

    docker("stop", prefix + "-db")
    assert probe(api, 4000, "/api/health/ready")["status"] == 503
    assert probe(worker, 9090, "/health/ready")["status"] == 503
    assert probe(api, 4000, "/api/health/live")["status"] == 200
    assert probe(worker, 9090, "/health/live")["status"] == 200
    docker("start", prefix + "-db")
    eventually(lambda: ready(worker) and ready(api))
    finish(worker)
    print("PASS database loss/recovery changes readiness but preserves liveness", flush=True)

    sql("""
      INSERT INTO users(user_id,username,password_hash,is_admin)
        VALUES ('image-audit','image@example.test','test-only',true);
      INSERT INTO profiles(id,user_id) VALUES ('10000000-0000-4000-8000-000000000000','image-audit');
      CREATE FUNCTION audit_slow_write() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_sleep(6); RETURN NEW; END $$;
      CREATE TRIGGER audit_slow_inbox BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION audit_slow_write();
      CREATE TRIGGER audit_slow_invoice BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION audit_slow_write();
    """)
    intervals = ("-e", "INVOICE_OVERDUE_SCAN_MS=1000", "-e", "OUTBOX_POLL_MS=1000")
    first = seed_work(1)
    drain = run_app("worker", "drain", intervals)
    eventually(lambda: int(sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep'")) >= 2)
    finish(drain)
    assert_committed(*first)
    assert sql("SELECT count(*) FROM audit_log WHERE event='invoice.mark_overdue'") == "1"
    print("PASS SIGTERM waits for concurrent notification and finance commits", flush=True)

    second = seed_work(2)
    deadline = run_app("worker", "deadline", (*intervals, "-e", "SHUTDOWN_GRACE_PERIOD_MS=500"))
    eventually(lambda: int(sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep'")) >= 2)
    finish(deadline, 1)
    # Terminate orphaned DB sessions after process exit; wait for rollback before
    # retrying. This models database detection of disconnected clients promptly.
    sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE wait_event='PgSleep'")
    eventually(lambda: sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep'") == "0")
    assert sql(f"SELECT state FROM invoices WHERE id='{second[0]}'") == "Unpaid"
    assert sql(f"SELECT count(*) FROM in_app_notifications WHERE delivery_key='outbox:{second[1]}'") == "0"
    sql("DROP TRIGGER audit_slow_inbox ON in_app_notifications; DROP TRIGGER audit_slow_invoice ON invoices;")
    # Shorten the durable lease's clock only in this isolated test database.
    sql(f"UPDATE notification_outbox SET locked_until=NOW()-INTERVAL '1 second' WHERE id='{second[1]}'")
    retry = run_app("worker", "retry", intervals)
    eventually(lambda: sql(f"SELECT status FROM notification_outbox WHERE id='{second[1]}'") == "delivered")
    eventually(lambda: sql(f"SELECT state FROM invoices WHERE id='{second[0]}'") == "Overdue")
    finish(retry)
    assert_committed(*second)
    assert sql("SELECT count(*) FROM audit_log WHERE event='invoice.mark_overdue'") == "2"
    finish(web)
    finish(api)
    print("PASS forced deadline leaves retryable work; restart commits once; web/API SIGTERM exit cleanly", flush=True)
finally:
    for name in reversed(containers):
        docker("rm", "-f", name, check=False)
    docker("network", "rm", prefix, check=False)
