const test = require('node:test');
const assert = require('node:assert/strict');
const Submission = require('../Submission');

test('assignment submissions store multiple files on one attempt', () => {
  const fileSchema = Submission.schema.path('files').schema;
  assert.ok(fileSchema.paths.url);
  assert.ok(fileSchema.paths.originalName);
  assert.ok(fileSchema.paths.publicId);
  assert.ok(Submission.schema.paths.fileUrl, 'legacy single-file submissions should remain readable');
});

test('assignment submissions allow repeated attempts by the same student', () => {
  const hasUniqueAssignmentStudentIndex = Submission.schema.indexes().some(([fields, options]) =>
    fields.assignment && fields.studentKey && options.unique
  );
  assert.equal(hasUniqueAssignmentStudentIndex, false);
});