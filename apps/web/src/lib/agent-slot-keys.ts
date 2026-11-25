export const SLOT_KEYS = [
  'individual_chatbot',
  'legal_entity_chatbot',
  'staff_chatbot',
  'website_chatbot',
  'telegram_chatbot',
] as const;

export type SlotKey = (typeof SLOT_KEYS)[number];

export function isAgentSlotKey(value: string): value is SlotKey {
  return SLOT_KEYS.some((key) => key === value);
}
