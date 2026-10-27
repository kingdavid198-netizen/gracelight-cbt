require("dotenv").config({ quiet: true });

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const mongoose = require("mongoose");
const { before, after } = test;
const { connect, requireTestDatabase } = require("../db-connect");
const CandidatePhoto = require("../CandidatePhoto");
const ExamAttempt = require("../ExamAttempt");
const Question = require("../Question");
const Result = require("../Result");

let serverProcess;
let baseUrl;
let serverOutput = "";
const createdPhotoIds = [];
const createdAttemptIds = [];
const createdResultIds = [];
const candidateSuffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

async function unusedPort() {
    return new Promise((resolve, reject) => {
        const listener = net.createServer();
        listener.once("error", reject);
        listener.listen(0, "127.0.0.1", () => {
            const { port } = listener.address();
            listener.close(error => error ? reject(error) : resolve(port));
        });
    });
}

async function waitForServer() {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (serverProcess.exitCode !== null) {
            throw new Error(`Test server exited before listening: ${serverOutput.slice(-1000)}`);
        }
        try {
            const response = await fetch(baseUrl);
            if (response.ok) return;
        } catch (error) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    throw new Error(`Timed out waiting for the test server: ${serverOutput.slice(-1000)}`);
}

async function jsonRequest(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
    return { response, body: await response.json() };
}

async function uploadPhoto(studentKey, photoBytes) {
    const dataUrl = `data:image/jpeg;base64,${photoBytes.toString("base64")}`;
    const { response, body } = await jsonRequest("/candidate-photo", {
        method: "POST",
        body: JSON.stringify({ studentKey, dataUrl })
    });
    assert.equal(response.status, 201);
    assert.ok(body.photoId);
    createdPhotoIds.push(body.photoId);
    return { photoId: body.photoId, dataUrl, photoBytes };
}

async function startAttempt(candidateName, photoId) {
    const payload = {
        studentKey: candidateName.trim().toLowerCase().replace(/\s+/g, " "),
        candidateName,
        subject: "English",
        topic: "Nouns"
    };
    if (photoId) payload.photoId = photoId;
    const { response, body } = await jsonRequest("/attempt/start", {
        method: "POST",
        body: JSON.stringify(payload)
    });
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.ok(body.attemptId);
    createdAttemptIds.push(body.attemptId);
    return body;
}

async function submitAttempt(attemptId) {
    const { response, body } = await jsonRequest(`/attempt/${encodeURIComponent(attemptId)}/submit`, {
        method: "POST",
        body: JSON.stringify({})
    });
    assert.equal(response.status, 200, JSON.stringify(body));
    createdResultIds.push(body.resultId);
    return body;
}

before(async () => {
    await connect();
    console.log(mongoose.connection.name);
    requireTestDatabase();
    const questions = await Question.find({ subject: "English", topic: "Nouns" }).select("_id").lean();
    if (questions.length < 10) throw new Error("Run scripts/seed-sample-data.js before this integration test");

    const port = await unusedPort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn(process.execPath, ["server.js"], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            PORT: String(port),
            REQUIRE_TEST_DATABASE: "true"
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    serverProcess.stdout.on("data", chunk => { serverOutput += chunk.toString(); });
    serverProcess.stderr.on("data", chunk => { serverOutput += chunk.toString(); });
    await waitForServer();
});

after(async () => {
    if (serverProcess && serverProcess.exitCode === null) {
        serverProcess.kill();
        await new Promise(resolve => serverProcess.once("exit", resolve));
    }

    const attemptDocuments = [];
    for (const attemptId of createdAttemptIds) {
        const attempt = await ExamAttempt.findOne({ attemptId }).select("_id").lean();
        if (attempt) attemptDocuments.push(attempt._id);
    }
    const resultIds = [...new Set(createdResultIds)];
    console.log(`${mongoose.connection.name} created record ids: ${JSON.stringify({
        photos: createdPhotoIds,
        attempts: attemptDocuments.map(String),
        results: resultIds
    })}`);

    const deleted = { photos: 0, attempts: 0, results: 0 };
    if (createdPhotoIds.length) {
        deleted.photos = (await CandidatePhoto.deleteMany({ _id: { $in: createdPhotoIds } })).deletedCount;
    }
    for (const attemptId of attemptDocuments) {
        deleted.attempts += (await ExamAttempt.deleteOne({ _id: attemptId })).deletedCount;
    }
    for (const resultId of resultIds) {
        deleted.results += (await Result.deleteOne({ _id: resultId })).deletedCount;
    }
    console.log(`${mongoose.connection.name} cleanup: photos=${deleted.photos}, attempts=${deleted.attempts}, results=${deleted.results}`);
    await mongoose.disconnect();
});

test("real-server candidate photos remain bound to their results and finalization stays idempotent", async () => {
    const baseJpeg = Buffer.from(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=",
        "base64"
    );
    const makePhoto = marker => Buffer.concat([
        baseJpeg.subarray(0, 2),
        Buffer.from([0xff, 0xfe, 0x00, 0x06, ...Buffer.from(marker)]),
        baseJpeg.subarray(2)
    ]);

    const firstName = `Long Candidate ${"Name ".repeat(20)}${candidateSuffix}`;
    assert.ok(firstName.length > 100 && firstName.length <= 200);
    const secondName = `Candidate Two ${candidateSuffix}`;
    const noPhotoName = `Candidate No Photo ${candidateSuffix}`;

    const approximately40KbJpeg = Buffer.concat([
        Buffer.from([0xff, 0xd8]),
        Buffer.from([0xff, 0xfe, 0xa0, 0x02]),
        Buffer.alloc(40958, 0x41),
        baseJpeg.subarray(2)
    ]);
    assert.ok(approximately40KbJpeg.length >= 40 * 1024);
    const acceptedPhoto = await uploadPhoto(`upload-limit-${candidateSuffix}`, approximately40KbJpeg);
    assert.ok(acceptedPhoto.photoBytes.length >= 40 * 1024);

    const oversizedBody = JSON.stringify({
        studentKey: "oversized-request",
        dataUrl: "data:image/jpeg;base64,",
        padding: ""
    });
    const paddingLength = 300 * 1024 - Buffer.byteLength(oversizedBody);
    const threeHundredKbBody = JSON.stringify({
        studentKey: "oversized-request",
        dataUrl: "data:image/jpeg;base64,",
        padding: "x".repeat(paddingLength)
    });
    assert.equal(Buffer.byteLength(threeHundredKbBody), 300 * 1024);
    const oversizedResponse = await fetch(`${baseUrl}/candidate-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: threeHundredKbBody
    });
    assert.equal(oversizedResponse.status, 413);

    const firstPhoto = await uploadPhoto(firstName.toLowerCase(), makePhoto("ONE!"));
    const secondPhoto = await uploadPhoto(secondName.toLowerCase(), makePhoto("TWO!"));
    assert.notEqual(firstPhoto.photoId, secondPhoto.photoId);
    assert.notEqual(firstPhoto.dataUrl, secondPhoto.dataUrl);

    const invalidPhoto = await jsonRequest("/candidate-photo", {
        method: "POST",
        body: JSON.stringify({ studentKey: "invalid", dataUrl: "data:image/jpeg;base64,SGVsbG8=" })
    });
    assert.equal(invalidPhoto.response.status, 400);

    const firstAttempt = await startAttempt(firstName, firstPhoto.photoId);
    const firstSubmit = await submitAttempt(firstAttempt.attemptId);
    const repeatedSubmit = await submitAttempt(firstAttempt.attemptId);
    assert.equal(firstSubmit.resultId, repeatedSubmit.resultId);
    assert.equal(firstSubmit.result.photoId, firstPhoto.photoId);
    assert.equal(repeatedSubmit.result.photoId, firstPhoto.photoId);

    const photoResponse = await fetch(`${baseUrl}/candidate-photo/${firstSubmit.resultId}`, { cache: "no-store" });
    assert.equal(photoResponse.status, 200);
    assert.equal(photoResponse.headers.get("content-type"), "image/jpeg");
    assert.match(photoResponse.headers.get("cache-control"), /private/);
    assert.match(photoResponse.headers.get("cache-control"), /no-store/);
    assert.deepEqual(Buffer.from(await photoResponse.arrayBuffer()), firstPhoto.photoBytes);

    const secondAttempt = await startAttempt(secondName, secondPhoto.photoId);
    const secondSubmit = await submitAttempt(secondAttempt.attemptId);
    assert.equal(secondSubmit.result.photoId, secondPhoto.photoId);
    const secondPhotoResponse = await fetch(`${baseUrl}/candidate-photo/${secondSubmit.resultId}`);
    assert.deepEqual(Buffer.from(await secondPhotoResponse.arrayBuffer()), secondPhoto.photoBytes);

    const noPhotoAttempt = await startAttempt(noPhotoName);
    const noPhotoSubmit = await submitAttempt(noPhotoAttempt.attemptId);
    assert.equal(noPhotoSubmit.result.photoId, undefined);
    const noPhotoResponse = await fetch(`${baseUrl}/candidate-photo/${noPhotoSubmit.resultId}`);
    assert.equal(noPhotoResponse.status, 404);

    const oldResult = await new Result({
        studentKey: `old-result-${candidateSuffix}`,
        candidateName: "Legacy Candidate",
        subject: "English",
        topic: "Nouns",
        score: 0,
        totalQuestions: 10,
        percentage: 0,
        remark: "Fail",
        date: "Legacy date"
    }).save();
    createdResultIds.push(String(oldResult._id));
    const oldPhotoResponse = await fetch(`${baseUrl}/candidate-photo/${oldResult._id}`);
    assert.equal(oldPhotoResponse.status, 404);

    const historyResponse = await fetch(`${baseUrl}/results/${encodeURIComponent(firstName.toLowerCase())}`);
    const historyBody = await historyResponse.text();
    assert.equal(historyResponse.status, 200);
    assert.equal(historyBody.includes("data:image/jpeg"), false);
    const allResultsResponse = await fetch(`${baseUrl}/results`);
    const allResultsBody = await allResultsResponse.text();
    assert.equal(allResultsBody.includes("data:image/jpeg"), false);

    const wrongOwnerStart = await jsonRequest("/attempt/start", {
        method: "POST",
        body: JSON.stringify({
            studentKey: "unrelated candidate",
            candidateName: "Unrelated Candidate",
            subject: "English",
            topic: "Nouns",
            photoId: firstPhoto.photoId
        })
    });
    assert.equal(wrongOwnerStart.response.status, 404);
});
