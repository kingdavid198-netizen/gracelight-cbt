const test = require('node:test');
const assert = require('node:assert/strict');
const Result = require('../Result');

test('result records keep a student key for history tracking', () => {
  assert.ok(Result.schema.paths.studentKey, 'studentKey should exist in the schema');
  assert.ok(Result.schema.paths.candidateName, 'candidateName should still exist');
});
