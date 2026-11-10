import { fa as app } from '../app.js';
import { fa as auth } from '../auth.js';
import type { I18nDictionary } from '../app.js';

export const persian: I18nDictionary = { ...auth, ...app };
