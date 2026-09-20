# Notification template data migration

After schema migrations, run from the repository root using the deployment's configured direct database connection:

```sh
pnpm --filter @barghsa/db db:migrate:notification-templates
```

This is an explicit data migration, separate from the schema migration journal. It uses the current reviewed catalog and does not create products, geography or administrator accounts. Run it during initial setup and when a release adds templates. Deploying code or running schema migrations alone does not import templates.

The importer creates absent event/channel/language families as active version 1. It preserves every existing family, including customized drafts and archived versions. `--force` does not overwrite or reactivate them. Review draft-only families in the admin template editor and publish deliberately if delivery is intended.

All inserts commit in one transaction. Family locks use the same identity as admin authoring. Concurrent importers skip committed rows. Any insert failure rolls back the whole import and exits unsuccessfully; resolve the reported error before rerunning. A successful rerun skips existing rows.

The current catalog covers all 35 Appendix events in both languages and their required channels, plus registered later events. It includes the refresh-token-reuse security template and SMS system-test template. Importing templates does not configure providers or prove external delivery. Refresh-token reuse currently creates its private in-app notice directly; adding a template does not add an email producer.

Verify the command's created/skipped counts, then inspect the relevant active template versions in the admin editor. Test only to an owned verified staff destination. Local migration tests use disposable PostgreSQL databases; no deployment execution is recorded here.

## Verification notices

Before enabling external verification notices, publish reviewed `profile.verification_status` email and SMS templates for both languages. Existing families are preserved by the importer: update them through the template editor. The current catalog uses `messageFa` or `messageEn`, containing the named profile result and, for rejection/reverification, the reason and corrective steps. `profileName` and the machine-readable `status` remain available for custom templates.

Configure and verify SMS.ir mappings for this event in each language, mapping the corresponding message field to the approved provider template parameter. Publish templates and activate verified mappings before rolling out the producer. Old status-only email templates omit required guidance; absent SMS mappings cannot deliver. The producer keeps the immediate inbox notice and queues only email/SMS, with current preferences checked during dispatch. No historical backfill or resend is part of this change.
