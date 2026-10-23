/*
 * Prints a new VAPID key pair for push reminders. Put both values in the server's secrets
 * (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY), never in the repo. Run: node scripts/vapid-keys.js
 * Making a new pair later stops existing phones from getting reminders until they turn them on again.
 */
const { webcrypto } = await import('node:crypto');
const subtle = webcrypto.subtle;

const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicRaw = Buffer.from(await subtle.exportKey('raw', pair.publicKey));
const privateJwk = await subtle.exportKey('jwk', pair.privateKey);

console.log(`VAPID_PUBLIC_KEY=${publicRaw.toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${privateJwk.d}`);
console.log('VAPID_SUBJECT=mailto:you@example.com   (use your own address)');
