import { expect, it } from 'vitest'
import { trustedProxyIps } from './proxy-trust.js'

it('defaults to no trust and accepts only explicit proxy addresses',()=>{
  expect(trustedProxyIps('')).toEqual([])
  expect(trustedProxyIps('127.0.0.1, ::1,127.0.0.1')).toEqual(['127.0.0.1','::1'])
  for(const value of ['true','1','*','0.0.0.0','::','0.0.0.0/0','127.0.0.1,','proxy.example.test']) {
    expect(()=>trustedProxyIps(value)).toThrow('explicit proxy IP')
  }
})
