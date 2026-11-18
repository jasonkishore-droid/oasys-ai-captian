import { money, ORDER_TYPE_LABEL, PAYMENT_LABEL } from './format';
import { useApp } from './ui.jsx';
import UpiQr from './UpiQr.jsx';
import { showUpiQr, billUpiLink } from './upi';

// GST tax invoice, laid out for 80 mm thermal printers. `bill` is a saved bill or a POS draft.
export default function Receipt({ bill, draft }) {
  const { settings } = useApp();
  const r = settings.restaurant;
  const when = bill.created_at ? new Date(bill.created_at) : new Date();
  const half = bill.tax_rate / 2;
  return (
    <div className="receipt" id="receipt">
      {draft && <div className="stamp">PREVIEW · NOT SAVED</div>}
      {bill.status === 'void' && <div className="stamp void">VOID · {bill.void_reason}</div>}
      <div className="r-head">
        <div className="r-title">{r.name.toUpperCase()}</div>
        <div className="r-sub">{r.tagline}</div>
        <div className="r-sub">{r.address}{r.phone && ` · ${r.phone}`}</div>
        {r.gstin && <div className="r-sub">GSTIN: {r.gstin}</div>}
        {r.fssai && <div className="r-sub">FSSAI Lic. No: {r.fssai}</div>}
        <div className="r-doc">TAX INVOICE</div>
      </div>

      <div className="r-meta">
        <div><span>Bill No</span><strong>{bill.bill_no || 'DRAFT'}</strong></div>
        {draft && <div className="r-note">Final number is assigned when the bill is saved</div>}
        <div><span>Date</span><strong>{when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</strong></div>
        <div><span>Type</span><strong>{ORDER_TYPE_LABEL[bill.order_type]}{bill.table_no ? ` · ${bill.table_no}` : ''}</strong></div>
        {bill.customer && <div><span>Guest</span><strong>{bill.customer}</strong></div>}
        {bill.cashier && <div><span>Cashier</span><strong>{bill.cashier}</strong></div>}
      </div>

      <table className="r-items">
        <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amt</th></tr></thead>
        <tbody>
          {bill.items.map((l, i) => (
            <tr key={l.dish_id ?? i}>
              <td>{l.name}</td>
              <td className="num">{l.quantity}</td>
              <td className="num">{l.unit_price.toFixed(2)}</td>
              <td className="num">{(l.line_total ?? l.quantity * l.unit_price).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="r-totals">
        <div><span>Subtotal</span><span>{money(bill.subtotal)}</span></div>
        {bill.discount > 0 && <div><span>Discount</span><span>− {money(bill.discount)}</span></div>}
        {bill.service_charge > 0 && <div><span>Service charge ({bill.service_rate}%, optional)</span><span>{money(bill.service_charge)}</span></div>}
        <div><span>Taxable value</span><span>{money(bill.taxable)}</span></div>
        <div><span>CGST @ {half}%</span><span>{money(bill.cgst)}</span></div>
        <div><span>SGST @ {half}%</span><span>{money(bill.sgst)}</span></div>
        {bill.round_off !== 0 && <div><span>Round off</span><span>{bill.round_off > 0 ? '+' : '−'} {money(Math.abs(bill.round_off))}</span></div>}
        <div className="r-grand"><span>Total</span><span>{money(bill.total)}</span></div>
        {bill.payment_mode && <div className="r-paid"><span>Paid by</span><span>{PAYMENT_LABEL[bill.payment_mode]}</span></div>}
      </div>
      {showUpiQr(settings, bill) && (
        <div className="r-upi">
          <div className="r-upi-title">Scan to pay {money(bill.total)} by UPI</div>
          <UpiQr link={billUpiLink(settings, bill)} />
          <div className="r-sub">{settings.upi.upi_id}</div>
        </div>
      )}
      <div className="r-foot">Nandri! Thank you for dining with us.<br />Food prepared fresh in our kitchen.</div>
    </div>
  );
}
