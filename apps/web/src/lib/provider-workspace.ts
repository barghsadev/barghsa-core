export type ProviderChannel = 'email' | 'sms';
export type ProviderSelection =
  { panel: 'new'; id?: never } | { panel: 'edit' | 'clone' | 'preview'; id: string };

export type ProviderWorkspace = {
  selection: ProviderSelection | undefined;
  set: (selection: ProviderSelection | undefined, replace?: boolean) => void;
};

export function providerSelectionKey(selection: ProviderSelection | undefined) {
  return selection ? `${selection.panel}:${selection.id ?? ''}` : '';
}
