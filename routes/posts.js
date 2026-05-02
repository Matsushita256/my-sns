const express = require("express");
const router = express.Router();
const pool = require("../config/db");

// タイムライン取得API
router.get("/get", async (req, res) => {
    const userId = req.session.userId || 0;
    const { q } = req.query; // 検索クエリを取得

    try {
        let queryParams = [userId]; // $1 は常に自分のID
        let whereClause = "";

        // 検索クエリがある場合の処理
        if (q) {
            // スペース（全角・半角）で分割して空文字を除外
            const keywords = q.split(/\s+/).filter(k => k.length > 0);
            if (keywords.length > 0) {
                const conditions = keywords.map((k) => {
                    queryParams.push(`%${k}%`); // $2, $3... とパラメータを追加
                    return `p.content ILIKE $${queryParams.length}`; // ILIKEで大文字小文字無視
                });
                // 作成された条件を AND で結合
                whereClause = `AND (${conditions.join(' AND ')})`;
            }
        }

        // クエリ文字列の作成
        // WHERE 1=1 ${whereClause} を使うことで、動的な検索条件を統合します
        const query = `
            SELECT 
                p.*, 
                u.username,
                (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
                (SELECT COUNT(*) FROM dislikes d WHERE d.post_id = p.id) AS dislike_count,
                EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1) AS is_liked,
                EXISTS(SELECT 1 FROM dislikes d WHERE d.post_id = p.id AND d.user_id = $1) AS is_disliked,
                (p.user_id = $1) AS is_mine
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE 1=1 ${whereClause}
            ORDER BY p.created_at DESC
            LIMIT 100;
        `;

        const result = await pool.query(query, queryParams);
        
        // カウント値は PostgreSQL から文字列で返ってくるため、数値に変換してクライアントに返します
        const rows = result.rows.map(row => ({
            ...row,
            like_count: parseInt(row.like_count) || 0,
            dislike_count: parseInt(row.dislike_count) || 0
        }));
        
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "取得失敗" });
    }
});

// 投稿API
router.post("/post", async (req, res) => {
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
                return res.status(400).json({
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

// 投稿削除API
router.delete("/deletePost", async (req, res) => {
    const userId = req.session.userId;
    const { post_id } = req.body;

    if (!userId) return res.status(401).json({ error: "ログインが必要です" });

    try {
        // 投稿の所有者を確認してから削除する
        const result = await pool.query(
            "DELETE FROM posts WHERE id = $1 AND user_id = $2 RETURNING *",
            [post_id, userId]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ error: "自分の投稿以外は削除できません" });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "削除失敗" });
    }
});

// いいねトグルAPI
router.post("/like", async (req, res) => {
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

// 低評価のトグル処理
router.post("/dislike", async (req, res) => {
    const { post_id } = req.body;
    const userId = req.session.userId;

    if (!userId) return res.status(401).json({ error: "ログインが必要です" });

    try {
        // 既存の低評価があるか確認
        const check = await pool.query(
            "SELECT id FROM dislikes WHERE user_id = $1 AND post_id = $2",
            [userId, post_id]
        );

        if (check.rows.length > 0) {
            // すでに低評価済みなら削除（取り消し）
            await pool.query("DELETE FROM dislikes WHERE user_id = $1 AND post_id = $2", [userId, post_id]);
            res.json({ success: true, action: "un-disliked" });
        } else {
            // 低評価がなければ追加
            await pool.query("INSERT INTO dislikes (user_id, post_id) VALUES ($1, $2)", [userId, post_id]);
            res.json({ success: true, action: "disliked" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "低評価の処理に失敗しました" });
    }
});

module.exports = router;