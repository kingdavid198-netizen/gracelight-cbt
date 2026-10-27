const test = require("node:test");
const assert = require("node:assert/strict");
const formatResultDate = require("../public/result-date");

test("result date uses a Lagos timestamp in the slip format", () => {
    assert.equal(
        formatResultDate({ createdAt: "2026-10-27T17:05:00.000Z", date: "old date" }),
        "27 Oct 2026, 6:05 PM"
    );
});

test("result date falls back to the stored date for old results", () => {
    assert.equal(formatResultDate({ date: "27/10/2026, 18:05" }), "27/10/2026, 18:05");
    assert.equal(formatResultDate({}), "N/A");
});
