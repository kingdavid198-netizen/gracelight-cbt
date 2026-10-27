const mongoose = require("mongoose");

async function connect() {
    await mongoose.connect(
        process.env.MONGO_URI,
        process.env.MONGO_DB_NAME
            ? { dbName: process.env.MONGO_DB_NAME }
            : undefined
    );
    return mongoose.connection.name;
}

function requireTestDatabase() {
    if (!process.env.MONGO_DB_NAME || !mongoose.connection.name || !mongoose.connection.name.endsWith("_test")) {
        throw new Error("Tests require MONGO_DB_NAME and a database name ending in _test");
    }
}

module.exports = { connect, requireTestDatabase };
