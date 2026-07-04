import { Download, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { categories } from '../data/seed';
import { replaceApprovedMembersFromRows } from '../lib/auth/authUtils';
import { amountKey, vendorShippingRule } from '../lib/cartOptimizer/cartOptimizer';
import { displayAmountLabel } from '../lib/pricing/amount';
import type { AppSettings, AppUser, ApprovedMember, CsvImportSummary, PaymentMethod, Product, ProductCategory, Vendor, VendorPriceItem } from '../lib/types';

type AdminPortalProps = {
  currentUser: AppUser;
  members: ApprovedMember[];
  vendors: Vendor[];
  products: Product[];
  prices: VendorPriceItem[];
  settings: AppSettings;
  onMembers: (members: ApprovedMember[]) => void;
  onVendors: (vendors: Vendor[]) => void;
  onProducts: (products: Product[]) => void;
  onPrices: (prices: VendorPriceItem[]) => void;
  onSettings: (settings: AppSettings) => void;
  cloudSaveStatus?: string;
  cloudSaveBlocked?: boolean;
  onRetryCloudSave?: () => Promise<unknown>;
  onRefreshData: () => Promise<void>;
};

type ExtractedPriceRow = {
  sku?: string;
  vendorProductName?: string;
  mgOrAmountPerVial?: string;
  vialsPerKit?: number;
  kitPrice?: number | null;
  confidence?: number;
  warnings?: string[];
};

type ExtractPriceListResponse = {
  parsedStatus: string;
  rows: ExtractedPriceRow[];
};

type BackupPayload = {
  version: 1;
  exportedAt: string;
  source: 'official-price-tool';
  members: ApprovedMember[];
  vendors: Vendor[];
  products: Product[];
  prices: VendorPriceItem[];
  settings: AppSettings;
};

type BackupReview = {
  payload: BackupPayload;
  warnings: string[];
  diff: {
    membersAdded: number;
    membersRemoved: number;
    membersUpdated: number;
    vendorsAdded: number;
    vendorsRemoved: number;
    vendorsUpdated: number;
    productsAdded: number;
    productsRemoved: number;
    productsUpdated: number;
    pricesAdded: number;
    pricesRemoved: number;
    pricesUpdated: number;
  };
};

type ReviewSeverity = 'high' | 'medium' | 'low' | 'ok';
type ImportWarning = {
  vendorId: string;
  vendorName: string;
  sku: string;
  rawSpec: string;
  productName: string;
  extractedSpec: string;
  correctedSpec: string;
  message: string;
};

const realImportWarnings: ImportWarning[] = [];
const maxPdfBytes = 18 * 1024 * 1024;
const pdfWarningBytes = 10 * 1024 * 1024;
const extractionTimeoutMs = 320_000;
const newCatalogProductId = '__new_catalog_item__';

const extractionNameCorrections: Array<[RegExp, string]> = [
  [/samaglutide/gi, 'Semaglutide'],
  [/semiglutide/gi, 'Semaglutide'],
  [/trizepatide/gi, 'Tirzepatide'],
  [/tirezpatide/gi, 'Tirzepatide'],
  [/tirzapatide/gi, 'Tirzepatide'],
  [/retatrutide\s*\+\s*trizepatide/gi, 'Retatrutide + Tirzepatide'],
  [/asetic acid water/gi, 'Acetic Acid Water'],
  [/bacteriostatic/gi, 'Bacteriostatic'],
];

function searchableKey(value?: string) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function slugifyId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/(.{1,40}).*/, '$1')
    .replace(/-+$/g, '') || 'new-item';
}

function normalizeExtractedName(value: string) {
  return extractionNameCorrections.reduce((next, [pattern, replacement]) => next.replace(pattern, replacement), value).replace(/\s+/g, ' ').trim();
}

function isLiquidListing(...values: Array<string | undefined>) {
  const key = searchableKey(values.filter(Boolean).join(' '));
  return /(?:water|liquid|aceticacid|bacteriostatic|bacwater|sterilewater)/.test(key);
}

function normalizeLiquidAmount(value?: string) {
  const normalized = normalizeExtractedAmount(value);
  if (!normalized) return normalized;
  return normalized.replace(/(\d+(?:\.\d+)?)\s*mg\b/i, '$1ml');
}

function uniqueProductId(baseName: string, existingProducts: Product[], queuedIds: Set<string>) {
  const base = slugifyId(baseName);
  let candidate = base;
  let suffix = 2;
  const existingIds = new Set(existingProducts.map((product) => product.id));
  while (existingIds.has(candidate) || queuedIds.has(candidate) || candidate === newCatalogProductId) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  queuedIds.add(candidate);
  return candidate;
}

function findProductForExtractedRow(row: ExtractedPriceRow, products: Product[]) {
  const rawName = row.vendorProductName || row.sku || '';
  const correctedName = normalizeExtractedName(rawName);
  const combinedKey = searchableKey(`${correctedName} ${row.sku ?? ''}`);
  const skuKey = searchableKey(row.sku);
  const scored = products.map((product) => {
    const names = [product.displayName, product.masterName];
    const nameKeys = names.map(searchableKey).filter(Boolean);
    const aliasKeys = product.aliases.map(searchableKey).filter((alias) => alias.length >= 4);
    let score = 0;
    if (nameKeys.some((key) => key && combinedKey === key)) score = Math.max(score, 120);
    if (nameKeys.some((key) => key && combinedKey.includes(key))) score = Math.max(score, 105);
    if (aliasKeys.some((key) => key && combinedKey === key)) score = Math.max(score, 95);
    if (aliasKeys.some((key) => key && skuKey === key)) score = Math.max(score, 90);
    if (aliasKeys.some((key) => key.length >= 6 && combinedKey.includes(key))) score = Math.max(score, 80);
    return { product, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  return best?.score >= 80 ? { product: best.product, correctedName, score: best.score } : { product: undefined, correctedName, score: best?.score ?? 0 };
}

function findExistingVendorSkuPrice(row: ExtractedPriceRow, prices: VendorPriceItem[], vendorId: string) {
  const skuKey = searchableKey(row.sku);
  if (!skuKey) return undefined;
  return prices.find((price) =>
    price.vendorId === vendorId
    && price.active
    && searchableKey(price.sku) === skuKey,
  );
}

function normalizeExtractedAmount(value?: string) {
  const label = displayAmountLabel(value);
  return label === 'Unspecified' ? value : label;
}

function normalizeSku(value?: string) {
  return (value ?? '').trim().toLowerCase();
}

function extractionErrorMessage(error: unknown) {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code) : '';
  const message = error instanceof Error ? error.message : String(error || '');
  if (code.includes('deadline-exceeded') || message.includes('deadline-exceeded')) {
    return 'PDF extraction timed out before the AI returned rows. Try the upload again, or use a smaller/simpler PDF and add any missed SKUs manually in the review queue.';
  }
  if (code.includes('resource-exhausted')) {
    return message || 'PDF extraction hit an AI service limit. Try again in a few minutes.';
  }
  return message || 'PDF extraction failed.';
}

function reviewRowMatchesExistingPrice(reviewRow: VendorPriceItem, existingRow: VendorPriceItem) {
  if (reviewRow.vendorId !== existingRow.vendorId || reviewRow.productId !== existingRow.productId) return false;

  const reviewSku = normalizeSku(reviewRow.sku);
  const existingSku = normalizeSku(existingRow.sku);
  const sameSku = Boolean(reviewSku && existingSku && reviewSku === existingSku);
  const sameAmount = amountKey(reviewRow.mgOrAmountPerVial, reviewRow.vialsPerKit) === amountKey(existingRow.mgOrAmountPerVial, existingRow.vialsPerKit);
  if (sameSku) return true;
  if (!sameAmount) return false;

  return !reviewSku || !existingSku || reviewSku === existingSku;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown) {
  return typeof value === 'boolean';
}

function isPaymentMethods(value: unknown): value is PaymentMethod[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => item === 'crypto' || item === 'wire' || item === 'all_forms');
}

function isCategories(value: unknown): value is ProductCategory[] {
  const allowed = new Set<string>([...categories, 'Other / Needs Review']);
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && allowed.has(item));
}

function validateMembers(rows: unknown[], warnings: string[]) {
  const emails = new Set<string>();
  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      warnings.push(`Member row ${index + 1} is not an object.`);
      return;
    }
    if (!isString(row.email) || !String(row.email).includes('@')) warnings.push(`Member row ${index + 1} is missing a valid email.`);
    if (emails.has(String(row.email))) warnings.push(`Member row ${index + 1} duplicates email ${String(row.email)}.`);
    emails.add(String(row.email));
    if (!['csv', 'zapier', 'manual'].includes(String(row.source))) warnings.push(`Member row ${index + 1} has an invalid source.`);
    if (!isBoolean(row.active)) warnings.push(`Member row ${index + 1} is missing active true/false.`);
    if (!isString(row.createdAt) || !isString(row.updatedAt)) warnings.push(`Member row ${index + 1} is missing timestamps.`);
  });
}

function validateVendors(rows: unknown[], warnings: string[]) {
  const ids = new Set<string>();
  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      warnings.push(`Vendor row ${index + 1} is not an object.`);
      return;
    }
    if (!isString(row.id)) warnings.push(`Vendor row ${index + 1} is missing an id.`);
    if (ids.has(String(row.id))) warnings.push(`Vendor row ${index + 1} duplicates id ${String(row.id)}.`);
    ids.add(String(row.id));
    if (!isString(row.vendorName)) warnings.push(`Vendor row ${index + 1} is missing a name.`);
    if (!['domestic', 'overseas', 'mixed', 'unknown'].includes(String(row.region))) warnings.push(`Vendor row ${index + 1} has an invalid region.`);
    if (!isFiniteNumber(row.defaultShippingCost) || Number(row.defaultShippingCost) < 0) warnings.push(`Vendor row ${index + 1} has an invalid shipping cost.`);
    if (!isPaymentMethods(row.paymentMethods)) warnings.push(`Vendor row ${index + 1} has invalid payment methods.`);
    if (!['none', 'percent', 'fixed', 'custom'].includes(String(row.cryptoDiscountType))) warnings.push(`Vendor row ${index + 1} has an invalid crypto discount type.`);
    if (!isBoolean(row.active)) warnings.push(`Vendor row ${index + 1} is missing active true/false.`);
    if (!isString(row.lastUpdatedAt)) warnings.push(`Vendor row ${index + 1} is missing lastUpdatedAt.`);
  });
}

function validateProducts(rows: unknown[], warnings: string[]) {
  const ids = new Set<string>();
  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      warnings.push(`Product row ${index + 1} is not an object.`);
      return;
    }
    if (!isString(row.id)) warnings.push(`Product row ${index + 1} is missing an id.`);
    if (ids.has(String(row.id))) warnings.push(`Product row ${index + 1} duplicates id ${String(row.id)}.`);
    ids.add(String(row.id));
    if (!isString(row.masterName) || !isString(row.displayName)) warnings.push(`Product row ${index + 1} is missing names.`);
    if (!Array.isArray(row.aliases) || !row.aliases.every((alias) => typeof alias === 'string')) warnings.push(`Product row ${index + 1} has invalid aliases.`);
    if (!isCategories(row.categories)) warnings.push(`Product row ${index + 1} has invalid categories.`);
    if (!['mg', 'mcg', 'IU', 'vial', 'kit', 'blend', 'other'].includes(String(row.unitType))) warnings.push(`Product row ${index + 1} has an invalid unit type.`);
    if (!isBoolean(row.active)) warnings.push(`Product row ${index + 1} is missing active true/false.`);
    if (!isString(row.createdAt) || !isString(row.updatedAt)) warnings.push(`Product row ${index + 1} is missing timestamps.`);
  });
}

function validatePrices(rows: unknown[], vendorIds: Set<string>, productIds: Set<string>, warnings: string[]) {
  const ids = new Set<string>();
  rows.forEach((row, index) => {
    if (!isRecord(row)) {
      warnings.push(`Price row ${index + 1} is not an object.`);
      return;
    }
    if (!isString(row.id)) warnings.push(`Price row ${index + 1} is missing an id.`);
    if (ids.has(String(row.id))) warnings.push(`Price row ${index + 1} duplicates id ${String(row.id)}.`);
    ids.add(String(row.id));
    if (!isString(row.vendorId) || !vendorIds.has(String(row.vendorId))) warnings.push(`Price row ${index + 1} references an unknown vendor.`);
    if (!isString(row.productId) || !productIds.has(String(row.productId))) warnings.push(`Price row ${index + 1} references an unknown product.`);
    if (!isString(row.vendorProductName)) warnings.push(`Price row ${index + 1} is missing vendor listing name.`);
    if (!isOptionalString(row.sku) || !isOptionalString(row.mgOrAmountPerVial) || !isOptionalString(row.notes)) warnings.push(`Price row ${index + 1} has invalid optional text fields.`);
    if (!['mg', 'mcg', 'IU', 'vial', 'kit', 'blend', 'other'].includes(String(row.unitType))) warnings.push(`Price row ${index + 1} has an invalid unit type.`);
    if (!isFiniteNumber(row.vialsPerKit) || Number(row.vialsPerKit) < 1) warnings.push(`Price row ${index + 1} has an invalid vial count.`);
    if (!isFiniteNumber(row.kitPrice) || Number(row.kitPrice) < 0) warnings.push(`Price row ${index + 1} has an invalid kit price.`);
    if (row.currency !== 'USD') warnings.push(`Price row ${index + 1} must use USD currency.`);
    if (!isBoolean(row.active)) warnings.push(`Price row ${index + 1} is missing active true/false.`);
    if (!isString(row.lastUpdatedAt)) warnings.push(`Price row ${index + 1} is missing lastUpdatedAt.`);
  });
}

function validateSettings(value: unknown, warnings: string[]) {
  if (!isRecord(value)) {
    warnings.push('Settings must be an object.');
    return;
  }
  if (!isString(value.disclaimerText)) warnings.push('Settings are missing disclaimer text.');
  if (!isString(value.coaReminderText)) warnings.push('Settings are missing COA reminder text.');
  if (!isFiniteNumber(value.sessionMaxHours) || Number(value.sessionMaxHours) <= 0) warnings.push('Settings have an invalid session length.');
}

function countDiff<T>(current: T[], next: T[], keyFor: (item: T) => string) {
  const currentMap = new Map(current.map((item) => [keyFor(item), item]));
  const nextMap = new Map(next.map((item) => [keyFor(item), item]));
  const added = [...nextMap.keys()].filter((key) => !currentMap.has(key)).length;
  const removed = [...currentMap.keys()].filter((key) => !nextMap.has(key)).length;
  const updated = [...nextMap.entries()].filter(([key, item]) => currentMap.has(key) && JSON.stringify(currentMap.get(key)) !== JSON.stringify(item)).length;
  return { added, removed, updated };
}

function reviewSeverity(notes?: string): ReviewSeverity {
  const text = notes ?? '';
  if (text.includes('[HIGH]')) return 'high';
  if (text.includes('[MED]')) return 'medium';
  if (text.includes('[LOW]')) return 'low';
  return 'ok';
}

function reviewSeverityLabel(severity: ReviewSeverity) {
  if (severity === 'high') return 'High';
  if (severity === 'medium') return 'Medium';
  if (severity === 'low') return 'Low';
  return 'OK';
}

function priceMatches(currentPrice: number, extractedPrice: number) {
  return Math.abs(Number(currentPrice) - Number(extractedPrice)) < 0.01;
}

function formatReviewPrice(value: number) {
  return `$${Number(value).toFixed(2)}`;
}

function formatReviewSpec(amount?: string, vialsPerKit = 10) {
  const label = displayAmountLabel(amount);
  return vialsPerKit === 10 ? label : `${label}, ${vialsPerKit} vials`;
}

function buildImportRuleWarnings({
  row,
  prices,
  product,
  matchScore,
  amount,
  vialsPerKit,
  kitPrice,
  vendorId,
  existingSkuPrice,
  rawName,
  correctedName,
}: {
  row: ExtractedPriceRow;
  prices: VendorPriceItem[];
  product?: Product;
  matchScore: number;
  amount: string;
  vialsPerKit: number;
  kitPrice: number;
  vendorId: string;
  existingSkuPrice?: VendorPriceItem;
  rawName: string;
  correctedName: string;
}) {
  const warnings: string[] = [];
  const skuKey = searchableKey(row.sku);

  if (kitPrice <= 0) warnings.push('[HIGH] Missing or zero price detected.');
  if (!skuKey) warnings.push('[HIGH] No SKU was extracted. Verify this line item manually.');

  if (skuKey && product) {
    const conflictingProductIds = [...new Set(prices
      .filter((price) => price.vendorId === vendorId && searchableKey(price.sku) === skuKey && price.productId !== product.id)
      .map((price) => price.productId))];
    if (conflictingProductIds.length) {
      warnings.push(`[HIGH] SKU already exists under different product id(s): ${conflictingProductIds.join(', ')}.`);
    }
  }

  if (existingSkuPrice) {
    const sameAmount = amountKey(existingSkuPrice.mgOrAmountPerVial, existingSkuPrice.vialsPerKit) === amountKey(amount, vialsPerKit);
    const samePrice = priceMatches(existingSkuPrice.kitPrice, kitPrice);
    const existingSpec = formatReviewSpec(existingSkuPrice.mgOrAmountPerVial, existingSkuPrice.vialsPerKit);
    const extractedSpec = formatReviewSpec(amount, vialsPerKit);
    const existingPrice = formatReviewPrice(existingSkuPrice.kitPrice);
    const extractedPrice = formatReviewPrice(kitPrice);

    if (sameAmount && samePrice) {
      warnings.push(`[OK] SKU matched, price confirmed, existing listing. Kept verified listing "${existingSkuPrice.vendorProductName}".`);
    } else if (sameAmount) {
      warnings.push(`[LOW] SKU matched existing listing; price changed from ${existingPrice} to ${extractedPrice}.`);
    } else {
      warnings.push(`[MED] SKU matched existing listing, but size changed from ${existingSpec} to ${extractedSpec}. Verify as a new dose/vial size before publishing.`);
    }

    if (searchableKey(rawName) !== searchableKey(correctedName)) {
      warnings.push(`PDF listing read as "${rawName}"; using verified listing "${correctedName}".`);
    }
  } else {
    warnings.push('[HIGH] New SKU for this vendor. No active listing matched this SKU; verify product, listing, amount, vials, and price before publishing.');
    if (product && matchScore >= 80) {
      warnings.push(`Catalog guess: ${product.displayName}.`);
    } else {
      warnings.push(`Product mapping needs review; best catalog score ${matchScore}.`);
    }
    if (vialsPerKit !== 10) warnings.push(`[MED] Non-standard vial count detected: ${vialsPerKit}.`);
  }

  if (!existingSkuPrice && product && kitPrice > 0) {
    const comparablePrices = prices
      .filter((price) =>
        price.active
        && price.productId === product.id
        && price.kitPrice > 0
        && amountKey(price.mgOrAmountPerVial, price.vialsPerKit) === amountKey(amount, vialsPerKit),
      )
      .map((price) => price.kitPrice);

    if (comparablePrices.length >= 3) {
      const baseline = median(comparablePrices);
      const ratio = kitPrice > baseline ? kitPrice / baseline : baseline / kitPrice;
      if (ratio >= 2.5) {
        warnings.push(`[MED] Price is ${ratio.toFixed(1)}x away from current median $${baseline.toFixed(2)} for this product/amount.`);
      }
    }
  }

  (row.warnings ?? []).forEach((warning) => {
    warnings.push(`Extractor note: ${warning}`);
  });

  return warnings;
}

export function AdminPortal({
  currentUser,
  members,
  vendors,
  products,
  prices,
  settings,
  onMembers,
  onVendors,
  onProducts,
  onPrices,
  onSettings,
  cloudSaveStatus,
  cloudSaveBlocked,
  onRetryCloudSave,
  onRefreshData,
}: AdminPortalProps) {
  const [tab, setTab] = useState<'members' | 'vendors' | 'prices' | 'quality' | 'backup' | 'warnings'>('vendors');
  const [summary, setSummary] = useState<CsvImportSummary>();
  const [reviewRows, setReviewRows] = useState<VendorPriceItem[]>([]);
  const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
  const [missingFromPdfRows, setMissingFromPdfRows] = useState<VendorPriceItem[]>([]);
  const [selectedMissingFromPdfIds, setSelectedMissingFromPdfIds] = useState<string[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState(() => vendors[0]?.id ?? '');
  const [priceSearch, setPriceSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [adminDensity, setAdminDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [backupStatus, setBackupStatus] = useState('');
  const [backupReview, setBackupReview] = useState<BackupReview>();
  const [extractionStatus, setExtractionStatus] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [qualityRefreshStatus, setQualityRefreshStatus] = useState('');
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product.displayName])), [products]);
  const vendorMap = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor.vendorName])), [vendors]);
  const productLookup = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const activeVendorId = vendors.some((vendor) => vendor.id === selectedVendorId) ? selectedVendorId : vendors[0]?.id ?? '';
  const selectedVendor = vendors.find((vendor) => vendor.id === activeVendorId);
  const priceQuery = priceSearch.trim().toLowerCase();

  const refreshDataQuality = useCallback(async (reason = 'manual') => {
    if (reason === 'manual') setQualityRefreshStatus('Refreshing live price data...');
    try {
      await onRefreshData();
      setQualityRefreshStatus(`Live price data refreshed at ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
    } catch {
      setQualityRefreshStatus('Live price data could not be refreshed. The current local view is still shown.');
    }
  }, [onRefreshData]);

  useEffect(() => {
    if (tab !== 'quality') return undefined;
    const initial = window.setTimeout(() => void refreshDataQuality('auto'), 1500);
    const interval = window.setInterval(() => void refreshDataQuality('auto'), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refreshDataQuality, tab]);

  const selectedVendorPrices = prices
    .filter((price) => price.vendorId === activeVendorId)
    .filter((price) => {
      if (!priceQuery) return true;
      return [
        productMap.get(price.productId) ?? '',
        price.vendorProductName,
        price.sku ?? '',
        price.mgOrAmountPerVial ?? '',
      ].join(' ').toLowerCase().includes(priceQuery);
    });
  const priceCounts = useMemo(() => {
    const counts = new Map<string, { total: number; active: number }>();
    prices.forEach((price) => {
      const current = counts.get(price.vendorId) ?? { total: 0, active: 0 };
      current.total += 1;
      if (price.active) current.active += 1;
      counts.set(price.vendorId, current);
    });
    return counts;
  }, [prices]);
  const productCoverage = useMemo(() => {
    const coverage = new Map<string, { total: number; active: number; vendorIds: Set<string> }>();
    products.forEach((product) => coverage.set(product.id, { total: 0, active: 0, vendorIds: new Set() }));
    prices.forEach((price) => {
      const current = coverage.get(price.productId) ?? { total: 0, active: 0, vendorIds: new Set<string>() };
      current.total += 1;
      if (price.active) {
        current.active += 1;
        current.vendorIds.add(price.vendorId);
      }
      coverage.set(price.productId, current);
    });
    return coverage;
  }, [prices, products]);
  const priceOutliers = useMemo(() => {
    const groups = new Map<string, VendorPriceItem[]>();
    prices.filter((price) => price.active && price.kitPrice > 0).forEach((price) => {
      const key = `${price.productId}::${amountKey(price.mgOrAmountPerVial, price.vialsPerKit)}`;
      groups.set(key, [...(groups.get(key) ?? []), price]);
    });

    return Array.from(groups.values())
      .filter((group) => group.length >= 3)
      .map((group) => {
        const sorted = [...group].sort((a, b) => a.kitPrice - b.kitPrice);
        const low = sorted[0];
        const high = sorted[sorted.length - 1];
        const ratio = high.kitPrice / Math.max(low.kitPrice, 1);
        return { group, low, high, ratio };
      })
      .filter((warning) => warning.ratio >= 2.5)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 12);
  }, [prices]);
  const duplicateActiveRows = useMemo(() => {
    const groups = new Map<string, VendorPriceItem[]>();
    prices.filter((price) => price.active).forEach((price) => {
      const skuKey = normalizeSku(price.sku) || 'no-sku';
      const key = [
        price.vendorId,
        price.productId,
        amountKey(price.mgOrAmountPerVial, price.vialsPerKit),
        skuKey,
      ].join('::');
      groups.set(key, [...(groups.get(key) ?? []), price]);
    });

    return Array.from(groups.values())
      .filter((group) => group.length > 1)
      .sort((a, b) => b.length - a.length)
      .slice(0, 12);
  }, [prices]);
  const singleVendorProducts = useMemo(
    () => products.filter((product) => (productCoverage.get(product.id)?.vendorIds.size ?? 0) === 1),
    [productCoverage, products],
  );
  const unmappedProducts = useMemo(
    () => products.filter((product) => product.categories.includes('Other / Needs Review')),
    [products],
  );
  const recentlyDeactivatedRows = useMemo(
    () => prices
      .filter((price) => !price.active)
      .sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt))
      .slice(0, 10),
    [prices],
  );
  const vendorRefreshRows = useMemo(
    () => vendors
      .map((vendor) => {
        const vendorPrices = prices.filter((price) => price.vendorId === vendor.id);
        const latest = vendorPrices.map((price) => price.lastUpdatedAt).sort().at(-1);
        const counts = priceCounts.get(vendor.id) ?? { total: 0, active: 0 };
        return { vendor, latest, counts };
      })
      .sort((a, b) => (a.latest ?? '').localeCompare(b.latest ?? '')),
    [priceCounts, prices, vendors],
  );
  const highReviewRows = reviewRows.filter((row) => reviewSeverity(row.notes) === 'high').length;
  const mediumReviewRows = reviewRows.filter((row) => reviewSeverity(row.notes) === 'medium').length;
  const lowReviewRows = reviewRows.filter((row) => reviewSeverity(row.notes) === 'low').length;
  const visibleProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      [product.displayName, product.masterName, product.aliases.join(' '), product.categories.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [productSearch, products]);
  const visibleVendors = useMemo(() => {
    const query = vendorSearch.trim().toLowerCase();
    if (!query) return vendors;
    return vendors.filter((vendor) =>
      [
        vendor.vendorName,
        vendor.contactName ?? '',
        vendor.region,
        vendor.shippingOrigin ?? '',
        vendor.notes ?? '',
      ].join(' ').toLowerCase().includes(query),
    );
  }, [vendorSearch, vendors]);
  const visibleMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) =>
      [
        member.email,
        member.name ?? '',
        member.skoolUsername ?? '',
        member.source,
      ].join(' ').toLowerCase().includes(query),
    );
  }, [memberSearch, members]);
  const activeVendorCount = vendors.filter((vendor) => vendor.active).length;
  const activeMemberCount = members.filter((member) => member.active).length;
  const activePriceCount = prices.filter((price) => price.active).length;
  const adminIssueCount = duplicateActiveRows.length + highReviewRows + unmappedProducts.length;
  const selectedVendorCounts = priceCounts.get(activeVendorId) ?? { total: 0, active: 0 };

  async function importMembers(file: File) {
    const { default: Papa } = await import('papaparse');
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const next = replaceApprovedMembersFromRows(result.data, members);
        setSummary(next);
        const approved = window.confirm(
          `Replace the approved member list with this CSV?\n\nImported: ${next.validEmailsImported}\nNew members: ${next.newMembersAdded}\nPrevious members removed: ${next.previousMembersRemoved}\nInvalid rows skipped: ${next.invalidRows}\nDuplicate rows skipped: ${next.duplicateEmailsSkipped}`,
        );
        if (!approved) return;
        onMembers(next.members);
      },
    });
  }

  function addManualPrice() {
    const firstVendor = selectedVendor ?? vendors[0];
    const firstProduct = products[0];
    if (!firstVendor || !firstProduct) return;
    onPrices([
      {
        id: `manual-${Date.now()}`,
        vendorId: firstVendor.id,
        productId: firstProduct.id,
        vendorProductName: firstProduct.displayName,
        unitType: firstProduct.unitType,
        vialsPerKit: 10,
        kitPrice: 0,
        currency: 'USD',
        active: true,
        lastUpdatedAt: new Date().toISOString(),
      },
      ...prices,
    ]);
  }

  function addManualReviewRow() {
    const firstVendor = selectedVendor ?? vendors[0];
    if (!firstVendor) return;
    const now = new Date().toISOString();
    const id = `review-manual-${Date.now()}`;
    setReviewRows((rows) => [
      {
        id,
        vendorId: firstVendor.id,
        productId: newCatalogProductId,
        vendorProductName: '',
        sku: '',
        mgOrAmountPerVial: 'Needs review',
        unitType: 'other',
        vialsPerKit: 10,
        kitPrice: 0,
        currency: 'USD',
        active: false,
        priceListId: `plist-manual-${Date.now()}`,
        lastUpdatedAt: now,
        notes: '[HIGH] Manually added during PDF review. Enter SKU, product, amount, vial count, and kit price before publishing.',
      },
      ...rows,
    ]);
    setSelectedReviewIds((ids) => [id, ...ids]);
    setExtractionStatus('Added a blank SKU row to the current upload review. Fill it in before publishing.');
  }

  async function exportCsv() {
    const { default: Papa } = await import('papaparse');
    const rows = selectedVendorPrices.map((price) => ({
      vendor: vendorMap.get(price.vendorId),
      product: productMap.get(price.productId),
      vendorProductName: price.vendorProductName,
      sku: price.sku,
      kitPrice: price.kitPrice,
      active: price.active,
      lastUpdatedAt: price.lastUpdatedAt,
    }));
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const vendorSlug = selectedVendor?.vendorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'vendor';
    link.download = `official-price-tool-${vendorSlug}-export.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportBackup() {
    const exportedAt = new Date().toISOString();
    const payload: BackupPayload = {
      version: 1,
      exportedAt,
      source: 'official-price-tool',
      members,
      vendors,
      products,
      prices,
      settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `official-price-tool-backup-${exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupStatus(`Backup exported with ${vendors.length} vendors, ${products.length} products, and ${prices.length} price rows.`);
  }

  function isBackupPayload(value: unknown): value is BackupPayload {
    if (!value || typeof value !== 'object') return false;
    const maybe = value as Partial<BackupPayload>;
    return maybe.source === 'official-price-tool'
      && Array.isArray(maybe.members)
      && Array.isArray(maybe.vendors)
      && Array.isArray(maybe.products)
      && Array.isArray(maybe.prices)
      && Boolean(maybe.settings);
  }

  function buildBackupReview(payload: BackupPayload): BackupReview {
    const warnings: string[] = [];
    validateMembers(payload.members, warnings);
    validateVendors(payload.vendors, warnings);
    validateProducts(payload.products, warnings);
    validatePrices(
      payload.prices,
      new Set(payload.vendors.map((vendor) => vendor.id)),
      new Set(payload.products.map((product) => product.id)),
      warnings,
    );
    validateSettings(payload.settings, warnings);

    const memberDiff = countDiff(members, payload.members, (member) => member.email);
    const vendorDiff = countDiff(vendors, payload.vendors, (vendor) => vendor.id);
    const productDiff = countDiff(products, payload.products, (product) => product.id);
    const priceDiff = countDiff(prices, payload.prices, (price) => price.id);

    return {
      payload,
      warnings,
      diff: {
        membersAdded: memberDiff.added,
        membersRemoved: memberDiff.removed,
        membersUpdated: memberDiff.updated,
        vendorsAdded: vendorDiff.added,
        vendorsRemoved: vendorDiff.removed,
        vendorsUpdated: vendorDiff.updated,
        productsAdded: productDiff.added,
        productsRemoved: productDiff.removed,
        productsUpdated: productDiff.updated,
        pricesAdded: priceDiff.added,
        pricesRemoved: priceDiff.removed,
        pricesUpdated: priceDiff.updated,
      },
    };
  }

  function applyReviewedBackup() {
    if (!backupReview || backupReview.warnings.length) return;
    const { payload } = backupReview;
    const diff = backupReview.diff;
    const summaryLines = [
      'This will replace current app data with the reviewed backup.',
      `Members: +${diff.membersAdded} / -${diff.membersRemoved} / ${diff.membersUpdated} updated`,
      `Vendors: +${diff.vendorsAdded} / -${diff.vendorsRemoved} / ${diff.vendorsUpdated} updated`,
      `Products: +${diff.productsAdded} / -${diff.productsRemoved} / ${diff.productsUpdated} updated`,
      `Prices: +${diff.pricesAdded} / -${diff.pricesRemoved} / ${diff.pricesUpdated} updated`,
      '',
      'Type REPLACE to continue.',
    ];
    if (window.prompt(summaryLines.join('\n')) !== 'REPLACE') {
      setBackupStatus('Backup replacement canceled.');
      return;
    }
    onMembers(payload.members);
    onVendors(payload.vendors);
    onProducts(payload.products);
    onPrices(payload.prices);
    onSettings(payload.settings);
    setBackupStatus(`Backup imported from ${payload.exportedAt}.`);
    setBackupReview(undefined);
  }

  function importBackup(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        if (!isBackupPayload(payload)) {
          setBackupStatus('That file does not look like an Official Price Tool backup.');
          return;
        }

        const review = buildBackupReview(payload);
        setBackupReview(review);
        setBackupStatus(
          review.warnings.length
            ? `Backup blocked by ${review.warnings.length} validation warning${review.warnings.length === 1 ? '' : 's'}.`
            : 'Backup passed validation. Review the diff before replacing current data.',
        );
      } catch {
        setBackupStatus('The backup file could not be read. Check that it is a JSON export from this app.');
      }
    };
    reader.readAsText(file);
  }

  function readFileAsBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function stagePdfExtraction(file: File) {
    const { functions: firebaseFunctions } = await import('../lib/firebase/firebase');
    if (!firebaseFunctions) {
      setExtractionStatus('Firebase is not configured for this build yet.');
      return;
    }
    if (file.size > maxPdfBytes) {
      setExtractionStatus(`PDF is too large for extraction. Use a file under ${(maxPdfBytes / 1024 / 1024).toFixed(0)} MB.`);
      return;
    }
    if (file.size > pdfWarningBytes) {
      const approved = window.confirm(`This PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB and may take longer to extract. Continue staging it for ${selectedVendor?.vendorName ?? 'the selected vendor'}?`);
      if (!approved) {
        setExtractionStatus('PDF extraction canceled before upload.');
        return;
      }
    }

    setIsExtracting(true);
    setExtractionStatus(`Extracting ${file.name} for review...`);
    const now = new Date().toISOString();
    try {
      const fileBase64 = await readFileAsBase64(file);
      const { httpsCallable } = await import('firebase/functions');
      const extractPriceList = httpsCallable(firebaseFunctions, 'extractPriceListWithGemini', { timeout: extractionTimeoutMs });
      const result = await extractPriceList({
        fileName: file.name,
        fileMimeType: file.type || 'application/pdf',
        fileBase64,
        adminEmail: currentUser.email,
        sessionExpiresAt: currentUser.sessionExpiresAt,
      });
      const data = result.data as ExtractPriceListResponse;
      const firstVendor = selectedVendor ?? vendors[0];
      if (!firstVendor) {
        setExtractionStatus('Extraction finished, but no vendor is available to stage rows.');
        return;
      }

      let autoMappedCount = 0;
      const nextRows = data.rows.map((row, index): VendorPriceItem => {
        const match = findProductForExtractedRow(row, products);
        const existingSkuPrice = findExistingVendorSkuPrice(row, prices, firstVendor.id);
        const existingSkuProduct = existingSkuPrice ? products.find((product) => product.id === existingSkuPrice.productId) : undefined;
        const mappedProduct = existingSkuProduct ?? match.product;
        const rawName = row.vendorProductName || row.sku || `Extracted row ${index + 1}`;
        const correctedName = existingSkuPrice?.vendorProductName || (match.product ? match.product.displayName : match.correctedName || rawName);
        const liquidListing = isLiquidListing(rawName, correctedName, row.sku, mappedProduct?.displayName, mappedProduct?.masterName);
        const amount = (liquidListing ? normalizeLiquidAmount(row.mgOrAmountPerVial) : normalizeExtractedAmount(row.mgOrAmountPerVial)) || 'Needs review';
        const vialsPerKit = Number(row.vialsPerKit) || 10;
        const kitPrice = Number(row.kitPrice) || 0;
        const importRuleWarnings = buildImportRuleWarnings({
          row,
          prices,
          product: mappedProduct,
          matchScore: match.score,
          amount,
          vialsPerKit,
          kitPrice,
          vendorId: firstVendor.id,
          existingSkuPrice,
          rawName,
          correctedName,
        });
        const reviewNotes = [
          ...importRuleWarnings,
        ].filter(Boolean);
        if (existingSkuPrice || match.product) autoMappedCount += 1;
        return {
          id: `review-${Date.now()}-${index}`,
          vendorId: firstVendor.id,
          productId: mappedProduct?.id ?? newCatalogProductId,
          vendorProductName: correctedName,
          sku: row.sku || 'AI-REVIEW',
          mgOrAmountPerVial: amount,
          unitType: mappedProduct?.unitType ?? (liquidListing ? 'vial' : 'other'),
          vialsPerKit,
          kitPrice,
          currency: 'USD',
          active: false,
          priceListId: `plist-${Date.now()}`,
          lastUpdatedAt: now,
          notes: reviewNotes.join(' '),
        };
      });

      setReviewRows(nextRows);
      setSelectedReviewIds(nextRows.map((row) => row.id));
      const missingRows = prices
        .filter((price) => price.vendorId === firstVendor.id && price.active)
        .filter((price) => !nextRows.some((reviewRow) => reviewRowMatchesExistingPrice(reviewRow, price)));
      setMissingFromPdfRows(missingRows);
      setSelectedMissingFromPdfIds(missingRows.map((row) => row.id));
      setExtractionStatus(`${data.parsedStatus}: ${nextRows.length} rows staged for admin review. ${autoMappedCount} auto-mapped to catalog products. ${missingRows.length} active row${missingRows.length === 1 ? '' : 's'} missing from this PDF.`);
    } catch (error) {
      setExtractionStatus(extractionErrorMessage(error));
    } finally {
      setIsExtracting(false);
    }
  }

  function updateVendor(vendorId: string, patch: Partial<Vendor>) {
    onVendors(vendors.map((vendor) => vendor.id === vendorId ? { ...vendor, ...patch } : vendor));
  }

  function updatePrice(priceId: string, patch: Partial<VendorPriceItem>) {
    onPrices(prices.map((row) => row.id === priceId ? { ...row, ...patch, lastUpdatedAt: new Date().toISOString() } : row));
  }

  function updateReviewRow(priceId: string, patch: Partial<VendorPriceItem>) {
    setReviewRows((rows) => rows.map((row) => row.id === priceId ? { ...row, ...patch, lastUpdatedAt: new Date().toISOString() } : row));
  }

  function toggleReviewRow(priceId: string, checked: boolean) {
    setSelectedReviewIds((ids) => checked ? [...new Set([...ids, priceId])] : ids.filter((id) => id !== priceId));
  }

  function selectAllReviewRows(checked: boolean) {
    setSelectedReviewIds(checked ? reviewRows.map((row) => row.id) : []);
  }

  function toggleMissingFromPdfRow(priceId: string, checked: boolean) {
    setSelectedMissingFromPdfIds((ids) => checked ? [...new Set([...ids, priceId])] : ids.filter((id) => id !== priceId));
  }

  function selectAllMissingFromPdfRows(checked: boolean) {
    setSelectedMissingFromPdfIds(checked ? missingFromPdfRows.map((row) => row.id) : []);
  }

  function rejectSelectedReviewRows() {
    const ids = new Set(selectedReviewIds);
    if (!ids.size) return;
    const approved = window.confirm(`Reject ${ids.size} staged review row${ids.size === 1 ? '' : 's'}? This removes them from the review queue without publishing.`);
    if (!approved) return;
    setReviewRows((rows) => rows.filter((row) => !ids.has(row.id)));
    setSelectedReviewIds([]);
  }

  function deactivateMissingFromPdfRows(rowsToDeactivate: VendorPriceItem[]) {
    if (!rowsToDeactivate.length) return;
    const approved = window.confirm(
      `Deactivate ${rowsToDeactivate.length} active price row${rowsToDeactivate.length === 1 ? '' : 's'} for ${selectedVendor?.vendorName ?? 'the selected vendor'} because they were not found in the latest PDF?`,
    );
    if (!approved) return;
    const ids = new Set(rowsToDeactivate.map((row) => row.id));
    const deactivatedAt = new Date().toISOString();
    onPrices(prices.map((row) => ids.has(row.id) ? { ...row, active: false, lastUpdatedAt: deactivatedAt } : row));
    setMissingFromPdfRows((rows) => rows.filter((row) => !ids.has(row.id)));
    setSelectedMissingFromPdfIds((current) => current.filter((id) => !ids.has(id)));
    setExtractionStatus(`Deactivated ${rowsToDeactivate.length} row${rowsToDeactivate.length === 1 ? '' : 's'} missing from the latest ${selectedVendor?.vendorName ?? 'vendor'} PDF.`);
  }

  function keepMissingFromPdfRows(rowsToKeep: VendorPriceItem[]) {
    if (!rowsToKeep.length) return;
    const ids = new Set(rowsToKeep.map((row) => row.id));
    setMissingFromPdfRows((rows) => rows.filter((row) => !ids.has(row.id)));
    setSelectedMissingFromPdfIds((current) => current.filter((id) => !ids.has(id)));
  }

  function publishReviewRows(rowsToPublish: VendorPriceItem[]) {
    if (!rowsToPublish.length) return;
    const invalidPriceRows = rowsToPublish.filter((row) => !Number.isFinite(Number(row.kitPrice)) || Number(row.kitPrice) <= 0);
    if (invalidPriceRows.length) {
      setExtractionStatus(`Cannot publish ${invalidPriceRows.length} row${invalidPriceRows.length === 1 ? '' : 's'} with missing or zero kit price. Correct the price or reject the row first.`);
      return;
    }
    const newCatalogRows = rowsToPublish.filter((row) => row.productId === newCatalogProductId);
    const invalidNewCatalogRows = newCatalogRows.filter((row) => !row.vendorProductName.trim());
    if (invalidNewCatalogRows.length) {
      setExtractionStatus(`Cannot publish ${invalidNewCatalogRows.length} new item row${invalidNewCatalogRows.length === 1 ? '' : 's'} without a vendor listing name.`);
      return;
    }
    const existingMatches = rowsToPublish.filter((row) => row.productId !== newCatalogProductId && prices.some((price) => reviewRowMatchesExistingPrice(row, price))).length;
    const approved = window.confirm(
      `Publish ${rowsToPublish.length} reviewed row${rowsToPublish.length === 1 ? '' : 's'} to ${selectedVendor?.vendorName ?? 'the selected vendor'}?\n\nExpected updates: ${existingMatches}\nExpected new price rows: ${rowsToPublish.length - existingMatches}\nNew catalog items: ${newCatalogRows.length}`,
    );
    if (!approved) return;
    const ids = new Set(rowsToPublish.map((row) => row.id));
    const publishedAt = new Date().toISOString();
    const nextPrices = [...prices];
    const updatedPriceIds = new Set<string>();
    const newRows: VendorPriceItem[] = [];
    const newProducts: Product[] = [];
    const queuedProductIds = new Set<string>();
    const newProductIdsByListing = new Map<string, string>();

    rowsToPublish.forEach((row) => {
      let productId = row.productId;
      if (row.productId === newCatalogProductId) {
        const listingKey = searchableKey(row.vendorProductName);
        productId = newProductIdsByListing.get(listingKey) ?? '';
        if (!productId) {
          productId = uniqueProductId(row.vendorProductName, products, queuedProductIds);
          newProductIdsByListing.set(listingKey, productId);
          const liquidListing = isLiquidListing(row.vendorProductName, row.sku, row.mgOrAmountPerVial);
          newProducts.push({
            id: productId,
            masterName: row.vendorProductName.trim(),
            displayName: row.vendorProductName.trim(),
            aliases: [row.vendorProductName.trim(), row.sku ?? ''].filter(Boolean),
            categories: liquidListing ? ['Waters / Reconstitution'] : ['Other / Needs Review'],
            unitType: liquidListing ? 'vial' : row.unitType,
            notes: `Created from ${selectedVendor?.vendorName ?? 'vendor'} PDF review for SKU ${row.sku || 'unspecified'}.`,
            active: true,
            createdAt: publishedAt,
            updatedAt: publishedAt,
          });
        }
      }
      const publishableRow = { ...row, productId, active: true, kitPrice: Number(row.kitPrice), lastUpdatedAt: publishedAt };
      const existingIndex = nextPrices.findIndex((price) => !updatedPriceIds.has(price.id) && reviewRowMatchesExistingPrice(publishableRow, price));
      if (existingIndex >= 0) {
        const existingRow = nextPrices[existingIndex];
        updatedPriceIds.add(existingRow.id);
        nextPrices[existingIndex] = { ...publishableRow, id: existingRow.id };
        return;
      }

      newRows.push(publishableRow);
    });

    if (newProducts.length) onProducts([...newProducts, ...products]);
    onPrices([...newRows, ...nextPrices]);
    setReviewRows((rows) => rows.filter((row) => !ids.has(row.id)));
    setSelectedReviewIds((current) => current.filter((id) => !ids.has(id)));
    setExtractionStatus(
      `Published ${rowsToPublish.length} reviewed row${rowsToPublish.length === 1 ? '' : 's'} to ${selectedVendor?.vendorName ?? 'the selected vendor'}: ${updatedPriceIds.size} updated, ${newRows.length} new, ${newProducts.length} catalog item${newProducts.length === 1 ? '' : 's'} added.`,
    );
  }

  function updateFilteredPriceRows(patch: Partial<VendorPriceItem>, label: string) {
    const ids = new Set(selectedVendorPrices.map((price) => price.id));
    if (!ids.size) return;
    const approved = window.confirm(`${label} ${ids.size} filtered price row${ids.size === 1 ? '' : 's'} for ${selectedVendor?.vendorName ?? 'the selected vendor'}?`);
    if (!approved) return;
    onPrices(prices.map((row) => ids.has(row.id) ? { ...row, ...patch, lastUpdatedAt: new Date().toISOString() } : row));
  }

  function deleteInactiveFilteredPriceRows() {
    const rowsToDelete = selectedVendorPrices.filter((price) => !price.active);
    if (!rowsToDelete.length) return;
    const approved = window.confirm(
      `Permanently delete ${rowsToDelete.length} inactive filtered price row${rowsToDelete.length === 1 ? '' : 's'} for ${selectedVendor?.vendorName ?? 'the selected vendor'}?\n\nThis removes the rows from the cloud database. Active rows will be kept.`,
    );
    if (!approved) return;
    const ids = new Set(rowsToDelete.map((row) => row.id));
    onPrices(prices.filter((row) => !ids.has(row.id)));
  }

  function updateProduct(productId: string, patch: Partial<Product>) {
    onProducts(products.map((product) => product.id === productId ? { ...product, ...patch, updatedAt: new Date().toISOString() } : product));
  }

  function parseAliases(value: string) {
    return value.split(',').map((alias) => alias.trim()).filter(Boolean);
  }

  function parseCategories(value: string): ProductCategory[] {
    const allowed = new Set<string>([...categories, 'Other / Needs Review']);
    const next = value.split(',').map((category) => category.trim()).filter((category) => allowed.has(category)) as ProductCategory[];
    return next.length ? next : ['Other / Needs Review'];
  }

  function paymentMethodsFromValue(value: string): PaymentMethod[] {
    if (value === 'crypto_wire') return ['crypto', 'wire'];
    if (value === 'crypto') return ['crypto'];
    if (value === 'wire') return ['wire'];
    return ['all_forms'];
  }

  function paymentValue(methods: PaymentMethod[]) {
    if (methods.includes('all_forms')) return 'all_forms';
    if (methods.includes('crypto') && methods.includes('wire')) return 'crypto_wire';
    if (methods.includes('crypto')) return 'crypto';
    if (methods.includes('wire')) return 'wire';
    return 'all_forms';
  }

  function shippingRuleSummary(vendor: Vendor) {
    const rule = vendorShippingRule(vendor);
    if (!rule) return undefined;
    const defaultService = rule.services.find((service) => service.id === rule.defaultServiceId) ?? rule.services[0];
    const alternates = rule.services
      .filter((service) => service.id !== defaultService?.id)
      .map((service) => `${service.name} $${service.firstTierCost} + $${service.additionalTierCost}`)
      .join('; ');
    return [
      `Weight tier: powder ${rule.powderGramsPerBox}g, water ${rule.waterGramsPerBox}g`,
      defaultService ? `${defaultService.name} $${defaultService.firstTierCost} first ${rule.tierGrams}g + $${defaultService.additionalTierCost}` : '',
      alternates,
    ].filter(Boolean);
  }

  function vendorNotesValue(vendor: Vendor) {
    if (vendor.id === 'wanshun' && vendor.notes?.toLowerCase().includes('shipping cost not listed')) {
      return 'Verified vendor list notes all forms. Shipping uses weight-tier rule: powder 150g/box, water 250g/box. US Express $55 first 500g + $18/additional 500g; FedEx $75 first 500g + $18/additional 500g.';
    }
    return vendor.notes ?? '';
  }

  return (
    <div className={`admin-shell ${adminDensity === 'compact' ? 'compact-density' : ''}`}>
      <nav className="admin-tabs" aria-label="Admin sections">
        {[
          ['vendors', 'Vendors'],
          ['prices', 'Price Lists'],
          ['quality', 'Data Quality'],
          ['backup', 'Backup'],
          ['members', 'Members'],
          ['warnings', 'Warnings'],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id as typeof tab)}>
            {label}
          </button>
        ))}
        <div className="admin-density-toggle" aria-label="Admin table density">
          <button className={adminDensity === 'comfortable' ? 'active' : ''} onClick={() => setAdminDensity('comfortable')}>Comfortable</button>
          <button className={adminDensity === 'compact' ? 'active' : ''} onClick={() => setAdminDensity('compact')}>Compact</button>
        </div>
      </nav>
      <section className="admin-overview-strip" aria-label="Admin overview">
        <div className="admin-overview-card">
          <span>Active vendors</span>
          <strong>{activeVendorCount}/{vendors.length}</strong>
          <small>{vendorRefreshRows.filter((row) => row.counts.active === 0).length} with no active rows</small>
        </div>
        <div className="admin-overview-card">
          <span>Active prices</span>
          <strong>{activePriceCount}</strong>
          <small>{prices.length - activePriceCount} inactive rows</small>
        </div>
        <div className="admin-overview-card">
          <span>Approved members</span>
          <strong>{activeMemberCount}</strong>
          <small>{members.length - activeMemberCount} inactive members</small>
        </div>
        <div className={`admin-overview-card ${adminIssueCount ? 'needs-review' : ''}`}>
          <span>Needs attention</span>
          <strong>{adminIssueCount}</strong>
          <small>Duplicates, high reviews, unmapped products</small>
        </div>
      </section>
      {cloudSaveStatus && (
        <div className={cloudSaveBlocked ? 'sync-warning-card' : 'backup-status'}>
          <span>{cloudSaveStatus}</span>
          {cloudSaveBlocked && onRetryCloudSave && (
            <button className="primary" onClick={() => void onRetryCloudSave()}>
              Retry cloud sync
            </button>
          )}
        </div>
      )}

      <fieldset className="admin-content-fieldset">

      {tab === 'warnings' && (
      <section className="tool-panel">
        <h2>Import Review Warnings</h2>
        {realImportWarnings.length ? (
          <div className="review-box">
            {realImportWarnings.map((warning) => (
              <div key={`${warning.vendorId}-${warning.sku}-${warning.rawSpec}`}>
                <strong>{warning.vendorName} - {warning.sku}</strong>
                <span>{warning.productName}: {warning.extractedSpec} {'->'} {warning.correctedSpec}</span>
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="subtle">No import warnings in the current catalog.</p>
        )}
      </section>
      )}

      {tab === 'members' && (
      <section className="tool-panel">
        <div className="panel-header">
          <div>
            <h2>Member Access</h2>
            <p className="subtle">Approved member records control who can request a verified session.</p>
          </div>
          <label>
            Search members
            <input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Email, name, source" />
          </label>
        </div>
        <div className="admin-action-grid">
          <div className="admin-action-card">
            <strong>{activeMemberCount} active members</strong>
            <span>{members.length} total records. {visibleMembers.length} match the current search.</span>
          </div>
          <label className="file-drop compact-file-drop">
            <Upload size={18} />
            Upload full Skool CSV and replace approved list
            <input type="file" accept=".csv" onChange={(event) => event.target.files?.[0] && importMembers(event.target.files[0])} />
          </label>
        </div>
        {summary && (
          <div className="summary-grid">
            <span>Total rows: {summary.totalRowsFound}</span>
            <span>Imported: {summary.validEmailsImported}</span>
            <span>Duplicates: {summary.duplicateEmailsSkipped}</span>
            <span>Invalid: {summary.invalidRows}</span>
            <span>Removed: {summary.previousMembersRemoved}</span>
            <span>New: {summary.newMembersAdded}</span>
          </div>
        )}
        <div className="table-wrap small-table">
          <table>
            <tbody>
              {visibleMembers.map((member) => (
                <tr key={member.email}>
                  <td>{member.email}</td>
                  <td>{member.source}</td>
                  <td>{member.active ? 'active' : 'inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {tab === 'quality' && (
      <>
      <section className="tool-panel wide">
        <div className="panel-header">
          <div>
            <h2>Data Quality</h2>
            <p className="subtle">Catalog grouping, category cleanup, and pricing rows that need a second look.</p>
          </div>
        </div>
        <div className="quality-metric-grid">
          <div className={`quality-metric-card ${highReviewRows ? 'needs-review' : ''}`}>
            <span>High review rows</span>
            <strong>{highReviewRows}</strong>
            <small>{mediumReviewRows} medium review</small>
          </div>
          <div className={`quality-metric-card ${duplicateActiveRows.length ? 'needs-review' : ''}`}>
            <span>Duplicate active rows</span>
            <strong>{duplicateActiveRows.length}</strong>
            <small>Same vendor, product, amount, and SKU</small>
          </div>
          <div className={`quality-metric-card ${unmappedProducts.length ? 'needs-review' : ''}`}>
            <span>Unmapped products</span>
            <strong>{unmappedProducts.length}</strong>
            <small>Filed under needs review</small>
          </div>
          <div className={`quality-metric-card ${singleVendorProducts.length ? 'needs-review' : ''}`}>
            <span>One-vendor products</span>
            <strong>{singleVendorProducts.length}</strong>
            <small>Active coverage from only one vendor</small>
          </div>
          <div className="quality-metric-card">
            <span>Recently deactivated</span>
            <strong>{recentlyDeactivatedRows.length}</strong>
            <small>Newest inactive price rows</small>
          </div>
          <div className="quality-metric-card">
            <span>Vendors tracked</span>
            <strong>{vendors.length}</strong>
            <small>{vendorRefreshRows.filter((row) => row.counts.active > 0).length} with active rows</small>
          </div>
        </div>
      </section>

      <section className="tool-panel wide">
        <div className="panel-header">
          <div>
            <h2>Attention Queue</h2>
            <p className="subtle">Fast scan of duplicate rows, deactivations, and vendor refresh age.</p>
          </div>
        </div>
        <div className="quality-attention-grid">
          <div className="quality-list-card">
            <strong>Duplicate rows</strong>
            {duplicateActiveRows.length ? (
              duplicateActiveRows.slice(0, 5).map((group) => {
                const first = group[0];
                return (
                  <span key={group.map((row) => row.id).join('|')}>
                    {vendorMap.get(first.vendorId) ?? first.vendorId} - {productMap.get(first.productId) ?? first.productId} - {displayAmountLabel(first.mgOrAmountPerVial)} ({group.length})
                  </span>
                );
              })
            ) : (
              <span>No duplicate active rows found.</span>
            )}
          </div>
          <div className="quality-list-card">
            <strong>Recently deactivated</strong>
            {recentlyDeactivatedRows.length ? (
              recentlyDeactivatedRows.slice(0, 5).map((row) => (
                <span key={row.id}>
                  {vendorMap.get(row.vendorId) ?? row.vendorId} - {row.sku ?? productMap.get(row.productId) ?? row.productId} - {row.lastUpdatedAt}
                </span>
              ))
            ) : (
              <span>No inactive rows yet.</span>
            )}
          </div>
          <div className="quality-list-card">
            <strong>Oldest vendor refreshes</strong>
            {vendorRefreshRows.slice(0, 5).map(({ vendor, latest, counts }) => (
              <span key={vendor.id}>
                {vendor.vendorName} - {latest ?? 'No price rows'} - {counts.active}/{counts.total} active
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="tool-panel wide">
        <div className="panel-header">
          <div>
            <h2>Price Outliers</h2>
            <p className="subtle">Active product amounts with a wide spread across vendors. This refreshes automatically while Data Quality is open.</p>
          </div>
          <div className="button-row">
            <button onClick={() => void refreshDataQuality()}>Refresh live data</button>
          </div>
        </div>
        {qualityRefreshStatus && <p className="backup-status">{qualityRefreshStatus}</p>}
        {priceOutliers.length ? (
          <div className="outlier-list">
            {priceOutliers.map(({ group, low, high, ratio }) => {
              const product = productLookup.get(low.productId);
              return (
                <div key={`${low.productId}-${amountKey(low.mgOrAmountPerVial, low.vialsPerKit)}`} className="outlier-card">
                  <strong>{product?.displayName ?? low.productId} - {displayAmountLabel(low.mgOrAmountPerVial)}</strong>
                  <span>{group.length} vendor rows, {ratio.toFixed(1)}x spread</span>
                  <small>Low: {vendorMap.get(low.vendorId)} ${low.kitPrice.toFixed(2)} | High: {vendorMap.get(high.vendorId)} ${high.kitPrice.toFixed(2)}</small>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="subtle">No major price outliers found in active rows.</p>
        )}
      </section>

      <section className="tool-panel wide">
        <div className="panel-header">
          <div>
            <h2>Automatic Import Rules</h2>
            <p className="subtle">PDF review rows are flagged before they can be published into live vendor prices.</p>
          </div>
        </div>
        <div className="rule-grid">
          <div className="rule-card">
            <strong>High review</strong>
            <span>Unmapped products, odd vial counts, missing prices, and SKU conflicts with a different catalog product.</span>
          </div>
          <div className="rule-card">
            <strong>Medium review</strong>
            <span>Name corrections and prices that are 2.5x away from the current median for the same product and amount.</span>
          </div>
          <div className="rule-card">
            <strong>Low review</strong>
            <span>Same vendor already has that product/amount, or the extractor returned extra warnings worth checking.</span>
          </div>
          <div className="rule-card">
            <strong>Still editable</strong>
            <span>Admins can fix product mapping, amount, vials, price, SKU, and notes before publishing.</span>
          </div>
        </div>
      </section>

      <section className="tool-panel wide">
        <div className="panel-header">
          <div>
            <h2>Product Grouping</h2>
            <p className="subtle">Edit master names, aliases, and categories. Products stay in the catalog; vendor-specific removal still happens from Price Lists.</p>
          </div>
          <label>
            Search products
            <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Name, alias, category" />
          </label>
        </div>
        <div className="category-reference">
          <strong>Allowed categories</strong>
          <span>{[...categories, 'Other / Needs Review'].join(', ')}</span>
        </div>
        <div className="table-wrap quality-table">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Categories</th>
                <th>Aliases</th>
                <th>Coverage</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((product) => {
                const coverage = productCoverage.get(product.id) ?? { total: 0, active: 0, vendorIds: new Set<string>() };
                const needsReview = product.categories.includes('Other / Needs Review') || coverage.vendorIds.size <= 1;
                return (
                  <tr key={product.id}>
                    <td>
                      <input value={product.displayName} onChange={(event) => updateProduct(product.id, { displayName: event.target.value, masterName: event.target.value })} />
                    </td>
                    <td>
                      <textarea value={product.categories.join(', ')} onChange={(event) => updateProduct(product.id, { categories: parseCategories(event.target.value) })} />
                    </td>
                    <td>
                      <textarea value={product.aliases.join(', ')} onChange={(event) => updateProduct(product.id, { aliases: parseAliases(event.target.value) })} />
                    </td>
                    <td>
                      <strong>{coverage.active}/{coverage.total}</strong>
                      <span>{coverage.vendorIds.size} vendors</span>
                    </td>
                    <td>
                      <span className={`status-pill ${needsReview ? 'warning' : 'ok'}`}>{needsReview ? 'Review' : 'OK'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      </>
      )}

      {tab === 'backup' && (
      <section className="tool-panel wide">
        <div className="panel-header">
          <div>
            <h2>Backup</h2>
            <p className="subtle">Export the current admin data before major cleanup, or import a previous backup to restore it.</p>
          </div>
          <div className="button-row">
            <button className="primary" onClick={exportBackup}><Download size={16} /> Export backup</button>
          </div>
        </div>
        <div className="backup-grid">
          <div className="backup-card">
            <strong>Catalog snapshot</strong>
            <span>{vendors.length} vendors</span>
            <span>{products.length} products</span>
            <span>{prices.length} price rows</span>
          </div>
          <div className="backup-card">
            <strong>Access snapshot</strong>
            <span>{members.length} approved members</span>
            <span>{activeMemberCount} active</span>
            <span>{members.length - activeMemberCount} inactive</span>
          </div>
          <label className="file-drop backup-drop">
            <Upload size={18} />
            Import backup JSON
            <input type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && importBackup(event.target.files[0])} />
          </label>
        </div>
        {backupStatus && <p className="backup-status">{backupStatus}</p>}
        {backupReview && (
          <div className="backup-review">
            <div className="panel-header compact-panel-header">
              <div>
                <h3>Backup Import Preview</h3>
                <p className="subtle">Exported {backupReview.payload.exportedAt}. Review these changes before replacing current data.</p>
              </div>
              <div className="button-row">
                <button onClick={() => setBackupReview(undefined)}>Cancel import</button>
                <button className="primary" disabled={backupReview.warnings.length > 0} onClick={applyReviewedBackup}>
                  Replace current data
                </button>
              </div>
            </div>
            <div className="backup-diff-grid">
              <div>
                <strong>Members</strong>
                <span>+{backupReview.diff.membersAdded} / -{backupReview.diff.membersRemoved} / {backupReview.diff.membersUpdated} updated</span>
              </div>
              <div>
                <strong>Vendors</strong>
                <span>+{backupReview.diff.vendorsAdded} / -{backupReview.diff.vendorsRemoved} / {backupReview.diff.vendorsUpdated} updated</span>
              </div>
              <div>
                <strong>Products</strong>
                <span>+{backupReview.diff.productsAdded} / -{backupReview.diff.productsRemoved} / {backupReview.diff.productsUpdated} updated</span>
              </div>
              <div>
                <strong>Prices</strong>
                <span>+{backupReview.diff.pricesAdded} / -{backupReview.diff.pricesRemoved} / {backupReview.diff.pricesUpdated} updated</span>
              </div>
            </div>
            {backupReview.warnings.length > 0 && (
              <div className="backup-warning-list">
                <strong>Validation warnings</strong>
                {backupReview.warnings.slice(0, 12).map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
                {backupReview.warnings.length > 12 && <span>{backupReview.warnings.length - 12} more warning{backupReview.warnings.length - 12 === 1 ? '' : 's'} hidden.</span>}
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {tab === 'prices' && (
      <>
      <section className="tool-panel">
        <div className="panel-header">
          <div>
            <h2>PDF Price Lists</h2>
            <p className="subtle">Stage PDF extraction into a review queue before publishing live prices.</p>
          </div>
          <label>
            Stage rows for vendor
            <select value={activeVendorId} onChange={(event) => setSelectedVendorId(event.target.value)}>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.vendorName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="admin-action-grid">
          <div className="admin-action-card">
            <strong>{selectedVendor?.vendorName ?? 'Selected vendor'}</strong>
            <span>{selectedVendorCounts.active}/{selectedVendorCounts.total} active rows. {selectedVendorPrices.length} rows match the current search.</span>
          </div>
          <div className={`admin-action-card ${reviewRows.length ? 'needs-review' : ''}`}>
            <strong>{reviewRows.length} staged rows</strong>
            <span>{highReviewRows} high, {mediumReviewRows} medium, {lowReviewRows} low.</span>
          </div>
          <div className={`admin-action-card ${missingFromPdfRows.length ? 'needs-review' : ''}`}>
            <strong>{missingFromPdfRows.length} missing from PDF</strong>
            <span>Rows staged for possible deactivation after extraction.</span>
          </div>
        </div>
        <label className="file-drop">
          <Upload size={18} />
          {isExtracting ? 'Extracting PDF...' : 'Upload vendor PDF for AI-assisted extraction review'}
          <input type="file" accept="application/pdf" disabled={isExtracting} onChange={(event) => event.target.files?.[0] && stagePdfExtraction(event.target.files[0])} />
        </label>
        <div className="button-row">
          <button onClick={addManualReviewRow}>Add SKU to review</button>
        </div>
        <p className="subtle">AI extraction stages inactive rows for review. Map products and verify prices before publishing.</p>
        {extractionStatus && <p className="backup-status">{extractionStatus}</p>}
        {reviewRows.length > 0 && (
          <div className="review-queue">
            <div className="panel-header compact-panel-header">
              <div>
                <h3>Rows requiring admin review</h3>
                <p className="subtle">{selectedReviewIds.length} of {reviewRows.length} selected</p>
              </div>
              <div className="button-row">
                <button onClick={addManualReviewRow}>Add SKU</button>
                <button onClick={() => selectAllReviewRows(selectedReviewIds.length !== reviewRows.length)}>
                  {selectedReviewIds.length === reviewRows.length ? 'Clear selection' : 'Select all'}
                </button>
                <button onClick={rejectSelectedReviewRows}>Reject selected</button>
                <button className="primary" onClick={() => publishReviewRows(reviewRows.filter((row) => selectedReviewIds.includes(row.id)))}>
                  Publish selected
                </button>
                <button onClick={() => publishReviewRows(reviewRows)}>Publish all</button>
              </div>
            </div>
            <div className="table-wrap review-table">
              <table>
                <thead>
                  <tr>
                    <th>Use</th>
                    <th>Status</th>
                    <th>Product</th>
                    <th>Vendor listing</th>
                    <th>SKU</th>
                    <th>Amount</th>
                    <th>Vials</th>
                    <th>Kit price</th>
                    <th>Notes / Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewRows.map((row) => {
                    const severity = reviewSeverity(row.notes);
                    return (
                      <tr key={row.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedReviewIds.includes(row.id)}
                            onChange={(event) => toggleReviewRow(row.id, event.target.checked)}
                          />
                        </td>
                        <td>
                          <span className={`review-severity ${severity}`}>{reviewSeverityLabel(severity)}</span>
                        </td>
                        <td>
                          <select
                            value={row.productId}
                            onChange={(event) => {
                              if (event.target.value === newCatalogProductId) {
                                updateReviewRow(row.id, {
                                  productId: newCatalogProductId,
                                  unitType: isLiquidListing(row.vendorProductName, row.sku, row.mgOrAmountPerVial) ? 'vial' : 'other',
                                });
                                return;
                              }
                              const product = productLookup.get(event.target.value);
                              const liquidListing = isLiquidListing(product?.displayName, product?.masterName, row.vendorProductName, row.sku);
                              updateReviewRow(row.id, {
                                productId: event.target.value,
                                unitType: product?.unitType ?? row.unitType,
                                vendorProductName: product?.displayName ?? row.vendorProductName,
                                mgOrAmountPerVial: liquidListing ? normalizeLiquidAmount(row.mgOrAmountPerVial) : row.mgOrAmountPerVial,
                              });
                            }}
                          >
                            <option value={newCatalogProductId}>New item - use vendor listing</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.displayName}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input value={row.vendorProductName} onChange={(event) => updateReviewRow(row.id, { vendorProductName: event.target.value })} />
                        </td>
                        <td>
                          <input value={row.sku ?? ''} onChange={(event) => updateReviewRow(row.id, { sku: event.target.value })} />
                        </td>
                        <td>
                          <input value={row.mgOrAmountPerVial ?? ''} onChange={(event) => updateReviewRow(row.id, { mgOrAmountPerVial: event.target.value })} />
                        </td>
                        <td>
                          <input type="number" min="1" value={row.vialsPerKit} onChange={(event) => updateReviewRow(row.id, { vialsPerKit: Number(event.target.value) || 1 })} />
                        </td>
                        <td>
                          <input type="number" min="0" value={row.kitPrice} onChange={(event) => updateReviewRow(row.id, { kitPrice: Number(event.target.value) || 0 })} />
                        </td>
                        <td>
                          <textarea value={row.notes ?? ''} onChange={(event) => updateReviewRow(row.id, { notes: event.target.value })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {missingFromPdfRows.length > 0 && (
          <div className="review-queue">
            <div className="panel-header compact-panel-header">
              <div>
                <h3>Missing from new PDF</h3>
                <p className="subtle">{selectedMissingFromPdfIds.length} of {missingFromPdfRows.length} selected to deactivate</p>
              </div>
              <div className="button-row">
                <button onClick={() => selectAllMissingFromPdfRows(selectedMissingFromPdfIds.length !== missingFromPdfRows.length)}>
                  {selectedMissingFromPdfIds.length === missingFromPdfRows.length ? 'Clear selection' : 'Select all'}
                </button>
                <button onClick={() => keepMissingFromPdfRows(missingFromPdfRows.filter((row) => selectedMissingFromPdfIds.includes(row.id)))}>
                  Keep selected active
                </button>
                <button className="primary" onClick={() => deactivateMissingFromPdfRows(missingFromPdfRows.filter((row) => selectedMissingFromPdfIds.includes(row.id)))}>
                  Deactivate selected
                </button>
                <button onClick={() => deactivateMissingFromPdfRows(missingFromPdfRows)}>Deactivate all</button>
              </div>
            </div>
            <div className="table-wrap review-table">
              <table>
                <thead>
                  <tr>
                    <th>Use</th>
                    <th>Status</th>
                    <th>Product</th>
                    <th>Vendor listing</th>
                    <th>SKU</th>
                    <th>Amount</th>
                    <th>Vials</th>
                    <th>Kit price</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {missingFromPdfRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedMissingFromPdfIds.includes(row.id)}
                          onChange={(event) => toggleMissingFromPdfRow(row.id, event.target.checked)}
                        />
                      </td>
                      <td><span className="review-severity medium">Missing</span></td>
                      <td>{productMap.get(row.productId) ?? row.productId}</td>
                      <td>{row.vendorProductName}</td>
                      <td>{row.sku ?? '-'}</td>
                      <td>{row.mgOrAmountPerVial ?? '-'}</td>
                      <td>{row.vialsPerKit}</td>
                      <td>${row.kitPrice.toFixed(2)}</td>
                      <td>{row.notes ?? 'Currently active, but not found in the new PDF.'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="tool-panel wide">
        <div className="panel-header">
          <div>
            <h2>Prices</h2>
            <p className="subtle">Spreadsheet-style edits for one vendor price list at a time.</p>
          </div>
          <div className="button-row">
            <button onClick={addManualPrice}>Add row</button>
            <button onClick={() => updateFilteredPriceRows({ active: true }, 'Activate')}>Activate filtered</button>
            <button onClick={() => updateFilteredPriceRows({ active: false }, 'Deactivate')}>Deactivate filtered</button>
            <button onClick={deleteInactiveFilteredPriceRows}>Delete inactive filtered</button>
            <button onClick={exportCsv}><Download size={16} /> Export CSV</button>
          </div>
        </div>
        <div className="filters admin-price-filters">
          <label>
            Vendor
            <select value={activeVendorId} onChange={(event) => setSelectedVendorId(event.target.value)}>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.vendorName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Search rows
            <input value={priceSearch} onChange={(event) => setPriceSearch(event.target.value)} placeholder="Product, SKU, amount" />
          </label>
          <span className="subtle">{selectedVendorPrices.length} matching rows</span>
        </div>
        <div className="table-wrap admin-price-table">
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Product</th>
                <th>Vendor listing</th>
                <th>SKU</th>
                <th>Amount</th>
                <th>Vials</th>
                <th>Kit price</th>
                <th>Active</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {selectedVendorPrices.map((price) => (
                <tr key={price.id}>
                  <td>{vendorMap.get(price.vendorId)}</td>
                  <td>
                    <select
                      value={price.productId}
                      onChange={(event) => {
                        const product = productLookup.get(event.target.value);
                        updatePrice(price.id, { productId: event.target.value, unitType: product?.unitType ?? price.unitType });
                      }}
                    >
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.displayName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input value={price.vendorProductName} onChange={(event) => updatePrice(price.id, { vendorProductName: event.target.value })} />
                  </td>
                  <td>
                    <input value={price.sku ?? ''} onChange={(event) => updatePrice(price.id, { sku: event.target.value })} />
                  </td>
                  <td>
                    <input value={price.mgOrAmountPerVial ?? ''} onChange={(event) => updatePrice(price.id, { mgOrAmountPerVial: event.target.value })} />
                  </td>
                  <td>
                    <input type="number" min="1" value={price.vialsPerKit} onChange={(event) => updatePrice(price.id, { vialsPerKit: Number(event.target.value) || 1 })} />
                  </td>
                  <td>
                    <input type="number" value={price.kitPrice} onChange={(event) => updatePrice(price.id, { kitPrice: Number(event.target.value) })} />
                  </td>
                  <td>
                    <input type="checkbox" checked={price.active} onChange={(event) => updatePrice(price.id, { active: event.target.checked })} />
                  </td>
                  <td>
                    <textarea value={price.notes ?? ''} onChange={(event) => updatePrice(price.id, { notes: event.target.value })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </>
      )}

      {tab === 'vendors' && (
      <section className="tool-panel wide">
        <div className="panel-header">
          <div>
            <h2>Vendor Health</h2>
            <p className="subtle">Shipping, payment, active status, and price-row coverage.</p>
          </div>
          <label>
            Search vendors
            <input value={vendorSearch} onChange={(event) => setVendorSearch(event.target.value)} placeholder="Name, region, notes" />
          </label>
        </div>
        <div className="admin-action-grid">
          <div className="admin-action-card">
            <strong>{activeVendorCount} active vendors</strong>
            <span>{visibleVendors.length} vendors match the current search.</span>
          </div>
          <div className="admin-action-card">
            <strong>{activePriceCount} active prices</strong>
            <span>{prices.length - activePriceCount} inactive rows across all vendors.</span>
          </div>
          <div className={`admin-action-card ${vendorRefreshRows.filter((row) => row.counts.active === 0).length ? 'needs-review' : ''}`}>
            <strong>{vendorRefreshRows.filter((row) => row.counts.active === 0).length} empty vendors</strong>
            <span>Active vendors without live price rows should be checked.</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="vendor-health-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Status</th>
                <th>Rows</th>
                <th>Shipping</th>
                <th>Free over</th>
                <th>Payment</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {visibleVendors.map((vendor) => {
                const counts = priceCounts.get(vendor.id) ?? { total: 0, active: 0 };
                const shippingSummary = shippingRuleSummary(vendor);
                return (
                  <tr key={vendor.id}>
                    <td><strong>{vendor.vendorName}</strong></td>
                    <td>
                      <label className="inline-check">
                        <input type="checkbox" checked={vendor.active} onChange={(event) => updateVendor(vendor.id, { active: event.target.checked })} />
                        Active
                      </label>
                    </td>
                    <td>{counts.active}/{counts.total}</td>
                    <td>
                      {shippingSummary ? (
                        <div className="stacked-cell">
                          {shippingSummary.map((line) => <span key={line}>{line}</span>)}
                        </div>
                      ) : (
                        <input type="number" min="0" value={vendor.defaultShippingCost} onChange={(event) => updateVendor(vendor.id, { defaultShippingCost: Number(event.target.value) || 0 })} />
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={vendor.freeShippingThreshold ?? ''}
                        placeholder="-"
                        onChange={(event) => updateVendor(vendor.id, { freeShippingThreshold: event.target.value === '' ? undefined : Number(event.target.value) })}
                      />
                    </td>
                    <td>
                      <select value={paymentValue(vendor.paymentMethods)} onChange={(event) => updateVendor(vendor.id, { paymentMethods: paymentMethodsFromValue(event.target.value) })}>
                        <option value="all_forms">All Forms</option>
                        <option value="crypto_wire">Crypto + Wire</option>
                        <option value="crypto">Crypto</option>
                        <option value="wire">Wire</option>
                      </select>
                    </td>
                    <td>
                      <textarea value={vendorNotesValue(vendor)} onChange={(event) => updateVendor(vendor.id, { notes: event.target.value })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      )}
      </fieldset>
    </div>
  );
}
