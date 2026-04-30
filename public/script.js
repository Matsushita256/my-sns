window.onload = () => {
    const loggedInUser = localStorage.getItem('loggedInUser');
    if (loggedInUser) {
        document.getElementById('display-username').textContent = loggedInUser;
    }
    loadTimeline();
};

// 新規登録機能
async function register() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    if (!username || !password) return alert('名前とパスワードを入力してください');

    const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (response.ok) {
        alert('登録が完了しました！そのままログインボタンを押してください。');
    } else {
        alert('エラー: ' + data.error);
    }
}

// ログイン機能
async function login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    if (!username || !password) return alert('名前とパスワードを入力してください');

    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });

    if (response.ok) {
        localStorage.setItem('loggedInUser', username);
        location.reload();
    } else {
        const data = await response.json();
        alert('エラー: ' + data.error);
    }
}

// タイムライン取得
async function loadTimeline() {
    const response = await fetch('/api/get');
    if (response.status === 401) return;

    const posts = await response.json();
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    await drawTimeline(posts, null);
}

async function performSearch() {
    const query = document.getElementById('search-input').value;
    loadTimeline(query); // 検索ワードを渡して再読み込み
}

async function drawTimeline(posts, searchQuery) {
    posts.forEach(post => {
        const tweetDiv = document.createElement('div');
        tweetDiv.className = 'tweet';
        
        const heartIcon = post.is_liked ? '❤️' : '🤍';
        const activeClass = post.is_liked ? 'liked' : '';
        
        // 時間とハイライトを適用
        const relativeTime = getRelativeTime(post.created_at);
        const displayContent = highlightText(post.content, searchQuery);

        const deleteButton = post.is_mine 
            ? `<button onclick="deletePost(${post.id})" class="delete-btn" title="削除">×</button>` 
            : '';

        tweetDiv.innerHTML = `
            <div class="tweet-header">
                <div>
                    <span class="username">@${post.username}</span>
                    <span class="timestamp">${relativeTime}</span>
                </div>
                ${deleteButton}
            </div>
            <div class="tweet-content">${displayContent}</div>
            <div class="tweet-actions">
                <button onclick="toggleLike(${post.id})" class="like-btn ${activeClass}">
                    ${heartIcon} ${post.like_count}
                </button>
            </div>
        `;
        timeline.appendChild(tweetDiv);
    });
}

async function loadTimeline(searchQuery = '') {
    // クエリパラメータとして検索ワードを付与[cite: 7]
    const response = await fetch(`/api/get?q=${encodeURIComponent(searchQuery)}`);
    if (response.status === 401) return;

    const posts = await response.json();
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    await drawTimeline(posts, searchQuery);
}

// 投稿送信
async function submitPost() {
    const content = document.getElementById('content').value;
    if (!content) return alert('内容を入力してください');

    const response = await fetch('/api/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });

    if (response.ok) {
        document.getElementById('content').value = '';
        loadTimeline();
    } else {
        alert('投稿に失敗しました。ログイン状態を確認してください。');
    }
}

// いいねトグル
async function toggleLike(postId) {
    const response = await fetch('/api/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId })
    });

    if (response.ok) {
        loadTimeline();
    } else if (response.status === 401) {
        alert('ログインしてください');
    }
}

// --- 追加：相対時間を計算する関数 ---
function getRelativeTime(dateString) {
    const now = new Date();
    const postDate = new Date(dateString);
    const diffInSeconds = Math.floor((now - postDate) / 1000);

    if (diffInSeconds < 60) return 'たった今';
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}分前`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}時間前`;
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}日前`;
}

// --- 追加：検索語をハイライトする関数 ---
function highlightText(text, searchQuery) {
    if (!searchQuery) return text;
    
    // スペースで区切って各キーワードを抽出
    const keywords = searchQuery.split(/\s+/).filter(k => k.length > 0);
    let highlightedText = text;

    keywords.forEach(word => {
        // 正規表現を使って一括置換（g: 全て、i: 大文字小文字無視）
        const regex = new RegExp(`(${word})`, 'gi');
        highlightedText = highlightedText.replace(regex, '<span class="highlight">$1</span>');
    });

    return highlightedText;
}

// 削除実行関数
async function deletePost(postId) {
    if (!confirm('本当にこの投稿を削除しますか？')) return;

    const response = await fetch(`/api/post/${postId}`, {
        method: 'DELETE'
    });

    if (response.ok) {
        loadTimeline(); // 再読み込み
    } else {
        const data = await response.json();
        alert('削除できませんでした: ' + data.error);
    }
}