import type { PaymentMethod, VendorBreakdown } from '../types';
import { displayAmountLabel } from '../pricing/amount';
import { paymentMethodLabel } from '../pricing/payment';

export function buildWhatsAppMessage(order: VendorBreakdown, paymentMethod?: PaymentMethod | 'all') {
  const greeting = order.vendor.contactName ? `Hello ${order.vendor.contactName},` : 'Hello,';
  const lines = order.items.map((item, index) => {
    const code = item.sku || `Item ${index + 1}`;
    const amount = item.amount ? ` - ${displayAmountLabel(item.amount)}` : '';
    return `${index + 1}. ${code}${amount} - Qty: ${item.quantity} kit${item.quantity === 1 ? '' : 's'}`;
  });

  return [
    greeting,
    '',
    'I would like to place an order for:',
    '',
    ...lines,
    '',
    `Please confirm current availability, pricing, shipping, and payment instructions${paymentMethod && paymentMethod !== 'all' ? ` for ${paymentMethodLabel(paymentMethod)}` : ''}.`,
    '',
    'Thank you.',
  ].filter((line, index, list) => line || list[index - 1]).join('\n');
}

export function buildWhatsAppUrl(phoneNumber: string | undefined, message: string) {
  if (!phoneNumber) return undefined;
  const digits = phoneNumber.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  return `whatsapp://send?phone=${digits}&text=${encodeURIComponent(message)}`;
}

export function buildWhatsAppWebUrl(phoneNumber: string | undefined, message: string) {
  if (!phoneNumber) return undefined;
  const digits = phoneNumber.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
