/**
 * Notification transport contract shared by the API (outbox writer) and the
 * worker (outbox dispatcher) so both sides type against the same interfaces.
 *
 * Also exports the code-defined notification type registry & classification
 * (E-05, T-05.03.01) that drives delivery-window behaviour.
 *
 * @module notifications
 * @see INotificationTransport
 */
export * from './notification-transport.js'
export * from './notification-registry.js'
