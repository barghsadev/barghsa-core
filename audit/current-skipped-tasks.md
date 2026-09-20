# Current disposition of historically skipped tasks

58 historical skips remain in the record. 8 now have verified task-level acceptance.
The rest have the statuses shown below. Pending acceptance does not mean no code exists.
Review current requirements and preserve working implementation before planning any remaining build.
This list does not authorize dispatch or resume the feature loop.

Use [current canonical requirements](current-task-requirements.json) and [acceptance evidence](acceptance-closure.json). [Historical skip evidence](skipped-tasks.json) remains unchanged.

| Qualified task | Title | Acceptance | Next action |
| --- | --- | --- | --- |
| 01-platform-infrastructure.md#T-05.01.01 | Create Ansible playbook or deploy script for pilot topology | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.01.02 | Create `docker-compose.prod.yml` for pilot single-VM deployment | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.01.03 | Document explicitly that single-server deployment has lower availability | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.02.01 | Design and document commercial HA topology | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.02.02 | Configure rolling/blue-green deployment automation for HA | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.02.03 | Implement circuit breaker for external providers | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.02.04 | Configure maintenance mode per capability, not whole-application | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.03.01 | Create CI workflow definition (GitHub Actions, GitLab CI, or equivalent) | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.03.02 | Implement migration validation step (two environments) | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.03.03 | Implement OpenAPI generation and drift check | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.03.04 | Configure security scans in PR gate | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.03.05 | Implement coverage threshold enforcement | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.04.01 | Create staging gate CI workflow | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.04.02 | Create production promotion workflow with canary/gradual rollout | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.04.03 | Implement post-deploy smoke tests and SLO comparison | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.04.04 | Create runbooks for rollback scenarios | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.05.01 | Create nightly CI schedule | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.05.02 | Create weekly load/performance regression test | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.05.03 | Create quarterly disaster-recovery and restore exercise | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-05.05.04 | Create quarterly access review and threat-model update | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-06.01.01 | Initialize `packages/shared` with tsconfig and dependencies | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-06.01.02 | Create username validation and normalization helpers | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-06.01.03 | Create password validation with strength meter logic | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-06.01.04 | Create stable error code enum with HTTP status mapping | acceptance_verified | Preserve verified implementation; do not rebuild this task |
| 01-platform-infrastructure.md#T-06.01.05 | Create pagination helper schemas | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-06.02.01 | Initialize `packages/i18n` with message dictionary structure | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-06.02.02 | Create Jalali calendar date utilities | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-06.02.03 | Create timezone-aware date/time display utilities | acceptance_verified | Preserve verified implementation; do not rebuild this task |
| 01-platform-infrastructure.md#T-06.02.04 | Create logic for RTL/LTR switching based on locale | acceptance_verified | Preserve verified implementation; do not rebuild this task |
| 01-platform-infrastructure.md#T-06.02.05 | Localize number/currency formatting | acceptance_verified | Preserve verified implementation; do not rebuild this task |
| 01-platform-infrastructure.md#T-06.03.01 | Initialize `packages/ui` with shadcn/ui and Base UI | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-06.03.02 | Create themed component set with RTL support | acceptance_verified | Preserve verified implementation; do not rebuild this task |
| 01-platform-infrastructure.md#T-06.03.03 | Implement WCAG 2.2 AA accessibility in all shared components | acceptance_verified | Preserve verified implementation; do not rebuild this task |
| 01-platform-infrastructure.md#T-06.03.04 | Create localized DatePicker component | acceptance_verified | Preserve verified implementation; do not rebuild this task |
| 01-platform-infrastructure.md#T-06.03.05 | Implement theme system with admin overrides | partial | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.03.06 | Create loading/empty/error state components | acceptance_verified | Preserve verified implementation; do not rebuild this task |
| 01-platform-infrastructure.md#T-06.04.01 | Create privacy-safe analytics abstraction with consent gate and redaction | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.01.01 | Create `pnpm setup:dev` convenience script | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.01.02 | Configure dev-mode OTP bypass and console printing | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.01.03 | Create `pnpm db:push` script for dev schema synchronization | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.01.04 | Add environment indicator middleware | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.02.01 | Create versioned configuration store in PostgreSQL | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.02.02 | Create configuration validation framework | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.02.03 | Implement configuration rollback | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.02.04 | Create secrets encryption and masking service | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.02.05 | Implement provider configuration lifecycle with test-send | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.03.01 | Create shared ESLint configuration | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.03.02 | Configure Prettier with consistent formatting | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.03.03 | Set up Husky, lint-staged, and commitlint | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.03.04 | Create `.editorconfig` and `.vscode` workspace settings | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.04.01 | Create incident runbooks directory (`docs/runbooks/`) | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.04.02 | Create initial ADRs | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.04.03 | Create deployment guide | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.04.04 | Create incident response plan | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.05.01 | Enforce “no external call inside a database transaction” | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.05.02 | Generate and verify TypeScript API client contracts from OpenAPI | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.05.03 | Verify health-endpoint middleware exclusions | deferred | Keep deferred pending its recorded decision |
| 01-platform-infrastructure.md#T-07.05.04 | Document and gate module extraction criteria | deferred | Keep deferred pending its recorded decision |
