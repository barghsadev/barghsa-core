import { Accordion as AccordionPrimitive } from '@base-ui/react/accordion';
import { ChevronDownIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

function Accordion<Value = string>({ className, ...props }: AccordionPrimitive.Root.Props<Value>) {
  return (
    <AccordionPrimitive.Root data-slot="accordion" className={cn('w-full', className)} {...props} />
  );
}
function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('border-b border-border', className)}
      {...props}
    />
  );
}
function AccordionTrigger({ className, children, ...props }: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header>
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'group/accordion-trigger flex w-full items-center justify-between gap-3 rounded-md py-4 text-start text-sm font-medium outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background data-disabled:cursor-not-allowed data-disabled:opacity-50',
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/accordion-trigger:rotate-180 motion-reduce:transition-none"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}
function AccordionContent({ className, children, ...props }: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="overflow-hidden data-open:animate-accordion-down data-ending-style:animate-accordion-up motion-reduce:animate-none"
      {...props}
    >
      <div className={cn('px-1 pb-4 text-sm text-muted-foreground', className)}>{children}</div>
    </AccordionPrimitive.Panel>
  );
}
export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
