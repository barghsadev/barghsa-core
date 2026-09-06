import { expect, it } from 'vitest'
import { authErrorCode, rateLimitMessage, retryAfterSeconds } from './auth-errors.js'

it('reads stable error codes without interpreting arbitrary objects as strings', () => {
  expect(authErrorCode({error:{code:'AUTH:LOGIN:PASSWORD_REUSED'}})).toBe('AUTH:LOGIN:PASSWORD_REUSED')
  expect(authErrorCode({error:'AUTH:OTP:INVALID'})).toBe('AUTH:OTP:INVALID')
  expect(authErrorCode({error:{message:'private'}})).toBeUndefined()
})
it('renders finite retry durations in the selected locale and ignores malformed headers', () => {
  const response=new Response('',{status:429,headers:{'Retry-After':'125'}})
  expect(rateLimitMessage(response,'en')).toContain('125 seconds')
  expect(rateLimitMessage(response,'fa')).toContain('۱۲۵ ثانیه')
  for(const value of ['Infinity','-10','99999999999999','garbage','']) {
    const invalid=new Response('',{status:429,headers:{'Retry-After':value}})
    expect(retryAfterSeconds(invalid)).toBeNull()
    expect(rateLimitMessage(invalid,'en')).not.toContain('{seconds}')
  }
  expect(rateLimitMessage(new Response('',{status:401}),'en')).toBeNull()
})
