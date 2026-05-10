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
        try {
            // 1. 活動データ（いいね・投稿・低評価）を重み付きで収集するクエリ
            const query = `
            WITH activity AS (
                -- いいねした投稿 (重み: 1.0)
                SELECT p.embedding, 1.0 as weight 
                FROM likes l 
                JOIN posts p ON l.post_id = p.id 
                WHERE l.user_id = $1 AND p.embedding IS NOT NULL
                
                UNION ALL
                
                -- 自分の投稿 (重み: 0.5)
                SELECT embedding, 0.5 as weight 
                FROM posts 
                WHERE user_id = $1 AND embedding IS NOT NULL
                
                UNION ALL
                
                -- 低評価した投稿 (重み: -1.0)
                SELECT p.embedding, -1.0 as weight 
                FROM dislikes d 
                JOIN posts p ON d.post_id = p.id 
                WHERE d.user_id = $1 AND p.embedding IS NOT NULL
            )
            SELECT embedding, weight FROM activity;
        `;

            const { rows } = await this.pool.query(query, [userId]);

            if (rows.length === 0) return;

            // 2. JavaScript側で重み付き平均ベクトルを計算
            // (SQLだけで計算するより重みの調整やデバッグがしやすいため)
            const dimension = 384;
            let weightedSum = new Float32Array(dimension).fill(0);
            let totalWeight = 0;

            for (const row of rows) {
                // row.embedding は文字列 "[0.1, 0.2...]" または配列として返ってくる
                const vector = typeof row.embedding === 'string'
                    ? JSON.parse(row.embedding.replace('{', '[').replace('}', ']'))
                    : row.embedding;

                const weight = parseFloat(row.weight);

                for (let i = 0; i < dimension; i++) {
                    weightedSum[i] += vector[i] * weight;
                }
                totalWeight += Math.abs(weight); // 正規化のための重み合計
            }

            if (totalWeight === 0) return;

            // 平均化
            const finalVector = Array.from(weightedSum).map(v => v / totalWeight);
            const vectorStr = `[${finalVector.join(',')}]`;

            // 3. 結果を user_interests テーブルに保存
            // すでに行があれば更新(UPDATE)、なければ挿入(INSERT)
            await this.pool.query(`
            INSERT INTO user_interests (user_id, interest_vector, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                interest_vector = EXCLUDED.interest_vector,
                updated_at = NOW();
        `, [userId, vectorStr]);

            console.log(`Updated interest profile for user: ${userId}`);
        } catch (err) {
            console.error("updateInterestProfile error:", err);
        }
    }

    async getRecommendedTimeline(userId = null, limit = 200, searchWords = null) {
        if (userId) {
            // ユーザーの興味ベクトルとBioベクトルを両方取得
            const { rows: userRow } = await this.pool.query(
                `SELECT 
                    (SELECT interest_vector FROM user_interests WHERE user_id = $1) as interest_vector,
                    (SELECT bio_embedding FROM users WHERE id = $1) as bio_vector`,
                [userId]
            );
            let interestVector = userRow[0]?.interest_vector || null;
            const bioVector = userRow[0]?.bio_vector || null;

            // // interest_vectorがない場合、生成を試みる
            // if (!interestVector) {
            //     // 過去の行動（いいね等）からプロファイルを計算
            //     await this.updateInterestProfile(userId);

            //     // 再度DBから取得
            //     const { rows: retryRow } = await this.pool.query(
            //         "SELECT interest_vector FROM user_interests WHERE user_id = $1",
            //         [userId]
            //     );
            //     interestVector = retryRow[0]?.interest_vector || null;
            // }

            // interestVector または bioVector のいずれかがあればパーソナライズ版を返す
            if (interestVector || bioVector) {
                return this._getPersonalizedTimeline(userId, interestVector, bioVector, limit, searchWords);
            }
        }

        // ゲスト用ロジック
        return this._getGuestTimeline(limit, searchWords);
    }

    // --- 2. 未ログイン（ゲスト）ユーザー向けロジック ---
    // 「(いいね数 - 低評価数) / 経過時間のべき乗」でスコアリング（Hacker NewsやRedditに近い方式）
    async _getGuestTimeline(limit, searchWords) {
        const query = `
            -- ゲスト用タイムライン：個人データがないため「全体の人気度」と「鮮度」のみでスコアリング
            WITH scores AS (
                SELECT 
                    p.id,

                    -- F. 鮮度ペナルティ (直近1週間を基準とした減衰)
                    (POW(GREATEST(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600, 0) / 168.0, 1.5) * 3.0) AS penalty,

                    -- G. グローバル人気度スコア (純粋な評価の全体量)
                    -- いいね数から低評価(重め)を引いた値の対数を取る。
                    (LOG(GREATEST((SELECT COUNT(*) FROM likes WHERE post_id = p.id) - (SELECT COUNT(*) FROM dislikes WHERE post_id = p.id) * 2.0, 1.0)) * 0.2) AS popularity_score
                FROM posts p
                WHERE ($2::text[] IS NULL OR p.content ILIKE ALL($2::text[]))
            )
            -- メインクエリ
            SELECT 
                p.id, p.content, p.created_at, p.user_id, u.username,

                ----- フロントエンド表示用フラグ（未ログインなので全てfalse） -----
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                (SELECT COUNT(*) FROM dislikes WHERE post_id = p.id) AS dislike_count,
                false AS is_liked,
                false AS is_disliked,
                false AS is_mine,
                false AS is_following,

                ----- スコアリング項目の表示（本番環境では隠す） -----
                0.0 AS interest_score, 
                0.0 AS bio_score, 
                0.0 AS interaction_score, 
                0.0 AS collaborative_score, 
                0.0 AS follow_score, 
                s.penalty, 
                s.popularity_score,

                ----- 合計スコアリング -----
                ( 
                      (s.popularity_score * 5.0)  -- ゲスト用は人気度を主軸にするため、影響力を引き上げる
                    - s.penalty                   -- 時間経過による自然減点
                ) AS total_score
            FROM posts p
            JOIN users u ON p.user_id = u.id
            JOIN scores s ON p.id = s.id
            ORDER BY total_score DESC
            LIMIT $1;
        `;
        const { rows } = await this.pool.query(query, [limit, searchWords]);
        return rows;
    }

    // --- スコア計算式にフォローとBioを組み込む ---
    async _getPersonalizedTimeline(userId, interestVector, bioVector, limit, searchWords) {
        const query = `
            -- 1. 各要素のスコアを個別に計算
            WITH scores AS (
                -- 興味ベクトルの近いユーザー10人を予め取得しておく（協調フィルタリングで使う）
                WITH similar_users AS (
                    SELECT user_id FROM user_interests 
                    WHERE user_id != $1 
                    ORDER BY interest_vector <=> $2::vector 
                    LIMIT 10
                ),
                
                -- 類似ユーザー10人が「いいね」した各投稿のカウントを予め集計
                collaborative_likes AS (
                    SELECT l.post_id, COUNT(*) * 1.0 AS collab_count
                    FROM likes l
                    WHERE l.user_id IN (SELECT user_id FROM similar_users)
                    GROUP BY l.post_id
                ),

                -- ログインユーザー($1)が各投稿者に対して行った「いいね」「低評価」の合計を予め計算
                -- （postsテーブル全体をスキャンさせないため、直接アクション履歴から逆引きして集計）
                user_interactions AS (
                    SELECT 
                        author_id,
                        SUM(is_like) AS likes_given,
                        SUM(is_dislike) AS dislikes_given
                    FROM (
                        SELECT p2.user_id AS author_id, 1 AS is_like, 0 AS is_dislike
                        FROM likes l JOIN posts p2 ON l.post_id = p2.id WHERE l.user_id = $1
                        UNION ALL
                        SELECT p2.user_id AS author_id, 0 AS is_like, 1 AS is_dislike
                        FROM dislikes d JOIN posts p2 ON d.post_id = p2.id WHERE d.user_id = $1
                    ) actions
                    GROUP BY author_id
                )

                -- スコア計算の本体
                SELECT 
                    p.id,

                    -- A. コンテンツスコア (興味ベクトルとのコサイン類似度。interest_vectorがない場合は0)
                    CASE WHEN $2::vector IS NOT NULL THEN COALESCE(1 - (p.embedding <=> $2::vector), 0) ELSE 0 END AS interest_score,

                    -- B. Bioスコア (自分のプロフィールとのコサイン類似度。bio_vectorがない場合は0)
                    CASE WHEN $3::vector IS NOT NULL THEN COALESCE(1 - (p.embedding <=> $3::vector), 0) ELSE 0 END AS bio_score,

                    -- C. インタラクションスコア（ユーザーが投稿者の投稿に対して計何回いいね、低評価をしているか）
                    -- 5いいねで0.5スコアが得られる。値域は飽和曲線で-1～1になるように調整
                    COALESCE(
                        CASE 
                            WHEN (ui.likes_given - ui.dislikes_given * 2.0) >= 0 THEN
                                (ui.likes_given - ui.dislikes_given * 2.0) / ((ui.likes_given - ui.dislikes_given * 2.0) + 5.0)
                            ELSE
                                -1.0 * ABS(ui.likes_given - ui.dislikes_given * 2.0) / (ABS(ui.likes_given - ui.dislikes_given * 2.0) + 5.0)
                        END, 
                        0.0
                    ) AS interaction_score,

                    -- D. 協調フィルタリング
                    -- 「自分と好みが近い上位10人のユーザーのうち、その投稿に『いいね』をした人が何人いるか」をスコアとする
                    COALESCE(cl.collab_count, 0.0) AS collaborative_score,

                    -- E. フォローボーナス (フォローしているユーザーの投稿なら '1'、そうでないなら '0')
                    CASE WHEN EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = p.user_id) THEN 1.0 ELSE 0.0 END AS follow_score,

                    -- F. 鮮度ペナルティ
                    -- EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 の部分は経過時間[h]を表す
                    (POW(GREATEST(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600, 0) / 168.0, 1.5) * 3.0) AS penalty,

                    -- G. グローバル人気度スコア (純粋な評価の全体量)
                    -- いいね数から低評価(重め)を引いた値の対数を取る。
                    -- バズによる無限加点を防ぎ、100いいねで約0.4、1000いいねで約0.6のボーナスとする
                    (LOG(GREATEST((SELECT COUNT(*) FROM likes WHERE post_id = p.id) - (SELECT COUNT(*) FROM dislikes WHERE post_id = p.id) * 2.0, 1.0)) * 0.2) AS popularity_score
                FROM posts p
                LEFT JOIN user_interactions ui ON p.user_id = ui.author_id
                LEFT JOIN collaborative_likes cl ON p.id = cl.post_id
                WHERE ($5::text[] IS NULL OR p.content ILIKE ALL($5::text[]))
            )
            -- 2. メインのクエリで最終的な合計スコアを算出
            SELECT 
                p.id, p.content, p.created_at, p.user_id, u.username,

                ----- フロントエンド表示用フラグ -----
                (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS like_count,
                (SELECT COUNT(*) FROM dislikes WHERE post_id = p.id) AS dislike_count,
                EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $1) AS is_liked,
                EXISTS(SELECT 1 FROM dislikes WHERE post_id = p.id AND user_id = $1) AS is_disliked,
                (p.user_id = $1) AS is_mine,
                EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = p.user_id) AS is_following,

                ----- スコアリング項目の表示（本番環境では隠す） -----
                s.interest_score, s.bio_score, s.interaction_score, s.collaborative_score, s.follow_score, s.penalty, s.popularity_score,

                ----- 合計スコアリング -----
                ( 
                      (POW(s.interest_score, 3) * 2.0)   -- 最大2.0: コンテンツの「刺さり具合」を最重視
                    + (s.bio_score * 0.5)                -- 最大0.5: 同属性（同業者など）への軽いボーナス
                    + (s.interaction_score * 0.8)        -- -0.8 ～ 0.8: 親密な人を押し上げ、嫌いな人を明確に沈める
                    + (s.collaborative_score * 0.1)      -- 最大1.0 (10人中10人いいね想定): 類友の評価を反映
                    + (s.popularity_score * 1.0)         -- 最大0.6程度: 世間のバズり度合い
                    + (s.follow_score * 0.8)             -- 「自らフォローした」という明確な意思を尊重
                    - s.penalty                          -- -0.0 ～ -0.3程度: 時間経過による自然減点
                ) AS total_score
            FROM posts p
            JOIN users u ON p.user_id = u.id
            JOIN scores s ON p.id = s.id
            ORDER BY total_score DESC
            LIMIT $4;
        `;
        const { rows } = await this.pool.query(query, [userId, interestVector, bioVector, limit, searchWords]);
        return rows;
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

    // --- 未処理のbioをベクトル化する初期化処理 ---
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

    async initializeMissingInterestVectors() {
        // 1. interest_vector が NULL のユーザーとプロフィールを取得
        const { rows } = await this.pool.query(`
            SELECT u.id AS user_id
            FROM users u
            LEFT JOIN user_interests ui ON u.id = ui.user_id
            WHERE ui.interest_vector IS NULL
        `);
        for (const user of rows) {
            this.updateInterestProfile(user.user_id);
        }

        console.log(`Missing interest vector initialization complete for ${rows.length}`);
    }
}

module.exports = RecommendationService;