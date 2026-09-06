import { Injectable, Inject, Optional } from '@nestjs/common';
import {
  AiModelTester,
  AI_MODEL_API_CLIENT,
  type AiModelApiClientLike,
} from '@barghsa/shared/ai-models';
export * from '@barghsa/shared/ai-models';
@Injectable()
export class AiModelTesterService extends AiModelTester {
  constructor(@Optional() @Inject(AI_MODEL_API_CLIENT) client?: AiModelApiClientLike) {
    super(client);
  }
}
