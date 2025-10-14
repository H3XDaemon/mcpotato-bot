# --- Stage 1: Builder ---
# 說明：此階段專門用於安裝依賴套件並編譯 TypeScript。
FROM node:lts-slim AS builder

# 設定工作目錄
WORKDIR /usr/src/app

# 複製定義依賴的檔案
COPY package.json package-lock.json* ./

# 安裝所有依賴 (包括 devDependencies)
RUN npm ci

# 複製所有原始碼
COPY . .

# 編譯 TypeScript
RUN npm run build

# --- Stage 2: Production ---
# 說明：此階段用於建立最終的、乾淨的運行環境。
FROM node:lts-slim

# 設定 NODE_ENV 為 'production'
ENV NODE_ENV=production

# 設定工作目錄
WORKDIR /usr/src/app

# 從 'builder' 階段複製已編譯的程式碼和 node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules ./node_modules

# 建立一個非 root 使用者來運行應用程式，提升安全性。
RUN useradd --system --uid 1001 --gid 0 node_user
USER node_user

# 容器啟動時執行的預設指令。
CMD ["node", "dist/java_bot_stable.js"]
