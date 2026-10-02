import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { wizardStepSearch } from '../lib/wizard-step.js';

/** Financial wizards can revisit completed stages, but cannot skip unsaved stages. */
export function useWizardStep(
  to: '/electricity/order' | '/electricity/advanced' | '/savings/order' | '/solar/requests/new',
  maxStep = 5
) {
  const navigate = useNavigate();
  const rawStep = useSearch({ strict: false, select: (search) => search.step });
  const [restored, setRestored] = useState<number | null>(null);
  const [ceiling, setCeiling] = useState(1);
  const loaded = useRef(false);
  const step =
    restored === null
      ? 1
      : rawStep === undefined
        ? restored
        : Math.min(wizardStepSearch({ step: rawStep }, maxStep).step ?? 1, ceiling);
  const currentStep = useRef(step);
  useLayoutEffect(() => {
    currentStep.current = step;
  }, [step]);
  const restore = useCallback((savedStep: number) => {
    loaded.current = true;
    setCeiling(savedStep);
    setRestored(savedStep);
  }, []);
  const reset = useCallback(() => {
    loaded.current = false;
    setRestored(null);
    setCeiling(1);
  }, []);
  const go = useCallback(
    async (target: number, expectedStep = currentStep.current) => {
      if (
        !loaded.current ||
        currentStep.current !== expectedStep ||
        !Number.isInteger(target) ||
        target < 1 ||
        target > maxStep
      )
        return;
      setCeiling((current) => Math.max(current, target));
      await navigate({ to, search: { step: target } });
    },
    [navigate, to, maxStep]
  );
  useEffect(() => {
    if (restored !== null && rawStep !== step)
      void navigate({ to, search: { step }, replace: true }).catch(() => {});
  }, [navigate, to, restored, rawStep, step]);
  return { step, restore, reset, go };
}
