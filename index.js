const express = require("express");
const session = require("express-session");
const pgSession = require('connect-pg-simple')(session);
const authRoutes = require("./routes/auth");
const postRoutes = require("./routes/posts");

const app = express();

app.use(express.json());
app.use(express.static("public"));
// app.use(session({
//     secret: 'my_secret_key', // 実際には環境変数を使用
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//         httpOnly: true,  // JavaScriptからクッキーを読み取れないようにし、XSS攻撃を防ぐ
//         secure: false,   // 開発環境。本番環境(HTTPS)では true に設定
//         sameSite: 'lax', // CSRF攻撃対策
//         maxAge: 7 * 24 * 60 * 60 * 1000 // クッキーの有効期限（例：7日間）
//     }
// }));
// 2. セッション設定の変更
app.use(session({
    // store に pgSession を指定し、DBプールを渡す
    store: new pgSession({
        pool : require("./config/db"),                
        tableName : 'session',   // init.sqlで作ったテーブル名
        createTableIfMissing: false // init.sqlで作るのでfalseでOK
    }),
    secret: 'my_secret_key', // 本番環境では環境変数に
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000 // 例: 7日間有効
    }
}));

// ルートの登録
app.use("/api", authRoutes);
app.use("/api", postRoutes);

app.listen(3000, () => console.log("Server running..."));