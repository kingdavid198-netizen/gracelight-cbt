const mongoose = require("mongoose");

const ExamAttemptSchema = new mongoose.Schema({
    attemptId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    studentKey: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    candidateName: {
        type: String,
        required: true,
        trim: true
    },
    photoId: String,
    subject: {
        type: String,
        required: true,
        trim: true
    },
    topic: {
        type: String,
        required: true,
        trim: true
    },
    questionIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question",
        required: true
    }],
    optionOrder: [{
        questionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Question",
            required: true
        },
        order: {
            type: [String],
            required: true
        }
    }],
    answers: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({})
    },
    startedAt: {
        type: Date,
        required: true
    },
    endsAt: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ["active", "submitted", "expired"],
        default: "active",
        required: true
    },
    submittedAt: Date,
    resultId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Result"
    }
}, { timestamps: true });

ExamAttemptSchema.index(
    { studentKey: 1, subject: 1, topic: 1 },
    { unique: true, partialFilterExpression: { status: "active" } }
);

module.exports = mongoose.model("ExamAttempt", ExamAttemptSchema);
