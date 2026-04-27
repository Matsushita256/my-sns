// 画面を開いた時にタイムラインを読み込む
window.onload = loadTimeline;

// タイムラインを取得して表示する関数
async function loadTimeline() {
    const response = await fetch('/api/posts');
    const posts = await response.json();
    
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = ''; // 一旦空にする

    posts.reverse().forEach(post => { // 新しい順に表示
        const tweetDiv = document.createElement('div');
        tweetDiv.className = 'tweet';
        tweetDiv.innerHTML = `<b>${post.username}</b><p>${post.content}</p>`;
        timeline.appendChild(tweetDiv);
    });
}

// 投稿を送信する関数
async function submitPost() {
    const username = document.getElementById('username').value;
    const content = document.getElementById('content').value;

    if (!username || !content) return alert('入力してください');

    await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, content })
    });

    document.getElementById('content').value = ''; // 入力欄を空にする
    loadTimeline(); // タイムラインを再読み込み
}