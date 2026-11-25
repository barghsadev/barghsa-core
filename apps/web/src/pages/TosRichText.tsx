import type { WizardFieldBinding } from '../hooks/useWizardForm.js';
import { useEffect, useId, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Bold, Heading2, Italic, List, ListOrdered, Quote, Redo2, Undo2 } from 'lucide-react';
import type { adminTosText } from './admin-tos-text.js';

const extensions = [StarterKit.configure({ underline: false }), Markdown];
const toolbarButton =
  'inline-flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:border-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground disabled:opacity-50';

export default function TosRichText({
  text,
  value,
  onChange,
  label,
  language,
  disabled = false,
  binding,
}: {
  text: ReturnType<typeof adminTosText>;
  value: string;
  onChange: (value: string) => void;
  label: string;
  language: 'fa' | 'en';
  disabled?: boolean;
  binding?: WizardFieldBinding;
}) {
  const sourceHelpId = useId();
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
          'min-h-48 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring [&_h2]:text-xl [&_h2]:font-bold [&_p]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-6 [&_ol]:ps-6 [&_blockquote]:border-s-4 [&_blockquote]:ps-3 [&_a]:underline [&_a]:text-primary',
      },
    },
    onBlur: () => binding?.onBlur(),
    onUpdate: ({ editor: current }) => !sourceOnly && onChange(current.getMarkdown()),
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useEffect(() => {
    if (sourceOnly) return;
    const node = editor?.view.dom;
    binding?.ref(node ?? null);
    if (node) {
      node.setAttribute('aria-invalid', String(binding?.['aria-invalid'] ?? false));
      if (binding?.['aria-describedby'])
        node.setAttribute('aria-describedby', binding['aria-describedby']);
      else node.removeAttribute('aria-describedby');
    }
    return () => {
      binding?.ref(null);
    };
  }, [editor, binding, sourceOnly]);
  const actions = editor
    ? [
        {
          name: text.bold,
          Icon: Bold,
          active: editor.isActive('bold'),
          run: () => editor.chain().focus().toggleBold().run(),
        },
        {
          name: text.italic,
          Icon: Italic,
          active: editor.isActive('italic'),
          run: () => editor.chain().focus().toggleItalic().run(),
        },
        {
          name: text.heading,
          Icon: Heading2,
          active: editor.isActive('heading', { level: 2 }),
          run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        },
        {
          name: text.bullets,
          Icon: List,
          active: editor.isActive('bulletList'),
          run: () => editor.chain().focus().toggleBulletList().run(),
        },
        {
          name: text.numbers,
          Icon: ListOrdered,
          active: editor.isActive('orderedList'),
          run: () => editor.chain().focus().toggleOrderedList().run(),
        },
        {
          name: text.quote,
          Icon: Quote,
          active: editor.isActive('blockquote'),
          run: () => editor.chain().focus().toggleBlockquote().run(),
        },
      ]
    : [];
  if (sourceOnly)
    return (
      <div className="space-y-2">
        <p id={sourceHelpId} className="text-sm text-muted-foreground">
          {text.preserveSource}
        </p>
        <textarea
          {...binding}
          aria-label={label}
          required
          aria-required="true"
          aria-describedby={[sourceHelpId, binding?.['aria-describedby']].filter(Boolean).join(' ')}
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
    <div
      className="rounded-lg border border-input bg-card text-card-foreground"
      aria-busy={!editor}
    >
      <div
        role="group"
        aria-label={`${label}: ${text.formatting}`}
        className="flex flex-wrap gap-1 border-b bg-muted/35 p-1.5"
      >
        {actions.map((action) => (
          <button
            key={action.name}
            type="button"
            aria-label={action.name}
            title={action.name}
            aria-pressed={action.active}
            disabled={disabled}
            onClick={action.run}
            className={toolbarButton}
          >
            <action.Icon aria-hidden="true" className="size-4" />
          </button>
        ))}
        <button
          type="button"
          aria-label={text.undo}
          title={text.undo}
          disabled={disabled || !editor?.can().undo()}
          onClick={() => editor?.chain().focus().undo().run()}
          className={toolbarButton}
        >
          <Undo2 aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        </button>
        <button
          type="button"
          aria-label={text.redo}
          title={text.redo}
          disabled={disabled || !editor?.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
          className={toolbarButton}
        >
          <Redo2 aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
