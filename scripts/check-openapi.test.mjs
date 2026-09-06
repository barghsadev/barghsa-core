import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertContract, contractText } from './check-openapi.mjs'

test('contract drift catches removed endpoints and required request fields; key order is immaterial', () => {
  const schema = { type: 'object', properties: { previousOtp: { type: 'string' } }, required: ['previousOtp'] }
  const document = { openapi: '3.0.0', paths: { '/api/auth/change-username': { post: { requestBody: { content: { 'application/json': { schema } } } } } } }
  assert.doesNotThrow(() => assertContract(document, { paths: document.paths, openapi: document.openapi }))
  const changed = structuredClone(document)
  changed.paths['/api/auth/change-username'].post.requestBody.content['application/json'].schema.required = []
  assert.throws(() => assertContract(changed, document), /OpenAPI drift/)
  assert.throws(() => assertContract({ openapi: '3.0.0', paths: { '/other': {} } }, document), /OpenAPI drift/)
  assert.throws(() => contractText({ openapi: '3.0.0', paths: {} }), /empty OpenAPI/)
})
