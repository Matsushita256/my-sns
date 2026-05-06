import { getRelativeTime, highlightText } from './utils.js';

export function createTweetHTML(post, searchQuery = "") {
    const relativeTime = getRelativeTime(post.created_at);
    const displayContent = highlightText(post.content, searchQuery);

    // アイコンの状態判定
    const heartIcon = post.is_liked ? 'liked' : '';
    const dislikeIcon = post.is_disliked ? 'disliked' : '';

    const followText = post.is_following ? 'フォロー中' : 'フォロー';
    const followClass = post.is_following ? 'following' : '';

    return `
        <div class="tweet">
            <div class="avatar"></div>
            <div class="tweet-body">
                <div class="tweet-header">
                    <div>
                        <strong><a href="#" class="user-link" data-username="${post.username}" style="color: inherit; text-decoration: none;">@${post.username}</a></strong>
                        <span class="timestamp">· ${relativeTime}</span>
                    </div>
                    <!-- 投稿削除ボタン -->
                    ${post.is_mine ? `<button post-id=${post.id} class="delete-btn">×</button>` : ''}
                </div>
                <div class="tweet-content">${displayContent}</div>
                <div class="tweet-actions">
                    <!-- いいねボタン -->
                    <button class="like-btn ${heartIcon}" post-id=${post.id}>
                        <svg class="like-icon" viewBox="70 80 160 140" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M150.08,112.44c5.41-17.37,20.84-25.73,35.92-25.73c18.03,0,31.79,15.08,31.79,33.26
                            c0,21.96-11.96,38.18-24.25,53.09c-11.8,14.26-43.46,40.23-43.46,40.23h-0.33c0,0-31.5-25.97-43.29-40.23
                            c-12.29-14.91-24.25-31.13-24.25-53.09c0-18.52,14.26-33.26,31.95-33.26c14.91,0,30.18,8.36,35.59,25.73H150.08z"></path>
                        </svg>
                        <span id="count">${post.like_count || 0}</span>
                    </button>

                    <!-- 低評価ボタン -->
                    <button post-id=${post.id} class="dislike-btn ${dislikeIcon}">
                        <svg class="dislike-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M7 10l5 5 5-5"></path>
                            <path d="M12 15V3"></path>
                        </svg>
                        <span id="count">${post.dislike_count || 0}</span>
                    </button>

                    <!-- 追加: フォローボタン (自分の投稿でなければ表示) -->
                    ${!post.is_mine ? `
                        <button data-username="${post.username}" class="follow-btn btn-outline-sm ${followClass}" style="margin-left: auto; padding: 4px 12px; width: auto; font-size: 12px;">
                            ${followText}
                        </button>
                    ` : ''}
                <div class="tweet-actions">
                </div>
                </div>
            </div>
        </div>
    `;
}