import { notifyElectricityStatus } from '../electricity/electricity-status-notifications.js';
import { notifyCancellationRequest } from './contract-cancellation-request-notifications.js';
import { contractText } from '@barghsa/i18n/contracts';
import type { PoolClient } from 'pg';
import { resolveStaffPermissions } from '../session/staff-permissions.js';
import {
  NotificationsService,
  type ContractCustomerEvent,
} from '../notifications/notifications.service.js';
const messages = {
  rejected: {
    fa: contractText('rejectionOrderNotice', 'fa'),
    en: contractText('rejectionOrderNotice', 'en'),
  },
  electricity_price_proposed: {
    fa: 'تغییر قیمت برق برای دوره آینده پیشنهاد شد. مبنا، دلیل و محاسبه را پیش از نهایی‌شدن در جزئیات سفارش ببینید.',
    en: 'A future electricity price change was proposed. Review its basis, reason and calculation in your order before finalization.',
  },
  electricity_price_finalized: {
    fa: 'تغییر قیمت برق نهایی شد. فاکتور تعدیل یا بستانکاری مرتبط را در جزئیات سفارش ببینید.',
    en: 'Your electricity price change was finalized. See the linked adjustment invoice or credit in your order.',
  },
  electricity_price_cancelled: {
    fa: 'پیشنهاد تغییر قیمت برق لغو شد. فاکتور تعدیلی صادر نشد.',
    en: 'The proposed electricity price change was cancelled. No adjustment invoice was issued.',
  },
  electricity_increase_requested: {
    fa: 'درخواست افزایش مقدار برق برای بررسی کارکنان ثبت شد.',
    en: 'An electricity quantity increase request is awaiting staff review.',
  },
  electricity_increase_rejected: {
    fa: 'درخواست افزایش مقدار برق رد شد. دلیل را در جزئیات سفارش بررسی کنید.',
    en: 'Your electricity quantity increase request was declined. See the order for the reason.',
  },
  electricity_increase_approved: {
    fa: 'درخواست افزایش مقدار برق تأیید شد. الحاقیه را در جزئیات سفارش بررسی کنید.',
    en: 'Your electricity quantity increase was approved. Review the amendment in your order details.',
  },
  electricity_increase_signed: {
    fa: 'الحاقیه افزایش برق امضا شد. فاکتور تعدیل را برای اعمال افزایش پرداخت کنید.',
    en: 'Your electricity increase amendment was signed. Pay the adjustment invoice to activate it.',
  },
  cancellation_requested: {
    fa: 'درخواست لغو قرارداد برای بررسی کارکنان ثبت شد.',
    en: 'A contract cancellation request is awaiting staff review.',
  },
  cancellation_request_rejected: {
    fa: 'درخواست لغو قرارداد رد شد. برای پیگیری با پشتیبانی تماس بگیرید.',
    en: 'Your cancellation request was declined. Contact support for help.',
  },
  cancellation_request_fulfilled: {
    fa: 'درخواست لغو پذیرفته و قرارداد لغو شد. وضعیت بازپرداخت را در قرارداد بررسی کنید.',
    en: 'Your request was accepted and the contract was cancelled. Check the contract for refund progress.',
  },
  signature_requested: {
    fa: 'نسخه پذیرفته‌شده قرارداد برای ثبت نسخه امضاشده آماده است.',
    en: 'The accepted contract version is ready for its signed copy.',
  },
  signed_copy_recorded: {
    fa: 'نسخه امضاشده تأییدشده برای قرارداد ثبت شد.',
    en: 'An approved signed copy has been recorded for the contract.',
  },
  submitted: { fa: 'قرارداد برای بررسی آماده است.', en: 'A contract is ready for staff review.' },
  resubmitted: {
    fa: 'نسخه جدید قرارداد برای بررسی ارسال شد.',
    en: 'A revised contract has been submitted for review.',
  },
  changes_requested: {
    fa: 'برای قرارداد درخواست اصلاح ثبت شد.',
    en: 'Changes have been requested for the contract.',
  },
  published: {
    fa: 'قرارداد برای بررسی و پذیرش شما آماده است.',
    en: 'Your contract is ready for review and acceptance.',
  },
  accepted: {
    fa: 'نسخه منتشرشده قرارداد توسط مشتری پذیرفته شد.',
    en: 'The customer accepted the published contract version.',
  },
};
export async function notifyContractReview(
  client: PoolClient,
  id: string,
  event: keyof typeof messages,
  reason?: string,
  versionId?: string,
  requestId?: string,
  electricityRejection?: { orderId: string; from: string }
) {
  const profile = (
    await client.query<{
      profile_id: string;
      user_id: string;
      order_id: string | null;
      contract_number: string;
    }>(
      'SELECT c.profile_id,c.order_id,c.contract_number::text,p.user_id FROM contracts c JOIN profiles p ON p.id=c.profile_id WHERE c.id=$1',
      [id]
    )
  ).rows[0]!;
  const recipients: Array<{ userId: string; operatingContext: 'customer' | 'staff' }> = [];
  if (event !== 'submitted')
    recipients.push({ userId: profile.user_id, operatingContext: 'customer' });
  if (
    [
      'submitted',
      'resubmitted',
      'accepted',
      'signature_requested',
      'signed_copy_recorded',
      'cancellation_requested',
      'electricity_increase_requested',
    ].includes(event)
  ) {
    const staff = await client.query<{ user_id: string; is_admin: boolean; permissions: unknown }>(
      'SELECT u.user_id,u.is_admin,array_agg(r.permissions) FILTER (WHERE r.role_id IS NOT NULL) AS permissions FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.user_id LEFT JOIN staff_roles r ON r.role_id=ur.role_id WHERE (u.is_staff OR u.is_admin) AND u.disabled_at IS NULL AND u.activation_token IS NULL GROUP BY u.user_id,u.is_admin'
    );
    for (const row of staff.rows) {
      const grants = resolveStaffPermissions(row.permissions);
      if (row.is_admin || grants.includes('*') || grants.includes('contracts:write'))
        recipients.push({ userId: row.user_id, operatingContext: 'staff' });
    }
  }
  const message = messages[event];
  const customerEvents: Partial<Record<keyof typeof messages, ContractCustomerEvent>> = {
    published: 'contract.awaiting_acceptance',
    accepted: 'contract.accepted',
    signed_copy_recorded: 'contract.signed',
    changes_requested: 'contract.changes_requested',
  };
  const eventKey = customerEvents[event];
  const payload: Record<string, string> = { contractNumber: profile.contract_number };
  if (eventKey) {
    if (!versionId)
      throw new Error('Contract customer notification requires the exact event version');
    if (event === 'changes_requested') payload.changesDescription = reason!;
    if (event === 'accepted' || event === 'signed_copy_recorded') {
      const evidence = await client.query<{ occurred_at: Date }>(
        event === 'accepted'
          ? 'SELECT accepted_at AS occurred_at FROM contract_acceptances WHERE contract_id=$1 AND version_id=$2'
          : 'SELECT recorded_at AS occurred_at FROM contract_signatures WHERE contract_id=$1 AND version_id=$2',
        [id, versionId]
      );
      payload[event === 'accepted' ? 'acceptedAt' : 'signedAt'] =
        evidence.rows[0]!.occurred_at.toISOString();
    }
  }
  for (const { userId, operatingContext } of recipients) {
    const params = {
      userId,
      ...(operatingContext === 'customer' ? { profileId: profile.profile_id } : {}),
      operatingContext,
      ...(event === 'rejected' && profile.order_id
        ? { link: `/electricity/orders/${profile.order_id}` }
        : {}),
      type: 'general',
      title: message.en,
      localizedContent: {
        fa: {
          title: 'قرارداد',
          body: message.fa + ' شناسه قرارداد: ' + id + (reason ? ' ' + reason : ''),
        },
        en: {
          title: 'Contract',
          body: message.en + ' Contract reference: ' + id + (reason ? ' ' + reason : ''),
        },
      },
    } as const;
    const notifications = new NotificationsService();
    if (operatingContext === 'customer' && event === 'rejected' && electricityRejection) {
      await notifyElectricityStatus(
        client,
        electricityRejection.orderId,
        electricityRejection.from,
        'rejected',
        params,
        undefined,
        electricityRejection.from === 'draft' ? null : undefined
      );
    } else if (operatingContext === 'customer' && event === 'cancellation_requested') {
      if (!requestId) throw new Error('Cancellation notice requires the saved request');
      await notifyCancellationRequest(client, id, requestId, params);
    } else if (operatingContext === 'customer' && eventKey)
      await notifications.createCustomerBusinessEvent(
        {
          ...params,
          profileId: profile.profile_id,
          eventKey,
          payload,
          link: `/contracts/${id}`,
          occurrenceKey: `${eventKey}:${id}:${versionId}:${userId}`,
        },
        client
      );
    else await notifications.create(params, client);
  }
}
