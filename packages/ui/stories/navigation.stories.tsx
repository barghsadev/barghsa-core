import type { Story } from '@ladle/react';
import { useState } from 'react';
import * as UI from '../src/index';
import { useStoryText } from './story-context';

export const ScrollAreas: Story = () => {
  const text = useStoryText();
  const [keys, setKeys] = useState(0);
  return (
    <div className="max-w-lg space-y-8">
      <UI.ScrollArea
        role="region"
        aria-label={text('رکوردهای عمودی', 'Vertical records')}
        className="h-48 rounded-lg border p-3"
      >
        <ol className="space-y-4">
          {Array.from({ length: 20 }, (_, index) => (
            <li key={index}>{text('رکورد ', 'Record ') + (index + 1)}</li>
          ))}
        </ol>
      </UI.ScrollArea>
      <UI.ScrollArea
        role="region"
        aria-label={text('رکوردهای افقی', 'Horizontal records')}
        scrollbarOrientation="horizontal"
        className="h-24 rounded-lg border p-3"
      >
        <ol className="flex w-max gap-4">
          {Array.from({ length: 10 }, (_, index) => (
            <li key={index} className="min-w-40">
              <UI.Button
                type="button"
                variant="outline"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    setKeys((count) => count + 1);
                  }
                }}
              >
                {text('رکورد ', 'Record ') + (index + 1)}
              </UI.Button>
            </li>
          ))}
        </ol>
      </UI.ScrollArea>
      <output aria-label={text('کلیدهای کنترل داخلی', 'Nested control keys')}>{keys}</output>
    </div>
  );
};
