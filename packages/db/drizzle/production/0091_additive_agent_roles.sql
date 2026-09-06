DROP INDEX IF EXISTS idx_profile_agents_profile_user;
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_profile_agents_profile_user_role" ON "profile_agents" USING btree ("profile_id","user_id","role");