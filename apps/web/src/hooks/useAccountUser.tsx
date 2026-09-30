import { createContext, useContext } from 'react';

const AccountUserContext = createContext<string | null>(null);
export const AccountUserProvider = AccountUserContext.Provider;
export function useAccountUser() {
  return useContext(AccountUserContext);
}
