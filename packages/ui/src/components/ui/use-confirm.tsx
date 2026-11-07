import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog';

type ConfirmOptions = Omit<ConfirmDialogProps, 'open' | 'onConfirm' | 'onCancel' | 'loading'>;
type Confirm = (options: ConfirmOptions) => Promise<boolean>;
const Context = createContext<{
  ask: (options: ConfirmOptions, owner: symbol) => Promise<boolean>;
  cancel: (owner: symbol) => void;
} | null>(null);

/** One visible question at a time. Unmounting or replacing its owner cancels it. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  const pending = useRef<((answer: boolean) => void) | null>(null);
  const owner = useRef<symbol | null>(null);
  const closing = useRef<{ resolve: (answer: boolean) => void; answer: boolean } | null>(null);
  const settle = useCallback((answer: boolean) => {
    const resolve = pending.current;
    if (!resolve || closing.current) return;
    closing.current = { resolve, answer };
    setRequest(null);
  }, []);
  // Resolve after the dialog unmounts and restores focus, before callers focus field feedback.
  useEffect(() => {
    if (request || !closing.current) return;
    const result = closing.current;
    closing.current = null;
    pending.current = null;
    owner.current = null;
    result.resolve(result.answer);
  }, [request]);
  const confirm = useCallback((options: ConfirmOptions, caller: symbol): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false);
    if ((options.variant === 'destructive' || options.destructive) && !options.confirmation?.phrase)
      throw new Error('Destructive confirmation requires a phrase');
    if (options.variant === 'warning' && !options.acknowledgement)
      throw new Error('Financial confirmation requires acknowledgement');
    return new Promise((resolve) => {
      pending.current = resolve;
      owner.current = caller;
      setRequest(options);
    });
  }, []);
  useEffect(
    () => () => {
      pending.current?.(false);
      pending.current = null;
      closing.current = null;
    },
    []
  );
  return (
    <Context.Provider
      value={{
        ask: confirm,
        cancel: (caller) => {
          if (owner.current === caller) settle(false);
        },
      }}
    >
      {children}
      {request && (
        <ConfirmDialog
          {...request}
          open
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </Context.Provider>
  );
}

export function useConfirm(scope?: unknown): Confirm {
  const confirm = useContext(Context);
  const owner = useMemo(() => Symbol(), [scope]);
  const current = useRef<symbol | null>(owner);
  current.current = owner;
  const cancel = useRef(confirm?.cancel);
  cancel.current = confirm?.cancel;
  useLayoutEffect(() => {
    current.current = owner;
    return () => {
      if (current.current === owner) current.current = null;
      cancel.current?.(owner);
    };
  }, [owner]);
  return useCallback(
    async (options) => {
      if (current.current !== owner) return false;
      if (!confirm) throw new Error('useConfirm requires ConfirmProvider');
      const answer = await confirm.ask(options, owner);
      return current.current === owner && answer;
    },
    [confirm, owner]
  );
}
