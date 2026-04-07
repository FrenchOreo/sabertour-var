import selfsigned from 'selfsigned';
import fs from 'fs';
import path from 'path';

const CERT_PATH = path.join(process.cwd(), '..', '.certs');
const KEY_FILE = path.join(CERT_PATH, 'key.pem');
const CERT_FILE = path.join(CERT_PATH, 'cert.pem');

export function ensureCertificates(): { key: string; cert: string } {
  if (!fs.existsSync(KEY_FILE)) {
    fs.mkdirSync(CERT_PATH, { recursive: true });
    const attrs = [{ name: 'commonName', value: 'saber-var.local' }];
    const pems = selfsigned.generate(attrs, {
      days: 365,
      algorithm: 'sha256',
      keySize: 2048,
    });
    fs.writeFileSync(KEY_FILE, pems.private);
    fs.writeFileSync(CERT_FILE, pems.cert);
    console.log('✅ Certificat TLS généré dans .certs/');
  }
  return {
    key: fs.readFileSync(KEY_FILE, 'utf8'),
    cert: fs.readFileSync(CERT_FILE, 'utf8'),
  };
}
