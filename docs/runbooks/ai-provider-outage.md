# AI provider outage

**Incident P2 when the assistant is degraded, escalating to P1 for a major customer support impact. The AI owner and platform operations lead recovery.** The provider breaker may open, inference readiness may fail or a staging relay may be unreachable.

1. Check private inference `GET /health/ready` and the staff-authorized `GET /api/ai/health`. Distinguish local inference failures, provider circuit state, exhausted budget and a paused capability. Keep prompts, credentials and source contents out of operations logs.
2. If needed, use the audited `ai_chat` switch on `/admin/maintenance` to pause new questions. Confirm core readiness and the support route remain available. Keep private Telegram linkage independent of inference.
3. Correct the affected network or model/provider configuration. A replacement model must pass the existing test and activation checks. Keep budget and publication/audience checks in force.
4. Verify the approved model test and private inference readiness. Use an isolated environment with the corrected configuration to verify an authorized customer answer and source isolation before reopening. After reopening, repeat the authorized smoke check and record any actual Telegram receipt separately.

Escalate to the AI owner and primary if provider state or scope isolation cannot be verified. Record the affected slots, breaker recovery and customer impact in the follow-up. [Inference and maintenance](../operations/ai-inference.md). [Incident response](../operations/incident-response.md).
