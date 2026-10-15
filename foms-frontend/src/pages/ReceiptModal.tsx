import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastContext';
import { Button } from '../components/Buttons';
import type { Receipt, Client, Invoice, Payment } from '../types/entities';

// Shared date formatter displaying dates consistently as "Oct 11, 2026"
export const formatReceiptDate = (dateVal?: string | Date | null): string => {
  if (!dateVal) return '-';
  const d = new Date(dateVal);
  return isNaN(d.getTime()) ? String(dateVal) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Converts numeric pesos amount into word representation (e.g. "Fifteen thousand pesos only")
export function numberToWords(amount: number | string | null | undefined): string {
  const num = typeof amount === 'number'
    ? amount
    : parseFloat(String(amount || 0).replace(/[^0-9.-]+/g, ''));
  if (isNaN(num) || !isFinite(num) || num <= 0) return 'Zero pesos only';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertChunk(n: number): string {
    let str = '';
    if (n >= 100) {
      str += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      str += tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    } else if (n > 0) {
      str += ones[n];
    }
    return str.trim();
  }

  const pesos = Math.floor(num);
  const centavos = Math.round((num - pesos) * 100);

  if (pesos === 0 && centavos === 0) return 'Zero pesos only';

  let words = '';
  const millions = Math.floor(pesos / 1000000);
  const thousands = Math.floor((pesos % 1000000) / 1000);
  const remainder = pesos % 1000;

  if (millions > 0) {
    words += convertChunk(millions) + ' Million ';
  }
  if (thousands > 0) {
    words += convertChunk(thousands) + ' Thousand ';
  }
  if (remainder > 0) {
    words += convertChunk(remainder) + ' ';
  }

  words = words.trim() + ' Pesos';
  if (centavos > 0) {
    words += ' and ' + centavos + '/100 Centavos';
  }
  return words + ' Only';
}

export interface ReceiptModalProps {
  isOpen: boolean;
  receiptId: string | null;
  onClose: () => void;
  clients: Client[];
  invoices: Invoice[];
  payments: Payment[];
  receipts: Receipt[];
  isLoading?: boolean;
}

class ReceiptModalErrorBoundary extends React.Component<{ children: React.ReactNode; onClose: () => void }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, info: any) {
    console.error('ReceiptModal error caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.5)' }}>
          <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', textAlign: 'center', maxWidth: '440px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
            <i className="ti ti-alert-triangle" style={{ fontSize: '32px', color: '#EF4444', display: 'block', marginBottom: '8px' }} />
            <h4 style={{ margin: '0 0 8px', color: '#0F172A' }}>Receipt Details Unavailable</h4>
            <p style={{ fontSize: '13px', color: '#64748B', margin: '0 0 12px' }}>Could not render receipt modal at this time.</p>
            {this.state.error?.message && (
              <pre style={{ fontSize: '11px', color: '#EF4444', background: '#FEF2F2', padding: '8px', borderRadius: '6px', textAlign: 'left', overflowX: 'auto', marginBottom: '16px', maxHeight: '100px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {this.state.error.message}
              </pre>
            )}
            <button onClick={this.props.onClose} style={{ padding: '8px 16px', background: '#0D9488', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const ReceiptModalInner: React.FC<ReceiptModalProps> = ({
  isOpen,
  receiptId,
  onClose,
  clients,
  invoices,
  payments,
  receipts,
  isLoading,
}) => {
  const { user } = useAuth();
  const [isDownloading, setIsDownloading] = useState(false);
  const lastLoadedReceiptRef = useRef<any>(null);

  // Keep showing the loaded receipt while refetching so the modal never unmounts and remounts
  const resolvedReceipt = useMemo(() => {
    if (!receiptId) return null;
    const rId = String(receiptId).trim().toLowerCase();
    const raw = (receipts || []).find((r: Receipt) => 
      r && (
        String(r.id || '').toLowerCase() === rId || 
        String((r as any).receiptNumber || '').toLowerCase() === rId ||
        String(r.paymentId || '').toLowerCase() === rId ||
        String(r.referenceNumber || '').toLowerCase() === rId
      )
    ) ||
    (payments || []).find((p: Payment) => 
      p && (
        String(p.id || '').toLowerCase() === rId || 
        String(p.referenceNumber || '').toLowerCase() === rId || 
        String(p.orNumber || '').toLowerCase() === rId ||
        String((p as any).orNumber || '').toLowerCase() === rId ||
        String(p.invoiceId || '').toLowerCase() === rId ||
        String(p.invoiceNumber || '').toLowerCase() === rId
      )
    );
    if (raw) {
      lastLoadedReceiptRef.current = raw;
      return raw;
    }
    // Also check invoices if receiptId is an invoice
    const inv = (invoices || []).find(i => i && (String(i.id || '').toLowerCase() === rId || String(i.invoiceNumber || '').toLowerCase() === rId));
    if (inv) {
      const pmt = (payments || []).find(p => p && (p.invoiceId === inv.id || p.invoiceNumber === inv.invoiceNumber));
      const synthReceipt: any = {
        id: pmt?.id || `OR-${inv.invoiceNumber || inv.id}`,
        receiptNumber: pmt?.orNumber || `OR-${pmt?.referenceNumber || inv.invoiceNumber || inv.id}`,
        paymentId: pmt?.id,
        clientId: inv.clientId,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        referenceNumber: pmt?.referenceNumber || 'N/A',
        paymentMethod: pmt?.paymentMethod || 'Bank Transfer',
        amount: Number(pmt?.amount || inv.totalAmount || inv.amount || 0),
        issuedAt: (pmt as any)?.paymentDate || (pmt as any)?.recordedAt || inv.createdAt || new Date().toISOString(),
        status: 'Issued OR',
      };
      lastLoadedReceiptRef.current = synthReceipt;
      return synthReceipt;
    }
    return lastLoadedReceiptRef.current;
  }, [receiptId, receipts, payments, invoices]);

  // Lock background scroll and trap Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen || !resolvedReceipt) return null;

  const rawPayment = (payments || []).find((p: Payment) => p && (p.id === (resolvedReceipt as any).paymentId || p.id === resolvedReceipt.id));
  const client: any = (clients || []).find((c: Client) => c && (c.id === resolvedReceipt.clientId || c.clientCode === resolvedReceipt.clientId)) || {
    name: (resolvedReceipt as any).clientName || rawPayment?.clientName || resolvedReceipt.clientId,
    tin: (resolvedReceipt as any).tin || '000-123-456-000',
    address: (resolvedReceipt as any).address || 'Metro Manila, Philippines',
    vatStatus: 'VATable',
    vatRate: 0.12,
  };
  const invoice = (invoices || []).find((i: Invoice) => 
    i && (
      i.id === resolvedReceipt.invoiceId || 
      i.invoiceNumber === (resolvedReceipt as any).invoiceNumber || 
      i.invoiceNumber === resolvedReceipt.invoiceId ||
      (i as any).invoiceNo === (resolvedReceipt as any).invoiceNumber ||
      (i as any).invoiceNo === resolvedReceipt.invoiceId
    )
  );

  const safeAmount = typeof resolvedReceipt.amount === 'number'
    ? (isNaN(resolvedReceipt.amount) ? 0 : resolvedReceipt.amount)
    : (parseFloat(String(resolvedReceipt.amount || 0).replace(/[^0-9.-]+/g, '')) || 0);

  const or = {
    ...resolvedReceipt,
    receiptNumber: (resolvedReceipt as any).receiptNumber || (resolvedReceipt as any).orNumber || `OR-${resolvedReceipt.referenceNumber || String(resolvedReceipt.id).slice(0, 8).toUpperCase()}`,
    clientName: client?.name ?? (resolvedReceipt as any).clientName ?? 'Unknown',
    clientCode: resolvedReceipt.clientId || '-',
    invoiceNumber: invoice?.invoiceNumber ?? (resolvedReceipt as any).invoiceNumber ?? resolvedReceipt.invoiceId ?? 'N/A',
    paymentMethod: rawPayment?.paymentMethod ?? (resolvedReceipt as any).paymentMethod ?? 'SpeedPay (GCash)',
    referenceNumber: rawPayment?.referenceNumber ?? resolvedReceipt.referenceNumber ?? 'N/A',
    amount: safeAmount,
    issuedAt: (resolvedReceipt as any).issuedAt || (resolvedReceipt as any).paymentDate || (resolvedReceipt as any).submittedAt || new Date().toISOString(),
  };

  const issuedByName = user?.fullName || 'Finance Accountant';
  const invoiceStatus = (invoice?.status || (invoice as any)?.paymentStatus || (or as any)?.invoiceStatus || 'Paid');
  const isPaid = String(invoiceStatus).toLowerCase() === 'paid' || rawPayment?.status === 'Validated' || rawPayment?.status === 'Approved';
  const isPartial = String(invoiceStatus).toLowerCase().includes('partial');
  const watermarkText = isPaid ? 'PAID' : isPartial ? 'PARTIAL' : null;

  // Invoice & Receipt Breakdown Values
  const rawFreight = Number(
    (invoice as any)?.freightCharges ??
    (invoice as any)?.subtotal ??
    invoice?.amount ??
    0
  );
  const rawVat = Number((invoice as any)?.vatAmount ?? 0);
  const rawSurcharge = Number(
    (invoice as any)?.surcharge ??
    (invoice as any)?.surchargeAmount ??
    0
  );
  const rawOther = Number((invoice as any)?.otherCharges ?? 0);
  const rawInvoiceTotal = Number(
    invoice?.totalAmount ??
    (rawFreight + rawVat + rawSurcharge + rawOther)
  );

  const isVatable = client?.vatStatus !== 'Non-VATable';
  const vatRate = Number((client as any)?.vatRate ?? (invoice as any)?.vatRate ?? 0.12);

  let breakdownFreight = 0;
  let breakdownVat = 0;
  let breakdownSurcharge = 0;
  let breakdownOther = 0;

  if (rawInvoiceTotal > 0 && (rawFreight > 0 || rawVat > 0)) {
    const ratio = Math.min(1, or.amount / rawInvoiceTotal);
    if (Math.abs(or.amount - rawInvoiceTotal) < 0.05) {
      breakdownFreight = rawFreight;
      breakdownVat = rawVat;
      breakdownSurcharge = rawSurcharge;
      breakdownOther = rawOther;
    } else {
      breakdownFreight = rawFreight * ratio;
      breakdownVat = rawVat * ratio;
      breakdownSurcharge = rawSurcharge * ratio;
      breakdownOther = rawOther * ratio;
    }
  } else {
    if (isVatable) {
      breakdownFreight = or.amount / (1 + vatRate);
      breakdownVat = or.amount - breakdownFreight;
      breakdownSurcharge = 0;
    } else {
      breakdownFreight = or.amount;
      breakdownVat = 0;
      breakdownSurcharge = 0;
    }
  }

  const vatableSales = isVatable ? (breakdownFreight + breakdownSurcharge + breakdownOther) : 0;
  const vatExemptSales = !isVatable ? or.amount : 0;
  const zeroRatedSales = 0;

  const waybillCount = (invoice?.waybillIds && Array.isArray(invoice.waybillIds))
    ? invoice.waybillIds.length
    : (typeof (invoice as any)?.waybillIds === 'string' && (invoice as any).waybillIds.trim())
      ? (invoice as any).waybillIds.split(',').filter(Boolean).length
      : null;

  // Download PDF handler that renders the receipt to a PDF file, falling back to window.print()
  const handleDownloadPdf = async () => {
    const element = document.getElementById('printable-receipt-card');
    if (!element) {
      window.print();
      return;
    }

    setIsDownloading(true);
    try {
      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = (html2pdfModule as any).default || html2pdfModule;
      const opt = {
        margin: [10, 10, 10, 10],
        filename: `Official_Receipt_${or.receiptNumber || 'Speedex'}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.warn('html2pdf generation error, falling back to window.print():', err);
      window.print();
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Official Receipt Details"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(4px)',
        padding: '24px',
        boxSizing: 'border-box',
      }}
      onClick={onClose}
    >
      {/* Print stylesheet hiding backdrop, top bar, and background page */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-receipt-card, #printable-receipt-card * {
            visibility: visible !important;
          }
          #printable-receipt-card {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 16px !important;
            border: none !important;
            box-shadow: none !important;
            background: #ffffff !important;
            page-break-inside: avoid !important;
          }
          @page {
            size: A4 portrait;
            margin: 10mm;
          }
        }
      `}</style>

      {/* Centered modal container with 24px viewport margin */}
      <div
        style={{
          background: '#FFFFFF',
          width: '100%',
          maxWidth: '900px',
          maxHeight: 'calc(100vh - 48px)',
          margin: '24px auto',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky top bar with status info, Print action, and X close button */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            background: '#FFFFFF',
            padding: '16px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #E2E8F0',
            zIndex: 20,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', gap: '28px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: '#94A3B8', letterSpacing: '0.05em' }}>PAYMENT STATUS</span>
              <span style={{ color: '#D97706', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: '#FEF3C7', display: 'flex', padding: '2px', borderRadius: '50%' }}>
                  <i className="ti ti-alert-circle" style={{ color: '#D97706', fontSize: '14px' }} />
                </span>
                Issued OR
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: '#94A3B8', letterSpacing: '0.05em' }}>INVOICE STATUS</span>
              <span style={{ color: isPaid ? '#059669' : '#D97706', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: isPaid ? '#D1FAE5' : '#FEF3C7', display: 'flex', padding: '2px', borderRadius: '50%' }}>
                  <i className={`ti ${isPaid ? 'ti-check' : 'ti-clock'}`} style={{ color: isPaid ? '#059669' : '#D97706', fontSize: '14px' }} />
                </span>
                {isPaid ? 'Paid' : isPartial ? 'Partial' : String(invoiceStatus)}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: '#94A3B8', letterSpacing: '0.05em' }}>DATE ISSUED</span>
              <span style={{ color: '#0F172A', fontWeight: 700, fontSize: '13px' }}>{formatReceiptDate(or.issuedAt)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                color: '#64748B',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#F1F5F9';
                e.currentTarget.style.color = '#0F172A';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'none';
                e.currentTarget.style.color = '#64748B';
              }}
            >
              <i className="ti ti-x" style={{ fontSize: '20px' }} />
            </button>
          </div>
        </div>

        {/* Scrollable receipt body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '24px', background: '#F8FAFC' }}>
          <div
            id="printable-receipt-card"
            style={{
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '12px',
              padding: '36px',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            {/* Watermark conditioned strictly on invoice status */}
            {watermarkText && (
              <div
                style={{
                  position: 'absolute',
                  top: '35%',
                  left: '50%',
                  transform: 'translate(-50%, -50%) rotate(-20deg)',
                  pointerEvents: 'none',
                  border: watermarkText === 'PAID' ? '6px solid rgba(220, 38, 38, 0.15)' : '6px solid rgba(217, 119, 6, 0.15)',
                  color: watermarkText === 'PAID' ? 'rgba(220, 38, 38, 0.15)' : 'rgba(217, 119, 6, 0.15)',
                  padding: '10px 30px',
                  fontSize: '5rem',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  zIndex: 0,
                }}
              >
                {watermarkText}
              </div>
            )}

            {/* Receipt Header */}
            <div style={{ textAlign: 'center', marginBottom: '32px', position: 'relative', zIndex: 1 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: '1.3rem', fontWeight: 800, color: '#0F172A' }}>Speedex Courier & Forwarder, Inc.</h2>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748B' }}>123 Rizal St, Brgy. Poblacion, Cebu City</p>
              <h1 style={{ margin: '24px 0 16px', fontSize: '1.8rem', fontWeight: 800, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#0F172A' }}>
                RECEIPT
              </h1>
            </div>

            {/* Receipt Meta Details */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '32px', fontSize: '0.85rem', position: 'relative', zIndex: 1, gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', color: '#0F172A' }}>
                <span style={{ color: '#64748B' }}>Receipt #:</span> <strong>{or.receiptNumber}</strong>
                <span style={{ color: '#64748B' }}>Issue Date:</span> <strong>{formatReceiptDate(or.issuedAt)}</strong>
                <span style={{ color: '#64748B' }}>Payment Method:</span> <strong>{or.paymentMethod}</strong>
                <span style={{ color: '#64748B' }}>Reference #:</span> <strong>{or.referenceNumber}</strong>
              </div>
              <div style={{ textAlign: 'right', color: '#0F172A' }}>
                <span style={{ color: '#64748B', display: 'block', marginBottom: '4px' }}>Received From:</span>
                <strong style={{ fontSize: '1rem' }}>{or.clientName}</strong>
                <p style={{ margin: '4px 0 0', color: '#475569' }}>Code: {or.clientCode}</p>
                <p style={{ margin: '4px 0 0', color: '#475569' }}>TIN: {client?.tin || (client as any)?.TIN || 'N/A'}</p>
                <p style={{ margin: '4px 0 0', color: '#475569' }}>Address: {client?.address || 'N/A'}</p>
                <p style={{ margin: '4px 0 0', color: '#475569' }}>Invoice No: {or.invoiceNumber}</p>
              </div>
            </div>

            {/* Payment & Billing Breakdown Table */}
            <div style={{ marginBottom: '24px', position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '8px' }}>
                Payment & Billing Breakdown
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderTop: '1.5px solid #CBD5E1', borderBottom: '1.5px solid #CBD5E1' }}>
                    <th style={{ textAlign: 'left', padding: '10px 4px', color: '#475569', fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase' }}>Description / Particulars</th>
                    <th style={{ textAlign: 'center', padding: '10px 4px', color: '#475569', fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase' }}>Coverage</th>
                    <th style={{ textAlign: 'right', padding: '10px 4px', color: '#475569', fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '10px 4px', color: '#0F172A', fontWeight: 600 }}>
                      Courier & Forwarding Freight Charges
                      <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '2px' }}>
                        Linked Invoice: <strong>{or.invoiceNumber}</strong>
                      </div>
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#475569', fontSize: '0.8rem' }}>
                      {waybillCount ? `${waybillCount} waybill${waybillCount !== 1 ? 's' : ''}` : 'Standard Delivery'}
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                      ₱{breakdownFreight.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                  {breakdownSurcharge > 0 && (
                    <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '10px 4px', color: '#0F172A', fontWeight: 600 }}>
                        Fuel Surcharge (15%)
                      </td>
                      <td style={{ padding: '10px 4px', textAlign: 'center', color: '#64748B', fontSize: '0.8rem' }}>
                        Tariff surcharge
                      </td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                        ₱{breakdownSurcharge.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  )}
                  {breakdownOther > 0 && (
                    <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '10px 4px', color: '#0F172A', fontWeight: 600 }}>
                        Other Surcharges & Handling
                      </td>
                      <td style={{ padding: '10px 4px', textAlign: 'center', color: '#64748B', fontSize: '0.8rem' }}>
                        Special handling
                      </td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                        ₱{breakdownOther.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  )}
                  <tr style={{ borderBottom: '1.5px solid #CBD5E1' }}>
                    <td style={{ padding: '10px 4px', color: '#0F172A', fontWeight: 600 }}>
                      Value Added Tax (12% VAT)
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'center', color: '#64748B', fontSize: '0.8rem' }}>
                      {client?.vatStatus ?? 'VATable'}
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                      ₱{breakdownVat.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'right', padding: '14px 12px 4px', fontSize: '0.95rem', fontWeight: 800, color: '#0F172A' }}>
                      Amount Received:
                    </td>
                    <td style={{ textAlign: 'right', padding: '14px 4px 4px', fontSize: '1.25rem', fontWeight: 900, color: '#0F172A' }}>
                      ₱{(Number(or.amount) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Amount Received in words */}
            <div style={{ background: '#F8FAFC', padding: '12px 16px', borderRadius: 8, marginTop: '8px', textAlign: 'center', position: 'relative', zIndex: 1 }}>
              <span style={{ color: '#64748B', fontSize: '0.75rem', display: 'block', marginBottom: '4px', fontWeight: 700, letterSpacing: '0.05em' }}>AMOUNT IN WORDS</span>
              <strong style={{ color: '#0F172A', fontSize: '0.95rem' }}>{numberToWords(or.amount)}</strong>
            </div>

            {/* Receipt Footer with Authorized Representative signature */}
            <div style={{ marginTop: '48px', position: 'relative', zIndex: 1 }}>
              <p style={{ margin: '0 0 24px', fontSize: '1rem', color: '#0F172A', fontWeight: 600, textAlign: 'center' }}>Thank you!</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid #E2E8F0', paddingTop: '16px' }}>
                <div style={{ textAlign: 'left' }}>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748B' }}>System-generated receipt from Speedex FOMS.</p>
                </div>
                <div style={{ textAlign: 'center', minWidth: 180 }}>
                  <div style={{ borderTop: '1.5px solid #0F172A', paddingTop: 6 }}>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#0F172A', fontWeight: 700 }}>{issuedByName}</p>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>Authorized Representative</p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Modal footer with Close and Download as PDF button */}
        <div
          style={{
            padding: '12px 24px',
            background: '#FFFFFF',
            borderTop: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '12px',
            flexShrink: 0,
          }}
        >
          <Button title="Close" variant="secondary" onClick={onClose} />
          <Button
            title={isDownloading ? "Downloading..." : "Download as PDF"}
            variant="primary"
            icon="ti-download"
            loading={isDownloading}
            onClick={handleDownloadPdf}
          />
        </div>
      </div>
    </div>,
    document.body
  );
};

export const ReceiptModal: React.FC<ReceiptModalProps> = (props) => (
  <ReceiptModalErrorBoundary onClose={props.onClose}>
    <ReceiptModalInner {...props} />
  </ReceiptModalErrorBoundary>
);

export default ReceiptModal;
