import { expect, it } from 'vitest'
import { fa, en, t } from './auth.js'
import { dictionaries } from './index.js'

it('keeps public authentication and terms translations complete and consistent with the full dictionaries',()=>{
  for(const locale of ['fa','en'] as const){
    const subset=locale==='fa'?fa:en
    for(const [key,value] of Object.entries(dictionaries[locale])){
      if(/^(auth\.|error\.|common\.|tos\.)/.test(key)) expect(subset[key],key).toBe(value)
    }
    for(const [key,value] of Object.entries(subset)) expect(t(key,locale)).toBe(value)
  }
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort())
  expect(t('missing.translation')).toBe('missing.translation')
})
