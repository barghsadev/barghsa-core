import { expect, it } from 'vitest';
import { tSolar } from './solar.js';
it('localizes postal limits, UTC dates and owned recovery without claiming guidance-read write authority', () => {
  for (const key of [
    'postalCourierInvalid',
    'postalTrackingInvalid',
    'postalSendDateInvalid',
    'postalReceiptInvalid',
    'postalCourierHelp',
    'postalTrackingHelp',
    'postalSendDateHelp',
    'postalReceiptHelp',
    'postalShipmentUnconfirmed',
    'postalReceiptLoadError',
    'postalReasonInvalid',
    'postalReasonHelp',
    'postalAddressInvalid',
    'postalContactInvalid',
    'postalOriginalsInvalid',
    'postalAddressHelp',
    'postalContactHelp',
    'postalGuidanceUnconfirmed',
    'postalGuidanceForbidden',
    'postalGuidanceReload',
    'postalDecisionUnconfirmed',
    'postalDecisionReload',
  ]) {
    expect(tSolar(key, 'en')).not.toBe(key);
    expect(tSolar(key, 'fa')).not.toBe(key);
    expect(tSolar(key, 'en')).not.toBe(tSolar(key, 'fa'));
  }
  expect(tSolar('postalSendDateHelp', 'en')).toContain('UTC');
  expect(tSolar('postalAddressInvalid', 'en')).toContain('2,000');
  expect(tSolar('postalContactInvalid', 'en')).toContain('1,000');
  expect(tSolar('postalOriginalsInvalid', 'en')).toContain('30');
  expect(tSolar('postalOriginalsInvalid', 'en')).toContain('200');
  expect(tSolar('postalGuidanceForbidden', 'en')).not.toMatch(/reload.*access/i);
});
