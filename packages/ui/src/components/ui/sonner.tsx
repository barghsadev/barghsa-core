import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme === 'light' || theme === 'dark' ? theme : 'system'}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          fontFamily: 'var(--font-sans)',
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
          '--success-bg': 'var(--success-soft)',
          '--success-border': 'var(--success)',
          '--success-text': 'var(--success)',
          '--info-bg': 'var(--info-soft)',
          '--info-border': 'var(--info)',
          '--info-text': 'var(--info)',
          '--warning-bg': 'var(--warning-soft)',
          '--warning-border': 'var(--warning)',
          '--warning-text': 'var(--warning)',
          '--error-bg': 'var(--danger-soft)',
          '--error-border': 'var(--destructive)',
          '--error-text': 'var(--destructive)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
