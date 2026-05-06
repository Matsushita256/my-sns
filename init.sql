-- -- ユーザーテーブル
-- CREATE TABLE IF NOT EXISTS users (
--     id SERIAL PRIMARY KEY,
--     username VARCHAR(50) UNIQUE NOT NULL,
--     email VARCHAR(100) UNIQUE NOT NULL,
--     password_hash TEXT NOT NULL,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- -- 投稿テーブル
-- CREATE TABLE IF NOT EXISTS posts (
--     id SERIAL PRIMARY KEY,
--     user_id INTEGER NOT NULL,
--     content TEXT NOT NULL,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
--     CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
-- );

-- -- いいねテーブル
-- CREATE TABLE IF NOT EXISTS likes (
--     id SERIAL PRIMARY KEY,
--     post_id INTEGER NOT NULL,
--     user_id INTEGER NOT NULL,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
--     UNIQUE(post_id, user_id),
--     CONSTRAINT fk_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
--     CONSTRAINT fk_user_like FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
-- );

-- -- 低評価テーブル
-- CREATE TABLE dislikes (
--     id SERIAL PRIMARY KEY,
--     user_id INTEGER NOT NULL,
--     post_id INTEGER NOT NULL,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
--     UNIQUE(user_id, post_id),
--     CONSTRAINT fk_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
--     CONSTRAINT fk_user_dislike FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
-- );

-- CREATE TABLE "session" (
--   "sid" varchar NOT NULL COLLATE "default",
--   "sess" json NOT NULL,
--   "expire" timestamp(6) NOT NULL
-- )
-- WITH (OIDS=FALSE);

-- ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
-- CREATE INDEX "IDX_session_expire" ON "session" ("expire");

-- -- postsテーブルにベクトル情報を保存するカラムを追加
-- ALTER TABLE posts ADD COLUMN IF NOT EXISTS embedding JSONB;

-- -- ユーザーの「関心ベクトル」を保存するテーブルを新設
-- CREATE TABLE IF NOT EXISTS user_interests (
--     user_id INTEGER PRIMARY KEY,
--     interest_vector JSONB NOT NULL,
--     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
--     CONSTRAINT fk_user_interest FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
-- );

-- -- 拡張機能の有効化
-- CREATE EXTENSION IF NOT EXISTS vector;

-- -- カラムの型を JSONB から vector(384) に変換
-- -- ※既存のデータがある場合は一旦 NULL にするか、変換処理が必要です
-- ALTER TABLE posts 
-- ALTER COLUMN embedding TYPE vector(384) 
-- USING embedding::text::vector(384);

-- ALTER TABLE user_interests 
-- ALTER COLUMN interest_vector TYPE vector(384) 
-- USING interest_vector::text::vector(384);

-- 1. 拡張機能の有効化
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. ユーザーテーブル (プロフィール機能追加)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    bio TEXT DEFAULT '', -- プロフィール(自己紹介)
    bio_embedding vector(384),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. フォロー機能テーブル
CREATE TABLE follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, following_id),
    CONSTRAINT cannot_follow_self CHECK (follower_id <> following_id)
);

-- 4. 投稿テーブル (ベクトルカラムを初期定義)
CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding vector(384), -- pgvector型
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. インタラクションテーブル (いいね・低評価)
CREATE TABLE likes (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_id)
);

CREATE TABLE dislikes (
    id SERIAL PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(post_id, user_id)
);

-- 6. ユーザー関心プロファイル
CREATE TABLE user_interests (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    interest_vector vector(384) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. セッションテーブル (connect-pg-simple互換)
CREATE TABLE "session" (
    "sid" varchar NOT NULL PRIMARY KEY,
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");

-- 8. 検索高速化のためのインデックス
-- コサイン類似度検索を高速化
CREATE INDEX ON posts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON user_interests USING ivfflat (interest_vector vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON users USING ivfflat (bio_embedding vector_cosine_ops) WITH (lists = 100);