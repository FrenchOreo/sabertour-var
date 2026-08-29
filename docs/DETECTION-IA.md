# Détection de touches par IA — V1 implémentée et feuille de route

## V1 — Assistance au replay (implémentée)

En mode VAR, le bouton **⚡ ANALYSE IA** (raccourci `A`) lit les buffers des
caméras en accéléré dans des lecteurs cachés et calcule, image par image, un
**signal d'énergie de mouvement** (différence de luminance entre frames
successives, sur un canvas réduit). Tout tourne en local dans l'app — aucun
modèle à télécharger, aucun réseau.

Ce signal sert à deux choses :

### 1. Marqueurs d'impacts sur la timeline

Un impact (touche, parade, clash de lames) produit un pic brutal d'énergie de
mouvement. Les pics dépassant un z-score robuste (médiane + MAD, donc insensible
aux quelques impacts eux-mêmes) deviennent des **losanges orange** sur la
timeline. Le clic s'aimante dessus : l'arbitre saute directement aux moments
chauds au lieu de scruter 60 secondes de vidéo.

**Limites assumées de la V1** : le signal ne distingue pas une touche valide
d'une parade ou d'un clash — il marque les *candidats*. C'est une aide à la
navigation, pas un juge : la décision reste à l'arbitre. Environ 5 à 12 marqueurs
par capture selon l'intensité de l'échange.

### 2. Synchro automatique des caméras

Les 4 caméras filment la même scène : leurs signaux de mouvement sont corrélés.
La **corrélation croisée** entre la caméra maître et chacune des autres donne le
décalage temporel réel (précision ~50–100 ms, interpolation parabolique du pic),
bien meilleure que l'alignement par heure d'arrivée des chunks. Si la corrélation
est trop faible pour conclure, l'offset de la caméra n'est pas modifié.

En complément, chaque tuile a des boutons **−1f / +1f** pour un recalage manuel
à la frame près (l'offset courant s'affiche en ms).

### Synchro passive (sans analyse)

Même sans lancer l'analyse, la synchro initiale a été améliorée :

- chunks d'enregistrement de 250 ms (au lieu de 1 s) → l'erreur de granularité
  passe de ±1 s à ±0,25 s ;
- la latence réseau de chaque caméra (RTT/2 + jitter buffer, mesurée via
  `getStats()`) est soustraite des timestamps d'arrivée ;
- le fps du replay est mesuré sur la caméra maître (plus de 30 fps codé en dur).

## V2 — Modèle entraîné sur les vidéos existantes (feuille de route)

Avec les enregistrements de combats déjà disponibles (>50 combats), on peut
passer d'une détection « impacts candidats » à une vraie détection de touches :
**qui touche, où (zone), quand**.

### Étape 1 — Constituer le dataset

1. Rassembler les vidéos (l'app sait déjà enregistrer sur disque par caméra,
   bouton REC) et découper des clips de 10–20 s autour des échanges.
2. Annoter avec [CVAT](https://cvat.ai) ou [Label Studio](https://labelstud.io) :
   - la **frame de contact** (événement ponctuel),
   - la **zone touchée** (tête / tronc / bras / jambe / main),
   - le **tireur qui touche** (gauche / droite),
   - les négatifs difficiles : parades, clashs lame-lame, quasi-touches.
3. Ordre de grandeur pour une V2 utile : 500–1000 événements annotés
   (≈ 2–4 tournois). Les faux positifs de la V1 confirmés/rejetés par l'arbitre
   sont la source d'annotation la moins chère — à instrumenter dans l'app
   (log JSONL des verdicts via IPC Electron).

### Étape 2 — Pipeline de détection

Approche recommandée, robuste avec peu de données :

1. **Lames** : les lames LED sont saturées et lumineuses → segmentation
   HSV + ajustement de segment (RANSAC). Pas d'apprentissage nécessaire,
   calibration couleur par combat (2 clics : couleur lame gauche / droite).
2. **Tireurs** : pose estimation 2D pré-entraînée — MediaPipe Pose (WASM,
   embarquable hors-ligne dans Electron, ~10–30 ms/frame) ou RTMPose en ONNX
   (`onnxruntime-node`, plus précis).
3. **Classifieur de touche** : petit modèle temporel (GRU/TCN, quelques dizaines
   de milliers de paramètres) sur des features par frame :
   distance lame↔segments du squelette adverse, vitesse/décélération du bout de
   lame, énergie de mouvement locale. Entraîné sur le dataset de l'étape 1.
   La zone touchée découle du segment de squelette le plus proche au contact.
4. **Fusion multi-caméras** : une touche est validée si ≥ 2 caméras la voient
   dans une fenêtre de ±80 ms (lève l'ambiguïté de profondeur du 2D).

Alternative plus simple si l'annotation est abondante : détection d'objets
YOLO (fine-tuné « lame », « tireur ») + le même classifieur temporel.

### Étape 3 — Intégration

- Inférence dans le process principal Electron (`onnxruntime-node`, CPU/GPU) ;
  l'UI reçoit les événements par IPC — même contrat que la V1 (des marqueurs,
  enrichis de `{ zone, tireur, confiance }`).
- D'abord en mode replay (analyse de la capture VAR, quelques secondes),
  puis en temps réel sur 1–2 caméras à cadence réduite (10–15 fps d'analyse)
  si le laptop suit.

### Ce qu'il ne faut pas attendre de l'IA

Le règlement (priorité, phrase d'armes, plausibilité du geste) reste hors de
portée d'un détecteur visuel : l'outil signale les contacts et leur zone,
l'arbitre décide. C'est aussi ce qui rend le produit acceptable en compétition.
