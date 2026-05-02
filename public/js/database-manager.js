/**
 * リコメンドエンジンに必要なデータを供給するクラス
 */
class DatabaseManager {
    constructor() {
        // 本来はサーバーサイドのAPIを叩くが、ここでは簡易的なデータストアとして定義
    }

    /**
     * ユーザーの過去の行動（いいね/低評価）を取得
     */
    async getUserInteractions(userId) {
        // localStorage や API から取得
        const data = localStorage.getItem(`interactions_${userId}`);
        return data ? JSON.parse(data) : [];
    }

    /**
     * ユーザーが過去に「いいね」した投稿IDのリストのみを高速取得
     */
    async getUserLikedPostIds(userId) {
        const interactions = await this.getUserInteractions(userId);
        return interactions
            .filter(i => i.type === 'like')
            .map(i => i.postId);
    }

    /**
     * ユーザーの興味関心を反映する直近のベクトル集合を取得
     */
    async getUserRecentVectors(userId) {
        // 過去の自分の投稿や「いいね」した投稿のベクトルを取得
        const data = localStorage.getItem(`user_vectors_${userId}`);
        return data ? JSON.parse(data) : [];
    }

    /**
     * リコメンド対象となる投稿の候補群を取得
     */
    async getCandidatePosts(limit = 100) {
        // 最近の全投稿から上位N件を候補として抽出
        // (API経由で最近の投稿リストを取得する想定)
        const allPosts = await fetch('/api/posts/recent').then(res => res.json());
        return allPosts;
    }
}