const express = require("express");
const session = require("express-session");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs"); // パスワード暗号化用
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static("public"));
app.use(session({
    secret: 'secret-key-123',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

const pool = new Pool({
    user: "myuser",
    host: process.env.DB_HOST || "localhost",
    database: "sns_db",
    password: "mypassword",
    port: 5432,
});

// 新規登録API
app.post("/api/register", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "名前とパスワードが必要です" });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log(`hasshedPassword created: ${hashedPassword}`);
        const dummyEmail = `${username}@example.com`; // 練習用ダミー

        await pool.query(
            "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)",
            [username, dummyEmail, hashedPassword]
        );
        res.status(201).json({ success: true });
    } catch (err) {
        if (err.code === '23505') { // PostgreSQLのユニーク制約違反コード
            res.status(400).json({ error: "このユーザー名は既に使われています" });
        } else {
            res.status(500).json({ error: "登録失敗" });
        }
    }
});

// ログインAPI
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "名前とパスワードが必要です" });

    try {
        const result = await pool.query("SELECT id, username, password_hash FROM users WHERE username = $1", [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: "ユーザー名またはパスワードが違います" });

        const user = result.rows[0];
        // パスワードの答え合わせ
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return res.status(401).json({ error: "ユーザー名またはパスワードが違います" });
        
        req.session.userId = user.id;
        req.session.username = user.username;
        res.json({ success: true, username: user.username });
    } catch (err) {
        res.status(500).json({ error: "ログインエラー" });
    }
});

// 投稿取得API
app.get("/api/get", async (req, res) => {
    const myId = req.session.userId || 0;
    try {
        const query = `
            SELECT 
                p.id, 
                u.username, 
                p.content, 
                COUNT(l.id) AS like_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) AS is_liked
            FROM posts p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN likes l ON p.id = l.post_id
            GROUP BY p.id, u.username
            ORDER BY p.id DESC
            LIMIT 100;
        `;
        const result = await pool.query(query, [myId]);
        const rows = result.rows.map(row => ({
            ...row,
            like_count: parseInt(row.like_count)
        }));
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "取得失敗" });
    }
});

// 投稿保存API
app.post("/api/post", async (req, res) => {
    const userId = req.session.userId;
    const { content } = req.body;
    if (!userId) return res.status(401).json({ error: "ログインしてください" });

    try {
        await pool.query(
            "INSERT INTO posts (user_id, content) VALUES ($1, $2)",
            [userId, content]
        );
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "保存失敗" });
    }
});

// いいねトグルAPI
app.post("/api/like", async (req, res) => {
    const { post_id } = req.body;
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ error: "ログインが必要です" });

    try {
        const check = await pool.query(
            "SELECT id FROM likes WHERE post_id = $1 AND user_id = $2",
            [post_id, userId]
        );
        
        if (check.rows.length > 0) {
            await pool.query("DELETE FROM likes WHERE post_id = $1 AND user_id = $2", [post_id, userId]);
        } else {
            await pool.query("INSERT INTO likes (post_id, user_id) VALUES ($1, $2)", [post_id, userId]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "操作失敗" });
    }
});

app.listen(port, () => {
    console.log(`SNSサーバー起動中: http://localhost:${port}`);
});