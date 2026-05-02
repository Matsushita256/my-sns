const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const pool = require("../config/db");

// ユーザー名の重複チェック
router.get("/check-username", async (req, res) => {
    const { username } = req.query;
    try {
        const result = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
        res.json({ exists: result.rows.length > 0 });
    } catch (err) {
        res.status(500).json({ error: "チェックに失敗しました" });
    }
});

// 新規登録API
router.post("/register", async (req, res) => {
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
router.post("/login", async (req, res) => {
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

// アカウント削除API
router.delete("/account", async (req, res) => {
    const { password } = req.body; // フロントエンドから送られてくるパスワード
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ error: "ログインが必要です" });
    if (!password) return res.status(400).json({ error: "確認のためパスワードを入力してください" });

    try {
        // 1. パスワードの照合
        const userResult = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
        const user = userResult.rows[0];

        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) return res.status(401).json({ error: "パスワードが正しくありません" });

        // 2. ユーザーの削除（CASCADE設定により関連データも自動削除）
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);

        // 3. セッション破棄
        req.session.destroy((err) => {
            if (err) throw err;
            res.clearCookie('connect.sid');
            res.json({ success: true });
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "アカウント削除に失敗しました" });
    }
});

// パスワード変更API
router.post("/change-password", async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ error: "ログインが必要です" });
    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: "新しいパスワードは8文字以上にしてください" });
    }

    try {
        // 1. 現在のパスワードが正しいか確認
        const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
        const user = result.rows[0];

        const isValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValid) return res.status(401).json({ error: "現在のパスワードが間違っています" });

        // 2. 新しいパスワードをハッシュ化して更新
        const newHashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHashedPassword, userId]);

        res.json({ success: true, message: "パスワードを更新しました" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "パスワード変更に失敗しました" });
    }
});

// 現在のログイン状態を確認するAPI
router.get("/status", (req, res) => {
    if (req.session.userId) {
        // セッションが存在すればユーザー情報を返す
        res.json({
            isLoggedIn: true,
            username: req.session.username,
            userId: req.session.userId
        });
    } else {
        res.json({ isLoggedIn: false });
    }
});

// ログアウトAPI
router.post("/logout", (req, res) => {
    // セッションを破棄する
    req.session.destroy((err) => {
        if (err) {
            console.error("Logout error:", err);
            return res.status(500).json({ error: "ログアウトに失敗しました" });
        }
        // ブラウザ側のセッションクッキーを削除する
        res.clearCookie('connect.sid'); 
        res.json({ success: true, message: "ログアウトしました" });
    });
});

module.exports = router;