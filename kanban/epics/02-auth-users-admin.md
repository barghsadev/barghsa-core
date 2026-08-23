# Epic 02 — Auth, Users, CRM & Admin

> Covers Authentication & Session Management, User & Profile Management, Onboarding, CRM, Agent Management, and all Admin/Configuration screens.

---

## E-01: Registration and Account Creation

### S-01.01 Register page — UI and validation

**T-01.01.01 — Register route and shared auth layout**

- Description: Create `/register` page with two-column auth layout: left column shows brand details (logo, title, slogan, value propositions); right column contains the registration form.
- Technical notes: Shared auth layout component used by all auth pages (login, forgot-password). Responsive stack on mobile (single column). Brand column links to `/` for unauthenticated users.
- UI/UX: Persian/English brand copy, full RTL/LTR support. Auth pages should not render the default app sidebar or navbar.
- Dependencies: None
- Complexity: M

**T-01.01.02 — Unified username field (email or mobile)**

- Description: Single text input with placeholder "Email or Mobile number". Must infer type from input: if it looks like an Iranian mobile number (starts with `09`, 11 digits), format to E.164 (`+98912...`) before sending to backend. If it's email, validate with standard email regex. Backend only accepts E.164 mobile or valid email.
- Technical notes: Frontend normalizes: `09121234567` → `+989121234567`. Iranian mobile detection regex: `/^09\d{9}$/`. On blur, display formatted preview. If user enters international format starting with `+`, accept as-is (must pass E.164 validation). Username max length 255 chars.
- UI/UX: Validate on blur, inline error messages. Show the formatted number as a hint (e.g. `+98 912 123 4567`). Password field NOT revealed until username is valid.
- Dependencies: T-01.01.01
- Complexity: M

**T-01.01.03 — Password field with visibility toggle and strength meter**

- Description: Password input with eye toggle (show/hide). Strength meter hidden by default; appears on focus and stays visible until blur or submit. Password minimum 8 chars, must include uppercase, lowercase, digit.
- Technical notes: Strength meter uses zxcvbn or similar client-side library with Persian/EN feedback. Strength levels: Weak, Fair, Good, Strong. Password is never sent to third-party strength APIs. Field uses `autocomplete="new-password"`.
- UI/UX: Toggle icon changes between eye/eye-off. Strength bar with color coding: red → yellow → green. On submit, validate server-side with Argon2id hashing.
- Dependencies: T-01.01.02
- Complexity: M

**T-01.01.04 — TOS acceptance checkbox**

- Description: Checkbox with text "By registering, I accept terms of use and policies" — "terms of use" is a link to `/terms` (TOS page). Checkbox must be checked for submit to work.
- Technical notes: Store the exact TOS version ID, content hash, and acceptance timestamp on user creation. Checkbox is required, cannot be pre-checked. TOS link opens in new tab (or in-page modal on mobile).
- UI/UX: Error if not checked on submit. Link styled as inline anchor with underline.
- Dependencies: E-04 (TOS admin management)
- Complexity: S

**T-01.01.05 — "Back to login" and "Forgot password?" links**

- Description: Links below the form navigating to `/login` and `/forgot-password`.
- Technical notes: Simple `<Link>` components. Track click for analytics (optional).
- UI/UX: Secondary text styling, not buttons.
- Dependencies: T-01.01.01
- Complexity: XS

**T-01.01.06 — Registration form submission and error handling**

- Description: Submit button sends POST to `/api/auth/register`. Payload: `{ username, password, tosVersionId }`. Backend validates username availability, password policy, and TOS version. Returns `{ challengeId }` to proceed to OTP step.
- Technical notes: Idempotency key from client (or dedup by username+request hash). Rate limit: 3 registration attempts per IP per minute, 10 per hour per destination. Error codes: `USERNAME_TAKEN`, `INVALID_USERNAME`, `WEAK_PASSWORD`, `TOS_NOT_ACCEPTED`, `RATE_LIMITED`, `INTERNAL_ERROR`. All errors return localized safe messages and correlation ID. Backend should not reveal whether a username exists in error messages (use generic "cannot process registration" for rate-limited cases).
- UI/UX: Loading spinner on submit, disable form during request. Server errors displayed as toast + form-level alert. Valid input preserved after error.
- Dependencies: T-01.01.02, T-01.01.03, T-01.01.04
- Complexity: M

### S-01.02 OTP verification for registration

**T-01.02.01 — OTP backend generation and sending**

- Description: On successful registration request, server generates 6-digit secure random OTP, hashes it with SHA-256 (or stores as Argon2id hash if replay risk analysis demands it), stores with expiry (default 5 min admin-configurable), challengeId, and attempt counter. Sends OTP via the user's destination (email or SMS).
- Technical notes: OTP is a CSPRNG-generated 6-digit numeric code. In DEV, OTP printed to API console (`[DEV] OTP for +989121234567: 483921`). Single-use: consumed after successful verify or after max attempts. Rate limit: 1 OTP per destination per 60s, 5 per hour, 10 per day. Stricter IP/device aggregate limits also apply. OTPs are never logged, never returned in API responses beyond the DEV console.
- UI/UX: N/A (backend)
- Dependencies: T-01.01.06
- Complexity: M

**T-01.02.02 — OTP input UI with resend**

- Description: After successful registration request, show OTP input: 6 individual digit boxes or single masked input. Show destination hint (masked email/phone: `m***@example.com` or `+98***4567`). Resend button with 60s countdown timer. Auto-submit on 6 digits entered.
- Technical notes: OTP input fields auto-advance. Resend sends same flow as initial send but with same challengeId (increments resend counter). After 5 failed attempts, invalidate the challengeId. On OTP expiry, redirect back to registration form with a message.
- UI/UX: Digit input boxes with underline style, keyboard navigation between boxes. Countdown timer `0:59` → `0:00`, then button re-enables. Loading state on verify. Success: redirect to `/app`. Error: shake animation on OTP boxes, clear input, show error.
- Dependencies: T-01.02.01
- Complexity: M

**T-01.02.03 — OTP verification and user creation**

- Description: POST `/api/auth/register/verify` with `{ challengeId, otp }`. Server verifies OTP hash, checks expiry, checks attempt count. On success: creates user record, creates session, sets a session cookie (HttpOnly, Secure in production, and the centralized SameSite policy from E-06), then rotates the CSRF token. On failure: increment attempts, return error.
- Technical notes: User creation and OTP consumption are atomic (same transaction). Default session: idle timeout 30 min, absolute timeout 24h. If user has no profile, redirect to `/onboarding` (handled at app-level redirect, T-03.01.01). Session identifier rotated after OTP verification. Audit: user_created event recorded.
- UI/UX: Redirect to `/app` (which checks for profiles).
- Dependencies: T-01.02.01, T-01.02.02
- Complexity: M

---

## E-02: Login and Session Management

### S-02.01 Login page

**T-02.01.01 — Login page UI**

- Description: `/login` page with same auth layout. Username field (same unified email/mobile as register), password field with visibility toggle. "Forgot password?" link, "Don't have an account? Register" link.
- Technical notes: Shared auth layout component. Username normalization same as register (E.164 formatting). `autocomplete="username"` and `autocomplete="current-password"`.
- UI/UX: Same two-column layout. Loading spinner on submit. Error states: "Invalid username or password" (generic, doesn't reveal which).
- Dependencies: T-01.01.01
- Complexity: S

**T-02.01.02 — Login authentication flow**

- Description: POST `/api/auth/login` with `{ username, password, deviceInfo }`. Server validates credentials using Argon2id. On success: server checks if OTP enforcement is needed (new device, suspicious IP, risk score). If OTP not needed → set session, redirect to `/app`. If OTP needed → return `{ requiresOtp: true, challengeId }`, show OTP UI.
- Technical notes: Password hashing with Argon2id (mem=37MiB, t=3, p=1 or benchmarked equivalent). Progressive delay after 5 failed attempts per account-and-IP in 15 min. Broad IP/device limits detect password spraying. No permanent lockout. Device trust: store device fingerprint (user agent, public IP hint, etc.) on successful login from trusted device. Trust is revocable, time-limited (default 30 days), and visible in device management.
- UI/UX: If OTP required, transition to OTP input inline (same page, no redirect). "Trust this device" checkbox shown on OTP step.
- Dependencies: T-01.01.02, T-01.01.03
- Complexity: L

**T-02.01.03 — Login OTP verification**

- Description: Same OTP input pattern as registration. POST `/api/auth/login/verify` with `{ challengeId, otp, trustDevice }`. On success: set session, optionally mark device as trusted. On failure: increment attempts, invalidate challenge after 5 failed attempts.
- Technical notes: Same OTP rate limits as registration. Device trust stored with expiry. Customer MFA is risk-based (triggered on new/suspicious device). Staff/admin MFA is mandatory on every new device. Sensitive actions later require step-up auth.
- UI/UX: OTP input with resend. "Trust this device" checkbox visible.
- Dependencies: T-02.01.02, T-01.02.02
- Complexity: M

**T-02.01.04 — Password change enforcement on login**

- Description: If server flags user as `mustChangePassword`, after credential verification but before setting session, redirect to password change form. User cannot proceed to `/app` without changing password. After successful change, display login page again.
- Technical notes: Flag `mustChangePasswordAtNextLogin` on user record. Staff or system sets this flag. Password history (last N passwords, default 5) prevents reuse. New password must satisfy same strength policy. Session is NOT established until password is changed.
- UI/UX: Inline form within auth layout. "Your password must be changed before continuing" explanation. Success message: "Password changed. Please log in." Redirect to login page. API: `/api/auth/force-change-password` with old password verification (already verified in login step, just need new password).
- Dependencies: T-02.01.02
- Complexity: M

### S-02.02 Session management and security

**T-02.02.01 — Session creation and cookie management**

- Description: On successful authentication, create server-side session. Store session data in PostgreSQL (or encrypted cookie with server-side revocation). Set HttpOnly and production-Secure cookies using the centralized SameSite policy owned by E-06. Rotate session identifier on login, MFA, password change, privilege change, and account recovery.
- Technical notes: Opaque or signed session identifiers. Production cookies: Secure, narrow Path, and the centralized SameSite policy from E-06. Non-TLS dev may disable Secure through explicit dev setting. Refresh tokens rotate on use; reuse revokes token family and alerts user. Absolute session timeout (24h default), idle timeout (30 min default).
- UI/UX: N/A (backend)
- Dependencies: T-02.01.02
- Complexity: L

**T-02.02.02 — Session revocation**

- Description: Users can view and revoke their own active sessions/devices from Settings → Security. Staff can revoke any user's sessions. Password reset, staff disablement, ownership transfer, and suspected compromise revoke applicable sessions immediately.
- Technical notes: Session list shows device name, IP location (approximate), last active time, created time. Revoke is immediate (server removes session from active store). API: GET `/api/auth/sessions`, DELETE `/api/auth/sessions/:id`. Revoke all by POST `/api/auth/sessions/revoke-all` (requires password confirmation or OTP).
- UI/UX: Card/list view of active sessions with Revoke button per session and "Revoke all other sessions" action. Confirm dialog before revoke.
- Dependencies: T-02.02.01
- Complexity: M

**T-02.02.03 — CSRF protection**

- Description: Every state-changing POST/PUT/PATCH/DELETE requires a server-generated CSRF token bound to the authenticated session, sent in a custom header (e.g. `X-CSRF-Token`). Validate server-side. Rotate token after auth/session rotation.
- Technical notes: Double-submit cookie pattern or signed token. Frontend reads CSRF token from meta tag or cookie and sends in header. CSRF failures return 403 with safe error + correlation ID, logged as security event. No exception for API endpoints — every state change requires this.
- UI/UX: N/A (transparent to user; errors caught by frontend interceptor → redirect to login or show error).
- Dependencies: T-02.02.01
- Complexity: M

**T-02.02.04 — Step-up authentication for sensitive actions**

- Description: Sensitive actions require recent step-up authentication (re-enter password or OTP). Actions include: role changes, storage/payment credentials change, payment confirmation, refunds, contract cancellation, price changes, session revocation, profile deletion, ownership transfer.
- Technical notes: Step-up requirement lasts for a short configured period (default 15 min) after verification. Audit flag: `stepUpVerified: true` with timestamp. If session idle exceeds the step-up window, re-prompt. API returns `requiresStepUp` flag; frontend shows step-up dialog.
- UI/UX: Modal dialog asking for password or OTP before proceeding. Shows which action requires it.
- Dependencies: T-02.02.01, T-02.01.02
- Complexity: L

### S-02.03 Forgot password

**T-02.03.01 — Forgot password request UI**

- Description: `/forgot-password` page with auth layout. Username field (email/mobile). "Back to login" link. Submit sends OTP to user's registered destination.
- Technical notes: POST `/api/auth/forgot-password` with `{ username }`. Rate limit: 5 starts per account or destination per hour, with separate IP limits. Response is always generic ("If an account exists, an OTP has been sent") — must NOT reveal whether username is registered. OTP same rules as registration OTP.
- UI/UX: After submit, show same OTP input as register/login. Destination hint masked. Generic success message regardless of whether account exists.
- Dependencies: T-02.01.01, T-01.02.02
- Complexity: M

**T-02.03.02 — OTP verification and password reset**

- Description: POST `/api/auth/reset-password` with `{ challengeId, otp, newPassword }`. Backend verifies OTP, validates new password strength (same policy), hashes new password, updates user record.
- Technical notes: On success: invalidate ALL existing sessions and refresh tokens for that user. Audit: password_reset event with user ID, timestamp, correlation ID. OTP consumed. Password history check enforced. Rate limit: 5 reset attempts per hour per destination.
- UI/UX: After OTP verified, show new password form with strength meter and confirm password field. Success: redirect to login page with success toast. "Your password has been reset. Please log in with your new password."
- Dependencies: T-02.03.01, T-01.02.03
- Complexity: M

**T-02.03.03 — Account recovery support path**

- Description: On forgot-password page, include "Having trouble? Contact support" link for users who no longer control their registered email/phone. Support recovery requires identity verification, full audit history.
- Technical notes: Link opens ticket creation or directs to support contact. Support path documented in runbook. Staff have verified identity procedure.
- UI/UX: Styled as secondary link below the form.
- Dependencies: T-02.03.01
- Complexity: S

### S-02.04 Rate limiting and abuse prevention — Auth

**T-02.04.01 — Auth rate limit enforcement**

- Description: Enforce auth-specific rate limits at edge (reverse proxy) and application layers. Return 429 with Retry-After header and localized recovery message.
- Technical notes: Limits:
  - OTP send: 1 per destination per 60s, 5 per hour, 10 per day
  - OTP verify: 5 failed attempts per issued challenge, then invalidate
  - Login: progressive delay after 5 failed attempts per account-and-IP in 15 min
  - Password reset: 5 starts per account or destination per hour
  - Registration: 3 per IP per minute, 10 per hour per destination
  - Critical account counters durable in PostgreSQL; Redis may accelerate but Redis loss must not remove protection.
- UI/UX: Clear message: "Too many attempts. Please try again in [time]." Countdown timer optional. Link to contact support.
- Dependencies: T-02.01.02, T-01.01.06, T-02.03.01
- Complexity: L

---

## E-03: Onboarding and Profile Management

### S-03.01 Post-auth profile check and redirect

**T-03.01.01 — App-level profile check middleware**

- Description: After login, app checks if user has any profiles. If none, redirect to `/onboarding`. If exactly one profile, set it as default and proceed to dashboard. If multiple, show profile selector to choose default, then proceed.
- Technical notes: Implemented as route guard/loader in TanStack Start. Query GET `/api/profiles` returns `{ profiles: [...], hasDefault: boolean, activeProfileId }`. Profile switch is persistent in DB (not just session). API must never return profiles belonging to another user.
- UI/UX: Brief loading state while fetching profiles. If no profiles, redirect to `/onboarding`. If multiple profiles, show a selection modal/dropdown briefly.
- Dependencies: T-01.02.03, T-04.01.01
- Complexity: M

**T-03.01.02 — Profile verification check after login**

- Description: If active profile is NOT verified and system settings enforce verification, notify user. Show auto-verify button if verification method is `api`. Allow access to: profile correction/verification, invitations, notifications, tickets/support, security settings, existing records, financial/refund info. Block new commercial orders.
- Technical notes: Block is on backend: order submission endpoints check `profile.verified || !adminRequiresVerification`. Blocking screen explains reason, required action, status, and support path. Does NOT prevent profile switching or access to non-commercial pages.
- UI/UX: Banner at top of app: "Your profile is not yet verified. [Verify now] [Learn more]" with blocking overlay on commercial order flows. Non-intrusive on allowed pages.
- Dependencies: T-03.01.01, E-07 (verification settings)
- Complexity: M

### S-03.02 Onboarding — Profile creation

**T-03.02.01 — Profile type selection (Individual vs Legal)**

- Description: Page displaying two cards/options: Individual and Legal. User selects one to proceed. Clear explanation of each type.
- Technical notes: POST `/api/onboarding/start` with `{ profileType: 'INDIVIDUAL' | 'LEGAL' }`. Returns profileId (draft state). Profile starts in DRAFT state.
- UI/UX: Two large cards with icons, title, short description in Persian/EN. Selected card highlighted.
- Dependencies: T-03.01.01
- Complexity: S

**T-03.02.02 — Individual profile form**

- Description: Multi-field form for individual profile:
  - Title: free text (Dr., Mr., etc.), optional
  - First name: required, text, max 100 chars
  - Last name: required, separate field, text, max 100 chars
  - Province: required, selectable list of Iranian provinces fetched from API
  - City: required, selectable list filtered by selected province, fetched from API
  - Full address: required, textarea, max 500 chars
  - Postal code: required, Iranian postal code validation (10 digits)
  - National ID number: required, Iranian national ID validation (10 digits)
- Technical notes: Province/city data from `GET /api/admin/geography/provinces` and `GET /api/admin/geography/provinces/:id/cities`. Address saved in addresses table, linked to profile. Server-side validation of national ID (checksum algorithm) and postal code. Server-side dedup of national ID among active profiles.
- UI/UX: Two-column form on desktop, single column on mobile. City dropdown updates when province selected. Validation on blur per field. Step indicator if multi-step (but all on one page initially). "Back" goes to type selection.
- Dependencies: T-03.02.01, T-09.04.01 (province/city management)
- Complexity: L

**T-03.02.03 — Legal profile form**

- Description: All individual fields (for authorized representative) PLUS legal entity fields:
  - Legal name: required
  - National identifier (شناسه ملی): required, unique among active legal profiles, 11-digit validation
  - Registration number: required
  - Company/entity type: required (select from admin-managed types)
  - Registration date: optional
  - Economic code: optional initially, required by service when needed for invoicing
  - Official phone: optional
  - Official email: optional
  - Official province, city, full address, postal code: required
  - Authorized representative's title and relationship: required
  - Optional document uploads: official gazette or registration docs
- Technical notes: Same province/city pattern. National identifier uniqueness enforced at DB level (unique index, case-insensitive). Address saved in addresses table. Owner is set to the creating user. Legal profile starts in DRAFT until basic fields complete (verification is separate).
- UI/UX: Tabbed or sectioned form: "Individual Representative" section + "Legal Entity" section. Upload area for documents (drag & drop). All form data saved as draft after each section completion (auto-save).
- Dependencies: T-03.02.01, T-09.04.01, E-07 (verification settings)
- Complexity: XL

**T-03.02.04 — Onboarding completion and redirect**

- Description: After profile creation, redirect to `/app`. If multiple profiles could be added, show option to "Add another profile" or "Continue to app".
- Technical notes: Final POST `/api/onboarding/complete/:profileId` finalizes the profile (transitions from DRAFT to PENDING_VERIFICATION or ACTIVE depending on verification settings). Sets profile as default if first profile.
- UI/UX: Success animation/confetti on completion. Two action buttons: "Add another profile" and "Go to dashboard".
- Dependencies: T-03.02.02, T-03.02.03
- Complexity: M

### S-03.03 Profile switching and management

**T-03.03.01 — Profile switcher in sidebar**

- Description: Top section of dashboard sidebar displays current profile name, type badge, and a dropdown/selector to switch profiles. Shows all profiles user has access to (as owner or agent).
- Technical notes: GET `/api/profiles` returns user's profiles with current active flag. Switch: POST `/api/profiles/switch/:profileId`. Backend updates activeProfileId on user record. On switch, client re-fetches all profile-scoped data. API enforces: user must have access to the target profile (as owner or active agent).
- UI/UX: Compact dropdown showing profile name, type icon (person/building), current badge. Active profile marked. Quick switch without page reload (dashboard data refreshes). On mobile: collapsible accordion.
- Dependencies: T-03.01.01
- Complexity: M

**T-03.03.02 — Default profile selection**

- Description: On login, if user has multiple profiles but no default set, show profile selection. User can change default from profile settings.
- Technical notes: `defaultProfileId` on user record. API: POST `/api/profiles/default/:profileId`. If user has exactly one profile, it is automatically the default.
- UI/UX: Radio list of profiles with "Set as default" option. On first login with multiple profiles, modal forces selection before proceeding.
- Dependencies: T-03.03.01
- Complexity: M

**T-03.03.03 — Profile settings page**

- Description: `/app/settings/profile` page showing current profile details. Some fields editable (address, contact info) while identity fields (first name, last name, national ID for individuals; legal name, national identifier for legal) are read-only after verification. Staff can always update their own individual profile.
- Technical notes: If profile is verified, protected fields are not editable through normal UI. Changes to protected fields require a verification case (CRM staff action). PUT `/api/profiles/:id` with field-level validation. Address changes create new address record (historical addresses retained).
- UI/UX: Editable fields show pencil icon. Read-only fields show lock icon with explanation tooltip. Save button with confirmation. Verification badge shows status.
- Dependencies: T-03.03.01, E-06 (CRM profile details)
- Complexity: L

**T-03.03.04 — Username/contact changes**

- Description: User can change their username (email or mobile) with availability check and OTP verification. If registered with email, can add and verify a mobile number. If registered with mobile, can add one email address. Username change requires verifying both old and new destination (when applicable).
- Technical notes: POST `/api/auth/change-username` with `{ newUsername, otpChallengeId, otp }`. OTP sent to new destination. Username uniqueness check. Rate limited. If user has both email and mobile, they can log in with either. Username change invalidates sessions except current one? (Design decision: invalidate all or keep current).
- UI/UX: Settings page section: current username (masked), "Change" button. Flow: enter new username → OTP verify → confirmation. Add email/mobile: separate section. Success toast.
- Dependencies: T-03.03.03, T-02.03.02
- Complexity: M

**T-03.03.05 — Notification channel preferences**

- Description: User selects notification channels: SMS (if mobile present), Email (if present), both, or in-app only. In-app is always enabled.
- Technical notes: Store as array/enum `['SMS', 'EMAIL', 'IN_APP']`. Default: all available. PUT `/api/user/settings/notifications`. Preferences applied per user, not per profile.
- UI/UX: Toggle switches per channel. Note explaining recommended settings for security notifications.
- Dependencies: T-03.03.03
- Complexity: S

**T-03.03.06 — Timezone settings**

- Description: User can change their timezone. Default: Iran Standard Time (UTC+3:30).
- Technical notes: Store as IANA timezone string. Used for all date/time displays (not for calendar selection — calendar is language-based Jalali/Gregorian). PUT `/api/user/settings/timezone`.
- UI/UX: Searchable select/timezone picker. Show current time in selected timezone for preview.
- Dependencies: T-03.03.03
- Complexity: S

### S-03.04 Address management

**T-03.04.01 — Address CRUD for current profile**

- Description: Customers can manage addresses under their active profile. Main address (from onboarding) shown. Can add, edit, delete, or set as main. Only one address can be main. Addresses filtered by current active profile only.
- Technical notes: GET/POST/PUT/DELETE `/api/profiles/:profileId/addresses`. Main address flag is unique per profile. Deleting the main address requires selecting a new main address first. Addresses linked to orders cannot be deleted (soft delete + warn).
- UI/UX: Address list with main badge. Add/edit modal form with province/city selects. Set as main action via star/radio. Confirmation on delete.
- Dependencies: T-03.02.02 (address schema), T-03.03.01
- Complexity: M

**T-03.04.02 — Address in order flow**

- Description: Address selection/creation available during order flows (electricity, saving plans, solar). User can select from saved addresses or add new one (which becomes saved).
- Technical notes: Order stores snapshot of address (values copied, not foreign key). This ensures historical accuracy if address changes later.
- UI/UX: Address selector with "Use existing" list and "Add new address" option.
- Dependencies: T-03.04.01
- Complexity: M

---

## E-04: Terms of Service (TOS)

### S-04.01 Read-only TOS page

**T-04.01.01 — Public TOS page**

- Description: `/terms` page displaying current Terms of Service content. Shows last update date. Simple layout, readable typography.
- Technical notes: GET `/api/tos/current` returns `{ content, versionId, updatedAt, publishedAt }`. Versioned. Supports Persian and English content.
- UI/UX: Clean document layout. Date displayed prominently. Supports both RTL (Persian default) and LTR (English).
- Dependencies: E-09 (admin TOS editing)
- Complexity: S

**T-04.01.02 — TOS acceptance storage**

- Description: On registration and re-acceptance, store: exact version accepted, timestamp, user ID, IP address, device metadata. Acceptance is legally significant.
- Technical notes: `tos_acceptances` table with user_id, version_id, accepted_at, ip_address, user_agent. Queries are immutable. Registration requires acceptance of the CURRENT active version.
- UI/UX: N/A (backend + registration checkbox)
- Dependencies: T-01.01.04, T-04.01.01
- Complexity: S

**T-04.01.03 — TOS re-acceptance flow**

- Description: When a materially changed TOS version is published, users must re-accept at next safe entry point. Does not block: login, account recovery, support, or legal record access. Show banner: "Terms of Service have been updated. [Review]"
- Technical notes: Backend endpoint or middleware checks `user.lastAcceptedTosVersion < activeTosVersion` for non-exempt routes. Re-acceptance: POST `/api/tos/accept/:versionId`. API returns flag `requiresTosAcceptance` in user profile.
- UI/UX: Banner across all pages until accepted (on allowed pages). Modal on first non-exempt action. Full TOS displayed with "I accept" button. Non-intrusive, doesn't block critical paths.
- Dependencies: T-04.01.01, T-04.01.02
- Complexity: M

---

## E-05: CRM — User and Profile Management (Staff/Admin)

### S-05.01 CRM user list

**T-05.01.01 — CRM users list page**

- Description: `/app/crm` — list of all registered users. Columns: Username, profiles (legal/individual indicators), registration date, last login, verification status, profile count. Staff and admin only.
- Technical notes: Backend: GET `/api/crm/users` with pagination, search, sort, filter. Server-side filtering/sorting. Cursor pagination recommended for large datasets. Permission: staff roles `crm:read` or `admin`. Profile type columns: "Legal" icon and "Individual" icon shown per user if they have that profile type. Search by username (email/mobile).
- UI/UX: Table with sortable columns. Filter bar: profile type (all/individual/legal), verification status (verified/unverified/pending), registration date range. Search input. Pagination controls. "Collapse all" on row expansion.
- Dependencies: T-03.01.01, authorization framework
- Complexity: L

**T-05.01.02 — CRM filters and search**

- Description: Filters: profile type (individual/legal), verification status (all/verified/unverified/pending/disabled), date range (registration date), staff-only filter. Search across username, legal name, individual name.
- Technical notes: Backend uses PostgreSQL full-text/trigram search for name fields. Filter query params: `?type=LEGAL&verification=VERIFIED&search=...&sort=createdAt&order=desc&cursor=...`.
- UI/UX: Horizontal filter bar with dropdowns. Date range picker (Jalali in Persian mode). Search with debounce. Active filters shown as removable tags. Clear all filters button.
- Dependencies: T-05.01.01
- Complexity: M

### S-05.02 Profile details page (CRM)

**T-05.02.01 — Full profile view for CRM staff**

- Description: `/app/crm/profiles/:profileId` — detailed view of a single profile. Shows all profile data, verification status, last login, last password change, session list, profiles list (for the user), agent relationships.
- Technical notes: GET `/api/crm/profiles/:profileId` returns all profile fields, user info, verification state, session metadata (count, last active), agent invites, associated addresses. Permission: roles with `crm:read`.
- UI/UX: Tabbed layout: Overview, Profile Details, Addresses, Sessions, Agent Invites, Verification History. Overview tab shows summary cards. Addresses section with main address marked.
- Dependencies: T-05.01.01
- Complexity: L

**T-05.02.02 — Staff profile editing**

- Description: Authorized staff can update profile info (non-identity fields directly; identity fields through verification case). Update fields: address, phone, email, etc.
- Technical notes: PUT `/api/crm/profiles/:profileId` — permissions: `crm:edit`. Field-level validation. Changes to verified identity fields blocked — requires verification case (T-05.02.05). Audit: profile_updated with before/after diff.
- UI/UX: Edit button enables inline editing. Save/Cancel actions. Confirmation modal for significant changes. Field-level lock icons on identity fields with tooltip: "Requires verification case".
- Dependencies: T-05.02.01
- Complexity: L

**T-05.02.03 — Verification state management**

- Description: Staff can change verification state of a profile. Options: Verify, Unverify, Mark for re-verification.
- Technical notes: POST `/api/crm/profiles/:profileId/verify` with `{ action: 'verify' | 'unverify' | 'reverify', reason? }`. Permissions: `crm:verify` or admin. Audit: verification_change with before/after state, actor, reason. Notifications sent to profile owner.
- UI/UX: Current status badge (Verified/Unverified/Pending). Dropdown with actions. Reason required for unverify/reverify. Confirmation dialog.
- Dependencies: T-05.02.01, E-07 (admin verification settings)
- Complexity: M

**T-05.02.04 — Force password change and session expiry**

- Description: Staff can mark a user as "must change password at next login" and expire all current sessions.
- Technical notes: POST `/api/crm/users/:userId/force-password-change` — sets `mustChangePasswordAtNextLogin` flag, triggers session invalidation for all sessions. POST `/api/crm/users/:userId/expire-sessions` — removes all sessions. Audit: both actions recorded with actor, reason. User gets notification.
- UI/UX: Two separate action buttons with confirmation dialogs. "Force password change on next login" and "Expire all active sessions". Reason field required.
- Dependencies: T-05.02.01, T-02.02.02
- Complexity: M

**T-05.02.05 — Identity correction through verification case**

- Description: Staff cannot directly edit verified identity fields. Instead, they create a verification case (profile correction request) which creates an audit trail. Changes are applied after case resolution.
- Technical notes: Verification case is a mini-workflow: Corrector creates case with new values and evidence → Reviewer approves/rejects → On approval, identity field updated with before/after audit. Permissions: `crm:edit-identity`. Cases have states: Open, Under Review, Approved, Rejected.
- UI/UX: "Request correction" button on locked fields → form with new value + upload evidence → submission creates case. Staff with review permission see case queue.
- Dependencies: T-05.02.02
- Complexity: L

**T-05.02.06 — Profile deletion by staff**

- Description: Staff with appropriate permission can delete a customer profile. Cannot delete profiles with active orders, contracts, unpaid invoices, or non-zero wallet balance. Prefer deactivation over hard delete.
- Technical notes: DELETE `/api/crm/profiles/:profileId` checks business record constraints. Soft delete (archived flag) for audit purposes. GDPR-style retention applies. If profile has constraints, return error with details. Cannot delete a legal profile's last owner. Audit: profile_deleted with reason, actor.
- UI/UX: Confirmation dialog with checklist of what will happen. Reason required. Error if business constraints block deletion.
- Dependencies: T-05.02.01
- Complexity: M

### S-05.03 Staff user creation

**T-05.03.01 — Create staff user**

- Description: Authorized staff/admin can create a new staff user. No profile creation needed — staff get an individual profile assigned, created as verified. Address not required. Use time-limited activation link or one-time temporary password.
- Technical notes: POST `/api/admin/users/create-staff` with `{ username, firstName, lastName, roleIds[], activationMethod: 'link' | 'tempPassword' }`. If tempPassword: generated, must change at first login, never shown again. Activation link: emailed, time-limited (24h). Permissions: `admin:users:create`. No address fields. Profile auto-created as verified, individual type. Password follows same strength policy. Audit: staff_user_created.
- UI/UX: Form with username, name fields, role multi-select, activation method radio. On submit: if tempPassword, show it once ("Save this password – it will never be shown again"). If activation link: "Activation link sent to [email]."
- Dependencies: T-02.02.04 (step-up), authorization framework
- Complexity: L

**T-05.03.02 — Staff role assignment**

- Description: Staff users can hold multiple roles. Roles determine permissions across CRM, finance, legal, operations, etc.
- Technical notes: Roles: Customer Support, CRM and Verification, Finance, Legal and Contracts, Operations, Admin. Permissions are deny-by-default, additive by role. PUT `/api/admin/users/:userId/roles` replaces role set (idempotent). Audit: role_change with before/after, actor, reason.
- UI/UX: Multi-select dropdown with role descriptions. Current roles shown as badges. Change requires step-up auth.
- Dependencies: T-05.03.01, T-09.05.01 (role management)
- Complexity: M

### S-05.04 Agent management

**T-05.04.01 — Agent list for legal entity**

- Description: User with active legal profile (owner or manager role) can view list of agents — invited or already joined. Shows: name, role, invitation status, joined date. Can withdraw pending invite.
- Technical notes: GET `/api/profiles/:profileId/agents` returns agents with user info (if registered) and invite status. Permission: owner or manager of the legal profile. API does NOT reveal whether invited user is already registered (privacy). Withdraw: DELETE `/api/profiles/:profileId/invitations/:inviteId`.
- UI/UX: Table with columns: Agent name/username, Role badge, Status (Pending/Active), Joined date, Actions (Remove/Withdraw). Invite button. Empty state: "No agents yet. Invite your team."
- Dependencies: T-03.03.01
- Complexity: M

**T-05.04.02 — Agent invitation flow**

- Description: Owner/manager invites by email or mobile number. Must select role: Manager, Finance, Legal. If user is registered, send notification. If not registered, they see the invite when they register with that username.
- Technical notes: POST `/api/profiles/:profileId/invitations` with `{ username, role }`. Constraints: legal profile must have exactly one owner at all times. Owner cannot be removed without ownership transfer. Rate limited: 10 invitations per hour per profile. Audit: invitation_created. When invited user registers, check pending invitations and link automatically. Invitation states: Pending, Accepted, Withdrawn, Declined, Expired (default 7 days).
- UI/UX: Modal: username field (email/mobile), role dropdown. Preview: "Invite [username] as [role] to [legal entity name]." Confirmation. Success: "Invitation sent. User will be notified when available."
- Dependencies: T-05.04.01
- Complexity: L

**T-05.04.03 — Accept/decline invitation**

- Description: Invited user sees pending invitation on their dashboard (as a banner/message). Can view legal entity details and the inviter's info. Can Accept or Decline.
- Technical notes: GET `/api/invitations/pending` returns pending invites for current user. POST `/api/invitations/:inviteId/accept` — adds user as agent with specified role. POST `/api/invitations/:inviteId/decline` — marks declined. Audit: invitation_accepted/declined.
- UI/UX: Dashboard banner: "[Legal Entity Name] has invited you as [Role]. [View Details] [Accept] [Decline]". Details: entity info, inviter name, role description, date invited.
- Dependencies: T-05.04.02, T-03.03.01
- Complexity: M

**T-05.04.04 — Agent role permissions enforcement**

- Description: At every API call, enforce the agent's role-based permissions on the legal profile's data.
- Technical notes: Permission matrix:
  - Owner: full customer-side control, including agents, orders, contracts, invoices, wallet, addresses, cancellation requests. Ownership transfer requires step-up + acceptance.
  - Manager: operational access (addresses, orders, consultation, documents, comments, inviting/removing non-owner agents). Cannot transfer ownership or change protected identity fields.
  - Finance: view invoices, wallet, payments, receipts, refunds; charge wallet, submit bank receipts. Cannot accept/sign contracts.
  - Legal: view, accept, sign, reject, request changes to contracts and legal documents. Cannot move wallet funds.
  - Permissions additive when agent has multiple roles.
  - Removing agent immediately revokes new access but preserves historical authorship.
  - Last owner cannot remove themselves without completing ownership transfer.
- UI/UX: N/A (backend enforcement + UI conditional rendering based on permissions)
- Dependencies: T-05.04.02, authorization framework
- Complexity: XL

**T-05.04.05 — Ownership transfer**

- Description: Legal profile owner can transfer ownership to another agent. Requires step-up auth, acceptance by new owner, and audit trail.
- Technical notes: POST `/api/profiles/:profileId/transfer-ownership` with `{ newOwnerUserId }`. Creates pending transfer. New owner accepts via POST `/api/profiles/:profileId/ownership-accept`. If declined or expired, transfer cancelled. During transfer, current owner retains control. Cannot transfer if new owner is not an existing agent of that profile. Audit: ownership_transfer_initiated, ownership_transfer_completed/declined.
- UI/UX: Step-up auth prompt → Select new owner from agents list → Confirmation → "Transfer request sent to [name]. They must accept." Pending banner for new owner.
- Dependencies: T-05.04.04
- Complexity: L

### S-05.05 Dashboard CRM widgets

**T-05.05.01 — Profiles awaiting verification widget**

- Description: On staff dashboard, widget showing profiles pending verification (if verification is not disabled). Shows count and "Show all" link to CRM with verification filter.
- Technical notes: GET `/api/crm/dashboard/pending-verification` returns count and last 5 entries. Permission: staff with `crm:verify`.
- UI/UX: Card: icon + count + "Profiles awaiting verification" + "Show all" link. Click opens CRM with `?verification=PENDING` filter.
- Dependencies: T-05.01.02, E-07 (verification settings)
- Complexity: S

**T-05.05.02 — Agent invitation dashboard widget**

- Description: On customer dashboard, if the active profile has been invited by a legal entity, show banner with details and accept/decline actions.
- Technical notes: Wrapper around T-05.04.03 but surfaced on dashboard.
- UI/UX: Prominent card at top of dashboard, not dismissible until action taken.
- Dependencies: T-05.04.03
- Complexity: S

---

## E-06: Ticketing System

### S-06.01 Ticketing — Customer side

**T-06.01.01 — Ticket creation**

- Description: User can create a support ticket. Subject, body (rich text optional), related profile, related entity type/ID (order, contract, invoice), priority, optional file attachments. All users can access.
- Technical notes: POST `/api/tickets` with `{ subject, body, profileId, relatedEntityType, relatedEntityId, priority, attachments[] }`. Permissions: authenticated user, scoped to own profiles. Files uploaded then linked (document storage integration).
- UI/UX: "Contact Support" / "Create Ticket" button. Form with: subject, category/type selector, priority (normal/high), body textarea, attachment upload, related entity selector (optional). Persian/EN labels.
- Dependencies: documents module
- Complexity: M

**T-06.01.02 — Ticket list and detail view**

- Description: User can view their tickets (scoped to their profiles). List with search, filter (open/closed), sort. Detail view shows full conversation, status, assigned staff.
- Technical notes: GET `/api/tickets` with pagination, status filter. GET `/api/tickets/:id` for detail. Comments: GET/POST `/api/tickets/:id/comments`. Each comment has author, timestamp, visibility (public/internal). Customer sees only public comments. Staff can add internal notes.
- UI/UX: Ticket list: table with subject, status badge, priority indicator, last update date, related entity link. Detail: conversation view (chat-like), status dropdown (staff), internal notes section (staff only). Statuses: Open, In Progress, Waiting on Customer, Waiting on Staff, Resolved, Closed.
- Dependencies: T-06.01.01
- Complexity: L

**T-06.01.03 — Staff ticket management**

- Description: Staff can view all tickets, assign to themselves or team, change status, add internal notes, add customer-visible comments. Configurable assignment rules and teams (admin config).
- Technical notes: Permissions: `tickets:*` (all) or `tickets:assigned` (own). Put `/api/tickets/:id/assign` to self. Team assignment via admin config. Status transitions:
  - Open → In Progress (assignment)
  - In Progress → Waiting on Customer (requires customer action)
  - Waiting on Customer → In Progress (customer replied)
  - In Progress → Waiting on Staff (staff awaiting info)
  - In Progress → Resolved (staff solution)
  - Resolved → Closed (timeout or staff action)
  - Any → Open (reopen)
- UI/UX: Staff ticket list: more columns (assigned to, customer, SLA target). Assignment dropdown. Internal notes toggle. Ticket detail with customer info panel + profile quick-links. Internal note styling distinct from public comments.
- Dependencies: T-06.01.02, T-09.08.02 (teams and assignment)
- Complexity: L

---

## E-07: Profile Verification Settings

### S-07.01 Admin — Verification configuration

**T-07.01.01 — Verification mode setting**

- Description: Admin can set profile verification mode: disabled (no verification needed), manual (staff verifies), api (automatic via official APIs).
- Technical notes: Stored as `profileVerification` enum in admin config table: `DISABLED`, `MANUAL`, `API`. Changing mode is versioned (Draft → Active). Audit: config_change.
- UI/UX: Settings page with radio/selector. Description for each mode. Warning: "Changing verification mode will affect all profiles."
- Dependencies: admin config framework
- Complexity: S

**T-07.01.02 — API-based auto-verification integration**

- Description: When mode is `API`, on profile creation, system calls external API (e.g., Iranian national ID verification service) to verify identity automatically. Result stored and profile marked verified/unverified accordingly.
- Technical notes: Pluggable provider adapter for verification APIs. Timeout, retry, circuit breaker. Provider credentials stored encrypted. Async: create profile → outbox event → worker calls API → update verification state. On failure: profile stays PENDING, staff can retry.
- UI/UX: N/A (backend). Admin sees provider config in settings.
- Dependencies: T-07.01.01, verification provider integration
- Complexity: L

**T-07.01.03 — Verification notification to user**

- Description: When profile is verified (manually or by API), user receives notification. If verification fails/rejected, notification with reason and next steps.
- Technical notes: Notification via notification service (in-app + email/SMS per preferences). Template: "Your [profile name] has been verified." Or "Verification failed: [reason]. [Correct and resubmit]."
- UI/UX: Dashboard banner, notification center entry.
- Dependencies: T-07.01.01, notification service
- Complexity: S

---

## E-08: Customer Dashboard

### S-08.01 Dashboard overview

**T-08.01.01 — Dashboard page layout**

- Description: `/app/dashboard` — overview of everything related to current active profile. Summary cards: wallet balance, active orders, pending invoices, open tickets, contract status.
- Technical notes: GET `/api/dashboard` returns aggregated data for active profile. Data scoped by active profile only. Refresh on profile switch.
- UI/UX: Welcome message with profile name. Cards in responsive grid. Each card is clickable (navigates to relevant section). "Quick actions" section. Profile badge.
- Dependencies: T-03.01.01
- Complexity: M

**T-08.01.02 — Wallet balance card**

- Description: Shows available wallet balance in IRR and toman. Link to wallet page. Alert if balance is low relative to pending invoices.
- Technical notes: Calls wallet service for balance. Format IRR with locale-aware number formatting.
- UI/UX: Card with balance prominently displayed. Currency label (IRR/تومان). Button: "Charge wallet". Warning banner if low balance for due invoices.
- Dependencies: wallet module
- Complexity: S

**T-08.01.03 — Quick status cards**

- Description: Cards showing counts: "Active contracts", "Pending orders", "Open tickets", "Unpaid invoices". Each with link to relevant list page.
- Technical notes: Aggregated queries across modules, scoped to active profile.
- UI/UX: Icon + count + label. Color coding: green (good), yellow (attention), red (action needed). Click navigates to filtered list.
- Dependencies: T-08.01.01
- Complexity: M

---

## E-09: Admin — Branding and Content

### S-09.01 Branding configuration

**T-09.01.01 — Branding settings page**

- Description: Admin can configure brand logo (upload), colors, favicon, app title. Changes reflected across customer-facing UI.
- Technical notes: Store brand config as JSON in DB (versioned). Logo stored as file in object storage. CDN URLs for assets on frontend. Theme: primary color, secondary color, accent color. Config is Draft → Active lifecycle.
- UI/UX: Form with image upload (logo), color pickers (primary/secondary/accent), text inputs (app title, slogan). Preview of changes. "Activate" button with version info.
- Dependencies: admin config framework, file storage
- Complexity: M

**T-09.01.02 — Theme application**

- Description: Branding settings applied to auth pages, public pages, email templates, and notification templates. Full light/dark theme support.
- Technical notes: CSS custom properties injected from brand config. Email templates reference brand colors. Both themes independently configurable or derived from primary.
- UI/UX: Instant preview on dashboard. Consistent across all touchpoints.
- Dependencies: T-09.01.01
- Complexity: M

### S-09.02 Admin — Province and city management

**T-09.02.01 — Province CRUD**

- Description: Admin manages list of Iranian provinces. Name in Persian and English. Active/inactive status.
- Technical notes: Permissions: `admin:geography:edit`. Versioned config. Default seeded provinces should be provided.
- UI/UX: Table with name (FA/EN), status toggle. Add/edit modal. Search.
- Dependencies: admin config framework
- Complexity: M

**T-09.02.02 — City CRUD per province**

- Description: Admin manages cities within each province. Name in Persian and English. Active/inactive. City is selectable in user forms.
- Technical notes: Same pattern as province but nested. API: GET `/api/admin/geography/provinces/:provinceId/cities`. Cannot delete a city that is referenced by active profiles (soft delete).
- UI/UX: Nested table under province row expansion. Add/edit per province. Bulk import option for initial seed.
- Dependencies: T-09.02.01
- Complexity: M

### S-09.03 Admin — TOS editing

**T-09.03.01 — TOS editor**

- Description: Admin can edit Terms of Service content. Rich text editor. Versioned with publish date and language (Persian/English). Publishing a materially changed version can trigger re-acceptance flag.
- Technical notes: Permissions: `admin:tos:edit`. Versioned with `major` (material change → re-acceptance) and `minor` (typo/clarification → no re-acceptance). Preview before publish. Draft → Published. Last editor recorded. Audit: tos_updated.
- UI/UX: Rich text editor (TipTap or similar). Side-by-side with current active version diff. "Mark as material change" checkbox. Publish button. Version history list.
- Dependencies: T-04.01.01, admin config framework
- Complexity: M

**T-09.03.02 — TOS version history**

- Description: List of all TOS versions with publish date, material change flag, published by. Admin can view any previous version.
- Technical notes: GET `/api/admin/tos/versions`. Versions are immutable after publish. Display-only.
- UI/UX: Table: version #, date, material change badge, author. View link opens read-only version.
- Dependencies: T-09.03.01
- Complexity: S

### S-09.04 Admin — Notification templates

**T-09.04.01 — Notification template editor**

- Description: Admin can edit notification templates for all events. Persian and English versions. Template variables are allow-listed and escaped. Preview and test send.
- Technical notes: Permissions: `admin:notifications:edit`. Template engine: Handlebars/mustache-like with restricted variable access. Versioned. Draft → Active lifecycle. Test send to admin's own verified destination.
- UI/UX: Template list (event key, current version, status). Editor with variable sidebar (drag-to-insert). Preview pane with sample data. Test send button.
- Dependencies: admin config framework, notification service
- Complexity: L

### S-09.05 Admin — Staff roles and permissions

**T-09.05.01 — Staff role management**

- Description: Admin can view/edit staff roles and their permissions. Predefined roles: Customer Support, CRM & Verification, Finance, Legal & Contracts, Operations, Admin. Each with associated permission set.
- Technical notes: Permissions: `admin:roles:edit`. Role-permission mapping stored in DB (role_id → permission[]). Allow custom roles in future, initially fixed set. Audit: role_permission_change.
- UI/UX: Table of roles with permission checkboxes grouped by module. Read-only for predefined roles initially. "View effective permissions" for a staff user.
- Dependencies: T-05.03.02, admin config framework
- Complexity: L

### S-09.06 Admin — Notification delivery configuration

**T-09.06.01 — Email transport configuration**

- Description: Admin configures active email transport: SMTP or Resend. Each has provider-specific fields (host, port, security, credentials, from address, etc.). Test connection before activation. Rollback to previous working version.
- Technical notes: SMTP fields: host, port, security (TLS/STARTTLS), username, password (encrypted), timeouts. Resend: API key (encrypted), from address, domain. Secrets write-only after entry, encrypted at rest. Versioned config. Permissions: `admin:notification-providers:edit`. Step-up auth required. Cannot leave OTP channel without verified recovery path.
- UI/UX: Provider selector (SMTP/Resend). Conditional fields. Test button: "Send test email to [admin email]". Activation switch. Current active version displayed. Rollback button.
- Dependencies: admin config framework, notification service
- Complexity: XL

**T-09.06.02 — SMS.ir configuration**

- Description: Admin configures SMS.ir provider: API key, sender/line number, timeout, throughput limits, low-credit threshold, event-to-template mappings.
- Technical notes: Same lifecycle as email provider. Template mapping: internal event key → SMS.ir TemplateId + variable mapping. Activation validates template IDs and variable availability. Provider base URL application-managed (not admin-editable). Test send to admin's verified mobile number.
- UI/UX: Similar to email config. Additional section: template mapping table with add/edit. Test send: select event → preview rendered params → send to admin.
- Dependencies: admin config framework, notification service
- Complexity: L

**T-09.06.03 — Notification daytime window configuration**

- Description: Admin can configure default delivery window for daytime notifications: start and end time (default 09:00–21:00 in user's timezone).
- Technical notes: Time stored as time-of-day (no timezone). Applied per-user based on their timezone. Immediate notifications (OTP, security) bypass window. Daytime jobs queued outside window.
- UI/UX: Two time inputs (HH:MM). Description of effect. Warning about immediate notifications.
- Dependencies: notification service
- Complexity: S

### S-09.07 Admin — Dual-approval and financial thresholds

**T-09.07.01 — Dual-approval threshold configuration**

- Description: Admin configures the IRR threshold above which refunds, manual financial adjustments, and bank payment confirmations require approval by a second authorized user.
- Technical notes: Value stored, requires step-up auth to change. Versioned config. Emergency override available (requires reason + elevated permission + immediate alert + audit).
- UI/UX: Number input with large IRR display. Description of which actions are affected. "Changes require step-up authentication."
- Dependencies: admin config framework, finance module
- Complexity: M

**T-09.07.02 — Dual-approval workflow**

- Description: When a financial action exceeds threshold, it enters Pending Approval state. Second authorized user (different from initiator) must approve or reject. Audit trail of both actions.
- Technical notes: Initiation creates approval request with transaction details. Notification to approval-eligible staff. Second user reviews and approves/rejects. Cannot approve own requests. Queue view for pending approvals.
- UI/UX: "Pending approvals" section in finance dashboard. Each: amount, initiator, reason, details. Approve/Reject buttons with reason (reason required for reject).
- Dependencies: T-09.07.01
- Complexity: L

### S-09.08 Admin — Service targets and teams

**T-09.08.01 — Service response targets**

- Description: Admin configures response targets for service types (consultation, tickets, etc.). Breached targets create staff alerts.
- Technical notes: Key-value: service type → target hours/days. Audit: config_change. Breach detection: cron/worker checks open items against targets.
- UI/UX: Table of service types with target input. Note: "Breached targets create staff alerts but do not promise service level to customers."
- Dependencies: admin config framework
- Complexity: M

**T-09.08.02 — Staff teams and assignment rules**

- Description: Admin configures staff teams and auto-assignment rules (round-robin, by expertise, by load) for tickets, consultations, verification cases.
- Technical notes: Team CRUD: name, members, skill tags. Assignment rules: type → team → strategy. Fallback to manual assignment. Config versioned.
- UI/UX: Teams list with member management. Assignment rule editor per work type. Reorder priority.
- Dependencies: T-09.08.01
- Complexity: L

**T-09.08.03 — Escalation alerts**

- Description: When SLA/target breached, alert assigned staff. If no response within configurable window, escalate to team lead. Configurable alert channels (in-app, email).
- Technical notes: Escalation policy: level 1 (assigned), level 2 (team lead), level 3 (admin). Each level has a time delay. Worker checks and triggers escalation.
- UI/UX: N/A (backend + notification).
- Dependencies: T-09.08.01, notification service
- Complexity: M

### S-09.09 Admin — Reconciliation and queue management

**T-09.09.01 — Reconciliation exceptions view**

- Description: Admin/staff can view reconciliation exceptions (wallet mismatch, payment mismatch, etc.). List with severity, created date, status, assigned to, resolve/close actions.
- Technical notes: GET `/api/admin/reconciliation/items`. Permissions: `admin:reconciliation:view`, `admin:reconciliation:resolve`. States: Open, Investigating, Resolved, Closed. Audit: resolution_recorded.
- UI/UX: Table with filter (status, severity, date range). Detail view with full mismatch data. Resolve dialog with explanation. Link to related transactions.
- Dependencies: reconciliation system, finance module
- Complexity: M

**T-09.09.02 — Failed jobs dashboard**

- Description: View failed background jobs with error details, retry count, last attempt. Retry or Resolve actions. Dead-letter queue overview.
- Technical notes: GET `/api/admin/failed-jobs`. States: Failed, Retrying, DeadLetter, Resolved. Permissions: `admin:jobs:view`, `admin:jobs:retry`. Worker job table query.
- UI/UX: Table: job type, error message, attempts, last run. Retry button (single or bulk). Dead-letter tab shows exhausted jobs.
- Dependencies: worker framework
- Complexity: M

**T-09.09.03 — Dead-letter notifications**

- Description: Failed notification deliveries go to dead-letter queue. Staff can view, retry, or dismiss.
- Technical notes: Same pattern as failed jobs but filtered to notification type. Admin can view raw notification data (masked).
- UI/UX: Separate "Failed notifications" section. Retry/dismiss actions.
- Dependencies: notification service, T-09.09.02
- Complexity: M

### S-09.10 Admin — Electricity ordering settings

**T-09.10.01 — Online wallet top-up limit**

- Description: Admin configures per-transaction online wallet top-up limit in IRR. Default: 2,000,000,000 IRR.
- Technical notes: Stored as integer IRR. Validated on wallet top-up endpoint. Versioned config. Audit: change_recorded.
- UI/UX: Number input with large number formatting. Shows current limit in toman. Warning: "Changing this limit affects all future online top-ups."
- Dependencies: admin config framework, wallet module
- Complexity: S

**T-09.10.02 — Mandatory green-electricity rules**

- Description: Admin configures independent settings for simple and advanced ordering:
  - Simple order: mandatory green rule enabled by default
  - Advanced order: mandatory green rule disabled by default
  - Average-power threshold (default 1000 kW)
  - Mandatory green share percentage (default 4%)
- Technical notes: All values independently configurable per mode. Validation: threshold ≥ 0, percentage 0–100. Activating green rule blocked if green electricity product is inactive, unpriced, or incompatible with its limits. Changes affect new orders only. Audit: change_recorded. Safety: if green product is deactivated while rule is active, system must fail closed with admin alert.
- UI/UX: Two sections (Simple/Advanced). Each with enable toggle, threshold input, percentage slider. Validation warnings. Note: Existing orders retain the rule snapshot at confirmation.
- Dependencies: T-09.10.01, products module
- Complexity: L

**T-09.10.03 — Green rule activation safety check**

- Description: When admin tries to activate mandatory green rule, system checks green electricity product is Active, priced, and within limits. If not, block activation and explain why.
- Technical notes: Validation on config save. If green product state changes while rule is active, system must fail closed: prevent ordering and alert admin.
- UI/UX: Clear error: "Cannot activate: Green electricity product is [inactive/unpriced]. [Fix issue or disable rule]."
- Dependencies: T-09.10.02
- Complexity: M

### S-09.11 Admin — AI orchestration settings

**T-09.11.01 — AI model management**

- Description: Admin manages AI models: title, base URL, model name, API token (encrypted), provider type. Test button checks connection and displays response.
- Technical notes: Permissions: `admin:ai:models`. CRUD for model records. API tokens encrypted at rest. Test: worker sends simple request and returns response. Provider types: OpenAI-compatible, Anthropic, etc. Models are referenced by AI agents.
- UI/UX: Table: name, provider type, model, status (reachable/unreachable). Add/edit form. Test button per row with response preview.
- Dependencies: admin config framework
- Complexity: L

**T-09.11.02 — Knowledge base management**

- Description: Admin manages knowledge bases and KB groups. KB has title, description, files/documents. KB groups combine multiple KBs.
- Technical notes: CRUD for KBs. Files stored in document system, processed (chunked, embedded) for AI retrieval. KB groups: collections of KBs.
- UI/UX: KB list. Create/edit KB: title, description, upload/select documents. Group list. Link KBs to groups.
- Dependencies: T-09.11.01, document processing
- Complexity: L

**T-09.11.03 — Policy management**

- Description: Admin manages AI usage policies and policy groups. Policies define rules, permissions, guardrails for AI agents.
- Technical notes: Policy types: allowed topics, disallowed actions, data access scope, response style, etc. Policy groups combine policies.
- UI/UX: Policy list with type badges. Editor per policy (structured fields). Group management.
- Dependencies: T-09.11.01
- Complexity: L

**T-09.11.04 — AI agent management**

- Description: Admin creates/manages AI agents. Each agent has: title, reference to a model, linked KBs (or KB groups), linked policies (or policy groups). Test chat UI for integration testing.
- Technical notes: Agent records in DB. Agent config: model_id, kb_ids[], policy_ids[]. Test chat: in-page mini chat widget that talks to the actual agent backend with admin's auth context.
- UI/UX: Agent list with status (active/inactive). Create/edit form with model selector, KB multi-select, policy multi-select. Test chat panel at bottom of edit page.
- Dependencies: T-09.11.01, T-09.11.02, T-09.11.03
- Complexity: XL

**T-09.11.05 — Agent slot assignment**

- Description: Admin assigns agents to predefined slots: Individual chatbot, Legal Entity chatbot, Staff chatbot, Website chatbot, Telegram chatbot. One agent can be used in multiple slots.
- Technical notes: Slots defined as system configuration. Each slot mapped to an agent_id. Changing slot agent is audited. Slots are consumed by frontend and external integrations.
- UI/UX: Per-slot dropdown showing all available agents. Current assignment displayed. "This agent is also used in [other slots]" warning.
- Dependencies: T-09.11.04
- Complexity: M

### S-09.12 Admin — Catalogue management

**T-09.12.01 — Product catalogue management**

- Description: Admin manages all product catalogues: consultation, electricity, hardware, saving plans. Each has CRUD with specific fields.
- Technical notes: Permissions: `admin:catalogue:edit`. Individual CRUD sections per product type. Versioned price changes with effective dates. Products referenced by orders cannot be hard-deleted (archive).
- UI/UX: Tabbed layout: Consultation, Electricity, Hardware, Saving Plans. Each with list/add/edit. Price history view. Active/inactive toggle. Deactivate warning if referenced by active rules.
- Dependencies: admin config framework, products module
- Complexity: L

**T-09.12.02 — VAT configuration**

- Description: Admin configures VAT rates by charge category, with optional product override. Effective dates. Product override wins; category default applies otherwise; 0% as fallback.
- Technical notes: Versioned with effective dates. Snapshotted on invoice at calculation time. Rate stored as basis points or decimal. Audit: change_recorded. Validation: 0 ≤ rate ≤ 100%.
- UI/UX: Table: category/product, rate, effective from, status. Add new rate (future effective date). Product override toggle.
- Dependencies: admin config framework, products module
- Complexity: L

**T-09.12.03 — Gift code management**

- Description: Admin manages gift codes: code value (case-insensitive unique), discount type (fixed IRR or percentage with max cap), eligibility (public/profile-restricted), usage limits (total, per-profile), dates, minimum order amount, eligible categories, status.
- Technical notes: Code normalization: trim, uppercase. DB unique index on normalized code. Discount max cap required for percentage type. Redemption atomically at order creation. Failed orders don't consume. Cancellation before payment restores by default. After payment follows policy config. VAT calculated after gift discount on taxable lines.
- UI/UX: Gift code list with search/filter. Create/edit form. Usage statistics per code. Active/inactive toggle. Warning on high-value percentage codes.
- Dependencies: admin config framework, orders module
- Complexity: L

**T-09.12.04 — Contract template management**

- Description: Admin manages contract templates (document templates with placeholders). Upload, edit, version. Placeholders extracted at upload time and stored.
- Technical notes: Template files stored in object storage. Placeholders: `{{date}}`, `{{customerName}}`, `{{amount}}`, etc. Extracted via regex. Versioned. A new version keeps all files as archive of previous version. Cannot delete a template referenced by active contract types.
- UI/UX: Template list with version history. Upload: drag & drop files. Placeholder extraction result shown after upload. Edit template metadata.
- Dependencies: document storage module
- Complexity: L

**T-09.12.05 — Upload policies configuration**

- Description: Admin configures file upload policies: allowed formats and size limits per category (documents, images, videos). Within deployment-safe boundaries.
- Technical notes: Category → allowed extensions[], max file size. Validate both extension and detected content type at upload. Config versioned. System enforces both DB config and deployment-level limits.
- UI/UX: Table: category, formats, max size. Edit modal. Warning about security implications.
- Dependencies: admin config framework, file storage module
- Complexity: M

**T-09.12.06 — Contract electricity increase limits**

- Description: Admin configures max % increase a customer can request for contracted electricity quantity. Also max contract duration and lead time for advanced orders.
- Technical notes: Values: `maxQuantityIncreasePercent` (default configurable), `maxContractDuration` (default 24 Jalali months), `leadTimeDays` (default 0). Changes affect new drafts only.
- UI/UX: Number inputs per setting. Description. Note: "Changes apply to new orders only, not existing contracts."
- Dependencies: admin config framework, electricity module
- Complexity: S

---

## E-10: Admin — Staff and System Configuration

### S-10.01 Staff user roles and permissions (Admin)

**T-10.01.01 — Staff user list (admin)**

- Description: Admin can view all staff users, their roles, last login, status. Create/edit/disable staff accounts.
- Technical notes: GET `/api/admin/staff` — separate from CRM user list. Permissions: `admin:staff:view`. Disable: POST `/api/admin/staff/:userId/disable` — revokes sessions, prevents login.
- UI/UX: Table with name, username, roles badges, status (active/disabled). Disable button with confirmation.
- Dependencies: authorization framework
- Complexity: M

**T-10.01.02 — Staff permission audit view**

- Description: Admin can view permission changes for staff users. Timeline of role additions/removals.
- Technical notes: Queries audit_log for role changes. Filterable by user, date range.
- UI/UX: Timeline view per user: "Assigned [role] by [admin] on [date]", "Removed [role] by [admin] on [date]".
- Dependencies: T-09.05.01, audit module
- Complexity: M

---

## Legend

| Code | Meaning |
|------|---------|
| **E-NN** | Epic — large feature area spanning multiple sprints |
| **S-NN.MM** | Story — user/tech story within an epic |
| **T-NN.MM.OO** | Task — concrete implementation unit |
| **XS** | Very small (< 2 hours) |
| **S** | Small (hours to 1 day) |
| **M** | Medium (2–4 days) |
| **L** | Large (~1 week) |
| **XL** | Extra large (multi-week, consider splitting) |

---

---

## E-11: Account Lifecycle & Dual-Role Context Safety

### S-11.01 Customer account/profile export and closure

**T-11.01.01 — Account/profile closure request and blocker evaluation**

- Description: Customers request export or closure through support. Evaluate and display each legal, financial, security, wallet, and active-contract blocker with an owner and resolution path.
- Technical notes: Closure never silently deletes financial/audit evidence. The request is profile-scoped, audited, idempotent, and routed to an authorized support/privacy queue.
- UI/UX: Show export and closure as distinct actions, every blocker, current owner, next step, and support thread.
- Dependencies: T-06.01.01, E-04 financial obligations
- Complexity: L

**T-11.01.02 — Portable customer data export**

- Description: Generate an asynchronous, access-controlled export of the customer's/profile's eligible data and documents.
- Technical notes: Use the generic async job/progress framework in E-05, redact protected internal/security data, enforce active-profile ownership, expire the download, and audit generation/download.
- UI/UX: Visible queued/processing/completed/failed progress with retry/support actions.
- Dependencies: T-11.01.01, E-05 async jobs and storage
- Complexity: L

**T-11.01.03 — Closure execution, revocation, retention and anonymization**

- Description: After approval and blocker resolution, revoke access/sessions, close eligible profiles, anonymize data when allowed, and retain records under legal/financial/audit holds.
- Technical notes: Use one auditable workflow with explicit dry-run/preview, step-up authentication for staff approval, idempotency, and rollback/compensation for partial failure.
- UI/UX: Final review explains consequences and retained records; completion provides support access and export reference.
- Dependencies: T-11.01.01, T-11.01.02, T-02.02.02
- Complexity: L

### S-11.02 Staff/customer context separation

**T-11.02.01 — Explicit operating context in session and authorization policy**

- Description: Users who are both staff and customers/agents operate in an explicit `staff` or `customer` context. Customer context never inherits staff capabilities; staff context never acts as an active customer profile.
- Technical notes: Central authorization policy evaluates context, capability, active profile, and object ownership for HTTP, workers, exports, files, and AI tools. Context switching rotates relevant CSRF/session claims and is audited.
- UI/UX: A persistent, unmistakable context indicator and deliberate switch action prevent accidental privilege use.
- Dependencies: T-02.02.01, E-06 authorization policy
- Complexity: L

**T-11.02.02 — Context-isolation integration and E2E tests**

- Description: Prove staff-only commands fail in customer context, customer commands cannot use staff permissions, profile switching cannot cross ownership, and history preserves the real acting context.
- Technical notes: Include direct API attempts, stale tabs/tokens, workers, file URLs, exports, and AI tool calls.
- Dependencies: T-11.02.01
- Complexity: M

### S-11.03 Staff-profile onboarding exception

**T-11.03.01 — Atomic staff user/profile creation without customer onboarding**

- Description: Extend `T-05.03.01` so staff creation atomically creates exactly one Individual profile, verified regardless of customer verification mode, without requiring an address, and never redirects staff into customer onboarding.
- Technical notes: Enforce the one-profile restriction and preserve historical authorship if staff later becomes disabled.
- Dependencies: T-05.03.01
- Complexity: M
