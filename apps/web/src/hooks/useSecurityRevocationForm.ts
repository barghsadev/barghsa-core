import { useRef, useState, type FormEvent } from 'react';
import { useZodForm } from '@barghsa/ui/form';
import type { Locale } from '@barghsa/i18n/app';
import { securitySettingsText } from '@barghsa/i18n/security-settings-forms';
import { useSettingsFormFeedback } from './useSettingsFormFeedback.js';
import type { SecurityOwner, SecurityLists } from './useSecuritySettings.js';
import { accountErrorCode, accountWriteDenied } from '../lib/account-settings-form.js';
import { withCsrf } from '../lib/csrf.js';
import {
  securityOperationAvailable,
  securityOperationConfirmed,
  securityReceipt,
  securityStepUpReceipt,
  type SecurityOperation,
  type SecurityPassword,
} from '../lib/security-settings-form.js';
export function useSecurityRevocationForm(
  scope: SecurityOwner,
  lists: SecurityLists,
  operation: SecurityOperation,
  locale: Locale,
  done: () => void
) {
  const text = (key: string) => securitySettingsText(key, locale);
  const family = 'security:' + operation.kind;
  const [needsPassword, setNeedsPassword] = useState(operation.kind === 'others');
  const required = useRef(needsPassword);
  required.current = needsPassword;
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [checked, setChecked] = useState(false),
    [error, setError] = useState<string | null>(null);
  const held = useRef<{ password: string; checked: boolean } | null>(null),
    checking = useRef(false);
  const form = useZodForm<SecurityPassword>(
    async () => {
      const module = await import('../lib/contract-review-signature-form-schemas.js');
      return scope.isCurrent()
        ? module.securityPasswordSchema(required.current, text('passwordRequired'))
        : module.inactiveSecurityPasswordSchema;
    },
    { defaultValues: { password: '' }, validationUnavailableMessage: text('validationUnavailable') }
  );
  const feedback = useSettingsFormFeedback(form, scope.key, scope.locked, scope, {}, text('error'));
  function finish() {
    if (!scope.owns(family)) return;
    held.current = null;
    form.reset({ password: '' });
    scope.release(family);
    done();
  }
  function unknown() {
    if (!scope.owns(family)) return;
    setUncertain(true);
    setChecked(false);
    setError(text('uncertain'));
  }
  function rejected(response: Response, body: unknown, stepUp = false): boolean {
    if (!scope.owns(family)) return true;
    const code = accountErrorCode(body);
    if (
      !stepUp &&
      operation.kind !== 'others' &&
      response.status === 403 &&
      code === 'AUTHZ:STEP_UP_REQUIRED'
    ) {
      required.current = true;
      setNeedsPassword(true);
      setError(null);
      feedback.invalid({ password: { type: 'required', message: text('passwordRequired') } });
    } else if (accountWriteDenied(response.status, body)) {
      scope.deny();
      return true;
    } else if ([400, 409, 422, 429].includes(response.status))
      setError(
        text(
          response.status === 422 && code === 'AUTH:LOGIN:INVALID_CREDENTIALS'
            ? 'invalidPassword'
            : 'error'
        )
      );
    else return false;
    held.current = null;
    scope.release(family);
    return true;
  }
  async function fresh() {
    if (!(await lists.read('sessions')) || !scope.owns(family)) return false;
    if (operation.kind === 'trust' && (!(await lists.read('devices')) || !scope.owns(family)))
      return false;
    return lists.current().sessions.filter((v) => v.isCurrentSession).length === 1;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (held.current || !scope.isCurrent() || scope.isLocked()) return;
    if (
      !lists.ready('sessions') ||
      (operation.kind === 'trust' && !lists.ready('devices')) ||
      !securityOperationAvailable(operation, lists.current().sessions, lists.current().devices)
    ) {
      setError(text('sourceChanged'));
      return;
    }
    if (!scope.claim(family)) return;
    setBusy(true);
    setError(null);
    try {
      await form.handleSubmit(async (values) => {
        if (!scope.owns(family)) return;
        const capture = { password: values.password, checked: false };
        held.current = capture;
        try {
          if (required.current && operation.kind !== 'others') {
            const response = await fetch('/api/auth/step-up', {
              method: 'POST',
              credentials: 'include',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ password: capture.password }),
            });
            const body: unknown = await response.json().catch(() => null);
            if (!scope.owns(family) || held.current !== capture) return;
            if (rejected(response, body, true)) return;
            if (response.status !== 200 || !securityStepUpReceipt(body)) {
              unknown();
              return;
            }
            if (!(await fresh())) {
              unknown();
              return;
            }
            if (!scope.owns(family) || held.current !== capture) return;
            if (
              !securityOperationAvailable(
                operation,
                lists.current().sessions,
                lists.current().devices
              )
            ) {
              unknown();
              return;
            }
          }
          const path =
            operation.kind === 'others'
              ? '/api/auth/sessions/revoke-all'
              : operation.kind === 'session'
                ? '/api/auth/sessions/' + encodeURIComponent(operation.target.sessionId)
                : '/api/auth/trusted-devices/' + encodeURIComponent(operation.target.id);
          const response = await fetch(path, {
            method: operation.kind === 'others' ? 'POST' : 'DELETE',
            credentials: 'include',
            headers: withCsrf(
              operation.kind === 'others' ? { 'Content-Type': 'application/json' } : {}
            ),
            ...(operation.kind === 'others'
              ? { body: JSON.stringify({ password: capture.password }) }
              : {}),
          });
          const body: unknown = await response.json().catch(() => null);
          if (!scope.owns(family) || held.current !== capture) return;
          if (rejected(response, body)) return;
          if (response.status !== 200 || !securityReceipt(operation.kind, body)) {
            unknown();
            return;
          }
          if (operation.kind === 'others') {
            if (!(await fresh())) {
              unknown();
              return;
            }
            if (
              !securityOperationConfirmed(
                operation,
                lists.current().sessions,
                lists.current().devices
              )
            ) {
              unknown();
              return;
            }
          } else
            lists.remove(
              operation.kind === 'session' ? 'sessions' : 'devices',
              operation.kind === 'session' ? operation.target.sessionId : operation.target.id
            );
          finish();
        } catch {
          unknown();
        }
      }, feedback.invalid)(event);
    } finally {
      if (scope.isCurrent()) {
        setBusy(false);
        if (!held.current) scope.release(family);
      }
    }
  }
  async function confirm() {
    const capture = held.current;
    if (!scope.owns(family) || !capture || checking.current || busy) return;
    checking.current = true;
    capture.checked = false;
    setChecked(false);
    setBusy(true);
    setError(null);
    try {
      const valid = await fresh();
      if (!scope.owns(family) || held.current !== capture) return;
      if (!valid) {
        setError(text('checkFailed'));
        return;
      }
      if (
        securityOperationConfirmed(operation, lists.current().sessions, lists.current().devices)
      ) {
        finish();
        return;
      }
      capture.checked = true;
      setChecked(true);
      setError(text('stillPresent'));
    } finally {
      checking.current = false;
      if (scope.isCurrent()) setBusy(false);
    }
  }
  function restart() {
    const capture = held.current;
    if (!scope.owns(family) || !capture?.checked || checking.current || busy) return;
    held.current = null;
    setUncertain(false);
    setChecked(false);
    setError(null);
    scope.release(family);
  }
  return {
    form,
    feedback,
    needsPassword,
    busy,
    uncertain,
    checked,
    error,
    submit,
    confirm,
    restart,
  };
}
