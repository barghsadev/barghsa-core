# ADR-003: Hybrid Deployment — Managed PostgreSQL and Application Topology

**Status:** Accepted  
**Date:** 2026-08-24  
**Deciders:** Platform Engineering Team  
**Dependencies:** T-04.01.02, E-05

## Context

The Barghsa platform runs PostgreSQL as its primary data store. In production, the database can run in two topologies:

1. **All-in-one (single-server):** PostgreSQL, the API server, web server, and worker all run on a single VM. Acceptable for the initial pilot / low-traffic phase. Lower availability — a host failure brings down everything.
2. **Hybrid (managed PostgreSQL + app VM):** PostgreSQL runs on dedicated managed infrastructure (AWS RDS, Google Cloud SQL, DigitalOcean Managed Database, or a dedicated database VM). Application processes (API, web, worker) run on separate application VM(s). The application connects to PostgreSQL over TLS with certificate validation. Firewall rules restrict database access to authorized app VM IP(s) only.

The all-in-one topology is suitable for development and pilots without real payments. Real customer payments require PostgreSQL and versioned object storage separate from the application host. A commercial availability target above 99.5% requires the redundant topology below.

This ADR documents the hybrid deployment architecture, the TLS connection configuration, and the migration path from single-server to hybrid.

## Decision

### 1. Application connects to PostgreSQL over TLS with certificate validation

In the hybrid topology, the application connects to the managed PostgreSQL instance over TLS. The `pg.Pool` constructor is configured with `ssl` options that enforce certificate validation:

```
ssl: {
  rejectUnauthorized: true,     // Reject connections with invalid certificates
  ca: fs.readFileSync('/path/to/rds-ca-bundle.pem').toString()  // CA bundle path
}
```

For cloud-specific services:

- **AWS RDS:** Use the AWS RDS CA bundle (`rds-ca-bundle.pem` or `rds-combined-ca-bundle.pem`)
- **Google Cloud SQL:** Use the server's CA certificate (downloaded from the Cloud SQL Console)
- **DigitalOcean:** CA certificate provided in the connection details page

Enable `DATABASE_SSL_ENABLED=true` and set `DATABASE_CA_PATH` to the mounted CA bundle. With environment-controlled TLS enabled, the application validates and loads that file; unreadable or malformed bundles fail. A CA path alone does not enable TLS. Explicit `ssl` configuration takes precedence over these environment variables and URL TLS settings.

### 2. Connection URL priority

For ordinary runtime connections, `PGBOUNCER_URL` takes precedence over `DATABASE_URL`.
`PGDIRECT_URL` is used by direct/admin pools and is not an ordinary-pool fallback.
Programmatic `config.pgbouncerUrl` takes precedence; explicit `config.databaseUrl`
bypasses the environment's pooler URL. Direct admin pools use `config.pgdirectUrl`,
then `PGDIRECT_URL`, then `DATABASE_URL`. Finance session locks use a separate direct
pool when transaction pooling is enabled, as specified in [ADR002](002-connection-pooling.md).

Use certificate-validated TLS for every production network hop. Configure
`DATABASE_SSL_ENABLED=true`, leave `DATABASE_SSL_REJECT_UNAUTHORIZED=true`, and
mount the appropriate CA bundle. The libpq backup clients separately require
`sslmode=verify-full` and their CA settings in `PGDIRECT_URL`; application TLS
environment switches do not configure those external tools. Pooler-to-PostgreSQL
TLS is a separate pooler setting. Validate all hops against the deployed certificates.

### 3. Firewall rules limit access to app VM IPs only

Managed PostgreSQL instances expose a public or VPC-private endpoint. Security is enforced at two layers:

- **Network firewall:** The managed PostgreSQL firewall (RDS security group, Cloud SQL authorized networks, or firewall rule) only permits connections from the application VM's public IP or VPC subnet. No other IP ranges are allowed.
- **Application-level user authentication:** The database role used by the application has minimal privileges (CRUD on application schema only, no DDL beyond migrations run via a separate admin role).

The firewall and network configuration is managed outside this repository (Terraform, cloud console, or managed-database provider). This ADR records the requirement; the actual firewall setup is part of the deployment infrastructure (E-05).

### 4. TLS configuration via environment variables

| Variable                           | Required | Default | Description                                                                     |
| ---------------------------------- | -------- | ------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                     | Yes      | —       | PostgreSQL connection string (may include `sslmode`)                            |
| `DATABASE_SSL_ENABLED`             | No       | `false` | When `true`, enables TLS even if the connection string omits `sslmode`          |
| `DATABASE_CA_PATH`                 | No       | —       | Filesystem path to the CA certificate bundle for server certificate validation  |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | No       | `true`  | When `false`, skips certificate validation; forbidden for production deployment |

Application code reads these variables in `createDbPool()` and passes them to the `Pool` constructor.

### 5. Documented lower availability for single-server deployments

Single-server deployments (all-in-one topology) come with explicitly documented availability limitations:

- The pilot targets 99.5% availability without an HA commitment.
- A host failure stops the whole service. The all-in-one topology has no redundant application or automatic PostgreSQL failover.
- Encrypted off-server backups and a rehearsed restore are required. Follow the [PostgreSQL backup and restore runbook](../operations/backup/postgresql-restore-runbook.md).
- Real customer payments require separate PostgreSQL and versioned object storage.

### 6. Commercial high availability

Place at least two replicas each of the web, API and background worker across two independent failure domains. Size the remaining replicas to handle the expected load after losing either domain. Use the same application images in both domains. Route public web and API traffic through a managed TLS load balancer. Admit API replicas after `/api/health/ready` succeeds and remove unhealthy replicas from rotation. Keep workers and inference endpoints on private networks.

Use managed multi-zone PostgreSQL with automatic failover, or a Patroni cluster with the same tested recovery contract. Provide redundant PgBouncer endpoints for ordinary API and worker connections and a direct endpoint for migrations and session-bound financial locks. Validate TLS certificates and hostnames on every database hop. Use versioned, redundant S3-compatible object storage. Redis can accelerate cross-replica reads and quotas. PostgreSQL remains authoritative when Redis is unavailable.

Apply compatible migrations before routing traffic to a new revision. Introduce the new replicas in one failure domain, check readiness and the affected journeys, then drain old connections before replacing the other domain. Stop promotion and restore the previous verified image digests on failed readiness or smoke checks. Run destructive schema cleanup only after the rollback window.

The design targets 99.9% availability and recovery within 60 minutes via automatic failover. Measure recovery from loss of a failure domain, including PostgreSQL promotion, application reconnection, worker recovery and readback of committed financial records. Record the observed recovery time and exact image and configuration identities in the release evidence.

## Consequences

**Positive:**

- Application code is topology-agnostic — the same Docker image works in single-server, hybrid, and HA topologies.
- TLS with certificate validation meets the security requirement for production database connections.
- Env var configuration for TLS is standard and deployer-friendly.
- Clear firewall and access control guidance for infrastructure provisioning.

**Negative:**

- Managing CA bundle paths adds operational overhead — the CA bundle must be updated when the managed provider rotates their root CA.
- Certificate validation requires the CA bundle file on the application VM, adding a deployment dependency.
- The TLS configuration adds complexity to the `createDbPool()` config interface.

## Alternatives considered

### No TLS for internal VPC (rejected)

In a VPC with strict network ACLs, some teams skip TLS within the VPC boundary. This is rejected because:

- Internal VPC traffic may still traverse shared physical infrastructure.
- Regulatory compliance (PCI-DSS, SOC2) requires encryption in transit regardless of network boundary.
- Defence-in-depth principle: network ACLs + TLS is strictly better than network ACLs alone.

### Always-required TLS (rejected for dev)

Requiring TLS in local development would add friction for developers who need to set up CA certificates on their machine. Instead, TLS is `DATABASE_URL`-driven: the connection string can include `sslmode=disable` for local development, Production deployment must explicitly enable and verify certificate-validated TLS; the factory does not infer a managed endpoint or enforce TLS from `NODE_ENV` alone.

## Migration path

1. **Phase 1 (current):** Single-server with local PostgreSQL container. `DATABASE_URL` points to `localhost:5432`. No TLS.
2. **Phase 2 (this task):** Hybrid topology ADR and TLS config support in code. Application can connect to managed PostgreSQL with TLS.
3. **Phase 3 (E-05):** Deployment playbook creates a managed PostgreSQL instance, configures firewall rules, and sets environment variables on the application VM. CI/CD pipeline switches from local to managed PostgreSQL.

## Review

This ADR should be reviewed when:

- A managed PostgreSQL provider is selected and CA bundle handling is operationalised.
- The application adds read replicas or database proxy that changes the TLS termination point.
- A connection pooler (PgBouncer) is adopted for HA — TLS termination between app and PgBouncer, and PgBouncer to PostgreSQL, must be configured separately.

## Operational proof still required

The application supports validated TLS, but that capability is not evidence of a
configured production endpoint, firewall or provider. Record the deployed endpoint,
certificate chain/hostname verification, rejected untrusted-certificate attempt and
firewall denial from an unauthorized network before accepting this deployment task.
For single-server installations, use the [encrypted backup and restore runbook](../operations/backup/postgresql-restore-runbook.md)
with storage outside the database host. Local MinIO on the same host is development
proof only. No managed deployment or live network policy is created by this ADR.
