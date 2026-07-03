import { describe, expect, it } from 'vitest';
import { realPrices, realProducts, realVendors } from '../../data/realSeed';
import { seedPrices, seedProducts, seedVendors } from '../../data/seed';
import { amountKey, calculateDiscount, calculateShipping, optimizeCart, vendorMatchesFilters } from './cartOptimizer';

describe('cart optimizer', () => {
  it('calculates free shipping threshold', () => {
    expect(calculateShipping(seedVendors[0], 500)).toBe(0);
    expect(calculateShipping(seedVendors[0], 100)).toBe(18);
  });

  it('normalizes equivalent amount labels', () => {
    expect(amountKey('5 mg/vial, 10vial/kits')).toBe(amountKey('5mg*10vials'));
    expect(amountKey('10mg*10')).toBe(amountKey('10 mg/vial, 10vial/kits'));
    expect(amountKey('100mcg*10vials')).toBe(amountKey('0.1mg*10vials'));
    expect(amountKey('10 IU')).toBe(amountKey('10 IU/vial'));
    expect(amountKey('10mg')).toBe(amountKey('10mg*10vials'));
    expect(amountKey('10ml')).toBe(amountKey('10ml*10vials'));
    expect(amountKey('60mg', 6)).toBe(amountKey('60mg*6vials'));
    expect(amountKey('5mg', 5)).not.toBe(amountKey('5mg', 10));
  });

  it('calculates crypto discounts', () => {
    expect(calculateDiscount(seedVendors[0], 200, 'crypto')).toBe(10);
    expect(calculateDiscount(seedVendors[0], 200, 'wire')).toBe(0);
  });

  it('filters vendors by payment method and region', () => {
    expect(vendorMatchesFilters(seedVendors[0], { paymentMethod: 'crypto', region: 'domestic' })).toBe(true);
    expect(vendorMatchesFilters(seedVendors[1], { paymentMethod: 'wire', region: 'domestic' })).toBe(false);
  });

  it('finds a best single vendor when one vendor can fulfill the cart', () => {
    const result = optimizeCart(
      [
        { productId: 'hgh-191aa', quantity: 1 },
        { productId: 'tirzepatide', quantity: 1 },
      ],
      seedVendors,
      seedProducts,
      seedPrices,
      { paymentMethod: 'crypto', region: 'all' },
    );

    expect(result.bestSingleVendor?.vendor.id).toBe('vendor-b');
    expect(result.bestSingleVendor?.missingItems).toHaveLength(0);
  });

  it('reports missing items and partial vendors', () => {
    const result = optimizeCart(
      [
        { productId: 'dsip', quantity: 1 },
        { productId: 'retatrutide', quantity: 1 },
      ],
      seedVendors,
      seedProducts,
      seedPrices,
      { paymentMethod: 'all', region: 'all' },
    );

    expect(result.bestSingleVendor).toBeUndefined();
    expect(result.partialVendorOptions.length).toBeGreaterThan(0);
  });

  it('finds split orders across vendors', () => {
    const result = optimizeCart(
      [
        { productId: 'ss-31', quantity: 1 },
        { productId: 'ghk-cu', quantity: 1 },
      ],
      seedVendors,
      seedProducts,
      seedPrices,
      { paymentMethod: 'all', region: 'all' },
    );

    expect(result.bestSplitOrder?.vendors).toHaveLength(2);
  });

  it('keeps real catalog optimization responsive for larger carts', () => {
    const cart = realPrices
      .filter((price) => price.active)
      .slice(0, 14)
      .map((price) => ({
        productId: price.productId,
        amountKey: amountKey(price.mgOrAmountPerVial, price.vialsPerKit),
        quantity: 1,
      }));

    const startedAt = performance.now();
    const result = optimizeCart(cart, realVendors, realProducts, realPrices, { paymentMethod: 'all', region: 'all' });
    const elapsedMs = performance.now() - startedAt;

    expect(result.vendorComparisonRows.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(500);
  });
});
