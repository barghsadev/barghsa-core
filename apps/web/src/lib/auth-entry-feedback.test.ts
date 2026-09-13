import { afterEach, expect, it } from 'vitest';
import { takeAuthSuccess } from './auth-entry-feedback.js';

afterEach(() => sessionStorage.clear());
it('consumes a recent success message only once', () => {
  sessionStorage.setItem(
    'barghsa.auth-entry-feedback',
    JSON.stringify({ message: 'Signed in', expires: Date.now() + 10000 })
  );
  expect(takeAuthSuccess()).toBe('Signed in');
  expect(takeAuthSuccess()).toBeNull();
});
it.each([
  'invalid-json',
  JSON.stringify({ message: '<old>', expires: 0 }),
  JSON.stringify({ message: {}, expires: Date.now() + 10000 }),
  JSON.stringify({ message: 'future', expires: Date.now() + 90000 }),
])('discards invalid or stale stored feedback: %s', (raw) => {
  sessionStorage.setItem('barghsa.auth-entry-feedback', raw);
  expect(takeAuthSuccess()).toBeNull();
  expect(sessionStorage.getItem('barghsa.auth-entry-feedback')).toBeNull();
});
