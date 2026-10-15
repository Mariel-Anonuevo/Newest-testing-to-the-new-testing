/**
 * roleAccess — the ONE source of truth for: role -> modules -> routes -> actions.
 * Sidebar, route guards, header title and action buttons all read from here.
 */
import { matchPath } from 'react-router-dom';
import { ROLES, type Role } from '../types/auth';

export type Action = 'view' | 'create' | 'edit' | 'submit' | 'verify' | 'return' | 'approve' | 'reject' | 'export' | 'scan';

export type ModuleKey =
  | 'dashboard' | 'clients' | 'rates' | 'waybills' | 'billingValidation' | 'invoiceCreate'
  | 'invoicingDesk' | 'invoiceReview' | 'accountsReceivable' | 'payments' | 'receipts'
  | 'settlements' | 'recordSettlement' | 'speedpayValidation' | 'adjustments' | 'liquidations'
  | 'cashFlow' | 'duplicateScan' | 'uniqueDocuments' | 'flaggedDuplicates' | 'reviewHistory'
  | 'forReview' | 'reports' | 'auditLogs' | 'profile' | 'notifications'
  | 'documentExtraction' | 'aiHistory';

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  /** Role-specific label overrides. */
  labelByRole?: Partial<Record<Role, string>>;
  group: string;
  icon: string;
  path: string;
  /** Extra route patterns served by the same page (e.g. /clients/:id). */
  detailPath?: string;
  /** false = routable but not listed in the sidebar (profile, notifications). */
  nav: boolean;
  /** role -> actions allowed. A role absent from this map cannot see or open the module. */
  roles: Partial<Record<Role, readonly Action[]>>;
}

const { FINANCIAL_MANAGER: FM, HEAD_ACCOUNTANT: HA, ACCOUNTANT: ACC, ASSISTANT_FM: AFM } = ROLES;
const ALL_ROLES = [FM, HA, ACC, AFM] as const;
const everyone = (actions: readonly Action[]): ModuleDef['roles'] =>
  Object.fromEntries(ALL_ROLES.map((r) => [r, actions]));

export const MODULES: readonly ModuleDef[] = [
  { key: 'dashboard', label: 'Dashboard', labelByRole: { [FM]: 'Executive Dashboard' }, group: 'Overview', icon: 'ti ti-layout-dashboard', path: '/dashboard', nav: true, roles: everyone(['view']) },

  { key: 'clients', label: 'Client Accounts', group: 'Client Management', icon: 'ti ti-users', path: '/clients', detailPath: '/clients/:id', nav: true, roles: { [ACC]: ['view', 'create', 'edit'], [FM]: ['view'] } },
  { key: 'rates', label: 'Rate Configuration', group: 'Client Management', icon: 'ti ti-adjustments-dollar', path: '/rate-configuration', detailPath: '/rate-configuration/:id', nav: true, roles: { [FM]: ['view'] } },
  { key: 'waybills', label: 'Waybills & POD', group: 'Client Management', icon: 'ti ti-truck-delivery', path: '/waybills', detailPath: '/waybills/:id', nav: true, roles: { [FM]: ['view'] } },

  { key: 'invoiceCreate', label: 'Create Invoice', group: 'Invoicing', icon: 'ti ti-file-plus', path: '/invoice-create', nav: true, roles: { [ACC]: ['view', 'create', 'submit'], [FM]: ['view'] } },
  { key: 'invoicingDesk', label: 'Invoice List', group: 'Invoicing', icon: 'ti ti-file-invoice', path: '/invoicing-desk', detailPath: '/invoicing-desk/:id', nav: true, roles: { [ACC]: ['view', 'edit', 'submit'], [HA]: ['view', 'verify', 'return'], [FM]: ['view', 'approve', 'reject'] } },
  { key: 'billingValidation', label: 'Billing Validation', group: 'Invoicing', icon: 'ti ti-file-check', path: '/billing-validation', nav: true, roles: { [ACC]: ['view'], [HA]: ['view', 'verify', 'return'], [FM]: ['view', 'approve', 'reject'] } },
  { key: 'invoiceReview', label: 'Invoice Review', group: 'Invoicing', icon: 'ti ti-file-search', path: '/invoice-review', detailPath: '/invoice-review/:id', nav: true, roles: { [HA]: ['view', 'verify', 'return'], [FM]: ['view', 'approve', 'reject'] } },

  { key: 'accountsReceivable', label: 'Accounts Receivable', group: 'Receivables & Payments', icon: 'ti ti-report-money', path: '/accounts-receivable', detailPath: '/accounts-receivable/:id', nav: true, roles: { [ACC]: ['view', 'create'], [HA]: ['view'], [FM]: ['view'] } },
  { key: 'payments', label: 'Payments', labelByRole: { [HA]: 'Payment Validation' }, group: 'Receivables & Payments', icon: 'ti ti-cash', path: '/payments', detailPath: '/payments/:id', nav: true, roles: { [ACC]: ['view', 'create', 'edit', 'submit'], [HA]: ['view', 'verify', 'return'], [FM]: ['view', 'approve', 'reject'] } },
  { key: 'speedpayValidation', label: 'SpeedPay Validation', group: 'Receivables & Payments', icon: 'ti ti-device-mobile-message', path: '/speedpay-validation', detailPath: '/speedpay-validation/:id', nav: true, roles: { [ACC]: ['view'], [HA]: ['view', 'verify', 'return'], [FM]: ['view', 'approve', 'reject'] } },
  { key: 'receipts', label: 'Official Receipts', group: 'Receivables & Payments', icon: 'ti ti-receipt', path: '/receipts', detailPath: '/receipts/:id', nav: true, roles: { [ACC]: ['view', 'create'], [FM]: ['view'] } },
  { key: 'settlements', label: 'Settlements', labelByRole: { [FM]: 'Settlement Validation' }, group: 'Receivables & Payments', icon: 'ti ti-calculator', path: '/settlements', nav: true, roles: { [ACC]: ['view', 'create'], [HA]: ['view', 'verify', 'return'], [FM]: ['view', 'approve', 'reject'] } },
  { key: 'recordSettlement', label: 'Record Settlement', group: 'Receivables & Payments', icon: 'ti ti-receipt-2', path: '/record-settlement', nav: false, roles: { [ACC]: ['view', 'create', 'submit'], [HA]: ['view'], [FM]: ['view'] } },
  { key: 'adjustments', label: 'Financial Adjustments', labelByRole: { [HA]: 'Adjustment Validation', [FM]: 'Adjustment Approval' }, group: 'Receivables & Payments', icon: 'ti ti-adjustments-alt', path: '/adjustments', nav: true, roles: { [ACC]: ['view', 'create', 'edit', 'submit'], [HA]: ['view', 'verify', 'return'], [FM]: ['view', 'approve', 'reject'] } },

  { key: 'liquidations', label: 'Liquidation Reports', group: 'Liquidation', icon: 'ti ti-cash-banknote', path: '/liquidations', detailPath: '/liquidations/:id', nav: true, roles: { [AFM]: ['view', 'verify', 'return'], [FM]: ['view', 'approve', 'reject'] } },
  { key: 'cashFlow', label: 'Cash Flow', group: 'Treasury', icon: 'ti ti-chart-arrows', path: '/cash-flow', nav: true, roles: { [FM]: ['view', 'create', 'approve', 'reject'] } },

  // ── Duplicate Detection (role table — see DUPLICATE_SECTION below) ──
  //   Duplicate Scan     : ACC, AFM (FM, HA hidden -> 403)
  //   Unique Documents   : FM, HA (all), ACC, AFM (dept only)
  //   Flagged Duplicates : HA "For Review" (Level 2), ACC "Flagged" (Level 1), AFM liquidation Level 1 (FM hidden -> 403)
  //   Review History     : FM, HA (all), ACC, AFM (audit)
  { key: 'duplicateScan', label: 'Duplicate Scan', group: 'Duplicate Detection', icon: 'ti ti-scan', path: '/duplicate-scan', nav: true, roles: { [ACC]: ['view', 'scan'], [AFM]: ['view', 'scan'] } },
  { key: 'uniqueDocuments', label: 'Unique Documents', group: 'Duplicate Detection', icon: 'ti ti-file-check', path: '/unique-documents', nav: true, roles: { [FM]: ['view'], [HA]: ['view'], [ACC]: ['view'], [AFM]: ['view'] } },
  { key: 'flaggedDuplicates', label: 'Flagged Duplicates', labelByRole: { [HA]: 'For Review', [ACC]: 'Flagged' }, group: 'Duplicate Detection', icon: 'ti ti-alert-triangle', path: '/flagged-duplicates', nav: true, roles: { [HA]: ['view', 'approve', 'return'], [ACC]: ['view', 'submit'], [AFM]: ['view', 'submit'] } },
  { key: 'reviewHistory', label: 'Review History', group: 'Duplicate Detection', icon: 'ti ti-history', path: '/review-history', nav: true, roles: { [FM]: ['view', 'export'], [HA]: ['view', 'export'], [ACC]: ['view', 'export'], [AFM]: ['view', 'export'] } },
  { key: 'documentExtraction', label: 'Document Extraction', group: 'Document Intelligence', icon: 'ti ti-file-analytics', path: '/document-extraction', nav: false, roles: { [ACC]: ['view', 'create', 'edit'], [AFM]: ['view', 'create', 'verify'] } },
  { key: 'forReview', label: 'For Review', group: 'Duplicate Detection', icon: 'ti ti-eye-check', path: '/for-review', nav: false, roles: { [HA]: ['view', 'verify', 'return'], [FM]: ['view', 'approve', 'reject'] } },

  { key: 'reports', label: 'Reports', group: 'Analytics & Control', icon: 'ti ti-chart-bar', path: '/reports', detailPath: '/reports/:id', nav: true, roles: { [ACC]: ['view', 'export'], [HA]: ['view', 'export'], [FM]: ['view', 'export'], [AFM]: ['view', 'export'] } },
  { key: 'auditLogs', label: 'Audit Logs', group: 'Analytics & Control', icon: 'ti ti-list-details', path: '/audit-logs', nav: true, roles: { [HA]: ['view'], [FM]: ['view', 'export'] } },
  { key: 'aiHistory', label: 'AI Output History', group: 'Analytics & Control', icon: 'ti ti-cpu', path: '/ai-history', nav: true, roles: { [FM]: ['view', 'export'], [HA]: ['view', 'export'], [ACC]: ['view', 'export'], [AFM]: ['view', 'export'] } },

  { key: 'profile', label: 'My Profile', group: 'Account', icon: 'ti ti-user', path: '/profile', nav: false, roles: everyone(['view']) },
  { key: 'notifications', label: 'Notifications', group: 'Account', icon: 'ti ti-bell', path: '/notifications', nav: false, roles: everyone(['view']) },
];

/** Routes reachable without a session. */
export const PUBLIC_PATHS = ['/login', '/speedpay'] as const;

/** Where each role lands after login (and when a forbidden URL redirects home). */
export const DEFAULT_LANDING_ROUTE = '/dashboard';
export const LANDING_PATH: Record<Role, string> = {
  [FM]: DEFAULT_LANDING_ROUTE,
  [HA]: DEFAULT_LANDING_ROUTE,
  [ACC]: DEFAULT_LANDING_ROUTE,
  [AFM]: DEFAULT_LANDING_ROUTE,
};

export const ROLE_LABELS: Record<Role, string> = {
  [FM]: 'Financial Manager',
  [HA]: 'Head Accountant',
  [ACC]: 'Accountant',
  [AFM]: 'Asst. Financial Manager',
};

/** Maps any backend role spelling to the canonical Role. Returns null when unknown. */
export function normalizeRole(raw: unknown): Role | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (s.includes('assistant') || s === 'assistantfm') return AFM;
  if (s.includes('head')) return HA;
  if (s.includes('accountant')) return ACC;
  if (s.includes('manager') || s === 'fm') return FM;
  return null;
}

const pathsOf = (m: ModuleDef) => (m.detailPath ? [m.path, m.detailPath] : [m.path]);

export function getModule(key: ModuleKey): ModuleDef {
  const m = MODULES.find((x) => x.key === key);
  if (!m) throw new Error(`Unknown module: ${key}`);
  return m;
}

export function getModulesForRole(role: Role | undefined | null): ModuleDef[] {
  return role ? MODULES.filter((m) => m.roles[role]) : [];
}

export function getModuleForPath(pathname: string): ModuleDef | undefined {
  return MODULES.find((m) => pathsOf(m).some((p) => matchPath({ path: p, end: true }, pathname)));
}

export function canAccessPath(role: Role | undefined | null, pathname: string): boolean {
  const m = getModuleForPath(pathname);
  return !!(role && m && m.roles[role]);
}

export function canDo(role: Role | undefined | null, key: ModuleKey, action: Action): boolean {
  return !!role && !!getModule(key).roles[role]?.includes(action);
}

export function moduleLabel(m: ModuleDef, role: Role | undefined | null): string {
  return (role && m.labelByRole?.[role]) || m.label;
}

export interface NavGroup { label: string; items: ModuleDef[] }

/** Sidebar structure for a role: only allowed, nav-visible modules, grouped in declaration order. */
export function getNavGroups(role: Role | undefined | null): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const m of getModulesForRole(role)) {
    if (!m.nav) continue;
    let g = groups.find((x) => x.label === m.group);
    if (!g) { g = { label: m.group, items: [] }; groups.push(g); }
    g.items.push(m);
  }
  return groups;
}

// ─── Duplicate Detection Scoping ───────────────────────────────────────
export const DUPLICATE_GROUP = 'Duplicate Detection';
export const DUPLICATE_SECTION: readonly ModuleKey[] = ['duplicateScan', 'uniqueDocuments', 'flaggedDuplicates', 'reviewHistory'];

/** Sidebar items of the Duplicate Detection section visible to this role (filtered from MODULES). */
export function getDuplicateNavItems(role: Role | undefined | null): { key: ModuleKey; label: string; path: string }[] {
  return getModulesForRole(role)
    .filter((m) => m.nav && DUPLICATE_SECTION.includes(m.key))
    .map((m) => ({ key: m.key, label: moduleLabel(m, role), path: m.path }));
}

export type DuplicateScope = 'all' | 'own' | 'liquidation';

export function getDuplicateScope(role: Role | undefined | null): DuplicateScope {
  if (role === ROLES.FINANCIAL_MANAGER || role === ROLES.HEAD_ACCOUNTANT) return 'all';
  if (role === ROLES.ACCOUNTANT) return 'own';
  if (role === ROLES.ASSISTANT_FM) return 'liquidation';
  return 'own';
}

export type DashboardAiScope = 'own' | 'review' | 'liquidation' | 'all';

/** Role-scoped AI alert scope mapping (Job A). */
export function getDashboardAiScope(role: Role | undefined | null): DashboardAiScope {
  if (role === ROLES.FINANCIAL_MANAGER) return 'all';
  if (role === ROLES.HEAD_ACCOUNTANT) return 'review';
  if (role === ROLES.ACCOUNTANT) return 'own';
  if (role === ROLES.ASSISTANT_FM) return 'liquidation';
  return 'own';
}

export function isLiquidationDoc(docTypeOrName?: string | null): boolean {
  if (!docTypeOrName) return false;
  const s = String(docTypeOrName).toLowerCase();
  return (
    s.includes('liquidation') ||
    s.includes('expense') ||
    s.includes('fuel') ||
    s.includes('toll') ||
    s.includes('parking') ||
    s.includes('reimbursement')
  );
}

export interface SeparationOfDutiesCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Separation of Duties (UI side):
 * - Hide or disable "Resolve", "Confirm" and "Approve" buttons on any record
 *   created by the current user (compare record.createdBy with user.id / user.employeeId).
 *   Reason: "You cannot act on your own record"
 * - Only FM sees "Final resolve", and only on items already VERIFIED.
 * - Accountant cannot confirm/dismiss or resolve alerts.
 */
export function canActOnRecord(
  user: { id?: string; employeeId?: string; role?: Role } | null | undefined,
  record: { createdBy?: string; status?: string; documentType?: string } | null | undefined,
  action: 'confirm' | 'dismiss' | 'resolve' | 'approve'
): SeparationOfDutiesCheck {
  if (!user || !user.role) {
    return { allowed: false, reason: 'Authentication required' };
  }

  // 1. Separation of duties: Creator cannot act on own record
  const currentUserId = user.id || user.employeeId;
  if (record?.createdBy && currentUserId && (record.createdBy === currentUserId || record.createdBy === user.employeeId)) {
    return { allowed: false, reason: 'You cannot act on your own record' };
  }

  // 2. Role-specific rules
  if (user.role === ROLES.ACCOUNTANT) {
    return { allowed: false, reason: 'Accountants can provide remarks only; confirmation and resolution require a supervisor.' };
  }

  if (action === 'resolve') {
    if (user.role !== ROLES.FINANCIAL_MANAGER) {
      return { allowed: false, reason: 'Only the Financial Manager can perform final resolution.' };
    }
    const status = String(record?.status || '').toUpperCase();
    if (status !== 'CONFIRMED_DUPLICATE' && status !== 'VERIFIED' && status !== 'VALIDATED') {
      return { allowed: false, reason: 'Final resolve is only allowed on items already verified.' };
    }
    return { allowed: true };
  }

  if (action === 'confirm' || action === 'dismiss') {
    if (user.role === ROLES.FINANCIAL_MANAGER) {
      return { allowed: false, reason: 'Financial Manager performs final resolution, not initial alert verification.' };
    }
    if (user.role === ROLES.HEAD_ACCOUNTANT) {
      return { allowed: true };
    }
    if (user.role === ROLES.ASSISTANT_FM) {
      if (isLiquidationDoc(record?.documentType)) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Assistant FM is restricted to liquidation and expense documents only.' };
    }
  }

  return { allowed: true };
}

export function canCheckDuplicateInForm(role: Role | undefined | null, docType?: string): boolean {
  if (!role) return false;
  if (role === ROLES.FINANCIAL_MANAGER || role === ROLES.HEAD_ACCOUNTANT) return false;
  if (role === ROLES.ACCOUNTANT) return true;
  if (role === ROLES.ASSISTANT_FM) return isLiquidationDoc(docType);
  return false;
}

export function canViewReceivableRisk(role: Role | undefined | null): boolean {
  return role === ROLES.FINANCIAL_MANAGER || role === ROLES.HEAD_ACCOUNTANT || role === ROLES.ACCOUNTANT;
}

export function canViewCollectionPriority(role: Role | undefined | null): boolean {
  return role === ROLES.FINANCIAL_MANAGER || role === ROLES.HEAD_ACCOUNTANT || role === ROLES.ACCOUNTANT;
}

export function canUploadDocuments(role: Role | undefined | null, docType?: string): boolean {
  if (!role) return false;
  if (role === ROLES.ACCOUNTANT) return true;
  if (role === ROLES.ASSISTANT_FM) return !docType || isLiquidationDoc(docType);
  return false;
}

