import { useEffect, useRef, type ComponentProps } from 'react';
import { useReducedMotion } from '../../hooks/use-reduced-motion';

type AnimatedProps = Omit<ComponentProps<'div'>, 'ref'> & {
  variant?: 'fade' | 'slide' | 'scale' | 'shimmer' | 'page';
  /** Restart the visual transition without remounting children or resetting their work. */
  motionKey?: string;
};

export function Animated({ variant = 'fade', motionKey, ...props }: AnimatedProps) {
  const reduced = useReducedMotion();
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduced) return;
    for (const animation of element.current?.getAnimations?.() ?? []) {
      animation.currentTime = 0;
      animation.play();
    }
  }, [motionKey, reduced, variant]);
  return (
    <div
      {...props}
      ref={element}
      data-slot="animated"
      data-motion={reduced ? undefined : variant}
    />
  );
}

export type { AnimatedProps };
