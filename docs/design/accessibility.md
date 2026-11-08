# Accessibility checks

Use one `main#main-content` for the active page and put the shared skip link
before the shell and any interactive notices. Give content inside the main
landmark its own heading or labelled region when it needs a name. Use native
controls and the shared dialog, sheet and menu components for keyboard
interaction and focus restoration.

The focused workspace pane handles Arrow Up and Arrow Down so it scrolls
in Safari. Its child controls keep their own keyboard behavior.

The production browser cases tagged `@a11y-critical` cover login, the customer
dashboard, service histories, the wallet and contract details. Fast CI runs
these cases against the production web build and fails on a violation. The
full browser suite already includes them. Making the job a required merge
check is controlled by the repository rules.

Fast CI also scans customer media pages and staff failed-notification triage.
Full CI adds the same Axe scan to populated route presentation checks outside
the critical cases.
Axe violations and items that need manual review appear as workflow warnings
with the route, browser, direction, rule and targets. The fast job also
attaches a structured report. Existing journey assertions still fail on
regressions.

For each finding, record whether the cause is in shared UI or in the page.
Fix confirmed defects. Where automation cannot evaluate the result, record
the manual check and its result, for example the contrast of text over a
gradient. An exception needs a specific rule, scope, reason and owner approval.

Use unrounded contrast ratios. Ordinary text needs 4.5:1. Large text and
visual cues needed to identify or operate controls need 3:1. Measure control
boundaries, state indicators and keyboard focus separately from text.
[WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
[WCAG non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)

Record the actual theme, high-contrast state, language and viewport for each
measurement. If published policy locks the fixture to one theme, record the
other theme as unmeasured. Reveal clipped text in its scroll container and
check it again. Run page landmark assertions before opening a modal, then
measure the dialog while it owns focus.

Settings navigation sits on the configurable page canvas. Inactive links
use the page foreground. Hovered and selected links use the foreground
paired with their active fill. The public brand tile and bolt use the paired
primary fill and foreground.

Keep readable content opaque during page and list entrance animations. Even
a brief fade of the whole row can put its text below the contrast floor.
Dialog panels stay opaque while scaling in or out. The backdrop can fade
independently.
Popover content stays opaque on entry. On dismissal, hide the positioning
element immediately so it cannot overlap a new dialog or widen the page
during a viewport change.
Onboarding confetti stays behind the opaque completion panel and respects
reduced motion. The More menu animates movement and opacity. Its background
and text colors switch together when the theme changes.

Measure touch targets on populated pages with a coarse pointer. A native
checkbox or radio can use its associated label as the target; test the label
tap as well as the control. Use the shared touch action style for standalone
links. Give separately scrollable invoice tables distinct names that identify
their invoices.

Let long action labels wrap within their container at 320 pixels. Keep the
44-pixel minimum height so the full label remains visible and easy to tap.
Reserve space for errors that appear on blur when they can move a nearby
submit button during a tap.

The high contrast switch in account settings applies to the current browser.
It strengthens text, form controls and focus outlines in both light and dark
themes, and does not send an account setting change. The shared stylesheet
also keeps a visible focus outline when the operating system forces colors.
Selected pill tabs use a foreground border. The border identifies selection
when the adjacent fills are close in color.

Use the shared input border for empty one-time-code fields so each position
stays visible before a digit is entered. Keep titles, descriptions and prices
fully opaque on unavailable saving checkout plans. The disabled radio and
localized availability label convey the state.

Standalone loading, error and not-found views keep the same skip link and
main landmark as ordinary pages. A fallback inside the workspace reuses its
main landmark. When an already verified session is denied on the next
protected navigation, sign-in announces that the session ended. The notice is
used once; a normal visit to sign-in has no expiry warning.

Cold auth transfer checks cover both immediate and delayed session responses.
On the delayed path, the loading state appears before the response arrives.
Both paths measure scripts through the actual form heading.

Use a native button for a custom file picker. Keep drop instructions, allowed
types and limits in its accessible description, and link any file-specific
error to the same control. Native file inputs keep their visible labels and
descriptions. A decorative required marker stays hidden from assistive
technology; the control announces the required state itself.

In CRM identity corrections, the evidence picker describes the required file
count and links invalid selections to the inline error. Reviewer notes become
required when staff select rejection. The CRM archive dialog keeps its scroll
area within the viewport as its height changes.

New contract drafts require a profile, service, title and terms. Imported
revisions can preserve their existing title and terms. The selected value
kind determines whether its amount or description is required. Draft changes,
activation edits and staff requests for changes require a reason. Activation
dates, the initial invoice and the linked order stay optional.

Electricity address corrections require the address, postal code and response
note. Full revisions also require the location and delivery period. Advanced
revisions announce the requirement for a positive quantity at the product
group, while each product quantity and the gift code remain optional.
Quantity increase requests require the requested amount. A stalled correction
submission offers a manual retry of the same reviewed request and keeps other
corrections locked while its outcome is uncertain.

Saving hardware changes require a replacement product and a reason. Cancelling
an upgrade requires its own reason. Staff changes to a paid saving order's
installation address require a replacement address and a reason. Customers
responding to a consultation information request must enter their response.
Solar contract issuance requires a source,
title, terms, reason and value kind. The selected kind determines which value
field is required. Invoice lines require a description, quantity, price and VAT
rate. The taxable checkbox permits either choice.

Order comments require text. Staff electricity comments also require a
visibility choice. Staff profile closure requires confirmation and a current
password. Session and trusted-device revocation mark the password required
when the action calls for step-up.

Sign-in, registration, recovery and staff activation expose their required
account and password fields. Registration also marks terms acceptance
required. Trusting a device during sign-in remains optional.

Account settings mark the new username or contact, its required verification
codes, the selected timezone, and Telegram verification and step-up fields
required when shown. Timezone search remains optional.

Document retention years, legal reasons, and hold expiry each link to their
own validation errors. Hold expiry remains optional. Upload policy formats
require at least one selection, so the group explains the requirement without
marking each checkbox required. A rejected confirmation password links to its
own error.

Knowledge editors require a source address when staff select URL or API
sources. The URL field retains its entry instructions when an error appears.
AI policy editors identify the required fields for the selected rule type.
Membership selectors require a choice, and priority overrides can be left blank.

VAT and gift-code date and time fields are required when scheduling is enabled.
Schedule errors are linked to the visible date or time controls. Terms edited
in Markdown source mode retain the source instructions alongside field errors.
For escalation routing, a role or team choice makes its reference required.

State either-or requirements before submission. A ticket reply can contain
text, an attachment, or both, so its text field is not individually required.
On an uncertain save, keep the original request and a visible recovery
action. Announce the uncertainty once per captured request; show success only
after the matching receipt passes validation.

For contract limits, the confirmation dialog owns the unconfirmed warning.
The editor owns the saved status and its success toast after the matching
receipt.

Shared list, detail and widget reads stop after 15 seconds and surface the
page's retry action. A timeout keeps already verified rows only in the same
scope. A profile change or access denial withdraws them. This deadline is
for reads; a submitted command still needs its own receipt and recovery rules.
