# Assistant account status shortcut

Task context: `07-ui-ux-design.md#T-07.20.01.03` (contextual suggestion) and a read-only customer account-data slice. Full AI tool execution under `05-notifications-documents-ai.md#T-05.22.01` remains open.

The customer guide now offers a separate **Show my account status** action. It reads the existing authorized dashboard endpoint for the selected profile and displays the available wallet balance and unpaid-invoice count with direct page links. This is a live dashboard card, not a model-generated answer: account values are never added to the knowledge question or sent to the inference worker. The guide still answers free-text questions only from published knowledge sources.

The dashboard response now identifies whether the active profile grants wallet and invoice access, so a delegated legal-only agent sees unavailable values rather than a misleading zero or a link to a forbidden page. The card rejects a response for a different active profile. During a rolling deployment with an older dashboard response, it can show an authorized wallet value but withholds the invoice count until the new access flag is available.

Validation: focused dashboard permission tests, API and web typechecks, shared/i18n/db build, bilingual Chromium guide flow, and a browser case for denied fields and a switched-profile response. Full AI tool authorization, write confirmation, model access to private data, and streaming remain separate tasks.

The standalone route-budget check remains red across multiple existing routes (including the dashboard at 349.62 KB gzip against a 300 KB limit); the new guide panel is a lazy 3.8 KB gzip chunk. Budget remediation remains a separate build task.
