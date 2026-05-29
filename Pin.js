const mongoose = require("mongoose");

const PinSchema = new mongoose.Schema({
    pin: String,
    used: {
        type: Boolean,
        default: false
    }
});

module.exports = mongoose.model("Pin", PinSchema);
