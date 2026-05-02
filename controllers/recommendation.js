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

    async getUserRecentVectors(userId) {
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
}
/**
 * リコメンドエンジンの設定とユーティリティ
 */
class RecommendationEngine {
    constructor() {
        // 各スコアの重み付け（いい感じの初期値）
        this.weights = {
            interaction: 1.5,   // 直接のインタラクション（いいね/低評価）
            collaborative: 1.0, // 協調フィルタリング（似たユーザー）
            content: 2.0        // コンテンツ類似度
        };
        
        // 時間減衰の半減期設定（時間単位）
        this.halfLife = {
            postAge: 24,        // 投稿自体の鮮度（24時間でスコア半減）
            userInterest: 72    // ユーザーの過去の関心の鮮度（72時間で影響力半減）
        };
    }

    /**
     * 指数関数的減衰を計算する
     * @param {number} ageHours - 経過時間
     * @param {number} halfLifeHours - 半減期
     * @returns {number} 0.0 ~ 1.0 の減衰係数
     */
    calculateTimeDecay(ageHours, halfLifeHours) {
        if (ageHours <= 0) return 1.0;
        const lambda = Math.LN2 / halfLifeHours;
        return Math.exp(-lambda * ageHours);
    }

    /**
     * 2つのベクトル間のコサイン類似度を計算する
     * @param {number[]} vecA 
     * @param {number[]} vecB 
     * @returns {number} -1.0 ~ 1.0
     */
    cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * メイン処理：候補投稿のスコアリングを行う
     * @param {string} currentUserId - 現在のユーザーID
     * @param {Array} candidatePosts - タイムラインに表示する候補投稿の配列
     * @param {Object} db - データベースアクセスのモック（ユーザー履歴やいいね情報の取得用）
     * @returns {Promise<Array>} スコア順にソートされた投稿配列
     */
    async rankPosts(currentUserId, candidatePosts, db) {
        const rankedPosts = [];
        const now = new Date();

        // 【事前準備】現在のユーザーの情報をDBから一括取得しておく
        // (次回実装: ユーザーの過去のいいね履歴、直近の投稿ベクトルなどを取得)
        const currentUserContext = await this.getUserContext(currentUserId, db);

        for (const post of candidatePosts) {
            // 投稿の経過時間（時間）
            const postAgeHours = (now - new Date(post.createdAt)) / (1000 * 60 * 60);

            // 1. インタラクション・スコア
            const interactionScore = await this.calcInteractionScore(currentUserContext, post.authorId, db);

            // 2. 協調フィルタリング・スコア
            const collabScore = await this.calcCollaborativeScore(currentUserContext, post.authorId, post.id, db);

            // 3. コンテンツ・ベース・スコア（改良版：Max-Pooling）
            const contentScore = this.calcContentScore(currentUserContext.recentVectors, post.embedding);

            // 総合スコアの算出（各種スコアの加重和 × 投稿鮮度の減衰）
            const baseScore = 
                (interactionScore * this.weights.interaction) +
                (collabScore * this.weights.collaborative) +
                (contentScore * this.weights.content);

            const postDecay = this.calculateTimeDecay(postAgeHours, this.halfLife.postAge);
            const finalScore = baseScore * postDecay;

            rankedPosts.push({ ...post, finalScore });
        }

        // スコアが高い順にソートして返す
        return rankedPosts.sort((a, b) => b.finalScore - a.finalScore);
    }

    // --- 以下のメソッド群はステップ2で実装します ---
    // async getUserContext(userId, db) { /* ... */ }
    // async calcInteractionScore(context, authorId, db) { /* ... */ }
    // async calcCollaborativeScore(context, authorId, postId, db) { /* ... */ }
    // calcContentScore(userVectors, postVector) { /* ... */ }
    /**
     * 【準備】ユーザーの文脈（過去の行動履歴や関心ベクトル）を取得する
     */
    async getUserContext(userId, db) {
        // ※実際の実装では、DBから必要な情報を一括または並行（Promise.all）で取得します
        
        // 1. 過去のいいね/低評価の履歴（対象の投稿ID、投稿者ID、タイムスタンプを含む）
        const rawInteractions = await db.getUserInteractions(userId);
        
        // 2. 協調フィルタリング用に、いいねした投稿IDのSetを作っておく（検索の高速化）
        const likedPostIds = new Set(
            rawInteractions.filter(i => i.type === 'like').map(i => i.postId)
        );

        // 3. ユーザーが最近投稿（またはいいね）したコンテンツの埋め込みベクトル配列
        const recentVectors = await db.getUserRecentVectors(userId);

        return {
            userId: userId,
            interactions: rawInteractions,
            likedPostIds: likedPostIds,
            recentVectors: recentVectors
        };
    }

    /**
     * 1. インタラクション・スコアの計算
     * 「過去にその投稿者に対して行ったアクション」を加点・減点します
     */
    async calcInteractionScore(context, authorId, db) {
        if (context.userId === authorId) return 0; // 自分の投稿は評価対象外

        let score = 0;
        const now = new Date();

        // このターゲット投稿者に対する過去のアクションだけを抽出
        const authorInteractions = context.interactions.filter(i => i.authorId === authorId);

        for (const interaction of authorInteractions) {
            // アクション（いいね等）をしてから経過した時間
            const ageHours = (now - new Date(interaction.createdAt)) / (1000 * 60 * 60);
            
            // 古いアクションほど影響力を小さくする（時間減衰）
            const decay = this.calculateTimeDecay(ageHours, this.halfLife.userInterest);

            if (interaction.type === 'like') {
                score += 1.0 * decay;
            } else if (interaction.type === 'dislike') {
                score -= 1.0 * decay;
            }
        }

        // 一人のユーザーへの過剰な偏りを防ぐため、スコアを一定の範囲（例: -2.0 ~ 2.0）にクリップする
        return Math.max(-2.0, Math.min(score, 2.0));
    }

    /**
     * 2. 協調フィルタリング・スコアの計算
     * 「同じ投稿にいいねしたユーザー（＝趣味が似ているユーザー）の投稿」を加点します
     */
    async calcCollaborativeScore(context, authorId, postId, db) {
        if (context.userId === authorId) return 0;

        // 投稿者（authorId）が過去に「いいね」した投稿IDのリストを取得
        const authorLikedPostIds = new Set(await db.getUserLikedPostIds(authorId));

        if (authorLikedPostIds.size === 0 || context.likedPostIds.size === 0) return 0;

        // 現在のユーザーと投稿者の「いいね」の一致具合（Jaccard係数）を計算
        let intersectionCount = 0;
        for (const id of context.likedPostIds) {
            if (authorLikedPostIds.has(id)) {
                intersectionCount++;
            }
        }

        // 和集合のサイズ
        const unionCount = context.likedPostIds.size + authorLikedPostIds.size - intersectionCount;
        
        // 類似度は 0.0 ~ 1.0 の範囲になる
        const similarity = intersectionCount / unionCount; 

        return similarity;
    }

    /**
     * 3. コンテンツ・ベース・スコアの計算（Max-Pooling アプローチ）
     * ユーザーの過去の関心ベクトル群と、ターゲット投稿のベクトルを比較します
     */
    calcContentScore(userVectors, postVector) {
        if (!userVectors || userVectors.length === 0 || !postVector) return 0;

        let maxScore = -1; // コサイン類似度の最小値は -1
        const now = new Date();

        for (const userVecData of userVectors) {
            // postVector と userVecData.vector のコサイン類似度を計算
            const similarity = this.cosineSimilarity(userVecData.vector, postVector);
            
            // ベクトル（過去の投稿やいいねした記事）の鮮度による時間減衰
            const ageHours = (now - new Date(userVecData.createdAt)) / (1000 * 60 * 60);
            const decay = this.calculateTimeDecay(ageHours, this.halfLife.userInterest);
            
            const decayedSimilarity = similarity * decay;

            // 最も類似度が高いものを採用 (Max-Pooling)
            if (decayedSimilarity > maxScore) {
                maxScore = decayedSimilarity;
            }
        }

        // コサイン類似度がマイナス（全く無関係・逆の話題）の場合は0に丸める
        return Math.max(0, maxScore);
    }
}