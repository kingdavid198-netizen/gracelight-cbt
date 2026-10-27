require('dotenv').config();
const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const XLSX = require("xlsx");
const mongoose = require("mongoose");
const { connect, requireTestDatabase } = require("./db-connect");
const crypto = require("crypto");
const Question = require("./Question");
const ExamAttempt = require("./ExamAttempt");
const CandidatePhoto = require("./CandidatePhoto");
const markAttempt = require("./exam-marking");
const {
    finalizeAttemptResult,
    formatLagosDate,
    getAttemptAnswerConflict
} = require("./attempt-result");
const Result = require("./Result");
const Pin = require("./Pin");
const Formula = require("./Formula");
const Assignment = require("./Assignment");
const Submission = require("./Submission");
const ExamConfig = require("./ExamConfig");
const IntegrityEvent = require("./IntegrityEvent");
const cloudinary = require("./cloudinary");

const app = express();
app.set("trust proxy", 1);

const integrityIpBuckets = new Map();
const answerAttemptBuckets = new Map();
const candidatePhotoIpBuckets = new Map();
const integrityRateWindowMs = 60 * 1000;
const integrityRateLimit = 30;
const attemptAnswerRateLimit = 120;
const candidatePhotoRateLimit = 10;
const attemptSubmitGraceMs = 15 * 1000;
const requiresTestDatabase = process.env.NODE_ENV === "test" || process.env.REQUIRE_TEST_DATABASE === "true";

const integrityBucketCleanup = setInterval(() => {
    const cutoff = Date.now() - integrityRateWindowMs;
    for (const buckets of [integrityIpBuckets, answerAttemptBuckets, candidatePhotoIpBuckets]) {
        for (const [key, timestamps] of buckets) {
            const recent = timestamps.filter(timestamp => timestamp > cutoff);
            if (recent.length) {
                buckets.set(key, recent);
            } else {
                buckets.delete(key);
            }
        }
    }
}, integrityRateWindowMs);
if (typeof integrityBucketCleanup.unref === "function") integrityBucketCleanup.unref();

const resourceSubjectAliases = [
    ["Account", "Financial Accounting"],
    ["CRS", "Christian Religious Studies"],
    ["English", "English Language"],
    ["Literature", "Literature in English"]
];

function resourceSubjectFilter(subject) {
    const aliases = resourceSubjectAliases.find(group => group.includes(subject));
    return { $in: aliases || [subject] };
}

if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads", { recursive: true });
}

const databaseReady = connect()
.then(async () => {
    if (requiresTestDatabase) {
        requireTestDatabase();
    }
    console.log("MongoDB Connected");
    try {
        await Submission.collection.dropIndex("assignment_1_studentKey_1");
    } catch (error) {
        if (error.code !== 26 && error.code !== 27) throw error;
    }
    await Submission.collection.createIndex(
        { assignment: 1, studentKey: 1 },
        { name: "assignment_student_lookup" }
    );
    return true;
})
.catch(error => {
    if (requiresTestDatabase) {
        console.error(`MongoDB test connection failed: ${error.name || "Error"}`);
        process.exit(1);
    }
    console.log(error);
    return false;
});

app.use("/integrity-event", express.json({ limit: "4kb" }));
app.post("/candidate-photo", rateLimitCandidatePhoto, express.json({ limit: "140kb" }), async (req, res) => {
    try {
        const body = req.body || {};
        const studentKey = typeof body.studentKey === "string" ? normalizeStudentKey(body.studentKey) : "";
        const match = typeof body.dataUrl === "string"
            ? body.dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/)
            : null;
        if (!studentKey || studentKey.length > 200 || !match || Object.keys(body).some(key => !["studentKey", "dataUrl"].includes(key))) {
            return res.status(400).json({ success: false, message: "A student key and JPEG data URL are required" });
        }

        const jpeg = Buffer.from(match[1], "base64");
        if (jpeg.length > 100 * 1024 || jpeg.toString("base64") !== match[1] ||
            jpeg.length < 3 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) {
            return res.status(400).json({ success: false, message: "The JPEG photo is invalid or exceeds 100KB" });
        }

        const photo = new CandidatePhoto({
            studentKey,
            dataUrl: body.dataUrl,
            size: jpeg.length
        });
        await photo.save();
        return res.status(201).json({ photoId: String(photo._id) });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Unable to save candidate photo" });
    }
});
/* TODO: Protect candidate photo upload in the security phase. */
app.use(express.json({ limit: "1mb" }));

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use("/uploads", express.static("uploads"));

const storage = multer.diskStorage({

    destination: function(req, file, cb){
        cb(null, "uploads/");
    },

    filename: function(req, file, cb){

        const uniqueName =
            Date.now() +
            path.extname(file.originalname);

        cb(null, uniqueName);
    }

});

const upload = multer({
  
    storage: storage
});

const submissionUpload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 10 },
    fileFilter(req, file, callback){
        if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
            return callback(null, true);
        }
        const error = new Error(`\"${file.originalname}\" is not an image or PDF. Choose image files or PDFs only.`);
        error.code = "INVALID_FILE_TYPE";
        callback(error);
    }
});

const excelUpload = multer({
  storage: multer.memoryStorage()
});

const questionsFile = "questions.json";

if (!fs.existsSync(questionsFile)) {
    fs.writeFileSync(questionsFile, "[]");
}

app.get("/topics/:subject", async (req, res) => {

    try {

        const subject = req.params.subject;

        const questions = await Question.find({
            subject: subject
        });

        const topics = [
            ...new Set(
                questions.map(q => q.topic)
            )
        ];

        res.json(topics);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

app.post("/formulas", upload.single("image"), async (req, res) => {

    try {

        let imageUrl = "";

if (req.file) {
  const result = await cloudinary.uploader.upload(
    req.file.path,
    {
      folder: "gracelight-formulas"
    }
  );

  imageUrl = result.secure_url;

  fs.unlinkSync(req.file.path);
}

const formula = new Formula({
  subject: req.body.subject,
    topic: req.body.topic || "",
  title: req.body.title,
  content: req.body.content,
  image: imageUrl
});

await formula.save();

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false
        });

    }

});

app.get("/formulas", async (req, res) => {

    try {

        const filters = {};
        if (req.query.subject) filters.subject = resourceSubjectFilter(req.query.subject);
        if (req.query.topic) filters.topic = req.query.topic;

        const formulas = await Formula.find(filters)
            .sort({ subject: 1 });

        res.json(formulas);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

app.put("/formulas/:id", upload.single("image"), async (req, res) => {

    try {

        const updates = {
            subject: req.body.subject,
            topic: req.body.topic || "",
            title: req.body.title,
            content: req.body.content
        };

        if (req.file) {
            const result = await cloudinary.uploader.upload(
                req.file.path,
                {
                    folder: "gracelight-formulas"
                }
            );

            updates.image = result.secure_url;
            fs.unlinkSync(req.file.path);
        }

        const formula = await Formula.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!formula) {
            return res.status(404).json({ success: false, message: "Note not found" });
        }

        res.json({ success: true });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false
        });

    }

});

app.delete("/formulas/:id", async (req, res) => {

    try {

        await Formula.findByIdAndDelete(
            req.params.id
        );

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false
        });

    }

});

app.post("/bulk-formulas", upload.single("file"), async (req, res) => {

    try {

        const workbook = XLSX.readFile(req.file.path);

        const sheet =
            workbook.Sheets[
                workbook.SheetNames[0]
            ];

        const rows =
            XLSX.utils.sheet_to_json(sheet);

        let count = 0;

        for (const row of rows) {

            await Formula.create({
                
subject: row.Subject || row.subject || "", 
topic: row.Topic || row.topic || "",
title: row.Title || row.title || "",
content: row.Content || row.content || "",
image: row.Image || row.image || ""

            });

            count++;

        }

        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            count
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false
        });

    }

});

app.get("/assignments", async (req, res) => {
    try {
        const filters = {};
        if (req.query.subject) filters.subject = resourceSubjectFilter(req.query.subject);
        if (req.query.topic) filters.topic = req.query.topic;

        const assignments = await Assignment.find(filters).sort({ dueDate: 1, createdAt: -1 });
        res.json(assignments);
    } catch (error) {
        console.log(error);
        res.json([]);
    }
});

app.post("/bulk-assignments", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "Spreadsheet file is required" });
    }

    let count = 0;
    let skipped = 0;
    try {
        const workbook = XLSX.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        for (const row of rows) {
            const subject = row.Subject || row.subject || "";
            const topic = row.Topic || row.topic || "";
            const title = row.Title || row.title || "";
            const instructions = row.Instructions || row.instructions || row.Content || row.content || "";
            const rawDueDate = row["Due Date"] || row.DueDate || row.dueDate || "";

            if (!subject || !topic || !title || !instructions) {
                skipped++;
                continue;
            }

            let dueDate = null;
            if (rawDueDate) {
                if (typeof rawDueDate === "number") {
                    const dateParts = XLSX.SSF.parse_date_code(rawDueDate);
                    if (dateParts) {
                        dueDate = new Date(Date.UTC(
                            dateParts.y,
                            dateParts.m - 1,
                            dateParts.d,
                            dateParts.H,
                            dateParts.M,
                            dateParts.S
                        ));
                    }
                } else {
                    const parsedDate = new Date(rawDueDate);
                    if (!Number.isNaN(parsedDate.getTime())) dueDate = parsedDate;
                }
            }

            await Assignment.create({ subject, topic, title, instructions, dueDate });
            count++;
        }

        res.json({ success: true, count, skipped });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Unable to upload assignments" });
    } finally {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
});

app.post("/assignments", async (req, res) => {
    try {
        const assignment = await Assignment.create({
            subject: req.body.subject,
            topic: req.body.topic || "",
            title: req.body.title,
            instructions: req.body.instructions,
            dueDate: req.body.dueDate || null
        });
        res.json({ success: true, assignmentId: assignment._id });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false });
    }
});

app.delete("/assignments/:id", async (req, res) => {
    try {
        await Assignment.findByIdAndDelete(req.params.id);
        await Submission.deleteMany({ assignment: req.params.id });
        res.json({ success: true });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false });
    }
});

app.get("/assignments/:id/submissions", async (req, res) => {
    try {
        const filters = { assignment: req.params.id };
        if (req.query.studentKey) {
            filters.studentKey = normalizeStudentKey(req.query.studentKey);
        }
        const submissions = await Submission.find(filters)
            .sort({ submittedAt: -1 });
        res.json(submissions);
    } catch (error) {
        console.log(error);
        res.json([]);
    }
});

app.delete("/assignments/:id/submissions/:submissionId/files/:fileId", async (req, res) => {
    try {
        const studentKey = normalizeStudentKey(req.body.studentKey);
        if (!studentKey) {
            return res.status(400).json({ success: false, message: "Student name is required" });
        }

        const submission = await Submission.findOne({
            _id: req.params.submissionId,
            assignment: req.params.id,
            studentKey
        });
        if (!submission) {
            return res.status(404).json({ success: false, message: "Uploaded file not found" });
        }

        const submissionFile = submission.files.id(req.params.fileId);
        if (submissionFile) {
            await cloudinary.uploader.destroy(submissionFile.publicId, {
                resource_type: submissionFile.resourceType || "image"
            });
            submission.files.pull(submissionFile._id);
        } else if (req.params.fileId === "legacy" && submission.fileUrl) {
            if (submission.publicId) {
                await cloudinary.uploader.destroy(submission.publicId, {
                    resource_type: submission.resourceType || "image"
                });
            }
            submission.fileUrl = undefined;
            submission.fileName = undefined;
            submission.fileType = undefined;
            submission.publicId = undefined;
            submission.resourceType = undefined;
        } else {
            return res.status(404).json({ success: false, message: "Uploaded file not found" });
        }
        await submission.save();
        res.json({ success: true });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Unable to remove this file" });
    }
});

app.post("/assignments/:id/submissions", (req, res, next) => {
    submissionUpload.array("files", 10)(req, res, error => {
        if (error) {
            const message = error.code === "LIMIT_FILE_SIZE"
                ? "One of the selected files is larger than 10 MB. Each file must be 10 MB or smaller."
                : error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE"
                    ? "Choose no more than 10 files per submission."
                    : error.message;
            for (const file of req.files || []) {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            }
            return res.status(400).json({ success: false, message });
        }
        next();
    });
}, async (req, res) => {
    const files = req.files || [];
    const uploadedFiles = [];
    let uploadingFile = null;
    try {
        if (!await databaseReady) {
            return res.status(503).json({ success: false, message: "Submission service is unavailable" });
        }
        const studentKey = normalizeStudentKey(req.body.studentKey || req.body.studentName);
        const answer = String(req.body.answer || "").trim();
        if (!studentKey || (!answer && !files.length)) {
            return res.status(400).json({ success: false, message: "Student name and an answer or file are required" });
        }

        for (const file of files) {
            uploadingFile = file;
            const result = await cloudinary.uploader.upload(file.path, {
                folder: "gracelight-assignment-submissions",
                resource_type: "auto"
            });
            uploadedFiles.push({
                url: result.secure_url,
                originalName: file.originalname,
                publicId: result.public_id,
                fileType: file.mimetype,
                resourceType: result.resource_type
            });
        }

        uploadingFile = null;
        const submission = await Submission.create({
            assignment: req.params.id,
            studentKey,
            studentName: req.body.studentName || studentKey,
            answer,
            files: uploadedFiles,
            submittedAt: new Date()
        });
        uploadedFiles.length = 0;
        res.json({ success: true, submissionId: submission._id });
    } catch (error) {
        console.log(error);
        for (const file of uploadedFiles) {
            try {
                await cloudinary.uploader.destroy(file.publicId, {
                    resource_type: file.resourceType || "image"
                });
            } catch (cleanupError) {
                console.log(cleanupError);
            }
        }
        const message = uploadingFile
            ? `Unable to upload \"${uploadingFile.originalname}\". No submission was saved.`
            : "Unable to save your submission. No submission was saved.";
        res.status(500).json({ success: false, message });
    } finally {
        for (const file of files) {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }
    }
});

// TODO: /questions exposes answer keys; protect it with admin authentication in the security phase.
app.get("/questions", async (req, res) => {

    try {

        const questions = await Question.find();

        res.json(questions);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

function shuffleItems(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index--) {
        const swapIndex = crypto.randomInt(index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

function getAttemptOptionOrder(attempt) {
    return new Map((attempt.optionOrder || []).map(entry => [String(entry.questionId), entry.order]));
}

async function getAttemptQuestions(attempt) {
    const questions = await Question.find({ _id: { $in: attempt.questionIds } }).lean();
    const questionMap = new Map(questions.map(question => [String(question._id), question]));
    const optionOrder = getAttemptOptionOrder(attempt);
    const labels = ["A", "B", "C", "D"];
    return attempt.questionIds.map((questionId, index) => {
        const question = questionMap.get(String(questionId));
        if (!question) return null;
        const order = optionOrder.get(String(questionId)) || labels;
        const options = {};
        labels.forEach((label, optionIndex) => {
            options[label] = question[`option${order[optionIndex]}`] || "";
        });
        return {
            questionId: String(question._id),
            questionNumber: index + 1,
            question: question.question || "",
            image: question.image || "",
            options
        };
    }).filter(Boolean);
}

async function buildAttemptResponse(attempt, now = new Date()) {
    const response = {
        attemptId: attempt.attemptId,
        studentKey: attempt.studentKey,
        candidateName: attempt.candidateName,
        subject: attempt.subject,
        topic: attempt.topic,
        startedAt: attempt.startedAt,
        endsAt: attempt.endsAt,
        serverNow: now,
        status: attempt.status,
        questions: await getAttemptQuestions(attempt),
        answers: attempt.answers || {}
    };
    if (attempt.status !== "active") {
        const result = attempt.resultId ? await Result.findById(attempt.resultId).lean() : null;
        response.result = result || null;
        response.resultId = result ? String(result._id) : null;
    }
    return response;
}

async function finalizeAttempt(attempt, finalizedAt = new Date()) {
    const finalized = await finalizeAttemptResult(attempt, finalizedAt, {
        findResultById: resultId => Result.findById(resultId),
        claimResultId: (attemptId, resultId, submittedAt) => ExamAttempt.findOneAndUpdate(
            {
                attemptId,
                status: "active",
                $or: [{ resultId: { $exists: false } }, { resultId: null }]
            },
            { $set: { resultId, submittedAt } },
            { new: true }
        ),
        findAttempt: attemptId => ExamAttempt.findOne({ attemptId }),
        buildResult: async (resultId, claimedAttempt, resultDate) => {
            const questions = await Question.find({ _id: { $in: claimedAttempt.questionIds } }).lean();
            const questionMap = new Map(questions.map(question => [String(question._id), question]));
            const optionOrder = getAttemptOptionOrder(claimedAttempt);
            const answers = claimedAttempt.answers || {};
            const orderedQuestions = claimedAttempt.questionIds
                .map(questionId => questionMap.get(String(questionId)))
                .filter(Boolean);
            const { score, review: answersReview } = markAttempt(orderedQuestions, optionOrder, answers);

            const totalQuestions = claimedAttempt.questionIds.length;
            const percentage = totalQuestions ? Math.round((score / totalQuestions) * 100) : 0;
            const remark = percentage >= 80 ? "Excellent" : percentage >= 50 ? "Pass" : "Fail";
            return new Result({
                _id: resultId,
                studentKey: claimedAttempt.studentKey,
                candidateName: claimedAttempt.candidateName,
                photoId: claimedAttempt.photoId,
                subject: claimedAttempt.subject,
                topic: claimedAttempt.topic,
                score,
                totalQuestions,
                percentage,
                remark,
                date: formatLagosDate(resultDate),
                answersReview
            });
        },
        saveResult: resultDocument => resultDocument.save(),
        completeAttempt: async (currentAttempt, result, resultDate) => {
            const status = resultDate.getTime() >= currentAttempt.endsAt.getTime() + attemptSubmitGraceMs
                ? "expired"
                : "submitted";
            const updatedAttempt = await ExamAttempt.findOneAndUpdate(
                { attemptId: currentAttempt.attemptId, status: "active" },
                { $set: { status, submittedAt: resultDate, resultId: result._id } },
                { new: true }
            );
            return updatedAttempt || ExamAttempt.findOne({ attemptId: currentAttempt.attemptId });
        }
    });
    return finalized;
}

function rateLimitCandidatePhoto(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const recent = (candidatePhotoIpBuckets.get(key) || [])
        .filter(timestamp => now - timestamp < integrityRateWindowMs);
    if (recent.length >= candidatePhotoRateLimit) {
        candidatePhotoIpBuckets.set(key, recent);
        return res.status(429).json({ success: false, message: "Too many candidate photo uploads" });
    }
    recent.push(now);
    candidatePhotoIpBuckets.set(key, recent);
    return next();
}

function rateLimitAttemptAnswers(req, res, next) {
    const attemptId = req.params.attemptId;
    const now = Date.now();
    const recent = (answerAttemptBuckets.get(attemptId) || []).filter(timestamp => now - timestamp < integrityRateWindowMs);
    if (recent.length >= attemptAnswerRateLimit) {
        answerAttemptBuckets.set(attemptId, recent);
        return res.status(429).json({ success: false, message: "Too many answer saves" });
    }
    recent.push(now);
    answerAttemptBuckets.set(attemptId, recent);
    next();
}

app.post("/attempt/start", async (req, res) => {
    try {
        const body = req.body || {};
        const allowedFields = new Set(["studentKey", "candidateName", "subject", "topic", "photoId"]);
        if (typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowedFields.has(key))) {
            return res.status(400).json({ success: false, message: "Invalid exam start request" });
        }
        if (typeof body.studentKey !== "string") {
            return res.status(400).json({ success: false, message: "Student key must be a string" });
        }
        const studentKey = normalizeStudentKey(body.studentKey);
        const candidateName = typeof body.candidateName === "string" ? body.candidateName.trim() : "";
        const subject = typeof body.subject === "string" ? body.subject.trim() : "";
        const topic = typeof body.topic === "string" ? body.topic.trim() : "";
        if (!studentKey || studentKey.length > 200 || !candidateName || candidateName.length > 200 || !subject || subject.length > 200 || !topic || topic.length > 200) {
            return res.status(400).json({ success: false, message: "Candidate, student key, subject and topic are required" });
        }
        let photoId;
        if (body.photoId !== undefined && body.photoId !== null && body.photoId !== "") {
            if (typeof body.photoId !== "string" || !mongoose.Types.ObjectId.isValid(body.photoId)) {
                return res.status(400).json({ success: false, message: "Candidate photo id is invalid" });
            }
            const photo = await CandidatePhoto.findById(body.photoId).select("studentKey").lean();
            if (!photo || photo.studentKey !== studentKey) {
                return res.status(404).json({ success: false, message: "Candidate photo was not found for this student" });
            }
            photoId = String(photo._id);
        }

        const now = new Date();
        let activeAttempt = await ExamAttempt.findOne({ studentKey, subject, topic, status: "active" });
        if (activeAttempt && now.getTime() >= activeAttempt.endsAt.getTime() + attemptSubmitGraceMs) {
            await finalizeAttempt(activeAttempt, now);
            activeAttempt = null;
        }
        if (activeAttempt) {
            return res.json(await buildAttemptResponse(activeAttempt, now));
        }

        const questions = await Question.find({ subject, topic }).select("_id").lean();
        if (!questions.length) {
            return res.status(404).json({ success: false, message: "No questions are available for this exam" });
        }

        let config = await ExamConfig.findOne({ subject, topic });
        if (!config) config = await ExamConfig.findOne({ subject, topic: "" });
        const configuredDuration = Number(config && config.durationMinutes);
        const durationMinutes = Number.isFinite(configuredDuration) && configuredDuration > 0 ? configuredDuration : 30;
        const orderedQuestions = shuffleItems(questions);
        const labels = ["A", "B", "C", "D"];
        const optionOrder = orderedQuestions.map(question => ({
            questionId: question._id,
            order: shuffleItems(labels)
        }));
        const startedAt = new Date();
        const attempt = new ExamAttempt({
            attemptId: crypto.randomUUID(),
            studentKey,
            candidateName,
            photoId,
            subject,
            topic,
            questionIds: orderedQuestions.map(question => question._id),
            optionOrder,
            answers: {},
            startedAt,
            endsAt: new Date(startedAt.getTime() + durationMinutes * 60 * 1000),
            status: "active"
        });

        try {
            await attempt.save();
        } catch (error) {
            if (error.code !== 11000) throw error;
            const concurrentAttempt = await ExamAttempt.findOne({ studentKey, subject, topic, status: "active" });
            if (!concurrentAttempt) throw error;
            return res.json(await buildAttemptResponse(concurrentAttempt, new Date()));
        }
        return res.json(await buildAttemptResponse(attempt, new Date()));
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Unable to start or resume the exam" });
    }
});

app.get("/attempt/:attemptId", async (req, res) => {
    try {
        let attempt = await ExamAttempt.findOne({ attemptId: req.params.attemptId });
        if (!attempt) return res.status(404).json({ success: false, message: "Exam attempt was not found" });
        const now = new Date();
        if (attempt.status === "active" && now.getTime() >= attempt.endsAt.getTime() + attemptSubmitGraceMs) {
            const finalized = await finalizeAttempt(attempt, now);
            attempt = finalized.attempt;
        }
        return res.json(await buildAttemptResponse(attempt, now));
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Unable to load this exam attempt" });
    }
});

app.put("/attempt/:attemptId/answers", rateLimitAttemptAnswers, async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers) || Object.keys(body).some(key => key !== "answers")) {
            return res.status(400).json({ success: false, message: "An answers object is required" });
        }
        const attempt = await ExamAttempt.findOne({ attemptId: req.params.attemptId });
        if (!attempt) return res.status(404).json({ success: false, message: "Exam attempt was not found" });
        const conflict = getAttemptAnswerConflict(attempt);
        if (conflict === "finalizing") return res.status(409).json({ success: false, message: "This exam attempt is being finalized" });
        if (conflict === "inactive") return res.status(409).json({ success: false, message: "This exam attempt is no longer active" });
        if (conflict === "deadline") return res.status(409).json({ success: false, message: "The exam deadline has passed" });

        const questionIds = new Set(attempt.questionIds.map(id => String(id)));
        const allowedOptions = new Set(["A", "B", "C", "D"]);
        const changes = Object.entries(body.answers);
        if (!changes.length || changes.length > questionIds.size) {
            return res.status(400).json({ success: false, message: "The answer changes are invalid" });
        }
        for (const [questionId, selected] of changes) {
            if (!questionIds.has(questionId) || typeof selected !== "string" || !allowedOptions.has(selected)) {
                return res.status(400).json({ success: false, message: "One or more submitted answers are invalid" });
            }
        }
        const answers = { ...(attempt.answers || {}) };
        for (const [questionId, selected] of changes) answers[questionId] = selected;
        attempt.answers = answers;
        attempt.markModified("answers");
        await attempt.save();
        res.json({ success: true, serverNow: new Date() });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Unable to save exam answers" });
    }
});

app.post("/attempt/:attemptId/submit", async (req, res) => {
    try {
        let attempt = await ExamAttempt.findOne({ attemptId: req.params.attemptId });
        if (!attempt) return res.status(404).json({ success: false, message: "Exam attempt was not found" });
        let result = attempt.resultId ? await Result.findById(attempt.resultId) : null;
        if (attempt.status === "active" || !result) {
            const finalized = await finalizeAttempt(attempt, new Date());
            attempt = finalized.attempt;
            result = finalized.result;
        }
        if (!result) return res.status(500).json({ success: false, message: "Unable to finalize exam result" });
        const resultData = result.toObject();
        return res.json({
            success: true,
            resultId: String(result._id),
            score: result.score,
            total: result.totalQuestions,
            percentage: result.percentage,
            remark: result.remark,
            review: result.answersReview || [],
            result: resultData,
            status: attempt.status
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Unable to submit exam" });
    }
});

app.get("/candidate-photo/:resultId", async (req, res) => {
    /* TODO: Protect this route and /results during the security phase. */
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.resultId)) {
            return res.status(404).json({ success: false, message: "Candidate photo was not found" });
        }
        const result = await Result.findById(req.params.resultId).select("photoId").lean();
        if (!result || !result.photoId) {
            return res.status(404).json({ success: false, message: "Candidate photo was not found" });
        }
        const photo = await CandidatePhoto.findById(result.photoId).select("dataUrl").lean();
        if (!photo) {
            return res.status(404).json({ success: false, message: "Candidate photo was not found" });
        }
        const match = photo.dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match) {
            return res.status(500).json({ success: false, message: "Candidate photo data is invalid" });
        }
        return res.type("image/jpeg").send(Buffer.from(match[1], "base64"));
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Unable to load candidate photo" });
    }
});

function startAttemptExpirySweep() {
    const attemptExpirySweep = setInterval(async () => {
        try {
            const now = new Date();
            const expiredAttempts = await ExamAttempt.find({
                status: "active",
                endsAt: { $lte: new Date(now.getTime() - attemptSubmitGraceMs) }
            }).limit(50);
            for (const attempt of expiredAttempts) {
                await finalizeAttempt(attempt, now);
            }
        } catch (error) {
            console.log(error);
        }
    }, 15000);
    if (typeof attemptExpirySweep.unref === "function") attemptExpirySweep.unref();
}

if (!requiresTestDatabase) startAttemptExpirySweep();

app.get("/exam-config", async (req, res) => {
    try {
        const configs = await ExamConfig.find().sort({ subject: 1, topic: 1 });
        res.json(configs);
    } catch (error) {
        console.log(error);
        res.json([]);
    }
});

app.get("/exam-config/:subject", async (req, res) => {
    try {
        const subject = req.params.subject || "";
        const config = await ExamConfig.findOne({ subject, topic: "" }).sort({ createdAt: -1 });

        if (!config) {
            return res.json({
                durationMinutes: 30,
                graceSeconds: 10,
                maxFlagsBeforeAutoSubmit: 0,
                showWarnings: true,
                subject,
                topic: ""
            });
        }

        res.json({
            ...config.toObject(),
            graceSeconds: Number(config.graceSeconds ?? 10),
            maxFlagsBeforeAutoSubmit: Number(config.maxFlagsBeforeAutoSubmit ?? 0),
            showWarnings: config.showWarnings !== false,
            durationMinutes: Number(config.durationMinutes ?? 30)
        });
    } catch (error) {
        console.log(error);
        res.json({ durationMinutes: 30, graceSeconds: 10, maxFlagsBeforeAutoSubmit: 0, showWarnings: true });
    }
});

app.get("/exam-config/:subject/:topic", async (req, res) => {
    try {
        const subject = req.params.subject || "";
        const topic = req.params.topic || "";

        let config = await ExamConfig.findOne({ subject, topic }).sort({ createdAt: -1 });

        if (!config) {
            config = await ExamConfig.findOne({ subject, topic: "" }).sort({ createdAt: -1 });
        }

        if (!config) {
            return res.json({
                durationMinutes: 30,
                graceSeconds: 10,
                maxFlagsBeforeAutoSubmit: 0,
                showWarnings: true,
                subject,
                topic
            });
        }

        res.json({
            ...config.toObject(),
            graceSeconds: Number(config.graceSeconds ?? 10),
            maxFlagsBeforeAutoSubmit: Number(config.maxFlagsBeforeAutoSubmit ?? 0),
            showWarnings: config.showWarnings !== false,
            durationMinutes: Number(config.durationMinutes ?? 30)
        });
    } catch (error) {
        console.log(error);
        res.json({ durationMinutes: 30, graceSeconds: 10, maxFlagsBeforeAutoSubmit: 0, showWarnings: true });
    }
});

app.post("/exam-config", async (req, res) => {
    try {
        const { subject, topic = "", durationMinutes, graceSeconds, maxFlagsBeforeAutoSubmit, showWarnings } = req.body || {};

        if (!subject || !durationMinutes || Number(durationMinutes) < 1) {
            return res.status(400).json({
                success: false,
                message: "Subject and a valid duration are required"
            });
        }

        const normalizedDuration = Number(durationMinutes);
        const normalizedGraceSeconds = Number.isFinite(Number(graceSeconds)) ? Number(graceSeconds) : 10;
        const normalizedMaxFlags = Number.isFinite(Number(maxFlagsBeforeAutoSubmit)) ? Number(maxFlagsBeforeAutoSubmit) : 0;
        const normalizedShowWarnings = typeof showWarnings === "boolean" ? showWarnings : true;

        const config = await ExamConfig.findOneAndUpdate(
            { subject, topic },
            {
                subject,
                topic,
                durationMinutes: normalizedDuration,
                graceSeconds: Math.max(0, Math.min(normalizedGraceSeconds, 86400)),
                maxFlagsBeforeAutoSubmit: Math.max(0, Math.min(normalizedMaxFlags, 1000)),
                showWarnings: normalizedShowWarnings
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            }
        );

        res.json({
            success: true,
            config
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.put("/exam-config/:id", async (req, res) => {
    try {
        const { subject, topic = "", durationMinutes } = req.body || {};

        if (!subject || !durationMinutes || Number(durationMinutes) < 1) {
            return res.status(400).json({
                success: false,
                message: "Subject and a valid duration are required"
            });
        }

        const config = await ExamConfig.findByIdAndUpdate(
            req.params.id,
            {
                subject,
                topic,
                durationMinutes: Number(durationMinutes)
            },
            { new: true }
        );

        if (!config) {
            return res.status(404).json({
                success: false,
                message: "Exam configuration not found"
            });
        }

        res.json({
            success: true,
            config
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.delete("/exam-config/:id", async (req, res) => {
    try {
        const config = await ExamConfig.findByIdAndDelete(req.params.id);

        if (!config) {
            return res.status(404).json({
                success: false,
                message: "Exam configuration not found"
            });
        }

        res.json({
            success: true
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.post("/add-question", async (req, res) => {

    try {

        const newQuestion = new Question(req.body);

        await newQuestion.save();

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.post("/update-question/:id", async (req, res) => {

    try {

        await Question.findByIdAndUpdate(
            req.params.id,
            req.body
        );

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.delete("/delete-question/:id", async (req, res) => {

    try {

        await Question.findByIdAndDelete(req.params.id);

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.delete("/delete-questions", async (req, res) => {

    try {

        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];

        if (ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No question IDs provided"
            });
        }

        const result = await Question.deleteMany({ _id: { $in: ids } });

        res.json({
            success: true,
            deletedCount: result.deletedCount
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false
        });

    }

});

app.get("/subject-topics/:subject", async (req, res) => {

    try {

        const subject = req.params.subject;

        const questions = await Question.find({
            subject: subject
        });

        const topics = [
            ...new Set(
                questions.map(q => q.topic)
            )
        ];

        res.json(
            topics.map(topic => ({ topic }))
        );

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

app.post("/bulk-upload", excelUpload.single("file"), async (req, res) => {
    try {

        const workbook = XLSX.read(req.file.buffer, {
            type: "buffer"
        });

        const sheetName = workbook.SheetNames[0];

        const sheet = workbook.Sheets[sheetName];

        const rows = XLSX.utils.sheet_to_json(sheet);

        let uploadedCount = 0;

        for (const row of rows) {

            await Question.create({
                subject: row.subject,
                topic: row.topic,
                question: row.question,
                optionA: row.optionA,
                optionB: row.optionB,
                optionC: row.optionC,
                optionD: row.optionD,
                answer: row.answer
            });

            uploadedCount++;
        }

        res.json({
            success: true,
            count: uploadedCount
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false,
            message: error.message
        });

    }
});

app.post("/save-pin", async (req, res) => {

    try {

        const { pin } = req.body;

        const newPin = new Pin({
            pin: pin
        });

        await newPin.save();

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.get("/get-pin", async (req, res) => {

    try {

        const pins = await Pin.find();

        res.json({
            pins
        });

    } catch (error) {

        console.log(error);

        res.json({
            pins: []
        });

    }

});

app.post("/use-pin", async (req, res) => {

    try {

        const { pin } = req.body;

        const foundPin = await Pin.findOne({
            pin: pin,
            used: false
        });

        if (foundPin) {

            foundPin.used = true;

            await foundPin.save();

            res.json({
                success: true
            });

        } else {

            res.json({
                success: false
            });

        }

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

function normalizeStudentKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function validateIntegrityEvent(req, res, next) {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ success: false, message: "A JSON object is required" });
    }

    const allowedKeys = new Set(["studentKey", "candidateName", "subject", "topic", "type", "hiddenSeconds", "clientTimestamp", "userAgent", "attemptId"]);
    if (Object.keys(body).some(key => !allowedKeys.has(key))) {
        return res.status(400).json({ success: false, message: "Unknown integrity fields are not allowed" });
    }

    if (typeof body.studentKey !== "string" || !body.studentKey.trim() || body.studentKey.length > 200) {
        return res.status(400).json({ success: false, message: "studentKey must be a valid string" });
    }
    if (body.type !== "hidden_return") {
        return res.status(400).json({ success: false, message: "Unsupported integrity event type" });
    }
    if (typeof body.hiddenSeconds !== "number" || !Number.isFinite(body.hiddenSeconds) || body.hiddenSeconds < 0 || body.hiddenSeconds > 86400) {
        return res.status(400).json({ success: false, message: "hiddenSeconds must be a number between 0 and 86400" });
    }

    const stringLimits = { candidateName: 200, subject: 200, topic: 200, userAgent: 500, attemptId: 100 };
    for (const [field, maxLength] of Object.entries(stringLimits)) {
        if (typeof body[field] !== "undefined" && (typeof body[field] !== "string" || body[field].length > maxLength)) {
            return res.status(400).json({ success: false, message: `${field} must be a string no longer than ${maxLength} characters` });
        }
    }

    const now = Date.now();
    let clientTimestamp = now;
    if (typeof body.clientTimestamp === "number" && Number.isFinite(body.clientTimestamp)) {
        if (body.clientTimestamp >= now - 86400000 && body.clientTimestamp <= now) {
            clientTimestamp = body.clientTimestamp;
        }
    } else if (typeof body.clientTimestamp === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(body.clientTimestamp)) {
        const parsedTimestamp = Date.parse(body.clientTimestamp);
        if (Number.isFinite(parsedTimestamp) && parsedTimestamp >= now - 86400000 && parsedTimestamp <= now) {
            clientTimestamp = parsedTimestamp;
        }
    }

    req.integrityEvent = {
        studentKey: normalizeStudentKey(body.studentKey),
        candidateName: body.candidateName || "",
        attemptId: body.attemptId || undefined,
        subject: body.subject || "",
        topic: body.topic || "",
        type: body.type,
        hiddenSeconds: body.hiddenSeconds,
        clientTimestamp,
        userAgent: body.userAgent || req.headers["user-agent"] || ""
    };
    next();
}

function enforceIntegrityRateLimit(req, res, next) {
    const studentKey = req.integrityEvent.studentKey;
    const key = `${req.ip || req.socket.remoteAddress || "unknown"}:${studentKey}`;
    const now = Date.now();
    const cutoff = now - integrityRateWindowMs;
    const recent = (integrityIpBuckets.get(key) || []).filter(timestamp => timestamp > cutoff);
    if (recent.length >= integrityRateLimit) {
        integrityIpBuckets.set(key, recent);
        return res.status(429).json({ success: false, message: "Too many integrity events" });
    }
    recent.push(now);
    integrityIpBuckets.set(key, recent);
    next();
}

app.post("/integrity-event", validateIntegrityEvent, enforceIntegrityRateLimit, async (req, res) => {
    try {
        const event = new IntegrityEvent({
            ...req.integrityEvent,
            serverTimestamp: Date.now()
        });
        await event.save();
        res.json({ success: true, id: event._id });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get("/integrity-events", async (req, res) => {
    try {
        /* TODO: This route is not protected server-side. Lock it down in the security phase before exposing it to admins or students. */
        const { student, subject } = req.query || {};
        const filters = {};
        if (student) {
            filters.studentKey = normalizeStudentKey(student);
        }
        if (subject) {
            filters.subject = String(subject).slice(0, 200);
        }

        const items = await IntegrityEvent.find(filters)
            .sort({ serverTimestamp: -1 })
            .limit(200)
            .lean();

        res.json(items.map(item => ({
            _id: item._id,
            studentKey: item.studentKey,
            candidateName: item.candidateName || "",
            attemptId: item.attemptId || undefined,
            subject: item.subject || "",
            topic: item.topic || "",
            type: item.type,
            hiddenSeconds: item.hiddenSeconds,
            clientTimestamp: item.clientTimestamp,
            serverTimestamp: item.serverTimestamp,
            userAgent: item.userAgent || ""
        })));
    } catch (error) {
        console.log(error);
        res.json([]);
    }
});

app.post("/save-result", async (req, res) => {

    try {

        const studentKey = normalizeStudentKey(
            req.body.studentKey || req.body.candidateName
        );

        if (!studentKey) {
            return res.status(400).json({
                success: false,
                message: "Student key is required"
            });
        }

        const resultData = {
            ...req.body,
            studentKey,
            date: req.body.date || new Date().toLocaleString()
        };

        const result = new Result(resultData);

        await result.save();

        res.json({
            success: true,
            resultId: result._id
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false
        });

    }

});

app.get("/results/:studentKey", async (req, res) => {

    try {

        /* TODO: Protect this route during the security phase. */
        const studentKey = normalizeStudentKey(req.params.studentKey);

        const results = await Result.find({ studentKey })
            .sort({ createdAt: -1, _id: -1 });

        res.json(results);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

app.get("/results", async (req, res) => {

    try {

        const results = await Result.find().sort({ createdAt: -1, _id: -1 });

        res.json(results);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});



app.delete("/delete-result/:id", async (req, res) => {

    try {

        await Result.findByIdAndDelete(req.params.id);

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.delete("/delete-results", async (req, res) => {

    try {

        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];

        if (ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No result IDs provided"
            });
        }

        const result = await Result.deleteMany({ _id: { $in: ids } });

        res.json({
            success: true,
            deletedCount: result.deletedCount
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false
        });

    }

});
app.get("/all-pins", async (req, res) => {

    try {

        const pins = await Pin.find().sort({_id: -1});

        res.json(pins);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

app.get("/pin-stats", async (req, res) => {

    try {

        const total = await Pin.countDocuments();

        const used = await Pin.countDocuments({
            used: true
        });

        const unused = await Pin.countDocuments({
            used: false
        });

        res.json({
            total,
            used,
            unused
        });

    } catch (error) {

        console.log(error);

        res.json({
            total: 0,
            used: 0,
            unused: 0
        });

    }

});

app.delete("/delete-pin/:id", async (req, res) => {

    try {

        await Pin.findByIdAndDelete(req.params.id);

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.delete("/clear-used-pins", async (req, res) => {

    try {

        await Pin.deleteMany({
            used: true
        });

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.post(
  "/upload-image",
  upload.single("image"),
  async (req, res) => {

    try {

      if (!req.file) {
        return res.status(400).json({
          success: false
        });
      }

      const result = await cloudinary.uploader.upload(
        req.file.path,
        {
          folder: "gracelight-cbt"
        }
      );

      res.json({
        success: true,
        url: result.secure_url
      });

    } catch (error) {

      console.log(error);

      res.status(500).json({
        success: false
      });

    }

  }
);

app.post(
  "/bulk-upload",
  excelUpload.single("file"),
  async (req, res) => {

    try {

      const workbook = XLSX.read(
        req.file.buffer,
        { type: "buffer" }
      );

      const sheetName =
        workbook.SheetNames[0];

      const sheet =
        workbook.Sheets[sheetName];

      const questions =
        XLSX.utils.sheet_to_json(sheet);

      await Question.insertMany(
        questions
      );

      res.json({
        success: true,
        count: questions.length
      });

    } catch (error) {

      console.log(error);

      res.status(500).json({
        success: false
      });

    }

  }
);

const PORT = process.env.PORT || 3000;

function listen() {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

if (requiresTestDatabase) {
    databaseReady.then(ready => {
        if (!ready) process.exit(1);
        startAttemptExpirySweep();
        listen();
    });
} else {
    listen();
}
