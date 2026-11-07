# Accessibility checks

Use one `main#main-content` for the active page and put the shared skip link
before the shell and any interactive notices. Give content inside the main
landmark its own heading or labelled region when it needs a name. Use native
controls and the shared dialog, sheet and menu components for keyboard
interaction and focus restoration.

The production browser cases tagged `@a11y-critical` cover login, the customer
dashboard, service histories, the wallet and contract details. Fast CI runs
these cases against the production web build and fails on a violation. The
full browser suite already includes them. Making the job a required merge
check is controlled by the repository rules.

Keep the existing accessibility assertions on other journeys. For a finding,
record the route, browser, direction, selector, rule and whether the cause is
in shared UI or in the page. Fix confirmed defects. Where automation cannot
evaluate the result, record the manual check and its result, for example the
contrast of text over a gradient. An exception needs a specific rule, scope,
reason and owner approval.

Keep readable content opaque during page and list entrance animations. Even
a brief fade of the whole row can put its text below the contrast floor.

The high contrast switch in account settings applies to the current browser.
It strengthens text, form controls and focus outlines in both light and dark
themes, and does not send an account setting change. The shared stylesheet
also keeps a visible focus outline when the operating system forces colors.

Standalone loading, error and not-found views keep the same skip link and
main landmark as ordinary pages. A fallback inside the workspace reuses its
main landmark. When an already verified session is denied on the next
protected navigation, sign-in announces that the session ended. The notice is
used once; a normal visit to sign-in has no expiry warning.

Use a native button for a custom file picker. Keep drop instructions, allowed
types and limits in its accessible description, and link any file-specific
error to the same control. Native file inputs keep their visible labels and
descriptions. A decorative required marker stays hidden from assistive
technology; the control announces the required state itself.
