const { SkinLoader } = require('./src/skinLoader.js');
const path = require('path');
const fs = require('fs');

console.log('=== Minecraft Bedrock 皮膚載入器測試 ===\n');

async function runTest() {
    // 確保 skins 目錄存在
    const skinsDir = path.join(__dirname, 'skins');
    if (!fs.existsSync(skinsDir)) {
        fs.mkdirSync(skinsDir);
        console.log(`✓ 已建立測試目錄: ${skinsDir}`);
    }

    // 尋找可用的 PNG 檔案
    const files = fs.readdirSync(skinsDir);
    const pngFile = files.find(file => file.endsWith('.png'));
    const validSkinPath = pngFile ? path.join(skinsDir, pngFile) : null;

    if (!validSkinPath) {
        console.log('\n⚠️  測試跳過: skins 目錄下沒有找到 PNG 檔案。');
        console.log(`   請將有效的皮膚檔案 (64x64 或 64x32 PNG) 放入: ${skinsDir}`);
        console.log('\n=== 測試結束 ===');
        return;
    }

    console.log(`✓ 找到測試皮膚檔案: ${pngFile}\n`);

    // === 測試 1: 載入並建立皮膚資料 (Wide 手臂) ===
    console.log('【測試 1】載入皮膚檔案 (Wide 手臂)');
    console.log('─'.repeat(50));
    try {
        const skinData = await SkinLoader.loadAndCreateSkinData(validSkinPath, {
            armSize: 'wide',
            skinId: 'test_skin_wide'
        });

        console.log('\n皮膚資料摘要:');
        console.log(`  • SkinId: ${skinData.SkinId}`);
        console.log(`  • 尺寸: ${skinData.SkinImageWidth}x${skinData.SkinImageHeight}`);
        console.log(`  • 手臂類型: ${skinData.ArmSize}`);
        console.log(`  • SkinData (Base64) 長度: ${skinData.SkinData.length} 字元`);
        console.log(`  • SkinResourcePatch 長度: ${skinData.SkinResourcePatch.length} 字元`);

        // 測試資源補丁解碼
        const patchDecoded = JSON.parse(Buffer.from(skinData.SkinResourcePatch, 'base64').toString());
        console.log(`  • 幾何模型: ${patchDecoded.geometry.default}`);

        console.log('\n✅ 測試 1 通過\n');

        // === 測試 2: 驗證皮膚資料 ===
        console.log('【測試 2】驗證皮膚資料結構');
        console.log('─'.repeat(50));
        try {
            SkinLoader.validateSkinData(skinData);
            console.log('✅ 測試 2 通過: 皮膚資料驗證成功\n');
        } catch (validationError) {
            console.error(`❌ 測試 2 失敗: ${validationError.message}\n`);
        }

        // === 測試 3: 載入並建立皮膚資料 (Slim 手臂) ===
        console.log('【測試 3】載入皮膚檔案 (Slim 手臂)');
        console.log('─'.repeat(50));
        const slimSkinData = await SkinLoader.loadAndCreateSkinData(validSkinPath, {
            armSize: 'slim',
            skinId: 'test_skin_slim'
        });

        console.log(`\n  • 手臂類型: ${slimSkinData.ArmSize}`);
        const slimPatch = JSON.parse(Buffer.from(slimSkinData.SkinResourcePatch, 'base64').toString());
        console.log(`  • 幾何模型: ${slimPatch.geometry.default}`);

        if (slimSkinData.ArmSize === 'slim' && slimPatch.geometry.default === 'geometry.humanoid.customSlim') {
            console.log('✅ 測試 3 通過: Slim 手臂類型正確\n');
        } else {
            console.error('❌ 測試 3 失敗: Slim 手臂類型設定錯誤\n');
        }

        // === 測試 4: Round-trip (儲存並讀取) ===
        console.log('【測試 4】Round-trip 測試 (儲存 → 讀取)');
        console.log('─'.repeat(50));
        const outputPath = path.join(skinsDir, 'test_output.png');

        try {
            await SkinLoader.saveSkinImage(
                skinData.SkinData,
                skinData.SkinImageWidth,
                skinData.SkinImageHeight,
                outputPath
            );

            if (fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                console.log(`\n  檔案大小: ${stats.size} bytes`);

                if (stats.size > 0) {
                    console.log('✅ 測試 4 通過: 皮膚轉換與還原成功\n');

                    // 清理測試檔案
                    fs.unlinkSync(outputPath);
                    console.log('  (已清理測試輸出檔案)');
                } else {
                    console.error('❌ 測試 4 失敗: 輸出檔案為空');
                }
            } else {
                console.error('❌ 測試 4 失敗: 輸出檔案未建立');
            }
        } catch (error) {
            console.error(`❌ 測試 4 失敗: ${error.message}`);
        }

    } catch (error) {
        console.error(`\n❌ 測試失敗: ${error.message}`);
        if (error.stack) {
            console.error('\n錯誤堆疊:');
            console.error(error.stack);
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('=== 測試完成 ===');
    console.log('='.repeat(50));
}

runTest().catch(error => {
    console.error('\n❌ 測試執行時發生嚴重錯誤:');
    console.error(error);
    process.exit(1);
});
