const mongoose = require("mongoose");

const AssignmentSchema = new mongoose.Schema({
    subject: String,
    topic: String,
    title: String,
    instructions: String,
    dueDate: Date,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Assignment", AssignmentSchema);
