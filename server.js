const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const mongoose = require("mongoose");
const Question = require("./Question");

const app = express();

mongoose.connect("mongodb://kingdavid198_db_user:C236Mi5SfOFPEK04@ac-lqc7g82-shard-00-00.bor0opc.mongodb.net:27017,ac-lqc7g82-shard-00-01.bor0opc.mongodb.net:27017,ac-lqc7g82-shard-00-02.bor0opc.mongodb.net:27017/?ssl=true&replicaSet=atlas-125o8c-shard-0&authSource=admin&appName=Cluster0")
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

app.post("/update-question/:id", (req, res) => {

    const id = Number(req.params.id);

    const {
        subject,
        topic,
        question,
        optionA,
        optionB,
        optionC,
        optionD,
        answer
    } = req.body;

    const data = fs.readFileSync(
        questionsFile,
        "utf8"
    );

    let questions = JSON.parse(data);

    const index = questions.findIndex(
        q => q.id === id
    );

    if(index === -1){
        return res.json({
            success:false
        });
    }

    questions[index] = {
        id,
        subject,
        topic,
        question,
        optionA,
        optionB,
        optionC,
        optionD,
        answer
    };

    fs.writeFileSync(
        questionsFile,
        JSON.stringify(questions, null, 2)
    );

    res.json({
        success:true
    });

});

app.delete("/delete-question/:id", (req, res) => {

    const id = Number(req.params.id);

    const data = fs.readFileSync(
        questionsFile,
        "utf8"
    );

    let questions = JSON.parse(data);

    questions = questions.filter(
        q => q.id !== id
    );

    fs.writeFileSync(
        questionsFile,
        JSON.stringify(questions, null, 2)
    );

    res.json({
        success: true
    });

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

let examPins = [];

app.post("/save-pin", (req, res) => {

const { pin } = req.body;

examPins.push({
pin: pin,
used: false
});

res.json({
success: true
});

});

app.get("/get-pin", (req, res) => {

res.json({
pins: examPins
});

});

app.post("/use-pin", (req, res) => {

const { pin } = req.body;

const foundPin =
examPins.find(p => p.pin === pin);

if(foundPin){

foundPin.used = true;

res.json({
success:true
});

}else{

res.json({
success:false
});

}

});

app.listen(3000, () => {

    console.log(
        "Server running on port 3000"
    );

});
