const mongoose = require("mongoose");

const ResultSchema = new mongoose.Schema({
    studentKey: {
        type: String,
        required: true,
        index: true,
        trim: true,
        lowercase: true
    },
    candidateName: String,
    subject: String,
    topic: String,
    score: Number,
    totalQuestions: Number,
    percentage: Number,
    remark: String,
    date: String,
    createdAt: {
        type: Date,
        default: Date.now
    },
    // Optional per-question review detail; absent on older result documents.
    answersReview: {
        type: [{
            questionNumber: Number,
            question: String,
            image: String,
            options: {
                A: String,
                B: String,
                C: String,
                D: String
            },
            selected: String,
            correctAnswer: String,
            isCorrect: Boolean
        }],
        default: undefined
    }
});

module.exports = mongoose.model("Result", ResultSchema);
