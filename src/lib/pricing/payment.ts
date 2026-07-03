import type { PaymentMethod } from '../types';

export function paymentMethodLabel(method: PaymentMethod | 'all') {
  if (method === 'all') return 'All payments';
  if (method === 'crypto') return 'Crypto';
  if (method === 'wire') return 'Wire';
  return 'All Forms';
}

export function paymentMethodsLabel(methods: PaymentMethod[]) {
  return methods.map(paymentMethodLabel).join(', ');
}

