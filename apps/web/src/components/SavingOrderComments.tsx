import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, Textarea } from '@barghsa/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { ErrorCodes } from '@barghsa/shared/errors';
import { tSaving } from '@barghsa/i18n/saving';
import { t } from '@barghsa/i18n/app';
import { tOrderComments } from '@barghsa/i18n/order-comments';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import {
  commentUuid,
  parseCommentPage,
  prependCommentPage,
  matchedCommentReceipt,
  publicCommentError,
  definitiveCommentRejection,
  type CommentDraft,
  type CommentKind,
  type OrderComment,
} from '../lib/order-comment-form.js';

interface CommentProps {
  orderId: string;
  profileId: string;
  sourceVersion?: string | null | undefined;
  staff?: boolean;
  formatTimestamp: (value: string) => string;
}
interface CapturedComment {
  action: TeamAction;
  body: string;
  visibility: string;
  generation: number;
  attempted: boolean;
  uncertain: boolean;
  rejected: boolean;
}
const emptyDraft: CommentDraft = { body: '', visibility: '' };
function OrderComments(props: CommentProps & { kind: CommentKind }) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const locale = useLocale();
  const scope = JSON.stringify([
    actor,
    props.profileId,
    props.orderId,
    props.kind,
    !!props.staff,
    props.sourceVersion,
    profileRevision,
  ]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  if (!actor || !commentUuid(props.profileId) || !commentUuid(props.orderId))
    return <p role="alert">{tOrderComments('forbidden', locale)}</p>;
  return (
    <CommentWorkspace
      key={scope}
      {...props}
      actor={actor}
      scope={scope}
      currentScope={currentScope}
    />
  );
}
function CommentWorkspace({
  orderId,
  staff = false,
  kind,
  formatTimestamp,
  actor,
  scope,
  currentScope,
}: CommentProps & {
  kind: CommentKind;
  actor: string;
  scope: string;
  currentScope: RefObject<string>;
}) {
  const locale = useLocale();
  const copy = (key: string) =>
    kind === 'saving' ? tSaving(key, locale) : t(`electricity.comments.${key}`, locale);
  const formCopy = (key: string) => tOrderComments(key, locale);
  const staffVisibility = kind === 'electricity' && staff;
  const base = `${staff ? '/api/staff' : '/api'}/${kind}/orders/${encodeURIComponent(orderId)}/comments`;
  const mounted = useRef(false);
  const generation = useRef(0);
  const readGeneration = useRef(0);
  const readAbort = useRef<AbortController | null>(null);
  const reading = useRef(false);
  const preparing = useRef(false);
  const pending = useRef(false);
  const denied = useRef(false);
  const captured = useRef<CapturedComment | null>(null);
  const acceptedComments = useRef<OrderComment[]>([]);
  const [comments, setComments] = useState<OrderComment[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'load' | 'forbidden' | 'missing' | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const messages = { body: formCopy('bodyInvalid'), visibility: formCopy('visibilityInvalid') };
  const form: ReturnType<typeof useZodForm<CommentDraft>> = useZodForm<CommentDraft>(
    async () => {
      const raw = JSON.stringify(form.getValues());
      const version = generation.current;
      const schemas = await import('../lib/order-comment-form-schemas.js');
      return currentScope.current === scope &&
        version === generation.current &&
        raw === JSON.stringify(form.getValues())
        ? schemas.commentFormSchema(staffVisibility, messages)
        : schemas.inactiveCommentSchema;
    },
    { defaultValues: emptyDraft, validationUnavailableMessage: formCopy('validationUnavailable') }
  );
  const applyFields = useActionFieldErrors(
    form,
    staffVisibility ? messages : { body: messages.body },
    copy('commentError')
  );
  const active = () => mounted.current && currentScope.current === scope;
  const locked = () =>
    preparing.current || pending.current || !!captured.current || form.isSubmissionPending();
  function release() {
    ++generation.current;
    captured.current = null;
    preparing.current = false;
    pending.current = false;
    setBusy(false);
    setAction(null);
    setUncertain(false);
  }
  function withdraw(reason: 'forbidden' | 'missing') {
    ++readGeneration.current;
    readAbort.current?.abort();
    reading.current = false;
    denied.current = reason === 'forbidden';
    release();
    acceptedComments.current = [];
    setComments([]);
    setBefore(null);
    form.reset(emptyDraft);
    setLoading(false);
    setError(reason);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++generation.current;
      ++readGeneration.current;
      readAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    readAbort.current = controller;
    const request = ++readGeneration.current;
    reading.current = true;
    setLoading(true);
    setError(null);
    const fresh = () =>
      active() && !controller.signal.aborted && request === readGeneration.current;
    void fetch(cursor ? `${base}?before=${encodeURIComponent(cursor)}` : base, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!fresh()) return;
        if ([401, 403].includes(response.status)) {
          withdraw('forbidden');
          return;
        }
        if (response.status === 404) {
          withdraw('missing');
          return;
        }
        if (!response.ok) throw new Error('comments');
        const value: unknown = await response.json();
        if (!fresh()) return;
        const page = parseCommentPage(value, kind, orderId, staff);
        if (!page) throw new Error('comments');
        const rows = cursor
          ? prependCommentPage(page.comments, acceptedComments.current)
          : page.comments;
        if (!rows) throw new Error('comments');
        denied.current = false;
        acceptedComments.current = rows;
        setComments(rows);
        setBefore(page.nextBefore);
      })
      .catch(() => {
        if (fresh()) setError('load');
      })
      .finally(() => {
        if (fresh()) {
          reading.current = false;
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [base, cursor, revision, scope]);
  function reload() {
    if (!active() || locked() || reading.current || denied.current) return;
    if (error !== 'load') setCursor(null);
    setRevision((value) => value + 1);
  }
  function live(command: CapturedComment, ownedAction: TeamAction) {
    return (
      active() &&
      !denied.current &&
      captured.current === command &&
      command.action === ownedAction &&
      command.generation === generation.current
    );
  }
  function unconfirmed(command: CapturedComment, ownedAction: TeamAction) {
    if (!live(command, ownedAction)) return;
    command.uncertain = true;
    pending.current = false;
    setUncertain(true);
    setAction(null);
  }
  function close(command: CapturedComment, ownedAction: TeamAction) {
    if (!live(command, ownedAction) || pending.current) return;
    if (command.uncertain || (command.attempted && !command.rejected))
      unconfirmed(command, ownedAction);
    else release();
  }
  function decorate(command: CapturedComment, ownedAction: TeamAction) {
    ownedAction.errorMessages = Object.fromEntries(
      [
        ErrorCodes.VALIDATION_INPUT_INVALID.code,
        'VALIDATION:INPUT_INVALID',
        ErrorCodes.CONFLICT_STATE.code,
        ErrorCodes.CONFLICT_VERSION.code,
        ErrorCodes.NOT_FOUND_RESOURCE.code,
      ].map((code) => [
        code,
        (value: unknown) => {
          if (!live(command, ownedAction)) return copy('commentError');
          if (publicCommentError(value)?.code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
            withdraw('missing');
            return formCopy('missing');
          }
          const rejection = definitiveCommentRejection(value);
          if (rejection) {
            command.rejected = true;
            if (
              !command.uncertain &&
              rejection.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
              Array.isArray(rejection.fields) &&
              applyFields(rejection.fields)
            ) {
              pending.current = false;
              close(command, ownedAction);
            }
          }
          return copy(code.startsWith('CONFLICT:') ? 'staffConflict' : 'commentError');
        },
      ])
    );
  }
  function send() {
    if (!active() || locked() || reading.current || loading || error || denied.current) return;
    preparing.current = true;
    setBusy(true);
    const version = ++generation.current;
    const raw = JSON.stringify(form.getValues());
    const fresh = () =>
      active() && version === generation.current && raw === JSON.stringify(form.getValues());
    void form
      .handleSubmit((draft) => {
        if (!fresh() || JSON.stringify(draft) !== raw) return;
        const command: CapturedComment = {
          generation: version,
          body: draft.body.trim(),
          visibility: draft.visibility,
          attempted: false,
          uncertain: false,
          rejected: false,
          action: {
            title: copy('sendComment'),
            description: copy('confirmComment'),
            path: base,
            method: 'POST',
            successStatus: 200,
            body: {
              idempotencyKey: crypto.randomUUID(),
              body: draft.body.trim(),
              ...(staffVisibility ? { visibility: draft.visibility } : {}),
            },
            conflictMessage: copy('staffConflict'),
            forbiddenMessage: copy('staffForbidden'),
          },
        };
        captured.current = command;
        decorate(command, command.action);
        setAction(command.action);
      })()
      .finally(() => {
        if (active() && generation.current === version) {
          preparing.current = false;
          setBusy(false);
        }
      });
  }
  function retryCaptured() {
    const command = captured.current;
    if (
      !active() ||
      !command ||
      !live(command, command.action) ||
      !command.uncertain ||
      pending.current ||
      action
    )
      return;
    const retry = { ...command.action };
    command.action = retry;
    decorate(command, retry);
    setAction(retry);
  }
  const command = captured.current;
  const frozen = !!command || pending.current || uncertain;
  return (
    <section className="space-y-4" aria-label={copy('comments')} data-testid="order-comments">
      <h2 className="text-xl font-semibold">{copy('comments')}</h2>
      {error && <p role="alert">{error === 'load' ? copy('commentError') : formCopy(error)}</p>}
      {loading && <p role="status">{copy('staffLoading')}</p>}
      <div className="flex flex-wrap gap-2">
        {error !== 'forbidden' && (
          <Button
            type="button"
            variant="outline"
            data-testid="order-comment-reload"
            disabled={loading || locked()}
            onClick={reload}
          >
            {formCopy('retryLoad')}
          </Button>
        )}
        {before && (
          <Button
            type="button"
            variant="outline"
            disabled={loading || locked()}
            onClick={() => {
              if (active() && !locked() && !reading.current) {
                if (cursor === before) setRevision((value) => value + 1);
                else setCursor(before);
              }
            }}
          >
            {copy('olderComments')}
          </Button>
        )}
      </div>
      {!loading && !error && !comments.length && (
        <p className="text-sm text-muted-foreground">{copy('noComments')}</p>
      )}
      <ol className="space-y-3">
        {comments.map((comment) => (
          <li key={comment.id} className="rounded-md border p-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <strong>
                {comment.authorName} · {copy(comment.authorRole)}
                {kind === 'electricity' && comment.visibility === 'internal'
                  ? ` · ${copy('internal')}`
                  : null}
              </strong>
              <time dateTime={comment.createdAt} className="text-muted-foreground">
                {formatTimestamp(comment.createdAt)}
              </time>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{comment.body}</p>
          </li>
        ))}
      </ol>
      {uncertain && (
        <div role="alert" className="space-y-2">
          <p>{formCopy('uncertain')}</p>
          <Button
            type="button"
            variant="outline"
            data-testid="order-comment-retry"
            disabled={pending.current || !!action}
            onClick={retryCaptured}
          >
            {formCopy('retryCaptured')}
          </Button>
        </div>
      )}
      {error !== 'forbidden' && error !== 'missing' && (
        <Form {...form}>
          <form
            noValidate
            data-testid="order-comment-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem id={`${kind}-comment-${staff ? 'staff' : 'customer'}`}>
                  <FormLabel>{copy('writeComment')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} disabled={frozen} />
                  </FormControl>
                  <FormDescription>{formCopy('bodyHelp')}</FormDescription>
                  <FormMessage reserveSpace />
                </FormItem>
              )}
            />
            {staffVisibility && (
              <FormField
                control={form.control}
                name="visibility"
                render={({ field }) => (
                  <FormItem id="electricity-comment-visibility">
                    <FormLabel>{copy('visibility')}</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        disabled={frozen}
                        className="w-full rounded border border-input bg-background p-2 text-sm"
                      >
                        <option value="">{copy('chooseVisibility')}</option>
                        <option value="public">{copy('public')}</option>
                        <option value="internal">{copy('internal')}</option>
                      </select>
                    </FormControl>
                    <FormDescription>{formCopy('visibilityHelp')}</FormDescription>
                    <FormMessage reserveSpace />
                  </FormItem>
                )}
              />
            )}
            <Button
              type="submit"
              disabled={loading || !!error || frozen || busy}
              aria-busy={busy || undefined}
            >
              {busy && (
                <span
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                />
              )}
              {copy('sendComment')}
            </Button>
            {busy && <p role="status">{formCopy('checking')}</p>}
            {form.formState.errors.root?.validation && (
              <p role="alert">{formCopy('validationUnavailable')}</p>
            )}
          </form>
        </Form>
      )}
      {action && command && live(command, action) && (
        <TeamActionDialog
          action={action}
          onClose={() => close(command, action)}
          onValidationError={() => false}
          onDenied={() => {
            if (live(command, action)) withdraw('forbidden');
          }}
          onUnconfirmed={() => unconfirmed(command, action)}
          onPendingChange={(value) => {
            if (!live(command, action)) return;
            pending.current = value;
            if (value) {
              ++readGeneration.current;
              readAbort.current?.abort();
              reading.current = false;
              setLoading(false);
              command.attempted = true;
            }
          }}
          onSuccess={async (value) => {
            if (!live(command, action)) return;
            if (
              !matchedCommentReceipt(value, {
                kind,
                orderId,
                actor,
                staff,
                body: command.body,
                visibility: command.visibility,
              })
            ) {
              unconfirmed(command, action);
              return;
            }
            release();
            form.reset(emptyDraft);
            setCursor(null);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </section>
  );
}
export function SavingOrderComments(props: CommentProps) {
  return <OrderComments {...props} kind="saving" />;
}
export function ElectricityOrderComments(props: CommentProps) {
  return <OrderComments {...props} kind="electricity" />;
}
