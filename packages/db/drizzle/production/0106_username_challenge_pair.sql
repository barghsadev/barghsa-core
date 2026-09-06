ALTER TABLE otp_challenges ADD COLUMN previous_challenge_id text REFERENCES otp_challenges(challenge_id);
--> statement-breakpoint
ALTER TABLE otp_challenges ADD CONSTRAINT otp_username_pair CHECK (
  previous_challenge_id IS NULL OR (purpose='change_username' AND previous_challenge_id<>challenge_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_otp_previous_challenge ON otp_challenges(previous_challenge_id) WHERE previous_challenge_id IS NOT NULL;
