const crypto = require("crypto");

function getAttemptAnswerConflict(attempt, now = Date.now()) {
    if (attempt.resultId) return "finalizing";
    if (attempt.status !== "active") return "inactive";
    if (now > attempt.endsAt.getTime()) return "deadline";
    return null;
}

function formatLagosDate(date) {
    try {
        return date.toLocaleString("en-NG", { timeZone: "Africa/Lagos" });
    } catch (error) {
        const lagosTime = new Date(date.getTime() + 60 * 60 * 1000);
        const pad = value => String(value).padStart(2, "0");
        return `${pad(lagosTime.getUTCDate())}/${pad(lagosTime.getUTCMonth() + 1)}/${lagosTime.getUTCFullYear()}, ${pad(lagosTime.getUTCHours())}:${pad(lagosTime.getUTCMinutes())}:${pad(lagosTime.getUTCSeconds())}`;
    }
}

function deterministicResultId(attemptId) {
    return crypto.createHash("sha256")
        .update(String(attemptId))
        .digest("hex")
        .slice(0, 24);
}

async function finalizeAttemptResult(attempt, finalizedAt, persistence) {
    let currentAttempt = attempt;
    let resultDate = finalizedAt;
    let resultId = currentAttempt.resultId || deterministicResultId(currentAttempt.attemptId);
    let result = await persistence.findResultById(resultId);

    if (!result) {
        if (!currentAttempt.resultId) {
            currentAttempt = await persistence.claimResultId(
                currentAttempt.attemptId,
                resultId,
                resultDate
            ) || await persistence.findAttempt(currentAttempt.attemptId);
            resultId = currentAttempt.resultId || resultId;
            resultDate = currentAttempt.submittedAt || resultDate;
        }

        result = await persistence.findResultById(resultId);
        if (!result) {
            const resultDocument = await persistence.buildResult(resultId, currentAttempt, resultDate);
            try {
                result = await persistence.saveResult(resultDocument);
            } catch (error) {
                if (error.code !== 11000) throw error;
                result = await persistence.findResultById(resultId);
                if (!result) throw error;
            }
        }
    } else {
        resultDate = currentAttempt.submittedAt || resultDate;
    }

    const completedAttempt = await persistence.completeAttempt(currentAttempt, result, resultDate);
    return { attempt: completedAttempt, result };
}

module.exports = {
    deterministicResultId,
    finalizeAttemptResult,
    formatLagosDate,
    getAttemptAnswerConflict
};
