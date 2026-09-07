import { useEffect, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { adminTosText } from './admin-tos-text.js';

const extensions = [StarterKit.configure({ underline: false }), Markdown];

export default function TosRichText({
  value,
  onChange,
  label,
  language,
  locale,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  language: 'fa' | 'en';
  locale: 'fa' | 'en';
  disabled?: boolean;
}) {
  const text = adminTosText(locale);
  // Preserve documents with constructs not represented by the editor schema.
  const [sourceOnly] = useState(() =>
    /<\/?[a-z][^>]*>|!\[|^.*\|.*$|^\s*[-*+] \[[ xX]\]|^\s*\[\^.+\]:/im.test(value)
  );
  const editor = useEditor({
    extensions,
    content: value,
    contentType: 'markdown',
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': label,
        'aria-multiline': 'true',
        'aria-required': 'true',
        dir: language === 'fa' ? 'rtl' : 'ltr',
        lang: language,
        class:
          'min-h-48 p-3 outline-none focus-visible:ring-2 focus-visible:ring-blue-600 [&_h2]:text-xl [&_h2]:font-bold [&_p]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-6 [&_ol]:ps-6 [&_blockquote]:border-s-4 [&_blockquote]:ps-3 [&_a]:underline [&_a]:text-blue-700',
      },
    },
    onUpdate: ({ editor: current }) => !sourceOnly && onChange(current.getMarkdown()),
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  const actions = editor
    ? [
        {
          name: text.bold,
          active: editor.isActive('bold'),
          run: () => editor.chain().focus().toggleBold().run(),
        },
        {
          name: text.italic,
          active: editor.isActive('italic'),
          run: () => editor.chain().focus().toggleItalic().run(),
        },
        {
          name: text.heading,
          active: editor.isActive('heading', { level: 2 }),
          run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        },
        {
          name: text.bullets,
          active: editor.isActive('bulletList'),
          run: () => editor.chain().focus().toggleBulletList().run(),
        },
        {
          name: text.numbers,
          active: editor.isActive('orderedList'),
          run: () => editor.chain().focus().toggleOrderedList().run(),
        },
        {
          name: text.quote,
          active: editor.isActive('blockquote'),
          run: () => editor.chain().focus().toggleBlockquote().run(),
        },
      ]
    : [];
  if (sourceOnly)
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-600">{text.preserveSource}</p>
        <textarea
          aria-label={label}
          required
          dir={language === 'fa' ? 'rtl' : 'ltr'}
          lang={language}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-48 w-full rounded border p-3 font-mono"
        />
      </div>
    );
  return (
    <div className="rounded border border-gray-300 bg-white" aria-busy={!editor}>
      <div
        role="group"
        aria-label={`${label}: ${text.formatting}`}
        className="flex flex-wrap gap-1 border-b p-2"
      >
        {actions.map((action) => (
          <button
            key={action.name}
            type="button"
            aria-pressed={action.active}
            disabled={disabled}
            onClick={action.run}
            className="rounded border px-2 py-1 text-sm aria-pressed:bg-blue-100 disabled:opacity-50"
          >
            {action.name}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || !editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
          className="rounded border px-2 py-1 text-sm disabled:opacity-50"
        >
          {text.undo}
        </button>
        <button
          type="button"
          disabled={disabled || !editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
          className="rounded border px-2 py-1 text-sm disabled:opacity-50"
        >
          {text.redo}
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
