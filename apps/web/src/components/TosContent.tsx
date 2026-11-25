import { useEffect, useMemo } from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { t as termsText } from '@barghsa/i18n/terms';

const escapeText = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const markdown = new Marked({
  renderer: { html: (token) => escapeText(token.text), image: (token) => escapeText(token.text) },
});

export default function TosContent({
  content,
  language,
  onReady,
  headingLinks = false,
}: {
  content: string;
  language: 'fa' | 'en';
  onReady?: () => void;
  headingLinks?: boolean;
}) {
  useEffect(() => {
    onReady?.();
  }, [content, language, onReady]);
  const { html, outline } = useMemo(() => {
    const safeHtml = DOMPurify.sanitize(markdown.parse(content, { async: false }), {
      ALLOWED_TAGS: [
        'p',
        'br',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'strong',
        'em',
        'del',
        'blockquote',
        'ul',
        'ol',
        'li',
        'pre',
        'code',
        'hr',
        'a',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
      ],
      ALLOWED_ATTR: ['href', 'title', 'start'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    });
    if (!headingLinks) return { html: safeHtml, outline: [] };
    const fragment = document.createElement('div');
    fragment.innerHTML = safeHtml;
    const outline: { id: string; label: string }[] = [];
    for (const heading of fragment.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
      const label = heading.textContent?.trim();
      if (!label) continue;
      const id = `clause-${outline.length + 1}`;
      const target = heading.tagName === 'H1' ? document.createElement('h2') : heading;
      if (target !== heading) {
        target.append(...heading.childNodes);
        heading.replaceWith(target);
      }
      target.id = id;
      target.tabIndex = -1;
      outline.push({ id, label });
    }
    return { html: fragment.innerHTML, outline };
  }, [content, headingLinks]);
  return (
    <div
      dir={language === 'fa' ? 'rtl' : 'ltr'}
      lang={language}
      className="break-words leading-relaxed [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_p]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-6 [&_ol]:ps-6 [&_blockquote]:border-s-4 [&_blockquote]:ps-3 [&_a]:underline [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_pre]:overflow-x-auto"
    >
      {outline.length > 1 && (
        <nav
          aria-label={termsText('tos.page.contents', language)}
          className="not-prose mb-6 rounded-lg border bg-muted/30 p-4 print:hidden"
        >
          <h2>{termsText('tos.page.contents', language)}</h2>
          <ol className="mt-2 space-y-1">
            {outline.map(({ id, label }) => (
              <li key={id}>
                <a href={`#${id}`} className="text-primary">
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="[&_[id]]:scroll-mt-5" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
