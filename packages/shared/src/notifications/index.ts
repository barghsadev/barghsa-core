/**
 * Notification transport contract shared by the API (outbox writer) and the
 * worker (outbox dispatcher) so both sides type against the same interfaces.
 *
 * @module notifications
 * @see INotificationTransport
 */
export * from './notification-transport.js'