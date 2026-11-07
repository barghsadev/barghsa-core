# Accessibility checks

Use one `main#main-content` for the active page and put the shared skip link
before the shell and any interactive notices. Give content inside the main
landmark its own heading or labelled region when it needs a name. Use native
controls and the shared dialog, sheet and menu components for keyboard
interaction and focus restoration.

The production browser cases tagged `@a11y-critical` cover login, the customer
dashboard, service histories, the wallet and contract details. The existing
full browser suite includes these cases. A separately reviewed workflow
change would also run them in fast CI. It needs a GitHub credential allowed
to update Actions workflows. Requiring the job for merges is controlled by
the repository rules.

Keep the existing accessibility assertions on other journeys. For a finding,
record the route, browser, direction, selector, rule and whether the cause is
in shared UI or in the page. Fix confirmed defects. Where automation cannot
evaluate the result, record the manual check and its result, for example the
contrast of text over a gradient. An exception needs a specific rule, scope,
reason and owner approval.

The high contrast switch in account settings applies to the current browser.
It strengthens text, form controls and focus outlines in both light and dark
themes, and does not send an account setting change. The shared stylesheet
also keeps a visible focus outline when the operating system forces colors.
