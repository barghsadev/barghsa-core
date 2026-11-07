# Forms and final confirmation

Use the existing RHF/Zod form adapters and domain workflows. Their submission locks, field-error ownership, saved drafts, current-profile checks and receipt validation remain responsible for the command. A confirmation answer records user intent; it does not establish permission or prove that a write succeeded.

## Form behavior

`@barghsa/ui/form` provides bound text, phone, choice, checkbox, switch, radio, combobox, slider and date controls. `useZodForm` validates on touch, focuses registered errors and acquires a synchronous submission lock before asynchronous validation. Server field errors are whitelisted to the captured form. Unrecognized failures stay at the form level. Preserve valid draft values through validation, network failures and rejected writes. Passwords and OTPs keep their existing secret-clearing rules.

`ValidatedFormWizard` composes `FormStep` with the existing numbered `FormWizard`. Next validates the current step; final submission validates the whole form. The service owns server draft saving, resume, captured scope and immutable financial reviews. `FormReview`, also exported as `StepReviewPage` for existing callers, renders the read-only sections. Reuse the domain financial summaries and their verified backend snapshots.

`DynamicFieldArray` owns stable row keys, bounds, reorder and focus recovery. The domain form owns row validation and upload/permission state. `DependentSelect` owns eligible choices and disabled/loading presentation; its caller owns the bound request, cancellation, retry and stale-response checks.

## Confirmation patterns

| Action                                                                                     | Required UI approval                                                        |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Persistent deletion, removal, revocation, cancellation or disabling a live resource        | Exact translated phrase, destructive button and a safe initial focus target |
| Financial commitment, payment, acceptance, refund or financial staff decision              | Authoritative financial review and explicit acknowledgement                 |
| Destructive financial action                                                               | Both the phrase and acknowledgement                                         |
| Editing an unsaved array row, clearing a filter or leaving without deleting saved progress | Existing local edit/navigation behavior                                     |

`DestructiveConfirmDialog` and `FinancialConfirmDialog` provide the modal patterns. Existing wizard reviews and domain dialogs compose the same `ConfirmationFields` and `useConfirmationGate` with their established form, step-up and retry flows. Keep the full review in that flow instead of replacing it with a generic text question. `TeamAction.risk` classifies POST/PUT/PATCH commands at their domain-owned proposal; DELETE commands always require the phrase.

Approval belongs to the captured target, review and translated requirements. Changing or reopening the target withdraws it, including a change away from and back to the same target. Enforce the gate in the actual submit handler and again after asynchronous password/OTP verification. Disabling a button alone is insufficient. Pending writes keep their existing close, duplicate-submission and uncertain-outcome holds.

Financial summaries show whole IRR and exact toman equivalents through `useFinancialFormatting`. One rial is 0.1 toman, including amounts beyond JavaScript's safe integer range. This conversion is display only. Do not convert submitted values, recompute a backend total or alter a review hash. Gift-code entry previews a discount; redemption remains part of the reviewed order commitment.

## Inline questions and ownership

`useConfirm(scope)` returns a promise that resolves to true or false. Mount `ConfirmProvider` around the relevant screen. A second concurrent question returns false. Cancellation, caller unmount and scope changes cancel the pending question and withdraw its content. Destructive questions require a phrase; financial questions require acknowledgement.

The host is mounted in the staff context and Telegram linking panel. Customer order and wallet screens retain their existing review components. Keeping the host and financial formatting scoped to their callers preserves the original initial-route budgets. No budget or financial/security assertion is waived by these presentation changes.

After awaiting a question, recheck the captured owner, target and operation generation before sending the request. A confirmed dialog does not authorize retrying an uncertain write. Keep the command's original idempotency key and reconcile its actual receipt through the existing workflow.
