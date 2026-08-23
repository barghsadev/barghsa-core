# Barghsa — Product Kanban

> Full-scope task breakdown for `README.md` and `architecture.md`.
> Coverage is enforced by `requirements-traceability.json` and `scripts/build_backlog.py`.

---

## Domain Epics

| # | Domain | Epic File | Lines | Status |
|---|--------|-----------|-------|--------|
| 01 | Platform & Infrastructure | `epics/01-platform-infrastructure.md` | 1,412 | ✅ Audited |
| 02 | Auth, Users, CRM & Admin | `epics/02-auth-users-admin.md` | 1,016 | ✅ Audited |
| 03 | Core Business (Products, Electricity, Saving, Solar, Consultation) | `epics/03-core-business.md` | 899 | ✅ Audited |
| 04 | Invoices, Wallet, Payments & Contracts | `epics/04-invoices-wallet-contracts.md` | 798 | ✅ Audited |
| 05 | Notifications, Documents & AI Orchestration | `epics/05-notifications-documents-ai.md` | 789 | ✅ Audited |
| 06 | Security, Testing, Observability & Operations | `epics/06-security-testing-observability.md` | 1,237 | ✅ Audited |
| 07 | UI/UX Foundation & Design System | `epics/07-ui-ux-design.md` | 1,239 | ✅ Audited |
| | **Total** | **7 epic files** | **7,390** | **7/7 validated** |

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

## Legend

- **Epics (E-NN):** Large feature areas spanning multiple sprints
- **Stories (S-NN.MM):** User/tech stories within an epic
- **Tasks (`T-*`):** Concrete implementation units. Formatting depth may vary by domain; global identity is `<epic-file>#<task-id>`.
- **Complexity:** S (small, hours), M (medium, days), L (large, ~week), XL (multi-week, split recommended)
- **Traceability:** Every source section maps to concrete queued task keys in `requirements-traceability.json`.

---

## Loop Automation Preparation

The kanban is ready for the autonomous build loop with these artifacts:

| File | Purpose |
|------|---------|
| `kanban/task-queue.json` | Deterministically generated ordered queue of every concrete epic task |
| `kanban/loop-state.json` | Persistent state tracker — orchestrator reads/writes here |
| `AGENTS.md` | Protocol playbook for Builder and Reviewer agents |
| `kanban/index.md` | Overall execution order and phase breakdown |
| `kanban/requirements-traceability.json` | Source-section → executable task-key coverage ledger |
| `kanban/scripts/build_backlog.py` | Queue/ledger generator and consistency validator |

### Model Assignment

| Role | Model | How |
|------|-------|-----|
| **Builder** | DeepSeek V4 Flash (Max) | via `delegate_task` subagent |
| **Reviewer** | GPT-5.6 Sol | invoked by orchestrator via OpenRouter API |
| **Orchestrator** | DeepSeek V4 Flash | Cron job — state mgmt + gh CLI operations |

### Loop flow

1. Orchestrator picks next task from queue → dispatches **Builder**
2. Builder codes, tests, pushes, creates PR
3. Orchestrator dispatches **Reviewer**
4. Reviewer checks code → either approves+merges or requests changes
5. Loop back to step 2 if changes needed, else step 1 for next task

### Next Step

Start the loop by resuming cron job `d09ad66fea0b` when you want autonomous development to begin.

> **Task identity:** Bare task IDs repeat across epic files. The loop uses `<fname>#<id>` as the stable key (for example, `01-platform-infrastructure.md#T-01.01.01`).
>
> Regenerate and validate before starting: `python3 kanban/scripts/build_backlog.py --write && python3 kanban/scripts/build_backlog.py --check`.