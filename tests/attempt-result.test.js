const assert = require("assert");
const {
    deterministicResultId,
    finalizeAttemptResult,
    formatLagosDate,
    getAttemptAnswerConflict
} = require("../attempt-result");

function makeMockStore(options = {}) {
    const state = {
        attempt: {
            attemptId: "attempt-test-123",
            status: "active",
            endsAt: new Date("2026-10-14T07:00:00.000Z"),
            questionIds: [],
            answers: {}
        },
        results: new Map(),
        created: 0,
        failFirstCompletion: Boolean(options.failFirstCompletion),
        completionFailures: 0
    };

    const cloneAttempt = () => ({ ...state.attempt });
    return {
        state,
        persistence: {
            findResultById: async id => state.results.get(String(id)) || null,
            claimResultId: async (attemptId, resultId, submittedAt) => {
                if (state.attempt.attemptId !== attemptId) return null;
                if (state.attempt.status !== "active" || state.attempt.resultId) return null;
                state.attempt.resultId = String(resultId);
                state.attempt.submittedAt = submittedAt;
                return cloneAttempt();
            },
            findAttempt: async attemptId => state.attempt.attemptId === attemptId ? cloneAttempt() : null,
            buildResult: async (id, attempt, resultDate) => ({
                _id: String(id),
                studentKey: "student",
                date: resultDate.toLocaleString("en-NG", { timeZone: "Africa/Lagos" }),
                attemptAtBuild: attempt.attemptId
            }),
            saveResult: async result => {
                state.created++;
                if (state.results.has(String(result._id))) {
                    const error = new Error("duplicate result id");
                    error.code = 11000;
                    throw error;
                }
                state.results.set(String(result._id), result);
                return result;
            },
            completeAttempt: async (attempt, result, submittedAt) => {
                if (state.failFirstCompletion && state.completionFailures++ === 0) {
                    throw new Error("simulated crash before attempt status update");
                }
                state.attempt = {
                    ...state.attempt,
                    status: submittedAt.getTime() >= state.attempt.endsAt.getTime() + 15000
                        ? "expired"
                        : "submitted",
                    submittedAt,
                    resultId: String(result._id)
                };
                return cloneAttempt();
            }
        }
    };
}

async function testRepeatedFinalizationUsesOneResult() {
    const { state, persistence } = makeMockStore();
    const originalAttempt = { ...state.attempt };
    const first = await finalizeAttemptResult(originalAttempt, new Date("2026-10-14T06:30:00.000Z"), persistence);
    const second = await finalizeAttemptResult(first.attempt, new Date("2026-10-14T06:31:00.000Z"), persistence);

    assert.strictEqual(state.created, 1);
    assert.strictEqual(state.results.size, 1);
    assert.strictEqual(first.result, second.result);
    assert.strictEqual(first.result._id, deterministicResultId(originalAttempt.attemptId));
    assert.strictEqual(first.attempt.resultId, second.attempt.resultId);
}

async function testCrashAfterResultSaveCanRetry() {
    const { state, persistence } = makeMockStore({ failFirstCompletion: true });
    const originalAttempt = { ...state.attempt };
    const submittedAt = new Date("2026-10-14T06:30:00.000Z");

    await assert.rejects(
        finalizeAttemptResult(originalAttempt, submittedAt, persistence),
        /simulated crash/
    );
    assert.strictEqual(state.results.size, 1);
    assert.strictEqual(state.attempt.status, "active");
    assert.ok(state.attempt.resultId);

    const retried = await finalizeAttemptResult({ ...state.attempt }, submittedAt, persistence);
    assert.strictEqual(state.created, 1);
    assert.strictEqual(retried.result, [...state.results.values()][0]);
    assert.strictEqual(retried.attempt.status, "submitted");
}

async function testDuplicateKeyRetryReadsSameResultId() {
    const { state, persistence } = makeMockStore();
    const staleAttempt = { ...state.attempt };
    const finalizedAt = new Date("2026-10-14T06:30:00.000Z");
    const [first, second] = await Promise.all([
        finalizeAttemptResult(staleAttempt, finalizedAt, persistence),
        finalizeAttemptResult(staleAttempt, finalizedAt, persistence)
    ]);

    assert.strictEqual(state.results.size, 1);
    assert.strictEqual(first.result, second.result);
    assert.strictEqual(first.attempt.resultId, second.attempt.resultId);
}

function testAnswersBlockedWhileFinalizing() {
    const attempt = {
        status: "active",
        resultId: deterministicResultId("attempt-test-123"),
        endsAt: new Date("2026-10-14T07:00:00.000Z")
    };
    assert.strictEqual(getAttemptAnswerConflict(attempt, Date.parse("2026-10-14T06:30:00.000Z")), "finalizing");
}

function testLagosDateUsesExplicitTimezoneAndFallback() {
    assert.strictEqual(
        formatLagosDate(new Date("2026-10-14T05:30:00.000Z")),
        "14/10/2026, 06:30:00"
    );

    const originalToLocaleString = Date.prototype.toLocaleString;
    try {
        Date.prototype.toLocaleString = function (locale, options) {
            if (locale === "en-NG" && options && options.timeZone === "Africa/Lagos") {
                throw new RangeError("simulated missing locale or timezone data");
            }
            return originalToLocaleString.call(this, locale, options);
        };
        assert.strictEqual(
            formatLagosDate(new Date("2026-10-14T05:30:00.000Z")),
            "14/10/2026, 06:30:00"
        );
    } finally {
        Date.prototype.toLocaleString = originalToLocaleString;
    }
}

async function run() {
    await testRepeatedFinalizationUsesOneResult();
    await testCrashAfterResultSaveCanRetry();
    await testDuplicateKeyRetryReadsSameResultId();
    testAnswersBlockedWhileFinalizing();
    testLagosDateUsesExplicitTimezoneAndFallback();
    console.log("Attempt result checks passed: idempotent retries, crash recovery, finalization answer lock, and Lagos date formatting.");
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
