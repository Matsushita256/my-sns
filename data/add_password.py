import pandas as pd

# 1. 既存の users.csv を読み込む
df = pd.read_csv('users.csv')

# 2. デモ用の固定ハッシュ値を定義
# (例として 'password' を bcrypt でハッシュ化したような形式の文字列)
demo_hash = "$2a$10$gEYnI1DoFwMlJhhmOOdkGe/I3nGiDhVGeJJGSNwn7giAMiAoaXg8C"

# 3. password_hash カラムを追加し、固定値を割り当てる
# insertメソッドを使うと、好きな位置（ここでは email の後ろの2番目）に挿入できます
df.insert(2, 'password_hash', demo_hash)

# 4. 更新したデータを新しいCSVとして保存
df.to_csv('users_v2.csv', index=False)

print("password_hash を追加した 'users_v2.csv' を生成しました。")