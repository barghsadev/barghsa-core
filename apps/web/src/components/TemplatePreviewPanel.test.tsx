import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import TemplatePreviewPanel, {
  type NotificationTemplateForPreview,
} from './TemplatePreviewPanel.js';
import { useListQuery } from '../hooks/useListQuery.js';
import { notificationPanelSearch, previewQueryOptions } from '../lib/notification-panel-query.js';
import { notificationTemplate } from '../test/content-catalogue-fixtures.js';

it('keeps a restored preview through pending and failed reads, then validates against an accepted catalogue', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const updates: Record<string, unknown>[] = [];
  function Harness({
    templates,
    ready,
  }: {
    templates: NotificationTemplateForPreview[];
    ready: boolean;
  }) {
    const [raw, setRaw] = useState<Record<string, unknown>>({
      preview_event: 'invoice.created',
      preview_channel: 'in_app',
      preview_locale: 'fa',
      preview_version: 'draft-v3',
    });
    const queries = useListQuery(previewQueryOptions, raw, (change) => {
      const next = notificationPanelSearch(change(raw));
      updates.push(next);
      setRaw(next);
    });
    return (
      <TemplatePreviewPanel uiLocale="en" templates={templates} ready={ready} queries={queries} />
    );
  }
  const row: NotificationTemplateForPreview = {
    ...notificationTemplate(),
    id: 'draft-v3',
    eventKey: 'invoice.created',
    channel: 'in_app',
    locale: 'fa',
    version: 3,
  };
  try {
    await act(async () => root.render(<Harness templates={[]} ready={false} />));
    expect(updates).toEqual([]);
    await act(async () => root.render(<Harness templates={[row]} ready={true} />));
    expect(host.querySelector<HTMLSelectElement>('#tpl-preview-version')?.value).toBe('draft-v3');
    await act(async () => root.render(<Harness templates={[]} ready={false} />));
    expect(updates).toEqual([]);
    await act(async () => root.render(<Harness templates={[row]} ready={true} />));
    expect(host.querySelector<HTMLSelectElement>('#tpl-preview-version')?.value).toBe('draft-v3');
    expect(updates).toEqual([]);
    await act(async () => root.render(<Harness templates={[]} ready={true} />));
    expect(updates).toEqual([{}]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
