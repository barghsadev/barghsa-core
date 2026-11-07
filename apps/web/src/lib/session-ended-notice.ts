const key = 'barghsa.session-ended-notice';
const lifetime = 30_000;
let verified = false;

export function recordVerifiedSession() {
  verified = true;
}

/** The marker is only presentation feedback for a real, previously verified session. */
export function rememberSessionEnded(preload: boolean) {
  if (!verified || preload) return;
  verified = false;
  try {
    sessionStorage.setItem(key, String(Date.now() + lifetime));
  } catch {
    // Browser storage must not prevent sign-in navigation.
  }
}

export function hasSessionEndedNotice() {
  try {
    const remaining = Number(sessionStorage.getItem(key)) - Date.now();
    return remaining > 0 && remaining <= lifetime;
  } catch {
    return false;
  }
}

export function clearSessionEndedNotice() {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // A blocked store is already unable to retain the notice.
  }
}
