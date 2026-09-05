#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════╗"
echo "║     SABER VAR — MISE À JOUR      ║"
echo "╚══════════════════════════════════╝"
echo ""

command -v git >/dev/null 2>&1 || {
  echo "❌ Git non trouvé."
  echo "   → macOS : xcode-select --install   |   Linux : sudo apt install git"
  exit 1
}
[ -d .git ] || {
  echo "❌ Ce dossier n'est pas un clone git."
  echo "   → git clone https://github.com/FrenchOreo/sabertour-var.git"
  exit 1
}

echo "⬇️  Récupération de la dernière version..."
git fetch origin main
git checkout main >/dev/null 2>&1 || true
git pull --ff-only origin main || {
  echo "❌ Modifications locales en conflit."
  echo "   Si rien n'est à conserver : git reset --hard origin/main  puis relancer ./update.sh"
  exit 1
}

echo "🧹 Nettoyage de l'ancienne installation..."
# Sans cette étape, start.sh garde l'ancienne interface : il ne rebuild que si client/dist est absent
rm -rf client/dist client/node_modules server/node_modules

echo "📦 Installation serveur..."
(cd server && npm install --silent)

echo "📦 Installation + build interface..."
(cd client && npm install --silent && npm run build --silent)

if [ -d node_modules ]; then
  echo "📦 Mise à jour des dépendances Electron..."
  npm install --silent
fi

echo ""
echo "✅ SABER VAR est à jour. Lancer ./start.sh"
echo ""
