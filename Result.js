const mongoose = require("mongoose");

const ResultSchema = new mongoose.Schema({
    candidate: String,
    subject: String,
    topic: String,
    score: Number,
    percentage: Number,
    remark: String,
    date: String
});

module.exports = mongoose.model("Result", ResultSchema);
