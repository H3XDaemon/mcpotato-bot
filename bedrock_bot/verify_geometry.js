const { SkinLoader } = require('./src/skinLoader.js');
const path = require('path');

console.log('=== Detailed SkinGeometry Verification Test ===\n');

async function detailedTest() {
    const skinPath = path.join(__dirname, 'skins', 'zero.png');

    try {
        // Test wide arm size
        console.log('Testing WIDE arm size:');
        const wideSkin = await SkinLoader.loadAndCreateSkinData(skinPath, {
            armSize: 'wide',
            skinId: 'test_wide'
        });

        console.log('\nWide Skin Data:');
        console.log('  SkinId:', wideSkin.SkinId);
        console.log('  Size:', wideSkin.SkinImageWidth + 'x' + wideSkin.SkinImageHeight);
        console.log('  ArmSize:', wideSkin.ArmSize);
        console.log('  SkinResourcePatch (base64):', wideSkin.SkinResourcePatch.substring(0, 50) + '...');
        console.log('  SkinGeometry (base64 length):', wideSkin.SkinGeometry.length);

        const widePatchDecoded = JSON.parse(Buffer.from(wideSkin.SkinResourcePatch, 'base64').toString('utf-8'));
        console.log('  SkinResourcePatch (decoded):');
        console.log('    Geometry ID:', widePatchDecoded.geometry.default);

        const wideGeometryDecoded = JSON.parse(Buffer.from(wideSkin.SkinGeometry, 'base64').toString('utf-8'));
        console.log('  SkinGeometry (decoded):');
        console.log('    Format Version:', wideGeometryDecoded.format_version);
        console.log('    Geometry Identifier:', wideGeometryDecoded['minecraft:geometry'][0].description.identifier);
        console.log('    Bones Count:', wideGeometryDecoded['minecraft:geometry'][0].bones.length);

        // Test slim arm size
        console.log('\n\nTesting SLIM arm size:');
        const slimSkin = await SkinLoader.loadAndCreateSkinData(skinPath, {
            armSize: 'slim',
            skinId: 'test_slim'
        });

        console.log('\nSlim Skin Data:');
        console.log('  SkinId:', slimSkin.SkinId);
        console.log('  Size:', slimSkin.SkinImageWidth + 'x' + slimSkin.SkinImageHeight);
        console.log('  ArmSize:', slimSkin.ArmSize);
        console.log('  SkinResourcePatch (base64):', slimSkin.SkinResourcePatch.substring(0, 50) + '...');
        console.log('  SkinGeometry (base64 length):', slimSkin.SkinGeometry.length);

        const slimPatchDecoded = JSON.parse(Buffer.from(slimSkin.SkinResourcePatch, 'base64').toString('utf-8'));
        console.log('  SkinResourcePatch (decoded):');
        console.log('    Geometry ID:', slimPatchDecoded.geometry.default);

        const slimGeometryDecoded = JSON.parse(Buffer.from(slimSkin.SkinGeometry, 'base64').toString('utf-8'));
        console.log('  SkinGeometry (decoded):');
        console.log('    Format Version:', slimGeometryDecoded.format_version);
        console.log('    Geometry Identifier:', slimGeometryDecoded['minecraft:geometry'][0].description.identifier);
        console.log('    Bones Count:', slimGeometryDecoded['minecraft:geometry'][0].bones.length);

        // Verify consistency
        console.log('\n\nVerifying consistency:');
        if (widePatchDecoded.geometry.default === wideGeometryDecoded['minecraft:geometry'][0].description.identifier) {
            console.log('  ✓ Wide: ResourcePatch ID matches Geometry identifier');
        } else {
            throw new Error('Wide: ID mismatch!');
        }

        if (slimPatchDecoded.geometry.default === slimGeometryDecoded['minecraft:geometry'][0].description.identifier) {
            console.log('  ✓ Slim: ResourcePatch ID matches Geometry identifier');
        } else {
            throw new Error('Slim: ID mismatch!');
        }

        // Validate both
        console.log('\nValidating both skins...');
        SkinLoader.validateSkinData(wideSkin);
        SkinLoader.validateSkinData(slimSkin);

        console.log('\n=== All Tests Passed! ===');
        console.log('✓ SkinGeometry field is correctly generated');
        console.log('✓ Geometry definitions are complete and valid');
        console.log('✓ ResourcePatch and Geometry identifiers match');

    } catch (error) {
        console.error('\nTest failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

detailedTest();
