const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const mongoose = require("mongoose");
const Question = require("./Question");
const Result = require("./Result");
const Pin = require("./Pin");

const app = express();

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log(err));

app.use(express.json());

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use("/uploads", express.static("uploads"));

const storage = multer.diskStorage({

    destination: function(req, file, cb){
        cb(null, "uploads/");
    },

    filename: function(req, file, cb){

        const uniqueName =
            Date.now() +
            path.extname(file.originalname);

        cb(null, uniqueName);
    }

});

const upload = multer({
  
    storage: storage
});

const questionsFile = "questions.json";

if (!fs.existsSync(questionsFile)) {
    fs.writeFileSync(questionsFile, "[]");
}

app.get("/topics/:subject", async (req, res) => {

    try {

        const subject = req.params.subject;

        const questions = await Question.find({
            subject: subject
        });

        const topics = [
            ...new Set(
                questions.map(q => q.topic)
            )
        ];

        res.json(topics);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

app.get("/questions", async (req, res) => {

    try {

        const questions = await Question.find();

        res.json(questions);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

app.post("/add-question", async (req, res) => {

    try {

        const newQuestion = new Question(req.body);

        await newQuestion.save();

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.post("/update-question/:id", async (req, res) => {

    try {

        await Question.findByIdAndUpdate(
            req.params.id,
            req.body
        );

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.delete("/delete-question/:id", async (req, res) => {

    try {

        await Question.findByIdAndDelete(req.params.id);

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.get("/subject-topics/:subject", async (req, res) => {

    try {

        const subject = req.params.subject;

        const questions = await Question.find({
            subject: subject
        });

        const topics = [
            ...new Set(
                questions.map(q => q.topic)
            )
        ];

        res.json(
            topics.map(topic => ({ topic }))
        );

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

app.post("/save-pin", async (req, res) => {

    try {

        const { pin } = req.body;

        const newPin = new Pin({
            pin: pin
        });

        await newPin.save();

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.get("/get-pin", async (req, res) => {

    try {

        const pins = await Pin.find();

        res.json({
            pins
        });

    } catch (error) {

        console.log(error);

        res.json({
            pins: []
        });

    }

});

app.post("/use-pin", async (req, res) => {

    try {

        const { pin } = req.body;

        const foundPin = await Pin.findOne({
            pin: pin,
            used: false
        });

        if (foundPin) {

            foundPin.used = true;

            await foundPin.save();

            res.json({
                success: true
            });

        } else {

            res.json({
                success: false
            });

        }

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.post("/save-result", async (req, res) => {

    try {

        const result = new Result(req.body);

        await result.save();

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});



app.get("/results", async (req, res) => {

    try {

        const results = await Result.find().sort({_id:-1});

        res.json(results);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});



app.delete("/delete-result/:id", async (req, res) => {

    try {

        await Result.findByIdAndDelete(req.params.id);

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.listen(3000, () => {

    console.log(
        "Server running on port 3000"
    );

});
