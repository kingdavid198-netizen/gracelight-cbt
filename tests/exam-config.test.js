const test = require('node:test');
const assert = require('node:assert/strict');
const ExamConfig = require('../ExamConfig');

test('exam config stores a duration per subject or topic', () => {
  assert.ok(ExamConfig.schema.paths.subject, 'subject should exist');
  assert.ok(ExamConfig.schema.paths.durationMinutes, 'durationMinutes should exist');
});
