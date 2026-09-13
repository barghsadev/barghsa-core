import { useMemo, useEffect } from 'react';
import TosContent from '../components/TosContent.js';
import { diffLines } from 'diff';
import { adminTosText } from './admin-tos-text.js';

export default function TosPreview({
  current,
  proposed,
  language,
  locale,
  onReady,
}: {
  current: string;
  proposed: string;
  language: 'fa' | 'en';
  locale: 'fa' | 'en';
  onReady: () => void;
}) {
  const text = adminTosText(locale);
  useEffect(onReady, [onReady]);
  const changes = useMemo(
    () => diffLines(current, proposed, { timeout: 50, maxEditLength: 2000 }),
    [current, proposed]
  );
  const style =
    'min-w-0 rounded border bg-card text-card-foreground p-4 break-words [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_p]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-6 [&_ol]:ps-6 [&_blockquote]:border-s-4 [&_blockquote]:ps-3 [&_a]:underline [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2';
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {[
          { title: text.currentVersion, content: current },
          { title: text.proposedVersion, content: proposed },
        ].map((item) => (
          <section key={item.title} aria-label={item.title} className={style}>
            <h4 className="mb-3 border-b pb-2 font-semibold">{item.title}</h4>
            <div dir={language === 'fa' ? 'rtl' : 'ltr'} lang={language}>
              {item.content ? (
                <TosContent content={item.content} language={language} />
              ) : (
                <p>{text.noCurrent}</p>
              )}
            </div>
          </section>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer font-medium">{text.textChanges}</summary>
        <p className="my-2 text-sm">{text.changeLegend}</p>
        <pre
          dir={language === 'fa' ? 'rtl' : 'ltr'}
          lang={language}
          className="overflow-auto whitespace-pre-wrap rounded border p-3 text-sm"
        >
          {changes
            ? changes.map((change, index) =>
                change.added ? (
                  <ins key={index} className="bg-green-100 text-green-900">
                    {change.value}
                  </ins>
                ) : change.removed ? (
                  <del key={index} className="bg-red-100 text-red-900">
                    {change.value}
                  </del>
                ) : (
                  <span key={index}>{change.value}</span>
                )
              )
            : text.largeComparison}
        </pre>
      </details>
    </div>
  );
}
