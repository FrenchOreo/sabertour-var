/**
 * Hook electron-builder exécuté après l'empaquetage.
 *
 * macOS : sans certificat Apple Developer (99 €/an), on signe l'application « ad hoc ».
 * C'est obligatoire : sur Apple Silicon, un binaire non signé est tué au lancement
 * (« Killed: 9 »). Une signature ad hoc ne supprime pas l'avertissement Gatekeeper au
 * premier lancement (→ « Ouvrir quand même »), mais l'app fonctionne ensuite normalement.
 * Si un vrai certificat est configuré (CSC_LINK / CSC_NAME), electron-builder signe lui-même.
 */
const { execFileSync } = require('child_process');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`  • signature ad hoc  ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
