import type { ReactNode } from 'react';
import { cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InvitationBanner } from '../components/InvitationBanner.js';
import { VerificationBanner } from '../components/VerificationBanner.js';
import { THEME_POLICY_STORAGE_KEY } from '../lib/theme.js';
import { brandSettings } from '../test/branding-settings-fixtures.js';
import { renderWorkspace } from '../test/render-workspace.js';
import { DashboardPage } from './DashboardPage.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
    select({ pathname: '/app' }),
  useRouter: () => ({ invalidate: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
  localStorage.removeItem(THEME_POLICY_STORAGE_KEY);
});

it('shows the current dashboard profile, verification warning and agent invitation independently', async () => {
  const accountId = 'customer';
  const profileId = 'current-profile';
  const responses: Record<string, unknown> = {
    '/api/public/branding/config': brandSettings,
    '/api/user/settings/timezone': { timezone: 'Asia/Tehran' },
    '/api/dashboard/context': {
      profile: { id: profileId, name: 'Current customer' },
      access: { wallet: false, invoices: false, orders: false, contracts: false },
    },
    [`/api/dashboard/widgets/status?profileId=${profileId}`]: {
      profileId,
      data: { activeContracts: 0, pendingOrders: 0, openTickets: 0, unpaidInvoices: 0 },
    },
    '/api/profiles/verification-status': {
      activeProfileId: profileId,
      profileStatus: 'ACTIVE',
      isVerified: false,
      verificationRequired: true,
      verificationMethod: 'manual',
      canAutoVerify: false,
    },
    '/api/invitations/pending': {
      invitations: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          profileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          profileName: 'Inviting company',
          role: 'Finance',
          invitedBy: 'private-staff-identifier',
          inviterName: 'Finance owner',
          createdAt: '2026-09-01T00:00:00Z',
          expiresAt: null,
          message: 'Review the finance workspace invitation',
        },
      ],
    },
  };
  const fetcher = vi.fn(async (path: string) =>
    Object.hasOwn(responses, path)
      ? Response.json(responses[path])
      : Response.json({}, { status: 404 })
  );
  vi.stubGlobal('fetch', fetcher);
  document.documentElement.lang = 'en';
  const host = document.createElement('div');
  document.body.append(host);
  const view = renderWorkspace(
    <>
      <VerificationBanner accountId={accountId} />
      <InvitationBanner locale="en" />
      <DashboardPage />
    </>,
    host,
    accountId
  );

  const heading = await view.findByRole('heading', { name: 'Welcome, Current customer' });
  const warning = (await view.findByText('Your profile is not verified')).closest<HTMLElement>(
    '[role="alert"]'
  );
  expect(warning).not.toBeNull();
  const invitationRegion = within(await view.findByRole('region', { name: 'Company invitations' }));
  const invitationText = 'Inviting company has invited you as Finance';
  const invite = await invitationRegion.findByText(invitationText);
  expect(invitationRegion.getByText('By: Finance owner')).toBeDefined();
  expect(invitationRegion.getByRole('button', { name: 'Accept' })).toBeDefined();
  expect(invitationRegion.queryByText('private-staff-identifier')).toBeNull();

  fireEvent.click(within(warning!).getByRole('button', { name: 'Dismiss' }));
  expect(view.queryByText('Your profile is not verified')).toBeNull();
  expect(view.getByRole('heading', { name: 'Welcome, Current customer' })).toBe(heading);
  expect(invitationRegion.getByText(invitationText)).toBe(invite);
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(
    expect.arrayContaining([
      '/api/dashboard/context',
      '/api/profiles/verification-status',
      '/api/invitations/pending',
    ])
  );
  expect(fetcher.mock.calls.every(([path]) => Object.hasOwn(responses, path))).toBe(true);
});
