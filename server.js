const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const XLSX = require("xlsx");
const mongoose = require("mongoose");
const Question = require("./Question");
const Result = require("./Result");
const Pin = require("./Pin");
const cloudinary = require("./cloudinary");

const app = express();

if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads", { recursive: true });
}

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

const excelUpload = multer({
  storage: multer.memoryStorage()
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

app.post("/bulk-upload", excelUpload.single("file"), async (req, res) => {
    try {

        const workbook = XLSX.read(req.file.buffer, {
            type: "buffer"
        });

        const sheetName = workbook.SheetNames[0];

        const sheet = workbook.Sheets[sheetName];

        const rows = XLSX.utils.sheet_to_json(sheet);

        let uploadedCount = 0;

        for (const row of rows) {

            await Question.create({
                subject: row.subject,
                topic: row.topic,
                question: row.question,
                optionA: row.optionA,
                optionB: row.optionB,
                optionC: row.optionC,
                optionD: row.optionD,
                answer: row.answer
            });

            uploadedCount++;
        }

        res.json({
            success: true,
            count: uploadedCount
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false,
            message: error.message
        });

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
app.get("/all-pins", async (req, res) => {

    try {

        const pins = await Pin.find().sort({_id: -1});

        res.json(pins);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

app.get("/pin-stats", async (req, res) => {

    try {

        const total = await Pin.countDocuments();

        const used = await Pin.countDocuments({
            used: true
        });

        const unused = await Pin.countDocuments({
            used: false
        });

        res.json({
            total,
            used,
            unused
        });

    } catch (error) {

        console.log(error);

        res.json({
            total: 0,
            used: 0,
            unused: 0
        });

    }

});

app.delete("/delete-pin/:id", async (req, res) => {

    try {

        await Pin.findByIdAndDelete(req.params.id);

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

app.delete("/clear-used-pins", async (req, res) => {

    try {

        await Pin.deleteMany({
            used: true
        });

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

app.post(
  "/upload-image",
  upload.single("image"),
  async (req, res) => {

    try {

      if (!req.file) {
        return res.status(400).json({
          success: false
        });
      }

      const result = await cloudinary.uploader.upload(
        req.file.path,
        {
          folder: "gracelight-cbt"
        }
      );

      res.json({
        success: true,
        url: result.secure_url
      });

    } catch (error) {

      console.log(error);

      res.status(500).json({
        success: false
      });

    }

  }
);

app.post(
  "/bulk-upload",
  excelUpload.single("file"),
  async (req, res) => {

    try {

      const workbook = XLSX.read(
        req.file.buffer,
        { type: "buffer" }
      );

      const sheetName =
        workbook.SheetNames[0];

      const sheet =
        workbook.Sheets[sheetName];

      const questions =
        XLSX.utils.sheet_to_json(sheet);

      await Question.insertMany(
        questions
      );

      res.json({
        success: true,
        count: questions.length
      });

    } catch (error) {

      console.log(error);

      res.status(500).json({
        success: false
      });

    }

  }
);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
