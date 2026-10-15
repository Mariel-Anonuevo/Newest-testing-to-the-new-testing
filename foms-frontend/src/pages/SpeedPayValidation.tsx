import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable } from '../components/DataTable';
import { CalendarPicker } from '../components/FormModals';
import { StatusBadge } from '../components/shared/StatusBadge';
import { useToast } from '../components/ToastContext';
import { useAuth } from '../context/AuthContext';
import { TableContainer } from '../components/TableContainer';
import { speedpayService } from '../services/speedpayService';
import { invoicesService } from '../services/invoicesService';
import { clientsService } from '../services/clientsService';
import { paymentsService } from '../services/paymentsService';
import { useQuery } from '../hooks/useQuery';
import { formatCurrency } from '../utils/format';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { useDuplicatePreCheck } from '../hooks/useDuplicatePreCheck';
import { DuplicatePreCheckModal } from '../components/ai/DuplicatePreCheckModal';
import { canCheckDuplicateInForm, canActOnRecord } from '../utils/roleAccess';
import { Role, type SpeedPaySubmission, type Invoice, type Client } from '../types/entities';

export const SpeedPayValidation: React.FC = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedSubmission, setSelectedSubmission] = useState<any | null>(null);

  const {
    data: initialData,
    isLoading: loading,
    error,
    refetch,
  } = useQuery(
    'speedpay:validation_list',
    async () => {
      const [spRes, invRes, cliRes] = await Promise.all([
        speedpayService.list({ pageSize: 100 }),
        invoicesService.list({ pageSize: 100 }),
        clientsService.list({ pageSize: 100 }),
      ]);
      return {
        speedPay: spRes.items || [],
        invoices: invRes.items || [],
        clients: cliRes.items || [],
      };
    }
  );

  const speedPay = initialData?.speedPay || [];
  const invoices = initialData?.invoices || [];
  const clients = initialData?.clients || [];

  const [validationStatus, setValidationStatus] = useState<'Approve' | 'Reject' | 'Endorse' | 'Return' | ''>('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const {
    modalState: dupModalState,
    runPreCheck,
    handleModalCancel,
    handleModalRetry,
    handleProceedWithRemarks,
    handleProceedWithManualReview,
  } = useDuplicatePreCheck();

  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // ─── Enrich SpeedPay submissions ─────────────────────────────────
  const allEnriched = useMemo(() => {
    return speedPay.map((sub: SpeedPaySubmission) => {
      const invoice = invoices.find((i: Invoice) => i.id === sub.invoiceId);
      const clientId = (sub as any).clientId || (invoice ? invoice.clientId : 'UNKNOWN');
      const client = clients.find((c: Client) => c.id === clientId);

      let submittedTimeStr = sub.submittedAt || new Date().toISOString();
      if (!submittedTimeStr.endsWith('Z') && !submittedTimeStr.includes('+')) {
        submittedTimeStr += 'Z';
      }

      return {
        ...sub,
        clientId,
        clientName: sub.clientName ?? client?.name ?? 'Unknown',
        invoiceNumber: sub.invoiceNumber ?? invoice?.invoiceNumber ?? sub.invoiceId,
        invoiceAmount: invoice?.totalAmount ?? sub.amountPaid ?? 0,
        submittedAt: submittedTimeStr
      };
    });
  }, [speedPay, invoices, clients]);

  // ─── Chart Data ───────────────────────────────────────────────────
  const pending = allEnriched.filter(s => s.status === 'Pending Validation').length;
  const validated = allEnriched.filter(s => s.status === 'Validated').length;
  const rejected = allEnriched.filter(s => s.status === 'Rejected').length;
  const todayStr = new Date().toLocaleDateString('en-PH');
  const validatedToday = allEnriched.filter(s => s.status === 'Validated' && new Date((s as any).validatedAt || '').toLocaleDateString('en-PH') === todayStr).length;

  const totalCollected = useMemo(() =>
    allEnriched.filter(s => s.status === 'Validated').reduce((sum, s) => sum + (s.amountPaid ?? 0), 0),
    [allEnriched]
  );

  const pendingAmount = useMemo(() =>
    allEnriched.filter(s => s.status === 'Pending Validation').reduce((sum, s) => sum + (s.amountPaid ?? 0), 0),
    [allEnriched]
  );

  // ─── Handle Validate/Reject ────────────────────
  const handleValidate = async (sub: any) => {
    if ((validationStatus === 'Reject' || validationStatus === 'Return') && !rejectionReason.trim()) {
      toast.error(`Please provide a ${validationStatus === 'Reject' ? 'rejection' : 'return'} reason.`, 'Required Field Missing');
      return;
    }

    // Separation of duties check: creator cannot approve own record
    if (sub.createdBy && (sub.createdBy === user?.id || sub.createdBy === user?.employeeId)) {
      toast.error('You cannot act on your own record.', 'Separation of Duties');
      return;
    }

    setIsSubmitting(true);
    try {
      if (validationStatus === 'Approve') {
        // Pre-save duplicate check on payment reference number
        if (sub.referenceNumber && canCheckDuplicateInForm(user?.role, 'speedpay')) {
          const check = await runPreCheck({
            entityType: 'speedpay',
            fieldName: 'referenceNumber',
            fieldValue: sub.referenceNumber,
            entityId: sub.id,
          });
          if (!check.canProceed) {
            setIsSubmitting(false);
            return;
          }
        }

        await speedpayService.validate(sub.id, { status: 'Validated', notes: 'Approved via SpeedPay Validation' });
        // Mark payment or invoice as paid
        if (sub.invoiceId) {
          await invoicesService.update(sub.invoiceId, { status: 'Paid' as any });
        }
        toast.success(`Payment from ${sub.clientName} approved. Invoice marked as Paid.`, 'Payment Validated');
      } else if (validationStatus === 'Reject') {
        await speedpayService.validate(sub.id, { status: 'Rejected', notes: rejectionReason });
        toast.error(`Payment from ${sub.clientName} has been Rejected.`, 'Payment Rejected');
      } else if (validationStatus === 'Endorse') {
        await speedpayService.update(sub.id, { status: 'Pending Finance Validation' as any, notes: 'Endorsed for final validation by Accountant' } as any);
        toast.success(`Payment from ${sub.clientName} endorsed to Finance Manager.`, 'Endorsed');
      } else if (validationStatus === 'Return') {
        await speedpayService.update(sub.id, { status: 'Returned / Needs Correction' as any, notes: rejectionReason } as any);
        toast.error(`Payment from ${sub.clientName} returned for correction.`, 'Payment Returned');
      }
      
      await refetch();
      setSelectedSubmission(null);
    } catch (err: any) {
      toast.error(err?.message ?? 'Action failed.', 'Validation Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const columns = [
    { key: 'id', label: 'TRANSACTION ID', render: (row: any) => <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748B' }}>{row.id.substring(0, 8)}...</span> },
    {
      key: 'clientName', label: 'CLIENT NAME', sortable: true,
      render: (row: any) => (
        <div>
          <div style={{ fontWeight: 700, color: '#0F172A' }}>{row.clientName}</div>
          {row.clientId && row.clientId !== 'UNKNOWN' && <div style={{ fontSize: 11, color: '#64748B' }}>{row.clientId}</div>}
        </div>
      )
    },
    { key: 'invoiceNumber', label: 'INVOICE NO.' },
    { key: 'paymentMethod', label: 'METHOD' },
    {
      key: 'amountPaid', label: 'AMOUNT', sortable: true,
      render: (row: any) => <span style={{ fontWeight: 700, color: '#0F172A' }}>{formatCurrency(Number(row.amountPaid))}</span>
    },
    {
      key: 'proofFileName', label: 'PROOF',
      render: (row: any) => row.proofFileName
        ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><i className="ti ti-photo" style={{ fontSize: 16, color: '#0EA5E9' }} /><span style={{ fontSize: 12, color: '#64748B' }}>{row.proofFileName}</span></span>
        : <span style={{ color: '#94A3B8' }}>None</span>
    },
    {
      key: 'submittedAt', label: 'SUBMITTED',
      render: (row: any) => new Date(row.submittedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    },
    { key: 'status', label: 'STATUS', render: (row: any) => <StatusBadge status={row.status} /> },
  ];

  const actions = [
    {
      label: 'View Details',
      icon: 'ti-eye',
      onClick: (row: any) => setSelectedSubmission(row),
    },
  ];

  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');

  const filteredData = useMemo(() => {
    let result = allEnriched;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r => 
        (r.clientName || '').toLowerCase().includes(q) ||
        (r.invoiceNumber || '').toLowerCase().includes(q) ||
        (r.referenceNumber || '').toLowerCase().includes(q)
      );
    }
    if (selectedMethod !== 'All') {
      result = result.filter(r => r.paymentMethod === selectedMethod);
    }
    if (selectedStatus !== 'All') {
      result = result.filter(r => r.status === selectedStatus);
    }
    if (dateFrom) {
      const fromD = new Date(dateFrom);
      result = result.filter(r => new Date(r.submittedAt) >= fromD);
    }
    if (dateTo) {
      const toD = new Date(dateTo);
      toD.setHours(23, 59, 59, 999);
      result = result.filter(r => new Date(r.submittedAt) <= toD);
    }
    return result;
  }, [allEnriched, searchQuery, selectedMethod, selectedStatus, dateFrom, dateTo]);

  const methodFilterOptions = [
    { label: 'GCash', value: 'GCash' },
    { label: 'Maya', value: 'Maya' },
  ];

  const statusFilterOptions = [
    { label: 'Pending Validation', value: 'Pending Validation' },
    { label: 'Validated', value: 'Validated' },
    { label: 'Rejected', value: 'Rejected' },
  ];

  const dtFilters = [
    {
      key: 'paymentMethod',
      label: 'Method',
      options: methodFilterOptions,
    },
    {
      key: 'status',
      label: 'Status',
      options: statusFilterOptions,
    }
  ];

  if (loading) {
    return <LoadingSpinner text="Loading SpeedPay validation queue..." />;
  }

  if (error) {
    return (
      <div style={{ padding: '64px 24px', textAlign: 'center', background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', margin: '20px 0' }}>
        <i className="ti ti-alert-triangle" style={{ fontSize: '3rem', color: '#EF4444', marginBottom: 12, display: 'block' }} />
        <h3 style={{ margin: '0 0 8px', fontSize: '1.25rem', fontWeight: 700, color: '#0F172A' }}>SpeedPay service unavailable</h3>
        <p style={{ margin: '0 0 20px', color: '#64748B', fontSize: '0.9rem' }}>
          Unable to connect to the SpeedPay API service. The rest of FOMS remains operational.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          style={{ background: '#0D9488', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
        {[
          { label: 'PENDING VALIDATION', value: pending, border: '#FDE68A', bg: '#fff', color: '#D97706', sub: `${formatCurrency(pendingAmount)} awaiting` },
          { label: 'VALIDATED', value: validated, border: '#BBF7D0', bg: '#fff', color: '#16A34A', sub: `Today: ${validatedToday}` },
          { label: 'REJECTED', value: rejected, border: '#FECACA', bg: '#fff', color: '#B91C1C', sub: `Total returned` },
          { label: 'TOTAL COLLECTED', value: formatCurrency(totalCollected), border: '#C7D2FE', bg: '#fff', color: '#4F46E5', sub: `From validated payments` },
        ].map((kpi: any, i) => (
          <div
            key={i}
            style={{
              background: kpi.bg, border: `1px solid ${kpi.border}`,
              borderTop: '4px solid transparent', borderRadius: 12,
              padding: '14px 20px', transition: 'all 0.3s ease', cursor: 'pointer'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-5px)';
              e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(0,0,0,0.1)';
              e.currentTarget.style.borderTop = `4px solid ${kpi.color}`;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
              e.currentTarget.style.borderTop = '4px solid transparent';
            }}
          >
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: kpi.color, letterSpacing: '0.06em' }}>{kpi.label}</p>
            <p style={{ margin: '0 0 4px', fontSize: 32, fontWeight: 800, color: '#111827', lineHeight: 1 }}>{kpi.value}</p>
            <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF' }}>{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Unified Main Container Card */}
      <div style={{ background: '#FFFFFF', borderRadius: '16px', border: '1px solid #E2E8F0', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        
        {/* Header Row: Title & View Mode Toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '0.82rem', color: '#92400E', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <i className="ti ti-info-circle" style={{ color: '#F59E0B', fontSize: 15 }} />
              <span><strong>Validation Policy:</strong> Confirm that the submitted amount matches invoice total before approving.</span>
            </div>
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
                placeholder="Search by client, invoice, or ref..."
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
              value={selectedMethod}
              onChange={(e) => setSelectedMethod(e.target.value)}
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
              <option value="All">All Methods</option>
              <option value="Maya">Maya</option>
              <option value="GCash">GCash</option>
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
              <option value="Pending Validation">Pending Validation</option>
              <option value="Validated">Validated</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>

          {/* Date Row Below Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <CalendarPicker
              label="From:"
              placeholder="Start date..."
              value={dateFrom}
              onChange={setDateFrom}
              variant="toolbar"
              disableFutureDates={true}
              maxDate={dateTo}
            />

            <CalendarPicker
              label="To:"
              placeholder="End date..."
              value={dateTo}
              onChange={setDateTo}
              variant="toolbar"
              disableFutureDates={true}
              minDate={dateFrom}
            />

            {(searchQuery || selectedMethod !== 'All' || selectedStatus !== 'All' || dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedMethod('All');
                  setSelectedStatus('All');
                  setDateFrom('');
                  setDateTo('');
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
          filteredData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '64px 20px', color: '#94A3B8' }}>
              <i className="ti ti-receipt-off" style={{ fontSize: '42px', display: 'block', marginBottom: '12px', color: '#CBD5E1' }} />
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#334155' }}>No SpeedPay records found</div>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>Try adjusting your search query or filter options.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: '20px' }}>
              {filteredData.map((row: any) => (
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
                  {/* Top: Method Tag & Status Badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 10px',
                      borderRadius: '8px',
                      background: '#F1F5F9',
                      color: '#334155',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                    }}>
                      <i className={row.paymentMethod === 'Maya' ? 'ti ti-brand-mastercard' : 'ti ti-device-mobile'} style={{ color: '#0D9488' }} />
                      {row.paymentMethod}
                    </div>
                    <StatusBadge status={row.status} />
                  </div>

                  {/* Client Info */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.3 }}>
                        {row.clientName || 'Unknown Client'}
                      </h3>
                      {row.clientId && (
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#0D9488', background: '#F0FDFA', padding: '2px 8px', borderRadius: '6px' }}>
                          {row.clientId}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <i className="ti ti-file-invoice" />
                      Invoice Ref: <strong style={{ color: '#0F172A' }}>{row.invoiceNumber}</strong>
                    </div>
                  </div>

                  {/* Amount Block */}
                  <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '12px 14px', border: '1px solid #F1F5F9' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748B', letterSpacing: '0.04em' }}>
                      SUBMITTED PAYMENT
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#10B981', marginTop: '2px' }}>
                      {formatCurrency(Number(row.amountPaid))}
                    </div>
                    {row.proofFileName && (
                      <div style={{ fontSize: '0.75rem', color: '#0284C7', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <i className="ti ti-photo" />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.proofFileName}</span>
                      </div>
                    )}
                  </div>

                  {/* Card Footer: Metadata & Validate Action */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #F1F5F9', paddingTop: '12px', fontSize: '0.75rem', color: '#94A3B8' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#475569' }}>
                        #{row.referenceNumber || row.id}
                      </span>
                      <span>{new Date(row.submittedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedSubmission(row)}
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
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <TableContainer style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}>
            <DataTable
              title=""
              data={filteredData}
              columns={columns}
              actions={actions}
              rowKey="id"
              hideSearch={true}
              columnToggle={true}
              densityToggle={true}
              exportable={false}
              emptyMessage="No SpeedPay records found."
            />
          </TableContainer>
        )}
      </div>

      {/* SpeedPay Details Modal */}
      {selectedSubmission && (
        <div 
          style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.4)', padding: 40 }}
          onClick={() => setSelectedSubmission(null)}
        >
          <div 
            style={{ width: '100%', maxWidth: 700, maxHeight: '90vh', background: '#fff', borderRadius: 16, display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ background: '#0F172A', padding: '20px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>SpeedPay Submission · {selectedSubmission.id}</div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#fff', fontWeight: 800 }}>Payment Information</h3>
              </div>
              <button 
                onClick={() => setSelectedSubmission(null)}
                style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <i className="ti ti-x" style={{ fontSize: 20 }} />
              </button>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28, paddingBottom: 28, borderBottom: '1px solid #E2E8F0' }}>
                <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>CLIENT & PAYMENT DETAILS</h4>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>Client Name</label>
                    <div style={{ fontSize: 16, color: '#0F172A', fontWeight: 700 }}>{selectedSubmission.clientName}</div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>Linked Invoice No.</label>
                    <div style={{ fontSize: 15, color: '#0F172A' }}>{selectedSubmission.invoiceNumber}</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>Payment Method</label>
                    <div style={{ fontSize: 15, color: '#0F172A' }}>{selectedSubmission.paymentMethod}</div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>Reference Number</label>
                    <div style={{ fontSize: 15, color: '#0F172A' }}>{selectedSubmission.referenceNumber}</div>
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: '#64748B', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>AMOUNT PAID</label>
                  <div style={{ padding: '16px 20px', background: '#F0FDF4', border: '1px solid #16A34A', borderLeft: '4px solid #16A34A', borderRadius: 8, fontSize: 24, color: '#15803D', fontWeight: 800 }}>
                    {formatCurrency(Number(selectedSubmission.amountPaid))}
                  </div>
                </div>
              </div>

              {/* BOTTOM — Proof */}
              <div style={{ paddingTop: 28 }}>
                <h4 style={{ margin: '0 0 20px 0', fontSize: '0.85rem', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>PROOF OF PAYMENT</h4>
                {selectedSubmission.proofFileUrl ? (
                  <div
                    onClick={() => setPreviewImage(selectedSubmission.proofFileUrl!)}
                    style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}
                  >
                    <div style={{ position: 'relative', width: '100%', height: 200, background: '#F1F5F9' }}>
                      <img src={selectedSubmission.proofFileUrl} alt="Proof" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 16px', fontWeight: 700, fontSize: 13, pointerEvents: 'none', borderRadius: 4 }}>
                          Click to view full size
                        </span>
                      </div>
                    </div>
                    <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FAFAFA', borderTop: '1px solid #F1F5F9' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#3B82F6' }}>Original Document</span>
                      <span style={{ fontSize: 12, color: '#64748B' }}>System Integration</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 14, color: '#94A3B8' }}>No proof uploaded</div>
                )}
              </div>
            </div>

            {/* Validation Decision (Bottom Fixed) */}
            <div style={{ background: '#F8FAFC', padding: '24px 32px', borderTop: '1px solid #E2E8F0', flexShrink: 0 }}>
              {(selectedSubmission.status !== 'Validated' && selectedSubmission.status !== 'Rejected') ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>Decision</label>
                    <select
                      value={validationStatus}
                      onChange={(e) => setValidationStatus(e.target.value as 'Approve' | 'Reject' | 'Endorse' | 'Return')}
                      style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 14, background: '#fff', color: '#0F172A', outline: 'none' }}
                    >
                      <option value="" disabled>Select Decision...</option>
                      {user?.role === Role.ACCOUNTANT ? (
                        <>
                          <option value="Endorse">Endorse for Validation</option>
                          <option value="Return">Return for Correction</option>
                        </>
                      ) : (
                        <>
                          <option value="Approve">Validate payment</option>
                          <option value="Reject">Reject payment</option>
                        </>
                      )}
                    </select>
                  </div>
                  {(validationStatus === 'Reject' || validationStatus === 'Return') && (
                    <textarea
                      value={rejectionReason}
                      onChange={e => setRejectionReason(e.target.value)}
                      placeholder={`Reason for ${validationStatus === 'Reject' ? 'rejection' : 'return'}...`}
                      rows={2}
                      style={{ width: '100%', padding: '10px 14px', border: '1px solid #FECACA', borderRadius: 6, fontSize: 14, outline: 'none', resize: 'none', boxSizing: 'border-box' }}
                    />
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
                    <button onClick={() => setSelectedSubmission(null)} style={{ background: 'transparent', color: '#64748B', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>Cancel</button>
                    <button
                      onClick={() => handleValidate(selectedSubmission)}
                      disabled={isSubmitting || validationStatus === '' || ((validationStatus === 'Reject' || validationStatus === 'Return') && !rejectionReason.trim())}
                      style={{ padding: '10px 24px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 14, cursor: (isSubmitting || validationStatus === '') ? 'not-allowed' : 'pointer', background: (isSubmitting || validationStatus === '') ? '#94A3B8' : '#0F172A', color: '#fff' }}
                    >
                      {isSubmitting ? 'Processing...' : 'Submit Validation'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ color: selectedSubmission.status === 'Validated' ? '#10B981' : '#EF4444', fontWeight: 700, fontSize: 15 }}>
                    This submission has been {selectedSubmission.status}.
                  </div>
                  <button onClick={() => setSelectedSubmission(null)} style={{ background: '#0F172A', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full Size Image Preview Modal */}
      {previewImage && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', padding: 40 }} onClick={() => setPreviewImage(null)}>
          <div style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%', display: 'flex', background: '#fff', padding: 8, borderRadius: 12 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setPreviewImage(null)} style={{ position: 'absolute', top: -16, right: -16, background: '#EF4444', border: 'none', color: '#fff', fontSize: 24, width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 6px rgba(0,0,0,0.2)' }}>&times;</button>
            <img src={previewImage} alt="Proof of Payment Preview" style={{ maxWidth: '100%', maxHeight: 'calc(90vh - 40px)', objectFit: 'contain', borderRadius: 8 }} />
          </div>
        </div>
      )}

      {/* Duplicate Pre-Check Modal */}
      <DuplicatePreCheckModal
        state={dupModalState}
        onCancel={handleModalCancel}
        onRetry={handleModalRetry}
        onProceedWithRemarks={handleProceedWithRemarks}
        onProceedWithManualReview={handleProceedWithManualReview}
      />

    </div>
  );
};

export default SpeedPayValidation;
