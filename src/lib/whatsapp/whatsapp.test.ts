import { describe, expect, it } from 'vitest';
import { seedPrices, seedProducts, seedVendors } from '../../data/seed';
import { buildVendorBreakdown } from '../cartOptimizer/cartOptimizer';
import { buildWhatsAppMessage, buildWhatsAppUrl, buildWhatsAppWebUrl } from './whatsapp';

describe('whatsapp helpers', () => {
  it('generates an order message and link', () => {
    const order = buildVendorBreakdown(seedVendors[0], [{ productId: 'hgh-191aa', quantity: 1 }], seedProducts, seedPrices, { paymentMethod: 'crypto' });
    const message = buildWhatsAppMessage(order, 'crypto');

    expect(message).toContain('H10');
    expect(message).toContain('Qty: 1 kit');
    expect(message).toContain('Please confirm current availability, pricing, shipping, and payment instructions for Crypto');
    expect(message).not.toContain('HGH');
    expect(message).not.toContain('approximately');
    expect(message).not.toContain('comparison tool');
    expect(message).not.toContain('Vendor note');
    expect(message).not.toContain(seedVendors[0].notes);
    expect(buildWhatsAppUrl(seedVendors[0].whatsappNumber, message)).toContain('whatsapp://send');
    expect(buildWhatsAppWebUrl(seedVendors[0].whatsappNumber, message)).toContain('https://wa.me/');
  });
});
