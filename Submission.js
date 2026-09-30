const mongoose = require("mongoose");

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
    submittedAt: {
        type: Date,
        default: Date.now
    }
});

SubmissionSchema.index({ assignment: 1, studentKey: 1 }, { unique: true });

module.exports = mongoose.model("Submission", SubmissionSchema);
