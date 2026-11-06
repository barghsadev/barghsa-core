# AI administration navigation

The five existing AI routes share section tabs for models, knowledge bases,
policies, agents and agent slots. Tabs use the existing current navigation grants;
they do not grant API access. Selection follows the confirmed route, keyboard
focus moves without activation, and activation restores focus to the selected tab.
The existing page editors, URL query state and error boundaries keep their owners.
The shared scrolling strip uses the existing Base UI scroll viewport and horizontal
keyboard helper so an overflowing strip remains keyboard-accessible in Safari.

The tab component is imported by the five AI routes. Importing it through the
global settings layout made unrelated pages load its dependencies and exceeded
the VAT route's 500 KB budget. Route imports keep those controls on AI pages, and
the original budget checker still counts their bytes in each AI route. No budget
was raised or deferred to avoid measurement.

This UI work does not complete the blocked Telegram assistant deployment.
Telegram hosting, end-to-end delivery and release receipts remain separate gates
in `kanban/board.json`. The approved read-only AI scope is unchanged.
