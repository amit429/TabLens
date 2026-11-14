/**
 * Generates the key pair that pins your extension's id for unpacked builds.
 *  - private key → .keys/extension.pem (git-ignored; keep a backup, it's only needed to keep the id)
 *  - public key  → TABLENS_MANIFEST_KEY in .env (git-ignored)
 * Prints the extension id to put in your API's ALLOWED_EXTENSION_IDS secret.
 *
 *   pnpm keygen            # refuses to overwrite an existing key
 *   pnpm keygen --force    # rotate: new key, new id
 */
import { generateKeyPairSync, createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pemPath = path.join(root, '.keys/extension.pem');
const envPath = path.join(root, '.env');
const force = process.argv.includes('--force');

let privatePem;
if (fs.existsSync(pemPath) && !force) {
  privatePem = fs.readFileSync(pemPath, 'utf8');
  console.log('Using existing .keys/extension.pem (pass --force to rotate).');
} else {
  privatePem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.mkdirSync(path.dirname(pemPath), { recursive: true });
  fs.writeFileSync(pemPath, privatePem, { mode: 0o600 });
  console.log('Wrote .keys/extension.pem');
}

const der = createPublicKey(createPrivateKey(privatePem)).export({ type: 'spki', format: 'der' });
const manifestKey = der.toString('base64');
// Chrome's id: first 128 bits of SHA-256(public key), hex digits mapped 0-f → a-p.
const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : fs.readFileSync(path.join(root, '.env.example'), 'utf8');
env = /^TABLENS_MANIFEST_KEY=.*$/m.test(env) ? env.replace(/^TABLENS_MANIFEST_KEY=.*$/m, `TABLENS_MANIFEST_KEY=${manifestKey}`) : `${env.trimEnd()}\nTABLENS_MANIFEST_KEY=${manifestKey}\n`;
fs.writeFileSync(envPath, env);
console.log('Set TABLENS_MANIFEST_KEY in .env');
console.log(`\nExtension id: ${id}\nPut it in your API's ALLOWED_EXTENSION_IDS secret.`);
