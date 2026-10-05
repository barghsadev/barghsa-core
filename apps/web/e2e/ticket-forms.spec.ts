import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { documentText } from '@barghsa/i18n/documents';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import { test, expect } from './coverage-fixture';
import { pdfPreviewFixture } from './upload-fixture';
import {
  setupTicketForms,
  profileId,
  otherProfileId,
  relatedId,
  ticketId,
  otherTicketId,
  teamId,
  assigneeId,
  customerActor,
  staffActor,
  privateText,
  instant,
  type Family,
  type Command,
} from './ticket-forms-fixture';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: pdfPreviewFixture() });
const form = (page: Page, slot: string) => page.locator(`[data-slot=${slot}]`);
const retry = (page: Page, locale: 'en' | 'fa') =>
  page.getByRole('button', { name: tTicketForms('retryOriginal', locale), exact: true });
const submit = (owner: Locator) => owner.locator('button[type=submit]');
async function linkedError(field: Locator, message: string) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /\S+/);
  expect(
    await field.evaluate((node) =>
      (node.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
    )
  ).toContain(message);
}
async function quality(page: Page, owner: Locator, selector: string) {
  expect(
    (
      await new AxeBuilder({ page })
        .include(selector)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await owner.locator('input,textarea,select,button').all()) {
    const box = await control.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
async function crop(page: Page, owner: Locator, path: string) {
  await owner.scrollIntoViewIfNeeded();
  await owner.evaluate((node) => window.scrollBy(0, node.getBoundingClientRect().top - 130));
  const box = await owner.boundingBox();
  expect(box).not.toBeNull();
  // Original compact field/outcome pixels only; not full-page/dialog/device coverage.
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box!.x),
      y: Math.max(0, box!.y),
      width: Math.min(box!.width, page.viewportSize()!.width - Math.max(0, box!.x)),
      height: Math.min(box!.height, page.viewportSize()!.height - Math.max(0, box!.y)),
    },
  });
}
async function holdFirstSchema(page: Page) {
  const manifest = JSON.parse(
    await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
  ) as Record<string, { file: string }>;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/' + manifest['src/lib/contract-review-signature-form-schemas.ts']!.file,
    async (route) => {
      await held;
      await route.continue();
    }
  );
  return release;
}
async function lockedCompanions(
  page: Page,
  locale: 'en' | 'fa',
  state: Awaited<ReturnType<typeof setupTicketForms>>['state'],
  owning: string
) {
  const before = {
    reads: state.readLog.length,
    writes: state.writes.length,
    effects: { ...state.effects },
    closure: state.closureWrites,
    stepUp: state.stepUpWrites,
  };
  for (const id of ['ticket-search', 'ticket-filter', 'ticket-sort'])
    await expect(page.locator('#' + id)).toBeDisabled();
  const queueRefresh = page
    .locator('[data-slot=list-toolbar]')
    .getByRole('button', { name: t('tickets.refresh', locale), exact: true });
  await expect(queueRefresh).toBeDisabled();
  await queueRefresh.dispatchEvent('click');
  const other = page.getByRole('button', { name: 'Other ticket source', exact: true });
  if (await other.count()) {
    await expect(other).toBeDisabled();
    await other.dispatchEvent('click');
  }
  const views = page.getByRole('group', { name: t('historyView.group', locale), exact: true });
  for (const button of await views.getByRole('button').all()) {
    await expect(button).toBeDisabled();
    await button.dispatchEvent('click');
  }
  for (const slot of [
    'ticket-intake-form',
    'ticket-status-form',
    'ticket-assignment-form',
    'ticket-reply-input',
  ]) {
    if (slot === owning) continue;
    const sibling = form(page, slot);
    if (await sibling.count()) {
      for (const button of await sibling.locator('button[type=submit]').all()) {
        await expect(button).toBeDisabled();
        await button.dispatchEvent('click');
      }
      await sibling.dispatchEvent('submit');
    }
  }
  const closure = page.getByRole('region', {
    name: t('tickets.closure.review', locale),
    exact: true,
  });
  if (await closure.count()) {
    const refresh = closure.getByRole('button', {
      name: t('tickets.closure.refresh', locale),
      exact: true,
    });
    await expect(refresh).toBeDisabled();
    await refresh.dispatchEvent('click');
    if (await closure.locator('form').count())
      await closure.locator('form').dispatchEvent('submit');
  }
  // The actual selected staff customer-profile anchor is a page-owned companion.
  // Intake has no page-owned anchor; global shell navigation is outside this assertion.
  const navigation = page.locator('[data-slot=ticket-detail] a[href^="/admin/crm/profiles/"]');
  if (await navigation.count()) {
    const location = page.url();
    await navigation.click();
    await expect(page).toHaveURL(location);
    await navigation.dispatchEvent('click');
    await expect(page).toHaveURL(location);
  }
  expect({
    reads: state.readLog.length,
    writes: state.writes.length,
    effects: { ...state.effects },
    closure: state.closureWrites,
    stepUp: state.stepUpWrites,
  }).toEqual(before);
}
function exactRetry(commands: Command[], family: Family, first: Command) {
  const attempts = commands.filter(
    (command) =>
      command.family === family &&
      (family === 'reply'
        ? command.body.submissionId === first.body.submissionId
        : command.body.idempotencyKey === first.body.idempotencyKey)
  );
  expect(attempts.length).toBeGreaterThanOrEqual(2);
  expect(
    attempts.every((command) => command.raw === first.raw && command.ticket === first.ticket)
  ).toBe(true);
  expect(String(family === 'reply' ? first.body.submissionId : first.body.idempotencyKey)).toMatch(
    uuidPattern
  );
  expect(attempts.at(-1)!.csrf).toBe('ticket-forms-rotated');
}

for (const [locale, theme] of [
  ['en', 'light'],
  ['fa', 'dark'],
] as const) {
  const text = (key: string) => t(`tickets.${key}`, locale);
  test(`customer intake and public replies retain captured commands, ordered files and current privacy (${locale}, ${theme})`, async ({
    page,
  }, testInfo) => {
    const fixture = await setupTicketForms(page, locale, false),
      { state } = fixture;
    const releaseSchema = await holdFirstSchema(page);
    await page.goto('/tickets');
    await page.getByRole('button', { name: text('create'), exact: true }).click();
    const intake = form(page, 'ticket-intake-form');
    await expect(intake).toBeVisible();
    await intake.locator('#ticket-subject').fill('   ');
    await intake.locator('#ticket-body').fill('  Explain this contract and attachment  ');
    await intake.locator('#ticket-subject').press('Enter');
    await expect(submit(intake)).toBeDisabled();
    await lockedCompanions(page, locale, state, 'ticket-intake-form');
    expect(state.writes).toHaveLength(0);
    releaseSchema();
    await linkedError(intake.locator('#ticket-subject'), tTicketForms('subjectInvalid', locale));
    await crop(
      page,
      intake.locator('#ticket-subject').locator('..'),
      testInfo.outputPath(`ticket-customer-field-${locale}.png`)
    );
    await quality(page, intake, '[data-slot=ticket-intake-form]');
    await intake.locator('#ticket-subject').fill('  Ticket form journey  ');
    await intake.locator('#ticket-category').selectOption('orders');
    await intake.locator('#ticket-profile').selectOption(profileId);
    await intake.locator('#ticket-record').selectOption(`contract:${relatedId}`);
    await intake.locator('#ticket-profile').selectOption(otherProfileId);
    await expect(intake.locator('#ticket-record')).toHaveValue('');
    await intake.locator('#ticket-profile').selectOption(profileId);
    await intake.locator('#ticket-record').selectOption(`contract:${relatedId}`);
    await intake
      .locator('#ticket-files')
      .setInputFiles([pdf('first-proof.pdf'), pdf('second-proof.pdf')]);
    state.modes.create = 'owned';
    await submit(intake).click();
    await linkedError(intake.locator('#ticket-subject'), tTicketForms('subjectInvalid', locale));
    await expect(intake.locator('#ticket-body')).toHaveValue(
      '  Explain this contract and attachment  '
    );
    await expect(intake).toContainText('first-proof.pdf');
    await expect(intake).toContainText('second-proof.pdf');
    expect(state.effects.create).toBe(0);
    await intake.locator('#ticket-subject').fill('  Ticket form journey  ');
    state.modes.create = 'mixed';
    await submit(intake).click();
    await expect(page.getByText(tTicketForms('uncertain', locale), { exact: true })).toBeVisible();
    await expect(page.getByText('MUST-NOT-ECHO-SERVER-INPUT', { exact: false })).toHaveCount(0);
    const capturedCreate = state.writes.at(-1)!;
    expect(capturedCreate.body).toMatchObject({
      subject: 'Ticket form journey',
      body: 'Explain this contract and attachment',
      category: 'orders',
      priority: 'normal',
      profileId,
      relatedEntityType: 'contract',
      relatedEntityId: relatedId,
    });
    expect(capturedCreate.body.attachments).toEqual(state.verifiedKeys);
    state.modes.create = 'hold';
    await retry(page, locale).click();
    await expect.poll(() => state.held?.command.family).toBe('create');
    await lockedCompanions(page, locale, state, 'ticket-intake-form');
    await fixture.finishHeld('foreign');
    await expect(retry(page, locale)).toBeEnabled();
    await expect(intake.locator('#ticket-subject')).toHaveValue('  Ticket form journey  ');
    await fixture.rotateCsrf();
    state.modes.create = 'rejected';
    await retry(page, locale).click();
    await expect(retry(page, locale)).toBeEnabled();
    state.modes.create = 'success';
    await retry(page, locale).click();
    await expect(
      page.getByRole('heading', { name: 'Ticket form journey', level: 2 })
    ).toBeVisible();
    await expect(intake).toBeHidden();
    exactRetry(state.writes, 'create', capturedCreate);
    expect(state.effects.create).toBe(1);
    expect(state.uploadedNames).toEqual(['first-proof.pdf', 'second-proof.pdf']);
    expect(fixture.tickets.get(ticketId)!.status).toBe('in_progress');
    // Defense in depth: even a complete but wrongly projected internal row stays private.
    fixture.injectCustomerPrivateNote();
    const reply = form(page, 'ticket-reply-input');
    await reply.locator('#ticket-reply').fill('  **Public evidence** remains ordered  ');
    await reply
      .locator('#ticket-reply-files')
      .setInputFiles([pdf('reply-first.pdf'), pdf('reply-second.pdf')]);
    await reply
      .getByRole('button', {
        name: documentText('moveFileUp', locale).replace('{name}', 'reply-second.pdf'),
        exact: true,
      })
      .click();
    state.modes.reply = 'hold';
    await submit(reply).click();
    await expect.poll(() => state.held?.command.family).toBe('reply');
    const capturedReply = state.held!.command;
    expect(capturedReply.body).toMatchObject({
      body: '**Public evidence** remains ordered',
      visibility: 'public',
      bodyFormat: 'markdown',
    });
    expect(state.uploadedNames.slice(-2)).toEqual(['reply-second.pdf', 'reply-first.pdf']);
    expect(
      state.recordRequests
        .slice(-2)
        .every(
          (request) =>
            request.purpose === 'ticket_reply_attachment' &&
            request.ticketId === ticketId &&
            request.profileId === profileId
        )
    ).toBe(true);
    await lockedCompanions(page, locale, state, 'ticket-reply-input');
    await fixture.finishHeld('lost');
    await expect(retry(page, locale)).toBeEnabled();
    await expect(reply.locator('#ticket-reply')).toHaveValue(
      '  **Public evidence** remains ordered  '
    );
    state.modes.reply = 'success';
    await retry(page, locale).click();
    await expect(reply.locator('#ticket-reply')).toHaveValue('');
    exactRetry(state.writes, 'reply', capturedReply);
    expect(state.effects.reply).toBe(1);
    expect(state.uploadedNames).toHaveLength(4);
    expect(state.putPreconditions).toEqual(['*', '*', '*', '*']);
    const conversation = page.getByRole('region', { name: text('conversation'), exact: true });
    await expect(conversation).toContainText('Public evidence');
    expect(
      fixture.comments
        .get(ticketId)!
        .some((comment) => comment.visibility === 'internal' && comment.body === privateText)
    ).toBe(true);
    await expect(page.getByText(privateText, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Private staff identity', { exact: true })).toHaveCount(0);
    await expect(conversation).toContainText(text('filesUnavailable'));
    await expect(
      conversation.getByRole('link', { name: 'reply-first.pdf', exact: true })
    ).toHaveCount(0);
    await crop(page, conversation, testInfo.outputPath(`ticket-customer-outcome-${locale}.png`));
    await quality(page, reply, '[data-slot=ticket-reply-input]');
    // A real profile epoch invalidates old local work before an obsolete denied options reply.
    await page.getByRole('button', { name: text('create'), exact: true }).click();
    await intake.locator('#ticket-subject').fill('Old private draft');
    state.holdOptions = true;
    await intake.locator('#ticket-profile').selectOption(profileId);
    await expect.poll(() => !!state.heldOptions).toBe(true);
    state.holdOptions = false;
    await page.evaluate(() => {
      const channel = new BroadcastChannel('barghsa-profile-context');
      channel.postMessage({ type: 'profile-changed' });
      channel.close();
    });
    await expect(intake).toBeHidden();
    await page.getByRole('button', { name: text('create'), exact: true }).click();
    await intake.locator('#ticket-subject').fill('Fresh authorized draft');
    await fixture.releaseOldOptionsDenied();
    await expect(intake.locator('#ticket-subject')).toHaveValue('Fresh authorized draft');
    await intake.locator('#ticket-body').fill('New private request');
    state.denied = true;
    await submit(intake).click();
    await expect(intake).toHaveCount(0);
    await expect(page.locator('#ticket-reply')).toHaveCount(0);
    await expect(page.getByText(privateText, { exact: true })).toHaveCount(0);
    expect(state.writes.filter((command) => command.family === 'create').at(-1)!.csrf).toBe(
      state.csrf
    );
    expect(customerActor).not.toMatch(uuidPattern);
  });

  test(`staff assignment, reasons and public/internal replies keep independent drafts and exact receipts (${locale}, ${theme})`, async ({
    page,
  }, testInfo) => {
    const fixture = await setupTicketForms(page, locale, true),
      { state } = fixture;
    const releaseSchema = await holdFirstSchema(page);
    await page.goto('/admin/tickets');
    await page.getByRole('button', { name: 'Ticket form journey', exact: true }).click();
    const status = form(page, 'ticket-status-form'),
      assignment = form(page, 'ticket-assignment-form'),
      reply = form(page, 'ticket-reply-input');
    await status.locator('#ticket-status-reason').fill('   ');
    await status.locator('#ticket-next-status').focus();
    releaseSchema();
    await submit(status).click();
    await linkedError(
      status.locator('#ticket-status-reason'),
      tTicketForms('reasonInvalid', locale)
    );
    await crop(
      page,
      status.locator('#ticket-status-reason').locator('..'),
      testInfo.outputPath(`ticket-staff-field-${locale}.png`)
    );
    await quality(page, status, '[data-slot=ticket-status-form]');
    await status
      .locator('#ticket-status-reason')
      .fill('  Keep this independent resolution reason  ');
    await reply.locator('#ticket-reply').fill('  Public branch draft  ');
    await reply
      .locator('#ticket-reply-files')
      .setInputFiles([pdf('public-first.pdf'), pdf('public-second.pdf')]);
    await reply.getByLabel(text('internal'), { exact: true }).check();
    await expect(reply.locator('#ticket-reply')).toHaveValue('');
    await reply.locator('#ticket-reply').fill('  **Private branch** draft  ');
    await reply.locator('#ticket-reply-files').setInputFiles(pdf('internal-proof.pdf'));
    await reply.getByLabel(text('internal'), { exact: true }).uncheck();
    await expect(reply.locator('#ticket-reply')).toHaveValue('  Public branch draft  ');
    await expect(reply).toContainText('public-first.pdf');
    await expect(reply).not.toContainText('internal-proof.pdf');
    await assignment.locator('#ticket-team').selectOption(teamId);
    await assignment.locator('#ticket-assignee').selectOption(assigneeId);
    state.modes.assignment = 'hold';
    await submit(assignment).click();
    await expect.poll(() => state.held?.command.family).toBe('assignment');
    const capturedAssignment = state.held!.command;
    expect(capturedAssignment.body).toMatchObject({ assigneeId, teamId });
    expect(assigneeId).not.toMatch(uuidPattern);
    await lockedCompanions(page, locale, state, 'ticket-assignment-form');
    await fixture.finishHeld('malformed');
    await expect(retry(page, locale)).toBeEnabled();
    await fixture.rotateCsrf();
    state.modes.assignment = 'success';
    await retry(page, locale).click();
    await expect(retry(page, locale)).toHaveCount(0);
    exactRetry(state.writes, 'assignment', capturedAssignment);
    expect(state.effects.assignment).toBe(1);
    await expect(status.locator('#ticket-status-reason')).toHaveValue(
      '  Keep this independent resolution reason  '
    );
    await expect(reply.locator('#ticket-reply')).toHaveValue('  Public branch draft  ');
    await expect(reply).toContainText('public-second.pdf');
    // API-owned reply errors retain all fields/files; success clears only its public branch.
    state.modes.reply = 'owned';
    await submit(reply).click();
    await linkedError(reply.locator('#ticket-reply'), tTicketForms('replyInvalid', locale));
    await expect(reply).toContainText('public-first.pdf');
    await reply.locator('#ticket-reply').fill('  **Public answer** with evidence  ');
    state.replyDetailsAvailable = true;
    state.modes.reply = 'success';
    await submit(reply).click();
    await expect(reply.locator('#ticket-reply')).toHaveValue('');
    await expect(status.locator('#ticket-status-reason')).toHaveValue(
      '  Keep this independent resolution reason  '
    );
    expect(state.effects.reply).toBe(1);
    const publicComment = fixture.comments.get(ticketId)![0]!;
    expect(publicComment.authorId).toBe(staffActor);
    expect(publicComment.visibility).toBe('public');
    expect(publicComment.attachmentCount).toBe(2);
    expect(publicComment.attachments).toHaveLength(1);
    expect(publicComment.attachments[0]!.fileIndex).toBe(1);
    expect(publicComment).not.toHaveProperty('submissionId');
    expect(publicComment).not.toHaveProperty('hash');
    // A concurrent allowed transition makes this request a real same-status no-op.
    // Its original receipt still refreshes this ticket without clearing the internal branch.
    fixture.tickets.get(ticketId)!.status = 'waiting_staff';
    const unchangedStatusInstant = fixture.tickets.get(ticketId)!.updatedAt;
    await status.locator('#ticket-next-status').selectOption('waiting_staff');
    state.modes.status = 'hold';
    await submit(status).click();
    await expect.poll(() => state.held?.command.family).toBe('status');
    const capturedStatus = state.held!.command;
    expect(capturedStatus.body).toMatchObject({
      status: 'waiting_staff',
      reason: 'Keep this independent resolution reason',
    });
    await lockedCompanions(page, locale, state, 'ticket-status-form');
    await fixture.finishHeld('foreign');
    await expect(retry(page, locale)).toBeEnabled();
    state.modes.status = 'success';
    await retry(page, locale).click();
    await expect(status.locator('#ticket-status-reason')).toHaveValue('');
    exactRetry(state.writes, 'status', capturedStatus);
    expect(state.effects.status).toBe(0);
    expect(fixture.tickets.get(ticketId)!.updatedAt).toBe(unchangedStatusInstant);
    expect(fixture.tickets.get(ticketId)!.createdAt).toBe(instant);
    await reply.getByLabel(text('internal'), { exact: true }).check();
    await expect(reply.locator('#ticket-reply')).toHaveValue('  **Private branch** draft  ');
    await expect(reply).toContainText('internal-proof.pdf');
    await expect(reply).not.toContainText('public-first.pdf');
    state.modes.reply = 'hold';
    await submit(reply).click();
    await expect.poll(() => state.held?.command.family).toBe('reply');
    const capturedInternal = state.held!.command;
    expect(capturedInternal.body.visibility).toBe('internal');
    expect(capturedInternal.body.attachments).toHaveLength(1);
    await fixture.finishHeld('lost');
    await expect(retry(page, locale)).toBeEnabled();
    state.modes.reply = 'success';
    await retry(page, locale).click();
    await expect(reply.locator('#ticket-reply')).toHaveValue('');
    exactRetry(state.writes, 'reply', capturedInternal);
    expect(state.effects.reply).toBe(2);
    expect(state.uploadedNames).toEqual([
      'public-first.pdf',
      'public-second.pdf',
      'internal-proof.pdf',
    ]);
    expect(state.putPreconditions).toEqual(['*', '*', '*']);
    const conversation = page.getByRole('region', { name: text('conversation'), exact: true });
    await expect(conversation).toContainText('Public answer');
    await expect(conversation).toContainText('Private branch');
    await expect(conversation).toContainText(text('internalBadge'));
    await crop(page, conversation, testInfo.outputPath(`ticket-staff-outcome-${locale}.png`));
    await quality(page, reply, '[data-slot=ticket-reply-input]');
    // Explicit current denial clears both branches and selected private source.
    await reply.locator('#ticket-reply').fill('Private work after successful save');
    state.denied = true;
    await submit(reply).click();
    await expect(page.locator('[data-slot=ticket-detail]')).toHaveCount(0);
    await expect(page.getByText('Private work after successful save', { exact: true })).toHaveCount(
      0
    );
    expect(state.closureWrites).toBe(0);
    expect(state.stepUpWrites).toBe(0);
    expect(
      state.writes.every(
        (command) => command.ticket === null || [ticketId, otherTicketId].includes(command.ticket)
      )
    ).toBe(true);
  });
}
