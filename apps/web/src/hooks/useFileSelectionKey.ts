import { useRef } from 'react';

/** File identity, rather than position or name, keeps previews and transfer receipts attached. */
export function useFileSelectionKey() {
  const keys = useRef(new WeakMap<File, string>());
  return (file: File) => {
    let key = keys.current.get(file);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(file, key);
    }
    return key;
  };
}
