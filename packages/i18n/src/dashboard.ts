import type { Locale } from './app.js';

const en = {
  'invoice.title': 'Upcoming invoices',
  'invoice.viewAll': 'View all',
  'invoice.empty': 'No unpaid invoices for this profile.',
  'invoice.label': 'Invoice {id}',
  'invoice.dueDate': 'Due',
  'invoice.overdue': 'Overdue',
  'invoice.dueToday': 'Due today',
  'invoice.daysRemaining': '{count} days remaining',
  'invoice.payNow': 'Pay now',
  'invoice.view': 'View invoice',
  'orders.title': 'Recent orders',
  'orders.empty': 'No orders for this profile yet.',
  'orders.electricity': 'Electricity order',
  'orders.saving': 'Saving order',
  'orders.amountUnavailable': 'Amount not available yet',
  'orders.view': 'View order',
  'orders.viewAllElectricity': 'View all electricity orders',
  'orders.viewAllSaving': 'View all saving orders',
  'contracts.empty': 'No active contracts for this profile.',
  'contracts.progressUnavailable': 'Term progress is not available yet.',
  'contracts.progress': '{percent}% of term elapsed',
  'contracts.view': 'View contract',
};

const fa: Record<keyof typeof en, string> = {
  'invoice.title': 'فاکتورهای پیش‌رو',
  'invoice.viewAll': 'مشاهده همه',
  'invoice.empty': 'فاکتور پرداخت‌نشده‌ای برای این پروفایل ندارید.',
  'invoice.label': 'فاکتور {id}',
  'invoice.dueDate': 'سررسید',
  'invoice.overdue': 'از سررسید گذشته',
  'invoice.dueToday': 'سررسید امروز',
  'invoice.daysRemaining': '{count} روز تا سررسید',
  'invoice.payNow': 'پرداخت',
  'invoice.view': 'مشاهده فاکتور',
  'orders.title': 'آخرین سفارش‌ها',
  'orders.empty': 'سفارشی برای این پروفایل ثبت نشده است.',
  'orders.electricity': 'سفارش برق',
  'orders.saving': 'سفارش صرفه‌جویی',
  'orders.amountUnavailable': 'مبلغ هنوز مشخص نشده است',
  'orders.view': 'مشاهده سفارش',
  'orders.viewAllElectricity': 'مشاهده همه سفارش‌های برق',
  'orders.viewAllSaving': 'مشاهده همه سفارش‌های صرفه‌جویی',
  'contracts.empty': 'قرارداد فعالی برای این پروفایل ندارید.',
  'contracts.progressUnavailable': 'پیشرفت دوره هنوز در دسترس نیست.',
  'contracts.progress': '{percent}٪ از دوره سپری شده',
  'contracts.view': 'مشاهده قرارداد',
};

export function dashboardText(key: keyof typeof en, locale: Locale): string {
  return locale === 'fa' ? fa[key] : en[key];
}
