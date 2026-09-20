# Document and contract route loading

Follow-up to full main #320 run 35542208954. Functional tests, browser checks, security and integrity passed, but combined coverage reported an uncovered generated branch at the admin document route import line.

Reproduced locally against a coverage build. TanStack already splits route components; an extra lazyRouteComponent wrapper adds another dynamic import and Vite emits `true ? preloadDependencies : undefined`. That unreachable generated arm maps to the source import line. The customer/admin document and contract routes now directly reference their page components so TanStack performs the single route split. No coverage filter, threshold or mapping rule changes.

Local tests: 27 document/contract/signature/navigation cases pass. Navigation tests assert the actual page bindings and retain pending-state checks. Web typecheck and coverage build pass. Production browser behavior, combined coverage, bundle sizes and independent review/CI remain to verify. No kanban feature completion is claimed by this follow-up.
