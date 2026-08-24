# ADR-003: Hybrid Deployment — Managed PostgreSQL and Application Topology

**Status:** Accepted  
**Date:** 2026-08-24  
**Deciders:** Platform Engineering Team  
**Dependencies:** T-04.01.02, E-05  

## Context

The Barghsa platform runs PostgreSQL as its primary data store. In production, the database can run in two topologies:

1. **All-in-one (single-server):** PostgreSQL, the API server, web server, and worker all run on a single VM. Acceptable for the initial pilot / low-traffic phase. Lower availability — a host failure brings down everything.
2. **Hybrid (managed PostgreSQL + app VM):** PostgreSQL runs on dedicated managed infrastructure (AWS RDS, Google Cloud SQL, DigitalOcean Managed Database, or a dedicated database VM). Application processes (API, web, worker) run on separate application VM(s). The application connects to PostgreSQL over TLS with certificate validation. Firewall rules restrict database access to authorized app VM IP(s) only.

For initial development and small-scale deployment, the single-server approach is sufficient. For any deployment that processes real customer payments or requires more than 99.5% availability, the hybrid topology with managed PostgreSQL is required.

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

The CA bundle path is configured via `DATABASE_CA_PATH` environment variable. When this variable is set, the application reads the CA bundle and passes it to the Pool constructor.

### 2. Connection URL priority

The application resolves the PostgreSQL connection target in the following order:

| Priority | Variable | Purpose |
|----------|----------|---------|
| 1 (highest) | `PGBOUNCER_URL` | PgBouncer (recommended for multi-replica HA) |
| 2 | `DATABASE_URL` | Direct PostgreSQL (hybrid managed DB) |
| 3 | `PGDIRECT_URL` | Direct admin/migration bypass |

When `DATABASE_URL` points to a managed PostgreSQL endpoint, TLS is required. The connection string may include `?sslmode=require` query parameter, or the `ssl` configuration may be set via the code-level config or `DATABASE_CA_PATH` / `DATABASE_SSL_ENABLED` env vars.

### 3. Firewall rules limit access to app VM IPs only

Managed PostgreSQL instances expose a public or VPC-private endpoint. Security is enforced at two layers:

- **Network firewall:** The managed PostgreSQL firewall (RDS security group, Cloud SQL authorized networks, or firewall rule) only permits connections from the application VM's public IP or VPC subnet. No other IP ranges are allowed.
- **Application-level user authentication:** The database role used by the application has minimal privileges (CRUD on application schema only, no DDL beyond migrations run via a separate admin role).

The firewall and network configuration is managed outside this repository (Terraform, cloud console, or managed-database provider). This ADR records the requirement; the actual firewall setup is part of the deployment infrastructure (E-05).

### 4. TLS configuration via environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (may include `sslmode`) |
| `DATABASE_SSL_ENABLED` | No | `false` | When `true`, enables TLS even if the connection string omits `sslmode` |
| `DATABASE_CA_PATH` | No | — | Filesystem path to the CA certificate bundle for server certificate validation |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | No | `true` | When `false`, connects with TLS but skips certificate validation (only for troubleshooting) |

Application code reads these variables in `createDbPool()` and passes them to the `Pool` constructor.

### 5. Documented lower availability for single-server deployments

Single-server deployments (all-in-one topology) come with explicitly documented availability limitations:

- **Target availability:** ≤ 99.5% (no HA commitment)
- **Risks:** No redundancy — host failure causes complete outage. No PostgreSQL automatic failover.
- **Mitigations:** Encrypted off-server backups (per T-04.01.07), documented restore procedure (per T-04.01.03), and a migration path to hybrid topology.
- **Restriction:** Single-server must not process real customer payments without an explicit risk acceptance from the platform lead.

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

Requiring TLS in local development would add friction for developers who need to set up CA certificates on their machine. Instead, TLS is `DATABASE_URL`-driven: the connection string can include `sslmode=disable` for local development, and TLS is only enforced in production.

## Migration path

1. **Phase 1 (current):** Single-server with local PostgreSQL container. `DATABASE_URL` points to `localhost:5432`. No TLS.
2. **Phase 2 (this task):** Hybrid topology ADR and TLS config support in code. Application can connect to managed PostgreSQL with TLS.
3. **Phase 3 (E-05):** Deployment playbook creates a managed PostgreSQL instance, configures firewall rules, and sets environment variables on the application VM. CI/CD pipeline switches from local to managed PostgreSQL.

## Review

This ADR should be reviewed when:
- A managed PostgreSQL provider is selected and CA bundle handling is operationalised.
- The application adds read replicas or database proxy that changes the TLS termination point.
- A connection pooler (PgBouncer) is adopted for HA — TLS termination between app and PgBouncer, and PgBouncer to PostgreSQL, must be configured separately.