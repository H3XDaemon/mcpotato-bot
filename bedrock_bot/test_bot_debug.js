const { SkinLoader } = require('./src/skinLoader.js');
const path = require('path');
const fs = require('fs');

console.log('=== Simulating Bot Skin Data Debug Output ===\n');

async function simulateBotDebug() {
    const skinPath = path.join(__dirname, 'skins', 'zero.png');

    try {
        console.log('Loading skin data...');
        const skinData = await SkinLoader.loadAndCreateSkinData(skinPath, {
            armSize: 'wide',
            skinId: 'test_bot_simulation'
        });

        console.log('\n✓ Skin data loaded');
        console.log('  Fields present:', Object.keys(skinData).join(', '));

        // Simulate bot.js debug output
        const debugData = {
            SkinId: skinData.SkinId,
            SkinImageWidth: skinData.SkinImageWidth,
            SkinImageHeight: skinData.SkinImageHeight,
            ArmSize: skinData.ArmSize,
            SkinDataLength: skinData.SkinData.length,
            SkinDataPreview: skinData.SkinData.substring(0, 50) + '...',
            SkinResourcePatch: skinData.SkinResourcePatch,
            SkinResourcePatchDecoded: JSON.parse(
                Buffer.from(skinData.SkinResourcePatch, 'base64').toString('utf-8')
            ),
            SkinGeometryLength: skinData.SkinGeometry?.length || 0,
            SkinGeometryPreview: skinData.SkinGeometry ?
                JSON.parse(Buffer.from(skinData.SkinGeometry, 'base64').toString('utf-8')) : null
        };

        const debugPath = path.join(__dirname, 'test_debug_skin_data.json');
        fs.writeFileSync(debugPath, JSON.stringify(debugData, null, 2));

        console.log(`\n✓ Debug data written to: ${debugPath}`);

        // Verify critical fields
        console.log('\nVerifying critical fields:');
        console.log('  ✓ SkinResourcePatch present:', !!skinData.SkinResourcePatch);
        console.log('  ✓ SkinGeometry present:', !!skinData.SkinGeometry);
        console.log('  ✓ SkinGeometry length:', skinData.SkinGeometry?.length || 0);

        if (debugData.SkinGeometryPreview) {
            console.log('  ✓ Geometry identifier:', debugData.SkinGeometryPreview['minecraft:geometry'][0].description.identifier);
            console.log('  ✓ Geometry bones:', debugData.SkinGeometryPreview['minecraft:geometry'][0].bones.length);
        }

        console.log('\n=== Simulation Complete ===');

    } catch (error) {
        console.error('\nSimulation failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

simulateBotDebug();
