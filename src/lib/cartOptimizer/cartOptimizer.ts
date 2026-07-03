import type {
  CartItem,
  CartOptimizationResult,
  ComparisonItemRow,
  Product,
  UserFilters,
  Vendor,
  VendorBreakdown,
  VendorPriceItem,
} from '../types';

const money = (value: number) => Math.round(value * 100) / 100;

function formatAmount(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

export function amountKey(value?: string, vialsPerKit = 10) {
  const normalized = (value || 'unspecified')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，,]/g, '');
  const amountMatch = normalized.match(/(\d+(?:\.\d+)?)(mg|mcg|iu|ml)/);
  if (amountMatch) {
    let amount = Number(amountMatch[1]);
    let unit = amountMatch[2];
    if (unit === 'mcg') {
      amount /= 1000;
      unit = 'mg';
    }
    const explicitVials = normalized.match(/(?:[*x])(\d+)vials?/) ?? normalized.match(/(\d+)vials?/);
    const vialCount = explicitVials ? Number(explicitVials[1]) : vialsPerKit;
    return `${formatAmount(amount)}${unit}*${vialCount}vials`;
  }
  const compacted = normalized
    .replace(/vials?/g, 'vial')
    .replace(/kits?/g, 'kit')
    .trim();
  return compacted;
}

export function calculateShipping(vendor: Vendor, subtotal: number) {
  if (vendor.freeShippingThreshold && subtotal >= vendor.freeShippingThreshold) return 0;
  return vendor.defaultShippingCost || 0;
}

export function calculateDiscount(vendor: Vendor, subtotal: number, paymentMethod?: string) {
  if (paymentMethod !== 'crypto' || (!vendor.paymentMethods.includes('crypto') && !vendor.paymentMethods.includes('all_forms'))) return 0;
  if (vendor.cryptoDiscountType === 'percent') return money(subtotal * ((vendor.cryptoDiscountValue ?? 0) / 100));
  if (vendor.cryptoDiscountType === 'fixed') return Math.min(subtotal, vendor.cryptoDiscountValue ?? 0);
  return 0;
}

export function vendorMatchesFilters(vendor: Vendor, filters: UserFilters = {}) {
  if (!vendor.active) return false;
  if (filters.region && filters.region !== 'all' && vendor.region !== filters.region) return false;
  if (filters.paymentMethod && filters.paymentMethod !== 'all' && !vendor.paymentMethods.includes(filters.paymentMethod) && !vendor.paymentMethods.includes('all_forms')) return false;
  if (filters.includeVendorIds?.length && !filters.includeVendorIds.includes(vendor.id)) return false;
  if (filters.excludeVendorIds?.includes(vendor.id)) return false;
  return true;
}

function latestDate(rows: ComparisonItemRow[]) {
  return rows
    .map((row) => row.lastUpdatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
}

export function buildVendorBreakdown(
  vendor: Vendor,
  cart: CartItem[],
  products: Product[],
  prices: VendorPriceItem[],
  filters: UserFilters = {},
): VendorBreakdown {
  const productName = new Map(products.map((product) => [product.id, product.displayName]));
  const activePrices = prices.filter((price) => price.vendorId === vendor.id && price.active);
  const rows: ComparisonItemRow[] = [];
  const missingItems: string[] = [];

  cart.forEach((cartItem) => {
      const price = activePrices.find((item) => {
        if (item.productId !== cartItem.productId) return false;
        if (!cartItem.amountKey) return true;
      return amountKey(item.mgOrAmountPerVial, item.vialsPerKit) === cartItem.amountKey;
    });
    if (!price) {
      const label = productName.get(cartItem.productId) ?? cartItem.productId;
      missingItems.push(cartItem.amountLabel ? `${label} ${cartItem.amountLabel}` : label);
      return;
    }
    rows.push({
      productId: cartItem.productId,
      amountKey: cartItem.amountKey,
      productName: productName.get(cartItem.productId) ?? price.vendorProductName,
      vendorProductName: price.vendorProductName,
      sku: price.sku,
      quantity: cartItem.quantity,
      unitPrice: price.kitPrice,
      lineTotal: money(price.kitPrice * cartItem.quantity),
      amount: price.mgOrAmountPerVial,
      lastUpdatedAt: price.lastUpdatedAt,
    });
  });

  const subtotal = money(rows.reduce((sum, row) => sum + row.lineTotal, 0));
  const shipping = rows.length ? calculateShipping(vendor, subtotal) : 0;
  const discount = calculateDiscount(vendor, subtotal, filters.paymentMethod);

  return {
    vendor,
    items: rows,
    missingItems,
    subtotal,
    shipping,
    discount,
    finalTotal: money(subtotal + shipping - discount),
    paymentMethods: vendor.paymentMethods,
    deliveryEstimate: vendor.averageDeliveryTime,
    lastUpdated: latestDate(rows) ?? vendor.lastUpdatedAt,
  };
}

function splitSearch(
  cart: CartItem[],
  completeVendorRows: VendorBreakdown[],
  filters: UserFilters = {},
): { vendors: VendorBreakdown[]; total: number } | undefined {
  if (!cart.length) return undefined;

  const candidatesByProduct = cart.map((item) => ({
    productId: item.productId,
    amountKey: item.amountKey,
    candidates: completeVendorRows
      .map((row) => ({
        row,
        item: row.items.find((candidate) => candidate.productId === item.productId && (!item.amountKey || candidate.amountKey === item.amountKey)),
      }))
      .filter((entry): entry is { row: VendorBreakdown; item: ComparisonItemRow } => Boolean(entry.item)),
  }));

  if (candidatesByProduct.some((entry) => entry.candidates.length === 0)) return undefined;

  type SplitState = {
    assignments: string[];
    itemsByVendor: Map<string, ComparisonItemRow[]>;
    total: number;
  };

  const sourceByVendor = new Map(completeVendorRows.map((row) => [row.vendor.id, row]));
  const beamSize = 600;

  function buildRows(state: SplitState) {
    return [...state.itemsByVendor.entries()].map(([vendorId, items]) => {
      const source = sourceByVendor.get(vendorId)!;
      const subtotal = money(items.reduce((sum, item) => sum + item.lineTotal, 0));
      const shipping = calculateShipping(source.vendor, subtotal);
      const discount = calculateDiscount(source.vendor, subtotal, filters.paymentMethod);
      return {
        ...source,
        items,
        missingItems: [],
        subtotal,
        shipping,
        discount,
        finalTotal: money(subtotal + shipping - discount),
      };
    });
  }

  function stateTotal(state: SplitState) {
    return money(buildRows(state).reduce((sum, row) => sum + row.finalTotal, 0));
  }

  let states: SplitState[] = [{ assignments: [], itemsByVendor: new Map(), total: 0 }];

  candidatesByProduct.forEach((entry) => {
    const nextStates: SplitState[] = [];
    const seen = new Set<string>();

    states.forEach((state) => {
      entry.candidates.forEach(({ row, item }) => {
        const nextAssignments = [...state.assignments, row.vendor.id];
        const key = nextAssignments.join('|');
        if (seen.has(key)) return;
        seen.add(key);

        const nextItemsByVendor = new Map(state.itemsByVendor);
        nextItemsByVendor.set(row.vendor.id, [...(nextItemsByVendor.get(row.vendor.id) ?? []), item]);
        const nextState = { assignments: nextAssignments, itemsByVendor: nextItemsByVendor, total: 0 };
        nextState.total = stateTotal(nextState);
        nextStates.push(nextState);
      });
    });

    states = nextStates
      .sort((a, b) => a.total - b.total || a.itemsByVendor.size - b.itemsByVendor.size)
      .slice(0, beamSize);
  });

  const bestState = states.sort((a, b) => a.total - b.total)[0];
  if (!bestState) return undefined;

  const vendors = buildRows(bestState).sort((a, b) => a.finalTotal - b.finalTotal);
  return { vendors, total: money(vendors.reduce((sum, row) => sum + row.finalTotal, 0)) };
}

export function optimizeCart(
  cart: CartItem[],
  vendors: Vendor[],
  products: Product[],
  prices: VendorPriceItem[],
  filters: UserFilters = {},
): CartOptimizationResult {
  const cleanCart = cart.filter((item) => item.quantity > 0);
  const eligibleVendors = vendors.filter((vendor) => vendorMatchesFilters(vendor, filters));
  const vendorComparisonRows = eligibleVendors
    .map((vendor) => buildVendorBreakdown(vendor, cleanCart, products, prices, filters))
    .filter((row) => row.items.length || row.missingItems.length)
    .sort((a, b) => a.finalTotal - b.finalTotal);

  const fullVendorOptions = vendorComparisonRows.filter((row) => row.missingItems.length === 0 && row.items.length);
  const bestSingleVendor = fullVendorOptions[0];
  const partialVendorOptions = vendorComparisonRows
    .filter((row) => row.missingItems.length > 0 && row.items.length > 0)
    .sort((a, b) => b.items.length - a.items.length || a.finalTotal - b.finalTotal);

  const split = splitSearch(cleanCart, vendorComparisonRows, filters);
  const bestSplitOrder =
    split && split.vendors.length > 1
      ? {
          vendors: split.vendors,
          total: split.total,
          savingsVsSingle: bestSingleVendor ? money(bestSingleVendor.finalTotal - split.total) : undefined,
          note:
            bestSingleVendor && split.total < bestSingleVendor.finalTotal
              ? `Split ordering saves $${money(bestSingleVendor.finalTotal - split.total).toFixed(2)} compared to the best single-vendor option, but requires ${split.vendors.length} separate orders.`
              : `Split ordering can fulfill the cart with ${split.vendors.length} separate orders.`,
        }
      : undefined;

  return { bestSingleVendor, bestSplitOrder, partialVendorOptions, vendorComparisonRows };
}
