import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Page from './AdminStaffTeamsPage.js';
import {
  staffTeam,
  staffTeamId,
  staffMember,
  staffRoutingRules,
} from '../test/staff-directory-fixtures.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { STAFF_ASSIGNMENT_WORK_TYPES } from '@barghsa/shared/admin';
import { ruleField } from '../lib/staff-team-form.js';
type SchemaModule = typeof import('../lib/catalogue-form-schemas.js');
interface Command {
  action: TeamAction;
  confirmationDisabled: boolean;
  onSuccess: (data: unknown) => Promise<void>;
  onClose: () => void;
  onValidationError: (fields: unknown[]) => boolean;
  onDenied: () => void;
}
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  command: null as Command | null,
  hold: false,
  fail: false,
  release: null as (() => void) | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: Command) => {
    harness.command = props;
    return <div data-testid="confirmation">{props.action.description}</div>;
  },
}));
vi.mock('../lib/catalogue-form-schemas.js', async (original) => {
  const actual = await original<SchemaModule>();
  return {
    ...actual,
    staffTeamSchema: (...args: Parameters<typeof actual.staffTeamSchema>) => {
      if (harness.fail) throw new Error('Missing validation');
      if (harness.hold)
        return new Promise((resolve) => {
          harness.release = () => resolve(actual.staffTeamSchema(...args));
        });
      return actual.staffTeamSchema(...args);
    },
  };
});
let host: HTMLDivElement, root: Root, teams: unknown, rules: unknown, members: unknown;
let teamStatus: number, ruleStatus: number, memberStatus: number;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.locale = 'en';
  harness.command = null;
  harness.hold = false;
  harness.fail = false;
  harness.release = null;
  teams = [structuredClone(staffTeam)];
  rules = structuredClone(staffRoutingRules);
  members = { items: [staffMember], selected: [staffMember], hasMore: false };
  teamStatus = ruleStatus = memberStatus = 200;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      path.includes('/members?')
        ? Response.json(members, { status: memberStatus })
        : path.endsWith('/assignment-rules')
          ? Response.json(rules, { status: ruleStatus })
          : Response.json(teams, { status: teamStatus })
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const input = (id: string) => host.querySelector<HTMLInputElement>(id)!;
async function mount() {
  await act(async () => root.render(<Page />));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.textContent).toContain(staffMember.name);
  });
}
async function fill(selector: string, value: string) {
  await act(async () => {
    const element = input(selector),
      proto =
        element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === text
  )!;
  expect(button, text).toBeDefined();
  await act(async () => button.click());
  if (text === 'Edit team')
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(
        [...host.querySelectorAll('button')]
          .find((node) => node.textContent === 'Save team')
          ?.matches(':disabled')
      ).toBe(false);
    });
}
async function submit(kind: 'team' | 'rules') {
  await act(async () => {
    const form = host.querySelectorAll('form')[kind === 'team' ? 0 : 1]!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  if (!harness.hold)
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector('form')?.getAttribute('aria-busy')).not.toBe('true');
    });
}
for (const locale of ['en', 'fa'] as const)
  it(`team validation preserves raw tags and focuses owned feedback (${locale})`, async () => {
    harness.locale = locale;
    await mount();
    await fill('#staff-team-name', 'Support');
    await fill('#staff-team-tags', 'finance, finance');
    await submit('team');
    expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
    expect(input('#staff-team-tags').value).toBe('finance, finance');
    await vi.waitFor(() => expect(document.activeElement).toBe(input('#staff-team-tags')));
    expect(input('#staff-team-tags').getAttribute('aria-invalid')).toBe('true');
    expect(
      document.getElementById(
        input('#staff-team-tags').getAttribute('aria-describedby')!.split(' ').at(-1)!
      )?.textContent
    ).not.toContain('admin.');
    await fill('#staff-team-tags', ' finance, billing ');
    await submit('team');
    expect(harness.command!.action.body).toMatchObject({
      name: 'Support',
      skillTags: ['finance', 'billing'],
      memberUserIds: [],
      leadUserId: null,
    });
    const old = harness.command!;
    await act(async () => {
      expect(old.onValidationError(['tags', 'actorUserId'])).toBe(false);
      expect(old.onValidationError(['tags'])).toBe(true);
      old.onClose();
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(input('#staff-team-tags')));
    expect(input('#staff-team-tags').value).toBe(' finance, billing ');
  });
for (const kind of ['team', 'rules'] as const)
  it(`${kind}: failed and malformed reads retain proposals; changed bases require reset`, async () => {
    await mount();
    if (kind === 'team') {
      await click('Edit team');
      await fill('#staff-team-name', 'Draft team');
    } else await fill('#team-ticket', staffTeamId);
    await submit(kind);
    const old = harness.command!;
    const refresh = kind === 'team' ? 'Refresh team list' : 'Refresh assignment rules';
    if (kind === 'team') teamStatus = 503;
    else ruleStatus = 503;
    await click(refresh);
    expect(harness.command!.confirmationDisabled).toBe(true);
    teamStatus = ruleStatus = 200;
    if (kind === 'team') teams = [{ id: staffTeamId }];
    else rules = { ticket: {}, verification_case: {} };
    await click(refresh);
    expect(harness.command!.confirmationDisabled).toBe(true);
    teams = [staffTeam];
    rules = staffRoutingRules;
    await click(refresh);
    expect(harness.command!.confirmationDisabled).toBe(false);
    expect(harness.command!.action).toBe(old.action);
    if (kind === 'team') teams = [{ ...staffTeam, name: 'Server team' }];
    else rules = { ...staffRoutingRules, ticket: { teamId: null, strategy: 'load' } };
    await click(refresh);
    expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
    await act(async () => old.onSuccess({ ...staffTeam, ...(old.action.body as object) }));
    if (kind === 'team') {
      expect(input('#staff-team-name').value).toBe('Draft team');
      expect(input('#staff-team-name').matches(':disabled')).toBe(true);
      await click('Reset team draft');
      expect(input('#staff-team-name').value).toBe('Server team');
    } else {
      expect(input('#team-ticket').value).toBe(staffTeamId);
      expect(input('#team-ticket').matches(':disabled')).toBe(true);
      await click('Reset to current rules');
      expect(input('#team-ticket').value).toBe('');
    }
  });
for (const kind of ['team', 'rules'] as const)
  it(`${kind}: unverified success cannot be resubmitted until authoritative refresh and reset`, async () => {
    await mount();
    if (kind === 'team') await fill('#staff-team-name', 'Uncertain');
    else await fill('#team-ticket', staffTeamId);
    await submit(kind);
    const old = harness.command!;
    await act(async () => {
      await expect(old.onSuccess({ ok: true })).rejects.toThrow('Unverified');
    });
    expect(harness.command!.confirmationDisabled).toBe(true);
    await act(async () => old.onClose());
    await submit(kind);
    expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
    await click(kind === 'team' ? 'Refresh team list' : 'Refresh assignment rules');
    await submit(kind);
    expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
    await click(kind === 'team' ? 'Reset team draft' : 'Reset to current rules');
    if (kind === 'team') expect(input('#staff-team-name').value).toBe('');
    else expect(input('#team-ticket').value).toBe('');
  });
it('schema loading locks both forms synchronously and discards obsolete validation after access denial', async () => {
  let denyRules!: (response: Response) => void;
  const pendingRules = new Promise<Response>((resolve) => {
    denyRules = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) =>
      path.endsWith('/assignment-rules')
        ? pendingRules
        : Promise.resolve(
            path.includes('/members?') ? Response.json(members) : Response.json(teams)
          )
    )
  );
  await mount();
  await fill('#staff-team-name', 'Pending private team');
  harness.hold = true;
  await submit('team');
  await vi.waitFor(() => expect(harness.release).not.toBeNull());
  expect(input('#team-ticket').matches(':disabled')).toBe(true);
  await submit('rules');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  await act(async () => denyRules(Response.json({}, { status: 403 })));
  expect(input('#staff-team-name')).toBeNull();
  await act(async () => harness.release!());
  expect(host.textContent).not.toContain('Pending private team');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
});

it('missing validation is visible and a retry validates the retained draft', async () => {
  await mount();
  await fill('#staff-team-name', 'Retry team');
  harness.fail = true;
  await submit('team');
  expect(host.textContent).toContain('Validation could not be loaded');
  expect(input('#staff-team-name').value).toBe('Retry team');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  harness.fail = false;
  await submit('team');
  expect(harness.command!.action.body).toMatchObject({ name: 'Retry team' });
});
it('a first recovered rule read cannot silently overwrite unseen saved defaults', async () => {
  ruleStatus = 503;
  await mount();
  await fill('#team-ticket', staffTeamId);
  rules = {
    ...staffRoutingRules,
    verification_case: { teamId: staffTeamId, strategy: 'expertise' },
  };
  ruleStatus = 200;
  await click('Refresh assignment rules');
  expect(input('#team-ticket').value).toBe(staffTeamId);
  expect(input('#team-ticket').matches(':disabled')).toBe(true);
  expect(host.textContent).toContain('Saved assignment rules changed');
  await click('Reset to current rules');
  expect(input('#team-verification_case').value).toBe(staffTeamId);
});
it('conflicting candidate reads keep the draft and selected lead, but block confirmation', async () => {
  await mount();
  await click('Edit team');
  await fill('#staff-team-name', 'Retained member work');
  members = {
    items: [staffMember],
    selected: [{ ...staffMember, eligible: false }],
    hasMore: false,
  };
  await fill('#staff-team-search', 'Conflicting read');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.textContent).toContain('Staff could not be loaded');
  });
  await submit('team');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(input('#staff-team-name').value).toBe('Retained member work');
  expect(input('#staff-team-lead').value).toBe(staffMember.id);
});
it('an implicitly eligible search row does not cancel a captured deletion after an explicit eligible selection', async () => {
  await mount();
  members = {
    items: [{ id: staffMember.id, name: staffMember.name }],
    selected: [],
    hasMore: false,
  };
  await fill('#staff-team-search', 'Same eligibility');
  await click('Delete team');
  const command = harness.command!;
  await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
  expect(host.querySelector('[data-testid=confirmation]')).not.toBeNull();
  expect(harness.command!.action).toBe(command.action);
  expect(harness.command!.confirmationDisabled).toBe(false);
});
it('withdrawn teams produce linked rule feedback and never reach confirmation', async () => {
  await mount();
  await fill('#team-ticket', staffTeamId);
  teams = [{ ...staffTeam, isActive: false }];
  await click('Refresh team list');
  await submit('rules');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(input('#team-ticket').value).toBe(staffTeamId);
  expect(input('#team-ticket').closest('fieldset')?.getAttribute('aria-invalid')).toBe('true');
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('team-ticket'));
  expect(input('#team-ticket').closest('fieldset')?.getAttribute('aria-invalid')).toBe('true');
  await fill('#team-ticket', '');
  await submit('rules');
  expect(harness.command!.action.body).toEqual(staffRoutingRules);
});
it.each(STAFF_ASSIGNMENT_WORK_TYPES)(
  'owned %s errors retain priorities and focus the registered primary team control',
  async (type) => {
    await mount();
    await fill(`#team-${type}`, staffTeamId);
    await submit('rules');
    const command = harness.command!;
    await act(async () => {
      expect(command.onValidationError([ruleField(type), 'actorUserId'])).toBe(false);
      expect(command.onValidationError(['name'])).toBe(false);
      expect(command.onValidationError([ruleField(type)])).toBe(true);
      command.onClose();
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(input(`#team-${type}`)));
    expect(input(`#team-${type}`).getAttribute('aria-invalid')).toBe('true');
    expect(input(`#team-${type}`).value).toBe(staffTeamId);
  }
);
it('fresh ineligible members block save with feedback while keeping member and lead choices', async () => {
  await mount();
  await click('Edit team');
  await vi.waitFor(() =>
    expect(
      [...host.querySelectorAll('button')]
        .find((node) => node.textContent === 'Save team')
        ?.matches(':disabled')
    ).toBe(false)
  );
  members = {
    items: [{ ...staffMember, eligible: false }],
    selected: [{ ...staffMember, eligible: false }],
    hasMore: false,
  };
  await fill('#staff-team-search', 'Updated member');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.textContent).toContain('Inactive');
  });
  await submit('team');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(input('#staff-team-lead').value).toBe(staffMember.id);
  expect(host.textContent).toContain('eligible staff members');
});
it('verified receipts clear their own drafts and obsolete close callbacks cannot cancel newer proposals', async () => {
  await mount();
  await fill('#team-ticket', staffTeamId);
  await fill('#staff-team-name', 'Created team');
  await submit('team');
  const old = harness.command!;
  const receipt = { ...staffTeam, ...(old.action.body as object) };
  teams = [receipt];
  await act(async () => old.onSuccess(receipt));
  expect(input('#team-ticket').value).toBe(staffTeamId);
  expect(input('#staff-team-name').value).toBe('');
  await submit('rules');
  const next = harness.command!;
  await act(async () => old.onClose());
  expect(host.querySelector('[data-testid=confirmation]')).not.toBeNull();
  expect(harness.command!.action).toBe(next.action);
  rules = next.action.body;
  await act(async () => next.onSuccess(rules));
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(host.textContent).toContain('Changes saved.');
});
