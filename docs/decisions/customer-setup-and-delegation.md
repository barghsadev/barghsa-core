# Customer setup and company delegation

The onboarding chooser can create an individual profile, a legal profile, or both.
A server-side journey binds the owner, request key and created profiles. A lost
response resumes the same journey. Completing one form advances to the remaining
form, and the final summary uses the actual profile names, types and verification
states. The first profile is selected initially. The customer can explicitly
choose another before Done persists the active context and opens the current
dashboard at `/app`.

Incomplete personal data stays in owner-scoped server drafts. Step navigation
waits for a successful save. Version conflicts and expired drafts require explicit
recovery; they do not create another profile. Failed profile-availability reads
show an error rather than treating the account as empty. Customer `/app` routes
with no profiles redirect to onboarding, while staff context remains separate.

The legal form collects the representative, company identity, address and optional
registration documents. A successful upload receipt is not a successful profile
submission. Submission still checks ownership, status, draft version, document
authority and verification policy. The summary must reflect the persisted
verification state, including manual review, rather than promising verification
because an upload or form save succeeded.

The company directory uses generated initials avatars and masked contact details.
Its last-active date is the recorded account sign-in, not online presence or
activity in that company. Unknown historical invitation/join dates stay unknown.
Pending invitations do not reveal whether the recipient already has an account.
Invitation messages are bounded plain text, rendered without interpreting HTML.

Member details show only allowed, profile-scoped activity summaries. Raw audit
metadata, internal comments and another company's records are excluded. Owner
rows retain their protection. Transferring ownership requires the bound recipient
and the existing verification/acceptance procedure; removing a member cannot
silently remove the final owner.

Account-bound invitations are available on the dashboard and onboarding chooser.
The intended recipient can accept a company invitation without creating a new
personal profile first. Invitations remain visible until a decision. The command
binds the displayed company and role; changed targets, expired/revoked authority
and unverified receipts cannot be reported as accepted. Opening the accepted
company is an explicit action and refreshes the current profile context.
