const express = require("express");
const session = require("express-session");
const pool = require("./config/db");
const pgSession = require('connect-pg-simple')(session);
const authRoutes = require("./routes/auth");
const postRoutes = require("./routes/posts");
// const { migrateMissingEmbeddings, FeatureExtractor } = require("./controllers/recommendation-engine"); // 追加
const RecommendationService = require('./services/recommendationService');
const recService = new RecommendationService(pool);

const app = express();

app.use(express.json());
app.use(express.static("public"));

// 2. セッション設定の変更
app.use(session({
    // store に pgSession を指定し、DBプールを渡す
    store: new pgSession({
        pool: require("./config/db"),
        tableName: 'session',   // init.sqlで作ったテーブル名
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

app.listen(3000, async () => {
    // --- ここで移行スクリプトを実行 ---
    try {
        // 起動時にモデルをロードしてコールドスタートを回避
        await recService.generateEmbedding("warmup");
        // 古い投稿の自動移行
        recService.migrateMissingEmbeddings();
        recService.migrateMissingBioEmbeddings();
    } catch (err) {
        console.error("Migration failed to start:", err);
    }
});