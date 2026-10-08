import { createContext, useContext } from 'react';
export const StoryTheme = createContext<'light' | 'dark'>('light');
export const StoryLocale = createContext<'fa' | 'en'>('fa');
export function useStoryText() {
  const locale = useContext(StoryLocale);
  return (fa: string, en: string) => (locale === 'fa' ? fa : en);
}
