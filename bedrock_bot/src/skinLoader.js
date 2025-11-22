const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

class SkinLoader {
    static async loadSkin(skinPath) {
        return new Promise((resolve, reject) => {
            const fullPath = path.resolve(skinPath);

            if (!fs.existsSync(fullPath)) {
                reject(new Error(`皮膚檔案不存在: ${fullPath}`));
                return;
            }

            const stats = fs.statSync(fullPath);
            const maxSize = 5 * 1024 * 1024;
            if (stats.size > maxSize) {
                reject(new Error(`皮膚檔案過大: ${(stats.size / 1024 / 1024).toFixed(2)}MB`));
                return;
            }

            fs.createReadStream(fullPath)
                .pipe(new PNG())
                .on('parsed', function () {
                    const validSizes = [[64, 32], [64, 64], [128, 128], [128, 64]];
                    const isValid = validSizes.some(([w, h]) => w === this.width && h === this.height);

                    if (!isValid) {
                        const validSizesStr = validSizes.map(([w, h]) => `${w}x${h}`).join(', ');
                        reject(new Error(`無效的皮膚尺寸: ${this.width}x${this.height}。支援的尺寸: ${validSizesStr}`));
                        return;
                    }

                    const expectedLength = this.width * this.height * 4;
                    if (this.data.length !== expectedLength) {
                        reject(new Error(`皮膚資料長度不符: 預期 ${expectedLength} bytes, 實際 ${this.data.length} bytes`));
                        return;
                    }

                    console.log(`✓ 成功載入皮膚: ${this.width}x${this.height}`);
                    resolve({ buffer: this.data, width: this.width, height: this.height });
                })
                .on('error', (error) => reject(new Error(`解析 PNG 失敗: ${error.message}`)));
        });
    }

    static async loadAndCreateSkinData(skinPath, options = {}) {
        try {
            const { buffer, width, height } = await this.loadSkin(skinPath);
            const skinDataBase64 = buffer.toString('base64');
            const armSize = options.armSize === 'slim' ? 'slim' : 'wide';
            const skinId = options.skinId || `custom_skin_${Date.now()}`;

            // 極簡方案：只提供核心數據
            // bedrock-protocol 會與默認數據合併
            const skinData = {
                SkinId: skinId,
                SkinData: skinDataBase64,
                SkinImageHeight: height,
                SkinImageWidth: width,
                ArmSize: armSize
            };

            console.log(`✓ 皮膚資料物件建立完成:`);
            console.log(`  - SkinId: ${skinId}`);
            console.log(`  - 尺寸: ${width}x${height}`);
            console.log(`  - 手臂類型: ${armSize}`);
            console.log(`  - 策略: 使用協議默認處理`);

            return skinData;
        } catch (error) {
            throw new Error(`建立皮膚資料失敗: ${error.message}`);
        }
    }

    static async saveSkinImage(skinBase64, width, height, outputPath) {
        return new Promise((resolve, reject) => {
            try {
                const buffer = Buffer.from(skinBase64, 'base64');
                const expectedLength = width * height * 4;
                if (buffer.length !== expectedLength) {
                    reject(new Error(`資料長度不符: 預期 ${expectedLength} bytes, 實際 ${buffer.length} bytes`));
                    return;
                }

                const png = new PNG({ width, height, inputHasAlpha: true });
                png.data = buffer;

                const outputDir = path.dirname(outputPath);
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                png.pack()
                    .pipe(fs.createWriteStream(outputPath))
                    .on('finish', () => { console.log(`✓ 成功儲存: ${outputPath}`); resolve(); })
                    .on('error', (error) => reject(new Error(`儲存失敗: ${error.message}`)));
            } catch (error) {
                reject(new Error(`處理錯誤: ${error.message}`));
            }
        });
    }

    static validateSkinData(skinData) {
        const requiredFields = ['SkinId', 'SkinData', 'SkinImageHeight', 'SkinImageWidth', 'ArmSize'];
        for (const field of requiredFields) {
            if (!(field in skinData)) throw new Error(`缺少欄位: ${field}`);
        }

        if (typeof skinData.SkinId !== 'string' || skinData.SkinId.length === 0) throw new Error('SkinId 必須是非空字串');
        if (typeof skinData.SkinData !== 'string' || skinData.SkinData.length === 0) throw new Error('SkinData 必須是非空 Base64');
        if (!Number.isInteger(skinData.SkinImageWidth) || skinData.SkinImageWidth <= 0) throw new Error('SkinImageWidth 必須是正整數');
        if (!Number.isInteger(skinData.SkinImageHeight) || skinData.SkinImageHeight <= 0) throw new Error('SkinImageHeight 必須是正整數');
        if (!['wide', 'slim'].includes(skinData.ArmSize)) throw new Error(`ArmSize 必須是 wide 或 slim`);

        console.log('✓ 皮膚資料驗證通過');
        return true;
    }
}

module.exports = { SkinLoader };
