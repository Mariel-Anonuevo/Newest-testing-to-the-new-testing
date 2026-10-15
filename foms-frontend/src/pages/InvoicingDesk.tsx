import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/shared/StatusBadge';
import { Button } from '../components/Buttons';
import { Card } from '../components/Card';
import { InvoiceDocument } from '../components/InvoiceDocument';
import { InvoiceModal } from '../components/InvoiceModal';
import { useQuery } from '../hooks/useQuery';
import { invoicesService } from '../services/invoicesService';
import { clientsService } from '../services/clientsService';
import { paymentsService } from '../services/paymentsService';
import { waybillsService } from '../services/waybillsService';
import { auditLogsService } from '../services/auditLogsService';
import type { Invoice, Client, Payment, Waybill } from '../types/entities';
import { useAuth } from '../context/AuthContext';
import { TableContainer } from '../components/TableContainer';
import { useToast } from '../components/ToastContext';
import { ClientInfoCard } from '../components/ClientInfoCard';
import { CalendarPicker } from '../components/FormModals';
import { formatCurrency, formatDate, formatBillingPeriod } from '../utils/format';

/** Derive payment status from invoice */
function derivePaymentStatus(inv: Invoice): 'Unpaid' | 'Due Soon' | 'Overdue' | 'Paid' {
  if (inv.status === 'Paid') return 'Paid';
  const now = Date.now();
  const due = new Date(inv.dueDate).getTime();
  const daysUntilDue = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
  if (daysUntilDue < 0) return 'Overdue';
  if (daysUntilDue <= 7) return 'Due Soon';
  return 'Unpaid';
}

/** Single status-to-actions map defining allowed actions per invoice status */
const STATUS_ACTIONS_MAP: Record<string, string[]> = {
  'Draft': ['View', 'Edit Draft', 'Submit for Approval'],
  'Pending Approval': ['View'],
  'Needs Revision': ['View', 'Edit', 'Resubmit'],
  'Approved': ['View', 'Print'],
};

export const InvoicingDesk: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  const { toast } = useToast();
  const { user } = useAuth();

  const { data: invData, refetch: refetchInvoices } = useQuery('desk:invoices', () => invoicesService.list({ pageSize: 100 }));
  const { data: clientData } = useQuery('desk:clients', () => clientsService.list({ pageSize: 100 }));
  const { data: payData } = useQuery('desk:payments', () => paymentsService.list({ pageSize: 100 }));
  const { data: waybillData } = useQuery('desk:waybills', () => waybillsService.list({ pageSize: 100 }));

  const invoices: Invoice[] = invData?.items || [];
  const clients: Client[] = clientData?.items || [];
  const payments: Payment[] = payData?.items || [];
  const allWaybills: Waybill[] = waybillData?.items || [];

  // Modal state for viewing invoice without navigating away
  const [modalInvoiceId, setModalInvoiceId] = useState<string | null>(null);
  const [modalInvoice, setModalInvoice] = useState<Invoice | null>(null);
  const [isAutoPrint, setIsAutoPrint] = useState<boolean>(false);

  // Preserve legacy direct URL route /invoicing-desk/:id if navigated to directly
  let viewInvoice: Invoice | undefined = undefined;
  let viewClient: Client | undefined = undefined;

  if (id) {
    viewInvoice = invoices.find(i => i.id === id);
    if (!viewInvoice) {
      viewClient = clients.find(c => c.id === id);
    }
  }

  const selectedClientId = viewClient ? viewClient.id : null;

  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [selectedClientName, setSelectedClientName] = useState('All');

  // Enrich invoices with client names, proper waybill counts, and derived status
  const enrichedInvoices = useMemo(() => {
    const base = selectedClientId
      ? invoices.filter(i => i.clientId === selectedClientId)
      : invoices;

    const activeInvoices = base.filter((inv: Invoice) => {
      if (!['Draft', 'Needs Revision', 'Pending Approval', 'Approved'].includes(inv.status)) return false;
      if (filterDateFrom || filterDateTo) {
        const itemDate = new Date(inv.createdAt);
        itemDate.setHours(0, 0, 0, 0);
        if (filterDateFrom) {
          const fromDate = new Date(filterDateFrom);
          fromDate.setHours(0, 0, 0, 0);
          if (itemDate < fromDate) return false;
        }
        if (filterDateTo) {
          const toDate = new Date(filterDateTo);
          toDate.setHours(23, 59, 59, 999);
          if (itemDate > toDate) return false;
        }
      }
      return true;
    });

    const enriched = activeInvoices.map((inv: Invoice) => {
      const client = clients.find(c => c.id === inv.clientId);
      const ps = derivePaymentStatus(inv);

      // Match linked waybills by waybillIds or by matching invoiceId
      const linked = allWaybills.filter(w =>
        (inv.waybillIds && (inv.waybillIds.includes(String(w.id)) || inv.waybillIds.includes(w.waybillNumber))) ||
        (w.invoiceId && (String(w.invoiceId) === String(inv.id) || w.invoiceId === inv.invoiceNumber))
      );
      const calculatedCount = inv.waybillIds && inv.waybillIds.length > 0 ? inv.waybillIds.length : linked.length;

      return {
        ...inv,
        clientName: client?.name ?? inv.clientId,
        waybillCount: calculatedCount,
        paymentStatus: ps,
      };
    });

    return enriched.filter(inv => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!inv.invoiceNumber.toLowerCase().includes(q) && !inv.clientName.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (selectedStatus !== 'All' && inv.status !== selectedStatus) {
        return false;
      }
      if (selectedClientName !== 'All' && inv.clientName !== selectedClientName) {
        return false;
      }
      return true;
    });
  }, [selectedClientId, invoices, filterDateFrom, filterDateTo, clients, allWaybills, searchQuery, selectedStatus, selectedClientName]);

  const allClients: string[] = useMemo(() => {
    return Array.from(new Set(invoices.map((inv: Invoice) => {
      const client = clients.find(c => c.id === inv.clientId);
      return client?.name ?? inv.clientId;
    }))).filter(Boolean);
  }, [invoices, clients]);

  const handleTransition = async (invId: string, newStatus: Invoice['status'], successMsg: string, updates?: Partial<Invoice>) => {
    const inv = invoices.find(i => i.id === invId);
    if (!inv) return;

    try {
      await invoicesService.update(invId, { status: newStatus, ...updates });
      await auditLogsService.create({
        action: 'INVOICE_STATUS_CHANGE',
        module: 'InvoicingDesk',
        recordId: invId,
        recordType: 'Invoice',
        details: `Changed status to ${newStatus}`,
        ipAddress: '127.0.0.1',
      });
      refetchInvoices();
      toast.success(successMsg, 'Success');
    } catch {
      toast.error('Failed to update invoice status.', 'Error');
    }
  };

  const tableColumns = [
    { key: 'invoiceNumber', label: 'Invoice No.', sortable: true },
    { key: 'clientName', label: 'Client', sortable: true },
    {
      key: 'billingPeriod',
      label: 'Billing Period',
      render: (row: any) => (
        <span style={{ whiteSpace: 'nowrap' }}>
          {formatBillingPeriod(row.billingPeriod)}
        </span>
      ),
    },
    {
      key: 'waybillCount',
      label: 'Waybills',
      render: (row: any) => `${row.waybillCount} waybills`,
    },
    { key: 'createdAt', label: 'Date', render: (row: any) => formatDate(row.createdAt) },
    { key: 'totalAmount', label: 'Total Amount', render: (row: any) => formatCurrency(row.totalAmount) },
    { key: 'status', label: 'Invoice Status', render: (row: any) => <StatusBadge status={row.status} /> },
  ];

  // Single status-to-actions map defining allowed actions per invoice status
  const STATUS_ACTIONS_MAP: Record<string, string[]> = {
    'Draft': ['View', 'Edit Draft', 'Submit for Approval'],
    'Pending Approval': ['View'],
    'Returned for revision': ['View', 'Edit', 'Resubmit'],
    'Needs Revision': ['View', 'Edit', 'Resubmit'],
    'Approved': ['View', 'Print'],
  };

  // Action configurations mapping action names to handlers and icons
  const ACTION_CONFIGS: Record<string, { label: string; icon: string; onClick: (row: any) => void }> = {
    'View': {
      label: 'View',
      icon: 'ti-eye',
      onClick: (row: any) => {
        setModalInvoice(row);
        setModalInvoiceId(row.id);
        setIsAutoPrint(false);
      },
    },
    'Edit Draft': {
      label: 'Edit Draft',
      icon: 'ti-pencil',
      onClick: (row: any) => navigate(`/invoice-create?edit=${row.id}`),
    },
    'Edit': {
      label: 'Edit',
      icon: 'ti-pencil',
      onClick: (row: any) => navigate(`/invoice-create?edit=${row.id}`),
    },
    'Submit for Approval': {
      label: 'Submit for Approval',
      icon: 'ti-send',
      onClick: (row: any) => handleTransition(row.id, 'Pending Approval', `Invoice ${row.invoiceNumber} submitted for approval`),
    },
    'Resubmit': {
      label: 'Resubmit',
      icon: 'ti-send',
      onClick: (row: any) => handleTransition(row.id, 'Pending Approval', `Invoice ${row.invoiceNumber} resubmitted for approval`),
    },
    'Print': {
      label: 'Print',
      icon: 'ti-printer',
      onClick: (row: any) => {
        setModalInvoice(row);
        setModalInvoiceId(row.id);
        setIsAutoPrint(true);
      },
    },
  };

  const actions = Object.entries(ACTION_CONFIGS).map(([key, item]) => ({
    label: item.label,
    icon: item.icon,
    onClick: item.onClick,
    hidden: (row: any) => !(STATUS_ACTIONS_MAP[row.status] || ['View']).includes(key),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {selectedClientId && viewClient ? (
        <ClientInfoCard client={viewClient} onBack={() => navigate('/invoicing-desk')} />
      ) : null}

      {viewInvoice ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button title="Back to Invoices" variant="secondary" icon="ti-arrow-left" onClick={() => navigate('/invoicing-desk')} />
            <div style={{ display: 'flex', gap: 8 }}>
              {(viewInvoice.status === 'Draft' || viewInvoice.status === 'Needs Revision') && (
                <Button title="Edit Invoice" variant="secondary" icon="ti-pencil" onClick={() => navigate(`/invoice-create?edit=${viewInvoice?.id}`)} />
              )}
              {viewInvoice.status === 'Approved' && (
                <Button title="Mark as Sent" variant="primary" icon="ti-send" onClick={() => handleTransition(viewInvoice!.id, 'Sent', 'Invoice marked as sent')} />
              )}
            </div>
          </div>
          <Card>
            <InvoiceDocument invoice={viewInvoice} />
          </Card>
        </div>
      ) : (
        <div style={{ background: '#FFFFFF', borderRadius: '16px', border: '1px solid #E2E8F0', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        
        {/* Header Row: Title & View Mode Toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748B' }}>Client sales invoices, status tracking, and dispatch records</p>
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

        {/* Filters Row */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: '300px' }}>
              <i className="ti ti-search" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#0D9488', fontSize: '16px' }} />
              <input
                type="text"
                placeholder="Search by invoice number or client..."
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

            <select
              value={selectedClientName}
              onChange={(e) => setSelectedClientName(e.target.value)}
              style={{
                padding: '9px 14px',
                borderRadius: '8px',
                border: '1px solid #E2E8F0',
                background: '#FFFFFF',
                fontSize: '0.85rem',
                color: '#334155',
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="All">All Clients</option>
              {allClients.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              style={{
                padding: '9px 14px',
                borderRadius: '8px',
                border: '1px solid #E2E8F0',
                background: '#FFFFFF',
                fontSize: '0.85rem',
                color: '#334155',
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="All">All Statuses</option>
              <option value="Draft">Draft</option>
              <option value="Pending Approval">Pending Approval</option>
              <option value="Approved">Approved</option>
              <option value="Needs Revision">Needs Revision</option>
            </select>
          </div>

          {/* Date Row Below Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <CalendarPicker
              label="From:"
              placeholder="Start date..."
              value={filterDateFrom}
              onChange={date => {
                if (filterDateTo && date > filterDateTo) {
                  toast.error('Start date cannot be later than end date.');
                  return;
                }
                setFilterDateFrom(date);
              }}
              maxDate={filterDateTo}
              variant="toolbar"
            />

            <CalendarPicker
              label="To:"
              placeholder="End date..."
              value={filterDateTo}
              onChange={date => {
                if (filterDateFrom && date < filterDateFrom) {
                  toast.error('End date cannot be earlier than start date.');
                  return;
                }
                setFilterDateTo(date);
              }}
              minDate={filterDateFrom}
              variant="toolbar"
            />

            {(searchQuery || selectedClientName !== 'All' || selectedStatus !== 'All' || filterDateFrom || filterDateTo) && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedClientName('All');
                  setSelectedStatus('All');
                  setFilterDateFrom('');
                  setFilterDateTo('');
                }}
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
                <i className="ti ti-x" style={{ marginRight: 4 }} />Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* View Mode: Cards or Table */}
        {viewMode === 'cards' ? (
          enrichedInvoices.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '64px 20px', color: '#94A3B8' }}>
              <i className="ti ti-file-invoice" style={{ fontSize: '42px', display: 'block', marginBottom: '12px', color: '#CBD5E1' }} />
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#334155' }}>No invoices found</div>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>Try adjusting your search query or filter options.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: '20px' }}>
              {enrichedInvoices.map((inv: any) => (
                <div
                  key={inv.id}
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
                  {/* Top: Invoice No & Status Badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#0F172A', fontSize: '0.9rem' }}>
                      {inv.invoiceNumber}
                    </span>
                    <StatusBadge status={inv.status} />
                  </div>

                  {/* Client Info */}
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.3 }}>
                      {inv.clientName}
                    </h3>
                    <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '0.75rem', color: '#64748B' }}>
                      <span><i className="ti ti-calendar" style={{ marginRight: 4 }} />Due: <strong>{formatDate(inv.dueDate)}</strong></span>
                      <span><i className="ti ti-truck-delivery" style={{ marginRight: 4 }} /><strong>{inv.waybillCount}</strong> Waybills</span>
                    </div>
                  </div>

                  {/* Total Amount Block */}
                  <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '12px 14px', border: '1px solid #F1F5F9' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', letterSpacing: '0.04em' }}>TOTAL INVOICE AMOUNT</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0F172A', marginTop: '2px' }}>
                      ₱{Number(inv.totalAmount || inv.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setModalInvoice(inv);
                        setModalInvoiceId(inv.id);
                        setIsAutoPrint(false);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 14px',
                        background: '#0D9488',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#0F766E')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#0D9488')}
                    >
                      <i className="ti ti-eye" />
                      View Invoice
                    </button>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      {(inv.status === 'Draft' || inv.status === 'Needs Revision') && (
                        <button
                          type="button"
                          onClick={() => navigate(`/invoice-create?edit=${inv.id}`)}
                          style={{
                            padding: '8px 10px',
                            background: '#F1F5F9',
                            color: '#334155',
                            border: '1px solid #E2E8F0',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                          title="Edit Invoice"
                        >
                          <i className="ti ti-pencil" />
                        </button>
                      )}
                      {inv.status === 'Approved' && (
                        <button
                          type="button"
                          onClick={() => {
                            setModalInvoice(inv);
                            setModalInvoiceId(inv.id);
                            setIsAutoPrint(true);
                          }}
                          style={{
                            padding: '8px 10px',
                            background: '#F0FDFA',
                            color: '#0D9488',
                            border: '1px solid #99F6E4',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                          title="Print Invoice"
                        >
                          <i className="ti ti-printer" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <TableContainer style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}>
            <DataTable
              data={enrichedInvoices}
              columns={tableColumns}
              actions={actions}
              rowKey="id"
              hideSearch={true}
              columnToggle={true}
              densityToggle={true}
              exportable={false}
              emptyMessage="No invoices found."
            />
          </TableContainer>
        )}
      </div>
      )}

      {/* Modal on top of list without route change */}
      <InvoiceModal
        isOpen={!!modalInvoiceId}
        invoiceId={modalInvoiceId}
        initialInvoice={modalInvoice}
        autoPrint={isAutoPrint}
        onClose={() => {
          setModalInvoiceId(null);
          setModalInvoice(null);
          setIsAutoPrint(false);
        }}
      />
    </div>
  );
};

export default InvoicingDesk;
