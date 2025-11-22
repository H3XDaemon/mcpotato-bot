const { SkinLoader } = require('./src/skinLoader.js');
const path = require('path');

console.log('=== Quick Skin Validation Test ===\n');

async function quickTest() {
    const skinPath = path.join(__dirname, 'skins', 'zero.png');

    try {
        console.log('Testing skin file:', skinPath);

        const skinData = await SkinLoader.loadAndCreateSkinData(skinPath, {
            armSize: 'wide',
            skinId: 'test_validation'
        });

        console.log('\nSkin loaded successfully!');
        console.log('  SkinId:', skinData.SkinId);
        console.log('  Size:', skinData.SkinImageWidth + 'x' + skinData.SkinImageHeight);
        console.log('  ArmSize:', skinData.ArmSize);
        console.log('  SkinData length:', skinData.SkinData.length);

        console.log('\nValidating skin data...');
        SkinLoader.validateSkinData(skinData);
        console.log('Validation passed!');

        console.log('\n=== Test Completed Successfully ===');

    } catch (error) {
        console.error('\nTest failed:', error.message);
        process.exit(1);
    }
}

quickTest();
