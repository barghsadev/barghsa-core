# ADR 005 PostgreSQL integration tests

## Context

The application relies on PostgreSQL transactions, constraints, advisory
locks, ranges and extensions. An integration test must exercise those
behaviors before a database or API change can be accepted.

## Decision

Use disposable PostgreSQL for persistence and HTTP integration tests. Apply
the production migrations to a fresh baseline and give concurrent suites
separate databases or schemas. Keep database credentials scoped to the owned
test fixture. [Backend test setup](../development/ci.md#backend-test-databases).

## Alternatives

Use mocks for unit boundaries. Keep persistence evidence on PostgreSQL
because SQLite and in-memory engines differ in concurrency, constraints and
SQL behavior.

## Consequences

Integration runs need a container runtime and take longer to start. A migrated
template permits fresh clones while keeping the production migrations and
isolation checks in the test path.

## Owner and review trigger

Platform Engineering owns the test database policy. Review it when the
supported PostgreSQL major version, extensions, migrations or fixture
isolation strategy changes.
