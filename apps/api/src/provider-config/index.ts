export * from './email-provider-config.service'
export * from './email-provider-config.controller'
export * from './email-circuit-breaker.service'
export * from './smtp-config.schema'
export * from './smtp-network-guard'
export * from './smtp-connection-tester.service'
export * from './resend-config.schema'
export * from './resend-connection-tester.service'
export * from './provider-secrets.service'
export * from './smsir-config.schema'
export * from './smsir-connection-tester.service'
export * from './provider-config.module'

// `ProviderConfigBody` is intentionally exported from BOTH the email and sms
// provider config services (identical opaque-blob type). Re-export it once here
// so the barrel has a single unambiguous binding.
export type { ProviderConfigBody } from './sms-provider-config.service'
export { SmsProviderConfigService, SMS_PROVIDER_TRANSPORT } from './sms-provider-config.service'
export * from './sms-provider-config.controller'
