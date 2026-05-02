const pool = require("../config/db");
/**
 * サーバーサイド用データ供給クラス
 */
class ServerDatabaseManager {
    async getUserInteractions(userId) {
        const query = `
            SELECT post_id as "postId", user_id as "authorId", 'like' as type, created_at as "createdAt"
            FROM likes WHERE user_id = $1
            UNION ALL
            SELECT post_id as "postId", user_id as "authorId", 'dislike' as type, created_at as "createdAt"
            FROM dislikes WHERE user_id = $1
        `;
        const result = await pool.query(query, [userId]);
        return result.rows;
    }

    async getUserLikedPostIds(userId) {
        const result = await pool.query("SELECT post_id FROM likes WHERE user_id = $1", [userId]);
        return result.rows.map(r => r.post_id);
    }

    async getUserRecentLikeVectors(userId) {
        // 直近の「いいね」した投稿のベクトルを取得
        const query = `
            SELECT p.embedding as vector, l.created_at as "createdAt"
            FROM likes l
            JOIN posts p ON l.post_id = p.id
            WHERE l.user_id = $1
            ORDER BY l.created_at DESC LIMIT 10
        `;
        const result = await pool.query(query, [userId]);
        return result.rows;
    }

    async saveUserInterest(userId, vector) {
        const query = `
        INSERT INTO user_interests (user_id, interest_vector, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) 
        DO UPDATE SET interest_vector = $2, updated_at = CURRENT_TIMESTAMP
    `;
        await pool.query(query, [userId, JSON.stringify(vector)]);
    }

    async getUserInterestProfile(userId) {
        const query = "SELECT interest_vector FROM user_interests WHERE user_id = $1";
        const result = await pool.query(query, [userId]);
        return result.rows.length > 0 ? result.rows[0].interest_vector : null;
    }

    // 自分の過去の投稿ベクトルを取得
    async getUserRecentPostVectors(userId) {
        const query = `
        SELECT embedding as vector, created_at as "createdAt"
        FROM posts WHERE user_id = $1 AND embedding IS NOT NULL
        ORDER BY created_at DESC LIMIT 50
    `;
        const res = await pool.query(query, [userId]);
        return res.rows;
    }

    // 低評価した投稿のベクトルを取得
    async getUserRecentDislikeVectors(userId) {
        const query = `
        SELECT p.embedding as vector, d.created_at as "createdAt"
        FROM dislikes d
        JOIN posts p ON d.post_id = p.id
        WHERE d.user_id = $1 AND p.embedding IS NOT NULL
        ORDER BY d.created_at DESC LIMIT 50
    `;
        const res = await pool.query(query, [userId]);
        return res.rows;
    }
}

module.exports = ServerDatabaseManager;