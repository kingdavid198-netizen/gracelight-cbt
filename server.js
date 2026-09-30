require('dotenv').config();
const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const XLSX = require("xlsx");
const mongoose = require("mongoose");
const Question = require("./Question");
const Result = require("./Result");
const Pin = require("./Pin");
const Formula = require("./Formula");
const Assignment = require("./Assignment");
const Submission = require("./Submission");
const ExamConfig = require("./ExamConfig");
const cloudinary = require("./cloudinary");

const app = express();

const resourceSubjectAliases = [
    ["Account", "Financial Accounting"],
    ["CRS", "Christian Religious Studies"],
    ["English", "English Language"],
    ["Literature", "Literature in English"]
];

function resourceSubjectFilter(subject) {
    const aliases = resourceSubjectAliases.find(group => group.includes(subject));
    return { $in: aliases || [subject] };
}

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

const submissionUpload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, callback){
        if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
            return callback(null, true);
        }
        callback(new Error("Only image and PDF files are allowed"));
    }
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

app.post("/formulas", upload.single("image"), async (req, res) => {

    try {

        let imageUrl = "";

if (req.file) {
  const result = await cloudinary.uploader.upload(
    req.file.path,
    {
      folder: "gracelight-formulas"
    }
  );

  imageUrl = result.secure_url;

  fs.unlinkSync(req.file.path);
}

const formula = new Formula({
  subject: req.body.subject,
    topic: req.body.topic || "",
  title: req.body.title,
  content: req.body.content,
  image: imageUrl
});

await formula.save();

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false
        });

    }

});

app.get("/formulas", async (req, res) => {

    try {

        const filters = {};
        if (req.query.subject) filters.subject = resourceSubjectFilter(req.query.subject);
        if (req.query.topic) filters.topic = req.query.topic;

        const formulas = await Formula.find(filters)
            .sort({ subject: 1 });

        res.json(formulas);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

app.put("/formulas/:id", upload.single("image"), async (req, res) => {

    try {

        const updates = {
            subject: req.body.subject,
            topic: req.body.topic || "",
            title: req.body.title,
            content: req.body.content
        };

        if (req.file) {
            const result = await cloudinary.uploader.upload(
                req.file.path,
                {
                    folder: "gracelight-formulas"
                }
            );

            updates.image = result.secure_url;
            fs.unlinkSync(req.file.path);
        }

        const formula = await Formula.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!formula) {
            return res.status(404).json({ success: false, message: "Note not found" });
        }

        res.json({ success: true });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false
        });

    }

});

app.delete("/formulas/:id", async (req, res) => {

    try {

        await Formula.findByIdAndDelete(
            req.params.id
        );

        res.json({
            success: true
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false
        });

    }

});

app.post("/bulk-formulas", upload.single("file"), async (req, res) => {

    try {

        const workbook = XLSX.readFile(req.file.path);

        const sheet =
            workbook.Sheets[
                workbook.SheetNames[0]
            ];

        const rows =
            XLSX.utils.sheet_to_json(sheet);

        let count = 0;

        for (const row of rows) {

            await Formula.create({
                
subject: row.Subject || row.subject || "", 
topic: row.Topic || row.topic || "",
title: row.Title || row.title || "",
content: row.Content || row.content || "",
image: row.Image || row.image || ""

            });

            count++;

        }

        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            count
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false
        });

    }

});

app.get("/assignments", async (req, res) => {
    try {
        const filters = {};
        if (req.query.subject) filters.subject = resourceSubjectFilter(req.query.subject);
        if (req.query.topic) filters.topic = req.query.topic;

        const assignments = await Assignment.find(filters).sort({ dueDate: 1, createdAt: -1 });
        res.json(assignments);
    } catch (error) {
        console.log(error);
        res.json([]);
    }
});

app.post("/bulk-assignments", upload.single("file"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: "Spreadsheet file is required" });
    }

    let count = 0;
    let skipped = 0;
    try {
        const workbook = XLSX.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        for (const row of rows) {
            const subject = row.Subject || row.subject || "";
            const topic = row.Topic || row.topic || "";
            const title = row.Title || row.title || "";
            const instructions = row.Instructions || row.instructions || row.Content || row.content || "";
            const rawDueDate = row["Due Date"] || row.DueDate || row.dueDate || "";

            if (!subject || !topic || !title || !instructions) {
                skipped++;
                continue;
            }

            let dueDate = null;
            if (rawDueDate) {
                if (typeof rawDueDate === "number") {
                    const dateParts = XLSX.SSF.parse_date_code(rawDueDate);
                    if (dateParts) {
                        dueDate = new Date(Date.UTC(
                            dateParts.y,
                            dateParts.m - 1,
                            dateParts.d,
                            dateParts.H,
                            dateParts.M,
                            dateParts.S
                        ));
                    }
                } else {
                    const parsedDate = new Date(rawDueDate);
                    if (!Number.isNaN(parsedDate.getTime())) dueDate = parsedDate;
                }
            }

            await Assignment.create({ subject, topic, title, instructions, dueDate });
            count++;
        }

        res.json({ success: true, count, skipped });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false, message: "Unable to upload assignments" });
    } finally {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
});

app.post("/assignments", async (req, res) => {
    try {
        const assignment = await Assignment.create({
            subject: req.body.subject,
            topic: req.body.topic || "",
            title: req.body.title,
            instructions: req.body.instructions,
            dueDate: req.body.dueDate || null
        });
        res.json({ success: true, assignmentId: assignment._id });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false });
    }
});

app.delete("/assignments/:id", async (req, res) => {
    try {
        await Assignment.findByIdAndDelete(req.params.id);
        await Submission.deleteMany({ assignment: req.params.id });
        res.json({ success: true });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false });
    }
});

app.get("/assignments/:id/submissions", async (req, res) => {
    try {
        const filters = { assignment: req.params.id };
        if (req.query.studentKey) {
            filters.studentKey = normalizeStudentKey(req.query.studentKey);
        }
        const submissions = await Submission.find(filters)
            .sort({ submittedAt: -1 });
        res.json(submissions);
    } catch (error) {
        console.log(error);
        res.json([]);
    }
});

app.post("/assignments/:id/submissions", (req, res, next) => {
    submissionUpload.single("file")(req, res, error => {
        if (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
        next();
    });
}, async (req, res) => {
    const tempFilePath = req.file && req.file.path;
    try {
        const studentKey = normalizeStudentKey(req.body.studentKey || req.body.studentName);
        const answer = String(req.body.answer || "").trim();
        if (!studentKey || (!answer && !req.file)) {
            return res.status(400).json({ success: false, message: "Student name and an answer or file are required" });
        }

        let uploadedFile = null;
        if (req.file) {
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: "gracelight-assignment-submissions",
                resource_type: "auto"
            });
            uploadedFile = {
                fileUrl: result.secure_url,
                fileName: req.file.originalname,
                fileType: req.file.mimetype
            };
        }

        const fieldsToSet = {
            studentName: req.body.studentName || studentKey,
            answer,
            submittedAt: new Date()
        };
        if (uploadedFile) Object.assign(fieldsToSet, uploadedFile);

        const submission = await Submission.findOneAndUpdate(
            { assignment: req.params.id, studentKey },
            { $set: fieldsToSet },
            { new: true, upsert: true, runValidators: true }
        );
        res.json({ success: true, submissionId: submission._id });
    } catch (error) {
        console.log(error);
        res.status(500).json({ success: false });
    } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
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

app.get("/exam-config", async (req, res) => {
    try {
        const configs = await ExamConfig.find().sort({ subject: 1, topic: 1 });
        res.json(configs);
    } catch (error) {
        console.log(error);
        res.json([]);
    }
});

app.get("/exam-config/:subject", async (req, res) => {
    try {
        const subject = req.params.subject || "";
        const config = await ExamConfig.findOne({ subject, topic: "" }).sort({ createdAt: -1 });

        if (!config) {
            return res.json({
                durationMinutes: 30,
                subject,
                topic: ""
            });
        }

        res.json(config);
    } catch (error) {
        console.log(error);
        res.json({ durationMinutes: 30 });
    }
});

app.get("/exam-config/:subject/:topic", async (req, res) => {
    try {
        const subject = req.params.subject || "";
        const topic = req.params.topic || "";

        let config = await ExamConfig.findOne({ subject, topic }).sort({ createdAt: -1 });

        if (!config) {
            config = await ExamConfig.findOne({ subject, topic: "" }).sort({ createdAt: -1 });
        }

        if (!config) {
            return res.json({
                durationMinutes: 30,
                subject,
                topic
            });
        }

        res.json(config);
    } catch (error) {
        console.log(error);
        res.json({ durationMinutes: 30 });
    }
});

app.post("/exam-config", async (req, res) => {
    try {
        const { subject, topic = "", durationMinutes } = req.body || {};

        if (!subject || !durationMinutes || Number(durationMinutes) < 1) {
            return res.status(400).json({
                success: false,
                message: "Subject and a valid duration are required"
            });
        }

        const normalizedDuration = Number(durationMinutes);

        const config = await ExamConfig.findOneAndUpdate(
            { subject, topic },
            {
                subject,
                topic,
                durationMinutes: normalizedDuration
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            }
        );

        res.json({
            success: true,
            config
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.put("/exam-config/:id", async (req, res) => {
    try {
        const { subject, topic = "", durationMinutes } = req.body || {};

        if (!subject || !durationMinutes || Number(durationMinutes) < 1) {
            return res.status(400).json({
                success: false,
                message: "Subject and a valid duration are required"
            });
        }

        const config = await ExamConfig.findByIdAndUpdate(
            req.params.id,
            {
                subject,
                topic,
                durationMinutes: Number(durationMinutes)
            },
            { new: true }
        );

        if (!config) {
            return res.status(404).json({
                success: false,
                message: "Exam configuration not found"
            });
        }

        res.json({
            success: true,
            config
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

app.delete("/exam-config/:id", async (req, res) => {
    try {
        const config = await ExamConfig.findByIdAndDelete(req.params.id);

        if (!config) {
            return res.status(404).json({
                success: false,
                message: "Exam configuration not found"
            });
        }

        res.json({
            success: true
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: error.message
        });
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

app.delete("/delete-questions", async (req, res) => {

    try {

        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];

        if (ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No question IDs provided"
            });
        }

        const result = await Question.deleteMany({ _id: { $in: ids } });

        res.json({
            success: true,
            deletedCount: result.deletedCount
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
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

function normalizeStudentKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

app.post("/save-result", async (req, res) => {

    try {

        const studentKey = normalizeStudentKey(
            req.body.studentKey || req.body.candidateName
        );

        if (!studentKey) {
            return res.status(400).json({
                success: false,
                message: "Student key is required"
            });
        }

        const resultData = {
            ...req.body,
            studentKey,
            date: req.body.date || new Date().toLocaleString()
        };

        const result = new Result(resultData);

        await result.save();

        res.json({
            success: true,
            resultId: result._id
        });

    } catch (error) {

        console.log(error);

        res.json({
            success: false
        });

    }

});

app.get("/results/:studentKey", async (req, res) => {

    try {

        const studentKey = normalizeStudentKey(req.params.studentKey);

        const results = await Result.find({ studentKey })
            .sort({ createdAt: -1, _id: -1 });

        res.json(results);

    } catch (error) {

        console.log(error);

        res.json([]);

    }

});

app.get("/results", async (req, res) => {

    try {

        const results = await Result.find().sort({ createdAt: -1, _id: -1 });

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

app.delete("/delete-results", async (req, res) => {

    try {

        const ids = Array.isArray(req.body.ids) ? req.body.ids : [];

        if (ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No result IDs provided"
            });
        }

        const result = await Result.deleteMany({ _id: { $in: ids } });

        res.json({
            success: true,
            deletedCount: result.deletedCount
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
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
