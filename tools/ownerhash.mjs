/**
 * Hashes the host's email address for config.js.
 *
 * The site has to recognise one Google account, but it does not have to publish
 * which one. Storing a SHA-256 digest keeps the address out of a public
 * repository and off the page, while the comparison still works — auth.js
 * hashes the verified `email` claim and compares digests.
 *
 * This is anti-scraping, not secrecy: anyone who suspects an address can
 * confirm it by hashing their guess. It stops the address being harvested.
 *
 * Usage:  npm run ownerhash -- you@example.com
 */
import crypto from 'node:crypto';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('\n  Usage: npm run ownerhash -- you@example.com\n');
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(email).digest('hex');

console.log('\n  Paste into config.js:\n');
console.log(`  ownerEmail: '',`);
console.log(`  ownerEmailHash: '${hash}',\n`);
console.log('  Leave ownerEmail empty. Set it instead of the hash only if you');
console.log('  do not mind the address appearing in the page source.\n');
