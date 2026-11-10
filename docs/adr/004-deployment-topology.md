# ADR 004 Deployment topology and scaling

## Context

A single-host pilot concentrates outages in one failure domain. Commercial
production with real payments has a 99.9% availability objective and must
survive an application host failure. [System architecture](../../architecture.md).

## Decision

Use the single application host for the pilot and staging where their limits
are accepted. For commercial production, run at least two stateless API and
web replicas across failure domains behind a managed load balancer, with
redundant workers. Use verified TLS to the managed PostgreSQL service and a
failover or managed recovery path that meets the recovery objective.

Scale individual processes vertically first when measurements justify more
capacity. Add replicas or worker concurrency when availability, latency or
queue age requires it. [Hybrid deployment decision](003-hybrid-deployment.md).

## Alternatives

The single-host topology costs less and concentrates outages. A replicated
modular monolith removes the application host dependency without introducing
service extraction. Extraction requires its own measured case and review.

## Consequences

Commercial rollout needs health, failover, backup, restore and rollback
evidence against the selected topology. Keep separate receipts for pilot and
commercial deployments. [Production deployment and promotion](../../deploy/production/README.md).

## Owner and review trigger

Platform Engineering owns the deployment boundary. Review this decision before
accepting real payments or when measured capacity, recovery or availability
cannot meet the current objectives.
