const express = require("express");
const router = express.Router();
const pool = require("../config/db");
// const { RecommendationEngine, generateEmbedding, migrateMissingEmbeddings } = require("../controllers/recommendation-engine");
// const DatabaseManager = require("../controllers/database-manager");
// const engine = new RecommendationEngine();
// const dbManager = new DatabaseManager();
const RecommendationService = require('../services/recommendationService');
const recService = new RecommendationService(pool);

router.get("/get", async (req, res) => {
    const userId = req.session.userId;  // ログインしてなければ undefined
    const { q } = req.query;

    try {
        const posts = await recService.getRecommendedTimeline(userId);
        res.json(posts);
    } catch (err) {
        console.error("Timeline error:", err);
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

        const embedding = await recService.generateEmbedding(content);

        // --- 保存処理の修正：embeddingカラムを追加 ---
        // $3としてJSON文字列化した配列を渡します
        await pool.query(
            "INSERT INTO posts (user_id, content, embedding) VALUES ($1, $2, $3)",
            [userId, content, JSON.stringify(embedding)]
        );

        // engine.updateUserInterestProfile(userId, dbManager).catch(err => {
        //     console.error("Profile update error (post):", err);
        // });
        await recService.updateInterestProfile(userId);

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

        recService.updateInterestProfile(userId);
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

        // // バックエンドでプロファイルを更新 ---
        // // awaitを使わずに実行することで、レスポンスを待たせずに裏側で計算させる
        // engine.updateUserInterestProfile(userId, dbManager).catch(err => {
        //     console.error("Profile update error:", err);
        // });
        await recService.updateInterestProfile(userId);

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
            await pool.query("DELETE FROM dislikes WHERE user_id = $1 AND post_id = $2", [userId, post_id]);
        } else {
            await pool.query("INSERT INTO dislikes (user_id, post_id) VALUES ($1, $2)", [userId, post_id]);
        }

        // engine.updateUserInterestProfile(userId, dbManager).catch(err => {
        //     console.error("Profile update error (dislike):", err);
        // });

        await recService.updateInterestProfile(userId);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "低評価の処理に失敗しました" });
    }
});


// プロフィール情報取得 API (強化版：フォロワー数やフォロー状態も返す)
router.get("/profile", async (req, res) => {
    const loggedInUserId = req.session.userId || 0; // ログインしていなければ0
    const { username } = req.query;

    try {
        const query = `
            SELECT u.id, u.username, u.bio,
                (SELECT COUNT(*) FROM follows WHERE following_id = u.id) AS follower_count,
                (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) AS following_count,
                EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = u.id) AS is_following
            FROM users u WHERE u.username = $2;
        `;
        const result = await pool.query(query, [loggedInUserId, username]);
        
        if (result.rows.length === 0) return res.status(404).json({ error: "ユーザーが見つかりません" });
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "取得失敗" });
    }
});

// フォロー・アンフォローのトグル API (修正)
// フロントエンドの toggleFollow(targetUsername) に対応
router.post("/follow", async (req, res) => {
    const followerId = req.session.userId;
    const { target_username } = req.body;

    if (!followerId) return res.status(401).json({ error: "ログインが必要です" });

    try {
        // ユーザー名からターゲットのIDを引く
        const userRes = await pool.query("SELECT id FROM users WHERE username = $1", [target_username]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "ユーザーが見つかりません" });
        
        const followingId = userRes.rows[0].id;
        if (followerId === followingId) return res.status(400).json({ error: "自分自身はフォローできません" });

        // 現在のフォロー状態を確認
        const check = await pool.query(
            "SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2",
            [followerId, followingId]
        );

        if (check.rows.length > 0) {
            // 解除
            await pool.query("DELETE FROM follows WHERE follower_id = $1 AND following_id = $2", [followerId, followingId]);
            res.json({ following: false });
        } else {
            // フォロー
            await pool.query("INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)", [followerId, followingId]);
            res.json({ following: true });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "フォロー操作に失敗しました" });
    }
});

// プロフィール更新 API (提供されたものを統合)
router.put("/profile", async (req, res) => {
    const userId = req.session.userId;
    const { bio } = req.body;

    if (!userId) return res.status(401).json({ error: "ログインが必要です" });
    if (bio && bio.length > 160) return res.status(400).json({ error: "プロフィールは160文字以内で入力してください" });

    try {
        let bioVectorStr = null;
        if (bio && bio.trim() !== "") {
            const vector = await recService.generateEmbedding(bio);
            bioVectorStr = `[${vector.join(',')}]`;
        }

        await pool.query(
            "UPDATE users SET bio = $1, bio_embedding = $2 WHERE id = $3",
            [bio, bioVectorStr, userId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "更新に失敗しました" });
    }
});

// 特定ユーザーの投稿一覧を取得するAPI (追加)
router.get("/user/:username", async (req, res) => {
    const loggedInUserId = req.session.userId || 0;
    const { username } = req.params;

    try {
        const query = `
            SELECT p.*, u.username,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                (SELECT COUNT(*) FROM dislikes WHERE post_id = p.id) AS dislike_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) AS is_liked,
                EXISTS(SELECT 1 FROM dislikes WHERE post_id = p.id AND user_id = $1) AS is_disliked,
                (p.user_id = $1) AS is_mine,
                EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = p.user_id) AS is_following
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE u.username = $2
            ORDER BY p.created_at DESC
            LIMIT 50;
        `;
        const { rows } = await pool.query(query, [loggedInUserId, username]);
        
        // 数値型への変換
        res.json(rows.map(row => ({
            ...row,
            like_count: parseInt(row.like_count) || 0,
            dislike_count: parseInt(row.dislike_count) || 0
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "取得失敗" });
    }
});

module.exports = router;