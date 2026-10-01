import { t as adminText } from '@barghsa/i18n/admin-ui';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
import type { Locale } from '@barghsa/i18n/app';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  BANK_RECEIPT_REJECT_REASON_MAX_LENGTH,
  APPROVAL_REVIEW_REASON_MAX_LENGTH,
  parseBankReceiptRejectReason,
  parseBankReceiptConfirmationReview,
  type BankReceiptConfirmationReview,
  type WalletBankReceiptTimeline,
} from '@barghsa/shared/finance';
import { WalletReceiptTimeline } from '../components/WalletReceiptTimeline.js';
import { BankReceiptFinancialReview } from '../components/BankReceiptFinancialReview.js';
import { Button, ListPage, ListViewToggle, ScrollArea } from '@barghsa/ui';
import { t as appText } from '@barghsa/i18n/app';
import { useListView } from '../hooks/useListView.js';
import { StaffWalletReceiptList } from '../components/StaffWalletReceiptList.js';
import { StaffReceiptAttachmentPreview } from '../components/StaffReceiptAttachmentPreview.js';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { isTransactionUuid } from '../lib/bank-receipt-confirmation.js';
import WalletTopUpLimitConfigPanel from '../components/WalletTopUpLimitConfigPanel.js';

/**
 * Staff bank-receipt confirmation queue (T-04.2.02.04 / T-04.2.02.05).
 *
 * Finance staff review a Pending wallet top-up receipt, then confirm
 * or reject with a customer-visible reason. Confirm without an invoice
 * credits the full amount via WalletService.credit() and notifies the
 * customer. Confirm with an invoice settles min(receipt, remaining) and
 * credits only the excess to the wallet. Reject never increases balance
 * and sends the reason to the customer. Confirm and reject require
 * step-up authentication.
 */

interface StaffDecision {
  decision: 'confirmed' | 'rejected';
  actorUserId: string;
  decidedAt: string;
  reason: string | null;
  customerVisible: boolean;
  creditTransactionId: string | null;
}

interface BankReceiptReviewDto {
  canEmergencyOverride?: boolean;
  transactionId: string;
  walletId: string;
  amount: string;
  currency: 'IRR';
  dualApproval?: { requestId: string; initiatorId: string; invoiceId: string | null } | null;
  state: string;
  paymentDate: string | null;
  payerReference: string | null;
  bankName?: string | null;
  attachmentKey: string | null;
  attachmentUrl: string | null;
  customerNote: string | null;
  submittedAt: string;
  verificationTimeline?: WalletBankReceiptTimeline;
  canDecide: boolean;
  staffDecision: StaffDecision | null;
  creditTransactionId: string | null;
  overpayment: OverpaymentSnapshot | null;
}

interface OverpaymentSnapshot {
  invoiceId: string;
  remainingBefore: string;
  invoiceAllocation: string;
  walletCreditAmount: string;
  overpaymentCreditTransactionId: string | null;
}

interface AllocationPreview {
  transactionId: string;
  invoiceId: string;
  invoiceState: string;
  receiptAmount: string;
  remaining: string;
  invoiceAllocation: string;
  walletCreditAmount: string;
  isOverpayment: boolean;
}

type PendingAction = { transactionId: string; generation: number } & (
  | {
      kind: 'confirm';
      invoiceId: string | null;
      review: BankReceiptConfirmationReview;
      emergencyOverrideReason?: string;
    }
  | { kind: 'reject'; reason: string }
);

function readErrorCode(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as { error?: unknown; requiresStepUp?: unknown };
  if (typeof rec.error === 'string') return rec.error;
  if (rec.error && typeof rec.error === 'object') {
    const nested = rec.error as { code?: unknown };
    if (typeof nested.code === 'string') return nested.code;
  }
  if (rec.requiresStepUp === true) return ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code;
  return null;
}

function errorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const rec = data as { message?: unknown; error?: unknown };
  if (typeof rec.message === 'string' && rec.message) return rec.message;
  if (rec.error && typeof rec.error === 'object') {
    const nested = rec.error as { message?: unknown };
    if (typeof nested.message === 'string' && nested.message) return nested.message;
  }
  if (typeof rec.error === 'string' && rec.error) return rec.error;
  return fallback;
}

function isStepUpRequired(res: Response, data: unknown): boolean {
  return res.status === 403 && readErrorCode(data) === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code;
}

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    return errorMessage(await res.json(), fallback);
  } catch {
    return fallback;
  }
}

async function verifyStepUp(password: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/step-up', {
      method: 'POST',
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getTabbable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter((el) => {
    if (el.tabIndex < 0) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  });
}

function inertOutside(keep: HTMLElement): () => void {
  const applied: HTMLElement[] = [];
  let current: HTMLElement | null = keep;
  while (current && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === current || !(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      applied.push(sibling);
    }
    current = parent;
  }
  return () => {
    for (const el of applied) el.removeAttribute('inert');
  };
}

function formatPaymentDate(value: string | null, locale: Locale): string {
  if (!value) return t('admin.walletReceipts.none', locale);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parts = value.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fa-IR', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(d);
  }
  return t('admin.walletReceipts.none', locale);
}

export default function AdminWalletReceiptsPage() {
  const time = useAccountTime();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const isRtl = locale === 'fa';
  const { view, setView } = useListView('staff-wallet-receipts-pending');
  const [items, setItems] = useState<BankReceiptReviewDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<BankReceiptReviewDto | null>(null);
  const [reason, setReason] = useState('');
  const [emergencyReason, setEmergencyReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clientIssue, setClientIssue] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState('');
  const [allocation, setAllocation] = useState<AllocationPreview | null>(null);
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [financialReview, setFinancialReview] = useState<BankReceiptConfirmationReview | null>(
    null
  );
  const reviewReady =
    financialReview !== null &&
    selected !== null &&
    financialReview.scope.resourceId === selected.transactionId &&
    financialReview.scope.profileId === selected.walletId &&
    financialReview.data.receipt.amount === selected.amount &&
    (financialReview.data.receipt.bankName ?? null) === (selected.bankName ?? null) &&
    (financialReview.data.invoice?.invoice.id ?? '') === invoiceId.trim() &&
    !allocationLoading &&
    !allocationError &&
    time.status === 'ready';

  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [stepUpSubmitting, setStepUpSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [reasonInvalid, setReasonInvalid] = useState(false);
  const stepUpDialogRef = useRef<HTMLDivElement | null>(null);
  const stepUpPasswordRef = useRef<HTMLInputElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const emergencyButtonRef = useRef<HTMLButtonElement | null>(null);
  const rejectButtonRef = useRef<HTMLButtonElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const stepUpTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreTriggerRef = useRef(false);

  const queueController = useRef<AbortController | null>(null);
  const workGeneration = useRef(0);
  const accessDenied = useRef(false);
  const accessGeneration = useRef(0);
  const rowsRef = useRef<BankReceiptReviewDto[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const selectedRef = useRef<BankReceiptReviewDto | null>(null);
  const financialReviewRef = useRef<BankReceiptConfirmationReview | null>(null);
  const reviewScopeRef = useRef('');
  function invalidateDecision() {
    ++workGeneration.current;
    setStepUpOpen(false);
    setPendingAction(null);
    setStepUpPassword('');
    setStepUpError(null);
    setStepUpSubmitting(false);
    setActing(false);
    financialReviewRef.current = null;
    setFinancialReview(null);
  }
  function selectReceipt(id: string | null) {
    invalidateDecision();
    selectedIdRef.current = id;
    const row = rowsRef.current.find((item) => item.transactionId === id) ?? null;
    selectedRef.current = row;
    setSelected(row);
    setSelectedId(id);
    setReason('');
    setEmergencyReason('');
    setInvoiceId(row?.dualApproval?.invoiceId ?? '');
    setAllocation(null);
    setAllocationError(null);
    setClientIssue(null);
    setReasonInvalid(false);
    setDetailError(false);
    setStatus(null);
  }
  function denyAccess() {
    ++accessGeneration.current;
    setLoading(false);
    accessDenied.current = true;
    setDenied(true);
    rowsRef.current = [];
    setItems([]);
    selectReceipt(null);
  }
  useEffect(
    () => () => {
      ++workGeneration.current;
      queueController.current?.abort();
    },
    []
  );
  const loadQueue = useCallback(async () => {
    queueController.current?.abort();
    const controller = new AbortController();
    queueController.current = controller;
    const accessOwner = accessGeneration.current;
    setQueueError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/wallet/bank-receipt-top-ups', {
        signal: controller.signal,
      });
      if (controller.signal.aborted || accessOwner !== accessGeneration.current) return;
      if ([401, 403].includes(res.status)) {
        denyAccess();
        return;
      }
      if (!res.ok)
        throw new Error(await parseError(res, t('admin.walletReceipts.error.load', locale)));
      const data = (await res.json()) as { items?: BankReceiptReviewDto[] };
      if (!Array.isArray(data.items)) throw new Error(t('admin.walletReceipts.error.load', locale));
      if (controller.signal.aborted || accessOwner !== accessGeneration.current) return;
      const next = data.items;
      const current = selectedIdRef.current;
      const previous = rowsRef.current.find((row) => row.transactionId === current);
      const fresh = next.find((row) => row.transactionId === current);
      accessDenied.current = false;
      setDenied(false);
      rowsRef.current = next;
      setItems(next);
      if (!current || !fresh) selectReceipt(next[0]?.transactionId ?? null);
      else if (JSON.stringify(previous) !== JSON.stringify(fresh)) {
        invalidateDecision();
        setDetailLoading(true);
        setDetailRevision((v) => v + 1);
      }
    } catch (err) {
      if (!controller.signal.aborted && accessOwner === accessGeneration.current)
        setQueueError(
          err instanceof Error ? err.message : t('admin.walletReceipts.error.load', locale)
        );
    } finally {
      if (!controller.signal.aborted && accessOwner === accessGeneration.current) setLoading(false);
    }
  }, [locale]);
  useEffect(() => {
    void loadQueue();
    return () => queueController.current?.abort();
  }, [loadQueue]);
  useEffect(() => {
    if (!selectedId) {
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(false);
    void (async () => {
      try {
        const res = await fetch(`/api/admin/wallet/bank-receipt-top-ups/${selectedId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || selectedIdRef.current !== selectedId) return;
        if ([401, 403].includes(res.status)) {
          denyAccess();
          return;
        }
        if (!res.ok) throw new Error('Receipt unavailable');
        const data = (await res.json()) as BankReceiptReviewDto;
        if (
          !data ||
          data.transactionId !== selectedId ||
          typeof data.amount !== 'string' ||
          typeof data.canDecide !== 'boolean'
        )
          throw new Error('Invalid receipt');
        if (
          controller.signal.aborted ||
          accessDenied.current ||
          selectedIdRef.current !== selectedId
        )
          return;
        if (JSON.stringify(data) !== JSON.stringify(selectedRef.current)) {
          invalidateDecision();
          selectedRef.current = data;
          setSelected(data);
          if (data.dualApproval) setInvoiceId(data.dualApproval.invoiceId ?? '');
        }
      } catch {
        if (!controller.signal.aborted) setDetailError(true);
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selectedId, detailRevision]);

  useEffect(() => {
    const trimmed = invoiceId.trim();
    const scope = JSON.stringify([
      selected?.transactionId,
      selected?.walletId,
      selected?.amount,
      trimmed,
    ]);
    if (reviewScopeRef.current !== scope) {
      reviewScopeRef.current = scope;
      invalidateDecision();
      setAllocation(null);
    }
    if (!selected || !selected.canDecide) {
      setAllocation(null);
      setAllocationError(null);
      setAllocationLoading(false);
      return;
    }
    if (trimmed && !isTransactionUuid(trimmed)) {
      setAllocation(null);
      setAllocationError(t('admin.walletReceipts.error.invoiceId', locale));
      setAllocationLoading(false);
      return;
    }
    let cancelled = false;
    const owner = workGeneration.current;
    setAllocationError(null);
    setAllocationLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/wallet/bank-receipt-top-ups/${selected.transactionId}/review${trimmed ? `?invoiceId=${encodeURIComponent(trimmed)}` : ''}`
        );
        const data: unknown = await res.json().catch(() => null);
        if (cancelled || owner !== workGeneration.current || accessDenied.current) return;
        if ([401, 403].includes(res.status)) {
          denyAccess();
          return;
        }
        if (!res.ok) {
          setAllocationError(
            errorMessage(data, t('admin.walletReceipts.error.allocation', locale))
          );
          return;
        }
        const review = parseBankReceiptConfirmationReview(data);
        if (
          !review ||
          review.scope.resourceId !== selected.transactionId ||
          review.scope.profileId !== selected.walletId ||
          review.data.receipt.amount !== selected.amount ||
          (review.data.receipt.bankName ?? null) !== (selected.bankName ?? null) ||
          (review.data.invoice?.invoice.id ?? '') !== trimmed
        )
          throw new Error('Invalid receipt review');
        if (financialReviewRef.current && financialReviewRef.current.hash !== review.hash)
          invalidateDecision();
        financialReviewRef.current = review;
        setFinancialReview(review);
        setAllocationLoading(false);
        setAllocation(
          review.data.invoice
            ? {
                transactionId: selected.transactionId,
                invoiceId: trimmed,
                invoiceState: review.data.invoice.invoice.state,
                receiptAmount: review.data.receipt.amount,
                remaining: review.data.invoice.invoice.remainingAmount,
                invoiceAllocation: review.data.allocation.invoiceAmount,
                walletCreditAmount: review.data.allocation.walletCredit,
                isOverpayment: BigInt(review.data.allocation.walletCredit) > 0n,
              }
            : null
        );
      } catch {
        if (!cancelled && owner === workGeneration.current) {
          setAllocationError(t('admin.walletReceipts.review.error', locale));
        }
      } finally {
        if (!cancelled && owner === workGeneration.current) setAllocationLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, selected, locale, reviewRevision]);

  useEffect(() => {
    if (!stepUpOpen) return;
    const dialog = stepUpDialogRef.current;
    if (!dialog) return;
    const restore = inertOutside(dialog);
    stepUpPasswordRef.current?.focus();
    return restore;
  }, [stepUpOpen]);

  useEffect(() => {
    if (stepUpOpen || !restoreTriggerRef.current) return;
    restoreTriggerRef.current = false;
    const trigger = stepUpTriggerRef.current;
    stepUpTriggerRef.current = null;
    if (trigger && document.body.contains(trigger) && !trigger.disabled) {
      trigger.focus();
      return;
    }
    statusRef.current?.focus();
  }, [stepUpOpen, selectedId, status]);

  async function postDecision(
    action: PendingAction
  ): Promise<'step_up' | 'ok' | 'error' | 'obsolete'> {
    const path =
      action.kind === 'confirm'
        ? `/api/admin/wallet/bank-receipt-top-ups/${action.transactionId}/confirm`
        : `/api/admin/wallet/bank-receipt-top-ups/${action.transactionId}/reject`;
    const res = await fetch(path, {
      method: 'POST',
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      body:
        action.kind === 'reject'
          ? JSON.stringify({ reason: action.reason })
          : JSON.stringify({
              expectedReviewHash: action.review.hash,
              ...(action.invoiceId ? { invoiceId: action.invoiceId } : {}),
              ...(action.emergencyOverrideReason !== undefined
                ? { emergencyOverrideReason: action.emergencyOverrideReason }
                : {}),
            }),
    });
    const data: unknown = await res.json().catch(() => null);
    if (action.generation !== workGeneration.current || accessDenied.current) return 'obsolete';
    if (isStepUpRequired(res, data)) return 'step_up';
    if (!res.ok) {
      if (res.status === 409 && action.kind === 'confirm') {
        financialReviewRef.current = null;
        setFinancialReview(null);
      }
      setError(
        res.status === 409 && action.kind === 'confirm'
          ? t('admin.walletReceipts.review.changed', locale)
          : errorMessage(data, t('admin.walletReceipts.error.save', locale))
      );
      return 'error';
    }
    const dto = data as BankReceiptReviewDto;
    if (
      !dto ||
      dto.transactionId !== action.transactionId ||
      typeof dto.state !== 'string' ||
      typeof dto.canDecide !== 'boolean' ||
      (action.kind === 'confirm' &&
        (data as { reviewHash?: unknown }).reviewHash !== action.review.hash)
    )
      throw new Error('Unconfirmed receipt response');
    if (dto.state === 'Pending' && dto.dualApproval) {
      setStatus(t('admin.walletReceipts.approvalPending', locale));
      invalidateDecision();
      selectedRef.current = dto;
      setSelected(dto);
      rowsRef.current = rowsRef.current.map((row) =>
        row.transactionId === dto.transactionId ? dto : row
      );
      setItems(rowsRef.current);
      setInvoiceId(dto.dualApproval.invoiceId ?? '');
      return 'ok';
    }
    const overpay = dto.overpayment && BigInt(dto.overpayment.walletCreditAmount) > 0n;
    const message =
      action.kind === 'confirm'
        ? action.emergencyOverrideReason !== undefined
          ? t('admin.walletReceipts.emergencyConfirmed', locale)
          : overpay
            ? t('admin.walletReceipts.overpaymentConfirmed', locale)
            : t('admin.walletReceipts.confirmed', locale)
        : t('admin.walletReceipts.rejected', locale);
    rowsRef.current = rowsRef.current.filter((row) => row.transactionId !== dto.transactionId);
    setItems(rowsRef.current);
    selectReceipt(rowsRef.current[0]?.transactionId ?? null);
    setStatus(message);
    return 'ok';
  }

  async function runAction(action: PendingAction) {
    setActing(true);
    setError(null);
    setStatus(null);
    try {
      const outcome = await postDecision(action);
      if (action.generation !== workGeneration.current || accessDenied.current) return;
      if (outcome === 'step_up') {
        restoreTriggerRef.current = true;
        stepUpTriggerRef.current =
          action.kind === 'confirm'
            ? action.emergencyOverrideReason !== undefined
              ? emergencyButtonRef.current
              : confirmButtonRef.current
            : rejectButtonRef.current;
        setPendingAction(action);
        setStepUpPassword('');
        setStepUpError(null);
        setStepUpOpen(true);
      }
    } catch {
      if (action.generation === workGeneration.current)
        setError(t('admin.walletReceipts.error.save', locale));
    } finally {
      if (action.generation === workGeneration.current) setActing(false);
    }
  }

  function handleConfirm(emergencyOverrideReason?: string) {
    if (
      !selected ||
      acting ||
      stepUpOpen ||
      loading ||
      queueError ||
      detailLoading ||
      detailError ||
      accessDenied.current ||
      !reviewReady ||
      !financialReview
    )
      return;
    if (
      emergencyOverrideReason !== undefined &&
      (!selected.canEmergencyOverride ||
        !selected.dualApproval ||
        !emergencyOverrideReason.trim() ||
        emergencyOverrideReason.trim().length > APPROVAL_REVIEW_REASON_MAX_LENGTH)
    )
      return;
    const trimmed = invoiceId.trim();
    if (trimmed && !isTransactionUuid(trimmed)) {
      setReasonInvalid(false);
      setClientIssue(t('admin.walletReceipts.error.invoiceId', locale));
      return;
    }
    if (
      trimmed &&
      isTransactionUuid(trimmed) &&
      (allocationLoading || allocationError || !allocation)
    ) {
      setReasonInvalid(false);
      setClientIssue(allocationError ?? t('admin.walletReceipts.error.allocationPending', locale));
      return;
    }
    setReasonInvalid(false);
    setClientIssue(null);
    void runAction({
      transactionId: selected.transactionId,
      generation: workGeneration.current,
      kind: 'confirm',
      review: financialReview,
      invoiceId: isTransactionUuid(trimmed) ? trimmed : null,
      ...(emergencyOverrideReason !== undefined
        ? { emergencyOverrideReason: emergencyOverrideReason.trim() }
        : {}),
    });
  }

  function handleReject(e: FormEvent) {
    e.preventDefault();
    if (
      !selected ||
      acting ||
      stepUpOpen ||
      loading ||
      queueError ||
      allocationLoading ||
      detailLoading ||
      detailError ||
      accessDenied.current
    )
      return;
    const parsed = parseBankReceiptRejectReason({ reason });
    if (!parsed.ok) {
      setReasonInvalid(true);
      setClientIssue(t('admin.walletReceipts.error.reason', locale));
      return;
    }
    setReasonInvalid(false);
    setClientIssue(null);
    void runAction({
      transactionId: selected.transactionId,
      generation: workGeneration.current,
      kind: 'reject',
      reason: parsed.reason,
    });
  }

  function cancelStepUp() {
    if (stepUpSubmitting) return;
    setStepUpOpen(false);
    setPendingAction(null);
    setStepUpPassword('');
    setStepUpError(null);
  }

  async function submitStepUp(e?: FormEvent) {
    e?.preventDefault();
    if (!stepUpPassword.trim() || stepUpSubmitting || !pendingAction) return;
    if (pendingAction.kind === 'confirm' && time.status !== 'ready') return;
    const currentAction = pendingAction;
    setStepUpSubmitting(true);
    setStepUpError(null);
    try {
      const verified = await verifyStepUp(stepUpPassword);
      if (currentAction.generation !== workGeneration.current || accessDenied.current) return;
      if (!verified) {
        setStepUpError(t('admin.walletReceipts.stepUp.failed', locale));
        return;
      }
      const outcome = await postDecision(currentAction);
      if (currentAction.generation !== workGeneration.current || accessDenied.current) return;
      if (outcome === 'step_up') {
        setStepUpError(t('admin.walletReceipts.stepUp.failed', locale));
        return;
      }
      if (outcome === 'ok' || outcome === 'error') {
        setStepUpOpen(false);
        setPendingAction(null);
        setStepUpPassword('');
      }
    } catch {
      if (currentAction.generation === workGeneration.current)
        setStepUpError(t('admin.walletReceipts.stepUp.failed', locale));
    } finally {
      if (currentAction.generation === workGeneration.current) setStepUpSubmitting(false);
    }
  }

  function onStepUpKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelStepUp();
      return;
    }
    if (event.key !== 'Tab' || !stepUpDialogRef.current) return;
    const tabbable = getTabbable(stepUpDialogRef.current);
    if (tabbable.length === 0) return;
    const first = tabbable[0]!;
    const last = tabbable[tabbable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="max-w-5xl space-y-6"
      dir={isRtl ? 'rtl' : 'ltr'}
      data-testid="admin-wallet-receipts-page"
    >
      {time.notice}
      <header>
        <h1 className="text-2xl font-bold">{t('admin.walletReceipts.title', locale)}</h1>
        <p className="text-muted-foreground mt-2">
          {t('admin.walletReceipts.description', locale)}
        </p>
      </header>

      <WalletTopUpLimitConfigPanel />

      {error && (
        <div
          className="bg-danger-soft border border-destructive/20 text-destructive px-4 py-3 rounded"
          role="alert"
        >
          {error}
        </div>
      )}

      {status && (
        <p ref={statusRef} className="text-sm text-success" role="status" tabIndex={-1}>
          {status}
        </p>
      )}

      <ListPage>
        <ListPage.Toolbar>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">{t('admin.walletReceipts.queueLabel', locale)}</h2>
            <ListViewToggle
              value={view}
              onChange={setView}
              labels={{
                group: appText('historyView.group', locale),
                table: appText('historyView.table', locale),
                card: appText('historyView.card', locale),
              }}
            />
            <Button
              variant="outline"
              disabled={loading || acting || stepUpOpen}
              onClick={() => void loadQueue()}
            >
              {t('admin.walletReceipts.queue.refresh', locale)}
            </Button>
          </div>
        </ListPage.Toolbar>
        <div
          className={`grid min-w-0 gap-6 ${view === 'card' ? 'lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]' : ''}`}
        >
          <ListPage.Content
            loading={loading}
            error={!!queueError || denied}
            empty={!items.length}
            retainContent={!!items.length && !denied}
            loadingView={<p role="status">{t('admin.walletReceipts.loading', locale)}</p>}
            errorView={
              <div role="alert" className="space-y-2">
                <p>{denied ? t('admin.walletReceipts.queue.forbidden', locale) : queueError}</p>
                {!denied && (
                  <Button variant="outline" onClick={() => void loadQueue()}>
                    {t('admin.walletReceipts.queue.retry', locale)}
                  </Button>
                )}
              </div>
            }
            emptyView={<p role="status">{t('admin.walletReceipts.empty', locale)}</p>}
          >
            <nav
              aria-label={t('admin.walletReceipts.queueLabel', locale)}
              className="bg-card text-card-foreground rounded-lg border border-border p-3 space-y-1"
            >
              <StaffWalletReceiptList
                items={items}
                view={view}
                selectedId={selectedId}
                disabled={acting || stepUpOpen}
                onSelect={(id) => {
                  if (id !== selectedIdRef.current) selectReceipt(id);
                }}
              />
            </nav>
          </ListPage.Content>

          {selected && (
            <section
              aria-labelledby="receipt-review-heading"
              className="min-w-0 bg-card text-card-foreground rounded-lg border border-border p-6 space-y-4"
            >
              <h2 id="receipt-review-heading" className="text-lg font-semibold">
                {t('admin.walletReceipts.reviewTitle', locale)}
              </h2>

              {detailLoading && (
                <p role="status">{t('admin.walletReceipts.detail.loading', locale)}</p>
              )}
              {detailError && (
                <div role="alert" className="space-y-2">
                  <p>{t('admin.walletReceipts.detail.error', locale)}</p>
                  <Button variant="outline" onClick={() => setDetailRevision((v) => v + 1)}>
                    {t('admin.walletReceipts.detail.retry', locale)}
                  </Button>
                </div>
              )}
              {selected.dualApproval && selected.state === 'Pending' && (
                <p
                  className="rounded border border-warning/20 bg-warning-soft p-3 text-sm text-amber-950"
                  role="status"
                >
                  {t('admin.walletReceipts.approvalPending', locale)}
                </p>
              )}
              <dl className="grid grid-cols-1 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">
                    {t('admin.walletReceipts.amount', locale)}
                  </dt>
                  <dd className="font-medium">
                    {numbers.irrDigits(selected.amount)} {selected.currency}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t('admin.walletReceipts.paymentDate', locale)}
                  </dt>
                  <dd>{formatPaymentDate(selected.paymentDate, locale)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t('admin.walletReceipts.payerReference', locale)}
                  </dt>
                  <dd className="font-mono text-sm" dir="ltr">
                    {selected.payerReference ?? t('admin.walletReceipts.none', locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {adminText('admin.invoiceReceipts.bankName', locale)}
                  </dt>
                  <dd className="break-words">
                    {selected.bankName ?? t('admin.walletReceipts.none', locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t('admin.walletReceipts.walletId', locale)}
                  </dt>
                  <dd className="font-mono text-sm" dir="ltr">
                    {selected.walletId}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t('admin.walletReceipts.submittedAt', locale)}
                  </dt>
                  <dd>{time.format(selected.submittedAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t('admin.walletReceipts.note', locale)}
                  </dt>
                  <dd>{selected.customerNote ?? t('admin.walletReceipts.none', locale)}</dd>
                </div>
              </dl>

              <div>
                <h3 className="text-sm font-medium text-foreground mb-2">
                  {t('admin.walletReceipts.attachment', locale)}
                </h3>
                {selected.attachmentUrl ? (
                  <StaffReceiptAttachmentPreview
                    key={selected.transactionId}
                    url={selected.attachmentUrl}
                    attachmentKey={selected.attachmentKey}
                    label={t('admin.walletReceipts.attachmentAlt', locale)}
                    openLabel={t('admin.walletReceipts.openAttachment', locale)}
                  />
                ) : (
                  <p className="break-all text-sm text-muted-foreground" dir="ltr">
                    {selected.attachmentKey ?? t('admin.walletReceipts.none', locale)}
                  </p>
                )}
              </div>

              {selected.verificationTimeline && (
                <WalletReceiptTimeline
                  timeline={selected.verificationTimeline}
                  locale={locale}
                  formatTime={time.format}
                />
              )}
              {selected.canDecide ? (
                <div className="space-y-4 border-t border-border pt-4">
                  <div>
                    <label
                      htmlFor="apply-invoice-id"
                      className="block text-sm font-medium text-foreground mb-1"
                    >
                      {t('admin.walletReceipts.invoiceId', locale)}
                    </label>
                    <input
                      id="apply-invoice-id"
                      name="invoiceId"
                      readOnly={Boolean(selected.dualApproval)}
                      disabled={acting || stepUpOpen}
                      type="text"
                      dir="ltr"
                      inputMode="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={invoiceId}
                      onChange={(e) => setInvoiceId(e.target.value)}
                      placeholder={t('admin.walletReceipts.invoiceIdPlaceholder', locale)}
                      aria-describedby="apply-invoice-hint"
                      className="w-full border border-input rounded px-3 py-2 font-mono text-sm"
                    />
                    <p id="apply-invoice-hint" className="text-xs text-muted-foreground mt-1">
                      {t('admin.walletReceipts.invoiceIdHint', locale)}
                    </p>
                  </div>

                  {allocationError && (
                    <p className="text-sm text-destructive" role="alert">
                      {allocationError}
                    </p>
                  )}

                  {allocationLoading && (
                    <p role="status">{t('admin.walletReceipts.review.loading', locale)}</p>
                  )}
                  {financialReview && (
                    <BankReceiptFinancialReview
                      review={financialReview}
                      formatDate={time.format}
                      formatPaymentDate={(value) => formatPaymentDate(value, locale)}
                    />
                  )}
                  <button
                    type="button"
                    disabled={acting || stepUpOpen || allocationLoading}
                    onClick={() => setReviewRevision((v) => v + 1)}
                    className="rounded border px-3 py-2"
                  >
                    {t('admin.walletReceipts.review.refresh', locale)}
                  </button>

                  {clientIssue && (
                    <p
                      id={reasonInvalid ? 'reject-reason-error' : 'wallet-receipt-client-issue'}
                      className="text-sm text-destructive"
                      role="alert"
                    >
                      {clientIssue}
                    </p>
                  )}

                  <button
                    ref={confirmButtonRef}
                    type="button"
                    data-testid="wallet-receipt-confirm"
                    onClick={() => handleConfirm()}
                    disabled={
                      acting ||
                      loading ||
                      !!queueError ||
                      detailLoading ||
                      detailError ||
                      stepUpOpen ||
                      !reviewReady ||
                      (isTransactionUuid(invoiceId.trim()) &&
                        (allocationLoading || !!allocationError || !allocation))
                    }
                    aria-busy={acting || allocationLoading}
                    className="px-4 py-2 bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
                  >
                    {acting
                      ? t('admin.walletReceipts.saving', locale)
                      : allocation?.isOverpayment
                        ? t('admin.walletReceipts.confirmOverpayment', locale)
                        : t('admin.walletReceipts.confirm', locale)}
                  </button>

                  {selected.dualApproval && selected.canEmergencyOverride && (
                    <fieldset className="space-y-3 rounded border border-amber-500 p-4">
                      <legend className="px-1 font-medium">
                        {t('admin.walletReceipts.emergencyTitle', locale)}
                      </legend>
                      <p id="receipt-emergency-hint" className="text-sm">
                        {t('admin.walletReceipts.emergencyHint', locale)}
                      </p>
                      <label
                        htmlFor="receipt-emergency-reason"
                        className="block text-sm font-medium"
                      >
                        {t('admin.walletReceipts.emergencyReason', locale)}
                      </label>
                      <textarea
                        id="receipt-emergency-reason"
                        rows={3}
                        required
                        aria-describedby="receipt-emergency-hint"
                        maxLength={APPROVAL_REVIEW_REASON_MAX_LENGTH}
                        value={emergencyReason}
                        onChange={(event) => setEmergencyReason(event.target.value)}
                        disabled={acting || stepUpOpen}
                        className="w-full rounded border border-input px-3 py-2"
                      />
                      <button
                        type="button"
                        ref={emergencyButtonRef}
                        data-testid="wallet-receipt-emergency-confirm"
                        disabled={
                          acting ||
                          loading ||
                          !!queueError ||
                          detailLoading ||
                          detailError ||
                          !reviewReady ||
                          stepUpOpen ||
                          !emergencyReason.trim() ||
                          (!!invoiceId.trim() &&
                            (allocationLoading || !!allocationError || !allocation))
                        }
                        onClick={() => handleConfirm(emergencyReason)}
                        className="rounded bg-amber-900 px-4 py-2 text-white disabled:opacity-50"
                      >
                        {t('admin.walletReceipts.emergencyConfirm', locale)}
                      </button>
                    </fieldset>
                  )}

                  <form onSubmit={handleReject} className="space-y-3" noValidate>
                    <div>
                      <label
                        htmlFor="reject-reason"
                        className="block text-sm font-medium text-foreground mb-1"
                      >
                        {t('admin.walletReceipts.reason', locale)}{' '}
                        <span className="text-destructive" aria-hidden="true">
                          *
                        </span>
                      </label>
                      <textarea
                        id="reject-reason"
                        name="reason"
                        required
                        aria-required="true"
                        aria-invalid={reasonInvalid}
                        aria-describedby={
                          reasonInvalid
                            ? 'reject-reason-error reject-reason-hint'
                            : 'reject-reason-hint'
                        }
                        maxLength={BANK_RECEIPT_REJECT_REASON_MAX_LENGTH}
                        rows={3}
                        value={reason}
                        disabled={acting || stepUpOpen}
                        onChange={(e) => {
                          setReason(e.target.value);
                          if (reasonInvalid) {
                            setReasonInvalid(false);
                            setClientIssue(null);
                          }
                        }}
                        className="w-full border border-input rounded px-3 py-2"
                      />
                      <p id="reject-reason-hint" className="text-xs text-muted-foreground mt-1">
                        {t('admin.walletReceipts.reasonHint', locale)}
                      </p>
                    </div>
                    <button
                      ref={rejectButtonRef}
                      type="submit"
                      data-testid="wallet-receipt-reject"
                      disabled={
                        acting ||
                        stepUpOpen ||
                        loading ||
                        !!queueError ||
                        allocationLoading ||
                        detailLoading ||
                        detailError
                      }
                      aria-busy={acting}
                      className="px-4 py-2 bg-red-700 text-white rounded hover:bg-red-800 disabled:opacity-50"
                    >
                      {acting
                        ? t('admin.walletReceipts.saving', locale)
                        : t('admin.walletReceipts.reject', locale)}
                    </button>
                  </form>
                </div>
              ) : (
                <p className="text-sm text-warning" role="status">
                  {t('admin.walletReceipts.alreadyDecided', locale)}
                </p>
              )}
            </section>
          )}
        </div>
      </ListPage>

      {stepUpOpen && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Dialog handles bubbled Escape/Tab and backdrop dismissal; controls remain keyboard accessible.
        <div
          ref={stepUpDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-receipt-step-up-title"
          aria-describedby="wallet-receipt-step-up-description"
          data-testid="wallet-receipt-step-up-dialog"
          onKeyDown={onStepUpKeyDown}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !stepUpSubmitting) cancelStepUp();
          }}
        >
          <form
            onSubmit={submitStepUp}
            className="w-full max-w-md rounded-lg bg-card text-card-foreground p-6 shadow-lg space-y-4"
          >
            <h3 id="wallet-receipt-step-up-title" className="text-lg font-semibold text-foreground">
              {t('admin.walletReceipts.stepUp.title', locale)}
            </h3>
            <p id="wallet-receipt-step-up-description" className="text-sm text-muted-foreground">
              {t('admin.walletReceipts.stepUp.description', locale)}
            </p>
            {pendingAction?.kind === 'confirm' && (
              <>
                {time.notice}
                <ScrollArea
                  className="h-[35dvh]"
                  role="region"
                  aria-label={t('admin.walletReceipts.review.title', locale)}
                >
                  <BankReceiptFinancialReview
                    review={pendingAction.review}
                    formatDate={time.format}
                    formatPaymentDate={(value) => formatPaymentDate(value, locale)}
                  />
                </ScrollArea>
              </>
            )}
            <div>
              <label
                htmlFor="wallet-receipt-step-up-password"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('admin.walletReceipts.stepUp.passwordLabel', locale)}
              </label>
              <input
                ref={stepUpPasswordRef}
                id="wallet-receipt-step-up-password"
                data-testid="wallet-receipt-step-up-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                aria-required="true"
                aria-invalid={Boolean(stepUpError)}
                aria-describedby={stepUpError ? 'wallet-receipt-step-up-error' : undefined}
                value={stepUpPassword}
                onChange={(e) => {
                  setStepUpPassword(e.target.value);
                  if (stepUpError) setStepUpError(null);
                }}
                className="w-full border border-input rounded px-3 py-2"
              />
            </div>
            {stepUpError && (
              <p
                id="wallet-receipt-step-up-error"
                className="text-sm text-destructive"
                role="alert"
              >
                {stepUpError}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                data-testid="wallet-receipt-step-up-submit"
                disabled={
                  stepUpSubmitting ||
                  !stepUpPassword.trim() ||
                  (pendingAction?.kind === 'confirm' && time.status !== 'ready')
                }
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {stepUpSubmitting
                  ? t('admin.walletReceipts.stepUp.verifying', locale)
                  : t('admin.walletReceipts.stepUp.submit', locale)}
              </button>
              <button
                type="button"
                data-testid="wallet-receipt-step-up-cancel"
                onClick={cancelStepUp}
                disabled={stepUpSubmitting}
                className="px-4 py-2 border border-input rounded text-foreground hover:bg-muted disabled:opacity-50"
              >
                {t('admin.walletReceipts.stepUp.cancel', locale)}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
