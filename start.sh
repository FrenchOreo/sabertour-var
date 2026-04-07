#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════╗"
echo "║      SABER VAR — DÉMARRAGE       ║"
echo "╚══════════════════════════════════╝"
echo ""

command -v node >/dev/null 2>&1 || {
  echo "❌ Node.js non trouvé."
  echo "   → Installer via https://nodejs.org (version 18+)"
  exit 1
}

NODE_VER=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js $NODE_VER détecté, version 18+ requise."
  exit 1
fi

if command -v ffmpeg >/dev/null 2>&1; then
  echo "✅ ffmpeg détecté — export vidéo activé"
else
  echo "⚠️  ffmpeg absent — export désactivé (brew install ffmpeg pour activer)"
fi

[ ! -d "server/node_modules" ] && echo "📦 Installation serveur..." && (cd server && npm install --silent)
[ ! -d "client/node_modules" ] && echo "📦 Installation client..."  && (cd client && npm install --silent)
[ ! -d "client/dist" ]         && echo "🔨 Build interface..."      && (cd client && npm run build --silent)

echo ""
echo "🚀 Démarrage..."
cd server && npm start &
SERVER_PID=$!

sleep 2
open https://localhost:3000/setup 2>/dev/null || true

wait $SERVER_PID
