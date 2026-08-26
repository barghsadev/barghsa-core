/**
 * In-app notification service (minimal stub for E-02 scope).
 *
 * Provides lightweight in-app notification creation and retrieval.
 * The full notification infrastructure (email/SMS transport, outbox,
 * worker, delivery service) belongs to E-05.
 *
 * @module NotificationsModule
 */

export { NotificationsModule } from './notifications.module.js'
export { NotificationsService } from './notifications.service.js'
