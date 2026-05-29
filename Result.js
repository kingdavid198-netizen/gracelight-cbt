const mongoose = require("mongoose");

const ResultSchema = new mongoose.Schema({
    candidateName: String,
    subject: String,
    topic: String,
    score: Number,
    totalQuestions: Number,
    percentage: Number,
    remark: String,
    date: String
});

module.exports = mongoose.model("Result", ResultSchema);
