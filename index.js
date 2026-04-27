// 1. 外部ライブラリ（Express）を読み込む
const express = require('express');

// 2. Expressアプリのインスタンス（本体）を作成
const app = express();

// 3. サーバーが待ち受ける「ポート番号」を3000に設定
const port = 3000;

// 4. JSON形式のデータを受け取れるようにする設定（ミドルウェア）
app.use(express.json());

// index.js の上の方に追加
app.use(express.static('public'));

// 5. 投稿データを一時的に保存するための変数（配列）
let posts = [
  { id: 1, username: 'tester', content: 'LAN内SNSへようこそ！' }
];

// --- ここから「ルーティング（窓口設定）」 ---

// 6. 【取得】タイムラインを返す窓口（GETメソッド）
app.get('/api/posts', (req, res) => {
  res.json(posts); // 保存されている投稿をすべて送り返す
});

// 7. 【投稿】新しいツイートを受け取る窓口（POSTメソッド）
app.post('/api/posts', (req, res) => {
  const newPost = {
    id: posts.length + 1,        // IDを自動採番
    username: req.body.username, // 送られてきた名前
    content: req.body.content,   // 送られてきた本文
    createdAt: new Date()        // 現在時刻
  };
  posts.push(newPost);           // 配列（メモリ）に追加
  res.status(201).json(newPost); // 「保存完了」の合図と一緒にデータを返す
});

// --- ここまで ---

// 8. サーバーを起動して、リクエストを待ち始める
app.listen(port, () => {
  console.log(`SNSサーバーが http://localhost:${port} で起動しました`);
});




const { Pool } = require('pg');

// データベースへの接続情報
const pool = new Pool({
  user: 'myuser',
  host: 'localhost',
  database: 'mysns',
  password: 'mypassword',
  port: 5432,
});

// 投稿を保存する処理（POSTの中身を書き換えるイメージ）
app.post('/api/posts', async (req, res) => {
  const { username, content } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO posts (username, content) VALUES ($1, $2) RETURNING *',
      [username, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'DB保存に失敗しました' });
  }
});

let a = 0;