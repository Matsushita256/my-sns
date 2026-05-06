import * as api from './api.js';
import * as ui from './ui.js';

console.log("app.js loaded");
let lastLoadTime = Date.now();
let hasUnappliedActivity = false;
const UPDATE_COOLDOWN = 10000; // 10秒間はバナーを出さない（頻繁な表示を防止）

// ページ読み込み時のイベント
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/api/status');
        const user = await response.json();

        if (user.isLoggedIn) {
            // 2. ログイン済みならUIを更新
            updateUIForLoggedInUser(user.username);
        } else {
            // 未ログインならログインボタンを表示
            document.getElementById("auth-buttons").style.display = "block";
        }

        // 3. タイムラインの読み込み
        await loadTimeline();
    } catch (err) {
        console.error("初期化エラー:", err);
    }
});

// タイムラインを更新する
async function loadTimeline(query = "") {
    try {
        const posts = await api.fetchPosts(query);
        lastLoadTime = Date.now(); // 読み込み時刻を更新
        const container = document.getElementById('timeline');
        container.innerHTML = posts.map(p => ui.createTweetHTML(p, query)).join('');
        // 描画した後にボタンを探してイベントを登録する
        bindPostEvents(container);

    } catch (error) {
        alert(error.message);
    }
}

// 動的に生成された投稿のボタン群にイベントを割り当てる関数
// （既存の loadTimeline 内のイベント登録処理を関数として切り出したもの）
function bindPostEvents(container) {
    container.querySelectorAll('.like-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const postId = button.getAttribute('post-id');
            try {
                await api.toggleReaction("like", postId);
                button.classList.toggle("liked");
                button.querySelector("#count").innerHTML = parseInt(button.querySelector("#count").innerHTML) + (button.classList.contains("liked") ? 1 : -1);

                // TLを即時更新せず、「変更があった」フラグを立てる
                hasUnappliedActivity = true;
                checkUpdateRequirement();
            } catch (error) {
                alert(error.message);
            }
        });
    });
    container.querySelectorAll('.dislike-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const postId = button.getAttribute('post-id');
            try {
                await api.toggleReaction("dislike", postId);
                button.classList.toggle("disliked");
                button.querySelector("#count").innerHTML = parseInt(button.querySelector("#count").innerHTML) + (button.classList.contains("disliked") ? 1 : -1);
                // TLを即時更新せず、「変更があった」フラグを立てる
                hasUnappliedActivity = true;
                checkUpdateRequirement();
            } catch (error) {
                alert(error.message);
            }
        });
    });
    // ① loadTimeline 関数の中、低評価ボタンのイベント登録のすぐ下あたりに追加
    container.querySelectorAll('.follow-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const targetUsername = button.getAttribute('data-username');
            try {
                const result = await api.toggleFollow(targetUsername);

                // UIの即時反映 (APIが { following: true/false } を返すと仮定)
                if (result.following) {
                    button.classList.add('following');
                    button.textContent = 'フォロー中';
                } else {
                    button.classList.remove('following');
                    button.textContent = 'フォロー';
                }

                // TLの再取得を促す
                hasUnappliedActivity = true;
                checkUpdateRequirement();
            } catch (error) {
                alert(error.message);
            }
        });
    });
    container.querySelectorAll('.delete-btn').forEach(button => {
        button.addEventListener('click', async () => {
            if (!confirm('本当にこの投稿を削除しますか？')) return;

            const postId = button.getAttribute('post-id');
            try {
                await api.deletePost(postId);
                loadTimeline();
            } catch (error) {
                alert(error.message);
            }
        });
    });
}

document.getElementById('content').addEventListener('input', updateCharCountDisplay);

// 文字数カウントの更新処理
function updateCharCountDisplay() {
    const textarea = document.getElementById('content');
    const charCount = document.getElementById('char-count');
    const postButton = document.getElementById('post-button');

    const length = textarea.value.length;
    const maxLength = 600;

    // 表示を「現在文字数 / 最大文字数」に更新
    charCount.textContent = `${length} / ${maxLength}`;

    // 最大文字数を超えた時の警告表示
    charCount.classList.remove("warning");
    charCount.classList.remove("danger");
    if (length > maxLength) {
        charCount.classList.add('danger');
    } else if (length >= maxLength * 0.9) {
        charCount.classList.add('warning');
    }
    // ボタンの有効・無効切り替え（空または600文字超えで無効化）
    postButton.disabled = length === 0 || length > maxLength;

    // 自動リサイズ
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
}

// ポスト処理
document.getElementById("post-button").addEventListener("click", async () => {
    const contentElement = document.getElementById("content");
    const charCountText = document.getElementById("char-count");
    const content = contentElement.value;
    const postBtn = document.getElementById('post-button');

    try {
        // 送信中はボタンを無効化して多重送信を防ぐ
        postBtn.disabled = true;

        await api.post(content);

        contentElement.value = "";
        contentElement.style.height = 'auto'; // 高さをリセット
        charCountText.textContent = '0 / 600';
        updateCharCountDisplay();
        loadTimeline();
    } catch (error) {
        alert(error.message);
    } finally {
        postBtn.disabled = false;
    }
});

// 検索処理
document.getElementById("search-button").addEventListener("click", async () => {
    try {
        const searchInput = document.getElementById("search-input");
        const query = searchInput.value;
        loadTimeline(query);
    } catch (error) {
        alert(error.message);
    }
});

// アカウント削除処理
document.getElementById("delete-account-btn").addEventListener("click", async () => {
    const password = document.getElementById("delete-confirm-password").value;

    if (!password) {
        alert("確認のためパスワードを入力してください");
        return;
    }

    if (!confirm('本当にアカウントを削除しますか？この操作は取り消せません。')) {
        return;
    }

    try {
        await api.deleteAccount(password);
        alert('アカウントを削除しました。');
        location.reload(); // ページをリロードして初期状態に戻す
    } catch (error) {
        alert(error.message);
    }
});

// --- パスワード変更の実行 ---
document.getElementById("update-password-btn").addEventListener("click", async () => {
    const currentPassword = document.getElementById("change-current-password").value;
    const newPassword = document.getElementById("change-new-password").value;
    const confirmPassword = document.getElementById("change-confirm-password").value;

    if (newPassword !== confirmPassword) {
        alert("新しいパスワードが一致しません");
        return;
    }

    try {
        await api.changePassword(currentPassword, newPassword);
        alert("パスワードを変更しました。");
        // 入力欄をクリア
        document.querySelectorAll(".settings-input").forEach(el => el.value = "");
        document.getElementById("settings-modal").close();
    } catch (error) {
        alert(error.message);
    }
});

// ユーザー名重複のリアルタイムチェック (入力が止まって300ms後に実行)
let checkTimeout;
document.getElementById("register-username").addEventListener("input", (e) => {
    const username = e.target.value;
    const statusEl = document.getElementById("username-status");

    clearTimeout(checkTimeout);
    if (!username) {
        statusEl.textContent = "";
        return;
    }

    checkTimeout = setTimeout(async () => {
        const { exists } = await api.checkUsername(username);
        if (exists) {
            statusEl.textContent = "× 使用済み";
            statusEl.className = "status-badge is-taken";
        } else {
            statusEl.textContent = "✓ 使用可能";
            statusEl.className = "status-badge is-available";
        }
    }, 300);
});

// 新規登録の実行
document.getElementById("register-submit").addEventListener("click", async () => {
    const username = document.getElementById("register-username").value;
    const password = document.getElementById("register-password").value;
    const confirm = document.getElementById("register-confirm").value;

    if (password !== confirm) {
        alert("パスワードが一致しません");
        return;
    }

    try {
        await api.register(username, password);
        alert("登録が完了しました！ログインしてください。");
    } catch (err) {
        alert(err.message);
    }
});

// ログインの実行
document.getElementById("login-submit").addEventListener("click", async () => {
    const username = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;

    try {
        await api.login(username, password);
        localStorage.setItem("loggedInUser", username);

        location.reload(); // ログイン成功で画面更新
    } catch (err) {
        alert(err.message);
    }
});

// ログアウト処理の実行
document.getElementById("logout-button").addEventListener("click", async () => {
    if (!confirm("ログアウトしますか？")) return;

    try {
        await api.logout();
        // ページをリロードして初期状態（未ログイン状態）に戻す
        // これにより自動ログインのチェックも再度走り、未ログインUIが適用されます
        location.reload();
    } catch (err) {
        alert("ログアウトに失敗しました");
    }
});

// UIをログイン状態に切り替える関数をアップデート
function updateUIForLoggedInUser(username) {
    document.getElementById("display-username").textContent = username;
    document.getElementById("settings-button").style.display = "block";
    document.getElementById("logout-button").style.display = "block"; // ログアウトボタンを表示
    document.getElementById("status-area").style.display = "flex";
    document.getElementById("auth-buttons").style.display = "none";
    document.getElementById("profile-settings-btn").style.display = "block"; // 追加
}

// モーダル開閉の制御をシンプル化
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.showModal(); // showModal()を使うと、背景クリック不可の最前面表示になる
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.close();
}

// ボタンへのイベント登録例
document.getElementById("open-login-btn").addEventListener("click", () => openModal("login-modal"));
document.getElementById("open-register-btn").addEventListener("click", () => openModal("register-modal"));
document.getElementById("settings-button").addEventListener("click", () => openModal("settings-modal"));
document.getElementById("update-btn").addEventListener("click", applyNewTimeline);

// すべての閉じるボタンに対応
document.querySelectorAll(".close-modal").forEach(btn => {
    btn.addEventListener("click", (e) => {
        e.target.closest("dialog").close();
    });
});

// 背景クリックで閉じるようにしたい場合の処理（オプション）
document.querySelectorAll("dialog").forEach(dialog => {
    dialog.addEventListener("click", (e) => {
        if (e.target === dialog) dialog.close();
    });
});

// バナーを表示するか判定する関数
function checkUpdateRequirement() {
    const now = Date.now();
    const timeSinceLastLoad = now - lastLoadTime;

    // 活動があり、かつ一定時間が経過していればバナー表示
    if (hasUnappliedActivity && timeSinceLastLoad > UPDATE_COOLDOWN) {
        document.getElementById("update-banner").style.display = "block";
    } else if (hasUnappliedActivity) {
        // 時間が経っていない場合は、数秒後に再チェック
        setTimeout(checkUpdateRequirement, UPDATE_COOLDOWN - timeSinceLastLoad + 100);
    }
}

// ボタンを押した時の処理
async function applyNewTimeline() {
    // 1. バナーを隠す
    document.getElementById("update-banner").style.display = "none";
    // 2. フラグをリセット
    hasUnappliedActivity = false;
    lastLoadTime = Date.now();

    // 3. タイムラインを再読み込み
    await loadTimeline();

    // 4. 一番上にスクロール
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ③ ファイルの末尾あたりにプロフィール関連のイベントを追加
document.getElementById("profile-settings-btn").addEventListener("click", async () => {
    const username = localStorage.getItem("loggedInUser");
    if (!username) return;

    try {
        // 現在のプロフィールを取得してテキストエリアにセット
        const profile = await api.getProfile(username);
        document.getElementById("profile-bio-input").value = profile.bio || "";
        openModal("profile-modal");
    } catch (error) {
        alert(error.message);
    }
});

document.getElementById("save-profile-btn").addEventListener("click", async () => {
    const bio = document.getElementById("profile-bio-input").value;
    const btn = document.getElementById("save-profile-btn");

    try {
        btn.disabled = true;
        await api.updateProfile(bio);
        alert("プロフィールを更新しました");
        closeModal("profile-modal");
    } catch (error) {
        alert(error.message);
    } finally {
        btn.disabled = false;
    }
});

// ホームに戻るボタンのイベント
document.getElementById("back-to-home-btn").addEventListener("click", () => {
    document.getElementById("profile-view").style.display = "none";
    document.getElementById("home-view").style.display = "block";

    // ホームに戻った際に最新のTLを取得し直す
    loadTimeline();
});

// ユーザー名がクリックされた時の処理（イベントデリゲーションを使用）
// timeline と user-timeline の両方でクリックを検知するために document 全体に張るか、
// コンテナに張ります。ここでは全体に張ります。
document.addEventListener("click", async (e) => {
    // ユーザー名リンクがクリックされた場合
    if (e.target.closest('.user-link')) {
        e.preventDefault(); // 画面上部へのスクロール(href="#")を防ぐ
        const username = e.target.closest('.user-link').getAttribute('data-username');
        await openUserProfile(username);
    }
});

// プロフィール画面を開いてデータを読み込む関数
async function openUserProfile(username) {
    const loggedInUser = localStorage.getItem("loggedInUser");

    // 画面の切り替え
    document.getElementById("home-view").style.display = "none";
    document.getElementById("profile-view").style.display = "block";

    const userTimelineContainer = document.getElementById("user-timeline");
    userTimelineContainer.innerHTML = "<p>読み込み中...</p>";

    try {
        // 1. プロフィール情報の取得と描画
        const profile = await api.getProfile(username);
        document.getElementById("view-profile-username").textContent = `@${profile.username}`;
        document.getElementById("view-profile-bio").textContent = profile.bio || "自己紹介はありません";
        document.getElementById("view-profile-stats").textContent = `フォロワー: ${profile.follower_count} | フォロー中: ${profile.following_count}`;

        // フォローボタンの制御
        const followBtn = document.getElementById("view-profile-follow-btn");
        if (loggedInUser && loggedInUser !== profile.username) {
            followBtn.style.display = "block";
            followBtn.setAttribute("data-username", profile.username);
            if (profile.is_following) {
                followBtn.classList.add("following");
                followBtn.textContent = "フォロー中";
            } else {
                followBtn.classList.remove("following");
                followBtn.textContent = "フォロー";
            }
        } else {
            // 未ログイン、または自分自身の画面の場合はボタンを隠す
            followBtn.style.display = "none";
        }

        // 2. ユーザーの投稿一覧の取得と描画
        const posts = await api.getUserPosts(username);
        userTimelineContainer.innerHTML = ""; // 読み込み中表示をクリア

        if (posts.length === 0) {
            userTimelineContainer.innerHTML = "<p>まだ投稿がありません。</p>";
        } else {
            posts.forEach(post => {
                const tweetHTML = ui.createTweetHTML(post);
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = tweetHTML;
                userTimelineContainer.appendChild(tempDiv.firstElementChild);
            });
            // 動的に生成したボタン（いいね等）にイベントを再バインドする
            bindPostEvents(userTimelineContainer);
        }

    } catch (error) {
        userTimelineContainer.innerHTML = `<p style="color: red;">${error.message}</p>`;
    }
}

// プロフィール画面のフォローボタンのクリックイベント
document.getElementById("view-profile-follow-btn").addEventListener("click", async (e) => {
    const btn = e.target;
    const targetUsername = btn.getAttribute("data-username");
    
    // ボタンを一時的に無効化（連打防止）
    btn.disabled = true;

    try {
        // api.js に追加した toggleFollow を呼び出す
        const result = await api.toggleFollow(targetUsername);
        
        // ボタンの見た目を切り替え
        if (result.following) {
            btn.classList.add("following");
            btn.textContent = "フォロー中";
        } else {
            btn.classList.remove("following");
            btn.textContent = "フォロー";
        }

        // フォロワー数の表示を即座に更新（UX向上）
        const statsEl = document.getElementById("view-profile-stats");
        const currentText = statsEl.textContent;
        // 「フォロワー: X | フォロー中: Y」の数字を強引に書き換える簡易ロジック
        const match = currentText.match(/フォロワー: (\d+)/);
        if (match) {
            let count = parseInt(match[1]);
            count = result.following ? count + 1 : count - 1;
            statsEl.textContent = currentText.replace(/フォロワー: \d+/, `フォロワー: ${count}`);
        }

    } catch (error) {
        alert(error.message);
    } finally {
        btn.disabled = false;
    }
});