# Node.jsの公式イメージ（軽量版のalpine）を使用
FROM node:18-alpine

# コンテナ内の作業ディレクトリを /app に設定
WORKDIR /app

# 先にパッケージ情報だけコピー（キャッシュを効かせてビルドを速くするため）
COPY package*.json ./

# ライブラリをインストール
RUN npm install

# アプリの全ファイルをコピー
COPY . .

# 3000番ポートを公開
EXPOSE 3000

# アプリを起動するコマンド
CMD ["node", "--inspect=0.0.0.0:9229", "index.js"]