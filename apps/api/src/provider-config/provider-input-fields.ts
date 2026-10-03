import { InputFieldException } from '../common/input-field.exception';
import { SmtpConfigSchema } from './smtp-config.schema';
import { ResendConfigSchema } from './resend-config.schema';

const emailFields: Record<string, string> = {
  host: 'host',
  port: 'port',
  security: 'security',
  username: 'username',
  password: 'password',
  connection_timeout: 'connectionTimeout',
  command_timeout: 'commandTimeout',
  from_name: 'fromName',
  from_email: 'fromEmail',
  reply_to: 'replyTo',
  api_key: 'apiKey',
  sending_domain: 'sendingDomain',
};
const smsFields: Record<string, string> = {
  api_key: 'key',
  sender: 'sender',
  timeout: 'timeout',
  throughput_limit: 'throughput',
  low_credit_threshold: 'credit',
  template_mappings: 'mappings',
};
export function providerInputError(
  issues: readonly { path: readonly PropertyKey[] }[],
  family: 'email' | 'sms'
) {
  const mapping = family === 'email' ? emailFields : smsFields;
  return new InputFieldException(
    issues.map((issue) =>
      issue.path[0] === 'config'
        ? (mapping[String(issue.path[1])] ?? 'config')
        : String(issue.path[0] ?? 'config')
    )
  );
}
/** Validate supplied draft fields; omission preserves existing values and write-only secrets. */
export function validateEmailConfigPatch(
  transport: 'smtp' | 'resend',
  config: Record<string, unknown>,
  clearing = false
) {
  const schema = !clearing
    ? transport === 'smtp'
      ? SmtpConfigSchema.partial()
      : ResendConfigSchema.partial()
    : transport === 'smtp'
      ? SmtpConfigSchema.partial().extend({
          username: SmtpConfigSchema.shape.username.nullable(),
          from_name: SmtpConfigSchema.shape.from_name.nullable(),
          reply_to: SmtpConfigSchema.shape.reply_to.nullable(),
        })
      : ResendConfigSchema.partial().extend({
          from_name: ResendConfigSchema.shape.from_name.nullable(),
          reply_to: ResendConfigSchema.shape.reply_to.nullable(),
          sending_domain: ResendConfigSchema.shape.sending_domain.nullable(),
        });
  const parsed = schema.safeParse(config);
  if (!parsed.success)
    throw providerInputError(
      parsed.error.issues.map((issue) => ({ path: ['config', ...issue.path] })),
      'email'
    );
}
