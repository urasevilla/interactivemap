/**
 * Hashes an owner passphrase for the config.js fallback sign-in.
 * Usage:  npm run passphrase -- "correct horse battery staple"
 *
 * Must match js/auth.js: PBKDF2-SHA256, 200_000 iterations, 256-bit output.
 */
import crypto from 'node:crypto';

const passphrase = process.argv.slice(2).join(' ');
if (!passphrase) {
  console.error('\n  Usage: npm run passphrase -- "your passphrase"\n');
  process.exit(1);
}
if (passphrase.length < 10) {
  console.error('\n  Use at least 10 characters — this is the fallback to a Google account.\n');
  process.exit(1);
}

const salt = 'wiego-map';
const hash = crypto.pbkdf2Sync(passphrase, salt, 200_000, 32, 'sha256').toString('hex');

console.log('\n  Paste into config.js:\n');
console.log(`  ownerPassphraseHash: '${hash}',`);
console.log(`  ownerPassphraseSalt: '${salt}',\n`);
