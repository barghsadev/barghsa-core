# Current disposition of historically skipped tasks

58 historical skips remain in the record. 2 now have verified task-level acceptance.
The rest have the statuses shown below. Pending acceptance does not mean no code exists.
Review current requirements and preserve working implementation before planning any remaining build.
This list does not authorize dispatch or resume the feature loop.

Use [current canonical requirements](current-task-requirements.json) and [acceptance evidence](acceptance-closure.json). [Historical skip evidence](skipped-tasks.json) remains unchanged.

| Qualified task | Title | Acceptance | Next action |
| --- | --- | --- | --- |
| 01-platform-infrastructure.md#T-05.01.01 | Create Ansible playbook or deploy script for pilot topology | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.01.02 | Create `docker-compose.prod.yml` for pilot single-VM deployment | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.01.03 | Document explicitly that single-server deployment has lower availability | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.02.01 | Design and document commercial HA topology | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.02.02 | Configure rolling/blue-green deployment automation for HA | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.02.03 | Implement circuit breaker for external providers | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.02.04 | Configure maintenance mode per capability, not whole-application | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.03.01 | Create CI workflow definition (GitHub Actions, GitLab CI, or equivalent) | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.03.02 | Implement migration validation step (two environments) | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.03.03 | Implement OpenAPI generation and drift check | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.03.04 | Configure security scans in PR gate | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.03.05 | Implement coverage threshold enforcement | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.04.01 | Create staging gate CI workflow | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.04.02 | Create production promotion workflow with canary/gradual rollout | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.04.03 | Implement post-deploy smoke tests and SLO comparison | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.04.04 | Create runbooks for rollback scenarios | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.05.01 | Create nightly CI schedule | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.05.02 | Create weekly load/performance regression test | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.05.03 | Create quarterly disaster-recovery and restore exercise | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-05.05.04 | Create quarterly access review and threat-model update | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.01.01 | Initialize `packages/shared` with tsconfig and dependencies | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.01.02 | Create username validation and normalization helpers | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.01.03 | Create password validation with strength meter logic | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.01.04 | Create stable error code enum with HTTP status mapping | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.01.05 | Create pagination helper schemas | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.02.01 | Initialize `packages/i18n` with message dictionary structure | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.02.02 | Create Jalali calendar date utilities | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.02.03 | Create timezone-aware date/time display utilities | acceptance_verified | Preserve verified implementation; do not rebuild this task |
| 01-platform-infrastructure.md#T-06.02.04 | Create logic for RTL/LTR switching based on locale | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.02.05 | Localize number/currency formatting | acceptance_verified | Preserve verified implementation; do not rebuild this task |
| 01-platform-infrastructure.md#T-06.03.01 | Initialize `packages/ui` with shadcn/ui and Base UI | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.03.02 | Create themed component set with RTL support | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.03.03 | Implement WCAG 2.2 AA accessibility in all shared components | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.03.04 | Create localized DatePicker component | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.03.05 | Implement theme system with admin overrides | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.03.06 | Create loading/empty/error state components | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-06.04.01 | Create privacy-safe analytics abstraction with consent gate and redaction | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.01.01 | Create `pnpm setup:dev` convenience script | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.01.02 | Configure dev-mode OTP bypass and console printing | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.01.03 | Create `pnpm db:push` script for dev schema synchronization | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.01.04 | Add environment indicator middleware | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.02.01 | Create versioned configuration store in PostgreSQL | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.02.02 | Create configuration validation framework | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.02.03 | Implement configuration rollback | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.02.04 | Create secrets encryption and masking service | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.02.05 | Implement provider configuration lifecycle with test-send | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.03.01 | Create shared ESLint configuration | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.03.02 | Configure Prettier with consistent formatting | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.03.03 | Set up Husky, lint-staged, and commitlint | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.03.04 | Create `.editorconfig` and `.vscode` workspace settings | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.04.01 | Create incident runbooks directory (`docs/runbooks/`) | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.04.02 | Create initial ADRs | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.04.03 | Create deployment guide | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.04.04 | Create incident response plan | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.05.01 | Enforce “no external call inside a database transaction” | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.05.02 | Generate and verify TypeScript API client contracts from OpenAPI | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.05.03 | Verify health-endpoint middleware exclusions | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
| 01-platform-infrastructure.md#T-07.05.04 | Document and gate module extraction criteria | acceptance_pending | Review current implementation against requirements; build only unmet remainder |
