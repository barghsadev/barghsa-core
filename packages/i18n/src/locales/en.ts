import { englishMessages as app } from '../app.js';
import { englishMessages as auth } from '../auth.js';

export const english: typeof auth & typeof app = { ...auth, ...app };
export type MessageKey = keyof typeof english;
