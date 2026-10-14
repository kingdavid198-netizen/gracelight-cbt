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
    graceSeconds: {
        type: Number,
        default: 10,
        min: 0,
        max: 86400
    },
    maxFlagsBeforeAutoSubmit: {
        type: Number,
        default: 0,
        min: 0,
        max: 1000
    },
    showWarnings: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

ExamConfigSchema.index({ subject: 1, topic: 1 }, { unique: true });

module.exports = mongoose.model("ExamConfig", ExamConfigSchema);
