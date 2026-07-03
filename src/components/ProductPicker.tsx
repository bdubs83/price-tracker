import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Fragment, useState } from 'react';
import { categories } from '../data/seed';
import { amountKey, vendorMatchesFilters } from '../lib/cartOptimizer/cartOptimizer';
import { displayAmountLabel } from '../lib/pricing/amount';
import { currency } from '../lib/pricing/format';
import type { CartItem, PaymentMethod, Product, Vendor, VendorPriceItem, VendorRegion } from '../lib/types';

type ProductPickerProps = {
  products: Product[];
  vendors: Vendor[];
  prices: VendorPriceItem[];
  cart: CartItem[];
  search: string;
  category: string;
  region: VendorRegion | 'all';
  paymentMethod: PaymentMethod | 'all';
  excludedVendorIds: string[];
  onSearch: (value: string) => void;
  onCategory: (value: string) => void;
  onRegion: (value: VendorRegion | 'all') => void;
  onPaymentMethod: (value: PaymentMethod | 'all') => void;
  onQuantity: (productId: string, amountKey: string, amountLabel: string, quantity: number) => void;
};

function amountSortValue(label: string) {
  const normalized = label.toLowerCase().replace(/\s+/g, '');
  const match = normalized.match(/(\d+(?:\.\d+)?)(mg|mcg|iu|ml)/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const unitRank: Record<string, number> = { mg: 1, mcg: 1, iu: 2, ml: 3 };
  let amount = Number(match[1]);
  if (match[2] === 'mcg') amount = amount / 1000;
  return (unitRank[match[2]] ?? 9) * 1_000_000 + amount;
}

export function ProductPicker({
  products,
  vendors,
  prices,
  cart,
  search,
  category,
  region,
  paymentMethod,
  excludedVendorIds,
  onSearch,
  onCategory,
  onRegion,
  onPaymentMethod,
  onQuantity,
}: ProductPickerProps) {
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(() => new Set());
  const query = search.trim().toLowerCase();
  const productMap = new Map(products.map((product) => [product.id, product]));
  const eligibleVendors = vendors.filter((vendor) => vendorMatchesFilters(vendor, { paymentMethod, region, excludeVendorIds: excludedVendorIds }));
  const eligibleVendorIds = new Set(eligibleVendors.map((vendor) => vendor.id));
  const visibleProducts = products.filter((product) => {
    const matchesCategory = category === 'all' || product.categories.includes(category as never);
    return product.active && matchesCategory;
  });
  const visibleProductIds = new Set(visibleProducts.map((product) => product.id));
  const quantityFor = (productId: string, key: string) => cart.find((item) => item.productId === productId && item.amountKey === key)?.quantity ?? 0;
  const selectedCount = cart.filter((item) => item.quantity > 0).length;

  const rows = [...prices
    .filter((price) => price.active && visibleProductIds.has(price.productId) && eligibleVendorIds.has(price.vendorId))
    .reduce((groups, price) => {
      const product = productMap.get(price.productId);
      if (!product) return groups;
      const fullAmountLabel = price.mgOrAmountPerVial || 'Unspecified amount';
      const rowAmountKey = amountKey(price.mgOrAmountPerVial, price.vialsPerKit);
      const key = `${price.productId}__${rowAmountKey}`;
      const current = groups.get(key) ?? {
        productId: price.productId,
        productName: product.displayName,
        categories: product.categories.join(', '),
        amountKey: rowAmountKey,
        amountLabel: displayAmountLabel(fullAmountLabel),
        cells: new Map<string, VendorPriceItem>(),
      };
      const existing = current.cells.get(price.vendorId);
      if (!existing || price.kitPrice < existing.kitPrice) current.cells.set(price.vendorId, price);
      groups.set(key, current);
      return groups;
    }, new Map<string, { productId: string; productName: string; categories: string; amountKey: string; amountLabel: string; cells: Map<string, VendorPriceItem> }>())
    .values()]
    .filter((row) => {
      if (!query) return true;
      const haystack = [
        row.productName,
        row.amountLabel,
        ...[...row.cells.values()].flatMap((cell) => [cell.vendorProductName, cell.sku ?? '']),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => a.productName.localeCompare(b.productName) || amountSortValue(a.amountLabel) - amountSortValue(b.amountLabel) || a.amountLabel.localeCompare(b.amountLabel));
  const productGroups = rows.reduce((groups, row) => {
    const current = groups.get(row.productId) ?? {
      productId: row.productId,
      productName: row.productName,
      categories: row.categories,
      rows: [] as typeof rows,
    };
    current.rows.push(row);
    groups.set(row.productId, current);
    return groups;
  }, new Map<string, { productId: string; productName: string; categories: string; rows: typeof rows }>());
  const quickCategories = categories.slice(0, 6);
  const productGroupList = [...productGroups.values()];
  const matrixMinWidth = Math.max(640, 198 + (eligibleVendors.length * 76));
  const toggleProductGroup = (productId: string) => {
    setExpandedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };
  const groupPriceRange = (group: (typeof productGroupList)[number]) => {
    const pricesInGroup = group.rows.flatMap((row) => [...row.cells.values()].map((cell) => cell.kitPrice));
    const low = Math.min(...pricesInGroup);
    const high = Math.max(...pricesInGroup);
    return { low, high };
  };
  const renderPriceRow = (row: (typeof rows)[number], keySuffix = '') => {
    const rowQuantity = quantityFor(row.productId, row.amountKey);
    return (
      <tr className={rowQuantity > 0 ? 'selected-price-row' : undefined} key={`${row.productId}-${row.amountKey}${keySuffix}`}>
        <td className="sticky-col">
          <div className="product-cell">
            <div>
              <strong>{row.productName}</strong>
              <span>{row.amountLabel}</span>
              <small>{row.categories}</small>
            </div>
            <input
              aria-label={`${row.productName} ${row.amountLabel} quantity`}
              type="number"
              min="0"
              value={rowQuantity}
              onChange={(event) => onQuantity(row.productId, row.amountKey, row.amountLabel, Number(event.target.value))}
            />
          </div>
        </td>
        {eligibleVendors.map((vendor) => {
          const cell = row.cells.get(vendor.id);
          const bestPrice = Math.min(...[...row.cells.values()].map((item) => item.kitPrice));
          const isBestPrice = Boolean(cell && cell.kitPrice === bestPrice && row.cells.size > 1);
          return (
            <td key={vendor.id} className={cell ? `price-cell${isBestPrice ? ' best-price' : ''}` : 'missing-cell'}>
              {cell ? (
                <>
                  {isBestPrice && <><span className="best-value-tag">Best</span> </>}
                  <strong>{currency(cell.kitPrice)}</strong>
                  <span>{cell.sku || cell.vendorProductName}</span>
                </>
              ) : (
                <span>-</span>
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <section className="tool-panel">
      <div className="browse-start">
        <div>
          <h2>Build Cart</h2>
          <p className="subtle">Search a product, choose a category, then set quantities on exact dose rows. Your best vendor options update below the table.</p>
        </div>
        <div className="browse-stats">
          <span><strong>{rows.length}</strong> dose rows</span>
          <span><strong>{eligibleVendors.length}</strong> vendors</span>
          <span><strong>{selectedCount}</strong> selected</span>
        </div>
      </div>

      <div className="filters">
        <label className="search-field">
          <Search size={18} />
          <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search product or alias" />
        </label>
        <select aria-label="Category" value={category} onChange={(event) => onCategory(event.target.value)}>
          <option value="all">All categories</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select aria-label="Region" value={region} onChange={(event) => onRegion(event.target.value as VendorRegion | 'all')}>
          <option value="all">All regions</option>
          <option value="domestic">Domestic</option>
          <option value="overseas">Overseas</option>
          <option value="mixed">Mixed</option>
        </select>
        <select aria-label="Payment method" value={paymentMethod} onChange={(event) => onPaymentMethod(event.target.value as PaymentMethod | 'all')}>
          <option value="all">All payments</option>
          <option value="crypto">Crypto</option>
          <option value="wire">Wire</option>
          <option value="all_forms">All Forms</option>
        </select>
      </div>

      <div className="quick-category-row" aria-label="Quick categories">
        <button className={category === 'all' ? 'active' : ''} onClick={() => onCategory('all')}>All</button>
        {quickCategories.map((item) => (
          <button key={item} className={category === item ? 'active' : ''} onClick={() => onCategory(item)}>
            {item.replace(' / ', ' + ')}
          </button>
        ))}
      </div>

      <div className="price-matrix-wrap">
        <table className="price-matrix" style={{ minWidth: `max(100%, ${matrixMinWidth}px)` }}>
          <colgroup>
            <col className="product-matrix-col" />
            {eligibleVendors.map((vendor) => (
              <col className="vendor-matrix-col" key={`${vendor.id}-col`} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky-col">Product</th>
              {eligibleVendors.map((vendor) => (
                <th key={vendor.id}>{vendor.vendorName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productGroupList.map((group) => {
              if (group.rows.length === 1) return renderPriceRow(group.rows[0]);
              const expanded = expandedProductIds.has(group.productId);
              const selectedInGroup = group.rows.reduce((sum, row) => sum + (quantityFor(row.productId, row.amountKey) > 0 ? 1 : 0), 0);
              const { low, high } = groupPriceRange(group);
              return (
                <Fragment key={`${group.productId}-group`}>
                  <tr className={`product-summary-row${selectedInGroup > 0 ? ' selected-price-row' : ''}`} key={`${group.productId}-summary`}>
                    <td className="sticky-col">
                      <button className="product-summary-toggle" onClick={() => toggleProductGroup(group.productId)} aria-expanded={expanded}>
                        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span>
                          <strong>{group.productName}</strong>
                          <small>{group.categories}</small>
                        </span>
                      </button>
                    </td>
                    <td className="product-summary-range" colSpan={eligibleVendors.length}>
                      <button onClick={() => toggleProductGroup(group.productId)}>
                        <strong>
                          {group.rows.length} variant{group.rows.length === 1 ? '' : 's'} ranging from {currency(low)} to {currency(high)}
                        </strong>
                        <span>{expanded ? 'Click to collapse' : 'Click to expand'}</span>
                        {selectedInGroup > 0 && <small>{selectedInGroup} selected</small>}
                      </button>
                    </td>
                  </tr>
                  {expanded && group.rows.map((row) => renderPriceRow(row, '-expanded'))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="compact-price-list">
        {[...productGroups.values()].map((group) => {
          const selectedInGroup = group.rows.reduce((sum, row) => sum + (quantityFor(row.productId, row.amountKey) > 0 ? 1 : 0), 0);
          const cheapest = Math.min(...group.rows.flatMap((row) => [...row.cells.values()].map((cell) => cell.kitPrice)));
          return (
            <details className="product-dose-group" key={`${group.productId}-compact-group`} open={selectedInGroup > 0 || Boolean(query)}>
              <summary>
                <span>
                  <strong>{group.productName}</strong>
                  <small>{group.categories}</small>
                </span>
                <span>
                  <strong>{group.rows.length} dose{group.rows.length === 1 ? '' : 's'}</strong>
                  <small>from {currency(cheapest)}</small>
                </span>
              </summary>
              <div className="product-dose-group-body">
                {group.rows.map((row) => {
                  const rowQuantity = quantityFor(row.productId, row.amountKey);
                  const availableCells = eligibleVendors
                    .map((vendor) => ({ vendor, cell: row.cells.get(vendor.id) }))
                    .filter((entry): entry is { vendor: Vendor; cell: VendorPriceItem } => Boolean(entry.cell))
                    .sort((a, b) => a.cell.kitPrice - b.cell.kitPrice || a.vendor.vendorName.localeCompare(b.vendor.vendorName));
                  const bestPrice = availableCells[0]?.cell.kitPrice;
                  const missingCount = eligibleVendors.length - availableCells.length;

                  return (
                    <article className={`compact-price-card${rowQuantity > 0 ? ' selected-price-card' : ''}`} key={`${row.productId}-${row.amountKey}-compact`}>
                      <div className="compact-price-card-header">
                        <div>
                          <strong>{row.amountLabel}</strong>
                          <span>{row.productName}</span>
                        </div>
                        <input
                          aria-label={`${row.productName} ${row.amountLabel} quantity`}
                          type="number"
                          min="0"
                          value={rowQuantity}
                          onChange={(event) => onQuantity(row.productId, row.amountKey, row.amountLabel, Number(event.target.value))}
                        />
                      </div>
                      <div className="compact-vendor-price-list">
                        {availableCells.map(({ vendor, cell }) => (
                          <div className={cell.kitPrice === bestPrice && availableCells.length > 1 ? 'compact-vendor-price best-price' : 'compact-vendor-price'} key={`${row.productId}-${row.amountKey}-${vendor.id}`}>
                            <span>
                              <strong>{vendor.vendorName}</strong>
                              <small>{cell.sku || cell.vendorProductName}</small>
                            </span>
                            <span className="compact-price-value">
                              {cell.kitPrice === bestPrice && availableCells.length > 1 && <small>Best</small>}
                              <strong>{currency(cell.kitPrice)}</strong>
                            </span>
                          </div>
                        ))}
                      </div>
                      {missingCount > 0 && <p className="compact-missing-note">{missingCount} vendor{missingCount === 1 ? '' : 's'} missing this dose</p>}
                    </article>
                  );
                })}
              </div>
            </details>
          );
        })}
        {rows.length === 0 && (
          <div className="empty-state">
            <strong>No dose rows match these filters.</strong>
            <span>Try clearing search, region, payment, or selected-only filters.</span>
          </div>
        )}
      </div>

      {rows.length === 0 && (
        <div className="empty-state desktop-empty-state">
          <strong>No dose rows match these filters.</strong>
          <span>Try clearing search, region, payment, or selected-only filters.</span>
        </div>
      )}

      <p className="subtle">{eligibleVendors.length} vendors match the current filters. {rows.length} dose rows are visible.</p>
    </section>
  );
}
