# Barghsa — Product Kanban

> Full-scope task breakdown for `README.md` and `architecture.md`.
> Coverage is enforced by `requirements-traceability.json` and `scripts/build_backlog.py`.

---

## Domain Epics

| # | Domain | Epic File | Lines | Status |
|---|--------|-----------|-------|--------|
| 01 | Platform & Infrastructure | `epics/01-platform-infrastructure.md` | 1,412 | ✅ Audited |
| 02 | Auth, Users, CRM & Admin | `epics/02-auth-users-admin.md` | 1,015 | ✅ Audited |
| 03 | Core Business (Products, Electricity, Saving, Solar, Consultation) | `epics/03-core-business.md` | 899 | ✅ Audited |
| 04 | Invoices, Wallet, Payments & Contracts | `epics/04-invoices-wallet-contracts.md` | 797 | ✅ Audited |
| 05 | Notifications, Documents & AI Orchestration | `epics/05-notifications-documents-ai.md` | 789 | ✅ Audited |
| 06 | Security, Testing, Observability & Operations | `epics/06-security-testing-observability.md` | 1,237 | ✅ Audited |
| 07 | UI/UX Foundation & Design System | `epics/07-ui-ux-design.md` | 1,239 | ✅ Audited |
| | **Total** | **7 epic files** | **7,388** | **7/7 validated** |

---

## Implementation Order (Dependency-Driven)

Ordered by logical dependency — later phases depend on earlier ones being substantially complete.

### Phase 0 — Foundation Sprint(s)

| Order | Epic | Rationale |
|-------|------|-----------|
| **1** | **E-01** — Platform & Infrastructure | Monorepo scaffold, build toolchain, Docker, CI/CD, database setup — everything depends on this |
| **2** | **E-07** — UI/UX Foundation & Design System | Design tokens, shadcn/ui components, RTL setup, theme system — all frontend work needs it |
| **3** | **E-06** — Security Foundation & Testing Infra | Argon2id, CSRF, session handling, CSP, rate limiting, Vitest/Playwright setup — depends on E-01 |

### Phase 1 — Auth & Core Identity

| Order | Epic | Rationale |
|-------|------|-----------|
| **4** | **E-02** — Auth, Users, CRM & Admin | Register/login/OTP, profiles, onboarding, TOS, CRM — must exist before any business flow. Depends on E-01, E-06 security foundation |

### Phase 2 — Business Core

| Order | Epic | Rationale |
|-------|------|-----------|
| **5** | **E-04** — Invoices, Wallet, Payments & Contracts | Wallet ledger, invoice engine, contract lifecycle, refunds — core financial infra. Depends on E-01, E-02 |
| **6** | **E-03** — Core Business (Products, Electricity, Saving, Solar, Consultation) | Product catalog, ordering, power saving, solar, consultation — business domain logic. Depends on E-04 (invoicing) |

### Phase 3 — Supporting Capabilities

| Order | Epic | Rationale |
|-------|------|-----------|
| **7** | **E-05** — Notifications, Documents & AI Orchestration | Email/SMS transport, file storage, AI agents — supporting infrastructure. Depends on E-01, E-02, E-04 |

### Phase 4 — Security Hardening & Observability

| Order | Epic | Rationale |
|-------|------|-----------|
| **8** | **E-06** — Advanced Security, Observability & Operations | Pen testing, threat modeling, dashboards, SLOs, runbooks — continuous improvement layer. Depends on Phases 1-3 being live |

> Each phase may span multiple sprints. Source gaps belong directly in normal stories/tasks; prose-only remediation appendices are not executable backlog.

---

## Quality Gates Per Phase

| Gate | Applies To |
|------|-----------|
| PR gate (12 checks) | Every PR in every phase |
| Main/staging gate (10 checks) | Before release candidate |
| Production promotion (8 checks) | Before production |
| Scheduled: nightly/weekly/quarterly | Ongoing after Phase 0 |

---

Implementation status is recorded in `audit/acceptance-closure.json`. “Audited” above describes the task breakdown, not completed implementation.

## Legend

- **Epics (E-NN):** Large feature areas spanning multiple sprints
- **Stories (S-NN.MM):** User/tech stories within an epic
- **Tasks (`T-*`):** Concrete implementation units. Formatting depth may vary by domain; global identity is `<epic-file>#<task-id>`.
- **Complexity:** S (small, hours), M (medium, days), L (large, ~week), XL (multi-week, split recommended)
- **Traceability:** Every source section maps to concrete queued task keys in `requirements-traceability.json`.

---

## Continuing development

Read [continuation status](CONTINUATION.md) before selecting the next task. The generated queue includes every canonical task; it is not a list of unfinished work. Combine it with the [current acceptance ledger](../audit/acceptance-closure.json) to avoid repeating completed repairs.

The local repair sprint is complete. The automatic loop remains blocked pending remote reconciliation and recovery. Do not resume a scheduler from this document.

| File | Purpose |
| --- | --- |
| `kanban/task-queue.json` | Generated order and canonical task metadata |
| `audit/acceptance-closure.json` | Current acceptance of the 322 historically reviewed claims |
| `audit/progress.json` | Repair completion, decisions and continuation readiness |
| `kanban/loop-state.json` | Historical snapshot only; never dispatch from it |
| `kanban/STATE-PROTOCOL.md` | Authoritative remote state, reconciliation and recovery rules |
| `kanban/requirements-traceability.json` | Source-section coverage ledger |
| `kanban/scripts/build_backlog.py` | Queue and traceability validator |

### Configured automation protocol

Cursor CLI builds, validates and authors the PR. Codex CLI reviews the exact committed PR revision. The deterministic supervisor may merge only on a separate later tick after checking the durable review and all required checks. Model assignments and the paused scheduler identifier are defined in [AGENTS.md](../AGENTS.md); they do not authorize starting the loop.

Runtime state belongs outside the product checkout, with its authoritative snapshot on the dedicated remote `kanban-state` branch. [STATE-PROTOCOL.md](STATE-PROTOCOL.md) explains bootstrap and recovery. The historical checkout snapshot must not be promoted into live state.

Use qualified task identities, for example `04-invoices-wallet-contracts.md#T-04.3.01.06`. Validate before any dispatch with `python3 kanban/scripts/build_backlog.py --check`. Regenerate only after changing canonical requirements or explicit priority promotions.
