# --- 單階段建置 ---
# 直接使用 oven/bun:1-slim 作為最終的運行環境。
# 這個映像檔包含了 Bun 的完整工具鏈。
#FROM oven/bun:1-slim
FROM node:lts-slim

# 設定工作目錄
WORKDIR /usr/src/app

# 複製 package.json 和 bun.lockb 檔案
#COPY package.json bun.lockb* ./
COPY package.json package-lock.json* ./

# 只安裝生產環境需要的依賴，並使用 --frozen-lockfile 確保版本一致性
# --production 旗標有助於減少不必要的開發套件
#RUN bun install --production --frozen-lockfile
RUN npm ci --omit=dev

# 複製應用程式的原始碼
COPY . .

# 容器啟動時執行的指令
#CMD ["bun", "main.js"]
CMD ["node", "main.js"]

