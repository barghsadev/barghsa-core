import { useLocale } from '../hooks/useLocale.js';

const label = { en: 'Skip to main content', fa: 'رفتن به محتوای اصلی' } as const;

export function SkipLink() {
  const locale = useLocale();
  return (
    <a
      href="#main-content"
      className="skip-link"
      onClick={(event) => {
        const main = document.getElementById('main-content');
        if (!main) return;
        event.preventDefault();
        main.focus();
      }}
    >
      {label[locale]}
    </a>
  );
}
