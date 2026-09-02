/**
 * Notification template seed catalog (T-05.04.05).
 *
 * Seed data for every business notification event defined in the E-05 appendix
 * (mirrored by `@barghsa/shared` NOTIFICATION_TYPE_REGISTRY). For each event key
 * we provide initial templates in both `fa` (Persian, default) and `en`
 * (English), for every channel the event may deliver on.
 *
 * All seeded rows are created as version 1, status `active`, is_active `true`
 * so the notification engine can render them immediately.
 *
 * The body uses the `{{variableName}}` syntax enforced by the shared template
 * engine (T-05.04.02). Every placeholder used in body/subject MUST be listed in
 * the row's `variables` allow-list.
 */

export type SeedTemplateChannel = 'email' | 'sms' | 'in_app'
export type SeedTemplateLocale = 'fa' | 'en'

export interface SeedTemplateVariable {
  name: string
  description: string
}

export interface SeedTemplate {
  eventKey: string
  channel: SeedTemplateChannel
  locale: SeedTemplateLocale
  /** Present only for email channel (subject line). */
  subject: string | null
  bodyTemplate: string
  variables: SeedTemplateVariable[]
}

/**
 * Per-channel content definition for an event.
 *
 * Only the channels the event actually delivers on are present; the seeder
 * expands exactly those into per-locale rows.
 */
export interface SeedEventDefinition {
  eventKey: string
  /** Subject for fa emails; only used when the event delivers on email. */
  faSubject?: string | null
  enSubject?: string | null
  faBody: string
  enBody: string
  /** The subset of {email, sms, in_app} channels to seed. */
  channels: SeedTemplateChannel[]
  /** Shared allow-list for the event's templates. */
  variables: SeedTemplateVariable[]
}

/** The complete seed catalog, one entry per registered event key. */
export const NOTIFICATION_TEMPLATE_SEED: SeedEventDefinition[] = [
  {
    eventKey: 'auth.otp_sent',
    faSubject: 'کد ورود بارق‌سا',
    enSubject: 'Barghsa sign-in code',
    faBody: 'کد تأیید شما: {{verificationCode}}\n\nاین کد تا {{expiryMinutes}} دقیقه معتبر است. اگر این درخواست را شما انجام نداده‌اید، لطفاً بلافاصله بارق‌سا را ترک کرده و با پشتیبانی تماس بگیرید.',
    enBody: 'Your verification code is {{verificationCode}}.\n\nThis code expires in {{expiryMinutes}} minutes. If you did not make this request, please leave Barghsa and contact support immediately.',
    channels: ['email', 'sms', 'in_app'],
    variables: [
      { name: 'verificationCode', description: 'کد یکبارمصرف ورود / One-time sign-in code' },
      { name: 'expiryMinutes', description: 'دقایق اعتبار کد / Code expiry in minutes' },
    ],
  },
  {
    eventKey: 'auth.password_changed',
    faSubject: 'تغییر رمز عبور',
    enSubject: 'Password changed',
    faBody: 'رمز عبور حساب شما با موفقیت تغییر کرد.\n\nاگر شما این کار را انجام نداده‌اید، لطفاً بلافاصله با پشتیبانی تماس بگیرید.',
    enBody: 'Your account password was changed successfully.\n\nIf you did not do this, please contact support immediately.',
    channels: ['email', 'in_app'],
    variables: [],
  },
  {
    eventKey: 'auth.session_revoked',
    faSubject: 'باطل شدن نشست',
    enSubject: 'Session revoked',
    faBody: 'نشست شما در بارق‌سا باطل شد.\n\nاگر این کار شما را برده‌اید، لطفاً بلافاصله با پشتیبانی تماس بگیرید.',
    enBody: 'Your Barghsa session was revoked.\n\nIf you did not do this, please contact support immediately.',
    channels: ['email', 'in_app'],
    variables: [],
  },
  {
    eventKey: 'auth.new_device_login',
    faSubject: 'ورود از دستگاه جدید',
    enSubject: 'New device sign-in',
    faBody: 'ورود جدیدی در حساب شما ثبت شد.\n\nدستگاه: {{device}}\nزمان: {{loginTime}}\n\nاگر این شما نیستید، لطفاً بلافاصله با پشتیبانی تماس بگیرید.',
    enBody: 'A new sign-in was detected on your account.\n\nDevice: {{device}}\nTime: {{loginTime}}\n\nIf this was not you, contact support immediately.',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'device', description: 'دستگاه / Device name' },
      { name: 'loginTime', description: 'زمان ورود / Sign-in time' },
    ],
  },
  {
    eventKey: 'payment.wallet_topup_completed',
    faSubject: 'شارژ موفق کیف پول',
    enSubject: 'Wallet top-up successful',
    faBody: 'کیف پول شما به مبلغ {{amount}} موفقیت‌آمیز شارژ شد.\n\nشماره تراکنش: {{transactionId}}',
    enBody: 'Your wallet was topped up with {{amount}} successfully.\n\nTransaction ID: {{transactionId}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'amount', description: 'مبلغ شارژ / Top-up amount' },
      { name: 'transactionId', description: 'شماره تراکنش / Transaction ID' },
    ],
  },
  {
    eventKey: 'payment.wallet_topup_failed',
    faSubject: 'خطا در شارژ کیف پول',
    enSubject: 'Wallet top-up failed',
    faBody: 'شارژ کیف پول شما به مبلغ {{amount}} ناموفق بود.\n\nدلیل: {{reason}}\n\nلطفاً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.',
    enBody: 'Your wallet top-up of {{amount}} failed.\n\nReason: {{reason}}\n\nPlease try again or contact support.',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'amount', description: 'مبلغ شارژ / Top-up amount' },
      { name: 'reason', description: 'دلیل خطا / Failure reason' },
    ],
  },
  {
    eventKey: 'payment.invoice_paid',
    faSubject: 'پرداخت قبض',
    enSubject: 'Invoice paid',
    faBody: 'پرداخت شما برای قبض با موفقیت انجام شد.\n\nشماره قبض: {{invoiceNumber}}\nمبلغ: {{amount}}\nزمان پرداخت: {{paidAt}}',
    enBody: 'Your payment was completed successfully.\n\nInvoice number: {{invoiceNumber}}\nAmount: {{amount}}\nPaid at: {{paidAt}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'invoiceNumber', description: 'شماره قبض / Invoice number' },
      { name: 'amount', description: 'مبلغ / Amount' },
      { name: 'paidAt', description: 'زمان پرداخت / Payment time' },
    ],
  },
  {
    eventKey: 'payment.invoice_overdue',
    faSubject: 'قبض سررسید گذشته',
    enSubject: 'Invoice overdue',
    faBody: 'قبض زیر هنوز پرداخت نشده است و سررسید آن گذشته است.\n\nشماره قبض: {{invoiceNumber}}\nمبلغ: {{amount}}\nسررسید: {{dueDate}}\n\nلطفاً هرچه زودتر پرداخت کنید.',
    enBody: 'The following invoice is overdue and unpaid.\n\nInvoice number: {{invoiceNumber}}\nAmount: {{amount}}\nDue date: {{dueDate}}\n\nPlease pay as soon as possible.',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'invoiceNumber', description: 'شماره قبض / Invoice number' },
      { name: 'amount', description: 'مبلغ / Amount' },
      { name: 'dueDate', description: 'سررسید / Due date' },
    ],
  },
  {
    eventKey: 'payment.invoice_reminder',
    faSubject: 'یادآوری پرداخت قبض',
    enSubject: 'Invoice payment reminder',
    faBody: 'این یک یادآوری برای پرداخت قبض شماست.\n\nشناسه قبض: {{invoiceId}}\nسررسید: {{dueAt}}\nزمان یادآوری: {{scheduledAt}}\nفاصله تا سررسید (روز): {{offset}}\n\nلطفاً در اسرع وقت پرداخت کنید.',
    enBody: 'This is a reminder to pay your invoice.\n\nInvoice ID: {{invoiceId}}\nDue date: {{dueAt}}\nReminder time: {{scheduledAt}}\nDays relative to due date: {{offset}}\n\nPlease pay as soon as possible.',
    channels: ['email', 'sms', 'in_app'],
    variables: [
      { name: 'invoiceId', description: 'شناسه قبض / Invoice id' },
      { name: 'offset', description: 'فاصله روز نسبت به سررسید / Days relative to due date' },
      { name: 'dueAt', description: 'سررسید / Due date' },
      { name: 'scheduledAt', description: 'زمان یادآوری / Reminder scheduled time' },
    ],
  },
  {
    eventKey: 'payment.refund_completed',
    faSubject: 'استرداد وجه انجام شد',
    enSubject: 'Refund completed',
    faBody: 'استرداد وجه شما به مبلغ {{amount}} با موفقیت انجام شد.\n\nشماره استرداد: {{refundId}}',
    enBody: 'Your refund of {{amount}} was completed successfully.\n\nRefund ID: {{refundId}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'amount', description: 'مبلغ استرداد / Refund amount' },
      { name: 'refundId', description: 'شماره استرداد / Refund ID' },
    ],
  },
  {
    eventKey: 'payment.refund_failed',
    faSubject: null,
    enSubject: null,
    faBody: 'پردازش استرداد وجه شما ناموفق بود.\n\nدلیل: {{reason}}',
    enBody: 'Your refund could not be processed.\n\nReason: {{reason}}',
    channels: ['in_app'],
    variables: [{ name: 'reason', description: 'دلیل خطا / Failure reason' }],
  },
  {
    eventKey: 'contract.created',
    faSubject: 'قرارداد جدید ایجاد شد',
    enSubject: 'New contract created',
    faBody: 'قرارداد جدیدی برای شما ایجاد شد.\n\nشماره قرارداد: {{contractNumber}}\nنوع: {{contractType}}',
    enBody: 'A new contract was created for you.\n\nContract number: {{contractNumber}}\nType: {{contractType}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'contractNumber', description: 'شماره قرارداد / Contract number' },
      { name: 'contractType', description: 'نوع قرارداد / Contract type' },
    ],
  },
  {
    eventKey: 'contract.awaiting_acceptance',
    faSubject: 'قرارداد در انتظار پذیرش',
    enSubject: 'Contract awaiting acceptance',
    faBody: 'قرارداد زیر در انتظار پذیرش شماست.\n\nشماره: {{contractNumber}}\nلطفاً برای مشاهده و تصمیم اقدام کنید.',
    enBody: 'The following contract awaits your acceptance.\n\nNumber: {{contractNumber}}\nPlease review and take action.',
    channels: ['email', 'in_app'],
    variables: [{ name: 'contractNumber', description: 'شماره قرارداد / Contract number' }],
  },
  {
    eventKey: 'contract.accepted',
    faSubject: 'قرارداد پذیرفته شد',
    enSubject: 'Contract accepted',
    faBody: 'قرارداد شماره {{contractNumber}} پذیرفته شد.\n\nزمان پذیرش: {{acceptedAt}}',
    enBody: 'Contract {{contractNumber}} was accepted.\n\nAccepted at: {{acceptedAt}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'contractNumber', description: 'شماره قرارداد / Contract number' },
      { name: 'acceptedAt', description: 'زمان پذیرش / Acceptance time' },
    ],
  },
  {
    eventKey: 'contract.signed',
    faSubject: 'قرارداد امضا شد',
    enSubject: 'Contract signed',
    faBody: 'قرارداد شماره {{contractNumber}} امضا شد.\n\nزمان امضا: {{signedAt}}',
    enBody: 'Contract {{contractNumber}} was signed.\n\nSigned at: {{signedAt}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'contractNumber', description: 'شماره قرارداد / Contract number' },
      { name: 'signedAt', description: 'زمان امضا / Signed time' },
    ],
  },
  {
    eventKey: 'contract.active',
    faSubject: 'قرارداد فعال شد',
    enSubject: 'Contract active',
    faBody: 'قرارداد شماره {{contractNumber}} شما فعال است.',
    enBody: 'Your contract {{contractNumber}} is now active.',
    channels: ['email', 'in_app'],
    variables: [{ name: 'contractNumber', description: 'شماره قرارداد / Contract number' }],
  },
  {
    eventKey: 'contract.cancelled',
    faSubject: 'قرارداد لغو شد',
    enSubject: 'Contract cancelled',
    faBody: 'قرارداد شماره {{contractNumber}} لغو شد.',
    enBody: 'Contract {{contractNumber}} was cancelled.',
    channels: ['email', 'in_app'],
    variables: [{ name: 'contractNumber', description: 'شماره قرارداد / Contract number' }],
  },
  {
    eventKey: 'contract.changes_requested',
    faSubject: 'تغییرات قرارداد درخواست شد',
    enSubject: 'Contract changes requested',
    faBody: 'تغییرات زیر برای قرارداد شماره {{contractNumber}} درخواست شده است:\n\n{{changesDescription}}',
    enBody: 'The following changes were requested for contract {{contractNumber}}:\n\n{{changesDescription}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'contractNumber', description: 'شماره قرارداد / Contract number' },
      { name: 'changesDescription', description: 'شرح تغییرات / Changes description' },
    ],
  },
  {
    eventKey: 'order.submitted',
    faSubject: 'سفارش شما ثبت شد',
    enSubject: 'Order submitted',
    faBody: 'سفارش شما با موفقیت ثبت شد.\n\nشماره سفارش: {{orderNumber}}\nزمان ثبت: {{submittedAt}}',
    enBody: 'Your order was submitted successfully.\n\nOrder number: {{orderNumber}}\nSubmitted at: {{submittedAt}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'orderNumber', description: 'شماره سفارش / Order number' },
      { name: 'submittedAt', description: 'زمان ثبت / Submission time' },
    ],
  },
  {
    eventKey: 'order.status_changed',
    faSubject: 'به‌روزرسانی وضعیت سفارش',
    enSubject: 'Order status updated',
    faBody: 'وضعیت سفارش {{orderNumber}} به «{{newStatus}}» تغییر کرد.',
    enBody: 'The status of order {{orderNumber}} changed to "{{newStatus}}".',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'orderNumber', description: 'شماره سفارش / Order number' },
      { name: 'newStatus', description: 'وضعیت جدید / New status' },
    ],
  },
  {
    eventKey: 'order.awaiting_staff',
    faSubject: null,
    enSubject: null,
    faBody: 'سفارش {{orderNumber}} در انتظار بررسی همکاران بارق‌سا است.',
    enBody: 'Order {{orderNumber}} is awaiting review by Barghsa staff.',
    channels: ['in_app'],
    variables: [{ name: 'orderNumber', description: 'شماره سفارش / Order number' }],
  },
  {
    eventKey: 'order.cancellation_requested',
    faSubject: 'درخواست لغو سفارش',
    enSubject: 'Order cancellation requested',
    faBody: 'درخواست لغو سفارش {{orderNumber}} ثبت شد.\n\nاین درخواست در حال بررسی است.',
    enBody: 'A cancellation request was submitted for order {{orderNumber}}.\n\nIt is currently under review.',
    channels: ['email', 'in_app'],
    variables: [{ name: 'orderNumber', description: 'شماره سفارش / Order number' }],
  },
  {
    eventKey: 'ticket.new_reply',
    faSubject: 'پاسخ جدید در تیکت',
    enSubject: 'New reply on ticket',
    faBody: 'پاسخ جدیدی برای تیکت {{ticketNumber}} ثبت شد.',
    enBody: 'A new reply was added to ticket {{ticketNumber}}.',
    channels: ['email', 'in_app'],
    variables: [{ name: 'ticketNumber', description: 'شماره تیکت / Ticket number' }],
  },
  {
    eventKey: 'ticket.assigned',
    faSubject: null,
    enSubject: null,
    faBody: 'تیکت {{ticketNumber}} به شما اختصاص یافت.',
    enBody: 'Ticket {{ticketNumber}} was assigned to you.',
    channels: ['in_app'],
    variables: [{ name: 'ticketNumber', description: 'شماره تیکت / Ticket number' }],
  },
  {
    eventKey: 'document.uploaded',
    faSubject: null,
    enSubject: null,
    faBody: 'سند «{{documentName}}» با موفقیت بارگذاری شد.',
    enBody: 'Your document "{{documentName}}" was uploaded successfully.',
    channels: ['in_app'],
    variables: [{ name: 'documentName', description: 'نام سند / Document name' }],
  },
  {
    eventKey: 'document.scan_failed',
    faSubject: null,
    enSubject: null,
    faBody: 'اسکن سند «{{documentName}}» ناموفق بود.\n\nدلیل: {{reason}}',
    enBody: 'The scan of "{{documentName}}" failed.\n\nReason: {{reason}}',
    channels: ['in_app'],
    variables: [
      { name: 'documentName', description: 'نام سند / Document name' },
      { name: 'reason', description: 'دلیل خطا / Failure reason' },
    ],
  },
  {
    eventKey: 'document.quarantined',
    faSubject: null,
    enSubject: null,
    faBody: 'سند «{{documentName}}» قرنطینه شد.\n\nدلیل: {{reason}}',
    enBody: 'Document "{{documentName}}" was quarantined.\n\nReason: {{reason}}',
    channels: ['in_app'],
    variables: [
      { name: 'documentName', description: 'نام سند / Document name' },
      { name: 'reason', description: 'دلیل / Reason' },
    ],
  },
  {
    eventKey: 'document.review_completed',
    faSubject: 'نتیجه بررسی سند',
    enSubject: 'Document review completed',
    faBody: 'بررسی سند «{{documentName}}» به پایان رسید.\n\nنتیجه: {{reviewResult}}',
    enBody: 'The review of "{{documentName}}" completed.\n\nResult: {{reviewResult}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'documentName', description: 'نام سند / Document name' },
      { name: 'reviewResult', description: 'نتیجه بررسی / Review result' },
    ],
  },
  {
    eventKey: 'profile.verification_status',
    faSubject: 'وضعیت احراز هویت',
    enSubject: 'Verification status change',
    faBody: 'وضعیت احراز هویت شما به «{{status}}» تغییر کرد.',
    enBody: 'Your verification status changed to "{{status}}".',
    channels: ['email', 'in_app'],
    variables: [{ name: 'status', description: 'وضعیت جدید / New status' }],
  },
  {
    eventKey: 'profile.invitation_received',
    faSubject: 'دعوت به عضویت',
    enSubject: 'Invitation received',
    faBody: 'شما به عضویت «{{entityName}}» دعوت شده‌اید.\n\nبرای پذیرش از این لینک استفاده کنید: {{inviteLink}}',
    enBody: 'You have been invited to join "{{entityName}}".\n\nAccept via this link: {{inviteLink}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'entityName', description: 'نام نهاد / Entity name' },
      { name: 'inviteLink', description: 'لینک پذیرش / Invitation link' },
    ],
  },
  {
    eventKey: 'profile.agent_role_changed',
    faSubject: 'تغییر نقش',
    enSubject: 'Agent role changed',
    faBody: 'نقش شما در «{{entityName}}» به «{{newRole}}» تغییر کرد.',
    enBody: 'Your role at "{{entityName}}" changed to "{{newRole}}".',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'entityName', description: 'نام نهاد / Entity name' },
      { name: 'newRole', description: 'نقش جدید / New role' },
    ],
  },
  {
    eventKey: 'wallet.low_balance',
    faSubject: 'موجودی کیف پول پایین',
    enSubject: 'Low wallet balance',
    faBody: 'موجودی کیف پول شما به {{balance}} رسیده و پایین است.\n\nلطفاً برای ادامه سرویس، شارژ کنید.',
    enBody: 'Your wallet balance is low at {{balance}}.\n\nPlease top up to continue services.',
    channels: ['email', 'in_app'],
    variables: [{ name: 'balance', description: 'موجودی / Balance' }],
  },
  {
    eventKey: 'wallet.credit_received',
    faSubject: 'اعتبار کیف پول افزایش یافت',
    enSubject: 'Wallet credited',
    faBody: 'کیف پول شما به مبلغ {{amount}} افزایش یافت.\n\nدلیل: {{reason}}',
    enBody: 'Your wallet was credited with {{amount}}.\n\nReason: {{reason}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'amount', description: 'مبلغ / Amount' },
      { name: 'reason', description: 'دلیل / Reason' },
    ],
  },
  {
    eventKey: 'system.service_outage',
    faSubject: 'وقفه در سرویس',
    enSubject: 'Service outage',
    faBody: 'ما در حال رسیدگی به یک وقفه در سرویس هستیم.\n\nجزئیات: {{details}}\nزمان تقریبی بازیابی: {{eta}}',
    enBody: 'We are addressing an ongoing service outage.\n\nDetails: {{details}}\nEstimated recovery: {{eta}}',
    channels: ['email', 'in_app'],
    variables: [
      { name: 'details', description: 'جزئیات وقفه / Outage details' },
      { name: 'eta', description: 'زمان تقریبی بازیابی / Estimated recovery time' },
    ],
  },
  {
    eventKey: 'marketing.promotion',
    faSubject: 'پیشنهاد ویژه بارق‌سا',
    enSubject: 'Special offer from Barghsa',
    faBody: 'پیشنهاد ویژه بارق‌سا:\n\n{{promoBody}}',
    enBody: 'Special offer from Barghsa:\n\n{{promoBody}}',
    channels: ['email', 'in_app'],
    variables: [{ name: 'promoBody', description: 'متن پیشنهاد / Promotion copy' }],
  },
  {
    eventKey: 'system.notification_test',
    faSubject: 'تست اعلان',
    enSubject: 'Test notification',
    faBody: 'این یک اعلان تستی از بارق‌سا است. اگر این پیام را دریافت می‌کنید، قالب به درستی کار می‌کند.',
    enBody: 'This is a test notification from Barghsa. If you received it, the template works correctly.',
    channels: ['email', 'in_app'],
    variables: [],
  },
  {
    eventKey: 'admin.service_target_breached',
    faSubject: null,
    enSubject: null,
    faBody: 'آیتم «{{item_id}}» ({{service_type_name_fa}}) بیش از {{target_hours}} ساعت بدون پاسخ مانده است. لطفاً بررسی کنید.',
    enBody: 'Item {{item_id}} ({{service_type_name_en}}) has been awaiting response for over {{target_hours}} hours. Please review.',
    channels: ['in_app'],
    variables: [
      { name: 'service_type_name_fa', description: 'نام فارسی نوع خدمت / Persian service type label' },
      { name: 'service_type_name_en', description: 'English service type label' },
      { name: 'item_id', description: 'شناسه آیتم / Item id' },
      { name: 'target_hours', description: 'سقف زمانی ساعت / Target in hours' },
    ],
  },
  {
    eventKey: 'finance.chargeback_unresolved',
    faSubject: 'هشدار مالی — شارژبک حل‌نشده',
    enSubject: 'Finance alert — unresolved chargeback',
    faBody:
      'یک شارژبک ارائه‌دهنده نیاز به بررسی فوری دارد.\n\nشناسه رویداد: {{event_id}}\nوضعیت: {{status_label_fa}}\nمبلغ (ریال): {{amount_irr}}\nکیف پول: {{wallet_id}}\nتراکنش اصلی: {{original_transaction_id}}\nدلیل: {{reason}}',
    enBody:
      'A provider chargeback needs immediate finance review.\n\nEvent id: {{event_id}}\nStatus: {{status_label_en}}\nAmount (IRR): {{amount_irr}}\nWallet: {{wallet_id}}\nOriginal transaction: {{original_transaction_id}}\nReason: {{reason}}',
    channels: ['in_app', 'email'],
    variables: [
      { name: 'event_id', description: 'شناسه رویداد ارائه‌دهنده / Provider event id' },
      { name: 'status', description: 'وضعیت شارژبک / Chargeback status' },
      { name: 'status_label_fa', description: 'برچسب فارسی وضعیت / Persian status label' },
      { name: 'status_label_en', description: 'English status label' },
      { name: 'amount_irr', description: 'مبلغ به ریال / Amount in IRR' },
      { name: 'wallet_id', description: 'شناسه کیف پول / Wallet id' },
      { name: 'original_transaction_id', description: 'شناسه تراکنش اصلی / Original transaction id' },
      { name: 'reason', description: 'دلیل شارژبک / Chargeback reason' },
    ],
  },
  {
    eventKey: 'admin.service_escalated',
    faSubject: 'ارتقای فوریت — {{service_type_name_fa}}',
    enSubject: 'Escalation — {{service_type_name_en}}',
    faBody: 'آیتم «{{item_id}}» ({{service_type_name_fa}}) به دلیل عدم پاسخ در بازه زمانی، به سطح {{escalation_level}} ارتقا یافت. لطفاً بررسی کنید.',
    enBody: 'Item {{item_id}} ({{service_type_name_en}}) has been escalated to level {{escalation_level}} because no response arrived in time. Please review.',
    channels: ['in_app', 'email'],
    variables: [
      { name: 'service_type_name_fa', description: 'نام فارسی نوع خدمت / Persian service type label' },
      { name: 'service_type_name_en', description: 'English service type label' },
      { name: 'item_id', description: 'شناسه آیتم / Item id' },
      { name: 'escalation_level', description: 'سطح ارتقا (۲ = سرپرست تیم، ۳ = مدیر) / Escalation level (2 = team lead, 3 = admin)' },
    ],
  },
]

/**
 * Expand the catalog into concrete rows (one per event × channel × locale).
 *
 * Every placeholder in a body/subject is guaranteed to be in the row's
 * allow-list by construction (we pass the event's `variables` verbatim), and
 * the shared template engine validates back-references at runtime.
 */
export function buildSeedTemplates(): SeedTemplate[] {
  const rows: SeedTemplate[] = []
  for (const def of NOTIFICATION_TEMPLATE_SEED) {
    for (const channel of def.channels) {
      const isEmail = channel === 'email'
      rows.push({
        eventKey: def.eventKey,
        channel,
        locale: 'fa',
        subject: isEmail ? def.faSubject ?? null : null,
        bodyTemplate: def.faBody,
        variables: def.variables,
      })
      rows.push({
        eventKey: def.eventKey,
        channel,
        locale: 'en',
        subject: isEmail ? def.enSubject ?? null : null,
        bodyTemplate: def.enBody,
        variables: def.variables,
      })
    }
  }
  return rows
}