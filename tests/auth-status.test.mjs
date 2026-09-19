import test from 'node:test';
import assert from 'node:assert/strict';
import {identityStatus} from '../lib/auth-status.mjs';

test('missing identity is anonymous; a partial dispatch identity never authenticates',()=>{
  assert.equal(identityStatus(new Headers()),'anonymous');
  assert.equal(identityStatus(new Headers({'oai-authenticated-user-email':'test@example.com'})),'incomplete');
  assert.equal(identityStatus(new Headers({'oai-authenticated-user-id':'test-id'})),'incomplete');
  assert.equal(identityStatus(new Headers({'oai-authenticated-user-id':' ','oai-authenticated-user-email':'test@example.com'})),'incomplete');
  assert.equal(identityStatus(new Headers({'oai-authenticated-user-id':'test-id','oai-authenticated-user-email':'test@example.com'})),'authenticated');
});
