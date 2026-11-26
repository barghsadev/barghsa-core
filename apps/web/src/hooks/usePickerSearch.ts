import { useState, type KeyboardEvent } from 'react';

/** Keep transient search text separate from the form’s selected record. */
export function usePickerSearch(selectedLabel: string, onBlur?: () => void) {
  const [search, setSearch] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const searching = search !== null;

  return {
    query: search ?? '',
    searching,
    rootProps: {
      inputValue: search ?? selectedLabel,
      onInputValueChange(input: string, { reason }: { reason: string }) {
        setSearch(reason === 'input-change' ? input : null);
      },
      onOpenChange(next: boolean) {
        setOpen(next);
        if (!next) setSearch(null);
      },
    },
    inputProps: {
      onBlur() {
        if (!open) setSearch(null);
        onBlur?.();
      },
      onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        // Keep Enter local to the picker until an option is active.
        if (
          event.key === 'Enter' &&
          !event.nativeEvent.isComposing &&
          !event.currentTarget.getAttribute('aria-activedescendant')
        ) {
          event.preventDefault();
        }
      },
    },
  };
}
