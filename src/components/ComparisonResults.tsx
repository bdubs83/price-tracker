import { ChevronDown, Copy, ExternalLink, MessageCircle, X } from 'lucide-react';
import { useState } from 'react';
import { displayAmountLabel } from '../lib/pricing/amount';
import { currency, shortDate } from '../lib/pricing/format';
import { paymentMethodsLabel } from '../lib/pricing/payment';
import { buildWhatsAppMessage, buildWhatsAppUrl, buildWhatsAppWebUrl } from '../lib/whatsapp/whatsapp';
import type { CartOptimizationResult, PaymentMethod, VendorBreakdown } from '../lib/types';

type ComparisonResultsProps = {
  result: CartOptimizationResult;
  selectedPayment: PaymentMethod | 'all';
  coaReminderText: string;
  allowSplitOrders: boolean;
  onAllowSplitOrders: (value: boolean) => void;
  excludedVendors: VendorBreakdown['vendor'][];
  onExcludeVendor: (vendorId: string) => void;
  onRestoreVendor: (vendorId: string) => void;
  onRestoreAllVendors: () => void;
};

function VendorActions({ order, selectedPayment }: { order: VendorBreakdown; selectedPayment: PaymentMethod | 'all' }) {
  const message = buildWhatsAppMessage(order, selectedPayment);
  const url = buildWhatsAppUrl(order.vendor.whatsappNumber, message);
  const webUrl = buildWhatsAppWebUrl(order.vendor.whatsappNumber, message);
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="order-message-panel">
      <div className="order-message-header">
        <strong>Message preview</strong>
        {copied && <span>Copied</span>}
      </div>
      <textarea readOnly value={message} />
      <div className="button-row">
        {url ? (
          <a className="button primary whatsapp-button" href={url} target="_blank" rel="noreferrer">
            <MessageCircle size={16} /> Open WhatsApp App <ExternalLink size={14} />
          </a>
        ) : null}
        {webUrl ? (
          <a className="button whatsapp-web-button" href={webUrl} target="_blank" rel="noreferrer">
            <MessageCircle size={16} /> WhatsApp Web <ExternalLink size={14} />
          </a>
        ) : null}
        <button className={url ? undefined : 'primary'} onClick={copyMessage}>
          <Copy size={16} /> Copy Message
        </button>
      </div>
      {!order.vendor.whatsappNumber && <p className="subtle">No WhatsApp number is saved for this vendor. Use the copied message with another contact method.</p>}
    </div>
  );
}

function VendorCard({ title, order, selectedPayment, coaReminderText }: { title: string; order?: VendorBreakdown; selectedPayment: PaymentMethod | 'all'; coaReminderText: string }) {
  if (!order) {
    return (
      <section className="result-card">
        <h2>{title}</h2>
        <p className="subtle">No complete vendor option matches the current cart and filters.</p>
      </section>
    );
  }

  return (
    <section className="result-card wide">
      <div className="panel-header">
        <div>
          <div className="title-row">
            <h2>{title}</h2>
            <span className="status-pill ok">Complete</span>
          </div>
          <p>{order.vendor.vendorName}</p>
        </div>
        <strong>{currency(order.finalTotal)}</strong>
      </div>

      <div className="line-items">
        {order.items.map((item) => (
          <div key={`${order.vendor.id}-${item.productId}-${item.amountKey ?? 'any'}`}>
            <span>
              {item.vendorProductName ?? item.productName}
              {item.sku ? ` (${item.sku})` : ''}
              {item.amount ? ` - ${displayAmountLabel(item.amount)}` : ''}
            </span>
            <span>
              {item.quantity} x {currency(item.unitPrice)}
            </span>
          </div>
        ))}
      </div>

      <dl className="totals">
        <div><dt>Subtotal</dt><dd>{currency(order.subtotal)}</dd></div>
        <div><dt>Shipping</dt><dd>{currency(order.shipping)}</dd></div>
        <div><dt>Discount</dt><dd>-{currency(order.discount)}</dd></div>
        <div><dt>Updated</dt><dd>{shortDate(order.lastUpdated)}</dd></div>
      </dl>

      {order.missingItems.length > 0 && <p className="warning">Missing: {order.missingItems.join(', ')}</p>}

      <div className="vendor-meta">
        <span>{paymentMethodsLabel(order.paymentMethods)}</span>
        <span>{order.vendor.region}</span>
        <span>{order.shippingDetails?.deliveryEstimate ?? order.deliveryEstimate ?? 'Delivery unknown'}</span>
        <span>Includes shipping of {currency(order.shipping)}</span>
        {order.shippingDetails?.serviceName && order.shippingDetails.totalWeightGrams && (
          <span>{order.shippingDetails.serviceName}: {order.shippingDetails.totalWeightGrams}g billable weight</span>
        )}
        {order.shippingDetails?.alternateServices.map((service) => (
          <span key={service.serviceName}>{service.serviceName}: {currency(service.cost)}, {service.deliveryEstimate}</span>
        ))}
      </div>
      <p className="coa">{coaReminderText}</p>
      {order.items.length > 0 && <VendorActions order={order} selectedPayment={selectedPayment} />}
    </section>
  );
}

export function ComparisonResults({
  result,
  selectedPayment,
  coaReminderText,
  allowSplitOrders,
  onAllowSplitOrders,
  excludedVendors,
  onExcludeVendor,
  onRestoreVendor,
  onRestoreAllVendors,
}: ComparisonResultsProps) {
  const bestCompleteVendorId = result.bestSingleVendor?.vendor.id;
  const [selectedVendorId, setSelectedVendorId] = useState<string | undefined>();
  const [completeVendorsOnly, setCompleteVendorsOnly] = useState(false);
  const displayedVendorRows = completeVendorsOnly
    ? result.vendorComparisonRows.filter((row) => row.missingItems.length === 0)
    : result.vendorComparisonRows;
  const selectedVendor = displayedVendorRows.find((row) => row.vendor.id === selectedVendorId);
  const selectedHasFreeShipping = Boolean(selectedVendor?.vendor.freeShippingThreshold && selectedVendor.subtotal >= selectedVendor.vendor.freeShippingThreshold);
  const splitIsCheaper = Boolean(
    result.bestSplitOrder
      && result.bestSingleVendor
      && result.bestSplitOrder.total < result.bestSingleVendor.finalTotal,
  );
  const splitSavings = splitIsCheaper && result.bestSplitOrder?.savingsVsSingle
    ? currency(result.bestSplitOrder.savingsVsSingle)
    : undefined;

  const recommendation = result.bestSplitOrder && (!result.bestSingleVendor || (allowSplitOrders && splitIsCheaper))
    ? 'split'
    : result.bestSingleVendor
      ? 'single'
      : result.bestSplitOrder
        ? 'split'
        : undefined;

  return (
    <div className="results-grid">
      {excludedVendors.length > 0 && (
        <section className="result-card wide excluded-vendors">
          <div>
            <strong>{excludedVendors.length} vendor{excludedVendors.length === 1 ? '' : 's'} excluded</strong>
            <button onClick={onRestoreAllVendors}>Restore all</button>
          </div>
          <div className="excluded-vendor-list">
            {excludedVendors.map((vendor) => (
              <button key={vendor.id} onClick={() => onRestoreVendor(vendor.id)}>
                Restore {vendor.vendorName}
              </button>
            ))}
          </div>
        </section>
      )}
      {!result.bestSingleVendor && (
        <section className="result-card wide warning-card">
          <strong>No single vendor can fulfill the whole cart.</strong>
          <span>Review missing counts below or use the recommended split order if available.</span>
        </section>
      )}
      <section className="result-card wide">
        <div className="panel-header compact-panel-header">
          <div>
            <h2>Vendor Options</h2>
            <p className="subtle">{displayedVendorRows.length} of {result.vendorComparisonRows.length} vendors shown</p>
          </div>
          <div className="result-controls">
            <label className="inline-check filter-check">
              <input type="checkbox" checked={completeVendorsOnly} onChange={(event) => setCompleteVendorsOnly(event.target.checked)} />
              Complete only
            </label>
            <label className="inline-check filter-check">
              <input type="checkbox" checked={allowSplitOrders} onChange={(event) => onAllowSplitOrders(event.target.checked)} />
              Allow split orders
            </label>
          </div>
        </div>
        {result.bestSplitOrder && result.bestSingleVendor && (
          <div className={allowSplitOrders ? 'split-preference' : 'split-preference muted-split-preference'}>
            <strong>{allowSplitOrders ? 'Split orders allowed' : 'Single vendor preferred'}</strong>
            <span>
              {splitSavings
                ? `The best split saves ${splitSavings}, but requires ${result.bestSplitOrder.vendors.length} separate orders.`
                : 'The best split does not beat the best complete single-vendor option right now.'}
            </span>
          </div>
        )}
        <div className="vendor-option-grid">
          {displayedVendorRows.map((row) => {
            return (
              <button className={`vendor-option-card${row.vendor.id === bestCompleteVendorId ? ' best-vendor-option' : ''}`} key={row.vendor.id} onClick={() => setSelectedVendorId(row.vendor.id)}>
                <span className="vendor-option-toggle">
                  <span className="vendor-option-name">
                    <strong title={row.vendor.vendorName}>{row.vendor.vendorName}</strong>
                    {row.vendor.id === bestCompleteVendorId && <span className="best-option-badge">Best complete</span>}
                  </span>
                  <ChevronDown size={16} />
                </span>
                <div className="vendor-option-stats">
                  <span className="status-pill ok">{row.items.length} available</span>
                  <span className={row.missingItems.length ? 'missing-count has-missing' : 'missing-count'}>
                    {row.missingItems.length} missing
                  </span>
                </div>
                <div className="vendor-option-price">
                  <strong>{currency(row.finalTotal)}</strong>
                  <span>Total with shipping</span>
                </div>
              </button>
            );
          })}
        </div>
        {selectedVendor && (
          <div className="vendor-detail-overlay" role="dialog" aria-modal="true" aria-labelledby="vendor-detail-title" onClick={() => setSelectedVendorId(undefined)}>
            <div className="vendor-detail-modal" onClick={(event) => event.stopPropagation()}>
              <div className="panel-header compact-panel-header">
                <div>
                  <h3 id="vendor-detail-title">{selectedVendor.vendor.vendorName}</h3>
                  <p className="subtle">{selectedVendor.items.length} available, {selectedVendor.missingItems.length} missing</p>
                </div>
                <button className="icon-button" aria-label="Close vendor details" onClick={() => setSelectedVendorId(undefined)}><X size={16} /></button>
              </div>
              <dl className="totals compact-totals">
                <div><dt>Subtotal</dt><dd>{currency(selectedVendor.subtotal)}</dd></div>
                <div><dt>Shipping</dt><dd>{selectedHasFreeShipping ? 'Free' : currency(selectedVendor.shipping)}</dd></div>
                <div><dt>Discount</dt><dd>-{currency(selectedVendor.discount)}</dd></div>
                <div><dt>Total</dt><dd>{currency(selectedVendor.finalTotal)}</dd></div>
                <div><dt>Updated</dt><dd>{shortDate(selectedVendor.lastUpdated)}</dd></div>
              </dl>
              <div className="vendor-meta">
                <span>{paymentMethodsLabel(selectedVendor.paymentMethods)}</span>
                <span>{selectedVendor.vendor.region}</span>
                <span>{selectedVendor.shippingDetails?.deliveryEstimate ?? selectedVendor.deliveryEstimate ?? 'Delivery unknown'}</span>
                {selectedHasFreeShipping && <span>Free shipping applied</span>}
                {selectedVendor.shippingDetails?.serviceName && selectedVendor.shippingDetails.totalWeightGrams && (
                  <span>{selectedVendor.shippingDetails.serviceName}: {selectedVendor.shippingDetails.totalWeightGrams}g billable weight</span>
                )}
                {selectedVendor.shippingDetails?.alternateServices.map((service) => (
                  <span key={service.serviceName}>{service.serviceName}: {currency(service.cost)}, {service.deliveryEstimate}</span>
                ))}
              </div>
              <div className="line-items compact-line-items vendor-detail-items">
                {selectedVendor.items.map((item) => (
                  <div key={`${selectedVendor.vendor.id}-${item.productId}-${item.amountKey ?? 'any'}`}>
                    <span>{item.vendorProductName ?? item.productName}{item.amount ? ` - ${displayAmountLabel(item.amount)}` : ''}</span>
                    <span>{item.quantity} x {currency(item.unitPrice)}</span>
                  </div>
                ))}
                {selectedVendor.missingItems.map((item) => (
                  <div className="vendor-detail-missing-item" key={`${selectedVendor.vendor.id}-missing-${item}`}>
                    <span>{item}</span>
                    <span>- Missing</span>
                  </div>
                ))}
              </div>
              {selectedVendor.items.length > 0 && <VendorActions order={selectedVendor} selectedPayment={selectedPayment} />}
              <button onClick={() => onExcludeVendor(selectedVendor.vendor.id)}>Exclude vendor from comparison</button>
            </div>
          </div>
        )}
        {displayedVendorRows.length === 0 && (
          <div className="empty-state">
            <strong>No complete vendor options match.</strong>
            <span>Turn off complete-only or adjust the cart and filters.</span>
          </div>
        )}
      </section>

      {recommendation === 'single' && result.bestSingleVendor ? (
        <VendorCard title="Recommended Order" order={result.bestSingleVendor} selectedPayment={selectedPayment} coaReminderText={coaReminderText} />
      ) : (
        <section className="result-card wide">
          <div className="title-row">
            <h2>Recommended Order</h2>
            {recommendation === 'split' && <span className="status-pill warning">Split</span>}
          </div>
          {recommendation === 'split' && result.bestSplitOrder ? (
          <>
            <p>{result.bestSplitOrder.note}</p>
            <strong className="total-display">{currency(result.bestSplitOrder.total)}</strong>
            <div className="split-list">
              {result.bestSplitOrder.vendors.map((vendor) => (
                <div key={vendor.vendor.id}>
                  <span>{vendor.vendor.vendorName}</span>
                  <span>{vendor.items.length} item{vendor.items.length === 1 ? '' : 's'}</span>
                  <strong>{currency(vendor.finalTotal)}</strong>
                </div>
              ))}
            </div>
            <div className="split-message-grid">
              {result.bestSplitOrder.vendors.map((vendor) => (
                <div className="split-message-card" key={`${vendor.vendor.id}-message`}>
                  <div>
                    <strong>{vendor.vendor.vendorName}</strong>
                    <span>{vendor.items.length} item{vendor.items.length === 1 ? '' : 's'} ready to send</span>
                  </div>
                  <VendorActions order={vendor} selectedPayment={selectedPayment} />
                </div>
              ))}
            </div>
          </>
          ) : (
            <p className="subtle">No complete vendor or split recommendation can fulfill the selected cart.</p>
          )}
        </section>
      )}

    </div>
  );
}
