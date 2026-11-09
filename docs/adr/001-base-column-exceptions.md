# Base-column exceptions

The owner’s v0.6.0 direction retains the current table identities and lifecycle model. This list is the approved exception scope for the standard columns in [ADR 001](001-data-types-and-conventions.md). An exception applies only to the listed missing columns. New tables use the standard shape unless a separate review records a concrete reason. A missing clock that affects retention, retry, audit or money still requires a fix.

The inventory was read from the compiled v0.5.0 release at `dae51e34` and compared with PostgreSQL on staging. All 181 Drizzle definitions agreed on these three columns; the two SQL-managed configuration tables have the full standard shape. The 96 listed exceptions include mutable workflow tables, so this is not an assertion that every listed row is append-only.

## Named identities and unique claims

Keep existing identifiers, unique claims, or identity roots. A second synthetic key would not identify a different business object.

| Table                            | Missing standard columns |
| -------------------------------- | ------------------------ |
| `account_login_identifiers`      | `id`                     |
| `bank_receipt_attachment_claims` | `id`                     |
| `conversation_identities`        | `id`, `created_at`       |
| `staff_roles`                    | `id`                     |
| `users`                          | `id`                     |

## Associations

The parent identifiers identify the association. Association history uses creation or parent audit records. Policy priority changes are audited by the same command.

| Table                     | Missing standard columns |
| ------------------------- | ------------------------ |
| `ai_agent_kb_groups`      | `id`, `updated_at`       |
| `ai_agent_kbs`            | `id`, `updated_at`       |
| `ai_agent_policies`       | `id`, `updated_at`       |
| `ai_agent_policy_groups`  | `id`, `updated_at`       |
| `ai_policy_group_members` | `id`, `updated_at`       |
| `kb_group_members`        | `id`, `updated_at`       |
| `user_roles`              | `id`, `updated_at`       |

## Current configuration and reference data

These are keyed settings, current pointers, counters, or a reference catalogue. Preserve the applicable version, change actor, or current update timestamp.

| Table                       | Missing standard columns   |
| --------------------------- | -------------------------- |
| `ai_agent_slots`            | `id`, `created_at`         |
| `app_config`                | `id`, `created_at`         |
| `company_types`             | `created_at`, `updated_at` |
| `config_version`            | `created_at`               |
| `contract_activation_rules` | `id`, `created_at`         |
| `staff_assignment_cursors`  | `id`, `created_at`         |
| `user_profile_contexts`     | `id`, `created_at`         |

## Claims, jobs and expiring state

Retain the current scope, attempt, expiry, lease, revision, or processing fields. Those fields drive retry and concurrency decisions.

| Table                                  | Missing standard columns         |
| -------------------------------------- | -------------------------------- |
| `ai_knowledge_questions`               | `id`, `updated_at`               |
| `ai_model_budgets`                     | `id`                             |
| `ai_model_circuit_states`              | `created_at`, `updated_at`       |
| `ai_test_chat_turns`                   | `id`, `updated_at`               |
| `async_jobs`                           | `updated_at`                     |
| `auth_delivery_outbox`                 | `updated_at`                     |
| `document_scan_jobs`                   | `id`                             |
| `electricity_customer_draft_revisions` | `id`                             |
| `electricity_order_submissions`        | `id`, `updated_at`               |
| `notification_send_receipts`           | `id`                             |
| `otp_challenges`                       | `id`                             |
| `preauth_sessions`                     | `id`, `updated_at`               |
| `profile_onboarding_drafts`            | `id`                             |
| `rate_limit_counters`                  | `id`                             |
| `rate_limit_windows`                   | `id`, `created_at`, `updated_at` |
| `refresh_tokens`                       | `updated_at`                     |
| `refund_retry_jobs`                    | `id`                             |
| `saving_inventory_reservations`        | `updated_at`                     |
| `security_rate_limit_counters`         | `id`                             |
| `sessions`                             | `id`                             |
| `wallet_low_balance_states`            | `id`                             |

## Audit, history and event records

Use the recorded event or occurrence time. Preserve any existing immutability triggers and retention rules. An absent generic timestamp does not itself enforce immutability.

| Table                                | Missing standard columns   |
| ------------------------------------ | -------------------------- |
| `ai_audit_log`                       | `updated_at`               |
| `analytics_events`                   | `updated_at`               |
| `audit_log`                          | `updated_at`               |
| `bank_receipt_status_events`         | `created_at`, `updated_at` |
| `consultation_request_events`        | `updated_at`               |
| `document_access_log`                | `updated_at`               |
| `document_events`                    | `updated_at`               |
| `operations_alert_receipts`          | `created_at`, `updated_at` |
| `password_history`                   | `updated_at`               |
| `provider_health_events`             | `updated_at`               |
| `saving_fulfillment_events`          | `updated_at`               |
| `solar_construction_progress_events` | `created_at`, `updated_at` |
| `upload_cleanup_log`                 | `created_at`, `updated_at` |

## Contract records and transitions

Keep version-, contract-, refund-, or document-bound identities and explicit acceptance, signature, publication, cancellation, and resolution records. Signed file and financial history rules continue to apply.

| Table                              | Missing standard columns         |
| ---------------------------------- | -------------------------------- |
| `contract_acceptances`             | `id`, `created_at`, `updated_at` |
| `contract_activation_requirements` | `id`, `created_at`, `updated_at` |
| `contract_activations`             | `id`, `created_at`, `updated_at` |
| `contract_amendments`              | `id`, `updated_at`               |
| `contract_cancellation_intents`    | `updated_at`                     |
| `contract_cancellation_requests`   | `updated_at`                     |
| `contract_cancellations`           | `id`, `created_at`, `updated_at` |
| `contract_completions`             | `id`, `created_at`, `updated_at` |
| `contract_document_locks`          | `id`, `created_at`, `updated_at` |
| `contract_documents`               | `updated_at`                     |
| `contract_publications`            | `id`, `created_at`, `updated_at` |
| `contract_refund_obligations`      | `id`, `updated_at`               |
| `contract_signature_requests`      | `created_at`, `updated_at`       |
| `contract_signatures`              | `id`, `created_at`, `updated_at` |
| `contract_versions`                | `updated_at`                     |

## Service snapshots, requests and progress

Keep the order or revision relationship and the applicable submission, review, fulfillment, or effective-period time. Do not backfill generic clocks with invented historical times.

| Table                                    | Missing standard columns   |
| ---------------------------------------- | -------------------------- |
| `electricity_draft_terminations`         | `id`, `updated_at`         |
| `electricity_order_comments`             | `updated_at`               |
| `electricity_order_lines`                | `updated_at`               |
| `electricity_product_limit_versions`     | `updated_at`               |
| `electricity_quantity_increase_requests` | `updated_at`               |
| `saving_address_amendments`              | `updated_at`               |
| `saving_hardware_amendments`             | `updated_at`               |
| `saving_hardware_upgrade_requests`       | `updated_at`               |
| `saving_order_comments`                  | `updated_at`               |
| `saving_order_revisions`                 | `updated_at`               |
| `saving_order_submissions`               | `updated_at`               |
| `solar_construction_documents`           | `created_at`, `updated_at` |
| `solar_construction_postal`              | `created_at`, `updated_at` |
| `solar_document_requests`                | `updated_at`               |

## Document and consent lifecycle

Retain policy versions, specialized hold and destruction clocks, searchable content snapshots, and the consent acceptance instant.

| Table                         | Missing standard columns   |
| ----------------------------- | -------------------------- |
| `document_destruction_items`  | `created_at`               |
| `document_legal_holds`        | `created_at`, `updated_at` |
| `document_retention_policies` | `updated_at`               |
| `kb_chunks`                   | `created_at`, `updated_at` |
| `tos_acceptances`             | `created_at`, `updated_at` |

## Delivery and provider event processing

Keep event identity and guarded outcome writes. Delivery attempts have companion receipt timestamps; wallet callbacks and chargebacks retain the linked transaction or audit history.

| Table                          | Missing standard columns |
| ------------------------------ | ------------------------ |
| `email_customer_corrections`   | `updated_at`             |
| `email_suppressions`           | `updated_at`             |
| `email_webhook_events`         | `updated_at`             |
| `in_app_notifications`         | `updated_at`             |
| `notification_delivery_log`    | `updated_at`             |
| `wallet_alert_signals`         | `updated_at`             |
| `wallet_chargeback_events`     | `updated_at`             |
| `wallet_topup_callback_events` | `updated_at`             |

## Wallet balance authority

The profile identifies the wallet. Keep its current update timestamp, balance version, and separate transaction ledger.

| Table     | Missing standard columns |
| --------- | ------------------------ |
| `wallets` | `id`, `created_at`       |

## Writes that need special care

- The email webhook ledger links its outbox row in the transaction that inserts the verified event; the event creation time is retained.
- The notification delivery log and the timestamped send receipt advance atomically for the same attempt token. Unknown outcomes stay held for reconciliation.
- Chargeback finalization and wallet top-up callbacks update the guarded event claim, including reopening an unpaid claim on a later verified delivery. The event identifier, immutable financial postings, and transaction linkage remain the audit boundary.
- AI policy group priority changes hold the link lock and write a separate audit record. Assignment to a stable agent slot retains its existing update clock and actor.
