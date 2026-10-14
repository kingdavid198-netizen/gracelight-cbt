const mongoose = require("mongoose");

const IntegrityEventSchema = new mongoose.Schema({
    studentKey: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    candidateName: {
        type: String,
        default: ""
    },
    attemptId: {
        type: String,
        default: undefined,
        maxlength: 100
    },
    subject: {
        type: String,
        default: ""
    },
    topic: {
        type: String,
        default: ""
    },
    type: {
        type: String,
        required: true,
        enum: ["hidden_return"],
        trim: true
    },
    hiddenSeconds: {
        type: Number,
        default: 0,
        min: 0,
        max: 86400
    },
    clientTimestamp: {
        type: Number,
        default: Date.now,
        min: 0
    },
    serverTimestamp: {
        type: Number,
        default: Date.now,
        min: 0
    },
    userAgent: {
        type: String,
        default: ""
    }
}, {
    timestamps: false
});

module.exports = mongoose.model("IntegrityEvent", IntegrityEventSchema);
