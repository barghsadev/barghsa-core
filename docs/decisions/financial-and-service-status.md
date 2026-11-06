# Financial and service status displays

Money displays use whole IRR values. Decimal strings and `bigint` preserve amounts above JavaScript's safe integer range. `Currency` refuses fractional, ambiguous and unsafe numeric inputs. Its optional toman equivalent preserves tenths of a toman; it does not round the balance or change the accounting unit. The language and configured numeral style control formatting.

The dashboard distinguishes available, posted and reserved funds. Reservations appear only when positive. The low-balance warning compares available funds with pending invoice amounts on the server using integer arithmetic. The whole balance card opens the wallet, including its charge action.

Wallet history preserves the server's chronological cursor order. Changing the active profile or account clears the old page and cursor. Switching table and card views uses the accepted page. A failed continuation can retain accepted rows; a denial clears private rows. Completed credits and debits carry their exact sign and color. Pending receipts and reservations are not presented as completed funds. Invoice references link only to the appropriate customer or staff route.

Invoice progress uses integer arithmetic for total, paid and remaining amounts. Credit adjustments are not payment demands. The wallet payment button requires an authoritative, owned review with sufficient available funds, an eligible invoice and loaded account time settings. Confirmation captures the review and request key. A changed amount or review requires fresh confirmation, while an uncertain result retains the captured request for reconciliation. Display percentages never authorize payment.

Electricity service and financial status have separate labels and badges. A completed service can still have an outstanding refund. Badge colors are presentation only. Known states use localized business labels; unknown states remain neutral and do not expose internal identifiers. Dot-only badges retain their text for assistive technology and a descriptive title.

Status histories show the recorded time, audience-safe actor identity and literal reason or note. Missing identity, historical dates and truncated history remain explicit. The UI does not invent events, render notes as HTML or use a color as the only meaning.

The solar tracker follows the owning business workflow in E-03:

1. Document review
2. Postal originals received
3. Contract signing
4. Work started
5. Equipment delivered
6. Installation recorded

Postal originals must precede contract signing. This resolves the conflicting illustrative ordering in T-07.27.01.06. The first three stages use existing document, postal and signature evidence. Construction stages use immutable milestone records and their dated detail history. An elapsed contract term does not establish delivery or installation. Missing legacy dates stay unknown. Cancelled work has no fabricated current step.

Saving fulfillment also uses recorded stage progress. An authorized optional skip remains distinct from completion. Both trackers use the shared stepper, horizontal on larger screens and vertical on narrow screens, with localized state text and reduced-motion support.

Notification categories retain a visible label and icon in both the inbox and bell. They classify a notice; they do not establish payment, signature, delivery or verification success.
