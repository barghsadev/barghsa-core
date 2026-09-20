# Epic 07 implementation coverage

This is a UI implementation record, not supervisor completion state. Task identities refer to `07-ui-ux-design.md#<id>`. No loop state, completed-task history or generated queue is changed by this refresh.

## Delivered in this change

| Epic tasks                 | Result                                                                                     | Limits                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| T-07.01.01.04              | Exported Button, Input, Card and Badge variant definitions                                 | Existing Base UI foundation retained                                                              |
| T-07.01.02.01              | Button hierarchy, sizes, loading and disabled behavior                                     | Base UI composition instead of Radix asChild; use native anchors with buttonVariants              |
| T-07.01.02.02              | Input sizes and error/success variants; exported existing InputGroup for icons and units   | Help/error composition remains explicit; no forced form-library migration                         |
| T-07.01.02.04              | Card variants and consistent card subcomponents                                            | Interaction semantics remain caller-owned                                                         |
| T-07.01.02.05              | Semantic badges, sizes and StatusBadge dot                                                 | Labels supplied by caller                                                                         |
| T-07.01.03.15              | Success, warning and information alert variants                                            | Dismiss/action behavior composed by callers                                                       |
| T-07.01.03.21              | Bounded offset Pagination with RTL arrows and localized labels                             | Cursor pagination, page-size selector and result-count composition still pending                  |
| T-07.02.01.02–05           | Light/dark semantic colors, spacing/layout, typography and motion tokens                   | Not every extended raw palette scale migrated                                                     |
| T-07.02.01.06              | Replaced light-only feedback classes across existing customer/admin screens                | Full repository-wide enforcement still pending                                                    |
| T-07.02.02.01              | Complete dark values for new semantic colors                                               | Existing active-brand provider retains theme ownership                                            |
| T-07.03.01 and T-07.04.01  | RTL shells, local font, larger controls, responsive navigation                             | Partial cross-cutting work; full epic verification remains pending                                |
| T-07.05 and T-07.08        | Visible focus, loading semantics, reduced motion, safer confirmation focus                 | Broad conformance and motion audit still pending                                                  |
| T-07.12.01.01              | AsyncView with explicit state selection                                                    | Existing data hooks remain unchanged                                                              |
| T-07.12.01.04              | Detail/form/table/card loading skeletons                                                   | Route-wide adoption remains incremental                                                           |
| T-07.12.01.06–07           | WaitingForBarghsa and NoDeadEndBanner                                                      | Exported components; real backend states must supply content                                      |
| T-07.13.01.01–02, .05, .07 | Controlled confirmation, optional exact phrase, safe initial focus, FinancialReviewSummary | Dedicated financial-acknowledgement flow and useConfirm not added; no mutation workflows migrated |
| T-07.14.01.05              | Password visibility touch target; semantic strength colors                                 | Existing strength evaluation retained; duplicate progress track fixed                             |
| T-07.15.01.01              | Refined profile switcher appearance                                                        | Existing native switch control and context isolation retained                                     |
| T-07.16.01.01–03, .06      | Shared customer/admin frame, grouped icon navigation, topbar, current-page context         | No new profile menu, bottom tabs, system theme toggle or automatic full breadcrumb hierarchy      |
| T-07.17.01.01–04           | Auth brand/form layout, compact mobile brand, language switch                              | Existing auth data flow and guards retained                                                       |
| T-07.17.02.01–04           | Existing auth controls restyled                                                            | No new authentication endpoint or flow                                                            |
| T-07.19.01                 | Existing dashboard overview and wallet/status cards refreshed                              | No invented widgets, charts, transaction history or backend data                                  |
| T-07.26                    | Existing wallet balance card and financial display finish                                  | New domain workflows remain pending                                                               |
| T-07.27.01                 | StatusBadge, Timeline and ProgressStepper                                                  | No hardcoded domain-state registry; mappings belong to features                                   |

Ranges in this table describe partial progress unless the entire task acceptance criteria are met. They must not be copied into the supervisor's completed list as blanket approvals.

## Remaining work by epic section

| Section  | Remaining scope                                                             |
| -------- | --------------------------------------------------------------------------- |
| 07.01    | Full gallery coverage, additional primitives, server-state/query foundation |
| 07.02    | Repository-wide token enforcement and comprehensive palette scales          |
| 07.03    | Broader locale persistence, content and bidirectional audit                 |
| 07.04    | Full page/device matrix and additional responsive patterns                  |
| 07.05    | Full WCAG 2.2 AA audit, manual assistive-technology review                  |
| 07.06    | Unified user/system/admin theme precedence and initial-paint handling       |
| 07.07    | Branding acceptance review; existing administrative branding is retained    |
| 07.08    | Route transitions and advanced motion patterns                              |
| 07.09    | Existing localized pickers need task-by-task coverage review                |
| 07.10    | react-hook-form/Zod wrappers, dynamic fields and wizard infrastructure      |
| 07.11    | Existing notification center retained; remaining notification behaviors     |
| 07.12    | Adopt shared states throughout all routes; shared fetch hook if justified   |
| 07.13    | Financial acknowledgement, promise API and domain confirmation integration  |
| 07.14    | Remaining strength-meter acceptance checks                                  |
| 07.15    | Rich profile menu, verification metadata and loading composition            |
| 07.16    | Permission-resolved navigation, user menu, bottom tabs and full breadcrumbs |
| 07.17    | Remaining guard and individual auth-page acceptance review                  |
| 07.18    | URL-backed filters and common list framework                                |
| 07.19    | Independent server-backed dashboard widgets                                 |
| 07.20–21 | Customer AI chat and admin test chat components/flows                       |
| 07.22–23 | Form wizard and conversation-thread patterns                                |
| 07.24    | Additional table/grid behaviors beyond existing table                       |
| 07.25    | Shared upload/status composition                                            |
| 07.26    | Remaining wallet display/task criteria                                      |
| 07.27    | Domain-specific status registry, dual status and solar progress             |
| 07.28–29 | Existing onboarding/agent workflows need their own acceptance audit         |
| 07.30    | Settings layout/framework and versioned preview/history patterns            |

## Scope boundaries

Feature page layouts remain unchanged. Layout changes are confined to authentication, the customer dashboard and the customer/admin application frames. Shared field sizes and visual treatments can affect wrapping, but form order, sections and columns are retained.

New reusable workflow components live in the shared library and development catalogue. They do not expose unimplemented features in product pages. AI, Documents and Videos were already placeholder-only destinations and are hidden from customer navigation until usable.

No new dependency was added. No database schema, auth contract, financial calculation, permission model or supervisor state was changed. `audit/progress.json` was already modified before this work and is excluded from the final commit.
