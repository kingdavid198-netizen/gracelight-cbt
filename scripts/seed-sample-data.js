require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const mongoose = require("mongoose");
const { connect, requireTestDatabase } = require("../db-connect");
const ExamConfig = require("../ExamConfig");
const Question = require("../Question");
const Pin = require("../Pin");

async function seedTestDatabase() {
    await connect();
    console.log(mongoose.connection.name);
    requireTestDatabase();

    const configExists = await ExamConfig.exists({ subject: "English", topic: "Nouns" });
    if (configExists) {
        throw new Error("English / Nouns already exists; refusing to overwrite test data");
    }

    const created = { configId: null, questionIds: [], pinIds: [] };
    try {
        const config = await ExamConfig.create({
            subject: "English",
            topic: "Nouns",
            durationMinutes: 5
        });
        created.configId = String(config._id);

        const questionDocs = [
            ["Which word is a noun?", "quickly", "river", "beneath", "gentle", "B"],
            ["Which option names a person?", "teacher", "honestly", "across", "bright", "A"],
            ["Which word is a proper noun?", "city", "Lagos", "market", "school", "B"],
            ["Choose the abstract noun.", "pencil", "kindness", "window", "basket", "B"],
            ["Which word is a collective noun?", "team", "stone", "pupil", "branch", "A"],
            ["Which word is a common noun?", "Africa", "Ada", "country", "Monday", "C"],
            ["Which word names a place?", "garden", "softly", "green", "under", "A"],
            ["Choose the plural noun.", "child", "children", "childish", "childhood", "B"],
            ["Which word is a concrete noun?", "honesty", "music", "table", "joy", "C"],
            ["Which word is a noun in this list?", "write", "careful", "friendship", "slowly", "C"]
        ].map(([question, optionA, optionB, optionC, optionD, answer]) => ({
            subject: "English",
            topic: "Nouns",
            question,
            optionA,
            optionB,
            optionC,
            optionD,
            answer
        }));
        const questions = await Question.insertMany(questionDocs);
        created.questionIds = questions.map(question => String(question._id));

        const pins = await Pin.insertMany(Array.from({ length: 3 }, () => ({
            pin: `TEST-${crypto.randomUUID()}`,
            used: false
        })));
        created.pinIds = pins.map(pin => String(pin._id));

        console.log(JSON.stringify({
            created: {
                examConfig: { id: created.configId, subject: "English", topic: "Nouns", durationMinutes: 5 },
                questions: created.questionIds,
                pins: created.pinIds
            }
        }));
        return created;
    } catch (error) {
        if (created.pinIds.length) await Pin.deleteMany({ _id: { $in: created.pinIds } });
        if (created.questionIds.length) await Question.deleteMany({ _id: { $in: created.questionIds } });
        if (created.configId) await ExamConfig.deleteOne({ _id: created.configId });
        throw error;
    }
}

if (!process.env.NODE_TEST_CONTEXT) {
    seedTestDatabase()
        .catch(error => {
            process.stderr.write(`Test seed failed: ${error.name || "Error"}\n`);
            process.exitCode = 1;
        })
        .finally(async () => {
            await mongoose.disconnect();
        });
}
