import { defaultSettings, seedPrices, seedProducts, seedVendors } from '../data/seed';
import type { WriteBatch } from 'firebase/firestore/lite';
import type { AppSettings, ApprovedMember, AppUser, Product, SavedCart, Vendor, VendorPriceItem } from './types';

const keys = {
  members: 'opt.v12.members',
  user: 'opt.user',
  vendors: 'opt.v12.vendors',
  products: 'opt.v12.products',
  prices: 'opt.v12.prices',
  settings: 'opt.v12.settings',
  savedCarts: (uid: string) => `opt.v12.savedCarts.${uid}`,
};

function read<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, removeUndefined(item)]),
  );
}

function hasCatalogData(catalog: { vendors: Vendor[]; products: Product[]; prices: VendorPriceItem[] }) {
  return catalog.vendors.length > 0 && catalog.products.length > 0 && catalog.prices.length > 0;
}

function hasChanged<T>(previous?: T, next?: T) {
  return JSON.stringify(removeUndefined(previous)) !== JSON.stringify(removeUndefined(next));
}

function toIsoString(value: unknown) {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  if (!value || typeof value !== 'object') return '';

  const maybeTimestamp = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
  if (typeof maybeTimestamp.toDate === 'function') return maybeTimestamp.toDate().toISOString();
  if (typeof maybeTimestamp.seconds === 'number') {
    const millis = (maybeTimestamp.seconds * 1000) + Math.floor((maybeTimestamp.nanoseconds ?? 0) / 1000000);
    return new Date(millis).toISOString();
  }

  return '';
}

function normalizeCloudUser(value: AppUser) {
  return {
    ...value,
    verifiedAt: toIsoString(value.verifiedAt),
    lastLoginAt: toIsoString(value.lastLoginAt),
    sessionExpiresAt: toIsoString(value.sessionExpiresAt),
    createdAt: toIsoString(value.createdAt),
    updatedAt: toIsoString(value.updatedAt),
  };
}

async function getFirestoreApi() {
  const [{ db, isFirebaseConfigured }, firestore] = await Promise.all([
    import('./firebase/firebase'),
    import('firebase/firestore/lite'),
  ]);

  if (!db || !isFirebaseConfigured) return undefined;
  return { db, ...firestore };
}

async function loadCloudCollection<T extends { id: string }>(collectionName: string) {
  const api = await getFirestoreApi();
  if (!api) return undefined;

  try {
    const snapshot = await api.getDocs(api.collection(api.db, collectionName));
    const rows = snapshot.docs.map((item) => ({ ...(item.data() as T), id: item.id }));
    return rows.length ? rows : undefined;
  } catch (error) {
    console.warn(`Cloud ${collectionName} load failed.`, error);
    return undefined;
  }
}

async function loadCloudSettings() {
  const api = await getFirestoreApi();
  if (!api) return undefined;

  try {
    const snapshot = await api.getDoc(api.doc(api.db, 'appSettings', 'default'));
    return snapshot.exists() ? snapshot.data() as AppSettings : undefined;
  } catch (error) {
    console.warn('Cloud settings load failed.', error);
    return undefined;
  }
}

async function loadCloudUser(uid: string) {
  const api = await getFirestoreApi();
  if (!api) return undefined;

  try {
    const snapshot = await api.getDoc(api.doc(api.db, 'users', uid));
    return snapshot.exists() ? normalizeCloudUser(snapshot.data() as AppUser) : undefined;
  } catch (error) {
    console.warn('Cloud user session load failed.', error);
    return undefined;
  }
}

async function writeBatchOperations(operations: Array<(batch: WriteBatch) => void>) {
  const api = await getFirestoreApi();
  if (!api) return 'unconfigured' as const;

  try {
    for (let index = 0; index < operations.length; index += 450) {
      const batch = api.writeBatch(api.db);
      operations.slice(index, index + 450).forEach((operation) => operation(batch));
      await batch.commit();
    }
    return 'saved' as const;
  } catch (error) {
    console.warn('Cloud save failed. Local cache is still updated.', error);
    return 'failed' as const;
  }
}

async function syncCloudCollection<T extends { id: string }>(collectionName: string, previous: T[], next: T[]) {
  const api = await getFirestoreApi();
  if (!api) return 'unconfigured' as const;

  const previousById = new Map(previous.map((item) => [item.id, item]));
  const nextIds = new Set(next.map((item) => item.id));
  const operations: Array<(batch: WriteBatch) => void> = [];

  next.forEach((item) => {
    if (!hasChanged(previousById.get(item.id), item)) return;
    operations.push((batch) => batch.set(api.doc(api.db, collectionName, item.id), removeUndefined(item) as Record<string, unknown>));
  });

  previous.forEach((item) => {
    if (!nextIds.has(item.id)) {
      operations.push((batch) => batch.delete(api.doc(api.db, collectionName, item.id)));
    }
  });

  if (!operations.length) return 'saved' as const;
  return writeBatchOperations(operations);
}

async function syncCloudSettings(settings: AppSettings) {
  const api = await getFirestoreApi();
  if (!api) return 'unconfigured' as const;

  try {
    await api.setDoc(api.doc(api.db, 'appSettings', 'default'), removeUndefined(settings) as Record<string, unknown>);
    return 'saved' as const;
  } catch (error) {
    console.warn('Cloud settings save failed. Local cache is still updated.', error);
    return 'failed' as const;
  }
}

async function loadCloudApprovedMembers() {
  const api = await getFirestoreApi();
  if (!api) return undefined;

  try {
    const snapshot = await api.getDocs(api.collection(api.db, 'approvedMembers'));
    const rows = snapshot.docs.map((item) => item.data() as ApprovedMember);
    return rows.length ? rows : undefined;
  } catch (error) {
    console.warn('Cloud approved members load failed.', error);
    return undefined;
  }
}

async function loadCloudSavedCarts(uid: string) {
  const api = await getFirestoreApi();
  if (!api) return undefined;

  try {
    const snapshot = await api.getDocs(api.collection(api.db, 'users', uid, 'savedCarts'));
    return snapshot.docs.map((item) => ({ ...(item.data() as SavedCart), id: item.id }));
  } catch (error) {
    console.warn('Cloud saved carts load failed.', error);
    return undefined;
  }
}

async function saveCloudSavedCart(cart: SavedCart) {
  const api = await getFirestoreApi();
  if (!api) return 'unconfigured' as const;

  try {
    await api.setDoc(api.doc(api.db, 'users', cart.userId, 'savedCarts', cart.id), removeUndefined(cart) as Record<string, unknown>);
    return 'saved' as const;
  } catch (error) {
    console.warn('Cloud saved cart save failed. Local cache is still updated.', error);
    return 'failed' as const;
  }
}

async function deleteCloudSavedCart(uid: string, cartId: string) {
  const api = await getFirestoreApi();
  if (!api) return 'unconfigured' as const;

  try {
    await api.deleteDoc(api.doc(api.db, 'users', uid, 'savedCarts', cartId));
    return 'saved' as const;
  } catch (error) {
    console.warn('Cloud saved cart delete failed. Local cache is still updated.', error);
    return 'failed' as const;
  }
}

async function syncApprovedMembers(previous: ApprovedMember[], next: ApprovedMember[]) {
  const api = await getFirestoreApi();
  if (!api) return 'unconfigured' as const;

  const previousByEmail = new Map(previous.map((item) => [item.email, item]));
  const nextEmails = new Set(next.map((item) => item.email));
  const operations: Array<(batch: WriteBatch) => void> = [];

  next.forEach((item) => {
    if (!hasChanged(previousByEmail.get(item.email), item)) return;
    operations.push((batch) => batch.set(api.doc(api.db, 'approvedMembers', item.email), removeUndefined(item) as Record<string, unknown>));
  });

  previous.forEach((item) => {
    if (!nextEmails.has(item.email)) {
      operations.push((batch) => batch.delete(api.doc(api.db, 'approvedMembers', item.email)));
    }
  });

  if (!operations.length) return 'saved' as const;
  return writeBatchOperations(operations);
}

export const store = {
  getMembers: () => read<ApprovedMember[]>(keys.members, []),
  setMembers: (members: ApprovedMember[]) => write(keys.members, members),
  getUser: () => read<AppUser | undefined>(keys.user, undefined),
  setUser: (user?: AppUser) => (user ? write(keys.user, user) : localStorage.removeItem(keys.user)),
  loadCurrentUser: async (uid: string) => {
    const cloudUser = await loadCloudUser(uid);
    if (cloudUser) {
      write(keys.user, cloudUser);
      return cloudUser;
    }
    return read<AppUser | undefined>(keys.user, undefined);
  },
  getVendors: () => read<Vendor[]>(keys.vendors, []),
  setVendors: (vendors: Vendor[]) => write(keys.vendors, vendors),
  getProducts: () => read<Product[]>(keys.products, []),
  setProducts: (products: Product[]) => write(keys.products, products),
  getPrices: () => read<VendorPriceItem[]>(keys.prices, []),
  setPrices: (prices: VendorPriceItem[]) => write(keys.prices, prices),
  getSettings: () => read<AppSettings>(keys.settings, defaultSettings),
  setSettings: (settings: AppSettings) => write(keys.settings, settings),
  loadMembers: async () => {
    const cloudMembers = await loadCloudApprovedMembers();
    if (cloudMembers) {
      write(keys.members, cloudMembers);
      return cloudMembers;
    }
    return read<ApprovedMember[]>(keys.members, []);
  },
  loadCatalogSeed: async () => {
    const [{ isFirebaseConfigured }] = await Promise.all([
      import('./firebase/firebase'),
    ]);
    const [cloudVendors, cloudProducts, cloudPrices] = await Promise.all([
      loadCloudCollection<Vendor>('vendors'),
      loadCloudCollection<Product>('products'),
      loadCloudCollection<VendorPriceItem>('vendorPriceItems'),
    ]);
    const cloudCatalog = {
      vendors: cloudVendors ?? [],
      products: cloudProducts ?? [],
      prices: cloudPrices ?? [],
    };
    if (hasCatalogData(cloudCatalog)) {
      write(keys.vendors, cloudCatalog.vendors);
      write(keys.products, cloudCatalog.products);
      write(keys.prices, cloudCatalog.prices);
      return cloudCatalog;
    }

    const localCatalog = {
      vendors: read<Vendor[]>(keys.vendors, []),
      products: read<Product[]>(keys.products, []),
      prices: read<VendorPriceItem[]>(keys.prices, []),
    };
    if (hasCatalogData(localCatalog)) return localCatalog;

    const seedCatalog = { vendors: seedVendors, products: seedProducts, prices: seedPrices };
    if (isFirebaseConfigured) {
      console.info('Official cloud catalog is empty or unavailable. Loading starter catalog so admins can finish setup.');
    }
    write(keys.vendors, seedCatalog.vendors);
    write(keys.products, seedCatalog.products);
    write(keys.prices, seedCatalog.prices);
    return seedCatalog;
  },
  loadSettings: async () => {
    const cloudSettings = await loadCloudSettings();
    if (cloudSettings) {
      write(keys.settings, cloudSettings);
      return cloudSettings;
    }
    return read<AppSettings>(keys.settings, defaultSettings);
  },
  getSavedCarts: (uid: string) => read<SavedCart[]>(keys.savedCarts(uid), []),
  loadSavedCarts: async (uid: string) => {
    const cloudCarts = await loadCloudSavedCarts(uid);
    if (cloudCarts) {
      const sorted = cloudCarts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      write(keys.savedCarts(uid), sorted);
      return sorted;
    }
    return read<SavedCart[]>(keys.savedCarts(uid), []);
  },
  saveSavedCart: async (cart: SavedCart) => {
    const current = read<SavedCart[]>(keys.savedCarts(cart.userId), []);
    const next = [cart, ...current.filter((item) => item.id !== cart.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    write(keys.savedCarts(cart.userId), next);
    return saveCloudSavedCart(cart);
  },
  deleteSavedCart: async (uid: string, cartId: string) => {
    const next = read<SavedCart[]>(keys.savedCarts(uid), []).filter((item) => item.id !== cartId);
    write(keys.savedCarts(uid), next);
    return deleteCloudSavedCart(uid, cartId);
  },
  syncVendors: (previous: Vendor[], next: Vendor[]) => syncCloudCollection('vendors', previous, next),
  syncProducts: (previous: Product[], next: Product[]) => syncCloudCollection('products', previous, next),
  syncPrices: (previous: VendorPriceItem[], next: VendorPriceItem[]) => syncCloudCollection('vendorPriceItems', previous, next),
  syncMembers: syncApprovedMembers,
  syncSettings: syncCloudSettings,
};
