import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/shared/StatusBadge';
import { Card } from '../components/Card';
import { Button } from '../components/Buttons';
import { TableContainer } from '../components/TableContainer';
import { ClientInfoCard } from '../components/ClientInfoCard';
import { useToast } from '../components/ToastContext';
import { useQuery } from '../hooks/useQuery';
import { paymentsService } from '../services/paymentsService';
import { clientsService } from '../services/clientsService';
import { invoicesService } from '../services/invoicesService';
import type { Receipt, Client, Invoice, Payment } from '../types/entities';
import { ReceiptModal, formatReceiptDate } from './ReceiptModal';

export const Receipts: React.FC = () => {
  const { id: clientIdParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const receiptIdParam = searchParams.get('receiptId');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: receiptsData, isLoading: isLoadingReceipts } = useQuery('receipts', () => paymentsService.receipts.list({ pageSize: 100 }));
  const { data: clientsData } = useQuery('clients', () => clientsService.list({ pageSize: 100 }));
  const { data: invoicesData } = useQuery('invoices', () => invoicesService.list({ pageSize: 100 }));
  const { data: paymentsData, isLoading: isLoadingPayments } = useQuery('payments', () => paymentsService.list({ pageSize: 100 }));

  const receipts: Receipt[] = receiptsData?.items || [];
  const clients: Client[] = clientsData?.items || [];
  const invoices: Invoice[] = invoicesData?.items || [];
  const payments: Payment[] = paymentsData?.items || [];

  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailViewMode, setDetailViewMode] = useState<'cards' | 'table'>('cards');
  const [detailSearchQuery, setDetailSearchQuery] = useState('');
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);

  // Opening modal by setting receiptId query param using replace to avoid polluting browser history
  const handleOpenReceipt = (receiptId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('receiptId', receiptId);
      return next;
    }, { replace: true });
  };

  // Closing modal by removing receiptId query param using replace to keep history clean
  const handleCloseReceipt = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('receiptId');
      return next;
    }, { replace: true });
  };


  // ─────────────────────────────────────────────────────────────
  // CLIENT DETAIL VIEW — OR History table
  // ─────────────────────────────────────────────────────────────
  if (clientIdParam) {
    const rawClient = clients.find((c: Client) => 
      c.id === clientIdParam || 
      c.clientCode === clientIdParam ||
      (c.name && payments.some(p => p.clientId === clientIdParam && p.clientName && p.clientName.toLowerCase() === c.name.toLowerCase()))
    );

    const client: any = {
      id: clientIdParam,
      name: rawClient?.name || payments.find(p => p.clientId === clientIdParam)?.clientName || clientIdParam,
      clientCode: rawClient?.clientCode || clientIdParam,
      status: rawClient?.status || 'Active',
      address: rawClient?.address || 'Metro Manila, Philippines',
      region: (rawClient as any)?.region || 'NCR',
      billingSchedule: (rawClient as any)?.billingSchedule || 'Monthly',
      tin: rawClient?.tin || (rawClient as any)?.TIN || '000-123-456-000',
    };

    const explicitReceipts = receipts.filter((r: Receipt) => 
      r.clientId === clientIdParam || 
      (rawClient && (r.clientId === rawClient.id || r.clientId === rawClient.clientCode))
    );
    const clientPayments = payments.filter((p: Payment) => 
      (p.clientId === clientIdParam || (rawClient && (p.clientId === rawClient.id || p.clientId === rawClient.clientCode)) || (client.name && p.clientName && p.clientName.toLowerCase() === client.name.toLowerCase())) && 
      (p.status === 'Validated' || p.status === 'Approved' || (p.status as string) === 'Paid' || (p.status as string) === 'Settled' || (p.status as string) === 'Issued OR')
    );

    const paymentReceipts = clientPayments
      .filter(p => !explicitReceipts.some(r => r.paymentId === p.id || r.referenceNumber === p.referenceNumber))
      .map(p => {
        const inv = invoices.find(i => i.id === p.invoiceId || i.invoiceNumber === p.invoiceNumber);
        return {
          id: p.id,
          receiptNumber: p.orNumber || `OR-${p.referenceNumber || p.id.slice(0, 8).toUpperCase()}`,
          paymentId: p.id,
          clientId: clientIdParam,
          invoiceId: p.invoiceId,
          invoiceNumber: inv?.invoiceNumber ?? p.invoiceNumber ?? p.invoiceId ?? 'N/A',
          referenceNumber: p.referenceNumber ?? 'N/A',
          paymentMethod: p.paymentMethod ?? 'Bank Transfer',
          amount: Number(p.amount) || 0,
          issuedAt: (p as any).paymentDate || (p as any).dateRecorded || (p as any).submittedAt || new Date().toISOString(),
          status: 'Issued OR',
        } as Receipt;
      });

    const clientReceipts = [
      ...explicitReceipts.map((r: Receipt) => {
        const inv = invoices.find((i: Invoice) => i.id === r.invoiceId);
        const pmt = payments.find((p: Payment) => p.id === r.paymentId);
        return {
          ...r,
          invoiceNumber: inv?.invoiceNumber ?? r.invoiceId,
          paymentMethod: pmt?.paymentMethod ?? 'N/A',
          referenceNumber: pmt?.referenceNumber ?? 'N/A',
        };
      }),
      ...paymentReceipts,
    ];

    const filteredClientReceipts = !detailSearchQuery ? clientReceipts : clientReceipts.filter(r => {
      const q = detailSearchQuery.toLowerCase();
      return (
        (r.receiptNumber && r.receiptNumber.toLowerCase().includes(q)) ||
        (r.invoiceNumber && r.invoiceNumber.toLowerCase().includes(q)) ||
        (r.referenceNumber && r.referenceNumber.toLowerCase().includes(q))
      );
    });

    const columns = [
      { key: 'receiptNumber', label: 'OR NUMBER', sortable: true },
      { key: 'invoiceNumber', label: 'LINKED INVOICE' },
      { key: 'referenceNumber', label: 'PAYMENT REFERENCE' },
      { key: 'amount', label: 'AMOUNT', render: (row: any) => `₱${(Number(row.amount) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` },
      { key: 'issuedAt', label: 'DATE ISSUED', render: (row: any) => formatReceiptDate(row.issuedAt) },
    ];

    const actions = [
      { label: 'View Details', icon: 'ti-eye', onClick: (row: any) => handleOpenReceipt(row.id) },
    ];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

        <ClientInfoCard client={client} onBack={() => navigate('/receipts')} />

        <Card>
          <div style={{ padding: '24px' }}>
            {/* Header: Title and Cards vs Table Switcher */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem', color: '#0F172A', fontWeight: 800 }}>Official Receipt History</h3>
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748B' }}>Receipts and payment certificates issued to {client.name}</p>
              </div>

              {/* Cards vs Table View Switcher */}
              <div style={{ display: 'inline-flex', borderRadius: '8px', border: '1px solid #E2E8F0', overflow: 'hidden', background: '#F8FAFC' }}>
                <button
                  type="button"
                  onClick={() => setDetailViewMode('cards')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    background: detailViewMode === 'cards' ? '#0D9488' : 'transparent',
                    color: detailViewMode === 'cards' ? '#FFFFFF' : '#64748B',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <i className="ti ti-layout-grid" style={{ fontSize: '15px' }} />
                  Cards
                </button>
                <button
                  type="button"
                  onClick={() => setDetailViewMode('table')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    background: detailViewMode === 'table' ? '#0D9488' : 'transparent',
                    color: detailViewMode === 'table' ? '#FFFFFF' : '#64748B',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <i className="ti ti-table" style={{ fontSize: '15px' }} />
                  Table
                </button>
              </div>
            </div>

            {detailViewMode === 'cards' ? (
              <>
                {/* Search Bar for Cards */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
                  <div style={{ position: 'relative', width: '320px' }}>
                    <i className="ti ti-search" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#0D9488', fontSize: '16px' }} />
                    <input
                      type="text"
                      placeholder="Search receipts..."
                      value={detailSearchQuery}
                      onChange={(e) => setDetailSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '9px 16px 9px 40px',
                        borderRadius: '9999px',
                        border: '1.5px solid #0D9488',
                        background: '#FFFFFF',
                        fontSize: '0.85rem',
                        color: '#0F172A',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {detailSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setDetailSearchQuery('')}
                      style={{
                        padding: '8px 14px',
                        borderRadius: '8px',
                        border: '1px solid #FCA5A5',
                        background: '#FEF2F2',
                        color: '#DC2626',
                        fontWeight: 600,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <i className="ti ti-x" /> Clear Search
                    </button>
                  )}
                </div>

                {filteredClientReceipts.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '64px 20px', color: '#94A3B8' }}>
                    <i className="ti ti-receipt-off" style={{ fontSize: '42px', display: 'block', marginBottom: '12px', color: '#CBD5E1' }} />
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#334155' }}>No official receipts found</div>
                    <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>No receipts issued for this client match the search criteria.</p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
                    {filteredClientReceipts.map((row: any) => (
                      <div
                        key={row.id}
                        onClick={() => handleOpenReceipt(row.id)}
                        style={{
                          background: '#FFFFFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: '16px',
                          padding: '20px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '16px',
                          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.02)',
                          transition: 'all 0.2s ease',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.boxShadow = '0 12px 24px -6px rgba(0, 0, 0, 0.08), 0 4px 8px -4px rgba(0, 0, 0, 0.04)';
                          e.currentTarget.style.transform = 'translateY(-2px)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.02)';
                          e.currentTarget.style.transform = 'translateY(0)';
                        }}
                      >
                        {/* Top: OR Number & Status Badge */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <i className="ti ti-receipt" style={{ color: '#0D9488', fontSize: '18px' }} />
                            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0F172A', fontFamily: 'monospace' }}>
                              {row.receiptNumber}
                            </span>
                          </div>
                          <StatusBadge status="Issued OR" />
                        </div>

                        {/* Invoice & Payment Information */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                            <span style={{ color: '#64748B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <i className="ti ti-file-invoice" style={{ fontSize: '14px', color: '#64748B' }} />
                              Linked Invoice:
                            </span>
                            <span style={{ fontWeight: 700, color: '#1E293B' }}>{row.invoiceNumber}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                            <span style={{ color: '#64748B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <i className="ti ti-credit-card" style={{ fontSize: '14px', color: '#64748B' }} />
                              Payment Ref:
                            </span>
                            <span style={{ fontWeight: 600, color: '#334155' }}>{row.referenceNumber}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                            <span style={{ color: '#64748B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <i className="ti ti-calendar" style={{ fontSize: '14px', color: '#64748B' }} />
                              Date Issued:
                            </span>
                            <span style={{ fontWeight: 600, color: '#334155' }}>{formatReceiptDate(row.issuedAt)}</span>
                          </div>
                        </div>

                        {/* Amount Box */}
                        <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '12px 14px', border: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748B', letterSpacing: '0.04em' }}>TOTAL AMOUNT PAID</div>
                            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0D9488', marginTop: '2px' }}>
                              ₱{(Number(row.amount) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                            </div>
                          </div>
                          {row.paymentMethod && (
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748B' }}>METHOD</div>
                              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginTop: '2px' }}>
                                {row.paymentMethod}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Card Footer: View Details Action */}
                        <div style={{ paddingTop: '4px' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenReceipt(row.id)}
                            style={{
                              width: '100%',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px',
                              padding: '9px 16px',
                              borderRadius: '8px',
                              border: '1px solid #0D9488',
                              background: '#F0FDFA',
                              color: '#0D9488',
                              fontWeight: 700,
                              fontSize: '0.85rem',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#0D9488';
                              e.currentTarget.style.color = '#FFFFFF';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '#F0FDFA';
                              e.currentTarget.style.color = '#0D9488';
                            }}
                          >
                            <i className="ti ti-eye" />
                            View Details
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <DataTable
                data={clientReceipts}
                columns={columns}
                actions={actions}
                rowKey="id"
                searchPlaceholder="Search receipts..."
                searchFields={['receiptNumber', 'invoiceNumber', 'referenceNumber'] as any}
                emptyMessage="No official receipts issued for this client yet."
                columnToggle={true} densityToggle={true} exportable={false}
              />
            )}
          </div>
        </Card>
        <ReceiptModal
          isOpen={Boolean(receiptIdParam || selectedReceiptId)}
          receiptId={receiptIdParam || selectedReceiptId}
          onClose={handleCloseReceipt}
          clients={clients}
          invoices={invoices}
          payments={payments}
          receipts={[...receipts, ...clientReceipts]}
          isLoading={isLoadingReceipts || isLoadingPayments}
        />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // LIST VIEW — all clients
  // ─────────────────────────────────────────────────────────────
  const relevantClientIds = new Set<string>();
  receipts.forEach((r: Receipt) => relevantClientIds.add(r.clientId));
  payments
    .filter((p: Payment) => p.status === 'Validated' || p.status === 'Approved' || (p.status as string) === 'Paid' || (p.status as string) === 'Settled' || (p.status as string) === 'Issued OR')
    .forEach((p: Payment) => relevantClientIds.add(p.clientId));

  const listData = Array.from(relevantClientIds).map(clientId => {
    const client = clients.find((c: Client) => 
      c.id === clientId || 
      c.clientCode === clientId ||
      (c.name && payments.some(p => p.clientId === clientId && p.clientName && p.clientName.toLowerCase() === c.name.toLowerCase()))
    );
    const clientReceiptsList = receipts.filter((r: Receipt) => 
      r.clientId === clientId || (client && (r.clientId === client.id || r.clientId === client.clientCode))
    );
    const clientValidatedPayments = payments.filter((p: Payment) => 
      (p.clientId === clientId || (client && (p.clientId === client.id || p.clientId === client.clientCode)) || (client && p.clientName && p.clientName.toLowerCase() === client.name.toLowerCase())) && 
      (p.status === 'Validated' || p.status === 'Approved' || (p.status as string) === 'Paid' || (p.status as string) === 'Settled' || (p.status as string) === 'Issued OR')
    );

    const receiptTotal = clientReceiptsList.reduce((acc: number, r: Receipt) => acc + (Number(r.amount) || 0), 0);
    const paymentTotal = clientValidatedPayments.reduce((acc: number, p: Payment) => acc + (Number(p.amount) || 0), 0);
    const totalAmount = receiptTotal > 0 ? receiptTotal : paymentTotal;

    const receiptCount = clientReceiptsList.length > 0 ? clientReceiptsList.length : clientValidatedPayments.length;
    const clientName = client?.name ?? clientValidatedPayments[0]?.clientName ?? clientId;

    return {
      id: clientId,
      clientName,
      status: 'Issued OR',
      receiptCount,
      totalAmount,
    };
  });

  const filteredListData = !searchQuery ? listData : listData.filter(item => {
    const q = searchQuery.toLowerCase();
    return item.clientName.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Unified Main Container Card */}
      <div style={{ background: '#FFFFFF', borderRadius: '16px', border: '1px solid #E2E8F0', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        
        {/* Header Row: Title & View Mode Toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>

            <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748B' }}>Issued tax receipts, client records, and payment certificate history</p>
          </div>

          {/* Cards vs Table View Switcher */}
          <div style={{ display: 'inline-flex', borderRadius: '8px', border: '1px solid #E2E8F0', overflow: 'hidden', background: '#F8FAFC' }}>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                fontSize: '0.85rem',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'cards' ? '#0D9488' : 'transparent',
                color: viewMode === 'cards' ? '#FFFFFF' : '#64748B',
                transition: 'all 0.2s ease',
              }}
            >
              <i className="ti ti-layout-grid" style={{ fontSize: '15px' }} />
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                fontSize: '0.85rem',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'table' ? '#0D9488' : 'transparent',
                color: viewMode === 'table' ? '#FFFFFF' : '#64748B',
                transition: 'all 0.2s ease',
              }}
            >
              <i className="ti ti-table" style={{ fontSize: '15px' }} />
              Table
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: '320px' }}>
            <i className="ti ti-search" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#0D9488', fontSize: '16px' }} />
            <input
              type="text"
              placeholder="Search by client name or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 16px 9px 40px',
                borderRadius: '9999px',
                border: '1.5px solid #0D9488',
                background: '#FFFFFF',
                fontSize: '0.85rem',
                color: '#0F172A',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                border: '1px solid #FCA5A5',
                background: '#FEF2F2',
                color: '#DC2626',
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <i className="ti ti-x" style={{ marginRight: 4 }} />Clear Search
            </button>
          )}
        </div>

        {/* Content: Cards or Table */}
        {viewMode === 'cards' ? (
          filteredListData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '64px 20px', color: '#94A3B8' }}>
              <i className="ti ti-receipt-off" style={{ fontSize: '42px', display: 'block', marginBottom: '12px', color: '#CBD5E1' }} />
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#334155' }}>No official receipts found</div>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>No receipts issued match the search criteria.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
              {filteredListData.map((row: any) => (
                <div
                  key={row.id}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: '16px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '16px',
                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.02)',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = '0 12px 24px -6px rgba(0, 0, 0, 0.08), 0 4px 8px -4px rgba(0, 0, 0, 0.04)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.02)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  {/* Top: Status Badge & Client Code */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <StatusBadge status={row.status} />
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0D9488', background: '#F0FDFA', padding: '2px 8px', borderRadius: '6px' }}>
                      {row.id}
                    </span>
                  </div>

                  {/* Client Name */}
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.3 }}>
                      {row.clientName}
                    </h3>
                  </div>

                  {/* Details Block */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: '#F8FAFC', borderRadius: '12px', padding: '12px 14px', border: '1px solid #F1F5F9' }}>
                    <div>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748B', letterSpacing: '0.04em' }}>TOTAL OR AMOUNT</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#10B981', marginTop: '2px' }}>
                        ₱{row.totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748B', letterSpacing: '0.04em' }}>RECEIPTS ISSUED</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', marginTop: '2px' }}>
                        {row.receiptCount} {row.receiptCount === 1 ? 'Receipt' : 'Receipts'}
                      </div>
                    </div>
                  </div>

                  {/* Footer Action */}
                  <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => navigate(`/receipts/${row.id}`)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 16px',
                        background: '#0D9488',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                        width: '100%',
                        justifyContent: 'center',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#0F766E')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#0D9488')}
                    >
                      <i className="ti ti-receipt" />
                      View Official Receipts
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <TableContainer style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}>
            <DataTable
              data={filteredListData}
              columns={[
                { key: 'id', label: 'CLIENT ID', sortable: true },
                {
                  key: 'clientName', label: 'CLIENT NAME', sortable: true, render: (row: any) => (
                    <span style={{ color: '#0F172A', fontWeight: 600 }}>
                      {row.clientName}
                    </span>
                  )
                },
                {
                  key: 'receiptCount', label: 'RECEIPTS ISSUED', sortable: true, render: (row: any) => (
                    <span>{row.receiptCount} issued</span>
                  )
                },
                {
                  key: 'totalAmount', label: 'TOTAL OR AMOUNT', sortable: true, render: (row: any) => (
                    <span style={{ fontWeight: 700, color: '#10B981' }}>
                      ₱{row.totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                  )
                },
                { key: 'status', label: 'STATUS', render: (row: any) => <StatusBadge status={row.status} /> },
              ]}
              actions={[
                { label: 'View Details', icon: 'ti-eye', onClick: (row: any) => navigate(`/receipts/${row.id}`) }
              ]}
              rowKey="id"
              title=""
              hideSearch={true}
              emptyMessage="No official receipts issued yet."
              exportable={false}
              columnToggle={true}
              densityToggle={true}
            />
          </TableContainer>
        )}
      </div>
      <ReceiptModal
        isOpen={Boolean(receiptIdParam || selectedReceiptId)}
        receiptId={receiptIdParam || selectedReceiptId}
        onClose={handleCloseReceipt}
        clients={clients}
        invoices={invoices}
        payments={payments}
        receipts={receipts}
        isLoading={isLoadingReceipts || isLoadingPayments}
      />
    </div>
  );
};

export default Receipts;
