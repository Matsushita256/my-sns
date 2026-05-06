const { pipeline } = require('@xenova/transformers');

/**
 * AIモデルのロードを管理するシングルトン
 */
class FeatureExtractor {
    static instance = null;
    static async getInstance() {
        if (!this.instance) {
            // サーバー起動時に明示的にロードすることを推奨
            this.instance = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');
        }
        return this.instance;
    }
}

class RecommendationService {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * テキストをベクトルに変換
     */
    async generateEmbedding(text) {
        try {
            const extractor = await FeatureExtractor.getInstance();
            const output = await extractor(`query: ${text}`, { pooling: 'mean', normalize: true });
            return Array.from(output.data);
        } catch (err) {
            console.error("Embedding error:", err);
            return new Array(384).fill(0);
        }
    }

    /**
     * ユーザーの興味関心プロファイルを更新（ポジティブ/ネガティブ両面学習）
     */
    async updateInterestProfile(userId) {
        // 1. 過去の行動データを一括取得（いいね、投稿、低評価）
        const query = `
            WITH activity AS (
                SELECT p.embedding, 1.0 as weight FROM likes l JOIN posts p ON l.post_id = p.id WHERE l.user_id = $1
                UNION ALL
                SELECT embedding, 0.5 as weight FROM posts WHERE user_id = $1 AND embedding IS NOT NULL
                UNION ALL
                SELECT p.embedding, -1.2 as weight FROM dislikes d JOIN posts p ON d.post_id = p.id WHERE d.user_id = $1
            )
            SELECT embedding::float8[], weight FROM activity;
        `;
        const { rows } = await this.pool.query(query, [userId]);
        if (rows.length === 0) return;

        // 2. 重み付き平均ベクトルを計算
        let profile = new Array(384).fill(0);
        rows.forEach(row => {
            row.embedding.forEach((val, i) => profile[i] += val * row.weight);
        });

        // 3. 正規化して保存
        const magnitude = Math.sqrt(profile.reduce((s, v) => s + v * v, 0));
        const normalized = profile.map(v => (magnitude > 0 ? v / magnitude : 0));
        const vectorStr = `[${normalized.join(',')}]`;

        await this.pool.query(
            `INSERT INTO user_interests (user_id, interest_vector) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET interest_vector = $2, updated_at = NOW()`,
            [userId, vectorStr]
        );
    }

    async getRecommendedTimeline(userId = null, limit = 50) {
        if (userId) {
            // ユーザーの興味ベクトルとBioベクトルを両方取得
            const { rows: userRow } = await this.pool.query(
                `SELECT 
                    (SELECT interest_vector FROM user_interests WHERE user_id = $1) as interest_vector,
                    (SELECT bio_embedding FROM users WHERE id = $1) as bio_vector`,
                [userId]
            );
            const interestVector = userRow[0]?.interest_vector || null;
            const bioVector = userRow[0]?.bio_vector || null;

            if (interestVector) {
                return this._getPersonalizedTimeline(userId, interestVector, bioVector, limit);
            }
        }

        // ゲスト用ロジック
        return this._getGuestTimeline(limit);
    }

    // --- 2. 未ログイン（ゲスト）ユーザー向けロジック ---
    // 「(いいね数 - 低評価数) / 経過時間のべき乗」でスコアリング（Hacker NewsやRedditに近い方式）
    async _getGuestTimeline(limit) {
        const query = `
            SELECT p.*, u.username,
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                (SELECT COUNT(*) FROM dislikes WHERE post_id = p.id) AS dislike_count,
                -- 人気度スコア (いいね - 低評価*0.5)
                ((SELECT COUNT(*) FROM likes WHERE post_id = p.id) - (SELECT COUNT(*) FROM dislikes WHERE post_id = p.id) * 0.5) AS popularity_score,
                -- 経過時間（時間単位）
                EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 AS hours_old
            FROM posts p
            JOIN users u ON p.user_id = u.id
            ORDER BY 
                -- スコア計算: (人気度 + 1) / (経過時間 + 2)^1.5  ← 新しくて人気なものが上に来る数式
                ( ((SELECT COUNT(*) FROM likes WHERE post_id = p.id) - (SELECT COUNT(*) FROM dislikes WHERE post_id = p.id) * 0.5) + 1 ) 
                / POW((EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600) + 2, 1.5) DESC
            LIMIT $1;
        `;
        const { rows } = await this.pool.query(query, [limit]);
        return rows;
    }

    // --- 【修正】スコア計算式にフォローとBioを組み込む ---
    async _getPersonalizedTimeline(userId, interestVector, bioVector, limit) {
        const query = `
            SELECT p.*, u.username,
                ----- フロントエンド表示用フラグ -----

                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                (SELECT COUNT(*) FROM dislikes WHERE post_id = p.id) AS dislike_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) AS is_liked,
                EXISTS(SELECT 1 FROM dislikes WHERE post_id = p.id AND user_id = $1) AS is_disliked,
                (p.user_id = $1) AS is_mine,
                EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = p.user_id) AS is_following,

                ----- スコアリング項目 -----
                
                -- A. コンテンツスコア (興味ベクトルとの類似度)
                COALESCE(1 - (p.embedding <=> $2::vector), 0) AS interest_score,

                -- B. Bioスコア (自分のプロフィールと投稿内容の類似度。bio_vectorがない場合は0)
                CASE WHEN $3::vector IS NOT NULL THEN COALESCE(1 - (p.embedding <=> $3::vector), 0) ELSE 0 END AS bio_score,

                -- C. インタラクション（いいね履歴）
                (SELECT COUNT(*) * 0.1 FROM likes l WHERE l.post_id IN (SELECT id FROM posts WHERE user_id = p.user_id) AND l.user_id = $1) AS interaction_score,

                -- D. 協調フィルタリング
                (SELECT COUNT(*) * 0.2 FROM likes l WHERE l.post_id = p.id AND l.user_id IN (
                    SELECT user_id FROM user_interests WHERE user_id != $1 ORDER BY interest_vector <=> $2::vector LIMIT 10
                )) AS collaborative_score,

                -- E. フォローボーナス (フォローしているユーザーの投稿なら '1'、そうでないなら '0')
                CASE WHEN EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = p.user_id) THEN 1 ELSE 0 END AS is_followed,

                -- F. 鮮度ペナルティ
                (LOG(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 1) * 0.1) AS penalty

            FROM posts p
            JOIN users u ON p.user_id = u.id
            ORDER BY (
                (COALESCE(1 - (p.embedding <=> $2::vector), 0) * 1.5) +                                                                                -- 興味の一致 (強)
                (CASE WHEN $3::vector IS NOT NULL THEN COALESCE(1 - (p.embedding <=> $3::vector), 0) ELSE 0 END * 0.5) +                               -- Bioとの一致 (弱)
                (interaction_score * 1.0) +                                                                                                            -- 個人の交流
                (collaborative_score * 0.8) +                                                                                                          -- 似た人の評価
                (CASE WHEN EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = p.user_id) THEN 2.0 ELSE 0 END) -                    -- フォローによる絶対的加点(強)
                penalty
            ) DESC
            LIMIT $4;
        `;
        const { rows } = await this.pool.query(query, [userId, interestVector, bioVector, limit]);
        // 数値型への変換
        return rows.map(row => ({
            ...row,
            like_count: parseInt(row.like_count) || 0,
            dislike_count: parseInt(row.dislike_count) || 0
        }));
    }

    /**
     * 未処理の古い投稿をベクトル化（移行スクリプト）
     */
    async migrateMissingEmbeddings() {
        const { rows } = await this.pool.query("SELECT id, content FROM posts WHERE embedding IS NULL");
        for (const post of rows) {
            const vector = await this.generateEmbedding(post.content);
            await this.pool.query("UPDATE posts SET embedding = $1 WHERE id = $2", [`[${vector.join(',')}]`, post.id]);
        }
    }

    // --- 【新規】未処理のbioをベクトル化する初期化処理 ---
    async migrateMissingBioEmbeddings() {
        // bioが入力されているのに、bio_embeddingが空のユーザーを取得
        const { rows } = await this.pool.query(
            "SELECT id, bio FROM users WHERE bio IS NOT NULL AND bio != '' AND bio_embedding IS NULL"
        );
        for (const user of rows) {
            const vector = await this.generateEmbedding(user.bio);
            const vectorStr = `[${vector.join(',')}]`;
            await this.pool.query(
                "UPDATE users SET bio_embedding = $1 WHERE id = $2",
                [vectorStr, user.id]
            );
        }
        console.log(`Bio embedding migration complete for ${rows.length} users.`);
    }
}

module.exports = RecommendationService;