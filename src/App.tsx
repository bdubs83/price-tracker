import { LayoutDashboard, LogOut, Shield, SlidersHorizontal } from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CartSummary } from './components/CartSummary';
import { ComparisonResults } from './components/ComparisonResults';
import { LoginGate } from './components/LoginGate';
import { ProductPicker } from './components/ProductPicker';
import { isSessionActive } from './lib/auth/authUtils';
import { signOutMember } from './lib/auth/memberSession';
import { optimizeCart } from './lib/cartOptimizer/cartOptimizer';
import { auth } from './lib/firebase/firebase';
import { store } from './lib/storage';
import type { AppUser, CartItem, PaymentMethod, SavedCart, VendorRegion } from './lib/types';

const AdminPortal = lazy(() => import('./admin/AdminPortal').then((module) => ({ default: module.AdminPortal })));
type CloudSaveResult = 'saved' | 'unconfigured' | 'failed';
type CloudCollection = 'members' | 'vendors' | 'products' | 'prices' | 'settings';
type CloudSaveState = {
  status: 'idle' | 'saving' | CloudSaveResult;
  message: string;
  retry?: () => Promise<CloudSaveResult>;
};

function App() {
  const [user, setUserState] = useState<AppUser | undefined>(() => {
    const saved = store.getUser();
    return isSessionActive(saved?.sessionExpiresAt) ? saved : undefined;
  });
  const [members, setMembers] = useState(store.getMembers);
  const [vendors, setVendors] = useState(store.getVendors);
  const [products, setProducts] = useState(store.getProducts);
  const [prices, setPrices] = useState(store.getPrices);
  const [settings, setSettings] = useState(store.getSettings);
  const [authLoading, setAuthLoading] = useState(Boolean(auth));
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [view, setView] = useState<'member' | 'admin'>('member');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [savedCarts, setSavedCarts] = useState<SavedCart[]>([]);
  const [cartSaveMessage, setCartSaveMessage] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [region, setRegion] = useState<VendorRegion | 'all'>('all');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | 'all'>('all');
  const [excludedVendorIds, setExcludedVendorIds] = useState<string[]>([]);
  const [allowSplitOrders, setAllowSplitOrders] = useState(true);
  const [cloudSaveState, setCloudSaveState] = useState<CloudSaveState>({ status: 'idle', message: '' });
  const cloudSaveTimers = useRef<Partial<Record<CloudCollection, number>>>({});
  const loadedAdminMembersForUid = useRef<string | undefined>(undefined);

  function cloudStatusMessage(result: CloudSaveResult, label: string) {
    if (result === 'saved') return `${label} saved to the official cloud source.`;
    if (result === 'unconfigured') return `${label} saved locally. Configure Firebase to update the official cloud source.`;
    return `${label} saved locally, but the official cloud source did not update. Check Firebase admin access.`;
  }

  function queueCloudSave(collection: CloudCollection, label: string, save: () => Promise<CloudSaveResult>) {
    setCloudSaveState({ status: 'saving', message: `Saving ${label.toLowerCase()} to the official cloud source...` });
    const existingTimer = cloudSaveTimers.current[collection];
    if (existingTimer) window.clearTimeout(existingTimer);
    cloudSaveTimers.current[collection] = window.setTimeout(() => {
      void save().then((result) => {
        const retry = async () => {
          setCloudSaveState({ status: 'saving', message: `Retrying ${label.toLowerCase()} cloud save...` });
          const retryResult = await save();
          setCloudSaveState({
            status: retryResult,
            message: cloudStatusMessage(retryResult, label),
            retry: retryResult === 'failed' ? retry : undefined,
          });
          return retryResult;
        };
        setCloudSaveState({
          status: result,
          message: cloudStatusMessage(result, label),
          retry: result === 'failed' ? retry : undefined,
        });
      });
    }, 700);
  }

  function setUser(next?: AppUser) {
    setUserState(next);
    store.setUser(next);
    if (!next) setSavedCarts([]);
  }

  useEffect(() => {
    let active = true;
    if (!auth) {
      setAuthLoading(false);
      return () => {
        active = false;
      };
    }
    const configuredAuth = auth;

    const unsubscribe = onAuthStateChanged(configuredAuth, (firebaseUser) => {
      void (async () => {
        if (!active) return;
        if (!firebaseUser) {
          setUser(undefined);
          setAuthLoading(false);
          return;
        }

        const officialUser = await store.loadCurrentUser(firebaseUser.uid);
        if (!active) return;
        if (!officialUser || officialUser.uid !== firebaseUser.uid || !isSessionActive(officialUser.sessionExpiresAt)) {
          await signOutMember();
          if (!active) return;
          setUser(undefined);
          setAuthLoading(false);
          return;
        }

        setUser(officialUser);
        setAuthLoading(false);
      })();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function signOutCurrentUser() {
    await signOutMember();
    setUser(undefined);
    setView('member');
  }

  async function refreshSavedCarts(uid: string) {
    const loaded = await store.loadSavedCarts(uid);
    setSavedCarts(loaded);
  }

  async function saveCurrentCart() {
    const currentUser = user;
    const items = cart.filter((item) => item.quantity > 0);
    if (!currentUser || !items.length) return;
    const fallbackName = `Cart ${new Date().toLocaleDateString()}`;
    const name = window.prompt('Name this cart', fallbackName)?.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const savedCart: SavedCart = {
      id: `cart-${Date.now()}`,
      userId: currentUser.uid,
      name,
      items,
      createdAt: now,
      updatedAt: now,
    };
    const result = await store.saveSavedCart(savedCart);
    await refreshSavedCarts(currentUser.uid);
    setCartSaveMessage(result === 'saved' ? 'Cart saved to your account.' : result === 'unconfigured' ? 'Cart saved on this device.' : 'Cart saved on this device, but cloud save failed.');
  }

  function loadSavedCart(savedCart: SavedCart) {
    setCart(savedCart.items);
    setCartSaveMessage(`Loaded ${savedCart.name}.`);
  }

  async function deleteSavedCart(savedCart: SavedCart) {
    const currentUser = user;
    if (!currentUser) return;
    const result = await store.deleteSavedCart(currentUser.uid, savedCart.id);
    await refreshSavedCarts(currentUser.uid);
    setCartSaveMessage(result === 'saved' ? 'Saved cart deleted.' : result === 'unconfigured' ? 'Saved cart removed from this device.' : 'Saved cart removed from this device, but cloud delete failed.');
  }

  function updateMembers(next: typeof members) {
    const previous = members;
    setMembers(next);
    store.setMembers(next);
    queueCloudSave('members', 'Members', () => store.syncMembers(previous, next));
  }

  function updateVendors(next: typeof vendors) {
    const previous = vendors;
    setVendors(next);
    store.setVendors(next);
    queueCloudSave('vendors', 'Vendors', () => store.syncVendors(previous, next));
  }

  function updateProducts(next: typeof products) {
    const previous = products;
    setProducts(next);
    store.setProducts(next);
    queueCloudSave('products', 'Products', () => store.syncProducts(previous, next));
  }

  function updatePrices(next: typeof prices) {
    const previous = prices;
    setPrices(next);
    store.setPrices(next);
    queueCloudSave('prices', 'Prices', () => store.syncPrices(previous, next));
  }

  function updateSettings(next: typeof settings) {
    setSettings(next);
    store.setSettings(next);
    queueCloudSave('settings', 'Settings', () => store.syncSettings(next));
  }

  const refreshOfficialData = useCallback(async () => {
    const currentUser = user;
    if (!currentUser || authLoading) return;
    const [catalog, loadedSettings, loadedMembers] = await Promise.all([
      store.loadCatalogSeed(),
      store.loadSettings(),
      currentUser.role === 'admin' ? store.loadMembers() : Promise.resolve(members),
    ]);
    setVendors(catalog.vendors);
    setProducts(catalog.products);
    setPrices(catalog.prices);
    setSettings(loadedSettings);
    if (currentUser.role === 'admin') setMembers(loadedMembers);
  }, [authLoading, members, user]);

  useEffect(() => {
    if (authLoading || !user || catalogLoading) return;
    const needsCatalog = !(vendors.length > 0 && products.length > 0 && prices.length > 0);
    const needsAdminMembers = user.role === 'admin' && loadedAdminMembersForUid.current !== user.uid;
    if (!needsCatalog && !needsAdminMembers) return;
    if (needsAdminMembers) loadedAdminMembersForUid.current = user.uid;
    setCatalogLoading(true);
    setCatalogError('');
    Promise.all([
      needsCatalog ? store.loadCatalogSeed() : Promise.resolve({ vendors, products, prices }),
      store.loadSettings(),
      needsAdminMembers ? store.loadMembers() : Promise.resolve(members),
    ])
      .then(([catalog, loadedSettings, loadedMembers]) => {
        setVendors(catalog.vendors);
        setProducts(catalog.products);
        setPrices(catalog.prices);
        setSettings(loadedSettings);
        if (needsAdminMembers) setMembers(loadedMembers);
      })
      .catch((caught) => {
        setCatalogError(caught instanceof Error ? caught.message : 'The official catalog could not be loaded.');
      })
      .finally(() => {
        setCatalogLoading(false);
      });
  }, [authLoading, catalogLoading, members, prices, products, user, vendors]);

  useEffect(() => {
    if (!user) return;
    void refreshSavedCarts(user.uid);
  }, [user]);

  const result = useMemo(
    () => optimizeCart(cart, vendors, products, prices, { paymentMethod, region, excludeVendorIds: excludedVendorIds }),
    [cart, vendors, products, prices, paymentMethod, region, excludedVendorIds],
  );

  if (authLoading) {
    return (
      <main className="login-shell">
        <section className="login-panel loading-state">
          <div className="spinner" aria-hidden="true" />
          <div>
            <h1>Checking Access</h1>
            <p className="subtle">Confirming your verified session before loading prices.</p>
          </div>
        </section>
      </main>
    );
  }

  if (!user) {
    return <LoginGate onVerified={setUser} />;
  }

  const selectedCount = cart.filter((item) => item.quantity > 0).length;
  const catalogReady = vendors.length > 0 && products.length > 0 && prices.length > 0;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-copy">
          <span className="eyebrow"><Shield size={16} /> Verified access</span>
          <h1>Official Price Comparison Tool</h1>
          <p>Price comparison and vendor contact organization for approved members.</p>
        </div>
        <div className="header-actions">
          <span className="user-chip">{user.email}</span>
          <div className="floating-header-controls">
            <div className="view-switch" aria-label="View">
              <button className={view === 'member' ? 'active' : ''} onClick={() => setView('member')}><SlidersHorizontal size={16} /> Compare</button>
              {user.role === 'admin' && <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}><LayoutDashboard size={16} /> Admin</button>}
            </div>
            <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => void signOutCurrentUser()}><LogOut size={16} /></button>
          </div>
        </div>
      </header>

      {view === 'admin' && user.role === 'admin' ? (
        <Suspense fallback={<main className="member-layout"><section className="tool-panel"><h2>Loading Admin</h2><p className="subtle">Preparing admin tools.</p></section></main>}>
          <AdminPortal
            currentUser={user}
            members={members}
            vendors={vendors}
            products={products}
            prices={prices}
            settings={settings}
            onMembers={updateMembers}
            onVendors={updateVendors}
            onProducts={updateProducts}
            onPrices={updatePrices}
            onSettings={updateSettings}
            cloudSaveStatus={cloudSaveState.message}
            cloudSaveBlocked={cloudSaveState.status === 'failed'}
            onRetryCloudSave={cloudSaveState.retry}
            onRefreshData={refreshOfficialData}
          />
        </Suspense>
      ) : (
        <main className="member-layout">
          <div className="member-workspace">
            {catalogError ? (
              <section className="tool-panel warning-card">
                <strong>Catalog unavailable.</strong>
                <span>{catalogError}</span>
              </section>
            ) : !catalogReady ? (
              <section className="tool-panel loading-state">
                <div className="spinner" aria-hidden="true" />
                <div>
                  <h2>Loading Prices</h2>
                  <p className="subtle">Preparing vendor price lists.</p>
                </div>
              </section>
            ) : (
              <>
                <div className="browse-column">
                  <ProductPicker
                    products={products}
                    vendors={vendors}
                    prices={prices}
                    cart={cart}
                    search={search}
                    category={category}
                    region={region}
                    paymentMethod={paymentMethod}
                    excludedVendorIds={excludedVendorIds}
                    onSearch={setSearch}
                    onCategory={setCategory}
                    onRegion={setRegion}
                    onPaymentMethod={setPaymentMethod}
                    onQuantity={(productId, amountKey, amountLabel, quantity) =>
                      setCart((current) => {
                        const nextQuantity = Math.max(0, Number.isFinite(quantity) ? quantity : 0);
                        const existing = current.find((item) => item.productId === productId && item.amountKey === amountKey);
                        if (existing) return current.map((item) => (item.productId === productId && item.amountKey === amountKey ? { ...item, quantity: nextQuantity } : item));
                        return [...current, { productId, amountKey, amountLabel, quantity: nextQuantity }];
                      })
                    }
                  />
                </div>
                <aside className="decision-panel">
                  <CartSummary
                    cart={cart}
                    products={products}
                    result={result}
                    savedCarts={savedCarts}
                    saveMessage={cartSaveMessage}
                    onSaveCart={() => void saveCurrentCart()}
                    onLoadSavedCart={loadSavedCart}
                    onDeleteSavedCart={(savedCart) => void deleteSavedCart(savedCart)}
                    onClear={() => setCart([])}
                    onRemove={(target) =>
                      setCart((current) => current.filter((item) => !(item.productId === target.productId && item.amountKey === target.amountKey)))
                    }
                    onQuantity={(target, quantity) =>
                      setCart((current) =>
                        current.map((item) =>
                          item.productId === target.productId && item.amountKey === target.amountKey
                            ? { ...item, quantity: Math.max(0, Number.isFinite(quantity) ? quantity : 0) }
                            : item,
                        ),
                      )
                    }
                  />
                  {selectedCount > 0 ? (
                    <ComparisonResults
                    result={result}
                    selectedPayment={paymentMethod}
                    coaReminderText={settings.coaReminderText}
                    allowSplitOrders={allowSplitOrders}
                    onAllowSplitOrders={setAllowSplitOrders}
                    excludedVendors={vendors.filter((vendor) => excludedVendorIds.includes(vendor.id))}
                    onExcludeVendor={(vendorId) => setExcludedVendorIds((current) => current.includes(vendorId) ? current : [...current, vendorId])}
                      onRestoreVendor={(vendorId) => setExcludedVendorIds((current) => current.filter((id) => id !== vendorId))}
                      onRestoreAllVendors={() => setExcludedVendorIds([])}
                    />
                  ) : (
                    <section className="result-card decision-empty-state">
                      <h2>Ready When You Are</h2>
                      <p className="subtle">Set a quantity on any product row and the best complete vendor, split order, shipping, and message preview will appear here.</p>
                    </section>
                  )}
                </aside>
              </>
            )}
          </div>
        </main>
      )}

      <footer>
        <strong>Disclaimer:</strong> {settings.disclaimerText}
      </footer>
    </div>
  );
}

export default App;
