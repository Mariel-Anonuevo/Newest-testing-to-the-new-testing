import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/Card';
import { Button } from '../components/Buttons';
import { KpiCard } from '../components/shared/KpiCard';
import Dropdown from '../components/Dropdown';
import { useToast } from '../components/ToastContext';
import { CalendarPicker } from '../components/FormModals';
import RecordSettlementModal from '../components/RecordSettlementModal';
import { createPortal } from 'react-dom';
import { settlementsService } from '../services/settlementsService';
import { cashFlowService } from '../services/cashFlowService';
import { useQuery } from '../hooks/useQuery';
import { Settlement } from '../types/entities';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { formatCurrency } from '../utils/format';

const Settlements: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const isManagerOrHead = ['HEAD_ACCOUNTANT', 'FINANCIAL_MANAGER', 'ADMIN', 'Head Accountant', 'Financial Manager'].includes(user?.role || '');

  const {
    data: fetchedSettlements,
    isLoading: loading,
    refetch,
  } = useQuery('settlements:all', async () => {
    const res = await settlementsService.list({ pageSize: 100 });
    return res.items || [];
  });

  const [localSettlements, setLocalSettlements] = useState<Settlement[] | null>(null);
  const settlements = localSettlements ?? fetchedSettlements ?? [];

  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [filterTab, setFilterTab] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showRecent, setShowRecent] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  useEffect(() => {
    const saved = localStorage.getItem('settlements_recentSearches');
    if (saved) {
      try { setRecentSearches(JSON.parse(saved)); } catch (e) {}
    }
  }, []);

  const saveRecentSearch = (term: string) => {
    if (!term.trim()) return;
    setRecentSearches(prev => {
      const updated = [term.trim(), ...prev.filter(t => t.toLowerCase() !== term.trim().toLowerCase())].slice(0, 5);
      localStorage.setItem('settlements_recentSearches', JSON.stringify(updated));
      return updated;
    });
  };

  const handleSearchBlur = () => {
    setTimeout(() => setShowRecent(false), 200);
    saveRecentSearch(searchQuery);
  };

  const [selectedRecord, setSelectedRecord] = useState<Settlement | null>(null);
  const [decision, setDecision] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [remarks, setRemarks] = useState('');

  // Stats
  const pendingCount = settlements.filter((s: Settlement) => s.status === 'For validation').length;
  const validatedCount = settlements.filter((s: Settlement) => s.status === 'Validated').length;
  const rejectedCount = settlements.filter((s: Settlement) => s.status === 'Rejected').length;

  const pendingLeftoverAmount = settlements.filter((s: Settlement) => s.status === 'For validation' && s.type === 'Leftover return').reduce((sum: number, s: Settlement) => sum + s.amount, 0);
  const leftoverEnvelopesCount = settlements.filter((s: Settlement) => s.status === 'For validation' && s.type === 'Leftover return').length;
  
  const pendingReimbAmount = settlements.filter((s: Settlement) => s.status === 'For validation' && s.type === 'Reimbursement').reduce((sum: number, s: Settlement) => sum + s.amount, 0);
  const reimbRequestsCount = settlements.filter((s: Settlement) => s.status === 'For validation' && s.type === 'Reimbursement').length;

  // Filter Data
  const filteredData = useMemo(() => {
    return settlements.filter((s: Settlement) => {
      // Tab filter
      if (filterTab === 'Pending' && s.status !== 'For validation') return false;
      if (filterTab === 'Validated' && s.status !== 'Validated') return false;
      if (filterTab === 'Rejected' && s.status !== 'Rejected') return false;
      
      // Type filter
      if (typeFilter && s.type !== typeFilter) return false;

      // Search query
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesSearch = 
          s.id.toLowerCase().includes(q) ||
          s.courierName.toLowerCase().includes(q) ||
          s.tripRef.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }

      // Date filtering
      const submitDate = new Date(s.submittedAt);
      submitDate.setHours(0, 0, 0, 0); // Normalize to start of day

      if (dateFrom) {
        const fromD = new Date(dateFrom);
        fromD.setHours(0, 0, 0, 0);
        if (submitDate < fromD) return false;
      }
      
      if (dateTo) {
        const toD = new Date(dateTo);
        toD.setHours(23, 59, 59, 999);
        if (submitDate > toD) return false;
      }

      return true;
    });
  }, [settlements, filterTab, searchQuery, typeFilter, dateFrom, dateTo]);

  const handleReviewClick = (row: Settlement) => {
    setSelectedRecord(row);
    setDecision('');
    setRejectionReason('');
    setRemarks('');
  };

  const handleConfirmDecision = async () => {
    if (!decision || !selectedRecord) {
      toast.error('Please select a decision first.');
      return;
    }
    
    try {
      const newStatus = decision === 'approve' ? 'Validated' : 'Rejected';
      await settlementsService.update(selectedRecord.id, { status: newStatus as any });
      
      // Add to cash flow if validated
      if (decision === 'approve') {
        const isLeftover = selectedRecord.type === 'Leftover return';
        await cashFlowService.create({
          type: isLeftover ? 'Inflow' : 'Outflow',
          amount: selectedRecord.amount,
          sourceReference: selectedRecord.id,
          date: new Date().toISOString(),
          recordedBy: user?.fullName || 'System',
        });
      }

      setLocalSettlements(settlements.map((s: Settlement) => s.id === selectedRecord.id ? { ...s, status: newStatus as any } : s));
      toast.success(`Settlement ${selectedRecord.id} has been ${newStatus.toLowerCase()}.`);
      setSelectedRecord(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update settlement');
    }
  };

  if (loading) {
    return <LoadingSpinner text="Loading settlements..." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
        <KpiCard 
          label="Pending Validation" 
          value={pendingCount} 
          icon="ti-clock-hour-4" 
          variant="warning" 
          periodText="waiting for validation" 
        />
        <KpiCard 
          label="Leftover Cash" 
          value={formatCurrency(pendingLeftoverAmount)} 
          icon="ti-cash" 
          variant="success" 
          periodText={`${leftoverEnvelopesCount} envelopes recorded`} 
        />
        <KpiCard 
          label="Reimbursements" 
          value={formatCurrency(pendingReimbAmount)} 
          icon="ti-receipt-refund" 
          variant="info" 
          periodText={`${reimbRequestsCount} requests`} 
        />
      </div>

      {/* Settlements Content Section */}
      <Card style={{ padding: '24px' }}>
        {/* Header with Title, Switcher and Record Settlement Button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
          <div>

            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748B' }}>
              {isManagerOrHead 
                ? 'Review and validate leftover cash returns and reimbursement requests submitted by couriers.' 
                : 'Track leftover cash returns, liquidation submissions, and courier trip settlements.'}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
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

            {/* Record Settlement Button */}
            <button
              type="button"
              onClick={() => setIsRecordModalOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '9px 18px',
                borderRadius: '8px',
                border: 'none',
                background: '#0D9488',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#0F766E'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = '#0D9488'}
            >
              <i className="ti ti-plus" style={{ fontSize: '15px' }} />
              Record Settlement
            </button>
          </div>
        </div>
        
        {/* Filters */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: '280px' }}>
            <i className="ti ti-search" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#64748B', fontSize: '16px' }} />
            <input 
              type="text" 
              placeholder="Search by ID, courier, or trip ref.." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={(e) => {
                setShowRecent(true);
                e.currentTarget.style.background = '#ffffff';
                e.currentTarget.style.border = '1px solid #0D9488';
              }}
              onBlur={(e) => {
                handleSearchBlur();
                e.currentTarget.style.background = '#F1F5F9';
                e.currentTarget.style.border = '1px solid transparent';
              }}
              style={{ padding: '8px 16px 8px 40px', borderRadius: '28px', border: '1px solid transparent', fontSize: '13px', width: '100%', outline: 'none', background: '#F1F5F9', color: '#1E293B', transition: 'all 0.2s', boxSizing: 'border-box' }}
            />
            {showRecent && recentSearches.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 8, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)', zIndex: 100, paddingBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', padding: '12px 16px 8px' }}>RECENT</div>
                {recentSearches.map((term, i) => (
                  <div key={i} onMouseDown={(e) => { e.preventDefault(); setSearchQuery(term); setShowRecent(false); }} style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', cursor: 'pointer', transition: 'background 0.15s' }} onMouseEnter={e => e.currentTarget.style.background = '#F7F9FF'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12, fontSize: 16, background: '#F1F5F9', color: '#64748B' }}>
                      <i className="ti ti-history" />
                    </div>
                    <span style={{ fontSize: 13, color: '#1E293B', fontWeight: 500, flex: 1 }}>{term}</span>
                    <span style={{ fontSize: 12, color: '#94A3B8', marginLeft: 12 }}>Search</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <select 
            value={filterTab} 
            onChange={(e) => setFilterTab(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '13px', outline: 'none', background: '#F8FAFC', cursor: 'pointer', transition: 'border-color 0.2s, background-color 0.2s' }}
            onFocus={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#3B82F6'; }}
            onBlur={(e) => { e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.borderColor = '#E2E8F0'; }}
          >
            <option value="">Status</option>
            <option value="Pending">Pending ({pendingCount})</option>
            <option value="Validated">Validated ({validatedCount})</option>
            <option value="Rejected">Rejected ({rejectedCount})</option>
          </select>
          <select 
            value={typeFilter} 
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '13px', outline: 'none', background: '#F8FAFC', cursor: 'pointer', transition: 'border-color 0.2s, background-color 0.2s' }}
            onFocus={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#3B82F6'; }}
            onBlur={(e) => { e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.borderColor = '#E2E8F0'; }}
          >
            <option value="">Filter by Type</option>
            <option value="Leftover return">Leftover return</option>
            <option value="Expense liquidation">Expense liquidation</option>
            <option value="Reimbursement">Reimbursement</option>
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#64748B' }}>From:</span>
              <div style={{ width: 140 }}>
                <CalendarPicker
                  label=""
                  value={dateFrom}
                  onChange={setDateFrom}
                  placeholder="Start date..."
                  variant="filter"
                  maxDate="2026-12-31"
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#64748B' }}>To:</span>
              <div style={{ width: 140 }}>
                <CalendarPicker
                  label=""
                  value={dateTo}
                  onChange={setDateTo}
                  placeholder="End date..."
                  variant="filter"
                  minDate={dateFrom}
                  maxDate="2026-12-31"
                />
              </div>
            </div>
          </div>

          {(searchQuery || filterTab || typeFilter || dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setFilterTab('');
                setTypeFilter('');
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
                gap: '4px',
              }}
            >
              <i className="ti ti-x" /> Clear Filters
            </button>
          )}
        </div>

        {/* View Mode Switching: Cards vs Table */}
        {viewMode === 'cards' ? (
          filteredData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '64px 20px', color: '#94A3B8' }}>
              <i className="ti ti-receipt-off" style={{ fontSize: '42px', display: 'block', marginBottom: '12px', color: '#CBD5E1' }} />
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#334155' }}>No settlements found</div>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748B' }}>No settlement submissions match your filter criteria.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
              {filteredData.map((row: Settlement) => {
                const isLeftover = row.type === 'Leftover return';
                const isLiquidation = row.type === 'Expense liquidation';
                const typeBg = isLeftover ? '#ECFDF5' : isLiquidation ? '#FFFBEB' : '#EFF6FF';
                const typeColor = isLeftover ? '#065F46' : isLiquidation ? '#92400E' : '#1E40AF';
                const statusBg = row.status === 'For validation' ? '#FFFBEB' : row.status === 'Validated' ? '#ECFDF5' : '#FEF2F2';
                const statusColor = row.status === 'For validation' ? '#B45309' : row.status === 'Validated' ? '#047857' : '#991B1B';
                const amountColor = isLeftover ? '#10B981' : '#3B82F6';

                return (
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
                      e.currentTarget.style.boxShadow = '0 12px 24px -6px rgba(0, 0, 0, 0.08)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.02)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    {/* Top: Record ID & Type Badge & Status Badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0F172A', background: '#F1F5F9', padding: '3px 10px', borderRadius: '6px' }}>
                          #{row.id}
                        </span>
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: '20px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: typeBg,
                          color: typeColor,
                        }}>
                          {row.type}
                        </span>
                      </div>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: statusBg,
                        color: statusColor,
                      }}>
                        {row.status}
                      </span>
                    </div>

                    {/* Courier & Trip Information */}
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0F172A' }}>
                        {row.courierName}
                      </h4>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: '#64748B', marginTop: '6px', flexWrap: 'wrap' }}>
                        <i className="ti ti-truck" style={{ fontSize: '14px', color: '#0D9488' }} />
                        <span style={{ fontWeight: 600, color: '#334155' }}>{row.tripRef}</span>
                        <span>•</span>
                        <span>
                          {new Date(row.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, {new Date(row.submittedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>

                    {/* Amount & Discrepancy Box */}
                    <div style={{ background: '#F8FAFC', borderRadius: '12px', padding: '12px 14px', border: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748B', letterSpacing: '0.04em' }}>
                          {isLeftover ? 'LEFTOVER RETURN' : 'SETTLEMENT AMOUNT'}
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: amountColor, marginTop: '2px' }}>
                          {formatCurrency(row.amount)}
                        </div>
                      </div>
                      {Boolean(row.discrepancy && row.discrepancy !== 0) && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#EA580C' }}>DISCREPANCY</div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#EA580C', marginTop: '2px' }}>
                            {formatCurrency(row.discrepancy)}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Card Action Footer */}
                    <div style={{ paddingTop: '4px' }}>
                      <button
                        type="button"
                        onClick={() => handleReviewClick(row)}
                        style={{
                          width: '100%',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '9px 16px',
                          borderRadius: '8px',
                          border: '1px solid #0D9488',
                          background: (isManagerOrHead && row.status === 'For validation') ? '#0D9488' : '#F0FDFA',
                          color: (isManagerOrHead && row.status === 'For validation') ? '#FFFFFF' : '#0D9488',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        <i className={(isManagerOrHead && row.status === 'For validation') ? 'ti ti-file-search' : 'ti ti-eye'} />
                        {(isManagerOrHead && row.status === 'For validation') ? 'Review Details' : 'View Details'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* Custom Table to exactly match the requested design */
          <div style={{ border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'visible' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                  <th style={thStyle}>RECORD ID</th>
                  <th style={thStyle}>TYPE</th>
                  <th style={thStyle}>COURIER / TRIP</th>
                  <th style={thStyle}>SUBMITTED</th>
                  <th style={thStyle}>AMOUNT</th>
                  <th style={thStyle}>STATUS</th>
                  <th style={thStyle}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>
                      No settlements found.
                    </td>
                  </tr>
                ) : filteredData.map((row: Settlement) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{row.id}</td>
                    <td style={tdStyle}>
                      <span style={{ 
                        padding: '4px 10px', 
                        borderRadius: '20px', 
                        fontSize: '11px', 
                        fontWeight: 700,
                        background: row.type === 'Leftover return' ? '#ECFDF5' : '#FFFBEB',
                        color: row.type === 'Leftover return' ? '#065F46' : '#92400E'
                      }}>
                        {row.type}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: '#1E293B', marginBottom: '2px' }}>{row.courierName}</div>
                      <div style={{ fontSize: '12px', color: '#64748B' }}>{row.tripRef}</div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: '#1E293B', marginBottom: '2px' }}>
                        {new Date(row.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        , {new Date(row.submittedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 800, color: row.type === 'Leftover return' ? '#10B981' : '#3B82F6' }}>
                        {formatCurrency(row.amount)}
                      </div>
                      {Boolean(row.discrepancy && row.discrepancy !== 0) && (
                        <div style={{ fontSize: '11px', color: '#EA580C', fontWeight: 600, marginTop: '2px' }}>
                          Discrepancy {formatCurrency(row.discrepancy)}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ 
                        padding: '4px 10px', 
                        borderRadius: '20px', 
                        fontSize: '11px', 
                        fontWeight: 700,
                        background: row.status === 'For validation' ? '#FFFBEB' : row.status === 'Validated' ? '#ECFDF5' : '#FEF2F2',
                        color: row.status === 'For validation' ? '#B45309' : row.status === 'Validated' ? '#047857' : '#991B1B'
                      }}>
                        {row.status}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <Dropdown
                        align="right"
                        items={[
                          {
                            key: 'review',
                            label: (isManagerOrHead && row.status === 'For validation') ? 'Review Details' : 'View Details',
                            icon: (isManagerOrHead && row.status === 'For validation') ? 'ti-file-search' : 'ti-eye',
                            onClick: () => handleReviewClick(row)
                          }
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Review Modal */}
      {selectedRecord && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15, 23, 42, 0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ background: 'white', borderRadius: '12px', width: '100%', maxWidth: '500px', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '24px' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: '1.25rem', fontWeight: 800, color: '#0F172A' }}>
                {selectedRecord.id} • {selectedRecord.type}
              </h2>
              <p style={{ margin: '0 0 24px', fontSize: '13px', color: '#64748B' }}>
                {isManagerOrHead 
                  ? 'Submitted by the Accountant. Review the details, then choose a decision.'
                  : 'Settlement details recorded by the Accountant.'}
              </p>

              {/* Box 1 */}
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                  <span style={{ color: '#475569', fontWeight: 600 }}>{selectedRecord.courierName}</span>
                  <span style={{ color: '#1E293B', fontWeight: 700 }}>{selectedRecord.tripRef}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                  <span style={{ color: '#475569', fontWeight: 600 }}>Cash advance</span>
                  <span style={{ color: '#1E293B', fontWeight: 700 }}>{formatCurrency(selectedRecord.cashAdvance)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', fontSize: '13px' }}>
                  <span style={{ color: '#475569', fontWeight: 600 }}>Total expenses</span>
                  <span style={{ color: '#1E293B', fontWeight: 700 }}>− {formatCurrency(selectedRecord.totalExpenses)}</span>
                </div>
                
                <div style={{ height: '1px', background: '#E2E8F0', margin: '0 -16px 12px' }}></div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                  <span style={{ color: '#0F172A', fontWeight: 800 }}>Expected {selectedRecord.type === 'Leftover return' ? 'leftover' : 'reimbursement'}</span>
                  <span style={{ color: '#0F172A', fontWeight: 800 }}>{formatCurrency(selectedRecord.amount)}</span>
                </div>
              </div>

              {/* Box 2 */}
              {selectedRecord.type === 'Leftover return' && (
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                    <span style={{ color: '#475569', fontWeight: 600 }}>Envelope no.</span>
                    <span style={{ color: '#1E293B', fontWeight: 700 }}>{selectedRecord.envelopeNo}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '13px' }}>
                    <span style={{ color: '#475569', fontWeight: 600 }}>Cash counted by Accountant</span>
                    <span style={{ color: '#1E293B', fontWeight: 700 }}>{formatCurrency(selectedRecord.cashCounted ?? 0)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: '#475569', fontWeight: 600 }}>Matches expected leftover</span>
                    <span style={{ color: '#10B981', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <i className="ti ti-check" /> Yes
                    </span>
                  </div>
                </div>
              )}

              {selectedRecord.type === 'Reimbursement' && (
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '16px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                    <span style={{ color: '#475569', fontWeight: 600 }}>Supervisor Approval</span>
                    <span style={{ color: '#1E293B', fontWeight: 700 }}>Checked</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: '#475569', fontWeight: 600 }}>Original Receipts Submitted</span>
                    <span style={{ color: '#10B981', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <i className="ti ti-check" /> Yes
                    </span>
                  </div>
                </div>
              )}

              <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '12px' }}>
                Recorded by {selectedRecord.recordedBy} • {new Date(selectedRecord.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, {new Date(selectedRecord.recordedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </div>

              {selectedRecord.status === 'For validation' ? (
                isManagerOrHead ? (
                  <>
                    <div style={{ marginBottom: decision ? '16px' : '24px' }}>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: '#0F172A', marginBottom: '6px' }}>Decision</label>
                      <select 
                        value={decision}
                        onChange={(e) => setDecision(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '14px', outline: 'none' }}
                      >
                        <option value="">Select decision...</option>
                        <option value="approve">✓ Validate</option>
                        <option value="reject">✕ Reject</option>
                      </select>
                    </div>

                    {decision === 'reject' && (
                      <>
                        <div style={{ marginBottom: '16px' }}>
                          <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: '#0F172A', marginBottom: '6px' }}>Reason for rejection</label>
                          <select 
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '14px', outline: 'none' }}
                          >
                            <option value="">Select a reason...</option>
                            <option value="Cash short / over not explained">Cash short / over not explained</option>
                            <option value="Wrong computation (advance / expenses)">Wrong computation (advance / expenses)</option>
                            <option value="Envelope not received / wrong envelope no.">Envelope not received / wrong envelope no.</option>
                            <option value="Missing original receipts">Missing original receipts</option>
                            <option value="No prior supervisor approval">No prior supervisor approval</option>
                            <option value="Duplicate record">Duplicate record</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <div style={{ marginBottom: '24px' }}>
                          <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: '#0F172A', marginBottom: '6px' }}>Details for the Accountant</label>
                          <textarea 
                            placeholder="What should be corrected?"
                            value={remarks}
                            onChange={(e) => setRemarks(e.target.value)}
                            rows={3}
                            style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '14px', outline: 'none', resize: 'none' }}
                          />
                        </div>
                      </>
                    )}

                    {decision === 'approve' && (
                      <div style={{ marginBottom: '24px' }}>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 800, color: '#0F172A', marginBottom: '6px' }}>Remarks (optional)</label>
                        <textarea 
                          placeholder="Sent to Asst. Finance Manager for approval"
                          value={remarks}
                          onChange={(e) => setRemarks(e.target.value)}
                          rows={2}
                          style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '14px', outline: 'none', resize: 'none' }}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ marginBottom: '24px', padding: '16px', background: '#FFFBEB', borderRadius: '8px', border: '1px solid #FDE68A' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700, color: '#92400E' }}>
                      <i className="ti ti-clock-hour-4" style={{ fontSize: '18px' }} />
                      <span>Pending Validation</span>
                    </div>
                    <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#B45309' }}>
                      This settlement has been submitted and is currently awaiting review and validation by the Head Accountant.
                    </p>
                  </div>
                )
              ) : (
                <div style={{ marginBottom: '24px', padding: '16px', background: selectedRecord.status === 'Validated' ? '#ECFDF5' : '#FEF2F2', borderRadius: '8px', border: `1px solid ${selectedRecord.status === 'Validated' ? '#A7F3D0' : '#FECACA'}` }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: selectedRecord.status === 'Validated' ? '#065F46' : '#991B1B' }}>
                    This settlement was already {selectedRecord.status.toLowerCase()}.
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <Button title="Close" variant="secondary" onClick={() => setSelectedRecord(null)} />
                {isManagerOrHead && selectedRecord.status === 'For validation' && (
                  <button 
                    onClick={handleConfirmDecision}
                    style={{ 
                      padding: '8px 16px', 
                      borderRadius: '6px', 
                      fontSize: '13px', 
                      fontWeight: 700, 
                      border: 'none', 
                      cursor: 'pointer',
                      background: decision === 'reject' ? '#EF4444' : '#10B981',
                      color: 'white',
                      opacity: decision ? 1 : 0.5
                    }}
                    disabled={!decision}
                  >
                    {decision === 'reject' ? 'Confirm reject' : decision === 'approve' ? 'Confirm validate' : 'Confirm'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Record Settlement Modal */}
      <RecordSettlementModal 
        isOpen={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
        onSuccess={() => refetch()}
      />

    </div>
  );
};

const thStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: '11px',
  fontWeight: 800,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
};

const tdStyle: React.CSSProperties = {
  padding: '16px',
  fontSize: '13px',
  color: '#1E293B'
};

export default Settlements;
