# SABER VAR — Système VAR pour Saber Tour

Outil de vidéo-arbitrage pour le sabre laser sportif. Auto-hébergé, fonctionne en WiFi local sans internet.

## Prérequis

- **Node.js 18+** : https://nodejs.org
- **ffmpeg** (optionnel, pour export) :
  - macOS : `brew install ffmpeg`
  - Windows : `winget install Gyan.FFmpeg`

## Démarrage

1. **Connecter l'ordinateur au routeur WiFi du tournoi**
2. Double-cliquer `start.bat` (Windows) ou `./start.sh` (Mac/Linux)
3. L'interface de configuration s'ouvre automatiquement

## Guide bénévoles — Système VAR Saber Tour

### Mise en place (avant le tournoi)

1. Brancher l'ordinateur au routeur WiFi apporté pour le tournoi
2. Lancer `start.bat` ou `start.sh` — une fenêtre noire s'ouvre (normale)
3. Un navigateur s'ouvre sur la page de configuration
4. Nommer les 4 positions caméra (ex : GAUCHE, DROITE, FOND, JUGE)
5. Cliquer "Afficher QR" pour chaque caméra — imprimer ou laisser visible
6. Donner un QR code à chaque opérateur téléphone

### Sur les téléphones (une seule fois)

1. Se connecter au WiFi du tournoi
2. Scanner le QR code de sa position
3. Une page s'ouvre — appuyer "Avancé" puis "Continuer" si un avertissement
   de sécurité apparaît (c'est normal, le système fonctionne en local)
4. Autoriser l'accès à la caméra si demandé
5. L'écran affiche "EN DIRECT" quand tout est bon

### Utiliser le VAR

- Quand une action est litigieuse : appuyer le bouton VAR rouge (puis confirmer)
- La vidéo se fige sur la caméra sélectionnée
- Utiliser la timeline ou les touches ← → pour naviguer

**Raccourcis clavier :**

| Touche | Action |
|--------|--------|
| ← → | ±1 frame |
| ↑ ↓ | ±10 frames |
| Espace | Play/Pause |
| 1/2/3/4 | Vitesse 1x / 0.5x / 0.25x / 0.1x |
| A | Analyse IA (marqueurs d'impacts + synchro auto) |
| Maj + ← → | Impact précédent / suivant |
| Escape | Reprendre le live |

### Analyse IA et synchro (mode VAR)

- **⚡ ANALYSE IA** (ou touche `A`) : détecte les impacts probables et les marque
  en orange sur la timeline (le clic s'aimante dessus), puis resynchronise
  automatiquement les caméras entre elles par corrélation du mouvement.
- **◆ précédent / suivant** (ou `Maj + ←/→`) : saute d'un impact à l'autre, le
  compteur indique « impact 2 / 5 ».
- **−1f / +1f** sur chaque tuile : recalage manuel d'une caméra à la frame près.
- En direct, le **bandeau GO/NO-GO** au-dessus de la grille résume l'état :
  **✅ PRÊT** (lancer l'assaut), **⚠** (dégradé ou buffer en cours), **⛔** (flux perdu,
  caméra hors ligne). Chaque tuile garde son point de santé (débit, fps, perte).
- **Flux perdu** : une tuile « ⚠ Flux perdu » se reconnecte toute seule en quelques
  secondes (renégociation automatique) — sans effacer les buffers des autres caméras.
- Détails et feuille de route : [docs/DETECTION-IA.md](docs/DETECTION-IA.md)

### Qualité vidéo instable ? Commencer par le matériel

Le guide [docs/HARDWARE.md](docs/HARDWARE.md) explique le setup à moins de 150 €
qui stabilise tout : routeur 5 GHz dédié, PC arbitre en Ethernet, éclairage piste,
téléphones sur secteur, et le réglage 60 fps (Paramètres → Fluidité caméra).

### Dépannage

| Problème | Solution |
|---|---|
| Téléphone ne se connecte pas | Vérifier qu'il est sur le même WiFi que l'ordi |
| Avertissement de sécurité | Appuyer "Avancé" → "Continuer" (une seule fois) |
| Caméra qui ne s'ouvre pas (iPhone) | Réglages → Safari → Caméra → Autoriser |
| Image floue ou caméra frontale | Appuyer "↕ Retourner" sur la page du téléphone |
| Le ralenti ne fonctionne pas | Attendre 30s après connexion (buffer en cours) |
| Écran du téléphone qui s'éteint | Le verrou d'écran est redemandé automatiquement ; sinon désactiver la mise en veille |
| Tuile « Flux perdu » | Reconnexion automatique en ~5 s ; si elle persiste, recharger la page du téléphone |

## Architecture

```
shared/types.ts          — Types partagés serveur/client
server/src/index.ts      — HTTPS + Express + WebSocket
server/src/tls.ts        — Certificat auto-signé (selfsigned)
server/src/signaling.ts  — Relais WebSocket (signalisation WebRTC)
server/src/camera-registry.ts — Registre slots + tokens
client/src/pages/        — SetupPage, CameraPage, ArbitragePage
client/src/components/   — CameraTile, VarTimeline, FrameCounter
client/src/hooks/        — useSignaling, useWebRTC, useVideoBuffer, useFramePlayer,
                           useConnectionStats (santé réseau + latence par caméra)
client/src/lib/varAnalysis.ts — analyse IA : impacts + synchro auto (corrélation croisée)
```

Le système fonctionne entièrement en réseau local. Les flux vidéo passent en WebRTC peer-to-peer entre les téléphones et l'ordinateur arbitre. Le serveur ne fait que relayer les messages de signalisation.
