import { Copy, ShoppingCart, X } from 'lucide-react';
import { currency } from '../lib/pricing/format';
import type { CartItem, CartOptimizationResult, Product, SavedCart } from '../lib/types';

export function CartSummary({
  cart,
  products,
  result,
  savedCarts,
  saveMessage,
  onSaveCart,
  onLoadSavedCart,
  onDeleteSavedCart,
  onClear,
  onRemove,
  onQuantity,
}: {
  cart: CartItem[];
  products: Product[];
  result: CartOptimizationResult;
  savedCarts: SavedCart[];
  saveMessage: string;
  onSaveCart: () => void;
  onLoadSavedCart: (cart: SavedCart) => void;
  onDeleteSavedCart: (cart: SavedCart) => void;
  onClear: () => void;
  onRemove: (item: CartItem) => void;
  onQuantity: (item: CartItem, quantity: number) => void;
}) {
  const selected = cart.filter((item) => item.quantity > 0);
  const productMap = new Map(products.map((product) => [product.id, product.displayName]));
  const completeOptions = result.vendorComparisonRows.filter((row) => row.missingItems.length === 0 && row.items.length > 0);
  const totals = completeOptions.map((row) => row.finalTotal).sort((a, b) => a - b);
  const bestDealFor = (cartItem: CartItem) => result.vendorComparisonRows
    .flatMap((vendorRow) => {
      const item = vendorRow.items.find((candidate) => candidate.productId === cartItem.productId && candidate.amountKey === cartItem.amountKey);
      return item ? [{ vendorName: vendorRow.vendor.vendorName, unitPrice: item.unitPrice, lineTotal: item.lineTotal }] : [];
    })
    .sort((a, b) => a.unitPrice - b.unitPrice || a.lineTotal - b.lineTotal || a.vendorName.localeCompare(b.vendorName))[0];
  const totalRange = totals.length
    ? totals[0] === totals.at(-1)
      ? currency(totals[0])
      : `${currency(totals[0])} - ${currency(totals.at(-1) ?? totals[0])}`
    : undefined;

  async function copyCartSummary() {
    const lines = selected.map((item, index) => {
      const name = productMap.get(item.productId) ?? item.productId;
      return `${index + 1}. ${name}${item.amountLabel ? ` ${item.amountLabel}` : ''} - Qty ${item.quantity}`;
    });
    await navigator.clipboard.writeText([
      'Selected cart:',
      ...lines,
      totalRange ? `Estimated complete-vendor total range: ${totalRange}` : 'No complete-vendor total is currently available.',
    ].join('\n'));
  }

  return (
    <aside className="cart-summary">
      <div>
        <ShoppingCart size={18} />
        <strong>{selected.length} selected</strong>
        {totalRange ? <span className="cart-total-range">{totalRange}</span> : <span className="cart-total-range has-missing">No complete vendor</span>}
      </div>
      {selected.length ? (
        <ul>
          {selected.map((item) => {
            const bestDeal = bestDealFor(item);
            return (
              <li key={`${item.productId}-${item.amountKey ?? 'any'}`}>
                <span className="cart-item-name">{productMap.get(item.productId)}{item.amountLabel ? ` ${item.amountLabel}` : ''}</span>
                <span className="cart-best-deal">
                  {bestDeal ? (
                    <>
                      <small>Best deal</small>
                      <strong>{bestDeal.vendorName}</strong>
                      <span>{currency(bestDeal.unitPrice)} each</span>
                    </>
                  ) : (
                    <>
                      <small>Best deal</small>
                      <strong>Missing</strong>
                      <span>No vendor match</span>
                    </>
                  )}
                </span>
                <label>
                  Qty
                  <input
                    type="number"
                    min="0"
                    value={item.quantity}
                    onChange={(event) => onQuantity(item, Number(event.target.value))}
                  />
                </label>
                <button aria-label={`Remove ${productMap.get(item.productId) ?? 'item'}`} onClick={() => onRemove(item)}>
                  <X size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="subtle">Add quantities to compare vendors.</p>
      )}
      {selected.length > 0 && (
        <div className="button-row">
          <button onClick={onSaveCart}>Save cart</button>
          <button onClick={copyCartSummary}><Copy size={16} /> Copy cart</button>
          <button onClick={onClear}>Clear cart</button>
        </div>
      )}
      {saveMessage && <p className="cart-save-message">{saveMessage}</p>}
      {savedCarts.length > 0 && (
        <div className="saved-cart-list">
          <strong>Saved carts</strong>
          {savedCarts.map((savedCart) => (
            <div className="saved-cart-row" key={savedCart.id}>
              <span>
                <strong>{savedCart.name}</strong>
                <small>{savedCart.items.length} item{savedCart.items.length === 1 ? '' : 's'}</small>
              </span>
              <button onClick={() => onLoadSavedCart(savedCart)}>Load</button>
              <button aria-label={`Delete ${savedCart.name}`} onClick={() => onDeleteSavedCart(savedCart)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
