const pool = require("../config/db");

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

        // ユーザーのコンテキスト（履歴）と、今回実装したプロファイル（凝縮された好み）を両方取得
        const [context, interestProfile] = await Promise.all([
            this.getUserContext(currentUserId, db),
            db.getUserInterestProfile(currentUserId)
        ]);

        for (const post of candidatePosts) {
            const postAgeHours = (now - new Date(post.created_at)) / (1000 * 60 * 60);

            // 1. インタラクション・スコア
            const interactionScore = await this.calcInteractionScore(context, post.user_id, db);

            // 2. 協調フィルタリング・スコア
            const collabScore = await this.calcCollaborativeScore(context, post.user_id, post.id, db);

            // 3. コンテンツ・ベース・スコア（プロファイルがある場合はそれとの類似度を優先）
            let contentScore = 0;
            if (interestProfile && post.embedding) {
                contentScore = this.cosineSimilarity(interestProfile, post.embedding);
            } else {
                // プロファイルがない場合は、直近の投稿ベクトル群と比較（前回実装のMax-Pooling）
                //contentScore = this.calcContentScore(context.recentVectors, post.embedding);
            }

            // 総合スコアの算出（重み付け）
            const baseScore =
                (interactionScore * this.weights.interaction) +
                (collabScore * this.weights.collaborative) +
                (Math.max(0, contentScore) * this.weights.content) +
                1.0; // 基本スコアを底上げして、減衰で0になりすぎないようにする

            const postDecay = this.calculateTimeDecay(postAgeHours, this.halfLife.postAge);
            const finalScore = baseScore * postDecay;

            rankedPosts.push({ ...post, finalScore });
        }

        // スコア順にソート
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
        const recentVectors = await db.getUserRecentLikeVectors(userId);

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

    /**
     * ユーザープロファイルを多角的に更新する（いいね、自分の投稿、低評価を考慮）
     */
    async updateUserInterestProfile(userId, db) {
        // 1. 各種データを並列で取得
        const [likes, myPosts, dislikes] = await Promise.all([
            db.getUserRecentLikeVectors(userId),  // 自分がいいねした投稿
            db.getUserRecentPostVectors(userId),  // 自分の過去の投稿
            db.getUserRecentDislikeVectors(userId) // 自分が低評価した投稿
        ]);

        let totalWeight = 0;
        let profileVector = new Array(384).fill(0); // モデルに合わせて384次元
        const now = new Date();

        // ヘルパー関数：重み付き加算
        const addVectors = (items, baseWeight) => {
            for (const item of items) {
                if (!item.vector) continue;
                const ageHours = (now - new Date(item.createdAt)) / (1000 * 60 * 60);
                const timeDecay = this.calculateTimeDecay(ageHours, this.halfLife.userInterest);
                const finalWeight = baseWeight * timeDecay;

                for (let i = 0; i < 384; i++) {
                    profileVector[i] += item.vector[i] * finalWeight;
                }
                totalWeight += Math.abs(finalWeight); // 重みの絶対値を加算
            }
        };

        // 2. スコアの加算・減算
        addVectors(likes, 1.0);      // 「いいね」は正の影響（100%）
        addVectors(myPosts, 0.5);    // 「自分の投稿」も好みの指標（50%）
        addVectors(dislikes, -1.2);  // 「低評価」は負の影響（-120%：嫌いなものは強めに避ける）

        if (totalWeight === 0) return null;

        // 3. 正規化（ベクトルの長さを1にする）
        const magnitude = Math.sqrt(profileVector.reduce((sum, val) => sum + val * val, 0));
        const normalizedVector = profileVector.map(val => (magnitude > 0 ? val / magnitude : 0));

        await db.saveUserInterest(userId, normalizedVector);
        //console.log(`profile updated (${normalizedVector.map(n => n.toFixed(6)).join(",")})`);
        return normalizedVector;
    }
}

class FeatureExtractor {
    static instance = null;

    static async getInstance() {
        if (this.instance === null) {
            // require ではなく 動的 import() を使用する
            const { pipeline } = await import('@xenova/transformers');

            // モデルのロード
            this.instance = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');
        }
        return this.instance;
    }
}

// 既存の関数の置き換え（非同期にする必要があります）
async function generateEmbedding(text) {
    const extractor = await FeatureExtractor.getInstance();

    // e5モデルの場合、テキストの先頭に "query: " をつけるのが推奨されています
    const output = await extractor(`query: ${text}`, {
        pooling: 'mean',
        normalize: true,
    });

    // Float32Arrayを普通の配列に変換して返す
    return Array.from(output.data);
}

async function migrateMissingEmbeddings(pool) {
    // 1. embedding が NULL または空の投稿を取得
    const { rows } = await pool.query(
        "SELECT id, content FROM posts WHERE embedding IS NULL"
    );

    if (rows.length === 0) {
        console.log("Migration: No pending posts to embed.");
        return;
    }

    console.log(`Migration: Starting vectorization for ${rows.length} posts...`);

    for (const post of rows) {
        try {
            // 前回の generateRealEmbedding を使用
            const vector = await generateEmbedding(post.content);
            await pool.query(
                "UPDATE posts SET embedding = $1 WHERE id = $2",
                [JSON.stringify(vector), post.id]
            );
        } catch (err) {
            console.error(`Migration error on post ${post.id}:`, err);
        }
    }
    console.log("Migration: Completed successfully.");
}

module.exports = {
    RecommendationEngine,
    generateEmbedding,
    migrateMissingEmbeddings // 追加
};