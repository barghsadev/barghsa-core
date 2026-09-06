import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import {
  AiModelSecrets,
  AI_MODEL_SECRETS_KEY,
  AI_MODEL_ENCRYPTION_ENV,
} from '@barghsa/shared/ai-models';
export {
  isMaskedAiToken,
  isEncryptedAiToken,
  AI_MODEL_SECRETS_KEY,
  AI_MODEL_ENCRYPTION_ENV,
} from '@barghsa/shared/ai-models';
@Injectable()
export class AiModelSecretsService extends AiModelSecrets {
  constructor(@Optional() @Inject(AI_MODEL_SECRETS_KEY) key?: Buffer | string) {
    super(key);
    if (!this.available)
      new Logger(AiModelSecretsService.name).warn(
        `${AI_MODEL_ENCRYPTION_ENV} is not set; token storage is unavailable.`
      );
  }
}
