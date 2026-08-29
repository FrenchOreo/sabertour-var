# Guide hardware — stabiliser la VAR pour moins de 150 €

La qualité vidéo instable et la désynchro des caméras viennent en grande partie du
transport : 4 téléphones qui streament en WebRTC sur un WiFi de gymnase saturé.
Ce guide donne le setup matériel qui élimine l'essentiel du problème sans changer
de caméras, puis les évolutions possibles plus tard.

## Liste d'achats (~120–150 €)

| Matériel | Prix indicatif | Pourquoi |
|---|---|---|
| Routeur WiFi 6 dual-band (ex. TP-Link AX23/AX55) | 60–90 € | Bande 5 GHz propre, dédiée au tournoi |
| Adaptateur USB-C → Ethernet + câble RJ45 5–10 m | 15–25 € | Le PC arbitre passe en filaire : moitié moins de radio |
| 2 projecteurs LED de chantier 30–50 W sur trépied | 30–50 € | Plus de lumière = moins de bruit vidéo = encodage bien plus efficace |
| Multiprise + câbles de charge pour les 4 téléphones | ~10 € | Un téléphone qui chauffe ou économise sa batterie dégrade son encodeur |

> **Le câble qui compte** : celui entre le PC arbitre et le routeur. Les téléphones
> restent en WiFi (1 saut radio chacun), mais le PC ne partage plus la bande.

## Checklist d'installation (jour de tournoi)

1. **Routeur** : posé en hauteur (2 m+), au centre de la piste, ligne de vue directe
   vers les 4 téléphones. Activer uniquement le 5 GHz si possible, canal fixe
   (36 ou 149), largeur 80 MHz.
2. **SSID dédié** : seuls les 4 téléphones + le PC arbitre s'y connectent.
   Ne pas donner le mot de passe au public. Désactiver le WiFi invité.
3. **PC arbitre branché en Ethernet** au routeur. Vérifier dans les paramètres
   réseau que le WiFi du PC est coupé.
4. **Téléphones** : branchés sur secteur, mode avion puis WiFi réactivé
   (coupe le cellulaire qui interfère), verrouillage d'écran désactivé,
   à moins de 10 m du routeur.
5. **Éclairage** : projecteurs dirigés vers la piste (pas vers les caméras).
   Objectifs essuyés.
6. **Réglage app** : 60 fps activé (Paramètres → Fluidité caméra). En cas de WiFi
   difficile malgré tout, préférer 720p60 à 1080p60 — pour le VAR, la fluidité
   prime sur la définition.
7. **Contrôle** : sur la grille arbitre, chaque tuile affiche un point de santé
   (vert/orange/rouge) avec débit, fps et perte de paquets. Tout doit être vert
   avant le premier combat. Un point rouge = déplacer le téléphone ou le routeur.

## Pourquoi ça marche

- En 2,4 GHz, des dizaines de téléphones du public saturent le spectre : WebRTC
  détecte la perte de paquets et réduit agressivement débit et framerate.
  Un 5 GHz dédié supprime la contention.
- Chaque saut radio ajoute latence **variable** (jitter) : c'est cette variance,
  différente pour chaque téléphone, qui désynchronise les caméras. PC en filaire
  = moitié des sauts en moins.
- En basse lumière, le capteur monte en ISO (bruit) et allonge l'exposition
  (flou de mouvement). Le bruit consomme le débit de l'encodeur : à bitrate égal,
  une scène éclairée est nettement plus propre.

## Évolutions possibles plus tard

| Option | Budget | Gain | Contrainte |
|---|---|---|---|
| Webcams USB 1080p60 + rallonges USB 3 actives | 100–300 € | Zéro WiFi, une seule horloge → synchro quasi parfaite | Câbles au sol à sécuriser (gaffer/passe-câbles), portée ~15 m |
| Caméras IP PoE 50/60 fps + switch PoE | 400–1200 € | Très stable, portée 100 m, alimentation par le câble | Développement ingestion RTSP dans l'app ; bien vérifier le 50/60 fps (beaucoup plafonnent à 25/30) |
| Action cams / camcorders + capture HDMI→USB | 300–1500 € | Meilleure image, 60–120 fps | Câblage HDMI lourd, bande passante USB à planifier |

Dans tous les cas, retenir : **pour un VAR, le framerate prime sur la résolution**
— une touche de sabre dure 1 à 2 images à 30 fps.
