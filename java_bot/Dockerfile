# --- Stage 1: Builder ---
# 說明：此階段專門用於安裝依賴套件。
# 使用官方的 Node.js LTS slim 映像檔。
FROM node:lts-slim AS builder

# 設定工作目錄
WORKDIR /usr/src/app

# 僅複製定義依賴的檔案，以充分利用 Docker 的快取機制。
COPY package.json package-lock.json* ./

# 安裝依賴。npm ci 會依照 lockfile 精準安裝。
# --omit=dev 可省略 devDependencies，只裝生產用套件。
RUN npm ci --omit=dev

# --- Stage 2: Production ---
# 說明：此階段用於建立最終的、乾淨的運行環境。
FROM node:lts-slim

# 設定 NODE_ENV 為 'production'，許多函式庫會依此進行優化。
ENV NODE_ENV=production

# 設定工作目錄
WORKDIR /usr/src/app

# 從 'builder' 階段複製已安裝的依賴套件。
COPY --from=builder /usr/src/app/node_modules ./node_modules

# 複製應用程式的所有原始碼。
# 【重要】請確保有 .dockerignore 檔案，排除 node_modules 和 .git
COPY . .

# 建立一個非 root 使用者來運行應用程式，提升安全性。
RUN useradd --system --uid 1001 --gid 0 node_user
USER node_user

# 容器啟動時執行的預設指令。
# 使用 exec 格式的 CMD，這是最佳實踐。
CMD ["node", "java_bot_stable.js"]
