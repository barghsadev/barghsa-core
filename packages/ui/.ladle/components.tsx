import { useLayoutEffect } from 'react';
import type { GlobalProvider } from '@ladle/react';
import { DirectionProvider } from '../src/direction-provider';
import { StoryLocale, StoryTheme } from '../stories/story-context';
import './styles.css';

export const Provider: GlobalProvider = ({ children, globalState }) => {
  const rtl = globalState.rtl;
  const dark = globalState.theme === 'dark';
  useLayoutEffect(() => {
    document.documentElement.lang = rtl ? 'fa' : 'en';
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.classList.toggle('dark', dark);
  }, [rtl, dark]);
  return (
    <DirectionProvider direction={rtl ? 'rtl' : 'ltr'}>
      <StoryTheme.Provider value={dark ? 'dark' : 'light'}>
        <StoryLocale.Provider value={rtl ? 'fa' : 'en'}>
          <main
            data-story-surface
            className="min-h-dvh min-w-0 bg-background p-6 text-foreground"
            dir={rtl ? 'rtl' : 'ltr'}
          >
            <h1 className="mb-6 text-xl font-semibold">
              {rtl ? 'نمونه‌های اجزای برقسا' : 'Barghsa component examples'}
            </h1>
            {children}
          </main>
        </StoryLocale.Provider>
      </StoryTheme.Provider>
    </DirectionProvider>
  );
};
