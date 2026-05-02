const { Pool } = require("pg");
// const pool = new Pool({
//     user: "myuser",
//     host: process.env.DB_HOST || "localhost",
//     database: "sns_db",
//     password: "mypassword",
//     port: 5432,
// });
const pool = new Pool({
    user: 'myuser',
    host: 'db',
    database: 'sns_db',
    password: 'mypassword',
    port: 5432,
});

module.exports = pool;