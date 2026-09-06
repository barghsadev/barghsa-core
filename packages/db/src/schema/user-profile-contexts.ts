import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';
import { profiles } from './profiles';

/** A user's selection is independent of the profile owner's default flag. */
export const userProfileContexts = pgTable('user_profile_contexts', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.userId, { onDelete: 'cascade' }),
  // Retain an empty selection when its profile is deleted; do not silently
  // redirect subsequent actions to a different profile.
  profileId: uuid('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
