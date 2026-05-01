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

    // ユーザー名：3〜15文字、英数字とアンダースコアのみ許可
    const usernameRegex = /^[a-zA-Z0-9_]{3,15}$/;
    if (!usernameRegex.test(username)) {
        return res.status(400).json({ error: "ユーザー名は3〜15文字の英数字のみ有効です" });
    }

    // パスワード：8文字以上
    if (!password || password.length < 8) {
        return res.status(400).json({ error: "パスワードは8文字以上にしてください" });
    }

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

// /api/get を書き換え
app.get("/api/get", async (req, res) => {
    const myId = req.session.userId || 0;
    const { q } = req.query; // 検索クエリを取得

    try {
        let queryParams = [myId];
        let whereClause = "";

        // 検索クエリがある場合の処理
        if (q) {
            // スペース（全角・半角）で分割して空文字を除外
            const keywords = q.split(/\s+/).filter(k => k.length > 0);
            if (keywords.length > 0) {
                const conditions = keywords.map((k, i) => {
                    queryParams.push(`%${k}%`); // 部分一致用の % を付与
                    return `p.content ILIKE $${queryParams.length}`; // ILIKEで大文字小文字無視
                });
                whereClause = `AND (${conditions.join(' AND ')})`; // AND検索
            }
        }

        const query = `
            SELECT 
                p.id, 
                u.username, 
                p.content, 
                p.created_at,
                p.user_id = $1 AS is_mine, -- 自分の投稿かどうかの判定を追加[cite: 3]
                COUNT(l.id) AS like_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) AS is_liked
            FROM posts p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN likes l ON p.id = l.post_id
            WHERE 1=1 ${whereClause}
            GROUP BY p.id, u.username, p.created_at
            ORDER BY p.id DESC
            LIMIT 100;
        `;

        const result = await pool.query(query, queryParams);
        const rows = result.rows.map(row => ({
            ...row,
            like_count: parseInt(row.like_count)
        }));
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "取得失敗" });
    }
});

// 投稿APIの修正
app.post("/api/post", async (req, res) => {
    const { content } = req.body;
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ error: "ログインが必要です" });

    // バリデーション（空・文字数）
    if (!content || content.trim().length === 0) return res.status(400).json({ error: "投稿内容が空です" });
    if (content.length > 600) return res.status(400).json({ error: "投稿は600文字以内です" });

    try {
        // --- 連投制限チェック ---
        // 最新の投稿時間を取得
        const lastPostResult = await pool.query(
            "SELECT created_at FROM posts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
            [userId]
        );

        if (lastPostResult.rows.length > 0) {
            const lastPostTime = new Date(lastPostResult.rows[0].created_at);
            const now = new Date();
            const diffInSeconds = Math.floor((now - lastPostTime) / 1000);

            const LIMIT_SECONDS = 10; // 制限時間（秒）
            if (diffInSeconds < LIMIT_SECONDS) {
                const waitTime = LIMIT_SECONDS - diffInSeconds;
                return res.status(429).json({ // 429 Too Many Requests
                    error: `連投制限中です。あと ${waitTime} 秒待ってください` 
                });
            }
        }

        // 保存処理
        await pool.query("INSERT INTO posts (user_id, content) VALUES ($1, $2)", [userId, content]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "投稿失敗" });
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

// 投稿削除API
app.delete("/api/post/:id", async (req, res) => {
    const userId = req.session.userId;
    const postId = req.params.id;

    if (!userId) return res.status(401).json({ error: "ログインが必要です" });

    try {
        // 投稿の所有者を確認してから削除する
        const result = await pool.query(
            "DELETE FROM posts WHERE id = $1 AND user_id = $2 RETURNING *",
            [postId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ error: "自分の投稿以外は削除できません" });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "削除失敗" });
    }
});

app.listen(port, () => {
    console.log(`SNSサーバー起動中: http://localhost:${port}`);
});

// 投稿入力の監視
const textarea = document.getElementById('content');
const charCount = document.getElementById('char-count');
const postBtn = document.getElementById('post-button');

textarea.addEventListener('input', () => {
    const length = textarea.value.length;
    const remaining = 140 - length;
    
    charCount.textContent = remaining;
    
    // 残り文字数が少なくなったら赤くする
    if (remaining <= 20) {
        charCount.classList.add('warning');
    } else {
        charCount.classList.remove('warning');
    }

    // ボタンの有効・無効切り替え
    postBtn.disabled = length === 0 || length > 140;

    // 自動リサイズ
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
});