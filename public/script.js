window.onload = () => {
    const loggedInUser = localStorage.getItem('loggedInUser');
    if (loggedInUser) {
        document.getElementById('display-username').textContent = loggedInUser;
    }
    loadTimeline();
};

// 新規登録機能
async function register() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (username.length < 3) {
        alert('ユーザー名は3文字以上で入力してください');
        return;
    }
    if (password.length < 8) {
        alert('パスワードは8文字以上にしてください');
        return;
    }

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

async function performSearch() {
    const query = document.getElementById('search-input').value;
    loadTimeline(query); // 検索ワードを渡して再読み込み
}

// 投稿送信
async function submitPost() {
    const content = document.getElementById('content').value;
    const postBtn = document.getElementById('post-button');

    // 送信中はボタンを無効化して多重送信を防ぐ
    postBtn.disabled = true;

    try {
        const response = await fetch("/api/post", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('content').value = '';
            document.getElementById('content').style.height = 'auto'; // 高さをリセット
            document.getElementById('char-count').textContent = '0 / 600';
            loadTimeline();
        } else {
            // 連投制限やバリデーションエラーの表示
            alert(data.error);
        }
    } catch (err) {
        alert("通信エラーが発生しました");
    } finally {
        postBtn.disabled = false;
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

// テキストエリアの自動リサイズ設定
const textarea = document.getElementById('content');
const charCount = document.getElementById('char-count');
const postBtn = document.getElementById('post-button');

textarea.addEventListener('input', () => {
    // 高さを一度リセットして内容に合わせる
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';

    // 文字があればボタンを有効化
    postBtn.disabled = textarea.value.trim().length === 0;
});

// renderTweet関数内、tweet-actionsの部分を修正[cite: 2]
function renderTweet(post, searchQuery) {
    const relativeTime = getRelativeTime(post.created_at);
    const displayContent = highlightText(post.content, searchQuery);
    
    // アイコンの状態判定
    const heartIcon = post.is_liked ? 'liked' : '';
    const dislikeIcon = post.is_disliked ? 'disliked' : '';

    return `
        <div class="tweet">
            <div class="avatar"></div>
            <div class="tweet-body">
                <div class="tweet-header">
                    <div>
                        <span class="username">${post.username}</span>
                        <span class="timestamp">· ${relativeTime}</span>
                    </div>
                    ${post.is_mine ? `<button onclick="deletePost(${post.id})" class="delete-btn">×</button>` : ''}
                </div>
                <div class="tweet-content">${displayContent}</div>
                <div class="tweet-actions">
                    <!-- いいねボタン -->
                    <button onclick="toggleLike(${post.id})" class="like-btn ${heartIcon}">
                        <svg class="heart-icon" viewBox="70 80 160 140" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M150.08,112.44c5.41-17.37,20.84-25.73,35.92-25.73c18.03,0,31.79,15.08,31.79,33.26
                            c0,21.96-11.96,38.18-24.25,53.09c-11.8,14.26-43.46,40.23-43.46,40.23h-0.33c0,0-31.5-25.97-43.29-40.23
                            c-12.29-14.91-24.25-31.13-24.25-53.09c0-18.52,14.26-33.26,31.95-33.26c14.91,0,30.18,8.36,35.59,25.73H150.08z"></path>
                        </svg>
                        <span>${post.like_count || 0}</span>
                    </button>

                    <!-- 低評価ボタン（追加） -->
                    <button onclick="toggleDislike(${post.id})" class="dislike-btn ${dislikeIcon}">
                        <svg class="dislike-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M7 10l5 5 5-5"></path>
                            <path d="M12 15V3"></path>
                        </svg>
                        <span>${post.dislike_count || 0}</span>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// 低評価トグル関数を追加[cite: 2]
async function toggleDislike(postId) {
    const response = await fetch('/api/dislike', {
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

async function loadTimeline(searchQuery = '') {
    const response = await fetch(`/api/get?q=${encodeURIComponent(searchQuery)}`);
    if (response.status === 401) return;

    const posts = await response.json();
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = posts.map(post => renderTweet(post, searchQuery)).join('');
}

textarea.addEventListener('input', inputChanged);

function inputChanged() {
    const length = textarea.value.length;
    const maxLength = 600;

    // 表示を「現在文字数 / 最大文字数」に更新
    charCount.textContent = `${length} / ${maxLength}`;

    // 最大文字数を超えた時の警告表示

    charCount.classList.remove('warning');
    charCount.classList.remove('danger');
    if (length > maxLength) {
        charCount.classList.add('danger');
    } else if (length >= maxLength * 0.9) {
        charCount.classList.add('warning');
    }
    // ボタンの有効・無効切り替え（空または600文字超えで無効化）
    postBtn.disabled = length === 0 || length > maxLength;

    // 自動リサイズ
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}