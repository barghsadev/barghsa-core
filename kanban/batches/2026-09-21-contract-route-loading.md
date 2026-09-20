# Document and contract route loading

Follow-up to full main #320 run 35542208954. Functional tests, browser checks, security and integrity passed, but combined coverage reported an uncovered generated branch at the admin document route import line.

Reproduced locally against a coverage build. TanStack already splits route components; an extra lazyRouteComponent wrapper adds another dynamic import and Vite emits `true ? preloadDependencies : undefined`. That unreachable generated arm maps to the source import line. The customer/admin document and contract routes now directly reference their page components so TanStack performs the single route split. No coverage filter, threshold or mapping rule changes.

Local tests: 27 document/contract/signature/navigation cases pass. Navigation tests assert the actual page bindings and retain pending-state checks. Web typecheck and coverage build pass. All 12 production Chromium document/contract/signature checks pass in English and Persian. Actual collected browser coverage merged with unit coverage passes the changed/critical gate: all nine critical and one noncritical executable route lines are covered. No generated branch remains in these routes. Production build, all 44 route/interaction budgets and targeted lint pass. Independent review and CI remain after rebasing onto the verified signature merge. No kanban feature completion is claimed by this follow-up.

Parent signature PR #322 merged at `c9bdd1c76fa173965bc3282e8ce8d9d4f677529a` with independent exact-HEAD approval and five successful checks. This follow-up is rebased onto that verified merge. Browser coverage will be collected against the final committed HEAD before review.
