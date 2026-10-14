const assert = require("assert");
const markAttempt = require("../exam-marking");

const question = {
    _id: "q1",
    question: "Choose the correct option",
    optionA: "Original A",
    optionB: "Original B",
    optionC: "Original C",
    optionD: "Original D",
    answer: "B"
};
const optionOrder = new Map([["q1", ["C", "A", "D", "B"]]]);

const correctSelection = markAttempt([question], optionOrder, { q1: "D" });
assert.strictEqual(correctSelection.score, 1);
assert.strictEqual(correctSelection.review[0].correctAnswer, "D");
assert.strictEqual(correctSelection.review[0].selected, "D");
assert.deepStrictEqual(correctSelection.review[0].options, {
    A: "Original C",
    B: "Original A",
    C: "Original D",
    D: "Original B"
});

const wrongSelection = markAttempt([question], optionOrder, { q1: "B" });
assert.strictEqual(wrongSelection.score, 0);
assert.strictEqual(wrongSelection.review[0].isCorrect, false);

const unanswered = markAttempt([question], optionOrder, {});
assert.strictEqual(unanswered.score, 0);
assert.strictEqual(unanswered.review[0].selected, "");
assert.strictEqual(unanswered.review[0].isCorrect, false);

console.log("Exam marking checks passed: shuffled correct option, wrong selection, unanswered score, and displayed option order.");
