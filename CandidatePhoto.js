const mongoose = require("mongoose");

const CandidatePhotoSchema = new mongoose.Schema({
    studentKey: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    dataUrl: {
        type: String,
        required: true
    },
    size: {
        type: Number,
        required: true,
        min: 1
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("CandidatePhoto", CandidatePhotoSchema);
