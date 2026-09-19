const mongoose = require("mongoose");

const ExamConfigSchema = new mongoose.Schema({
    subject: {
        type: String,
        required: true,
        trim: true
    },
    topic: {
        type: String,
        default: "",
        trim: true
    },
    durationMinutes: {
        type: Number,
        required: true,
        min: 1,
        default: 30
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

ExamConfigSchema.index({ subject: 1, topic: 1 }, { unique: true });

module.exports = mongoose.model("ExamConfig", ExamConfigSchema);
