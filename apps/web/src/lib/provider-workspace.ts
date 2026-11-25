export type ProviderChannel = 'email' | 'sms';
export type ProviderSelection =
  { panel: 'new'; id?: never } | { panel: 'detail' | 'edit' | 'clone' | 'preview'; id: string };

export type ProviderWorkspace = {
  selection: ProviderSelection | undefined;
  set: (selection: ProviderSelection | undefined, replace?: boolean) => void;
};

export function providerSelectionKey(selection: ProviderSelection | undefined) {
  return selection ? `${selection.panel}:${selection.id ?? ''}` : '';
}

export function validProviderId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export function providerDestination(channel: ProviderChannel, selection?: ProviderSelection) {
  if (!selection) return { to: '/admin/providers/$channel', params: { channel } } as const;
  if (selection.panel === 'new')
    return { to: '/admin/providers/$channel/new', params: { channel } } as const;
  const params = { channel, providerId: selection.id };
  switch (selection.panel) {
    case 'detail':
      return { to: '/admin/providers/$channel/$providerId', params } as const;
    case 'edit':
      return { to: '/admin/providers/$channel/$providerId/edit', params } as const;
    case 'clone':
      return { to: '/admin/providers/$channel/$providerId/duplicate', params } as const;
    case 'preview':
      return { to: '/admin/providers/$channel/$providerId/test', params } as const;
  }
}
