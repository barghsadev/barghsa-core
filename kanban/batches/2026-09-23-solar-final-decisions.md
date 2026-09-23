# Solar final decision batch

Canonical scope: `03-core-business.md#T-03.13.01.01`, `.03`, and the decision notification and audit portion of `.04`. Contract creation (`.02`) and its notification remain in the next batch.

After staff confirms postal receipt, authorized staff can approve the solar request without automatic contract or invoice creation. Staff with elevated contract permission can instead close it without a contract, with a required reason. Closure leaves a support link and reason on the customer request page. Both decisions notify the customer and write audit records. The staff postal queue retains approved requests for the following contract-creation step. Customer request pages now show localized state names.

Validation: migrated HTTP coverage verifies premature and unauthorized decisions are rejected, approval has no contract side effect, duplicate approval is rejected, closure requires a reason, and customer-visible status plus audit records match the decision. Root build, typecheck, lint, formatting, OpenAPI contract, and backlog validation were run.
