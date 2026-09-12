import { Slider as SliderPrimitive } from '@base-ui/react/slider';

import { cn } from '../../lib/utils';

function Slider({
  className,
  defaultValue,
  value,
  thumbLabels,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props & {
  /** Accessible names for individual thumbs in a range slider. */
  thumbLabels?: readonly string[];
}) {
  const effectiveValue = value ?? defaultValue ?? min;
  const thumbCount = Array.isArray(effectiveValue) ? effectiveValue.length : 1;

  return (
    <SliderPrimitive.Root
      className={cn(
        'data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full',
        className
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-muted select-none data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            aria-label={thumbLabels?.[index] ?? props['aria-label']}
            aria-labelledby={thumbLabels?.[index] ? undefined : props['aria-labelledby']}
            className="relative block size-3 shrink-0 rounded-full border border-foreground bg-background transition-shadow select-none after:absolute after:-inset-2 hover:shadow-sm has-[:focus-visible]:border-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background has-[:focus-visible]:outline-hidden disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
