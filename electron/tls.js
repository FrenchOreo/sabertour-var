const selfsigned = require('selfsigned');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getCertPath() {
  // In packaged app, use userData; in dev, use project root
  try {
    return path.join(app.getPath('userData'), '.certs');
  } catch {
    return path.join(__dirname, '..', '.certs');
  }
}

function ensureCertificates() {
  const certPath = getCertPath();
  const keyFile = path.join(certPath, 'key.pem');
  const certFile = path.join(certPath, 'cert.pem');

  if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(certPath, { recursive: true });
    const attrs = [{ name: 'commonName', value: 'saber-var.local' }];
    const pems = selfsigned.generate(attrs, {
      days: 365,
      algorithm: 'sha256',
      keySize: 2048,
    });
    fs.writeFileSync(keyFile, pems.private);
    fs.writeFileSync(certFile, pems.cert);
    console.log('Certificat TLS généré dans', certPath);
  }

  return {
    key: fs.readFileSync(keyFile, 'utf8'),
    cert: fs.readFileSync(certFile, 'utf8'),
  };
}

module.exports = { ensureCertificates };
