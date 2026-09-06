import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

/** Describe the input shape with the same schema used by the handler.
 * Custom refinements still run on the server; JSON Schema cannot express every refinement.
 */
export function ApiZodBody(schema: z.ZodType): MethodDecorator {
  return ApiBody({
    schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as Extract<
      Parameters<typeof ApiBody>[0],
      { schema: unknown }
    >['schema'],
  });
}
