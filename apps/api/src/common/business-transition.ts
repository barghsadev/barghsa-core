import { ConflictException } from '@nestjs/common';

export function canTransitionState(
  transitions: Readonly<Record<string, readonly string[]>>,
  from: string,
  to: string
): boolean {
  return Object.hasOwn(transitions, from) && transitions[from]?.includes(to) === true;
}

/** Runs inside the caller's locked transaction and idempotency boundary. */
export async function runBusinessTransition<Context, Result>(input: {
  from: string;
  to: string;
  canTransition: (from: string, to: string) => boolean;
  conflict: string;
  guard: () => Context | Promise<Context>;
  effect: (context: Context) => Promise<Result>;
  notify: (result: Result, context: Context) => Promise<void>;
}): Promise<Result> {
  if (!input.canTransition(input.from, input.to)) throw new ConflictException(input.conflict);
  const context = await input.guard();
  const result = await input.effect(context);
  await input.notify(result, context);
  return result;
}
