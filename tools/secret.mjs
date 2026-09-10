/**
 * Prints a fresh event secret for config.js.
 * Rotate this between events: every outstanding code stops working.
 */
import crypto from 'node:crypto';

const secret = crypto.randomBytes(32).toString('base64url');
console.log('\n  Paste into config.js:\n');
console.log(`  eventSecret: '${secret}',\n`);
console.log('  Every display code and visitor pass issued under the old secret');
console.log('  stops working the moment you deploy this.\n');
