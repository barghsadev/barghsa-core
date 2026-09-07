/** Resolve only declared messages. Object prototype members are not translations. */
export function lookup(
  dictionary: Readonly<Record<string, string>>,
  key: string
): string | undefined {
  return Object.hasOwn(dictionary, key) ? dictionary[key] : undefined;
}
