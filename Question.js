const mongoose = require("mongoose");

const QuestionSchema = new mongoose.Schema({
    subject: String,
    topic: String,
    question: String,
    optionA: String,
    optionB: String,
    optionC: String,
    optionD: String,
    answer: String,
    image: {
    type: String,
    default: ""
}
});

module.exports = mongoose.model("Question", QuestionSchema);
