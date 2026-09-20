import { ManualInvoiceForm } from '../components/ManualInvoicePanel.js';
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminTosPage from './AdminTosPage.js';
import AdminContractTemplatesPage from './AdminContractTemplatesPage.js';
import AdminEmailProvidersPage from './AdminEmailProvidersPage.js';
import AdminBrandingConfig from './AdminBrandingConfig.js';
import AdminStaffTeamsPage from './AdminStaffTeamsPage.js';
import AdminStaffUsersPage from './AdminStaffUsersPage.js';
import AdminCataloguePage from './AdminCataloguePage.js';
import AdminRolesPage from './AdminRolesPage.js';
import AdminGiftCodesPage from './AdminGiftCodesPage.js';
import AdminSmsProvidersPage from './AdminSmsProvidersPage.js';
import AdminFailedJobsPage from './AdminFailedJobsPage.js';
import AdminApprovalRequestsPage from './AdminApprovalRequestsPage.js';
import AdminKnowledgeBasesPage from './AdminKnowledgeBasesPage.js';
import AdminVerificationConfig from './AdminVerificationConfig.js';
import AdminAiModelsPage from './AdminAiModelsPage.js';
import AdminAiAgentsPage from './AdminAiAgentsPage.js';
import AdminGeographyPage from './AdminGeographyPage.js';
import AdminNotificationsPage from './AdminNotificationsPage.js';
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'UTC', retry: () => {} }),
}));
let host: HTMLDivElement;
let root: Root;
let mounted: boolean;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  document.documentElement.lang = 'en';
});
const pages: Array<[string, ComponentType]> = [
  ['AdminTosPage', AdminTosPage],
  ['AdminContractTemplatesPage', AdminContractTemplatesPage],
  ['AdminEmailProvidersPage', AdminEmailProvidersPage],
  ['AdminBrandingConfig', AdminBrandingConfig],
  ['AdminStaffTeamsPage', AdminStaffTeamsPage],
  ['AdminStaffUsersPage', AdminStaffUsersPage],
  ['AdminCataloguePage', AdminCataloguePage],
  ['AdminRolesPage', AdminRolesPage],
  ['AdminGiftCodesPage', AdminGiftCodesPage],
  ['AdminSmsProvidersPage', AdminSmsProvidersPage],
  ['AdminFailedJobsPage', AdminFailedJobsPage],
  ['AdminApprovalRequestsPage', AdminApprovalRequestsPage],
  ['AdminKnowledgeBasesPage', AdminKnowledgeBasesPage],
  ['AdminVerificationConfig', AdminVerificationConfig],
  ['AdminAiModelsPage', AdminAiModelsPage],
  ['AdminAiAgentsPage', AdminAiAgentsPage],
  ['AdminGeographyPage', AdminGeographyPage],
  ['AdminNotificationsPage', AdminNotificationsPage],
];
for (const locale of ['en', 'fa']) {
  for (const failure of [403, 503, 'network'] as const) {
    it.each(pages)(
      `%s makes ${failure} reads visible without sending a mutation (${locale})`,
      async (_name, Page) => {
        document.documentElement.lang = locale;
        const requests = vi.fn(async () => {
          if (failure === 'network') throw new Error('offline');
          return new Response(JSON.stringify({ message: 'Unavailable' }), { status: failure });
        });
        vi.stubGlobal('fetch', requests);
        await act(async () => root.render(<Page />));
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(requests).toHaveBeenCalled();
        const alerts = Array.from(host.querySelectorAll('[role=alert]'));
        expect(alerts.length).toBeGreaterThan(0);
        expect(alerts.some((alert) => Boolean(alert.textContent?.trim()))).toBe(true);
        for (const call of vi.mocked(fetch).mock.calls)
          expect(call[1]?.method ?? 'GET').toBe('GET');
        expect(host.querySelector('[role=dialog]')).toBeNull();
      }
    );
  }
}

const emptyPages = pages.filter(([name]) =>
  [
    'AdminTosPage',
    'AdminContractTemplatesPage',
    'AdminEmailProvidersPage',
    'AdminStaffUsersPage',
    'AdminRolesPage',
    'AdminSmsProvidersPage',
    'AdminFailedJobsPage',
    'AdminApprovalRequestsPage',
    'AdminKnowledgeBasesPage',
    'AdminAiModelsPage',
    'AdminAiAgentsPage',
  ].includes(name)
);
for (const locale of ['en', 'fa']) {
  it.each(emptyPages)(
    '%s renders an empty authorized collection without claiming a saved change (' + locale + ')',
    async (_name, Page) => {
      document.documentElement.lang = locale;
      const requests = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        let body: unknown = [];
        if (url.endsWith('/config/dual-approval-threshold'))
          body = { thresholdIrR: 1000000, version: 0 };
        else if (url.endsWith('/staff-access'))
          body = {
            canView: true,
            canCreate: true,
            canEditRoles: true,
            canDisable: true,
            canViewPermissionHistory: true,
          };
        else if (url.includes('/admin/staff?')) body = { items: [], total: 0 };
        else if (url.endsWith('/failed-jobs/access')) body = { canView: true, canRetry: true };
        else if (url.endsWith('/agents/options'))
          body = { models: [], kbs: [], policies: [], kbGroups: [], policyGroups: [] };
        return new Response(JSON.stringify(body));
      });
      vi.stubGlobal('fetch', requests);
      await act(async () => root.render(<Page />));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(host.querySelector('h1')?.textContent?.trim()).toBeTruthy();
      expect(host.querySelector('[role=alert]')).toBeNull();
      const create = Array.from(host.querySelectorAll('button')).find((button) =>
        /^(Add|Create|New|افزودن|ایجاد)/.test(button.textContent?.trim() ?? '')
      );
      if (create) {
        await act(async () => create.click());
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(host.querySelectorAll('input, textarea').length).toBeGreaterThan(0);
      }
      for (const call of vi.mocked(fetch).mock.calls) expect(call[1]?.method ?? 'GET').toBe('GET');
      expect(host.querySelector('[role=dialog]')).toBeNull();
    }
  );
}

const validTerms = {
  id: 'terms-one',
  versionId: '1',
  contentFa: 'شرایط',
  contentEn: 'Terms',
  status: 'draft',
  changeType: null,
  isActive: false,
  publishedAt: null,
  createdBy: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};
const invalidTerms: Array<[string, unknown]> = [
  ['not an array', {}],
  ['null entry', [null]],
  ['empty entry', [{}]],
  ...Object.entries({
    revision: 'bad',
    id: '',
    versionId: '',
    contentFa: null,
    contentEn: null,
    status: 'unknown',
    changeType: 'unknown',
    isActive: 'yes',
    createdBy: {},
    createdAt: 'invalid',
    updatedAt: null,
    publishedAt: '2026-09-01T00:00:00.000Z',
  }).map(([field, value]): [string, unknown] => [field, [{ ...validTerms, [field]: value }]]),
  ['active draft', [{ ...validTerms, isActive: true }]],
  ['missing publication date', [{ ...validTerms, status: 'published' }]],
  ['duplicate id', [validTerms, validTerms]],
  ['two drafts', [validTerms, { ...validTerms, id: 'terms-two' }]],
  [
    'two active versions',
    [1, 2].map((n) => ({
      ...validTerms,
      id: `terms-${n}`,
      status: 'published',
      isActive: true,
      publishedAt: validTerms.createdAt,
    })),
  ],
];
it.each(invalidTerms)('terms history rejects %s without enabling a write', async (_case, data) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(data)))
  );
  await act(async () => root.render(<AdminTosPage />));
  expect(host.querySelector('[role=alert]')?.textContent?.trim()).toBeTruthy();
  expect(host.querySelector('form')).toBeNull();
  for (const call of vi.mocked(fetch).mock.calls) expect(call[1]?.method ?? 'GET').toBe('GET');
});
it.each([
  validTerms,
  { ...validTerms, revision: 'a'.repeat(64), createdBy: 'operator', changeType: 'major' },
  {
    ...validTerms,
    status: 'published',
    publishedAt: validTerms.createdAt,
    isActive: true,
    changeType: 'minor',
  },
  { ...validTerms, status: 'published', publishedAt: validTerms.createdAt, isActive: false },
])('terms history preserves valid draft and publication states %#', async (version) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([version])))
  );
  await act(async () => root.render(<AdminTosPage />));
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(host.querySelector('tbody')?.textContent).toContain('1');
});

const validRole = {
  roleId: 'reviewer',
  name: 'Review role',
  description: '',
  predefined: true,
  permissions: ['users:read'],
};
it.each(
  [
    null,
    {},
    [null],
    [[]],
    ...Object.entries({
      roleId: ' ',
      name: 5,
      description: null,
      predefined: 'yes',
      permissions: [5],
    }).map(([field, value]) => [{ ...validRole, [field]: value }]),
  ].map((data) => ({ data }))
)('role catalogue rejects malformed authority information %#', async ({ data }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(data)))
  );
  await act(async () => root.render(<AdminRolesPage />));
  expect(host.querySelector('[role=alert]')?.textContent?.trim()).toBeTruthy();
  expect(host.textContent).not.toContain(validRole.name);
});
it.each(
  [[], ['users:read'], ['custom:read', 'users:read', 'users:edit', 'other:read']].map(
    (permissions) => ({ permissions })
  )
)(
  'role catalogue preserves permission grouping and read-only role identity %#',
  async ({ permissions }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([{ ...validRole, permissions }])))
    );
    await act(async () => root.render(<AdminRolesPage />));
    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(host.textContent).toContain(validRole.name);
    for (const permission of permissions) expect(host.textContent).toContain(permission);
  }
);

for (const result of [200, 403, 503, 'network'] as const) {
  it.each(pages)(
    `%s aborts an outstanding ${result} read when navigating away`,
    async (_name, Page) => {
      const finish: Array<() => void> = [];
      const requests = vi.fn(
        (_url: RequestInfo | URL, _init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            finish.push(() =>
              result === 'network'
                ? reject(new Error('offline'))
                : resolve(new Response('[]', { status: result }))
            );
          })
      );
      vi.stubGlobal('fetch', requests);
      await act(async () => root.render(<Page />));
      expect(requests).toHaveBeenCalled();
      await act(async () => root.unmount());
      mounted = false;
      for (const [, init] of requests.mock.calls) {
        if (init?.signal) expect(init.signal.aborted).toBe(true);
        expect(init?.method ?? 'GET').toBe('GET');
      }
      const count = requests.mock.calls.length;
      await act(async () => {
        for (const done of finish) done();
      });
      expect(host.innerHTML).toBe('');
      expect(requests).toHaveBeenCalledTimes(count);
    }
  );
}

async function setInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const effective = {
  userId: 'staff-one',
  isAdmin: false,
  isWildcard: false,
  roleIds: ['reviewer'],
  roleNames: ['Review role'],
  permissions: [{ permission: 'users:read', group: 'users' }],
};
const invalidEffective: unknown[] = [
  null,
  [],
  {},
  ...Object.entries({
    userId: 'other-user',
    isAdmin: 'yes',
    isWildcard: null,
    roleIds: [1],
    roleNames: [1],
    permissions: [null],
  }).map(([key, value]) => ({ ...effective, [key]: value })),
  { ...effective, permissions: [{ permission: 5, group: 'users' }] },
  { ...effective, permissions: [{ permission: 'users:read', group: 5 }] },
];
it.each(invalidEffective.map((data) => ({ data })))(
  'rejects malformed effective permission lookup %#',
  async ({ data }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url) =>
          new Response(JSON.stringify(String(url).endsWith('/roles') ? [validRole] : data))
      )
    );
    await act(async () => root.render(<AdminRolesPage />));
    await setInput(host.querySelector<HTMLInputElement>('#staffUserId')!, 'staff-one');
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(host.querySelectorAll('bdi').length).toBeLessThanOrEqual(1);
  }
);
it.each([404, 503, 'network'] as const)(
  'makes effective permission lookup failure %s visible',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).endsWith('/roles')) return new Response('[]');
        if (status === 'network') throw new Error('offline');
        return new Response('{}', { status });
      })
    );
    await act(async () => root.render(<AdminRolesPage />));
    await setInput(host.querySelector<HTMLInputElement>('#staffUserId')!, 'staff-one');
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(host.querySelector('[role=alert]')?.textContent).toBeTruthy();
  }
);

const template = {
  id: 'template-one',
  name: 'Agreement',
  description: null,
  status: 'inactive',
  versionCount: 0,
};
async function openTemplate() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/template-one') ? { ...template, versions: [] } : [template]
          )
        )
    )
  );
  await act(async () => root.render(<AdminContractTemplatesPage />));
  const open = host.querySelector<HTMLButtonElement>('button[aria-label$="Agreement"]')!;
  await act(async () => open.click());
  expect(host.querySelector('#template-file')).not.toBeNull();
}
async function selectTemplateFile(file?: Partial<File>) {
  const input = host.querySelector<HTMLInputElement>('#template-file')!;
  Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
it.each([
  { name: 'empty', size: 0, type: 'text/plain' },
  { name: 'large', size: 10 * 1024 * 1024 + 1, type: 'text/plain' },
  { name: 'binary', size: 1, type: 'application/pdf' },
  {
    name: 'null-byte',
    size: 2,
    type: 'text/plain',
    arrayBuffer: async () => new Uint8Array([65, 0]).buffer,
  },
  {
    name: 'bad-utf8',
    size: 1,
    type: 'text/plain',
    arrayBuffer: async () => new Uint8Array([255]).buffer,
  },
  {
    name: 'read-error',
    size: 1,
    type: 'text/plain',
    arrayBuffer: async () => {
      throw new Error('unreadable');
    },
  },
  {
    name: 'actual-oversize',
    size: 1,
    type: 'text/plain',
    arrayBuffer: async () => new TextEncoder().encode('x'.repeat(10 * 1024 * 1024 + 1)).buffer,
  },
])('rejects unsafe template file $name before a request', async (file) => {
  await openTemplate();
  await selectTemplateFile(file);
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  const upload = Array.from(host.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('Upload version')
  )!;
  expect(upload.disabled).toBe(true);
  for (const [, init] of vi.mocked(fetch).mock.calls) expect(init?.method ?? 'GET').toBe('GET');
});
it.each(['', 'text/plain'])(
  'accepts valid UTF-8 content with type %s and clears it when selection is cancelled',
  async (type) => {
    await openTemplate();
    await selectTemplateFile({
      name: 'agreement.txt',
      size: 5,
      type,
      arrayBuffer: async () => new TextEncoder().encode('Hello').buffer,
    });
    expect(host.textContent).toContain('agreement.txt');
    expect(host.querySelector('[role=alert]')).toBeNull();
    await selectTemplateFile();
    expect(host.textContent).not.toContain('agreement.txt');
  }
);
it('discards a slow file read after the editor closes', async () => {
  await openTemplate();
  let resolve!: (value: ArrayBuffer) => void;
  await selectTemplateFile({
    name: 'late.txt',
    size: 5,
    type: 'text/plain',
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((done) => {
        resolve = done;
      }),
  });
  const cancel = Array.from(host.querySelectorAll('button')).find(
    (button) => button.textContent === 'Cancel'
  )!;
  await act(async () => cancel.click());
  await act(async () => resolve(new TextEncoder().encode('Hello').buffer));
  expect(host.textContent).not.toContain('late.txt');
  expect(host.querySelector('#template-file')).toBeNull();
});

async function clickText(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === text
  );
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
}
const smtp = {
  id: 'smtp-one',
  label: 'Mail delivery',
  transport: 'smtp',
  status: 'draft',
  lastTestStatus: 'pending',
  maskedConfig: { host: 'smtp.example.com', from_email: 'mail@example.com' },
};
it.each(
  [
    null,
    [],
    { ...smtp.maskedConfig, from_email: 5 },
    { ...smtp.maskedConfig, host: ' ' },
    ...[0, 65536, 1.5, '25'].map((port) => ({ ...smtp.maskedConfig, port })),
    { ...smtp.maskedConfig, connection_timeout: 601 },
    { ...smtp.maskedConfig, command_timeout: 0 },
    { ...smtp.maskedConfig, security: 'NONE' },
  ].map((maskedConfig) => ({ maskedConfig }))
)('rejects unsafe stored SMTP settings %#', async ({ maskedConfig }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([{ ...smtp, maskedConfig }])))
  );
  await act(async () => root.render(<AdminEmailProvidersPage />));
  await clickText('Save');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.querySelector('#email-provider-label')).toBeNull();
  for (const [, init] of vi.mocked(fetch).mock.calls) expect(init?.method ?? 'GET').toBe('GET');
});
it.each(['', 'replacement-secret'])(
  'updates SMTP draft while preserving blank secrets (%s)',
  async (password) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url, init) => new Response(JSON.stringify(init?.method === 'PUT' ? smtp : [smtp]))
      )
    );
    await act(async () => root.render(<AdminEmailProvidersPage />));
    await clickText('Save');
    await setInput(host.querySelector<HTMLInputElement>('#email-provider-label')!, 'Updated mail');
    const passwordInput = host.querySelector<HTMLInputElement>('input[type=password]')!;
    if (password) await setInput(passwordInput, password);
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(request[0]).toBe('/api/admin/email-providers/smtp-one');
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      label: 'Updated mail',
      config: {
        host: 'smtp.example.com',
        port: 587,
        security: 'STARTTLS',
        connection_timeout: 10,
        command_timeout: 15,
        from_email: 'mail@example.com',
        ...(password ? { password } : {}),
      },
    });
    expect(host.querySelector('#email-provider-label')).toBeNull();
    expect(host.querySelector('[role=alert]')).toBeNull();
  }
);
const revisionTerms = { ...validTerms, revision: 'a'.repeat(64) };
it.each(
  [
    { id: 'different' },
    { revision: undefined },
    { versionId: 'other' },
    { contentFa: 'changed' },
    { contentEn: 'changed' },
    { status: 'published', publishedAt: validTerms.createdAt },
  ].map((patch) => ({ patch }))
)('does not accept a mismatched terms save acknowledgement %#', async ({ patch }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url, init) =>
        new Response(
          JSON.stringify(init?.method === 'PUT' ? { ...revisionTerms, ...patch } : [revisionTerms])
        )
    )
  );
  await act(async () => root.render(<AdminTosPage />));
  await clickText('Edit');
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')?.disabled).toBe(true);
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => !init?.method).length).toBe(1);
  const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(String(request[1]?.body)).expectedRevision).toBe(revisionTerms.revision);
});
it.each([204, 409, 503, 'cancel', 'no-revision'] as const)(
  'terms discard handles %s with revision-bound authority',
  async (status) => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(status !== 'cancel');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) =>
        init?.method === 'DELETE'
          ? new Response(null, { status: typeof status === 'number' ? status : 204 })
          : new Response(JSON.stringify([status === 'no-revision' ? validTerms : revisionTerms]))
      )
    );
    try {
      await act(async () => root.render(<AdminTosPage />));
      await clickText('Discard');
      const deletes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'DELETE');
      if (status === 'cancel' || status === 'no-revision') expect(deletes).toHaveLength(0);
      else {
        expect(deletes).toHaveLength(1);
        expect(String(deletes[0]![0])).toContain('expectedRevision=' + revisionTerms.revision);
        if (status !== 204) expect(host.querySelector('[role=alert]')).not.toBeNull();
        else
          expect(vi.mocked(fetch).mock.calls.filter(([, init]) => !init?.method)).toHaveLength(2);
      }
    } finally {
      confirm.mockRestore();
    }
  }
);

const publishedTerms = {
  ...revisionTerms,
  status: 'published',
  isActive: true,
  changeType: 'minor',
  publishedAt: validTerms.createdAt,
};
it.each([
  { name: 'identity', patch: { id: 'other' } },
  { name: 'draft', patch: { status: 'draft', isActive: false, publishedAt: null } },
  { name: 'inactive', patch: { isActive: false } },
  { name: 'change type', patch: { changeType: 'major' } },
  { name: 'version', patch: { versionId: 'other' } },
  { name: 'Persian content', patch: { contentFa: 'changed' } },
  { name: 'English content', patch: { contentEn: 'changed' } },
  { name: 'invalid data', patch: { id: null } },
  { name: 'conflict', status: 409 },
  { name: 'unavailable', status: 503 },
  { name: 'success', success: true },
])('requires a matching terms publication acknowledgement: $name', async (scenario) => {
  await import('./TosPreview.js');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url, init) =>
        new Response(
          JSON.stringify(
            init?.method === 'POST' ? { ...publishedTerms, ...scenario.patch } : [revisionTerms]
          ),
          { status: init?.method === 'POST' ? (scenario.status ?? 200) : 200 }
        )
    )
  );
  await act(async () => root.render(<AdminTosPage />));
  await clickText('Publish');
  const region = host.querySelector('[role=region]')!;
  const publish = Array.from(region.querySelectorAll('button')).find(
    (button) => button.textContent === 'Publish'
  )!;
  expect(publish.disabled).toBe(false);
  await act(async () => publish.click());
  const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(String(request[1]?.body))).toEqual({
    changeType: 'minor',
    expectedRevision: revisionTerms.revision,
  });
  if (scenario.success) {
    expect(host.querySelector('[role=region]')).toBeNull();
    expect(host.querySelector('[role=alert]')).toBeNull();
  } else {
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(host.querySelector('[role=region]')).not.toBeNull();
    if (scenario.status !== 503) expect(publish.disabled).toBe(true);
  }
});
it.each([200, 409, 503, 'network'] as const)(
  'terms draft save handles %s without losing its text',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        if (init?.method === 'PUT') {
          if (status === 'network') throw new Error('offline');
          return new Response(JSON.stringify(revisionTerms), { status });
        }
        return new Response(JSON.stringify([revisionTerms]));
      })
    );
    await act(async () => root.render(<AdminTosPage />));
    await clickText('Edit');
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    if (status === 200) {
      expect(host.querySelector('form')).toBeNull();
      expect(host.querySelector('[role=alert]')).toBeNull();
    } else {
      expect(host.querySelector('form')).not.toBeNull();
      expect(host.querySelector('[role=alert]')).not.toBeNull();
    }
  }
);

const brandConfig = {
  appTitle: 'Barghsa',
  slogan: '',
  primaryColor: '#2563eb',
  secondaryColor: '#64748b',
  accentColor: '#f59e0b',
  logoUrl: null,
  faviconUrl: null,
  darkMode: false,
  numberStyle: 'locale',
};
const brand = {
  id: 'brand-one',
  config: brandConfig,
  version: 1,
  status: 'active',
  createdBy: 'staff-one',
  createdAt: validTerms.createdAt,
  updatedAt: validTerms.updatedAt,
};
it.each(
  [
    null,
    [],
    ...Object.entries({
      config: null,
      id: '',
      version: -1,
      status: 'unknown',
      createdBy: '',
      createdAt: 'bad',
      updatedAt: null,
    }).map(([key, value]) => ({ ...brand, [key]: value })),
    { ...brand, version: 1.5 },
    { ...brand, version: '1' },
    { ...brand, id: 5 },
    { ...brand, createdBy: null },
  ].map((data) => ({ data }))
)('rejects malformed branding authority data %#', async ({ data }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(data)))
  );
  await act(async () => root.render(<AdminBrandingConfig />));
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(
    Array.from(host.querySelectorAll('button'))
      .filter((button) => /save|activate/i.test(button.textContent ?? ''))
      .every((button) => button.disabled)
  ).toBe(true);
  for (const [, init] of vi.mocked(fetch).mock.calls) expect(init?.method ?? 'GET').toBe('GET');
});
const correction = {
  invoiceId: '11111111-1111-7111-8111-111111111111',
  profileId: 'profile-one',
  state: 'Unpaid',
  paidAmount: '0',
  totalAmount: '100',
  lines: [{ description: 'Service', quantity: 1, unitPrice: '100', vatRate: 0, isTaxable: false }],
  kind: 'replacement' as const,
  onLocked: vi.fn(),
};
it.each([
  ['description', ''],
  ['quantity', '0'],
  ['quantity', '2147483648'],
  ['quantity', 'one'],
  ['price', '-1'],
  ['price', '9223372036854775808'],
  ['price', '0'],
  ['vat', '101'],
  ['vat', 'invalid'],
  ['vat', '1.234'],
])('blocks invalid replacement invoice %s=%s before issuing', async (field, value) => {
  vi.stubGlobal('fetch', vi.fn());
  await act(async () => root.render(<ManualInvoiceForm correction={correction} />));
  await setInput(host.querySelector<HTMLInputElement>('#correction-reason')!, 'Correct invoice');
  await setInput(host.querySelector<HTMLInputElement>(`[id^="manual-${field}-"]`)!, value);
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true);
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  { name: 'invoice identity', patch: { invoiceId: 'bad' } },
  { name: 'profile', patch: { profileId: 'different' } },
  { name: 'numeric total', patch: { totalAmount: 100 } },
  { name: 'invalid total', patch: { totalAmount: 'invalid' } },
  { name: 'zero total', patch: { totalAmount: '0' } },
  { name: 'overflow total', patch: { totalAmount: '9223372036854775808' } },
  { name: 'original identity', patch: { invoiceId: correction.invoiceId } },
  { name: 'original link', patch: { originalInvoiceId: 'other' } },
  { name: 'kind', patch: { kind: 'adjustment' } },
  { name: 'request identity', patch: { idempotencyKey: 'other' } },
  { name: 'reason', patch: { reason: 'other' } },
  { name: 'amount', patch: { amount: '101' } },
  { name: 'mismatched total', patch: { totalAmount: '101' } },
  { name: 'success', success: true },
  { name: 'forbidden', status: 403 },
  { name: 'conflict', status: 409 },
  { name: 'invalid', status: 400 },
  { name: 'uncertain', status: 503 },
])('replacement invoice retains retry safety for $name', async (scenario) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          invoiceId: '22222222-2222-7222-8222-222222222222',
          profileId: correction.profileId,
          totalAmount: '100',
          originalInvoiceId: correction.invoiceId,
          ...body,
          amount: '100',
          ...scenario.patch,
        }),
        { status: scenario.status ?? 200 }
      );
    })
  );
  await act(async () => root.render(<ManualInvoiceForm correction={correction} />));
  await setInput(host.querySelector<HTMLInputElement>('#correction-reason')!, 'Correct invoice');
  await act(async () => host.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
  expect(fetch).toHaveBeenCalledTimes(1);
  if (scenario.success) {
    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(host.querySelector('form')).toBeNull();
  } else {
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    if (!scenario.status || scenario.status >= 500) {
      expect(host.querySelector<HTMLInputElement>('#correction-reason')?.disabled).toBe(true);
      const first = vi.mocked(fetch).mock.calls[0]![1]?.body;
      await act(async () => host.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
      expect(vi.mocked(fetch).mock.calls[1]![1]?.body).toBe(first);
    } else expect(host.querySelector<HTMLInputElement>('#correction-reason')?.disabled).toBe(false);
  }
});

it.each(
  [
    null,
    { mode: 'unknown', draft: null, version: 0 },
    { mode: 'MANUAL', draft: 'unknown', version: 0 },
    { mode: 'MANUAL', draft: null, version: -1 },
    { mode: 'MANUAL', draft: null, version: 0.5 },
  ].map((data) => ({ data }))
)('does not enable verification changes after invalid authority data %#', async ({ data }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(data)))
  );
  await act(async () => root.render(<AdminVerificationConfig />));
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
  expect(host.querySelector('[role=alert]')).not.toBeNull();
});

it.each(
  [
    {
      isAdmin: true,
      isWildcard: true,
      roleIds: ['admin'],
      roleNames: ['Administrator'],
      permissions: [],
    },
    { isAdmin: false, isWildcard: false, roleIds: [], roleNames: [], permissions: [] },
    {
      isAdmin: false,
      isWildcard: false,
      roleIds: ['reviewer', 'unknown'],
      roleNames: ['Review role'],
      permissions: [
        { permission: 'custom:read', group: 'custom' },
        { permission: 'users:read', group: 'users' },
      ],
    },
  ].map((data) => ({ data }))
)('shows valid effective authority lookup states %#', async ({ data }) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url) =>
        new Response(
          JSON.stringify(String(url).endsWith('/roles') ? [] : { ...data, userId: 'staff-one' })
        )
    )
  );
  await act(async () => root.render(<AdminRolesPage />));
  await setInput(host.querySelector<HTMLInputElement>('#staffUserId')!, 'staff-one');
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(host.textContent).toContain('staff-one');
  for (const permission of data.permissions)
    expect(host.textContent).toContain(permission.permission);
});

it.each([
  { patch: { status: 'draft' } },
  { patch: { id: 'other' } },
  { patch: { version: 2 } },
  { success: true },
])('branding activation accepts only its unchanged draft identity %#', async (scenario) => {
  const initial = { ...brand, status: 'draft' };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url, init) =>
        new Response(
          JSON.stringify(init?.method === 'POST' ? { ...brand, ...scenario.patch } : initial)
        )
    )
  );
  const activated = vi.fn();
  window.addEventListener('barghsa:branding-activated', activated);
  try {
    await act(async () => root.render(<AdminBrandingConfig />));
    await clickText('Activate');
    await act(async () =>
      document
        .querySelector('[role=dialog] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    const request = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      draftId: brand.id,
      expectedVersion: brand.version,
    });
    if (scenario.success) {
      expect(activated).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[role=dialog]')).toBeNull();
    } else {
      expect(activated).not.toHaveBeenCalled();
      expect(document.querySelector('[role=dialog] [role=alert]')).not.toBeNull();
    }
  } finally {
    window.removeEventListener('barghsa:branding-activated', activated);
  }
});
it.each([
  { status: 503, data: null },
  { status: 200, data: null },
  { status: 200, data: { ...revisionTerms, id: 'other' } },
  { status: 200, data: { ...revisionTerms, revision: undefined } },
  { status: 200, data: publishedTerms },
  { status: 200, data: revisionTerms },
])('terms reload after conflict validates the current draft %#', async (scenario) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) =>
      init?.method === 'PUT'
        ? new Response('{}', { status: 409 })
        : String(url).endsWith('/' + revisionTerms.id)
          ? new Response(JSON.stringify(scenario.data), { status: scenario.status })
          : new Response(JSON.stringify([revisionTerms]))
    )
  );
  await act(async () => root.render(<AdminTosPage />));
  await clickText('Edit');
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await clickText('Reload saved draft');
  if (scenario.data === revisionTerms) {
    expect(host.querySelector('[role=alert]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')?.disabled).toBe(false);
  } else if (scenario.data === publishedTerms) {
    expect(host.querySelector('form')).toBeNull();
  } else {
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')?.disabled).toBe(true);
  }
});

it.each([
  { patch: { status: 'active' } },
  { patch: { version: 1 } },
  { patch: { config: brandConfig } },
  { success: true },
])('branding save rejects unconfirmed draft contents %#', async (scenario) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url, init) =>
        new Response(
          JSON.stringify(
            init?.method === 'PUT'
              ? {
                  ...brand,
                  status: 'draft',
                  version: 2,
                  config: { ...brandConfig, appTitle: 'Updated brand' },
                  ...scenario.patch,
                }
              : brand
          )
        )
    )
  );
  await act(async () => root.render(<AdminBrandingConfig />));
  await setInput(
    host.querySelector<HTMLInputElement>('#adminbrandingconfig-field-2')!,
    'Updated brand'
  );
  await clickText('Save Draft');
  await act(async () =>
    document
      .querySelector('[role=dialog] form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  if (scenario.success) {
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.textContent).toContain('Changes saved.');
  } else {
    expect(document.querySelector('[role=dialog] [role=alert]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('#adminbrandingconfig-field-2')?.value).toBe(
      'Updated brand'
    );
  }
});
it.each(['superseded', 'disabled', 'active'] as const)(
  'renders provider history without exposing a draft editor (%s)',
  async (status) => {
    const provider = {
      ...smtp,
      status,
      lastTestStatus: 'failed',
      lastTestAt: validTerms.createdAt,
      lastTestError: 'Connection refused',
      activatedAt: validTerms.createdAt,
      activatedBy: 'operator-one',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([provider])))
    );
    await act(async () => root.render(<AdminEmailProvidersPage />));
    expect(host.textContent).toContain('Connection refused');
    expect(host.textContent).toContain('operator-one');
    expect(host.querySelector('#email-provider-label')).toBeNull();
    expect(
      Array.from(host.querySelectorAll('tbody button')).some(
        (button) => button.textContent === 'Save'
      )
    ).toBe(false);
  }
);
it('abandons an effective permission lookup when the staff identity changes', async () => {
  let resolve!: (response: Response) => void;
  const requests = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) =>
    String(url).endsWith('/roles')
      ? new Response('[]')
      : new Promise<Response>((done) => {
          resolve = done;
        })
  );
  vi.stubGlobal('fetch', requests);
  await act(async () => root.render(<AdminRolesPage />));
  await setInput(host.querySelector<HTMLInputElement>('#staffUserId')!, 'staff-one');
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await setInput(host.querySelector<HTMLInputElement>('#staffUserId')!, 'staff-two');
  expect(requests.mock.calls[1]![1]?.signal?.aborted).toBe(true);
  await act(async () => resolve(new Response(JSON.stringify(effective))));
  expect(host.textContent).not.toContain('staff-one');
  expect(host.querySelector('[role=alert]')).toBeNull();
});

it.each([
  { patch: { status: 'wrong' } },
  { patch: { approvalRequestId: 12 } },
  { patch: { approvalRequestId: 'bad' } },
  { patch: { originalInvoiceId: 'other' } },
  { patch: { kind: 'replacement' } },
  { patch: { idempotencyKey: 'other' } },
  { patch: { reason: 'other' } },
  { patch: { amount: '99' } },
  { success: true },
])('adjustment approval acknowledgement remains tied to the exact request %#', async (scenario) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          ...body,
          status: 'pending_approval',
          approvalRequestId: '22222222-2222-7222-8222-222222222222',
          originalInvoiceId: correction.invoiceId,
          ...scenario.patch,
        }),
        { status: 202 }
      );
    })
  );
  await act(async () =>
    root.render(<ManualInvoiceForm correction={{ ...correction, kind: 'adjustment' }} />)
  );
  await setInput(host.querySelector<HTMLInputElement>('#correction-reason')!, 'Correct amount');
  await setInput(host.querySelector<HTMLInputElement>('#correction-amount')!, '-100');
  await act(async () => host.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
  expect(fetch).toHaveBeenCalledTimes(1);
  if (scenario.success) {
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('[role=alert]')).toBeNull();
  } else {
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('#correction-reason')?.disabled).toBe(true);
  }
});
it.each([revisionTerms, publishedTerms].map((version) => ({ version })))(
  'terms details expose both languages without allowing edits %#',
  async ({ version }) => {
    await import('../components/TosContent.js');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([version])))
    );
    await act(async () => root.render(<AdminTosPage />));
    await clickText('View');
    const dialog = document.querySelector('[role=dialog]')!;
    expect(dialog).not.toBeNull();
    for (const label of ['فارسی', 'English']) {
      await act(async () =>
        Array.from(dialog.querySelectorAll('button'))
          .find((button) => button.textContent === label)!
          .click()
      );
      expect(dialog.textContent).toContain(
        label === 'English' ? version.contentEn : version.contentFa
      );
    }
    await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
    expect(document.querySelector('[role=dialog]')).toBeNull();
    for (const [, init] of vi.mocked(fetch).mock.calls) expect(init?.method ?? 'GET').toBe('GET');
  }
);
