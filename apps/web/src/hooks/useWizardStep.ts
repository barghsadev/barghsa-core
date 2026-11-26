import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { wizardStepSearch } from '../lib/wizard-step.js';

const keepStep = (step: number) => step;

/** Financial wizards can revisit completed stages, but cannot skip unsaved stages. */
export function useWizardStep(
  to:
    | '/electricity/orders/new'
    | '/electricity/orders/new/advanced'
    | '/savings/orders/new'
    | '/solar/requests/new',
  maxStep = 5,
  normalizeStep = keepStep
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
        : Math.min(normalizeStep(wizardStepSearch({ step: rawStep }, maxStep).step ?? 1), ceiling);
  const currentStep = useRef(step);
  useLayoutEffect(() => {
    currentStep.current = step;
  }, [step]);
  const restore = useCallback(
    (savedStep: number) => {
      const target = normalizeStep(savedStep);
      loaded.current = true;
      setCeiling(target);
      setRestored(target);
    },
    [normalizeStep]
  );
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
