const mongoose = require("mongoose");

const FormulaSchema = new mongoose.Schema({
    subject: String,
    title: String,
    content: String,
    image: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Formula", FormulaSchema);
