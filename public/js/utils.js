// 時間を「〜分前」のような形式に変換
export function getRelativeTime(dateString) {
    const now = new Date();
    const postDate = new Date(dateString);
    const diff = Math.floor((now - postDate) / 1000);

    if (diff < 60) return 'たった今';
    if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
    
    // 30日未満なら「～日前」
    if (diff < 2592000) return `${Math.floor(diff / 86400)}日前`;
    
    // 365日未満なら「～か月前」
    if (diff < 31536000) return `${Math.floor(diff / 2592000)}か月前`;
    
    // それ以上は「～年前」
    return `${Math.floor(diff / 31536000)}年前`;
}

// 検索ワードをハイライトする
export function highlightText(text, searchQuery) {
    if (!searchQuery) return text;
    const keywords = searchQuery.split(/\s+/).filter(k => k.length > 0);
    let html = text;
    keywords.forEach(word => {
        const regex = new RegExp(`(${word})`, 'gi');
        html = html.replace(regex, '<span class="highlight">$1</span>');
    });
    return html;
}