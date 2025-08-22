const { mnemonicNew } = require('@ton/crypto');

async function generateTestWallet() {
  console.log('🔐 Generating new test wallet...');
  
  try {
    // Generate new mnemonic
    const mnemonic = await mnemonicNew();
    console.log('\n✅ Generated test wallet:');
    console.log('Mnemonic:', mnemonic.join(' '));
    console.log('\n🔧 Copy this mnemonic to your .env file:');
    console.log(`ORACLE_PRIVATE_KEY=${mnemonic.join(' ')}`);
    console.log('\n⚠️  Note: This is a TEST wallet. Do not use for real funds!');
  } catch (error) {
    console.error('❌ Error generating wallet:', error);
  }
}

generateTestWallet();