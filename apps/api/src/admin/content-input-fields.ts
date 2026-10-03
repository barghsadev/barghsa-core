import { InputFieldException } from '../common/input-field.exception.js';
/** Publish only known field names; never validator text or submitted document content. */
export function rejectContentFields(
  issues: readonly { path: readonly PropertyKey[] }[],
  owned: readonly string[]
): never {
  throw new InputFieldException(
    issues.flatMap((issue) => {
      const field = issue.path[0];
      return typeof field === 'string' && owned.includes(field) ? [field] : [];
    })
  );
}
