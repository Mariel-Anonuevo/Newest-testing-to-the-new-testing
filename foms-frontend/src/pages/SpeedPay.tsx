import React, { useState, useEffect, useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useToast } from '../components/ToastContext';
import { createPortal } from 'react-dom';
import { Card } from '../components/Card';
import { User, Lock, AlertCircle, Eye, EyeOff, Calendar } from 'lucide-react';
import { invoicesService } from '../services/invoicesService';
import { clientsService } from '../services/clientsService';
import { speedpayService } from '../services/speedpayService';
import { paymentsService } from '../services/paymentsService';
import { useQuery } from '../hooks/useQuery';
import { Invoice, Client, SpeedPaySubmission } from '../types/entities';
import { formatCurrency, formatBillingPeriod } from '../utils/format';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import './LoginPage.css';

type SpeedPayStep = 'login' | 'dashboard' | 'summary' | 'payment' | 'upload' | 'submitted';
type DashTab = 'dashboard' | 'my_invoices' | 'pay_invoice' | 'recent';

const PAYMENT_METHODS = [
  { id: 'paymongo', label: 'PayMongo', color: '#10B981' },
  { id: 'gcash', label: 'GCash', color: '#007AFF' },
  { id: 'maya', label: 'Maya', color: '#00AA6C' },
  { id: 'bank', label: 'Bank Transfer (QRPh)', color: '#1E3A5F' },
];

function statusBadge(status: string): React.CSSProperties {
  const s = status.toLowerCase();
  if (s.includes('valid')) return { background: '#D1FAE5', color: '#065F46' };
  if (s.includes('reject')) return { background: '#FEE2E2', color: '#991B1B' };
  if (s.includes('overdue')) return { background: '#FEE2E2', color: '#991B1B' };
  if (s.includes('pending') || s.includes('sent')) return { background: '#FEF3C7', color: '#B45309' };
  return { background: '#E0E7FF', color: '#3730A3' };
}

// ─── Mini Bar Chart ───────────────────────────────────────────────
function BarChart({ data, color = '#6366F1', height = 120 }: { data: { label: string; value: number }[]; color?: string; height?: number }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, padding: '0 4px' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, textAlign: 'center' }}>
            {d.value > 0 ? (d.value >= 1000 ? `₱${(d.value / 1000).toFixed(0)}k` : `₱${d.value}`) : ''}
          </div>
          <div
            style={{
              width: '100%',
              background: `linear-gradient(180deg, ${color}, ${color}99)`,
              borderRadius: '4px 4px 0 0',
              height: `${(d.value / max) * (height - 30)}px`,
              minHeight: d.value > 0 ? 4 : 0,
              transition: 'height 0.4s ease',
            }}
          />
          <div style={{ fontSize: 9, color: '#94A3B8', fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Mini Donut Chart ──────────────────────────────────────────────
function DonutChart({ segments, size = 100 }: { segments: { label: string; value: number; color: string }[]; size?: number }) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 16;
  let cumulative = 0;

  const arcs = segments.map(seg => {
    const pct = seg.value / total;
    const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    cumulative += pct;
    const endAngle = cumulative * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = pct > 0.5 ? 1 : 0;
    return { ...seg, d: pct > 0.001 ? `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}` : '' };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth={strokeWidth} />
      {arcs.map((arc, i) =>
        arc.d ? (
          <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth={strokeWidth} strokeLinecap="round" />
        ) : null
      )}
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={12} fontWeight={800} fill="#0F172A">
        {total}
      </text>
    </svg>
  );
}

export const SpeedPay: React.FC = () => {
  const { toast } = useToast();

  const { data: initialData, isLoading: loading, error, refetch } = useQuery(
    'speedpay:portal_data',
    async () => {
      const [invRes, cliRes, spRes] = await Promise.all([
        invoicesService.list({ pageSize: 100 }),
        clientsService.list({ pageSize: 100 }),
        speedpayService.list({ pageSize: 100 }),
      ]);
      return {
        invoices: invRes.items || [],
        clients: cliRes.items || [],
        speedPay: spRes.items || [],
      };
    }
  );

  const invoices = initialData?.invoices || [];
  const clients = initialData?.clients || [];
  const [speedPay, setSpeedPay] = useState<SpeedPaySubmission[]>([]);

  useEffect(() => {
    if (initialData?.speedPay) {
      setSpeedPay(initialData.speedPay);
    }
  }, [initialData?.speedPay]);

  const [step, setStep] = useState<SpeedPayStep>('login');
  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loggedInClient, setLoggedInClient] = useState<Client | null>(null);
  const [foundInvoice, setFoundInvoice] = useState<Invoice | null>(null);
  const [selectedMethod, setSelectedMethod] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [clientEmail, setClientEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nameErrors, setNameErrors] = useState<{ first?: string; last?: string; email?: string }>({});
  const [existingSubmission, setExistingSubmission] = useState<any>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);

  const [dashTab, setDashTab] = useState<DashTab>('pay_invoice');

  const currentDate = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }, []);

  const profileRef = useRef<HTMLDivElement>(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // Close profile dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem('speedpay_client');
    if (saved) {
      try {
        const client = JSON.parse(saved);
        setLoggedInClient(client);
        setClientEmail(client.email || '');
        setStep('dashboard');
      } catch (e) {}
    }
  }, []);

  const clientInvoices = useMemo(() => {
    if (!loggedInClient) return [];
    return invoices.filter(
      (i: Invoice) => i.clientId === loggedInClient.id &&
        ['Sent', 'Overdue'].includes(i.status)
    );
  }, [loggedInClient, invoices]);

  const recentPayments = useMemo(() => {
    if (!loggedInClient) return [];
    return speedPay
      .filter((s: SpeedPaySubmission) => s.clientEmail === loggedInClient.email || s.clientName === loggedInClient.contactPerson)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }, [loggedInClient, speedPay]);

  const handleLogin = () => {
    setLoginError('');
    if (!loginId || !loginPass) { setLoginError('Please fill in both fields.'); return; }

    // loginId is expected to be Invoice Number
    const invoice = invoices.find((i: Invoice) => i.invoiceNumber.toLowerCase() === loginId.toLowerCase());
    if (!invoice) {
      setLoginError('Invoice not found. Please verify your invoice number.');
      return;
    }
    const client = clients.find((c: Client) => c.id === invoice.clientId);
    if (!client) {
      setLoginError('Client account associated with this invoice not found.');
      return;
    }

    sessionStorage.setItem('speedpay_client', JSON.stringify(client));
    setLoggedInClient(client);
    setClientEmail(client.email ?? '');
    // Pre-fill name from client contact person
    const nameParts = (client.contactPerson ?? '').trim().split(' ');
    setFirstName(nameParts[0] ?? '');
    setLastName(nameParts.slice(1).join(' ') ?? '');
    setStep('dashboard');
  };

  const handleLogout = () => {
    sessionStorage.removeItem('speedpay_client');
    setLoggedInClient(null);
    setStep('login');
    setLoginId(''); setLoginPass('');
    setFoundInvoice(null); setSelectedMethod(''); setReferenceNumber(''); setProofFile(null);
    setFirstName(''); setLastName(''); setNameErrors({});
    setShowProfileMenu(false);
  };

  const clientRecentPayments = useMemo(() => {
    if (!loggedInClient) return [];
    return [...speedPay]
      .filter((s: SpeedPaySubmission) => (s as any).clientId === loggedInClient.id || invoices.find((i: Invoice) => i.id === s.invoiceId)?.clientId === loggedInClient.id)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }, [loggedInClient, speedPay, invoices]);

  // Client Dashboard Charts Data
  const totalOutstanding = useMemo(() =>
    clientInvoices.reduce((sum: number, i: Invoice) => sum + (i.totalAmount ?? 0), 0),
    [clientInvoices]
  );

  const totalPaid = useMemo(() =>
    clientRecentPayments.filter((p: any) => p.status === 'Validated' || p.status === 'Approved').reduce((sum: number, p: any) => sum + ((p as any).amountPaid ?? 0), 0),
    [clientRecentPayments]
  );

  const monthlyData = useMemo(() => {
    const months: { label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleDateString('en-US', { month: 'short' });
      const year = d.getFullYear();
      const month = d.getMonth();
      const value = clientRecentPayments
        .filter((s: SpeedPaySubmission) => {
          const sd = new Date((s as any).submittedAt);
          return sd.getFullYear() === year && sd.getMonth() === month && ((s.status as string) === 'Validated');
        })
        .reduce((sum: number, s: any) => sum + ((s as any).amountPaid ?? 0), 0);
      months.push({ label, value });
    }
    return months;
  }, [clientRecentPayments]);

  const existingSubmissionsForInvoice = (inv: Invoice) => {
    const sub = speedPay.find((s: SpeedPaySubmission) =>
      s.invoiceId === inv.id && (s.status === 'Pending Validation' || s.status === 'Rejected')
    );
    return sub;
  };

  const handleSelectInvoice = (inv: Invoice) => {
    const existing = existingSubmissionsForInvoice(inv);
    setFoundInvoice(inv);
    if (existing) {
      setExistingSubmission(existing);
      setReferenceNumber(existing.referenceNumber);
      setStep('submitted');
    }
    else {
      setExistingSubmission(null);
      if (dashTab !== 'pay_invoice') {
        setStep('summary');
      }
    }
  };

  const handlePayMongoCheckout = async () => {
    if (!selectedMethod || !foundInvoice) return;
    setIsProcessing(true);
    try {
      const secretKey = import.meta.env.VITE_PAYMONGO_SECRET_KEY;
      if (!secretKey) {
        setIsProcessing(false);
        setStep('upload');
        toast.info('PayMongo API key not configured. Proceeding to upload proof directly.');
        return;
      }

      const amountInCents = Math.round(foundInvoice.totalAmount * 100);
      if (amountInCents < 10000) throw new Error(`Minimum amount is ₱100. Invoice total is ${formatCurrency(foundInvoice.totalAmount)}.`);

      const response = await fetch('https://api.paymongo.com/v1/links', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(secretKey + ':')}`
        },
        body: JSON.stringify({
          data: {
            attributes: {
              amount: amountInCents,
              currency: 'PHP',
              description: `Payment for ${foundInvoice.invoiceNumber}`,
              remarks: `Client: ${loggedInClient?.name}`,
            },
          },
        }),
      });

      const rawText = await response.text();
      let data: any;
      try { data = JSON.parse(rawText); } catch { throw new Error(`Server returned unexpected response.`); }

      if (!response.ok || data.errors || data.error) {
        throw new Error(data.errors?.[0]?.detail ?? data.error ?? `PayMongo error (HTTP ${response.status})`);
      }

      const checkoutUrl: string = data.data.attributes.checkout_url;
      const refNum: string = data.data.attributes.reference_number;
      setReferenceNumber(refNum);
      window.open(checkoutUrl, '_blank');
      setIsProcessing(false);
      setStep('upload');
      toast.info('Complete payment in the new tab, then upload your proof here.', 'Redirected to PayMongo');
    } catch (err: any) {
      setIsProcessing(false);
      console.error('SpeedPay Checkout Error:', err);
      toast.error(err.message ?? 'Failed to generate payment link.', 'Payment Error');
    }
  };

  const validateName = () => {
    const errors: { first?: string; last?: string; email?: string } = {};
    const nameRegex = /^[a-zA-Z\s'-]+$/;
    if (!firstName.trim()) errors.first = 'First name is required.';
    else if (!nameRegex.test(firstName)) errors.first = 'First name must contain letters only.';
    if (!lastName.trim()) errors.last = 'Last name is required.';
    else if (!nameRegex.test(lastName)) errors.last = 'Last name must contain letters only.';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!clientEmail.trim()) errors.email = 'Email address is required.';
    else if (!emailRegex.test(clientEmail)) errors.email = 'Please enter a valid email address.';
    setNameErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveSubmission = async (fileUrl: string | undefined) => {
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    const newPaymentData = {
      invoiceId: foundInvoice!.id,
      clientId: loggedInClient!.id,
      amount: foundInvoice!.totalAmount,
      referenceNumber,
      paymentMethod: (PAYMENT_METHODS.find(m => m.id === selectedMethod)?.label ?? selectedMethod) as any,
      proofOfPaymentUrl: fileUrl,
      bankConfirmed: false,
      recordedBy: 'SpeedPay System',
      status: 'Pending Validation' as const,
      recordedAt: new Date().toISOString(),
      notes: `SpeedPay transaction by ${fullName} (${clientEmail})`
    };

    try {
      const created = await paymentsService.create(newPaymentData as any);
      setExistingSubmission(created);
      setStep('submitted');
      setShowEmailModal(true);
      toast.success('Proof submitted. Pending Finance validation.', 'Payment Submitted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit payment proof');
    }
  };

  const handleSubmit = () => {
    if (!foundInvoice) return;
    if (!validateName()) return;
    if (proofFile) {
      const reader = new FileReader();
      reader.onloadend = () => saveSubmission(reader.result as string);
      reader.readAsDataURL(proofFile);
    } else {
      saveSubmission(undefined);
    }
  };

  const qrValue = foundInvoice
    ? `PAYMONGO|QRPh|${loggedInClient?.name ?? ''}|${foundInvoice.invoiceNumber}|PHP|${foundInvoice.totalAmount.toFixed(2)}`
    : 'SPEEDPAY';

  const renderBack = (to: SpeedPayStep, label: string) => (
    <button onClick={() => setStep(to)}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: '0.85rem', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
      ← {label}
    </button>
  );

  if (loading) {
    return <LoadingSpinner text="Loading SpeedPay portal..." />;
  }

  // LOGIN LAYOUT
  if (step === 'login') {
    return (
      <div className="login-shell">
        <aside className="login-left">
          <div className="login-logo-area">
            <img src="/logo.png" alt="Speedex" className="login-logo-img" onError={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
          </div>
          <div className="login-features" style={{ gap: 20 }}>
            <div className="login-feature-item">
              <div className="login-feature-step">1</div>
              <div className="login-feature-text">
                <h4 className="login-feature-title">Access Your Account</h4>
                <p className="login-feature-desc">Use your registered Invoice Number and password to securely access your payment dashboard.</p>
              </div>
            </div>
            <div className="login-feature-item">
              <div className="login-feature-step">2</div>
              <div className="login-feature-text">
                <h4 className="login-feature-title">Settle Invoices</h4>
                <p className="login-feature-desc">View your outstanding statements, choose your preferred payment mode, and pay in full.</p>
              </div>
            </div>
            <div className="login-feature-item">
              <div className="login-feature-step">3</div>
              <div className="login-feature-text">
                <h4 className="login-feature-title">Upload Proof</h4>
                <p className="login-feature-desc">Submit your payment reference number and deposit slip for instant transaction verification.</p>
              </div>
            </div>
          </div>
        </aside>

        <main className="login-right">
          <div className="login-card">
            <p className="login-card-label">SECURE ACCESS</p>
            <h1 className="login-card-title">Login your SpeedPay Account</h1>
            <p className="login-card-subtitle">Enter your credentials below to continue.</p>
            <div className="login-card-divider" />

            <form className="login-form" onSubmit={e => { e.preventDefault(); handleLogin(); }} noValidate>
              <div className="login-field">
                <label className="login-label">INVOICE NUMBER</label>
                <div className="login-input-wrap">
                  <span className="login-input-icon"><User size={16} /></span>
                  <input type="text" className="login-input" placeholder="e.g. INV-001" value={loginId} onChange={e => setLoginId(e.target.value)} />
                </div>
              </div>
              <div className="login-field">
                <label className="login-label">PASSWORD</label>
                <div className="login-input-wrap">
                  <span className="login-input-icon"><Lock size={16} /></span>
                  <input type={showPassword ? 'text' : 'password'} className="login-input" placeholder="••••••••" value={loginPass} onChange={e => setLoginPass(e.target.value)} />
                  <button type="button" className="login-eye-btn" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div className="login-options-row">
                <label className="login-remember">
                  <input type="checkbox" className="login-remember-checkbox" />
                  <span className="login-remember-label">Remember me</span>
                </label>
                <button type="button" className="login-forgot-link">Forgot password?</button>
              </div>

              {loginError && (
                <div className="login-global-error" role="alert" aria-live="polite">
                  <AlertCircle size={15} />
                  {loginError}
                </div>
              )}

              <button type="submit" className="login-btn">LOG IN</button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // DASHBOARD LAYOUT
  return (
    <div className="app-layout" style={{ alignItems: 'stretch' }}>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-img-wrapper">
            <img src="/logo.png" alt="Speedex" className="sidebar-logo-img" onError={(e) => (e.currentTarget as HTMLImageElement).style.display = 'none'} />
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-item-container">
            <a href="#" onClick={(e) => { e.preventDefault(); setDashTab('dashboard'); setStep('dashboard'); }} className={`nav-item ${dashTab === 'dashboard' && step === 'dashboard' ? 'active' : ''}`}>
              <span className="nav-icon" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <i className="ti ti-layout-dashboard" style={{ fontSize: "18px" }} />
              </span>
              <span className="nav-label">Dashboard</span>
            </a>
          </div>
          <div className="nav-item-container">
            <a href="#" onClick={(e) => { e.preventDefault(); setDashTab('my_invoices'); setStep('dashboard'); }} className={`nav-item ${dashTab === 'my_invoices' && step === 'dashboard' ? 'active' : ''}`}>
              <span className="nav-icon" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <i className="ti ti-file-invoice" style={{ fontSize: "18px" }} />
              </span>
              <span className="nav-label">My Invoices</span>
            </a>
          </div>
          <div className="nav-item-container">
            <a href="#" onClick={(e) => { e.preventDefault(); setDashTab('pay_invoice'); setStep('dashboard'); }} className={`nav-item ${dashTab === 'pay_invoice' && step === 'dashboard' ? 'active' : ''}`}>
              <span className="nav-icon" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <i className="ti ti-credit-card" style={{ fontSize: "18px" }} />
              </span>
              <span className="nav-label">Pay an Invoice</span>
            </a>
          </div>
          <div className="nav-item-container">
            <a href="#" onClick={(e) => { e.preventDefault(); setDashTab('recent'); setStep('dashboard'); }} className={`nav-item ${dashTab === 'recent' && step === 'dashboard' ? 'active' : ''}`}>
              <span className="nav-icon" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <i className="ti ti-history" style={{ fontSize: "18px" }} />
              </span>
              <span className="nav-label">Payment History</span>
            </a>
          </div>
        </nav>

        {loggedInClient && (
          <div className="sidebar-footer" ref={profileRef}>
            <div
              className={`profile-card ${showProfileMenu ? "active" : ""}`}
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              role="button"
              style={{ cursor: 'pointer' }}
            >
              <div className="profile-av">{loggedInClient.contactPerson?.substring(0, 2).toUpperCase() || 'CL'}</div>
              <div className="profile-info">
                <span className="profile-name">{loggedInClient.contactPerson || 'Client Name'}</span>
                <span className="profile-role">{loggedInClient.name}</span>
              </div>
              <i className="ti ti-selector profile-selector-icon" style={{ marginLeft: "auto", opacity: 0.5, fontSize: "14px" }} />
            </div>

            {showProfileMenu && (
              <div className="sidebar-profile-dropdown">
                <div className="dropdown-identity">
                  <span className="dropdown-name">{loggedInClient.contactPerson}</span>
                  <span className="dropdown-role">{loggedInClient.name}</span>
                </div>
                <div className="dropdown-divider" />
                <button className="dropdown-option logout" onClick={handleLogout}>
                  <i className="ti ti-logout" />
                  <span>Log Out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      <div className="main-area" style={{ justifyContent: 'flex-start', height: '100vh', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box' }}>
        <header className="global-header" style={{ justifyContent: 'space-between', padding: '10px 28px', background: '#fff', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center' }}>
          <div className="gh-left">
            <h1 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0F172A', margin: 0 }}>
              {dashTab === 'dashboard' ? 'Dashboard' : dashTab === 'my_invoices' ? 'My Invoices' : dashTab === 'pay_invoice' ? 'Pay an Invoice' : 'Payment History'}
            </h1>
          </div>
          <div className="gh-right">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 9999, color: '#334155', fontSize: '0.85rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
              <Calendar size={15} style={{ color: '#0EA5E9' }} strokeWidth={2.5} />
              <span>{currentDate}</span>
            </div>
          </div>
        </header>

        <main className="content-area" style={{ flex: 1, padding: '28px', background: '#EEF2FF', display: 'flex', flexDirection: 'column', minWidth: 0, boxSizing: 'border-box', width: '100%', maxWidth: '100%' }}>
          <div style={{ maxWidth: 860, margin: '0 auto', width: '100%' }}>

            {step === 'dashboard' && dashTab === 'dashboard' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                  <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 24, display: 'flex', alignItems: 'center', gap: 24 }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Outstanding vs Paid</h3>
                      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748B' }}>Your billing and payment overview.</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#10B981' }} />
                            <span style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Total Paid</span>
                          </div>
                          <span style={{ fontSize: 13, color: '#0F172A', fontWeight: 700 }}>{formatCurrency(totalPaid)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#F43F5E' }} />
                            <span style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Outstanding</span>
                          </div>
                          <span style={{ fontSize: 13, color: '#0F172A', fontWeight: 700 }}>{formatCurrency(totalOutstanding)}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <DonutChart
                        segments={[
                          { label: 'Paid', value: totalPaid, color: '#10B981' },
                          { label: 'Outstanding', value: totalOutstanding, color: '#F43F5E' },
                        ]}
                        size={120}
                      />
                    </div>
                  </div>

                  <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 24 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Monthly Payment Summary</h3>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94A3B8' }}>Your payment history over time</p>
                      </div>
                    </div>
                    {monthlyData.every(d => d.value === 0) ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 100, color: '#94A3B8', gap: 8 }}>
                        <span style={{ fontSize: 13 }}>No payment history yet</span>
                      </div>
                    ) : (
                      <BarChart data={monthlyData} color="#6366F1" height={100} />
                    )}
                  </div>
                </div>
              </>
            )}

            {step === 'dashboard' && dashTab === 'my_invoices' && (
              <Card>
                <h2 style={{ margin: '0 0 20px', fontSize: '1.25rem', fontWeight: 800, color: '#0F172A' }}>My Invoices</h2>
                <p style={{ color: '#64748B' }}>List of all your invoices will be displayed here.</p>
              </Card>
            )}

            {step === 'dashboard' && dashTab === 'pay_invoice' && (
              <Card style={{ padding: '32px 24px', background: '#fff' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 32px', color: '#0F172A' }}>Pay an Invoice</h2>

                {/* Step 1: Select invoice */}
                <div style={{ marginBottom: 40 }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '1.1rem', color: '#0F172A', marginBottom: 20 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#0F172A', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800 }}>1</div>
                    Select invoice
                  </h3>

                  <div style={{ background: '#F8FAFC', padding: 16, borderRadius: 12, display: 'flex', gap: 12, marginBottom: 16, border: '1px solid #E2E8F0', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px', display: 'flex', alignItems: 'center', background: '#EAEDF3', border: 'none', borderRadius: '28px', padding: '0 16px', height: '42px' }}>
                      <i className="ti ti-search" style={{ color: '#49454F', fontSize: '16px' }} />
                      <input type="text" placeholder="Search invoice number..." style={{ border: 'none', outline: 'none', background: 'transparent', width: '100%', fontSize: '0.9375rem', color: '#1C1B1F' }} />
                    </div>
                  </div>

                  <p style={{ fontSize: 12, color: '#64748B', marginBottom: 16, fontWeight: 600 }}>{clientInvoices.length} invoices found</p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {clientInvoices.map((inv: Invoice) => {
                      const isSelected = foundInvoice?.id === inv.id;
                      const isOverdue = inv.status === 'Overdue' || (inv.status as string) === 'Outstanding';
                      const isDueSoon = !isOverdue && new Date(inv.dueDate) >= new Date();
                      return (
                        <div key={inv.id} onClick={() => handleSelectInvoice(inv)} style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderRadius: 12, border: isSelected ? '2px solid #10B981' : '1px solid #E2E8F0', background: isSelected ? '#F0FDF4' : '#fff', cursor: 'pointer', transition: 'all 0.2s' }}>
                          <div style={{ marginRight: 20, display: 'flex', alignItems: 'center' }}>
                            <div style={{ width: 18, height: 18, borderRadius: '50%', border: isSelected ? '5px solid #10B981' : '1px solid #CBD5E1', background: '#fff' }} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                              <span style={{ fontWeight: 800, color: '#0F172A', fontSize: '1.05rem' }}>{inv.invoiceNumber}</span>
                              <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 800, background: isOverdue ? '#FEE2E2' : (isDueSoon ? '#FEF3C7' : '#FEE2E2'), color: isOverdue ? '#991B1B' : (isDueSoon ? '#B45309' : '#991B1B') }}>
                                {isOverdue ? 'Overdue' : (isDueSoon ? 'Due soon' : 'Unpaid')}
                              </span>
                            </div>
                            <div style={{ color: '#64748B', fontSize: 13 }}>{loggedInClient?.serviceArea || 'National Capital Region'}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 800, color: '#0F172A', fontSize: '1.05rem' }}>{formatCurrency(inv.totalAmount)}</div>
                            <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 4, fontWeight: 600 }}>Due {new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Step 2: Payment details & breakdown */}
                {foundInvoice && (
                  <div>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '1.1rem', color: '#0F172A', marginBottom: 20 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#0F172A', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800 }}>2</div>
                      Payment details & breakdown
                    </h3>

                    <div style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 32, background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
                        <div>
                          <h4 style={{ margin: '0 0 6px', fontSize: '1.1rem', fontWeight: 900, color: '#0F172A', textTransform: 'uppercase' }}>{loggedInClient?.name || 'Client'}</h4>
                          <p style={{ margin: 0, fontSize: 11, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>SERVICE AREA: {loggedInClient?.serviceArea || 'NATIONAL CAPITAL REGION'}</p>
                          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>METRO MANILA, PHILIPPINES</p>
                        </div>
                        <div style={{ background: '#F0FDFA', padding: '20px', borderRadius: 12, minWidth: 260, border: '1px solid #CCFBF1' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Invoice Number</span>
                            <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Due Date</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                            <span style={{ fontSize: '1.05rem', fontWeight: 900, color: '#0F172A' }}>{foundInvoice.invoiceNumber}</span>
                            <span style={{ fontSize: '1.05rem', fontWeight: 900, color: '#0F172A' }}>{new Date(foundInvoice.dueDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}</span>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4, fontWeight: 600 }}>Please Pay</div>
                            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#0F172A' }}>{formatCurrency(foundInvoice.totalAmount)}</div>
                          </div>
                        </div>
                      </div>

                      <div style={{ marginBottom: 28 }}>
                        <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4, fontWeight: 600 }}>Billing Period</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{formatBillingPeriod(foundInvoice.billingPeriod)}</div>
                      </div>

                      <div style={{ borderTop: '1px solid #E2E8F0', padding: '16px 0', display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#475569', fontSize: 13, fontWeight: 500 }}>Remaining Balance from previous bill</span>
                        <span style={{ color: '#0F172A', fontSize: 13, fontWeight: 600 }}>0.00</span>
                      </div>

                      <div style={{ borderTop: '1px solid #E2E8F0', padding: '20px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                          <span style={{ color: '#0F172A', fontSize: 14, fontWeight: 800 }}>Charges for this billing period</span>
                          <span style={{ color: '#0F172A', fontSize: 14, fontWeight: 800 }}>{formatCurrency(foundInvoice.totalAmount)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, paddingLeft: 16 }}>
                          <span style={{ color: '#64748B', fontSize: 13 }}>Logistics Services</span>
                          <span style={{ color: '#64748B', fontSize: 13, fontWeight: 500 }}>{formatCurrency(foundInvoice.amount)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, paddingLeft: 16 }}>
                          <span style={{ color: '#64748B', fontSize: 13 }}>Government Taxes (VAT)</span>
                          <span style={{ color: '#64748B', fontSize: 13, fontWeight: 500 }}>{formatCurrency(foundInvoice.vatAmount)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 16 }}>
                          <span style={{ color: '#64748B', fontSize: 13 }}>Other Surcharges</span>
                          <span style={{ color: '#64748B', fontSize: 13, fontWeight: 500 }}>{formatCurrency(foundInvoice.surchargeAmount)}</span>
                        </div>
                      </div>

                      <div style={{ borderTop: '2px solid #E2E8F0', borderBottom: '2px solid #E2E8F0', padding: '24px 0', display: 'flex', justifyContent: 'space-between', marginBottom: 28 }}>
                        <span style={{ color: '#0F172A', fontSize: '1.15rem', fontWeight: 900 }}>Total Amount Due</span>
                        <span style={{ color: '#0F172A', fontSize: '1.15rem', fontWeight: 900 }}>{formatCurrency(foundInvoice.totalAmount)}</span>
                      </div>

                      <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '16px', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
                        <i className="ti ti-camera" style={{ fontSize: 20, color: '#92400E' }} />
                        <span style={{ color: '#92400E', fontSize: 12, fontWeight: 500, lineHeight: 1.4 }}>Before redirecting to PayMongo: please take a screenshot of your payment as proof. You will need to upload this in the next step.</span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={() => { setSelectedMethod('paymongo'); handlePayMongoCheckout(); }} style={{ background: '#0F172A', color: '#fff', padding: '14px 24px', borderRadius: 8, fontWeight: 700, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.2s' }}>
                          Pay via PayMongo →
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {step === 'dashboard' && dashTab === 'recent' && (
              recentPayments.length === 0 ? (
                <Card>
                  <div style={emptyState}>
                    <i className="ti ti-receipt" style={{ fontSize: 44, color: '#94A3B8', display: 'block', marginBottom: 10 }} />
                    <p style={{ margin: 0, color: '#64748B', fontWeight: 600 }}>No payment records yet.</p>
                  </div>
                </Card>
              ) : (
                <Card>
                  <h2 style={{ margin: '0 0 20px', fontSize: '1.25rem', fontWeight: 800, color: '#0F172A' }}>Recently Paid</h2>
                  <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                    <table style={tableStyle}>
                      <thead style={{ background: '#F8FAFC' }}>
                        <tr>
                          {['Invoice No.', 'Amount Paid', 'Date Paid', 'Reference No.', 'Payment Method'].map(h => (
                            <th key={h} style={thStyle}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {recentPayments.map((pay: SpeedPaySubmission) => {
                          const inv = invoices.find((i: Invoice) => i.id === pay.invoiceId);
                          return (
                            <tr key={pay.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                              <td style={{ ...tdStyle, fontWeight: 700, color: '#0F172A' }}>{inv?.invoiceNumber ?? '—'}</td>
                              <td style={{ ...tdStyle, fontWeight: 700 }}>{formatCurrency(pay.amountPaid)}</td>
                              <td style={tdStyle}>{new Date(pay.submittedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                              <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.8rem' }}>{pay.referenceNumber}</td>
                              <td style={tdStyle}>{pay.paymentMethod}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )
            )}

            {/* ════ PAYMENT SUMMARY ════ */}
            {step === 'summary' && foundInvoice && (
              <Card>
                {renderBack('dashboard', 'Back to Invoices')}
                <h2 style={{ margin: '0 0 20px', fontSize: '1.2rem', fontWeight: 800, color: '#0F172A' }}>Payment Summary</h2>

                <div style={{ background: 'linear-gradient(135deg,#0F172A,#1E3A5F)', borderRadius: 14, padding: '24px', marginBottom: 20, textAlign: 'center' }}>
                  <p style={{ margin: '0 0 6px', fontSize: '0.78rem', color: '#94A3B8', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Total Amount Due</p>
                  <p style={{ margin: 0, fontSize: '2.4rem', fontWeight: 900, color: '#fff' }}>{formatCurrency(foundInvoice.totalAmount)}</p>
                </div>

                <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
                  {[
                    { label: 'Invoice No.', value: foundInvoice.invoiceNumber },
                    { label: 'Billing Period', value: formatBillingPeriod(foundInvoice.billingPeriod) },
                    { label: 'Base Amount', value: formatCurrency(foundInvoice.amount) },
                    { label: 'VAT (12%)', value: formatCurrency(foundInvoice.vatAmount) },
                    { label: 'Surcharge', value: formatCurrency(foundInvoice.surchargeAmount) },
                  ].map((row, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', borderBottom: '1px solid #F1F5F9', background: i % 2 === 0 ? '#fff' : '#F8FAFC' }}>
                      <span style={{ fontSize: '0.875rem', color: '#64748B' }}>{row.label}</span>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>{row.value}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', background: '#F1F5F9' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A' }}>Total Due</span>
                    <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#6366F1' }}>{formatCurrency(foundInvoice.totalAmount)}</span>
                  </div>
                </div>

                <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: '0.82rem', color: '#92400E', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <i className="ti ti-info-circle" style={{ fontSize: 18, marginTop: 1 }} />
                  <span><strong>Full payment only.</strong> Partial payments are not accepted.</span>
                </div>

                <button onClick={() => setStep('payment')} style={{ ...btnPrimary, width: '100%' }}>
                  Choose Payment Method →
                </button>
              </Card>
            )}

            {/* ════ PAYMENT METHOD ════ */}
            {step === 'payment' && (
              <Card>
                {renderBack('summary', 'Back to Summary')}
                <h2 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 800, color: '#0F172A' }}>Select Payment Method</h2>
                <p style={{ margin: '0 0 20px', color: '#64748B', fontSize: '0.875rem' }}>Choose your preferred payment channel.</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                  {PAYMENT_METHODS.map(m => (
                    <button key={m.id} onClick={() => setSelectedMethod(m.id)} style={{
                      padding: '14px 18px', borderRadius: 12, border: `2px solid ${selectedMethod === m.id ? '#6366F1' : '#E2E8F0'}`,
                      background: selectedMethod === m.id ? '#EEF2FF' : '#fff',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'all 0.15s',
                    }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: selectedMethod === m.id ? '#0F172A' : '#475569' }}>{m.label}</span>
                      {selectedMethod === m.id && <i className="ti ti-circle-check-filled" style={{ fontSize: 22, color: '#6366F1' }} />}
                    </button>
                  ))}
                </div>

                {selectedMethod === 'bank' && foundInvoice && (
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12, padding: '20px', marginBottom: 20, textAlign: 'center' }}>
                    <p style={{ margin: '0 0 4px', fontSize: '0.82rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scan QRPh to Pay</p>
                    <p style={{ margin: '0 0 16px', fontSize: '0.78rem', color: '#94A3B8' }}>Open your banking app and scan below</p>
                    <div style={{ display: 'inline-flex', padding: 12, background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
                      <QRCodeSVG value={qrValue} size={160} bgColor="#ffffff" fgColor="#0F172A" level="M" />
                    </div>
                    <div style={{ marginTop: 14, background: '#EEF2FF', borderRadius: 8, padding: '10px 14px' }}>
                      <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: '#3730A3' }}>Amount: {formatCurrency(foundInvoice.totalAmount)}</p>
                      <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#6366F1' }}>Ref: {foundInvoice.invoiceNumber} · {loggedInClient?.name}</p>
                    </div>
                    <p style={{ margin: '10px 0 0', fontSize: '0.72rem', color: '#94A3B8' }}>Powered by InstaPay / PESONet · Secure Online Gateway</p>
                  </div>
                )}

                <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '16px', marginBottom: 24, display: 'flex', gap: 12, alignItems: 'flex-start', color: '#92400E' }}>
                  <i className="ti ti-camera" style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }} />
                  <p style={{ margin: 0, fontSize: '0.875rem' }}>
                    Before redirecting to PayMongo: please take a <strong>screenshot</strong> of your payment as proof. You will need to upload this in the next step.
                  </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {selectedMethod === 'bank' ? (
                    <button onClick={() => setStep('upload')}
                      style={{ ...btnPrimary, background: '#0F172A', color: '#fff', padding: '12px 24px', cursor: 'pointer', border: 'none', borderRadius: 8, fontWeight: 700 }}>
                      Proceed to Upload Proof →
                    </button>
                  ) : (
                    <button onClick={handlePayMongoCheckout} disabled={!selectedMethod || isProcessing}
                      style={{ ...btnPrimary, background: '#0F172A', color: '#fff', padding: '12px 24px', cursor: selectedMethod && !isProcessing ? 'pointer' : 'not-allowed', opacity: selectedMethod && !isProcessing ? 1 : 0.5, border: 'none', borderRadius: 8, fontWeight: 700 }}>
                      {isProcessing ? '⟳ Redirecting...' : 'Pay via PayMongo →'}
                    </button>
                  )}
                </div>
              </Card>
            )}

            {/* ════ UPLOAD PROOF ════ */}
            {step === 'upload' && (
              <Card>
                {renderBack('payment', 'Back to Payment Method')}
                <h2 style={{ margin: '0 0 6px', fontSize: '1.2rem', fontWeight: 800, color: '#0F172A' }}>Upload Proof of Payment</h2>
                <p style={{ margin: '0 0 24px', color: '#64748B', fontSize: '0.875rem' }}>
                  {selectedMethod === 'bank'
                    ? 'Upload your bank transfer screenshot and enter the reference number below.'
                    : 'Return here after completing payment in PayMongo and upload your proof.'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={labelStyle}>Transaction Reference No. *</label>
                    <input value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} placeholder={selectedMethod === 'bank' ? 'Enter reference number from receipt' : 'Auto-filled from PayMongo'} style={inputStyle} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>First Name *</label>
                      <input
                        value={firstName}
                        onChange={e => { setFirstName(e.target.value); setNameErrors(prev => ({ ...prev, first: undefined })); }}
                        placeholder="e.g. Maria"
                        style={{ ...inputStyle, borderColor: nameErrors.first ? '#EF4444' : '#E2E8F0' }}
                      />
                      {nameErrors.first && <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#EF4444' }}>{nameErrors.first}</p>}
                    </div>
                    <div>
                      <label style={labelStyle}>Last Name *</label>
                      <input
                        value={lastName}
                        onChange={e => { setLastName(e.target.value); setNameErrors(prev => ({ ...prev, last: undefined })); }}
                        placeholder="e.g. Dela Cruz"
                        style={{ ...inputStyle, borderColor: nameErrors.last ? '#EF4444' : '#E2E8F0' }}
                      />
                      {nameErrors.last && <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#EF4444' }}>{nameErrors.last}</p>}
                    </div>
                  </div>
                  <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 12px' }}>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#4338CA', fontWeight: 600 }}>
                      <i className={selectedMethod === 'bank' ? "ti ti-user" : "ti ti-brand-paymongo"} style={{ marginRight: 5 }} />
                      {selectedMethod === 'bank' ? 'Payer Full Name: ' : 'PayMongo Full Name: '}
                      <strong>{[firstName, lastName].filter(Boolean).join(' ') || '—'}</strong>
                    </p>
                  </div>
                  <div>
                    <label style={labelStyle}>Your Email *</label>
                    <input type="email" value={clientEmail} onChange={e => { setClientEmail(e.target.value); setNameErrors(prev => ({ ...prev, email: undefined })); }} placeholder="email@example.com" style={{ ...inputStyle, borderColor: nameErrors.email ? '#EF4444' : '#E2E8F0' }} />
                    {nameErrors.email && <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#EF4444' }}>{nameErrors.email}</p>}
                  </div>
                  <div style={{ opacity: !referenceNumber ? 0.5 : 1, pointerEvents: !referenceNumber ? 'none' : 'auto', transition: 'all 0.2s' }}>
                    <label style={labelStyle}>
                      Proof of Payment *
                      {!referenceNumber && <span style={{ color: '#EF4444', fontSize: '0.75rem', fontWeight: 400, marginLeft: 8 }}>(Enter Reference No. first)</span>}
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px', borderRadius: 10, border: `2px dashed ${proofFile ? '#10B981' : '#E2E8F0'}`, background: proofFile ? '#F0FDF4' : '#F8FAFC', cursor: !referenceNumber ? 'not-allowed' : 'pointer' }}>
                      <i className={`ti ${proofFile ? 'ti-circle-check' : 'ti-cloud-upload'}`} style={{ fontSize: 30, color: proofFile ? '#10B981' : '#94A3B8' }} />
                      <span style={{ fontSize: '0.82rem', color: proofFile ? '#065F46' : '#94A3B8', fontWeight: 600 }}>{proofFile ? proofFile.name : 'Click to upload (JPG, PNG, PDF)'}</span>
                      <input type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display: "none" }} disabled={!referenceNumber} onChange={e => setProofFile(e.target.files?.[0] ?? null)} />
                    </label>
                    {proofFile && proofFile.type.startsWith('image/') && <img src={URL.createObjectURL(proofFile)} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, marginTop: 14, alignSelf: 'center' }} />}
                  </div>
                </div>
                <button onClick={handleSubmit} disabled={!referenceNumber || !proofFile || !clientEmail || !firstName || !lastName}
                  style={{ ...btnPrimary, marginTop: 24, width: '100%', background: (referenceNumber && proofFile && clientEmail && firstName && lastName) ? 'linear-gradient(135deg,#10B981,#059669)' : '#E2E8F0', color: (referenceNumber && proofFile && clientEmail && firstName && lastName) ? '#fff' : '#94A3B8', cursor: (referenceNumber && proofFile && clientEmail && firstName && lastName) ? 'pointer' : 'not-allowed' }}>
                  Submit for Finance Validation ✓
                </button>
              </Card>
            )}

            {/* ════ SUBMITTED ════ */}
            {step === 'submitted' && (
              <Card>
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                  <div style={{ width: 68, height: 68, borderRadius: '50%', background: existingSubmission?.status === 'Rejected' ? '#FEF2F2' : '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
                    <i className={`ti ${existingSubmission?.status === 'Rejected' ? 'ti-circle-x' : 'ti-circle-check'}`} style={{ fontSize: 36, color: existingSubmission?.status === 'Rejected' ? '#EF4444' : '#10B981' }} />
                  </div>
                  <h2 style={{ margin: '0 0 8px', fontSize: '1.25rem', fontWeight: 800, color: '#0F172A' }}>
                    {existingSubmission?.status === 'Rejected' ? 'Payment Rejected' : 'Payment Submitted!'}
                  </h2>
                  <p style={{ margin: '0 0 24px', color: '#64748B', fontSize: '0.875rem', lineHeight: 1.6 }}>
                    {existingSubmission?.status === 'Rejected'
                      ? 'Your proof was rejected. Please check your email and resubmit.'
                      : 'Your submission is pending Finance validation. A confirmation email has been sent.'}
                  </p>
                  <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '14px 18px', marginBottom: 20, textAlign: 'left', border: '1px solid #E2E8F0' }}>
                    {[
                      { label: 'Invoice', value: foundInvoice?.invoiceNumber ?? '—' },
                      { label: 'Amount', value: foundInvoice ? formatCurrency(foundInvoice.totalAmount) : '—' },
                      { label: 'Reference No.', value: existingSubmission?.referenceNumber ?? referenceNumber },
                      { label: 'Status', value: existingSubmission?.status ?? 'Pending Validation' },
                    ].map(r => (
                      <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #F1F5F9' }}>
                        <span style={{ fontSize: '0.85rem', color: '#64748B' }}>{r.label}</span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0F172A' }}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { setStep('dashboard'); setFoundInvoice(null); setReferenceNumber(''); setProofFile(null); setSelectedMethod(''); setExistingSubmission(null); }}
                    style={{ width: '100%', padding: '12px', borderRadius: 10, background: '#F1F5F9', color: '#0F172A', border: '1px solid #E2E8F0', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}>
                    ← Back to Dashboard
                  </button>
                </div>
              </Card>
            )}

          </div>
        </main>
      </div>

      {/* ════ EMAIL MODAL ════ */}
      {showEmailModal && createPortal(
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: 20 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 500, borderRadius: 16, overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ background: '#F8FAFC', padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className="ti ti-mail-check" style={{ color: '#10B981', fontSize: 20 }} />
                <span style={{ fontWeight: 700, color: '#0F172A', fontSize: '0.9rem' }}>Email Confirmation</span>
              </div>
              <button onClick={() => setShowEmailModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 20 }}><i className="ti ti-x" /></button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <p style={{ margin: '0 0 3px', fontSize: '0.82rem', color: '#64748B' }}>To: <strong style={{ color: '#0F172A' }}>{clientEmail}</strong></p>
              <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: '#64748B' }}>Subject: <strong style={{ color: '#0F172A' }}>Payment Received (Pending Validation) – {foundInvoice?.invoiceNumber}</strong></p>
              <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '18px 20px' }}>
                <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: '#0F172A' }}>Hi <strong>{loggedInClient?.contactPerson}</strong>,</p>
                <p style={{ fontSize: '0.875rem', color: '#475569', lineHeight: 1.7, margin: '0 0 16px' }}>
                  We've received your proof of payment for invoice <strong>{foundInvoice?.invoiceNumber}</strong>. It is currently being reviewed by the Finance Team.
                </p>
                <div style={{ background: '#F8FAFC', padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: '0.85rem', lineHeight: 1.8 }}>
                  <div><span style={{ color: '#64748B' }}>Amount: </span><strong>{foundInvoice ? formatCurrency(foundInvoice.totalAmount) : '—'}</strong></div>
                  <div><span style={{ color: '#64748B' }}>Reference: </span><strong>{referenceNumber}</strong></div>
                  <div><span style={{ color: '#64748B' }}>Status: </span><strong style={{ color: '#F59E0B' }}>Pending Validation</strong></div>
                </div>
                <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0 }}>We'll notify you once the payment is validated. Thank you!</p>
              </div>
            </div>
            <div style={{ padding: '14px 24px', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowEmailModal(false)} style={{ ...btnPrimary }}>Close</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

const labelStyle: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '12px 14px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: '0.9rem', boxSizing: 'border-box', outline: 'none' };
const btnPrimary: React.CSSProperties = { padding: '13px 24px', borderRadius: 10, background: 'linear-gradient(135deg,#0F172A,#1E3A5F)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' };
const btnPrimarySmall: React.CSSProperties = { background: '#0F172A', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' };
const thStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '12px 12px', color: '#475569', verticalAlign: 'middle' };
const badgeBase: React.CSSProperties = { padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' };
const emptyState: React.CSSProperties = { textAlign: 'center', padding: '40px 20px', background: '#F8FAFC', borderRadius: 12 };

export default SpeedPay;
