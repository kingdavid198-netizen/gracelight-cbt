const mongoose = require("mongoose");

const SubmissionFileSchema = new mongoose.Schema({
    url: { type: String, required: true },
    originalName: { type: String, required: true },
    publicId: { type: String, required: true },
    fileType: String,
    resourceType: String
}, { _id: true });

const SubmissionSchema = new mongoose.Schema({
    assignment: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Assignment",
        required: true
    },
    studentKey: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    studentName: String,
    answer: String,
    fileUrl: String,
    fileName: String,
    fileType: String,
    publicId: String,
    resourceType: String,
    files: {
        type: [SubmissionFileSchema],
        default: []
    },
    submittedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Submission", SubmissionSchema);
