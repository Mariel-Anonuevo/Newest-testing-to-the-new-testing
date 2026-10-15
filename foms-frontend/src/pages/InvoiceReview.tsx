import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components/shared/StatusBadge';
import { Card } from '../components/Card';
import { KpiCard } from '../components/shared/KpiCard';
import { Button } from '../components/Buttons';
import { useToast } from '../components/ToastContext';
import { ClientInfoCard } from '../components/ClientInfoCard';
import { DataTable } from '../components/DataTable';
import { TableContainer } from '../components/TableContainer';
import { useQuery } from '../hooks/useQuery';
import { invoicesService } from '../services/invoicesService';
import { waybillsService } from '../services/waybillsService';
import { clientsService } from '../services/clientsService';
import { ratesService } from '../services/ratesService';
import { auditLogsService } from '../services/auditLogsService';
import type { Invoice, Waybill, Client, BillingRate } from '../types/entities';
import { computeFreightCost } from '../utils/billing';
import { formatCurrency, formatDate, formatBillingPeriod } from '../utils/format';
import '../components/FormModals.css';

export const InvoiceReview: React.FC = () => {
  const { toast } = useToast();
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const { data: invData, refetch: refetchInvoices } = useQuery('review:invoices', () => invoicesService.list({ pageSize: 100 }));
  const { data: wbData } = useQuery('review:waybills', () => waybillsService.list({ pageSize: 200 }));
  const { data: clientData } = useQuery('review:clients', () => clientsService.list({ pageSize: 100 }));
  const { data: rateData } = useQuery('review:rates', () => ratesService.list({ pageSize: 100 }));

  const invoices: Invoice[] = invData?.items || [];
  const waybills: Waybill[] = wbData?.items || [];
  const clients: Client[] = clientData?.items || [];
  const billingRates: BillingRate[] = rateData?.items || [];

  const [remarks, setRemarks] = useState('');
  const [reviewAction, setReviewAction] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [expandedWaybills, setExpandedWaybills] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (location.state?.clientId) {
      if (location.state?.invoiceId) {
        const inv = invoices.find(i => i.id === location.state.invoiceId);
        if (inv) setSelectedInvoice(inv);
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [location.state, navigate, invoices, location.pathname]);

  const viewClient = clients.find(c => c.id === id);
  const selectedClientId = viewClient ? viewClient.id : location.state?.clientId;

  useEffect(() => {
    if (id && !viewClient) {
      const inv = invoices.find(i => i.id === id);
      if (inv) {
        setSelectedInvoice(inv);
        navigate('/invoice-review', { replace: true });
      }
    }
  }, [id, invoices, navigate, viewClient]);

  const visibleInvoices = invoices.filter(i => i.status !== 'Draft');
  const filteredInvoices = selectedClientId ? visibleInvoices.filter(i => i.clientId === selectedClientId) : visibleInvoices;
  const sortedInvoices = [...filteredInvoices].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // ENRICH CLIENTS
  const enrichedClients = clients.map(client => {
    const clientInvoices = visibleInvoices.filter(i => i.clientId === client.id);
    const pendingCount = clientInvoices.filter(i => i.status === 'Pending Approval').length;
    const totalAmount = clientInvoices.reduce((sum, i) => sum + i.totalAmount, 0);
    return {
      id: client.id,
      clientName: client.name,
      pendingCount,
      totalAmount
    };
  }).filter(c => c.pendingCount > 0 || c.totalAmount > 0);

  // KPI Calculations
  const pendingCount = filteredInvoices.filter(i => i.status === 'Pending Approval').length;
  const approvedCount = filteredInvoices.filter(i => i.status === 'Approved').length;
  const totalAmount = filteredInvoices
    .filter(i => i.status === 'Pending Approval' || i.status === 'Approved')
    .reduce((sum, i) => sum + i.totalAmount, 0);

  // Status Handlers
  const handleApprove = async (viewInvoice: Invoice) => {
    try {
      await invoicesService.act(viewInvoice.id, 'approve');
      await auditLogsService.create({
        action: 'APPROVE_INVOICE',
        module: 'InvoiceReview',
        recordId: viewInvoice.id,
        recordType: 'Invoice',
        details: `Approved invoice ${viewInvoice.invoiceNumber}`,
        ipAddress: '127.0.0.1',
      });
      refetchInvoices();
      toast.success(`Invoice ${viewInvoice.invoiceNumber} has been approved.`, 'Success');
      setSelectedInvoice(null);
      setReviewAction('');
    } catch {
      toast.error('Failed to approve invoice.', 'Error');
    }
  };

  const handleReject = async (viewInvoice: Invoice) => {
    if (!remarks.trim()) {
      toast.error('Please provide remarks for the correction.', 'Error');
      return;
    }
    try {
      await invoicesService.act(viewInvoice.id, 'reject', { remarks });
      await auditLogsService.create({
        action: 'RETURN_INVOICE',
        module: 'InvoiceReview',
        recordId: viewInvoice.id,
        recordType: 'Invoice',
        details: `Returned invoice ${viewInvoice.invoiceNumber} with remarks: ${remarks}`,
        ipAddress: '127.0.0.1',
      });
      refetchInvoices();
      toast.error(`Invoice ${viewInvoice.invoiceNumber} returned for correction.`, 'Returned');
      setSelectedInvoice(null);
      setRemarks('');
      setReviewAction('');
      setExpandedWaybills({});
    } catch {
      toast.error('Failed to return invoice.', 'Error');
    }
  };

  const renderModal = () => {
    if (!selectedInvoice) return null;
    const client = clients.find(c => c.id === selectedInvoice.clientId);
    const invoiceWaybills = waybills.filter(w => selectedInvoice.waybillIds?.includes(w.id));

    return createPortal(
      <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
          <div style={{ padding: '24px 32px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'sticky', top: 0, background: '#fff', zIndex: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#047857', border: '1px solid #10B981', padding: '4px 8px', borderRadius: '999px' }}>
                  {selectedInvoice.invoiceNumber}
                </span>
                <span style={{ fontSize: '11px', color: '#94A3B8', borderBottom: '1px dashed #94A3B8' }}>{selectedInvoice.id}</span>
              </div>
              <h2 style={{ margin: '4px 0', fontSize: '1.25rem', color: '#0F172A', fontWeight: 800 }}>{client?.name || selectedInvoice.clientId}</h2>
              <div style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '999px', background: (selectedInvoice.status === 'Overdue' || selectedInvoice.status === 'Outstanding') ? '#FFFBEB' : '#F1F5F9', color: (selectedInvoice.status === 'Overdue' || selectedInvoice.status === 'Outstanding') ? '#D97706' : '#64748B', fontSize: '0.75rem', fontWeight: 700, width: 'fit-content' }}>
                {selectedInvoice.status}
              </div>
            </div>
            <button
              onClick={() => { setSelectedInvoice(null); setRemarks(''); setReviewAction(''); setExpandedWaybills({}); }}
              style={{ background: 'transparent', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px', fontSize: '1.2rem', cursor: 'pointer', color: '#94A3B8' }}
            >
              &times;
            </button>
          </div>

          <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div style={{ background: '#ECFDF5', border: '1px solid #10B981', borderRadius: '8px', padding: '12px 16px' }}>
                <div style={{ fontSize: '10px', color: '#64748B', marginBottom: '4px' }}>Total Amount</div>
                <div style={{ fontSize: '15px', color: '#047857', fontWeight: 800 }}>{formatCurrency(selectedInvoice.totalAmount)}</div>
              </div>
              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '12px 16px' }}>
                <div style={{ fontSize: '10px', color: '#64748B', marginBottom: '4px' }}>Due Date</div>
                <div style={{ fontSize: '13px', color: '#0F172A', fontWeight: 800 }}>{formatDate(selectedInvoice.dueDate)}</div>
              </div>
              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '12px 16px' }}>
                <div style={{ fontSize: '10px', color: '#64748B', marginBottom: '4px' }}>Prepared By</div>
                <div style={{ fontSize: '13px', color: '#0F172A', fontWeight: 500 }}>{selectedInvoice.createdBy}</div>
              </div>
            </div>

            <div style={{ fontSize: '11px', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '-4px 0 -12px' }}>
              WAYBILL LINES &bull; {invoiceWaybills.length}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {invoiceWaybills.map((wb) => {
                let fd;
                try {
                  const computed = computeFreightCost(wb, billingRates);
                  fd = {
                    area: computed.area,
                    chargeableWeight: computed.chargeableWeight,
                    weightBasis: computed.weightBasis,
                    freightCost: computed.freightCost,
                    valuation: computed.valuation || 0,
                    odaCharge: computed.odaCharge || 0,
                    grandTotal: computed.grandTotal,
                  };
                } catch {
                  fd = {
                    area: wb.destinationArea || 'NCR',
                    chargeableWeight: 1,
                    weightBasis: 'Weight',
                    freightCost: 0,
                    valuation: 0,
                    odaCharge: 0,
                    grandTotal: 0,
                  };
                }
                
                const isExpanded = expandedWaybills[wb.id];
                const toggleExpand = () => setExpandedWaybills(prev => ({ ...prev, [wb.id]: !prev[wb.id] }));

                return (
                  <div key={wb.id} style={{ background: '#fff', borderRadius: 8, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
                    <div 
                      onClick={toggleExpand}
                      style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: isExpanded ? '#F8FAFC' : '#fff', transition: 'background 0.2s' }}
                    >
                      <div style={{ fontSize: '12px', fontWeight: 800, color: '#0F172A' }}>
                        {wb.waybillNumber} <span style={{ color: '#94A3B8', fontWeight: 400 }}>— {fd.area}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: '13px', fontWeight: 800, color: '#0F172A' }}>
                          {formatCurrency(fd.grandTotal)}
                        </span>
                        <i className={`ti ti-chevron-${isExpanded ? 'up' : 'down'}`} style={{ color: '#64748B', fontSize: 16 }} />
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div style={{ padding: '16px', display: 'flex', gap: 24, background: '#F8FAFC', borderTop: '1px dashed #E2E8F0' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#94A3B8', marginBottom: 12, letterSpacing: '0.05em', textTransform: 'uppercase' }}>WAYBILL DETAILS</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: '11px', color: '#64748B' }}>
                            <span>Delivery Date</span><span style={{ textAlign: 'right', fontWeight: 500, color: '#0F172A' }}>{formatDate(wb.deliveryDate)}</span>
                            <span>Status</span><span style={{ textAlign: 'right', fontWeight: 500, color: '#0F172A' }}>{wb.status}</span>
                            <span>Original POD</span><span style={{ textAlign: 'right', fontWeight: 500, color: '#0F172A' }}>{wb.hasOriginalPOD ? 'Yes' : 'No'}</span>
                            <span>Approved CTC</span><span style={{ textAlign: 'right', fontWeight: 500, color: '#0F172A' }}>{wb.hasApprovedCTC ? 'Yes' : 'No'}</span>
                          </div>
                        </div>
                        <div style={{ width: '1px', background: '#E2E8F0' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: '#94A3B8', marginBottom: 12, letterSpacing: '0.05em', textTransform: 'uppercase' }}>COMPUTATION</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: '11px', color: '#64748B' }}>
                            <span>Chargeable wt.</span><span style={{ textAlign: 'right', fontWeight: 500, color: '#0F172A' }}>{fd.chargeableWeight.toFixed(2)} kg</span>
                            <span>Freight cost</span><span style={{ textAlign: 'right', fontWeight: 500, color: '#0F172A' }}>{formatCurrency(fd.freightCost)}</span>
                            <span>Valuation</span><span style={{ textAlign: 'right', fontWeight: 500, color: '#0F172A' }}>{formatCurrency(fd.valuation)}</span>
                            <span>ODA</span><span style={{ textAlign: 'right', fontWeight: 500, color: '#0F172A' }}>{formatCurrency(fd.odaCharge)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {invoiceWaybills.length === 0 && (
                <div style={{ padding: '16px', textAlign: 'center', color: '#94A3B8', fontSize: '13px' }}>
                  No linked waybill lines found.
                </div>
              )}
            </div>

            {selectedInvoice.status === 'Pending Approval' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid #E2E8F0', paddingTop: '24px' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <Button
                    title="Return for Revision"
                    variant={reviewAction === 'reject' ? 'primary' : 'secondary'}
                    icon="ti-arrow-back-up"
                    onClick={() => setReviewAction('reject')}
                  />
                  <Button
                    title="Approve Invoice"
                    variant="primary"
                    icon="ti-check"
                    onClick={() => handleApprove(selectedInvoice)}
                  />
                </div>

                {reviewAction === 'reject' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#0F172A' }}>Remarks for Revision <span style={{ color: 'red' }}>*</span></label>
                    <textarea
                      value={remarks}
                      onChange={e => setRemarks(e.target.value)}
                      placeholder="Specify what needs correction..."
                      style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid #CBD5E1', minHeight: 80 }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <Button title="Cancel" variant="secondary" onClick={() => { setReviewAction(''); setRemarks(''); }} />
                      <Button title="Confirm Return" variant="primary" onClick={() => handleReject(selectedInvoice)} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {selectedClientId && viewClient ? (
        <ClientInfoCard client={viewClient} onBack={() => navigate('/invoice-review')} />
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <KpiCard label="Pending Approval" value={pendingCount} icon="ti-clock" variant="warning" />
        <KpiCard label="Approved Invoices" value={approvedCount} icon="ti-check" variant="success" />
        <KpiCard label="Total Invoiced Value" value={formatCurrency(totalAmount)} icon="ti-receipt" variant="info" />
      </div>

      {selectedClientId ? (
        <TableContainer>
          <DataTable
            title="Invoices for Review"
            rowKey="id"
            data={sortedInvoices}
            columns={[
              { key: 'invoiceNumber', label: 'Invoice No.', sortable: true },
              {
                key: 'billingPeriod',
                label: 'Billing Period',
                render: (row: any) => (
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {formatBillingPeriod(row.billingPeriod)}
                  </span>
                )
              },
              { key: 'createdAt', label: 'Date', render: (row: any) => formatDate(row.createdAt) },
              { key: 'dueDate', label: 'Due Date', render: (row: any) => formatDate(row.dueDate) },
              { key: 'totalAmount', label: 'Amount', render: (row: any) => formatCurrency(row.totalAmount) },
              { key: 'status', label: 'Status', render: (row: any) => <StatusBadge status={row.status} /> }
            ]}
            actions={[
              {
                label: 'Review',
                icon: 'ti-file-search',
                onClick: (row: any) => setSelectedInvoice(row)
              }
            ]}
          />
        </TableContainer>
      ) : (
        <TableContainer>
          <DataTable
            title="Client Invoice Queue"
            rowKey="id"
            data={enrichedClients}
            searchPlaceholder="Search clients..."
            columns={[
              { 
                key: 'clientName', 
                label: 'Client',
                render: (row: any) => <span style={{ fontWeight: 'bold' }}>{row.clientName}</span>
              },
              {
                key: 'status', label: 'Status', render: (row: any) => (
                  <StatusBadge status={row.pendingCount > 0 ? 'Pending' : 'Approved'} />
                )
              },
              { key: 'totalAmount', label: 'Total Value', render: (row: any) => formatCurrency(row.totalAmount) }
            ]}
            actions={[
              {
                label: 'View Details',
                icon: 'ti-eye',
                onClick: (row: any) => navigate(`/invoice-review/${row.id}`)
              }
            ]}
          />
        </TableContainer>
      )}

      {renderModal()}
    </div>
  );
};

export default InvoiceReview;
