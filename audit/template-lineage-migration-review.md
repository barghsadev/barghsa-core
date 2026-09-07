# Notification template lineage migration

Migration 0117 adds unique event/channel/locale/version identity, positive versions and a same-family foreign key to an older superseded version. Publishing records the version it replaces. Existing history gets a null supersession link; the migration does not invent a predecessor or renumber published rows.

Before rollout, run `notification-template-history-review.sql` against the intended database. Duplicate or nonpositive historical version numbers require explicit reconciliation. Migration failure preserves the old rows and leaves 0117 unapplied. No production inventory or reconciliation has been performed in this repair.

Drizzle's last schema snapshot was 0097 while the migration journal already reached 0116. Generation therefore also proposed unrelated SQL for previously added tables, columns and constraints. The final migration retains only notification-template changes. Its snapshot advances the notification-template definition while preserving other tables from the preceding snapshot; unrelated snapshot reconciliation remains separate work. Previous migration SQL and journal entries were not rewritten.

Validation covers a valid-history upgrade, duplicate archived/draft history rejection, concurrent duplicate insertion, foreign-key and ordering constraints, and repeat migration. The old-database fixture explicitly removes 0117 objects before exercising its pre-baseline upgrade path.
