import React from 'react';

export default function GuidePage() {
  return (
    <div style={{ minHeight: '100vh', padding: 24, overflowY: 'auto' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Header */}
        <div className="flex items-center gap-4" style={{ marginBottom: 8 }}>
          <h1
            style={{
              fontFamily: 'var(--font-ui)',
              fontWeight: 700,
              fontSize: '2rem',
              color: 'var(--cyan)',
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
              flex: 1,
            }}
          >
            Guide Bénévoles
          </h1>
          <a href="/setup" className="btn" style={{ textDecoration: 'none', fontSize: '0.85rem' }}>
            Retour
          </a>
        </div>
        <p className="text-muted" style={{ marginBottom: 32 }}>
          Mode d'emploi complet du système VAR — Saber Tour
        </p>

        {/* Section 1: Mise en place */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontSize: '1.2rem',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 16,
              color: 'var(--cyan)',
            }}
          >
            1. Mise en place
          </h2>
          <p className="text-muted" style={{ marginBottom: 12 }}>
            Avant le début du tournoi, le responsable VAR doit préparer le système :
          </p>
          <ol className="text-muted" style={{ paddingLeft: 20, lineHeight: 2 }}>
            <li>
              <strong style={{ color: 'var(--text)' }}>Connecter l'ordinateur au WiFi du tournoi</strong> — l'ordinateur
              qui servira de serveur VAR doit être sur le même réseau que les téléphones.
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Lancer l'application</strong> — ouvrir le navigateur et aller sur
              l'adresse indiquée (ex : <span className="font-mono text-cyan">http://192.168.1.x:3000</span>).
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Nommer les caméras</strong> — sur la page de configuration, donner
              un nom à chaque position caméra (GAUCHE, DROITE, FOND, JUGE...) puis cliquer "Configurer les slots".
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Préparer les QR codes</strong> — une fois configuré, la page
              affiche les QR codes pour chaque caméra. Chaque téléphone devra scanner le QR code correspondant à sa
              position.
            </li>
          </ol>
        </div>

        {/* Section 2: Sur les téléphones */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontSize: '1.2rem',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 16,
              color: 'var(--cyan)',
            }}
          >
            2. Sur les téléphones
          </h2>
          <p className="text-muted" style={{ marginBottom: 12 }}>
            Chaque bénévole caméra doit suivre ces étapes :
          </p>
          <ol className="text-muted" style={{ paddingLeft: 20, lineHeight: 2 }}>
            <li>
              <strong style={{ color: 'var(--text)' }}>Se connecter au WiFi du tournoi</strong> — le même réseau que
              l'ordinateur serveur.
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Scanner le QR code</strong> — utiliser l'appareil photo du
              téléphone pour scanner le QR code de la position assignée.
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Accepter l'avertissement de sécurité</strong> — le navigateur
              affichera un avertissement car le site utilise une connexion locale. Appuyer sur{' '}
              <span className="text-cyan">"Avancé"</span> puis{' '}
              <span className="text-cyan">"Continuer vers le site"</span>.
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Autoriser l'accès à la caméra</strong> — le navigateur demandera
              la permission d'utiliser la caméra. Accepter.
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Vérifier le statut</strong> — l'écran affiche{' '}
              <span className="text-cyan">"EN DIRECT"</span> quand la caméra est connectée et diffuse correctement.
            </li>
          </ol>
        </div>

        {/* Section 3: Utiliser le VAR */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontSize: '1.2rem',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 16,
              color: 'var(--cyan)',
            }}
          >
            3. Utiliser le VAR
          </h2>
          <p className="text-muted" style={{ marginBottom: 12 }}>
            L'arbitre ou le responsable VAR utilise l'interface arbitrage sur l'ordinateur :
          </p>
          <ol className="text-muted" style={{ paddingLeft: 20, lineHeight: 2 }}>
            <li>
              <strong style={{ color: 'var(--text)' }}>Appuyer sur le bouton VAR</strong> — un premier appui met le
              système en attente (le bouton clignote). <strong style={{ color: 'var(--red)' }}>Appuyer une deuxième
              fois pour confirmer</strong> et figer l'image sur toutes les caméras.
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Naviguer image par image</strong> — une fois le VAR activé,
              utiliser les flèches du clavier ou les boutons à l'écran pour avancer/reculer dans l'enregistrement.
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Changer de caméra</strong> — cliquer sur la vignette de la
              caméra souhaitée pour voir l'angle correspondant.
            </li>
            <li>
              <strong style={{ color: 'var(--text)' }}>Revenir au direct</strong> — appuyer sur <span
              className="font-mono text-cyan">Échap</span> ou cliquer le bouton de retour pour reprendre la diffusion
              en direct.
            </li>
          </ol>
        </div>

        {/* Section 4: Raccourcis clavier */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontSize: '1.2rem',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 16,
              color: 'var(--cyan)',
            }}
          >
            4. Raccourcis clavier
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: 'var(--font-ui)',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      color: 'var(--cyan)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      fontSize: '0.85rem',
                    }}
                  >
                    Touche
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      color: 'var(--cyan)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      fontSize: '0.85rem',
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['← (flèche gauche)', 'Reculer de 1 image'],
                  ['→ (flèche droite)', 'Avancer de 1 image'],
                  ['↑ (flèche haut)', 'Avancer de 10 images'],
                  ['↓ (flèche bas)', 'Reculer de 10 images'],
                  ['Espace', 'Lecture / Pause'],
                  ['1', 'Vitesse x1'],
                  ['2', 'Vitesse x0.5'],
                  ['3', 'Vitesse x0.25'],
                  ['4', 'Vitesse x0.1'],
                  ['A', 'Analyse IA : marqueurs des impacts + synchro auto'],
                  ['Maj + ← / →', 'Impact précédent / suivant'],
                  ['Échap', 'Retour au direct'],
                ].map(([key, action], i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: i % 2 === 0 ? 'transparent' : 'var(--bg-elevated)',
                    }}
                  >
                    <td style={{ padding: '10px 12px' }}>
                      <code
                        className="font-mono"
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          padding: '2px 8px',
                          color: 'var(--text)',
                          fontSize: '0.9rem',
                        }}
                      >
                        {key}
                      </code>
                    </td>
                    <td className="text-muted" style={{ padding: '10px 12px' }}>
                      {action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 5: Dépannage */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontSize: '1.2rem',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 16,
              color: 'var(--cyan)',
            }}
          >
            5. Dépannage
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: 'var(--font-ui)',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      color: 'var(--orange)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      fontSize: '0.85rem',
                      width: '35%',
                    }}
                  >
                    Problème
                  </th>
                  <th
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      color: 'var(--orange)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      fontSize: '0.85rem',
                    }}
                  >
                    Solution
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    'Le téléphone ne se connecte pas',
                    "Vérifier que le téléphone est bien connecté au même WiFi que l'ordinateur. Essayer de rafraîchir la page. Vérifier que l'URL est correcte.",
                  ],
                  [
                    "Avertissement de sécurité dans le navigateur",
                    'C\'est normal. Appuyer sur "Avancé" puis "Continuer vers le site" (ou "Accepter le risque" sur Firefox).',
                  ],
                  [
                    "La caméra ne s'ouvre pas sur iPhone",
                    "Utiliser Safari (pas Chrome). Aller dans Réglages > Safari > effacer les données de site web si le problème persiste. Vérifier les permissions caméra dans Réglages > Safari.",
                  ],
                  [
                    "L'image est floue",
                    "Nettoyer l'objectif du téléphone. S'assurer que le téléphone est stable (utiliser un trépied ou support). Vérifier que la mise au point automatique fonctionne.",
                  ],
                  [
                    'Le ralenti ne fonctionne pas',
                    "Vérifier que le VAR a bien été confirmé (double appui). Les images ne sont disponibles qu'après l'activation du VAR. Attendre quelques secondes que le buffer se charge.",
                  ],
                  [
                    "L'écran du téléphone s'éteint",
                    "Désactiver la mise en veille automatique dans les réglages du téléphone. Sur iPhone : Réglages > Luminosité et affichage > Verrouillage automatique > Jamais.",
                  ],
                ].map(([problem, solution], i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: i % 2 === 0 ? 'transparent' : 'var(--bg-elevated)',
                    }}
                  >
                    <td style={{ padding: '10px 12px', color: 'var(--text)', fontWeight: 600, verticalAlign: 'top' }}>
                      {problem}
                    </td>
                    <td className="text-muted" style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                      {solution}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '16px 0 32px' }}>
          <a href="/setup" className="btn" style={{ textDecoration: 'none' }}>
            Retour à la configuration
          </a>
        </div>
      </div>
    </div>
  );
}
