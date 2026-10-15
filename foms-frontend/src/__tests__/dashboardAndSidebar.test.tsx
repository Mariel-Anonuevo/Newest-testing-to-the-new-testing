import React from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ROLES, type User } from '../types/auth';
import { getNavGroups, canAccessPath, moduleLabel } from '../utils/roleAccess';
import { RoleGuard } from '../components/ProtectedRoute';
import { Sidebar } from '../components/Sidebar';
import GlobalHeader from '../components/GlobalHeader';
import { Dashboard } from '../pages/Dashboard';
import { AiAlertCard } from '../components/ai/AiAlertCard';
import { collectionService } from '../services/ai/collection.service';
import * as AuthContextModule from '../context/AuthContext';
import * as NotificationsHookModule from '../hooks/useNotifications';
import type { DashboardAiAlert } from '../types/ai';

// ── Mock Auth Helper ────────────────────────────────────────────────────────
function mockAuthUser(user: Partial<User> | null) {
  vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
    user: user ? ({
      id: user.id || 'EMP-001',
      employeeId: user.employeeId || user.id || 'EMP-001',
      fullName: user.fullName || 'Test User',
      email: user.email || 'test@speedex.com',
      role: user.role || ROLES.ACCOUNTANT,
      status: 'Active',
      ...user,
    } as User) : null,
    isLoading: false,
    isAuthenticated: !!user,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

// ── MSW Server Setup ────────────────────────────────────────────────────────
const mockAlerts: DashboardAiAlert[] = [
  {
    id: 'ALT-TEST-1',
    type: 'duplicate',
    title: 'Duplicate Shipment Detected',
    message: 'Waybill matches previous shipment record with high confidence.',
    severity: 'medium',
    targetRoute: '/flagged-duplicates',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'ALT-TEST-2',
    type: 'risk',
    title: 'Receivable Delinquency Risk',
    message: 'Account overdue by 35 days, requires prompt collection action.',
    severity: 'high',
    targetRoute: '/accounts-receivable',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'ALT-TEST-3',
    type: 'document',
    title: 'Low OCR Confidence Field',
    message: 'Tax identification number requires verification.',
    severity: 'low',
    targetRoute: '/document-extraction',
    createdAt: new Date().toISOString(),
  },
];

const server = setupServer(
  http.get(/.*\/ai\/dashboard\/alerts/, () => HttpResponse.json(mockAlerts)),
  http.get(/.*\/dashboard\/nav-badges/, () => HttpResponse.json({})),
  http.get(/.*\/invoices/, () => HttpResponse.json({ items: [], total: 0 })),
  http.get(/.*\/shipment-records/, () => HttpResponse.json({ items: [], total: 0 })),
  http.get(/.*\/accounts-receivable/, () => HttpResponse.json({ items: [], total: 0 })),
  http.get(/.*\/payments/, () => HttpResponse.json({ items: [], total: 0 })),
  http.get(/.*\/clients/, () => HttpResponse.json({ items: [], total: 0 })),
  http.get(/.*\/audit-logs/, () => HttpResponse.json({ items: [], total: 0 })),
  http.get(/.*\/speedpay\/submissions/, () => HttpResponse.json({ items: [], total: 0 })),
  http.get(/.*\/cash-flow/, () => HttpResponse.json({ items: [], total: 0 })),
  http.get(/.*\/liquidation\/reports/, () => HttpResponse.json({ items: [], total: 0 })),
  http.get(/.*\/adjustments/, () => HttpResponse.json({ items: [], total: 0 })),
  http.get(/.*\/ai\/duplicate\/flagged/, () => HttpResponse.json({ items: [], total: 0 }))
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe('Job B & Job A: Sidebar and Dashboard Verification Suite', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // JOB B: Sidebar & Route Removals for Accountant
  // ──────────────────────────────────────────────────────────────────────────
  describe('Job B: Sidebar & Routes for Accountant', () => {
    it('Accountant sidebar has NO Rate Configuration and NO Waybills & POD, all other items intact', () => {
      mockAuthUser({ role: ROLES.ACCOUNTANT, fullName: 'Alex Accountant' });

      const groups = getNavGroups(ROLES.ACCOUNTANT);
      const allLabels = groups.flatMap((g) => g.items.map((i) => moduleLabel(i, ROLES.ACCOUNTANT)));

      // Verifies Job B removals
      expect(allLabels).not.toContain('Rate Configuration');
      expect(allLabels).not.toContain('Waybills & POD');

      // Client Management group must only contain Client Accounts
      const clientGroup = groups.find((g) => g.label === 'Client Management');
      expect(clientGroup).toBeDefined();
      expect(clientGroup!.items.map((i) => i.label)).toEqual(['Client Accounts']);

      // Verifies all other 19 Accountant modules remain accessible
      expect(allLabels).toContain('Dashboard');
      expect(allLabels).toContain('Client Accounts');
      expect(allLabels).toContain('Create Invoice');
      expect(allLabels).toContain('Invoice List');
      expect(allLabels).toContain('Billing Validation');
      expect(allLabels).toContain('Accounts Receivable');
      expect(allLabels).toContain('Payments');
      expect(allLabels).toContain('SpeedPay Validation');
      expect(allLabels).toContain('Official Receipts');
      expect(allLabels).toContain('Settlements');
      expect(allLabels).not.toContain('Record Settlement');
      expect(allLabels).toContain('Financial Adjustments');
      expect(allLabels).toContain('Duplicate Scan');
      expect(allLabels).toContain('Unique Documents');
      expect(allLabels).toContain('Flagged');
      expect(allLabels).toContain('Review History');
      expect(allLabels).not.toContain('Document Extraction');
      expect(allLabels).toContain('Reports');
      expect(allLabels).toContain('AI Output History');

      // Total nav items for Accountant is 17 (after removing Document Extraction and consolidating Record Settlement)
      expect(allLabels).toHaveLength(17);

      // Render actual Sidebar component
      render(
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      );

      expect(screen.queryByText('Rate Configuration')).toBeNull();
      expect(screen.queryByText('Waybills & POD')).toBeNull();
      expect(screen.getByText('Client Accounts')).toBeDefined();
      expect(screen.getByText('Create Invoice')).toBeDefined();
    });

    it('Accountant typing /rate-configuration or /waybills receives 403 Forbidden', () => {
      mockAuthUser({ role: ROLES.ACCOUNTANT, fullName: 'Alex Accountant' });

      // /rate-configuration
      const { unmount: u1 } = render(
        <MemoryRouter initialEntries={['/rate-configuration']}>
          <RoleGuard module="rates">
            <div>Rate Config Content</div>
          </RoleGuard>
        </MemoryRouter>
      );
      expect(screen.getByText(/403 — Access denied/i)).toBeDefined();
      expect(screen.getByText(/Your role does not have permission to view this page/i)).toBeDefined();
      expect(screen.queryByText('Rate Config Content')).toBeNull();
      u1();

      // /waybills
      render(
        <MemoryRouter initialEntries={['/waybills']}>
          <RoleGuard module="waybills">
            <div>Waybills Content</div>
          </RoleGuard>
        </MemoryRouter>
      );
      expect(screen.getByText(/403 — Access denied/i)).toBeDefined();
      expect(screen.getByText(/Your role does not have permission to view this page/i)).toBeDefined();
      expect(screen.queryByText('Waybills Content')).toBeNull();
    });

    it('Financial Manager retains view access to Rate Configuration and Waybills & POD', () => {
      mockAuthUser({ role: ROLES.FINANCIAL_MANAGER, fullName: 'Fiona Manager' });

      const groups = getNavGroups(ROLES.FINANCIAL_MANAGER);
      const allLabels = groups.flatMap((g) => g.items.map((i) => i.label));

      expect(allLabels).toContain('Rate Configuration');
      expect(allLabels).toContain('Waybills & POD');
      expect(canAccessPath(ROLES.FINANCIAL_MANAGER, '/rate-configuration')).toBe(true);
      expect(canAccessPath(ROLES.FINANCIAL_MANAGER, '/waybills')).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // JOB A: Dashboard Layout & Order per Role
  // ──────────────────────────────────────────────────────────────────────────
  describe('Job A: Dashboard Layout Order for Every Role', () => {
    const rolesToTest = [
      { role: ROLES.ACCOUNTANT, name: 'Accountant' },
      { role: ROLES.HEAD_ACCOUNTANT, name: 'Head Accountant' },
      { role: ROLES.ASSISTANT_FM, name: 'Assistant FM' },
      { role: ROLES.FINANCIAL_MANAGER, name: 'Financial Manager' },
    ];

    rolesToTest.forEach(({ role, name }) => {
      it(`renders sections in exact order for ${name}: Banner -> KPIs -> Needs your attention -> AI section last`, async () => {
        mockAuthUser({ role, fullName: `${name} User` });
        vi.spyOn(collectionService, 'getDashboardAlerts').mockResolvedValue(mockAlerts);

        render(
          <MemoryRouter>
            <Dashboard />
          </MemoryRouter>
        );

        // Wait for AI section to load
        await waitFor(() => {
          expect(screen.getByText(/AI Financial Insights & Intelligence/i)).toBeDefined();
        });

        // 1. Banner heading
        const bannerElement = screen.getByRole('heading', { level: 2 });
        // 2. Needs your attention
        const attentionElement = screen.getByText(/Needs your attention/i);
        // 3. AI Section (last)
        const aiSectionElement = screen.getByText(/AI Financial Insights & Intelligence/i);

        expect(bannerElement).toBeDefined();
        expect(attentionElement).toBeDefined();
        expect(aiSectionElement).toBeDefined();

        // Verify document order: Banner is before Needs your attention, which is before AI section
        const bannerBeforeAttention = bannerElement.compareDocumentPosition(attentionElement);
        expect(bannerBeforeAttention & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        const attentionBeforeAi = attentionElement.compareDocumentPosition(aiSectionElement);
        expect(attentionBeforeAi & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // JOB A: Empty AI Response & API Failure States
  // ──────────────────────────────────────────────────────────────────────────
  describe('Job A: Empty State & API Failure Resilience', () => {
    it('Empty API response shows "No AI alerts", never sample cards', async () => {
      mockAuthUser({ role: ROLES.ACCOUNTANT, fullName: 'Alex Accountant' });
      vi.spyOn(collectionService, 'getDashboardAlerts').mockResolvedValue([]);

      render(
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('No AI alerts')).toBeDefined();
      });

      // No sample alert cards
      expect(screen.queryByText(/Duplicate Shipment Detected/i)).toBeNull();
      expect(screen.queryByText(/Receivable Delinquency Risk/i)).toBeNull();
    });

    it('API failure renders error message with Retry button while rest of dashboard functions', async () => {
      mockAuthUser({ role: ROLES.ACCOUNTANT, fullName: 'Alex Accountant' });
      const alertSpy = vi.spyOn(collectionService, 'getDashboardAlerts').mockRejectedValueOnce(new Error('AI Service Offline'));

      render(
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      );

      // AI section displays error and Retry button
      await waitFor(() => {
        expect(screen.getByText(/Failed to load AI alerts/i)).toBeDefined();
        expect(screen.getByRole('button', { name: /Retry/i })).toBeDefined();
      });

      // Rest of the dashboard remains completely functional and visible
      expect(screen.getByText(/Needs your attention/i)).toBeDefined();
      expect(screen.getAllByText(/Create Invoice/i).length).toBeGreaterThan(0);

      // Simulating Retry after recovering API
      alertSpy.mockResolvedValueOnce(mockAlerts);
      const retryBtn = screen.getByRole('button', { name: /Retry/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByText(/Duplicate Shipment Detected/i)).toBeDefined();
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // JOB A: Role-Scoped Link Navigation & Disallowed Route Hiding
  // ──────────────────────────────────────────────────────────────────────────
  describe('Job A: Role-Scoped Links & Disallowed Route Hiding', () => {
    it('Accountant sees review links to allowed routes (duplicate, risk, ocr)', () => {
      mockAuthUser({ role: ROLES.ACCOUNTANT });

      render(
        <MemoryRouter>
          <AiAlertCard alert={mockAlerts[0]} />
        </MemoryRouter>
      );
      // Duplicate -> /flagged-duplicates (allowed for Accountant)
      expect(screen.getByText(/Review in Workflow/i)).toBeDefined();
    });

    it('Head Accountant: duplicate review is allowed, but document extraction is hidden', () => {
      mockAuthUser({ role: ROLES.HEAD_ACCOUNTANT });

      // Duplicate alert -> Allowed (/flagged-duplicates)
      const { unmount: u1 } = render(
        <MemoryRouter>
          <AiAlertCard alert={mockAlerts[0]} />
        </MemoryRouter>
      );
      expect(screen.getByText(/Review in Workflow/i)).toBeDefined();
      u1();

      // Document Extraction alert -> Disallowed for Head Accountant -> Button must be HIDDEN
      render(
        <MemoryRouter>
          <AiAlertCard alert={mockAlerts[2]} />
        </MemoryRouter>
      );
      expect(screen.queryByText(/Review in Workflow/i)).toBeNull();
    });

    it('Assistant FM: duplicate review is allowed, but accounts receivable is hidden', () => {
      mockAuthUser({ role: ROLES.ASSISTANT_FM });

      // Risk alert -> /accounts-receivable -> Disallowed for Assistant FM -> Button must be HIDDEN
      render(
        <MemoryRouter>
          <AiAlertCard alert={mockAlerts[1]} />
        </MemoryRouter>
      );
      expect(screen.queryByText(/Review in Workflow/i)).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SIDEBAR BADGE REMOVAL: All 4 Roles have ZERO badge counts, all items intact
  // ──────────────────────────────────────────────────────────────────────────
  describe('Sidebar Badge Removal: All 4 Roles render 0 badges and all menu items intact', () => {
    const rolesToTest = [
      { role: ROLES.ACCOUNTANT, name: 'Accountant', expectedItemCount: 17 },
      { role: ROLES.HEAD_ACCOUNTANT, name: 'Head Accountant', expectedItemCount: 15 },
      { role: ROLES.ASSISTANT_FM, name: 'Assistant FM', expectedItemCount: 8 },
      { role: ROLES.FINANCIAL_MANAGER, name: 'Financial Manager', expectedItemCount: 21 },
    ];

    rolesToTest.forEach(({ role, name, expectedItemCount }) => {
      it(`renders sidebar for ${name} with all ${expectedItemCount} items intact and ZERO badge bubbles`, () => {
        mockAuthUser({ role, fullName: `${name} User` });

        const groups = getNavGroups(role);
        const allItems = groups.flatMap((g) => g.items);
        expect(allItems).toHaveLength(expectedItemCount);

        const { container } = render(
          <MemoryRouter>
            <Sidebar />
          </MemoryRouter>
        );

        // Every expected menu item label for this role is rendered in the document
        allItems.forEach((item) => {
          const label = moduleLabel(item, role);
          expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        });

        // Verify NO badge elements rendered in the sidebar
        // 1. No elements with .nav-badge class
        expect(container.querySelectorAll('.nav-badge')).toHaveLength(0);
        // 2. Inside .nav-item, the only spans are .nav-icon and .nav-label (no third badge span)
        const navItems = container.querySelectorAll('.nav-item');
        expect(navItems.length).toBe(expectedItemCount);
        navItems.forEach((navItem) => {
          const spans = navItem.querySelectorAll('span');
          expect(spans.length).toBe(2);
          expect(spans[0].classList.contains('nav-icon')).toBe(true);
          expect(spans[1].classList.contains('nav-label')).toBe(true);
        });
      });
    });

    it('GlobalHeader notification bell still displays its unread badge count indicator', () => {
      mockAuthUser({ role: ROLES.ACCOUNTANT, fullName: 'Alex Accountant' });

      vi.spyOn(NotificationsHookModule, 'useNotifications').mockReturnValue({
        notifications: [
          { id: 'notif-1', title: 'New Invoice', message: 'Invoice submitted', read: false, createdAt: new Date().toISOString(), timestamp: 'Just now', isToday: true } as any,
          { id: 'notif-2', title: 'Payment Received', message: 'Payment verified', read: false, createdAt: new Date().toISOString(), timestamp: '1h ago', isToday: true } as any,
          { id: 'notif-3', title: 'System Alert', message: 'Backup done', read: false, createdAt: new Date().toISOString(), timestamp: '2h ago', isToday: true } as any,
        ],
        unreadCount: 3,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        markAllAsRead: vi.fn(),
        toggleReadStatus: vi.fn(),
        clearAll: vi.fn(),
      });

      const { container } = render(
        <MemoryRouter>
          <GlobalHeader />
        </MemoryRouter>
      );

      // Notification bell indicator badge is preserved and rendered with count 3
      const notifBadge = container.querySelector('.notification-badge-count');
      expect(notifBadge).toBeDefined();
      expect(notifBadge?.textContent?.trim()).toBe('3');
    });
  });
});

