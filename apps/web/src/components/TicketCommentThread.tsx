import { Avatar, AvatarFallback, Badge, cn } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/app';

export interface TicketComment {
  id: string;
  authorId: string;
  body: string;
  visibility: string;
  createdAt: string;
}

/** Only public messages enter a customer thread, regardless of the server response. */
export function TicketCommentThread({
  comments,
  ownerId,
  staff,
  locale,
  customerName,
  assignees,
  formatDate,
}: {
  comments: readonly TicketComment[];
  ownerId: string;
  staff: boolean;
  locale: Locale;
  customerName?: string | null | undefined;
  assignees: readonly { id: string; name: string }[];
  formatDate: (value: string) => string;
}) {
  const visible = comments.filter(
    (item) => item.visibility === 'public' || (staff && item.visibility === 'internal')
  );
  return (
    <section aria-labelledby="ticket-conversation-heading" className="min-w-0">
      <h3 id="ticket-conversation-heading" className="font-semibold">
        {t('tickets.conversation', locale)}
      </h3>
      {visible.length ? (
        <ol className="mt-3 flex flex-col gap-3" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
          {visible.map((item) => {
            const internal = item.visibility === 'internal';
            const customer = !internal && item.authorId === ownerId;
            // Login usernames may be email/phone. Only the existing staff directory may supply names.
            const name = staff
              ? customer
                ? customerName
                : assignees.find((person) => person.id === item.authorId)?.name
              : null;
            const label =
              name || t(customer ? 'tickets.customerAuthor' : 'tickets.staffAuthor', locale);
            return (
              <li
                key={item.id}
                data-slot="ticket-comment"
                className={cn(
                  'flex min-w-0 gap-3 rounded-lg border p-3 text-start',
                  internal
                    ? 'border-warning/30 bg-warning-soft'
                    : customer
                      ? 'bg-card'
                      : 'border-primary/40 bg-card'
                )}
              >
                <Avatar aria-hidden="true">
                  <AvatarFallback>{Array.from(label).slice(0, 2).join('')}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-words">
                      <bdi>{label}</bdi>
                    </span>
                    {(internal || name) && (
                      <Badge variant="outline">
                        {t(
                          internal
                            ? 'tickets.internalBadge'
                            : customer
                              ? 'tickets.customerAuthor'
                              : 'tickets.staffAuthor',
                          locale
                        )}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <time
                      dateTime={
                        Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : undefined
                      }
                    >
                      {formatDate(item.createdAt)}
                    </time>{' '}
                    · {t(`tickets.${item.visibility}`, locale)}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{item.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{t('tickets.noComments', locale)}</p>
      )}
    </section>
  );
}
