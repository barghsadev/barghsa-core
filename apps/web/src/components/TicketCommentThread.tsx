import { Avatar, AvatarFallback, Badge, cn } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/app';
import TosContent from './TosContent.js';
import { FileText } from 'lucide-react';

export interface TicketComment {
  id: string;
  authorId: string;
  body: string;
  visibility: string;
  createdAt: string;
  bodyFormat?: 'plain' | 'markdown';
  authorContext?: 'customer' | 'staff' | 'unknown';
  attachmentCount?: number;
  attachments?: readonly { key: string; fileName: string; contentType: string; url: string }[];
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
            const customer =
              !internal &&
              (item.authorContext === 'customer' ||
                (item.authorContext !== 'staff' && item.authorId === ownerId));
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
                  {item.bodyFormat === 'markdown' ? (
                    <TosContent content={item.body} language={locale} />
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{item.body}</p>
                  )}
                  {!!item.attachments?.length && (
                    <ul aria-label={t('tickets.files', locale)} className="flex flex-wrap gap-2">
                      {item.attachments
                        .filter((file) => /^https?:\/\//i.test(file.url))
                        .map((file) => (
                          <li key={file.key} className="max-w-full">
                            <a
                              href={file.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex max-w-full flex-col gap-2 rounded-md border bg-background p-2 text-sm text-primary underline underline-offset-4"
                            >
                              {['image/png', 'image/jpeg', 'image/webp'].includes(
                                file.contentType
                              ) ? (
                                <img
                                  src={file.url}
                                  alt=""
                                  loading="lazy"
                                  className="h-24 w-32 rounded object-contain"
                                />
                              ) : (
                                <FileText aria-hidden="true" className="size-6" />
                              )}
                              <span className="break-words">
                                <bdi>{file.fileName}</bdi>
                              </span>
                            </a>
                          </li>
                        ))}
                    </ul>
                  )}
                  {(item.attachmentCount ?? 0) >
                    (item.attachments?.filter((file) => /^https?:\/\//i.test(file.url)).length ??
                      0) && (
                    <p role="status" className="text-sm text-muted-foreground">
                      {t('tickets.filesUnavailable', locale)}
                    </p>
                  )}
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
