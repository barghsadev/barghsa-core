import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { ContractFinancialReviewDialog } from './ContractFinancialReviewDialog.js';
import { Link } from '@tanstack/react-router';
import { ContractCancellationPanel } from './ContractCancellationPanel.js';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from 'react';
import { Alert, AlertDescription, Button, PageLoading, StatusBadge, Textarea } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import {
  contractBase,
  type ContractDetailData,
  type ContractSignatureData,
  type ContractVersion,
} from '../lib/contracts.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { ContractActivationPanel } from './ContractActivationPanel.js';
import { ContractSignaturePanel } from './ContractSignaturePanel.js';
import { ContractTerms } from './ContractTerms.js';
import { ContractStatusTimeline } from './ContractStatusTimeline.js';
import { ContractDraftEditor } from './ContractDraftEditor.js';
import { DocumentResults, type DocumentFilters } from './DocumentsWorkspace.js';
import { DocumentUpload, type ContractDocumentAssociation } from './DocumentUpload.js';
import { WorkflowStatusBanner } from './WorkflowStatusBanner.js';
import { t } from '@barghsa/i18n/workspace';
import { customerContractNextAction } from '../lib/contract-guidance.js';

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
import { tContractReviewSignature } from '@barghsa/i18n/contract-review-signature';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  contractFormRejection,
  matchedChangesReceipt,
  type ContractFormCoordination,
  type ContractSigningSource,
} from '../lib/contract-review-signature-form.js';

const ElectricityIncreasePanel = lazy(() => import('./ContractQuantityIncreasePanel.js'));

function ContractIncreaseEntry(props: {
  contractId: string;
  versionId: string;
  profileId: string;
  formatTimestamp: (value: string) => string;
}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readContract = useOwnedContractRead(
    actor,
    revision,
    props.profileId,
    JSON.stringify([props.contractId, props.versionId])
  );
  const [available, setAvailable] = useState(false);
  const [opened, setOpened] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setAvailable(false);
    setFailed(false);
    void readContract<{ canRequest: unknown; request: unknown }>(
      `/api/electricity/contracts/${encodeURIComponent(props.contractId)}/increase`,
      { signal: controller.signal }
    )
      .then((value) => {
        if (typeof value.canRequest !== 'boolean' || !Object.hasOwn(value, 'request'))
          throw new Error('Invalid increase eligibility');
        if (!controller.signal.aborted) setAvailable(value.canRequest && value.request === null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [props.contractId, props.versionId, props.profileId, retry, readContract]);
  if (opened)
    return (
      <Suspense fallback={<PageLoading label={t('electricity.increase.loading', locale)} />}>
        <ElectricityIncreasePanel {...props} />
      </Suspense>
    );
  if (failed)
    return (
      <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
        {t('electricity.increase.retry', locale)}
      </Button>
    );
  return available ? (
    <Button variant="outline" onClick={() => setOpened(true)}>
      {t('electricity.increase.submit', locale)}
    </Button>
  ) : null;
}

type DetailProps = {
  id: string;
  staff: boolean;
  onClose: () => void;
  onChanged: () => void;
  coordination?: ContractFormCoordination;
  refreshRevision?: number;
  onWithdrawal?: () => void;
};
export function ContractDetail(props: DetailProps) {
  const actor = useAccountUser(),
    revision = useProfileContextRevision();
  return (
    <ContractDetailContent
      key={JSON.stringify([props.id, props.staff, actor, revision])}
      {...props}
    />
  );
}
interface ChangeCommand {
  action: TeamAction;
  source: ContractSigningSource;
  actor: string;
  generation: number;
  attempted: boolean;
  uncertain: boolean;
  rejected: boolean;
}
type VersionPage = { versions: ContractVersion[]; nextBefore: number | null };
function ContractDetailContent({
  id,
  staff,
  onClose,
  onChanged,
  coordination,
  refreshRevision,
  onWithdrawal,
}: DetailProps) {
  const actor = useAccountUser();
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const time = useAccountTime();
  const [data, setData] = useState<{
    contract: ContractDetailData;
    version: ContractVersion;
  } | null>(null);
  const [signatureStatus, setSignatureStatus] = useState<ContractSignatureData | null>(null);
  const [versions, setVersions] = useState<ContractVersion[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const revision = useProfileContextRevision();
  const readContract = useOwnedContractRead(
    actor,
    revision,
    undefined,
    JSON.stringify([id, staff, selectedVersion])
  );
  const [reload, setReload] = useState(0);
  const [error, setError] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const copy = (key: string) => tContractReviewSignature(key, locale);
  const epoch = useRef(0),
    readEpoch = useRef(0),
    parentOwner = useRef<object>({}),
    owner = useRef<object | null>(null);
  const [locked, setLocked] = useState(false),
    [preparing, setPreparing] = useState(false),
    preparingRef = useRef(false);
  const command = useRef<ChangeCommand | null>(null),
    [uncertain, setUncertain] = useState(false);
  const source = useRef<ContractSigningSource | null>(null);
  source.current = data;
  const alive = useRef(true);
  const callbacks = useRef({ coordination, onChanged, onWithdrawal });
  callbacks.current = { coordination, onChanged, onWithdrawal };
  const reasonForm = useZodForm<{ reason: string }>(
    async () => {
      const token = epoch.current;
      const schema = await import('../lib/contract-review-signature-form-schemas.js');
      return alive.current && token === epoch.current
        ? schema.contractChangesSchema(copy('reasonInvalid'))
        : schema.inactiveChangesSchema;
    },
    { defaultValues: { reason: '' }, validationUnavailableMessage: copy('validationUnavailable') }
  );
  const reasonFields = useActionFieldErrors(
    reasonForm,
    { reason: copy('reasonInvalid') },
    word('error')
  );
  function blocked() {
    return (
      !alive.current ||
      !!owner.current ||
      preparingRef.current ||
      reasonForm.isSubmissionPending() ||
      !!callbacks.current.coordination?.blocked()
    );
  }
  const shared = useMemo<ContractFormCoordination>(
    () => ({
      blocked: () => blocked(),
      revision: () => readEpoch.current,
      acquire: (claim) => {
        if (blocked()) return false;
        if (callbacks.current.coordination && !callbacks.current.coordination.acquire(claim))
          return false;
        owner.current = claim;
        setLocked(true);
        ++readEpoch.current;
        active.current?.abort();
        setLoadingMore(false);
        return true;
      },
      release: (claim) => {
        if (owner.current === claim) {
          owner.current = null;
          setLocked(false);
          callbacks.current.coordination?.release(claim);
        }
      },
    }),
    []
  );
  function withdraw() {
    if (!alive.current) return;
    ++epoch.current;
    ++readEpoch.current;
    active.current?.abort();
    if (owner.current) shared.release(owner.current);
    command.current = null;
    preparingRef.current = false;
    setPreparing(false);
    setAction(null);
    setUncertain(false);
    source.current = null;
    setData(null);
    setSignatureStatus(null);
    setVersions([]);
    setNext(null);
    reasonForm.reset({ reason: '' });
    setAcknowledged(false);
    setError(true);
    callbacks.current.onWithdrawal?.();
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ++epoch.current;
      ++readEpoch.current;
      active.current?.abort();
      if (owner.current) shared.release(owner.current);
    };
  }, []);
  const [action, setAction] = useState<TeamAction | null>(null);
  const currentAction = useRef(action);
  currentAction.current = action;
  const renderedCommand = command.current;
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (owner.current || preparingRef.current) return;
    active.current = controller;
    const read = ++readEpoch.current;
    const fresh = () =>
      alive.current && !controller.signal.aborted && read === readEpoch.current && !owner.current;
    setSignatureStatus(null);
    setVersions([]);
    setNext(null);
    setError(false);
    setHistoryError(false);
    setLoadingMore(false);
    setAcknowledged(false);
    setAction(null);

    const base = `${contractBase(staff)}/${encodeURIComponent(id)}`;
    void Promise.all([
      readContract<ContractDetailData>(base, { signal: controller.signal }),
      readContract<VersionPage>(`${base}/versions`, { signal: controller.signal }),
      selectedVersion
        ? readContract<ContractVersion | ContractDetailData>(
            `${base}/versions/${encodeURIComponent(selectedVersion)}`,
            { signal: controller.signal }
          )
        : Promise.resolve(null),
    ])
      .then(([contract, page, chosen]) => {
        if (!fresh()) return;
        const version = chosen
          ? staff
            ? (chosen as ContractVersion)
            : (chosen as ContractDetailData).version
          : staff
            ? contract.currentVersion
            : contract.version;
        if (!version || !version.content) throw new Error('Missing contract snapshot');
        setData({
          contract: chosen
            ? {
                ...contract,
                history:
                  (staff
                    ? (chosen as ContractVersion).history
                    : (chosen as ContractDetailData).history) ?? [],
                historyTruncated:
                  (staff
                    ? (chosen as ContractVersion).historyTruncated
                    : (chosen as ContractDetailData).historyTruncated) ?? false,
              }
            : contract,
          version,
        });
        setVersions(page.versions);
        setNext(page.nextBefore);
      })
      .catch((failure: unknown) => {
        if (!fresh()) return;
        if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status))
          withdraw();
        else setError(true);
      });
    return () => controller.abort();
  }, [id, staff, selectedVersion, reload, refreshRevision, readContract]);
  useEffect(() => {
    reasonForm.reset({ reason: '' });
  }, [selectedVersion]);
  async function more() {
    const controller = active.current;
    if (blocked() || next === null || !controller || loadingMore) return;
    const read = readEpoch.current;
    const fresh = () =>
      alive.current && !controller.signal.aborted && read === readEpoch.current && !owner.current;
    setLoadingMore(true);
    setHistoryError(false);
    try {
      const page = await readContract<VersionPage>(
        `${contractBase(staff)}/${id}/versions?before=${next}`,
        { signal: controller.signal }
      );
      if (fresh()) {
        setVersions((previous) => [
          ...previous,
          ...page.versions.filter((item) => !previous.some((old) => old.id === item.id)),
        ]);
        setNext(page.nextBefore);
      }
    } catch (failure) {
      if (fresh()) {
        if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status))
          withdraw();
        else setHistoryError(true);
      }
    } finally {
      if (fresh()) setLoadingMore(false);
    }
  }
  function choose(
    command: 'accept' | 'submit' | 'publish' | 'request-changes' | 'amendment-publish'
  ) {
    if (!data || blocked() || command === 'request-changes' || !shared.acquire(parentOwner.current))
      return;
    setAction({
      title: word(command),
      description: `${word(data.contract.serviceType)} · ${word('version')} ${data.version.versionNumber.toLocaleString(locale)}`,
      path:
        command === 'amendment-publish'
          ? `${contractBase(staff)}/${id}/amendments/publish`
          : `${contractBase(staff)}/${id}/${command}`,
      method: 'POST',
      body: {
        expectedVersionId: data.version.id,
        idempotencyKey: crypto.randomUUID(),
      },
      conflictMessage: word('conflict'),
      forbiddenMessage: word('denied'),
    });
  }
  const currentCommand = (captured: ChangeCommand) =>
    alive.current && captured === command.current && captured.generation === epoch.current;
  function closeChanges(captured: ChangeCommand) {
    if (!currentCommand(captured)) return;
    setAction(null);
    if (captured.attempted && (!captured.rejected || captured.uncertain)) {
      captured.uncertain = true;
      setUncertain(true);
    } else {
      command.current = null;
      setUncertain(false);
      shared.release(parentOwner.current);
    }
  }
  function decorateChanges(captured: ChangeCommand): TeamAction {
    const mapped = (value: unknown) => {
      if (!currentCommand(captured)) return word('error');
      const rejection = contractFormRejection(value);
      if (rejection?.code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
        withdraw();
        return word('error');
      }
      if (rejection && !captured.uncertain) {
        captured.rejected = true;
        if (
          rejection.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
          Array.isArray(rejection.fields) &&
          reasonFields(rejection.fields)
        )
          closeChanges(captured);
      }
      return word('error');
    };
    return {
      ...captured.action,
      errorMessages: Object.fromEntries(
        [
          ErrorCodes.VALIDATION_INPUT_INVALID.code,
          'VALIDATION:PARSE:ZOD_ERROR',
          ErrorCodes.CONFLICT_STATE.code,
          ErrorCodes.CONFLICT_VERSION.code,
          ErrorCodes.NOT_FOUND_RESOURCE.code,
        ].map((code) => [code, mapped])
      ),
    };
  }
  async function prepareChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const capturedSource = source.current;
    if (
      event.target !== event.currentTarget ||
      !actor ||
      !staff ||
      !capturedSource ||
      capturedSource.contract.state !== 'AwaitingStaffReview' ||
      blocked() ||
      !shared.acquire(parentOwner.current)
    )
      return;
    const token = epoch.current,
      raw = reasonForm.getValues('reason');
    preparingRef.current = true;
    setPreparing(true);
    try {
      await reasonForm.handleSubmit((values) => {
        if (
          !alive.current ||
          token !== epoch.current ||
          capturedSource !== source.current ||
          raw !== reasonForm.getValues('reason')
        )
          return;
        const captured: ChangeCommand = {
          action: {
            title: word('request-changes'),
            description: `${word(capturedSource.contract.serviceType)} · ${word('version')} ${capturedSource.version.versionNumber.toLocaleString(locale)}`,
            path: `${contractBase(staff)}/${id}/request-changes`,
            method: 'POST',
            successStatus: 200,
            body: {
              expectedVersionId: capturedSource.version.id,
              idempotencyKey: crypto.randomUUID(),
              reason: values.reason.trim(),
            },
            conflictMessage: word('conflict'),
            forbiddenMessage: word('denied'),
          },
          source: capturedSource,
          actor,
          generation: token,
          attempted: false,
          uncertain: false,
          rejected: false,
        };
        command.current = captured;
        setAction(decorateChanges(captured));
      })();
    } finally {
      if (alive.current && token === epoch.current) {
        preparingRef.current = false;
        setPreparing(false);
        if (!command.current) shared.release(parentOwner.current);
      }
    }
  }
  function selectVersion(value: string) {
    if (!blocked()) {
      ++epoch.current;
      setSelectedVersion(value);
      setData(null);
    }
  }
  function closeAction(shownAction: TeamAction, captured: ChangeCommand | null) {
    if (!alive.current || currentAction.current !== shownAction) return;
    if (captured) closeChanges(captured);
    else {
      setAction(null);
      shared.release(parentOwner.current);
    }
  }
  async function completed(
    result: unknown,
    shownAction: TeamAction,
    captured: ChangeCommand | null
  ) {
    if (
      !alive.current ||
      currentAction.current !== shownAction ||
      (captured && !currentCommand(captured))
    )
      return;
    if (captured) {
      if (!currentCommand(captured) || !matchedChangesReceipt(result, captured.source))
        throw new Error('contract receipt');
      command.current = null;
      reasonForm.reset({ reason: '' });
      setUncertain(false);
    }
    setAction(null);
    shared.release(parentOwner.current);
    setReload((value) => value + 1);
    callbacks.current.onChanged();
  }
  function blockSibling(event: SyntheticEvent) {
    if (blocked()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  const currentId = data?.contract.currentVersionId ?? data?.contract.version?.id;
  const isCurrent = data?.version.id === currentId;
  const isPendingAmendment = data
    ? staff
      ? data.contract.pendingAmendment?.versionId === data.version.id
      : ['AwaitingCustomerAcceptance', 'AwaitingSignature'].includes(
          data.contract.amendment?.state ?? ''
        ) && data.contract.version?.id === data.version.id
    : false;
  const pendingState = staff
    ? data?.contract.pendingAmendment?.state
    : data?.contract.amendment?.state;
  const pendingNotice =
    pendingState === 'AwaitingSignature'
      ? 'amendmentSignatureNotice'
      : staff
        ? 'amendmentPublishedNotice'
        : data?.contract.amendment?.signatureRequired
          ? 'amendmentAcceptForSignatureNotice'
          : 'amendmentAcceptNotice';
  const nextAction = data ? customerContractNextAction(data.contract, signatureStatus) : null;
  return (
    <section
      className="flex flex-col gap-5 rounded-xl border bg-card p-5"
      aria-label={word('terms')}
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-xl font-semibold">
          {data ? word(data.contract.serviceType) : word('terms')}
        </h2>
        <Button
          variant="ghost"
          disabled={locked || preparing}
          onClick={() => {
            if (!blocked()) onClose();
          }}
        >
          {word('close')}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
          <Button
            variant="outline"
            disabled={locked || preparing}
            onClick={() => {
              if (!blocked()) setReload((value) => value + 1);
            }}
          >
            {word('refresh')}
          </Button>
        </Alert>
      ) : !data ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {time.notice}
          <p className="text-sm text-muted-foreground">
            {word(data.contract.contractNumber ? 'contractNumber' : 'contractReference')}:{' '}
            <bdi dir="ltr">{data.contract.contractNumber ?? data.contract.id}</bdi>
          </p>
          {data.contract.serviceType === 'electricity' && data.contract.linkedOrderStatus ? (
            <p className="text-sm text-muted-foreground">
              {word('linkedOrderStatus')}:{' '}
              {t(`electricity.order.status.${data.contract.linkedOrderStatus}`, locale)}
            </p>
          ) : null}
          {data.contract.acceptedParty && isCurrent ? (
            <div className="rounded-lg border p-3 text-sm">
              <h3 className="font-semibold">{word('acceptedParty')}</h3>
              <p>
                {data.contract.acceptedParty.name || word('draftUnnamedProfile')} ·{' '}
                {word(
                  data.contract.acceptedParty.profileType === 'LEGAL'
                    ? 'draftLegal'
                    : 'draftIndividual'
                )}
              </p>
              {data.contract.acceptedParty.identifier ? (
                <p>
                  {word(
                    data.contract.acceptedParty.profileType === 'LEGAL'
                      ? 'legalIdentifier'
                      : 'nationalIdentifier'
                  )}
                  : <bdi dir="ltr">{data.contract.acceptedParty.identifier}</bdi>
                </p>
              ) : null}
              {data.contract.acceptedParty.registrationNumber ? (
                <p>
                  {word('registrationNumber')}:{' '}
                  <bdi dir="ltr">{data.contract.acceptedParty.registrationNumber}</bdi>
                </p>
              ) : null}
            </div>
          ) : null}
          {!staff && isCurrent ? (
            <WorkflowStatusBanner
              locale={locale}
              status={word(data.contract.state)}
              happened={
                signatureStatus?.signature
                  ? word('signatureRecorded')
                  : signatureStatus?.request
                    ? `${word('signatureRequest')} ${signatureStatus.request.requestNumber.toLocaleString(locale)}`
                    : data.version.changeDescription
              }
              nextAction={
                nextAction!.key.startsWith('workflow.')
                  ? t(nextAction!.key, locale)
                  : word(nextAction!.key)
              }
              owner={nextAction!.owner}
              actionHref={nextAction!.href}
            />
          ) : (
            <StatusBadge label={word(data.contract.state)} />
          )}
          {staff && data.contract.pendingAmendment ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
              <div>
                <p className="font-medium">{word('amendmentPending')}</p>
                <p className="text-sm text-muted-foreground">
                  {word(
                    data.contract.pendingAmendment.state === 'Draft'
                      ? 'amendmentDraftNotice'
                      : data.contract.pendingAmendment.state === 'AwaitingSignature'
                        ? 'amendmentSigningNotice'
                        : 'amendmentPublishedNotice'
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={locked || preparing}
                onClick={() => selectVersion(data.contract.pendingAmendment!.versionId)}
              >
                {word('amendmentReview')}
              </Button>
            </div>
          ) : null}
          {!staff &&
          ['AwaitingCustomerAcceptance', 'AwaitingSignature'].includes(
            data.contract.amendment?.state ?? ''
          ) ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
              <div>
                <p className="font-medium">
                  {word(
                    data.contract.amendment?.state === 'AwaitingSignature'
                      ? 'amendmentAwaitingSignature'
                      : 'amendmentAwaitingAcceptance'
                  )}
                </p>
                <p className="text-sm text-muted-foreground">{word('amendmentEffectiveNotice')}</p>
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  selectVersion(
                    isPendingAmendment
                      ? data.contract.amendment!.baseVersionId
                      : data.contract.version!.id
                  )
                }
              >
                {word(isPendingAmendment ? 'amendmentViewEffective' : 'amendmentReview')}
              </Button>
            </div>
          ) : null}
          {!staff && data.contract.serviceType === 'electricity' && data.contract.orderId ? (
            <Link
              onClick={(event) => {
                if (blocked()) event.preventDefault();
              }}
              to="/electricity/orders/$orderId"
              params={{ orderId: data.contract.orderId }}
              className="self-start text-sm text-primary underline underline-offset-4"
            >
              {word('openLinkedOrder')}
            </Link>
          ) : null}
          {!staff &&
          isCurrent &&
          data.contract.state === 'Active' &&
          data.contract.serviceType === 'electricity' &&
          data.contract.orderId ? (
            <fieldset
              disabled={blocked()}
              onClickCapture={blockSibling}
              onSubmitCapture={blockSibling}
              className="contents"
            >
              <ContractIncreaseEntry
                key={JSON.stringify([data.contract.id, data.version.id, data.contract.profileId])}
                contractId={data.contract.id}
                versionId={data.version.id}
                profileId={data.contract.profileId}
                formatTimestamp={time.format}
              />
            </fieldset>
          ) : null}
          {staff && data.contract.serviceType === 'electricity' && data.contract.orderId ? (
            <a
              onClick={(event) => {
                if (blocked()) event.preventDefault();
              }}
              href={`/admin/electricity-orders?orderId=${encodeURIComponent(data.contract.orderId)}`}
              className="self-start text-sm text-primary underline underline-offset-4"
            >
              {word('openLinkedOrder')}
            </a>
          ) : null}
          {!staff && data.contract.serviceType === 'savings' && data.contract.savingOrderId ? (
            <Link
              onClick={(event) => {
                if (blocked()) event.preventDefault();
              }}
              to="/savings/orders/$orderId"
              params={{ orderId: data.contract.savingOrderId }}
              className="self-start text-sm text-primary underline underline-offset-4"
            >
              {word('openLinkedSavingOrder')}
            </Link>
          ) : null}
          <div>
            <h3 className="font-semibold">
              {word('version')} {data.version.versionNumber.toLocaleString(locale)}
              {isCurrent ? ` · ${word('current')}` : ''}
              {isPendingAmendment ? ` · ${word('amendmentPending')}` : ''}
            </h3>
            <p className="text-sm text-muted-foreground">{data.version.changeDescription}</p>
            <p className="text-sm">{time.format(data.version.createdAt)}</p>
            {data.version.publishedAt ? (
              <p className="text-sm">
                {word('publishedAt')}: {time.format(data.version.publishedAt)}
              </p>
            ) : null}
            {staff && data.version.createdBy ? (
              <p className="text-sm">
                {word('changedBy')}: {data.version.createdBy}
              </p>
            ) : null}
          </div>
          <ContractTerms value={data.version.content} />
          {staff && isCurrent && ['Draft', 'ChangesRequested'].includes(data.contract.state) ? (
            <ContractDraftEditor
              key={data.version.id}
              existing={data}
              coordination={shared}
              onDenied={withdraw}
              onSaved={() => {
                if (blocked()) return;
                setSelectedVersion(null);
                setReload((value) => value + 1);
                onChanged();
              }}
            />
          ) : null}
          {staff &&
          isCurrent &&
          data.contract.amendmentSupported &&
          !data.contract.pendingAmendment &&
          ['Accepted', 'Signed', 'Active'].includes(data.contract.state) ? (
            <ContractDraftEditor
              key={'amendment:' + data.version.id}
              existing={data}
              coordination={shared}
              onDenied={withdraw}
              amendment
              onSaved={() => {
                if (blocked()) return;
                setReload((value) => value + 1);
                onChanged();
              }}
            />
          ) : null}
          {data.version.acceptedAt ? (
            <p role="status">
              {word('acceptedAt')}: {time.format(data.version.acceptedAt)}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {word(isPendingAmendment ? pendingNotice : 'acceptNotice')}
          </p>
          {!staff &&
          data.contract.canAccept &&
          (data.contract.amendment?.state === 'AwaitingCustomerAcceptance'
            ? isPendingAmendment
            : isCurrent) ? (
            <div id="contract-accept" className="flex flex-col gap-3">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-1 size-4"
                />
                {word('acceptAcknowledgement')}
              </label>
              <Button
                className="self-start"
                disabled={!acknowledged || locked || preparing}
                onClick={() => choose('accept')}
              >
                {word('accept')}
              </Button>
            </div>
          ) : null}
          {staff && isCurrent && data.contract.state === 'Draft' ? (
            <Button
              className="self-start"
              disabled={locked || preparing}
              onClick={() => choose('submit')}
            >
              {word('submit')}
            </Button>
          ) : null}
          {staff && isCurrent && data.contract.state === 'AwaitingStaffReview' ? (
            <div className="flex flex-col gap-3">
              <Form {...reasonForm}>
                <form
                  data-testid="contract-request-changes-form"
                  noValidate
                  onSubmit={(event) => void prepareChanges(event)}
                  className="space-y-3"
                >
                  <FormField
                    control={reasonForm.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem id="contract-change-reason">
                        <FormLabel>{word('reason')}</FormLabel>
                        <FormControl>
                          <Textarea {...field} disabled={!!command.current} />
                        </FormControl>
                        <FormDescription>{copy('reasonHelp')}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {reasonForm.formState.errors.root && (
                    <p role="alert">{copy('validationUnavailable')}</p>
                  )}
                  <Button
                    type="submit"
                    variant="outline"
                    loading={preparing}
                    disabled={locked || preparing}
                  >
                    {word('request-changes')}
                  </Button>
                </form>
              </Form>
              <div className="flex flex-wrap gap-2">
                <Button disabled={locked || preparing} onClick={() => choose('publish')}>
                  {word('publish')}
                </Button>
              </div>
            </div>
          ) : null}
          {staff &&
          isPendingAmendment &&
          data.contract.pendingAmendment?.state === 'Draft' &&
          data.contract.amendmentSupported ? (
            <Button
              className="self-start"
              disabled={locked || preparing}
              onClick={() => choose('amendment-publish')}
            >
              {word('amendment-publish')}
            </Button>
          ) : null}
          <ContractStatusTimeline
            history={data.contract.history ?? []}
            truncated={data.contract.historyTruncated ?? false}
            locale={locale}
            formatTimestamp={time.format}
          />
          <h3 className="font-semibold">{word('versions')}</h3>
          <ol className="flex flex-col gap-2">
            {versions.map((version) => (
              <li key={version.id} className="rounded-lg border p-3">
                <Button
                  variant="link"
                  disabled={locked || preparing}
                  onClick={() => selectVersion(version.id)}
                  aria-pressed={version.id === data.version.id}
                >
                  {word('version')} {version.versionNumber.toLocaleString(locale)}
                </Button>
                <p>{version.changeDescription}</p>
                <p className="text-sm text-muted-foreground">
                  {time.format(version.createdAt)}
                  {staff && version.createdBy
                    ? ` · ${word('changedBy')}: ${version.createdBy}`
                    : ''}
                </p>
                {version.publishedAt ? (
                  <p className="text-sm text-muted-foreground">
                    {word('publishedAt')}: {time.format(version.publishedAt)}
                  </p>
                ) : null}
                {version.acceptedAt ? (
                  <p className="text-sm text-muted-foreground">
                    {word('acceptedAt')}: {time.format(version.acceptedAt)}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          {historyError ? <p role="alert">{word('error')}</p> : null}
          {next !== null ? (
            <Button
              variant="outline"
              disabled={loadingMore || locked || preparing}
              onClick={() => void more()}
            >
              {word('next')}
            </Button>
          ) : null}
          <fieldset
            disabled={locked || preparing}
            onClickCapture={blockSibling}
            onSubmitCapture={blockSibling}
            className="contents"
          >
            {isCurrent ? (
              <ContractCancellationPanel
                key={'cancellation:' + id + ':' + reload}
                id={id}
                versionId={data.version.id}
                staff={staff}
                onChanged={() => {
                  if (blocked()) return;
                  setReload((value) => value + 1);
                  onChanged();
                }}
              />
            ) : null}
          </fieldset>
          {!isPendingAmendment ? (
            <ContractActivationPanel
              key={'activation:' + data.version.id}
              refreshRevision={reload + (refreshRevision ?? 0)}
              source={data.contract}
              coordination={shared}
              onDenied={withdraw}
              id={id}
              versionId={data.version.id}
              staff={staff}
              editableVersion={staff && isCurrent ? data.version : undefined}
              onChanged={() => {
                if (blocked()) return;
                setSelectedVersion(null);
                setReload((value) => value + 1);
                onChanged();
              }}
            />
          ) : null}
          {!isPendingAmendment || pendingState === 'AwaitingSignature' ? (
            <ContractSignaturePanel
              key={'signature:' + data.version.id}
              id={id}
              versionId={data.version.id}
              profileId={data.contract.profileId}
              staff={staff}
              source={data}
              coordination={shared}
              onDenied={withdraw}
              onStatus={setSignatureStatus}
              onChanged={() => {
                if (blocked()) return;
                setReload((value) => value + 1);
                onChanged();
              }}
            />
          ) : null}
          <ContractDocuments
            key={data.version.id + ':' + reload}
            contract={data.contract}
            version={data.version}
            staff={staff}
            isCurrent={isCurrent}
            isPendingAmendment={isPendingAmendment}
            coordination={shared}
            blocked={locked || preparing}
          />
        </>
      )}
      {uncertain && (
        <Alert variant="destructive">
          <AlertDescription>{copy('uncertain')}</AlertDescription>
        </Alert>
      )}
      {uncertain && (
        <Button
          data-testid="contract-review-retry"
          variant="outline"
          disabled={!!action}
          onClick={() => {
            const captured = command.current;
            if (captured && currentCommand(captured)) setAction(decorateChanges(captured));
          }}
        >
          {copy('retryCaptured')}
        </Button>
      )}
      {action && action.path.endsWith('/accept') && data ? (
        <ContractFinancialReviewDialog
          action={action}
          profileId={data.contract.profileId}
          contractId={id}
          time={time}
          onClose={() => closeAction(action, renderedCommand)}
          onSuccess={(result) => completed(result, action, renderedCommand)}
        />
      ) : action ? (
        <TeamActionDialog
          action={action}
          onDenied={() => {
            if (
              alive.current &&
              currentAction.current === action &&
              (!renderedCommand || currentCommand(renderedCommand))
            )
              withdraw();
          }}
          onPendingChange={(pending) => {
            if (pending && renderedCommand && currentCommand(renderedCommand))
              renderedCommand.attempted = true;
          }}
          onUnconfirmed={() => {
            if (renderedCommand && currentCommand(renderedCommand)) {
              renderedCommand.uncertain = true;
              setUncertain(true);
              setAction(null);
            }
          }}
          onClose={() => closeAction(action, renderedCommand)}
          onSuccess={(result) => completed(result, action, renderedCommand)}
        />
      ) : null}
    </section>
  );
}
function ContractDocuments({
  contract,
  version,
  staff,
  isCurrent,
  isPendingAmendment,
  coordination,
  blocked,
}: {
  contract: ContractDetailData;
  version: ContractVersion;
  staff: boolean;
  isCurrent: boolean;
  isPendingAmendment: boolean;
  coordination: ContractFormCoordination;
  blocked: boolean;
}) {
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const [role, setRole] = useState<ContractDocumentAssociation['contractRole'] | null>(null);
  const [reload, setReload] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState(false);
  const [generated, setGenerated] = useState<'scanning' | 'created' | null>(null);
  const uploadOwner = useRef<object>({});
  useEffect(() => () => coordination.release(uploadOwner.current), [coordination]);
  const filters = useMemo<DocumentFilters>(
    () => ({
      kind: 'contract',
      state: '',
      category: '',
      query: '',
      profileId: contract.profileId,
      businessRecordId: contract.id,
      contractVersionId: version.id,
    }),
    [contract.profileId, contract.id, version.id]
  );
  const canUpload =
    (isPendingAmendment &&
      (staff ? contract.pendingAmendment?.state : contract.amendment?.state) ===
        'AwaitingSignature') ||
    (staff && isPendingAmendment && contract.pendingAmendment?.state !== 'AwaitingSignature') ||
    (isCurrent &&
      (staff
        ? !['Signed', 'Active', 'Completed', 'Cancelled'].includes(contract.state)
        : ['Accepted', 'AwaitingSignature'].includes(contract.state)));
  const template = version.content?.template;
  const hasSavedTemplate =
    template !== null &&
    typeof template === 'object' &&
    !Array.isArray(template) &&
    typeof (template as Record<string, unknown>).name === 'string' &&
    typeof (template as Record<string, unknown>).text === 'string' &&
    Boolean(((template as Record<string, unknown>).text as string).trim());
  const hasSystemOriginal =
    contract.serviceType === 'electricity' &&
    Boolean(contract.orderId) &&
    version.content?.orderId === contract.orderId &&
    !isPendingAmendment &&
    hasSavedTemplate;
  const canGenerate =
    staff &&
    canUpload &&
    contract.serviceType === 'electricity' &&
    (!contract.orderId || isPendingAmendment) &&
    hasSavedTemplate;
  async function generatePdf() {
    if (
      coordination.blocked() ||
      generating ||
      generated ||
      !coordination.acquire(uploadOwner.current)
    )
      return;
    setGenerating(true);
    setGenerationError(false);
    try {
      const result = await documentRequest(
        `${contractBase(true)}/${encodeURIComponent(contract.id)}/versions/${encodeURIComponent(version.id)}/generate-pdf`,
        { method: 'POST', body: JSON.stringify({ idempotencyKey: version.id }) }
      );
      const state =
        result && typeof result === 'object' && 'state' in result ? result.state : undefined;
      if (
        typeof state !== 'string' ||
        !['PendingScan', 'Available', 'SubmittedForReview', 'Approved'].includes(state)
      )
        throw new Error('Unexpected generated document state');
      setGenerated(state === 'PendingScan' ? 'scanning' : 'created');
      setReload((value) => value + 1);
    } catch {
      setGenerationError(true);
    } finally {
      setGenerating(false);
      coordination.release(uploadOwner.current);
    }
  }
  function blockDocumentList(event: SyntheticEvent) {
    if (coordination.blocked()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  return (
    <section className="flex flex-col gap-4" aria-label={word('documents')}>
      <fieldset disabled={blocked && !role && !generating} className="contents">
        <h3 className="font-semibold">{word('documents')}</h3>
        <p className="text-sm text-muted-foreground">{word('copyNotice')}</p>
        {staff ? (
          <p className="text-sm text-muted-foreground">{word('replaceOriginalHint')}</p>
        ) : null}
        {canGenerate ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={generating || Boolean(generated) || blocked}
              onClick={() => void generatePdf()}
            >
              {word(generating ? 'generatingContractPdf' : 'generateContractPdf')}
            </Button>
            {generated ? (
              <p role="status" className="text-sm">
                {word(generated === 'scanning' ? 'contractPdfScanning' : 'contractPdfSubmitted')}
              </p>
            ) : null}
            {generationError ? (
              <p role="alert" className="text-sm text-destructive">
                {word('contractPdfError')}
              </p>
            ) : null}
          </div>
        ) : null}
        {canUpload && !role ? (
          <div className="flex flex-wrap gap-2">
            {(isPendingAmendment
              ? (staff ? contract.pendingAmendment?.state : contract.amendment?.state) ===
                'AwaitingSignature'
                ? staff
                  ? (['amendment', 'signed'] as const)
                  : (['signed'] as const)
                : (['amendment'] as const)
              : staff
                ? hasSystemOriginal
                  ? (['signed', 'amendment'] as const)
                  : (['original', 'signed', 'amendment'] as const)
                : (['signed'] as const)
            ).map((value) => (
              <Button
                key={value}
                variant="outline"
                disabled={blocked}
                onClick={() => {
                  if (!coordination.blocked() && coordination.acquire(uploadOwner.current))
                    setRole(value);
                }}
              >
                {word(
                  value === 'original'
                    ? 'uploadOriginal'
                    : value === 'signed'
                      ? 'uploadSigned'
                      : 'uploadAmendment'
                )}
              </Button>
            ))}
          </div>
        ) : null}
        {role ? (
          <DocumentUpload
            staff={staff}
            profileId={contract.profileId}
            replacement={null}
            association={{
              businessRecordType: 'contract',
              businessRecordId: contract.id,
              contractVersionId: version.id,
              contractRole: role,
            }}
            onClose={() => {
              setRole(null);
              coordination.release(uploadOwner.current);
            }}
            onUploaded={() => {
              setRole(null);
              coordination.release(uploadOwner.current);
              setReload((value) => value + 1);
            }}
          />
        ) : null}
        <fieldset
          disabled={blocked}
          onClickCapture={blockDocumentList}
          onSubmitCapture={blockDocumentList}
          className="contents"
        >
          <DocumentResults
            key={reload}
            staff={staff}
            filters={filters}
            profileId={contract.profileId}
          />
        </fieldset>
      </fieldset>
    </section>
  );
}
