import type { AppSettings, Product, Vendor, VendorPriceItem } from '../lib/types';

const now = new Date().toISOString();

export const categories = [
  'Weight Loss / Metabolic',
  'Growth Hormone / Growth Factors',
  'Recovery / Tissue Repair',
  'Anti-Inflammatory / Immune',
  'Brain / Mood / Cognitive',
  'Sleep / Relaxation',
  'Skin / Hair / Cosmetic',
  'Longevity / Mitochondrial / Cellular Health',
  'Hormones / Fertility',
  'Sexual Health',
  'Injectable Nutrients / Amino Acids',
  'Waters / Reconstitution',
  'Research / Specialty Compounds',
] as const;

export const seedVendors: Vendor[] = [
  {
    id: 'vendor-a',
    vendorName: 'Vendor A',
    contactName: 'Sales A',
    whatsappNumber: '+15550001001',
    region: 'domestic',
    shippingOrigin: 'US',
    averageDeliveryTime: '3-5 days',
    defaultShippingCost: 18,
    freeShippingThreshold: 450,
    paymentMethods: ['all_forms'],
    cryptoDiscountType: 'percent',
    cryptoDiscountValue: 5,
    notes: 'Domestic shipping with crypto discount.',
    active: true,
    lastUpdatedAt: '2026-06-20',
  },
  {
    id: 'vendor-b',
    vendorName: 'Vendor B',
    contactName: 'Orders B',
    whatsappNumber: '+15550001002',
    region: 'overseas',
    shippingOrigin: 'International',
    averageDeliveryTime: '10-18 days',
    defaultShippingCost: 35,
    freeShippingThreshold: 700,
    paymentMethods: ['crypto', 'wire'],
    cryptoDiscountType: 'none',
    notes: 'Lower kit prices on select products.',
    active: true,
    lastUpdatedAt: '2026-06-18',
  },
  {
    id: 'vendor-c',
    vendorName: 'Vendor C',
    contactName: 'Support C',
    region: 'domestic',
    shippingOrigin: 'US',
    averageDeliveryTime: '5-7 days',
    defaultShippingCost: 12,
    paymentMethods: ['all_forms'],
    cryptoDiscountType: 'none',
    notes: 'No WhatsApp number on file.',
    active: true,
    lastUpdatedAt: '2026-06-23',
  },
];

export const seedProducts: Product[] = [
  { id: 'hgh-191aa', masterName: 'HGH 191AA', displayName: 'HGH 191AA', aliases: ['HGH', 'GH 191', 'Somatropin', 'HGH191AA'], categories: ['Growth Hormone / Growth Factors', 'Hormones / Fertility'], unitType: 'IU', active: true, createdAt: now, updatedAt: now },
  { id: 'ss-31', masterName: 'SS-31', displayName: 'SS-31', aliases: ['Elamipretide'], categories: ['Longevity / Mitochondrial / Cellular Health', 'Recovery / Tissue Repair'], unitType: 'mg', active: true, createdAt: now, updatedAt: now },
  { id: 'bpc-157', masterName: 'BPC-157', displayName: 'BPC-157', aliases: ['BPC157'], categories: ['Recovery / Tissue Repair', 'Anti-Inflammatory / Immune'], unitType: 'mg', active: true, createdAt: now, updatedAt: now },
  { id: 'tb-500', masterName: 'TB-500', displayName: 'TB-500', aliases: ['TB500'], categories: ['Recovery / Tissue Repair', 'Anti-Inflammatory / Immune'], unitType: 'mg', active: true, createdAt: now, updatedAt: now },
  { id: 'retatrutide', masterName: 'Retatrutide', displayName: 'Retatrutide', aliases: ['Reta'], categories: ['Weight Loss / Metabolic'], unitType: 'mg', active: true, createdAt: now, updatedAt: now },
  { id: 'tirzepatide', masterName: 'Tirzepatide', displayName: 'Tirzepatide', aliases: ['Tirz'], categories: ['Weight Loss / Metabolic'], unitType: 'mg', active: true, createdAt: now, updatedAt: now },
  { id: 'ghk-cu', masterName: 'GHK-Cu', displayName: 'GHK-Cu', aliases: ['Copper Peptide'], categories: ['Skin / Hair / Cosmetic', 'Recovery / Tissue Repair'], unitType: 'mg', active: true, createdAt: now, updatedAt: now },
  { id: 'dsip', masterName: 'DSIP', displayName: 'DSIP', aliases: ['Delta Sleep'], categories: ['Sleep / Relaxation'], unitType: 'mg', active: true, createdAt: now, updatedAt: now },
];

export const seedPrices: VendorPriceItem[] = [
  { id: 'a-hgh', vendorId: 'vendor-a', productId: 'hgh-191aa', vendorProductName: 'H10 - HGH 191AA', sku: 'H10', mgOrAmountPerVial: '10 IU/vial', unitType: 'IU', vialsPerKit: 10, kitPrice: 330, currency: 'USD', active: true, lastUpdatedAt: '2026-06-20' },
  { id: 'a-ss31', vendorId: 'vendor-a', productId: 'ss-31', vendorProductName: 'SS-31', sku: 'SS31-50', mgOrAmountPerVial: '50 mg', unitType: 'mg', vialsPerKit: 10, kitPrice: 285, currency: 'USD', active: true, lastUpdatedAt: '2026-06-20' },
  { id: 'a-bpc', vendorId: 'vendor-a', productId: 'bpc-157', vendorProductName: 'BPC-157', sku: 'BPC5', mgOrAmountPerVial: '5 mg', unitType: 'mg', vialsPerKit: 10, kitPrice: 78, currency: 'USD', active: true, lastUpdatedAt: '2026-06-20' },
  { id: 'a-tirz', vendorId: 'vendor-a', productId: 'tirzepatide', vendorProductName: 'Tirzepatide', sku: 'TIR30', mgOrAmountPerVial: '30 mg', unitType: 'mg', vialsPerKit: 10, kitPrice: 520, currency: 'USD', active: true, lastUpdatedAt: '2026-06-20' },
  { id: 'b-hgh', vendorId: 'vendor-b', productId: 'hgh-191aa', vendorProductName: 'GH 191', sku: 'GH191', mgOrAmountPerVial: '10 IU/vial', unitType: 'IU', vialsPerKit: 10, kitPrice: 295, currency: 'USD', active: true, lastUpdatedAt: '2026-06-18' },
  { id: 'b-tb500', vendorId: 'vendor-b', productId: 'tb-500', vendorProductName: 'TB500', sku: 'TB10', mgOrAmountPerVial: '10 mg', unitType: 'mg', vialsPerKit: 10, kitPrice: 95, currency: 'USD', active: true, lastUpdatedAt: '2026-06-18' },
  { id: 'b-reta', vendorId: 'vendor-b', productId: 'retatrutide', vendorProductName: 'Reta', sku: 'RETA20', mgOrAmountPerVial: '20 mg', unitType: 'mg', vialsPerKit: 10, kitPrice: 410, currency: 'USD', active: true, lastUpdatedAt: '2026-06-18' },
  { id: 'b-tirz', vendorId: 'vendor-b', productId: 'tirzepatide', vendorProductName: 'Tirz', sku: 'TIR30', mgOrAmountPerVial: '30 mg', unitType: 'mg', vialsPerKit: 10, kitPrice: 495, currency: 'USD', active: true, lastUpdatedAt: '2026-06-18' },
  { id: 'c-bpc', vendorId: 'vendor-c', productId: 'bpc-157', vendorProductName: 'BPC157', sku: 'BPC-5', mgOrAmountPerVial: '5 mg', unitType: 'mg', vialsPerKit: 10, kitPrice: 82, currency: 'USD', active: true, lastUpdatedAt: '2026-06-23' },
  { id: 'c-tb500', vendorId: 'vendor-c', productId: 'tb-500', vendorProductName: 'TB-500', sku: 'TB-10', mgOrAmountPerVial: '10 mg', unitType: 'mg', vialsPerKit: 10, kitPrice: 102, currency: 'USD', active: true, lastUpdatedAt: '2026-06-23' },
  { id: 'c-ghk', vendorId: 'vendor-c', productId: 'ghk-cu', vendorProductName: 'GHK-Cu', sku: 'GHK50', mgOrAmountPerVial: '50 mg', unitType: 'mg', vialsPerKit: 10, kitPrice: 130, currency: 'USD', active: true, lastUpdatedAt: '2026-06-23' },
  { id: 'c-dsip', vendorId: 'vendor-c', productId: 'dsip', vendorProductName: 'DSIP', sku: 'DSIP5', mgOrAmountPerVial: '5 mg', unitType: 'mg', vialsPerKit: 10, kitPrice: 89, currency: 'USD', active: true, lastUpdatedAt: '2026-06-23' },
];

export const defaultSettings: AppSettings = {
  disclaimerText:
    'This tool is for price comparison only. It does not guarantee product quality, vendor reliability, availability, legality, safety, purity, potency, or pricing accuracy. Prices may change after the latest update. Users are responsible for verifying current pricing directly with the vendor. Please review recent COAs and any available testing information before making a final decision.',
  coaReminderText: 'Before ordering, check the most recent COAs/testing information available in the group.',
  sessionMaxHours: 48,
};
