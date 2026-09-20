import { useEffect, useMemo } from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

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
}: {
  content: string;
  language: 'fa' | 'en';
  onReady?: () => void;
}) {
  useEffect(() => {
    onReady?.();
  }, [content, language, onReady]);
  const html = useMemo(
    () =>
      DOMPurify.sanitize(markdown.parse(content, { async: false }), {
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
      }),
    [content]
  );
  return (
    <div
      dir={language === 'fa' ? 'rtl' : 'ltr'}
      lang={language}
      className="break-words leading-relaxed [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_p]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-6 [&_ol]:ps-6 [&_blockquote]:border-s-4 [&_blockquote]:ps-3 [&_a]:underline [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_pre]:overflow-x-auto"
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
