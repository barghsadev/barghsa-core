# Monthly AI model budgets

Task context: `05-notifications-documents-ai.md#T-05.23.02`.

Staff with AI-model management permission can configure a monthly token limit, a monthly USD cost limit, and input/output prices per million tokens for each model. The bilingual model list shows current usage against each configured limit. Saving a budget requires the same recent step-up and audited transaction as other model changes; removing both limits disables budgeting for that model.

Every agent chat completion, including customer knowledge answers and admin previews, checks the assigned model's remaining allowance before contacting the provider. Budgeted calls serialize on that model's PostgreSQL row across API replicas. A conservative prompt/output reservation prevents parallel calls from passing the same remaining balance; the successful completion is charged using provider-reported usage, or the reserved amount when usage is omitted. Failed completions do not consume the counter. Exhaustion returns a specific 429 response, and the customer panel explains that the monthly allowance has run out without suggesting an immediate retry.

Usage rolls over at the first budgeted request of a new UTC month; the admin read view treats a prior month as zero while idle. When actual usage first reaches 80% of either limit, an in-app notice is committed in the same transaction to staff with AI-model management permission, in each recipient's language. The notification marker resets with the month.

Connection-test probes run on the separate existing model-test worker and are exempt from agent-completion budgets. Budgeted model calls remain inside the core API until the dedicated AI worker task is built.

Validation: focused API model/chat/budget tests, real PostgreSQL rollover and concurrency cases, a customer HTTP exhaustion case, admin UI unit tests, and bilingual browser coverage across all five configured projects pass. Root build, typecheck, lint, formatting, contract, database snapshot, and backlog checks are required before push.
