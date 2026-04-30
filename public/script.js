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

    posts.forEach(post => {
        const tweetDiv = document.createElement('div');
        tweetDiv.className = 'tweet';
        
        const heartIcon = post.is_liked ? '❤️' : '🤍';
        const activeClass = post.is_liked ? 'liked' : '';

        tweetDiv.innerHTML = `
            <div class="tweet-header">
                <span class="username">@${post.username}</span>
            </div>
            <div class="tweet-content">${post.content}</div>
            <div class="tweet-actions">
                <button onclick="toggleLike(${post.id})" class="like-btn ${activeClass}">
                    ${heartIcon} ${post.like_count}
                </button>
            </div>
        `;
        timeline.appendChild(tweetDiv);
    });
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