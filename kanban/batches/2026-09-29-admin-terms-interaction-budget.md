# Admin terms interaction budget

Task context: `01-platform-infrastructure.md#T-01.03.04` (admin terms route slice).

The admin terms page already loads its rich editor, publish preview and version viewer after explicit staff actions. The route-budget checker now measures those chunks as separate interactions, excluding the entry bootstrap already fetched by the page and sibling interactions with their own budgets. It still counts every static dependency and unbudgeted nested dynamic import, and fails if interaction code becomes an eager page dependency. No budget was raised and the page code is unchanged.

The admin terms initial route measures 329.2 KB against 500 KB after the companion main-route batch. The editor measures 148.8 KB against 170 KB, publish preview 33.6 KB against 50 KB, and version viewer 24.2 KB against 35 KB. The Size Limit CLI and budget regression suite pass for these rules. The dashboard and electricity ordering budgets are closed in the main-route batch.
