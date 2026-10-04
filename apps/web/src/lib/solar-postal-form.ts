import { suggestionLines } from './solar-document-form.js';
export interface ShipmentDraft {
  courier: string;
  trackingNumber: string;
  sendDate: string;
  receiptImageId: string;
}
export interface ShipmentBody {
  courier: string;
  trackingNumber: string;
  sendDate: string;
  receiptImageId?: string;
}
export const emptyShipment: ShipmentDraft = {
  courier: '',
  trackingNumber: '',
  sendDate: '',
  receiptImageId: '',
};
export interface PostalGuidance {
  fa: string;
  en: string;
  destinationAddress: string;
  contactDetails: string;
  originals: Array<{ fa: string; en: string }>;
}
export interface PostalGuidanceDraft extends Omit<PostalGuidance, 'originals'> {
  originalsFa: string;
  originalsEn: string;
}
export const emptyPostalGuidance: PostalGuidanceDraft = {
  fa: '',
  en: '',
  destinationAddress: '',
  contactDetails: '',
  originalsFa: '',
  originalsEn: '',
};
export function utcCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export const receiptUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function shipmentBody(draft: ShipmentDraft): ShipmentBody {
  return {
    courier: draft.courier.trim(),
    trackingNumber: draft.trackingNumber.trim(),
    sendDate: draft.sendDate,
    ...(draft.receiptImageId ? { receiptImageId: draft.receiptImageId } : {}),
  };
}
export function postalGuidanceBody(draft: PostalGuidanceDraft): PostalGuidance {
  const fa = suggestionLines(draft.originalsFa),
    en = suggestionLines(draft.originalsEn);
  return {
    fa: draft.fa.trim(),
    en: draft.en.trim(),
    destinationAddress: draft.destinationAddress.trim(),
    contactDetails: draft.contactDetails.trim(),
    originals: fa.map((text, index) => {
      const translation = en[index];
      if (translation === undefined) throw new Error('Unpaired originals');
      return { fa: text, en: translation };
    }),
  };
}
export function postalGuidanceDraft(value: PostalGuidance): PostalGuidanceDraft {
  return {
    fa: value.fa,
    en: value.en,
    destinationAddress: value.destinationAddress,
    contactDetails: value.contactDetails,
    originalsFa: value.originals.map((item) => item.fa).join('\n'),
    originalsEn: value.originals.map((item) => item.en).join('\n'),
  };
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function validPostalGuidance(value: unknown): value is PostalGuidance {
  return (
    record(value) &&
    typeof value.fa === 'string' &&
    !!value.fa.trim() &&
    value.fa.trim().length <= 4000 &&
    typeof value.en === 'string' &&
    !!value.en.trim() &&
    value.en.trim().length <= 4000 &&
    typeof value.destinationAddress === 'string' &&
    value.destinationAddress.trim().length <= 2000 &&
    typeof value.contactDetails === 'string' &&
    value.contactDetails.trim().length <= 1000 &&
    Array.isArray(value.originals) &&
    value.originals.length <= 30 &&
    value.originals.every(
      (item) =>
        record(item) &&
        typeof item.fa === 'string' &&
        !!item.fa.trim() &&
        item.fa.trim().length <= 200 &&
        typeof item.en === 'string' &&
        !!item.en.trim() &&
        item.en.trim().length <= 200
    )
  );
}
export function confirmedPostalGuidance(value: unknown, expected: PostalGuidance): boolean {
  return (
    validPostalGuidance(value) &&
    ['fa', 'en', 'destinationAddress', 'contactDetails'].every(
      (field) =>
        value[field as keyof Omit<PostalGuidance, 'originals'>] ===
        expected[field as keyof Omit<PostalGuidance, 'originals'>]
    ) &&
    value.originals.length === expected.originals.length &&
    value.originals.every(
      (item, index) =>
        item.fa === expected.originals[index]?.fa && item.en === expected.originals[index]?.en
    )
  );
}
export function shipmentReceipt(value: unknown): boolean {
  return record(value) && value.status === 'shipped';
}
export function confirmedShipmentRead(value: unknown, expected: ShipmentBody): boolean {
  if (!record(value) || !record(value.postal)) return false;
  const postal = value.postal;
  return (
    ['shipped', 'received'].includes(String(postal.status)) &&
    postal.courier === expected.courier &&
    postal.tracking_number === expected.trackingNumber &&
    typeof postal.send_date === 'string' &&
    utcCalendarDay(postal.send_date) &&
    postal.send_date === expected.sendDate &&
    (postal.receipt_image_id ?? null) === (expected.receiptImageId ?? null)
  );
}
export function confirmedPostalDecision(value: unknown, path: string): boolean {
  if (!record(value)) return false;
  const decision = path.split('/').at(-1);
  const outcomes: Record<string, readonly string[]> = {
    'confirm-received': ['received', 'postal_documents_received'],
    'mark-incomplete': ['incomplete', 'waiting_for_postal_submission'],
    'mark-not-received': ['not_received', 'waiting_for_postal_submission'],
    'final-approve': ['approved'],
    'final-reject': ['rejected'],
    'close-no-contract': ['cancelled'],
    'start-final-review': ['final_review'],
  };
  const outcome = outcomes[decision ?? ''];
  return (
    !!outcome &&
    value.status === outcome[0] &&
    (outcome.length === 1 || value.requestStatus === outcome[1])
  );
}
