export type Role = 'member' | 'admin';

export type PaymentMethod = 'crypto' | 'wire' | 'all_forms';
export type VendorRegion = 'domestic' | 'overseas' | 'mixed' | 'unknown';
export type UnitType = 'mg' | 'mcg' | 'IU' | 'vial' | 'kit' | 'blend' | 'other';

export type ApprovedMember = {
  email: string;
  name?: string;
  skoolUsername?: string;
  source: 'csv' | 'zapier' | 'manual';
  active: boolean;
  importedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AppUser = {
  uid: string;
  email: string;
  role: Role;
  verifiedAt: string;
  lastLoginAt: string;
  sessionExpiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AppSettings = {
  disclaimerText: string;
  coaReminderText: string;
  sessionMaxHours: number;
};

export type Vendor = {
  id: string;
  vendorName: string;
  contactName?: string;
  whatsappNumber?: string;
  region: VendorRegion;
  shippingOrigin?: string;
  averageDeliveryTime?: string;
  defaultShippingCost: number;
  freeShippingThreshold?: number;
  paymentMethods: PaymentMethod[];
  cryptoDiscountType: 'none' | 'percent' | 'fixed' | 'custom';
  cryptoDiscountValue?: number;
  shippingRule?: WeightTierShippingRule;
  notes?: string;
  active: boolean;
  lastUpdatedAt: string;
};

export type WeightTierShippingRule = {
  type: 'weight_tier';
  powderGramsPerBox: number;
  waterGramsPerBox: number;
  tierGrams: number;
  defaultServiceId: string;
  services: Array<{
    id: string;
    name: string;
    firstTierCost: number;
    additionalTierCost: number;
    deliveryEstimate: string;
  }>;
};

export type ProductCategory =
  | 'Weight Loss / Metabolic'
  | 'Growth Hormone / Growth Factors'
  | 'Recovery / Tissue Repair'
  | 'Anti-Inflammatory / Immune'
  | 'Brain / Mood / Cognitive'
  | 'Sleep / Relaxation'
  | 'Skin / Hair / Cosmetic'
  | 'Longevity / Mitochondrial / Cellular Health'
  | 'Hormones / Fertility'
  | 'Sexual Health'
  | 'Injectable Nutrients / Amino Acids'
  | 'Waters / Reconstitution'
  | 'Research / Specialty Compounds'
  | 'Other / Needs Review';

export type Product = {
  id: string;
  masterName: string;
  displayName: string;
  aliases: string[];
  categories: ProductCategory[];
  unitType: UnitType;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VendorPriceItem = {
  id: string;
  vendorId: string;
  productId: string;
  vendorProductName: string;
  sku?: string;
  mgOrAmountPerVial?: string;
  unitType: UnitType;
  vialsPerKit: number;
  kitPrice: number;
  currency: 'USD';
  active: boolean;
  priceListId?: string;
  lastUpdatedAt: string;
  notes?: string;
};

export type CartItem = {
  productId: string;
  amountKey?: string;
  amountLabel?: string;
  quantity: number;
};

export type SavedCart = {
  id: string;
  userId: string;
  name: string;
  items: CartItem[];
  createdAt: string;
  updatedAt: string;
};

export type UserFilters = {
  paymentMethod?: PaymentMethod | 'all';
  region?: VendorRegion | 'all';
  includeVendorIds?: string[];
  excludeVendorIds?: string[];
};

export type ComparisonItemRow = {
  productId: string;
  amountKey?: string;
  productName: string;
  productCategories?: ProductCategory[];
  vendorProductName?: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  amount?: string;
  lastUpdatedAt?: string;
};

export type VendorBreakdown = {
  vendor: Vendor;
  items: ComparisonItemRow[];
  missingItems: string[];
  subtotal: number;
  shipping: number;
  shippingDetails?: {
    serviceName?: string;
    deliveryEstimate?: string;
    totalWeightGrams?: number;
    tierCount?: number;
    alternateServices: Array<{
      serviceName: string;
      deliveryEstimate: string;
      cost: number;
    }>;
  };
  discount: number;
  finalTotal: number;
  paymentMethods: PaymentMethod[];
  deliveryEstimate?: string;
  lastUpdated?: string;
};

export type CartOptimizationResult = {
  bestSingleVendor?: VendorBreakdown;
  bestSplitOrder?: {
    vendors: VendorBreakdown[];
    total: number;
    savingsVsSingle?: number;
    note: string;
  };
  partialVendorOptions: VendorBreakdown[];
  vendorComparisonRows: VendorBreakdown[];
};

export type CsvImportSummary = {
  totalRowsFound: number;
  validEmailsImported: number;
  duplicateEmailsSkipped: number;
  invalidRows: number;
  previousMembersRemoved: number;
  newMembersAdded: number;
  importedAt: string;
  members: ApprovedMember[];
};
