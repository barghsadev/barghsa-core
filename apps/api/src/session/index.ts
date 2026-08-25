export { SessionService } from './session.service.js'
export { SessionModule } from './session.module.js'
export { SessionAuthGuard, SessionOptionalGuard } from './session.guard.js'
export type { AuthenticatedRequest } from './session.guard.js'
export {
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_SAMESITE,
  SESSION_COOKIE_PATH,
} from './cookie.helper.js'
export type { ValidatedSession, CreatedSession, RefreshResult, DeviceInfo } from './session.service.js'
export { SESSION_IDLE_TIMEOUT_MS, SESSION_ABSOLUTE_TIMEOUT_MS } from './session.service.js'