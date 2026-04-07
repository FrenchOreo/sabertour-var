import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { SlotState } from 'shared/types';

const DEFAULT_NAMES: Record<number, string> = {
  1: 'GAUCHE',
  2: 'DROITE',
  3: 'FOND',
  4: 'JUGE',
};

export default function SetupPage() {
  const [slotNames, setSlotNames] = useState<Record<number, string>>(DEFAULT_NAMES);
  const [slots, setSlots] = useState<SlotState[] | null>(null);
  const [qrCodes, setQrCodes] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [lanPort, setLanPort] = useState<number | null>(null);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);

  const handleNameChange = (id: number, name: string) => {
    setSlotNames((prev) => ({ ...prev, [id]: name }));
  };

  const handleSetup = async () => {
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slots: slotNames }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Setup failed');
      setSlots(data.slots);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Fetch LAN IPs on mount
  useEffect(() => {
    fetch('/api/network')
      .then((r) => r.json())
      .then((data: { ips: string[]; port: number }) => {
        if (data.ips && data.ips.length > 0) {
          setLanIps(data.ips);
          setLanPort(data.port);
          const storedIp = localStorage.getItem('saber-var-selected-ip');
          if (storedIp && data.ips.includes(storedIp)) {
            setSelectedIp(storedIp);
          } else {
            setSelectedIp(data.ips[0]);
          }
        }
      })
      .catch(() => {
        // Fallback: no LAN info available (dev mode)
      });
  }, []);

  // Poll slots for real-time camera status
  useEffect(() => {
    const fetchSlots = () => {
      fetch('/api/slots')
        .then((r) => r.json())
        .then((data) => {
          if (data.slots && data.slots.length > 0) {
            setSlots(data.slots);
            const names: Record<number, string> = {};
            data.slots.forEach((s: SlotState) => {
              names[s.slotId] = s.name;
            });
            setSlotNames(names);
          }
        })
        .catch(() => {});
    };
    fetchSlots();
    const interval = setInterval(fetchSlots, 2000);
    return () => clearInterval(interval);
  }, []);

  // Compute base URL from LAN IP or fallback to window.location
  const baseUrl = selectedIp && lanPort
    ? `${window.location.protocol}//${selectedIp}:${lanPort}`
    : `${window.location.protocol}//${window.location.host}`;

  // Generate QR codes when slots are available or selected IP changes
  useEffect(() => {
    if (!slots) return;
    slots.forEach(async (slot) => {
      const url = `${baseUrl}/camera?slot=${slot.slotId}&token=${slot.token}`;
      const dataUrl = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: { dark: '#00d4ff', light: '#0a0a0f' },
      });
      setQrCodes((prev) => new Map(prev).set(slot.slotId, dataUrl));
    });
  }, [slots, baseUrl]);

  return (
    <div style={{ minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
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
            SABER VAR
          </h1>
          <a href="/settings" className="btn" style={{ textDecoration: 'none', fontSize: '0.85rem' }}>
            Paramètres
          </a>
          <a href="/guide" className="btn" style={{ textDecoration: 'none', fontSize: '0.85rem' }}>
            Guide
          </a>
        </div>
        <p className="text-muted" style={{ marginBottom: 16 }}>
          Configuration du système VAR — Saber Tour
        </p>

        {lanIps.length > 0 && (
          <div className="card" style={{ marginBottom: 24, padding: 16 }}>
            <div className="flex items-center gap-4" style={{ marginBottom: 8 }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Adresse réseau :
              </label>
              {lanIps.length > 1 ? (
                <select
                  className="input"
                  value={selectedIp || ''}
                  onChange={(e) => setSelectedIp(e.target.value)}
                  style={{ flex: 1, maxWidth: 300 }}
                >
                  {lanIps.map((ip) => (
                    <option key={ip} value={ip}>{ip}</option>
                  ))}
                </select>
              ) : (
                <span className="font-mono" style={{ color: 'var(--cyan)' }}>{lanIps[0]}</span>
              )}
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: '1.1rem',
                fontWeight: 700,
                color: 'var(--cyan)',
                padding: '8px 12px',
                background: 'rgba(0, 212, 255, 0.08)',
                borderRadius: 6,
                wordBreak: 'break-all',
              }}
            >
              {baseUrl}
            </div>
          </div>
        )}

        {!slots ? (
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Nommer les positions caméra
            </h2>
            <div className="flex flex-col gap-4">
              {[1, 2, 3, 4].map((id) => (
                <div key={id} className="flex items-center gap-4">
                  <span className="text-muted font-mono" style={{ width: 80 }}>
                    Slot {id}
                  </span>
                  <input
                    className="input"
                    value={slotNames[id] || ''}
                    onChange={(e) => handleNameChange(id, e.target.value.toUpperCase())}
                    placeholder={`Nom caméra ${id}`}
                    style={{ flex: 1 }}
                  />
                </div>
              ))}
            </div>
            {error && (
              <p className="text-red" style={{ marginTop: 12 }}>
                {error}
              </p>
            )}
            <button className="btn" style={{ marginTop: 24, width: '100%' }} onClick={handleSetup}>
              Configurer les slots
            </button>
          </div>
        ) : (
          <>
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="flex items-center gap-4" style={{ marginBottom: 16 }}>
                <h2 style={{ fontSize: '1.2rem', textTransform: 'uppercase', letterSpacing: '0.1em', flex: 1 }}>
                  QR Codes Caméras
                </h2>
                <a href="/arbitrage" className="btn" style={{ textDecoration: 'none' }}>
                  Ouvrir l'interface arbitre
                </a>
              </div>
              <p className="text-muted" style={{ marginBottom: 16 }}>
                Scanner depuis chaque téléphone pour connecter les caméras.
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 16,
                }}
              >
                {slots.map((slot) => (
                  <div
                    key={slot.slotId}
                    className="card"
                    style={{ textAlign: 'center', padding: 16 }}
                  >
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontWeight: 700,
                        fontSize: '1rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        color: 'var(--cyan)',
                        marginBottom: 8,
                      }}
                    >
                      {slot.name}
                    </div>
                    {qrCodes.get(slot.slotId) ? (
                      <img
                        src={qrCodes.get(slot.slotId)}
                        alt={`QR ${slot.name}`}
                        style={{ width: '100%', maxWidth: 200, margin: '0 auto', display: 'block' }}
                      />
                    ) : (
                      <div className="text-muted">Génération...</div>
                    )}
                    <div
                      className="text-muted font-mono"
                      style={{ fontSize: '0.7rem', marginTop: 8, wordBreak: 'break-all' }}
                    >
                      Slot {slot.slotId}
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        color: slot.cameraConnected ? 'var(--cyan)' : 'var(--text-dim)',
                      }}
                    >
                      {slot.cameraConnected ? '● EN DIRECT' : '○ En attente'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
                Instructions téléphones
              </h3>
              <ol className="text-muted" style={{ paddingLeft: 20, lineHeight: 1.8 }}>
                <li>Se connecter au WiFi du tournoi</li>
                <li>Scanner le QR code de la position assignée</li>
                <li>Appuyer "Avancé" → "Continuer" si avertissement de sécurité</li>
                <li>Autoriser l'accès à la caméra</li>
                <li>L'écran affiche "EN DIRECT" quand tout est bon</li>
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
