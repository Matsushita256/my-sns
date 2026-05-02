// タイムライン取得
export async function fetchPosts(query = "") {
    const response = await fetch(`/api/get?q=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (!response.ok)
        throw new Error(data.error || 'データの取得に失敗しました');

    return data;
}

// いいね・低評価のトグル
// typeには"like"か"dislike"を入れる
// 戻り値は変更後に自分がlike, dislikeをしているか
export async function toggleReaction(type, postId) {
    const response = await fetch(`/api/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId })
    });
    const data = await response.json();

    if (!response.ok)
        throw new Error(data.error || "いいね・低評価のトグルに失敗しました");
    
    const isLike = type === "like";
    return data.success ^ isLike;
}

// 新規登録機能
export async function register(username, password) {
    console.log("register called");

    // if (username.length < 3) {
    //     alert('ユーザー名は3文字以上で入力してください');
    //     return;
    // }
    // if (password.length < 8) {
    //     alert('パスワードは8文字以上にしてください');
    //     return;
    // }

    // if (!username || !password) return alert('名前とパスワードを入力してください');

    const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await response.json();

    if (!response.ok)
        throw new Error(data.error || "新規登録に失敗しました");

    return data;
}

// ログイン機能
export async function login(username, password) {
    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await response.json();

    if (!response.ok)
        throw new Error(data.error || "ログインに失敗しました");

    localStorage.setItem('loggedInUser', username);
    return data;
}

// 投稿送信
export async function post(content) {
    const response = await fetch("/api/post", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
    });
    const data = await response.json();
    
    if (!response.ok)
        throw new Error(data.error || "投稿の送信に失敗しました");

    return data;
}

// 削除実行関数
export async function deletePost(postId) {
    const response = await fetch(`/api/deletePost`, {
        method: 'DELETE',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id: postId }),
    });
    const data = await response.json();

    if (!response.ok)
        throw new Error(data.error || "投稿の削除に失敗しました");
}

// アカウント削除機能
export async function deleteAccount(password) {
    const response = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }) // bodyにパスワードを含める
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "削除に失敗しました");
    return data;
}

// パスワード変更
export async function changePassword(currentPassword, newPassword) {
    const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "変更に失敗しました");
    return data;
}

export async function checkUsername(username) {
    const response = await fetch(`/api/check-username?username=${encodeURIComponent(username)}`);
    return await response.json();
}

export async function logout() {
    const response = await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    return await response.json();
}