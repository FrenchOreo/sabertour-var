import React, { useState, useEffect } from 'react';
import { SlotState } from 'shared/types';
import {
  getResolution, setResolution, RESOLUTION_OPTIONS,
  getBitrateLevel, setBitrateLevel, BITRATE_OPTIONS,
  getRecordingFormat, setRecordingFormat, FORMAT_OPTIONS,
  getBufferDurationSec, setBufferDurationSec, BUFFER_DURATION_OPTIONS,
  Resolution, BitrateLevel, RecordingFormat,
} from '../lib/qualitySettings';

const STORAGE_KEY = 'saber-var-selected-ip';

export default function SettingsPage() {
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [lanPort, setLanPort] = useState<number | null>(null);
  const [selectedIp, setSelectedIp] = useState<string>('');
  const [customIp, setCustomIp] = useState<string>('');
  const [useCustom, setUseCustom] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'loading' | 'success' | 'fail'>('idle');
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [saved, setSaved] = useState(false);
  const [resolution, setResolutionState] = useState<Resolution>(getResolution);
  const [bitrateLevel, setBitrateLevelState] = useState<BitrateLevel>(getBitrateLevel);
  const [recordingFormat, setRecordingFormatState] = useState<RecordingFormat>(getRecordingFormat);
  const [bufferDuration, setBufferDurationState] = useState<number>(getBufferDurationSec);
  const [qualitySaved, setQualitySaved] = useState(false);

  // Fetch network info on mount
  useEffect(() => {
    fetch('/api/network')
      .then((r) => r.json())
      .then((data: { ips: string[]; port: number }) => {
        if (data.ips && data.ips.length > 0) {
          setLanIps(data.ips);
          setLanPort(data.port);

          const storedIp = localStorage.getItem(STORAGE_KEY);
          if (storedIp && data.ips.includes(storedIp)) {
            setSelectedIp(storedIp);
          } else if (storedIp && !data.ips.includes(storedIp)) {
            // Stored IP is custom
            setCustomIp(storedIp);
            setUseCustom(true);
            setSelectedIp(data.ips[0]);
          } else {
            setSelectedIp(data.ips[0]);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Fetch slots
  useEffect(() => {
    fetch('/api/slots')
      .then((r) => r.json())
      .then((data) => {
        if (data.slots && data.slots.length > 0) {
          setSlots(data.slots);
        }
      })
      .catch(() => {});
  }, []);

  const activeIp = useCustom && customIp ? customIp : selectedIp;
  const fullUrl = activeIp && lanPort ? `https://${activeIp}:${lanPort}` : '';

  const handleTest = async () => {
    if (!fullUrl) return;
    setTestResult('loading');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      await fetch(`${fullUrl}/api/network`, { signal: controller.signal });
      clearTimeout(timeout);
      setTestResult('success');
    } catch {
      setTestResult('fail');
    }
  };

  const handleSave = () => {
    if (activeIp) {
      localStorage.setItem(STORAGE_KEY, activeIp);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div style={{ minHeight: '100vh', padding: 24 }}>
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
            Paramètres
          </h1>
          <a href="/setup" className="btn" style={{ textDecoration: 'none', fontSize: '0.85rem' }}>
            Retour
          </a>
        </div>
        <p className="text-muted" style={{ marginBottom: 24 }}>
          Configuration réseau et caméras
        </p>

        {/* Section: Réseau */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontSize: '1.2rem',
              marginBottom: 16,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            Réseau
          </h2>

          {/* Auto-detected IP */}
          {lanIps.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                <span style={{ color: '#22c55e', fontSize: '1.1rem' }}>&#10003;</span>
                <span className="text-muted" style={{ fontSize: '0.9rem' }}>
                  IP détectée automatiquement :
                </span>
                <span className="font-mono text-cyan" style={{ fontWeight: 600 }}>
                  {lanIps[0]}
                </span>
              </div>
            </div>
          )}

          {/* IP dropdown */}
          {lanIps.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <label
                className="text-muted"
                style={{
                  display: 'block',
                  fontSize: '0.85rem',
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Choisir une autre IP :
              </label>
              <select
                className="input"
                value={useCustom ? '' : selectedIp}
                onChange={(e) => {
                  setSelectedIp(e.target.value);
                  setUseCustom(false);
                  setTestResult('idle');
                }}
                style={{ maxWidth: 300 }}
                disabled={useCustom}
              >
                {lanIps.map((ip) => (
                  <option key={ip} value={ip}>
                    {ip}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Custom IP input */}
          <div style={{ marginBottom: 16 }}>
            <label
              className="text-muted"
              style={{
                display: 'block',
                fontSize: '0.85rem',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              IP personnalisée :
            </label>
            <div className="flex items-center gap-2">
              <input
                className="input"
                type="text"
                placeholder="ex: 192.168.1.100"
                value={customIp}
                onChange={(e) => {
                  setCustomIp(e.target.value);
                  setUseCustom(e.target.value.length > 0);
                  setTestResult('idle');
                }}
                style={{ maxWidth: 300 }}
              />
              {customIp && (
                <button
                  className="btn"
                  style={{ fontSize: '0.75rem', padding: '6px 12px' }}
                  onClick={() => {
                    setCustomIp('');
                    setUseCustom(false);
                    setTestResult('idle');
                  }}
                >
                  Effacer
                </button>
              )}
            </div>
          </div>

          {/* Port display */}
          <div style={{ marginBottom: 16 }}>
            <label
              className="text-muted"
              style={{
                display: 'block',
                fontSize: '0.85rem',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Port :
            </label>
            <span className="font-mono text-cyan">{lanPort ?? '...'}</span>
            <span className="text-muted" style={{ fontSize: '0.8rem', marginLeft: 8 }}>
              (lecture seule)
            </span>
          </div>

          {/* URL preview */}
          {fullUrl && (
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
                marginBottom: 16,
              }}
            >
              {fullUrl}
            </div>
          )}

          {/* Test + Save buttons */}
          <div className="flex items-center gap-4">
            <button className="btn" onClick={handleTest} disabled={!fullUrl}>
              Tester la connexion
            </button>
            <button className="btn" onClick={handleSave} disabled={!activeIp}>
              {saved ? 'Sauvegardé !' : 'Sauvegarder'}
            </button>
            {testResult === 'loading' && (
              <span className="text-muted" style={{ fontSize: '0.9rem' }}>
                Test en cours...
              </span>
            )}
            {testResult === 'success' && (
              <span style={{ color: '#22c55e', fontSize: '0.9rem', fontWeight: 600 }}>
                &#10003; Connexion réussie
              </span>
            )}
            {testResult === 'fail' && (
              <span className="text-red" style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                &#10007; Connexion échouée
              </span>
            )}
          </div>
        </div>

        {/* Section: Caméras */}
        <div className="card">
          <h2
            style={{
              fontSize: '1.2rem',
              marginBottom: 16,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            Caméras
          </h2>

          {slots.length > 0 ? (
            <>
              <div className="flex flex-col gap-2" style={{ marginBottom: 16 }}>
                {slots.map((slot) => (
                  <div key={slot.slotId} className="flex items-center gap-4">
                    <span className="text-muted font-mono" style={{ width: 80 }}>
                      Slot {slot.slotId}
                    </span>
                    <span className="text-cyan" style={{ fontWeight: 600 }}>
                      {slot.name}
                    </span>
                    <span
                      style={{
                        fontSize: '0.85rem',
                        color: slot.cameraConnected ? 'var(--cyan)' : 'var(--text-dim)',
                      }}
                    >
                      {slot.cameraConnected ? '● En direct' : '○ Déconnectée'}
                    </span>
                  </div>
                ))}
              </div>
              <a
                href="/setup"
                className="btn"
                style={{ textDecoration: 'none', display: 'inline-block' }}
              >
                Reconfigurer
              </a>
            </>
          ) : (
            <div>
              <p className="text-muted" style={{ marginBottom: 12 }}>
                Aucun slot configuré.
              </p>
              <a
                href="/setup"
                className="btn"
                style={{ textDecoration: 'none', display: 'inline-block' }}
              >
                Configurer
              </a>
            </div>
          )}
        </div>

        {/* Section: Qualité Vidéo */}
        <div className="card" style={{ marginTop: 24 }}>
          <h2
            style={{
              fontSize: '1.2rem',
              marginBottom: 16,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            Qualité Vidéo
          </h2>

          <div style={{ marginBottom: 16 }}>
            <label
              className="text-muted"
              style={{
                display: 'block',
                fontSize: '0.85rem',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Résolution caméra :
            </label>
            <select
              className="input"
              value={resolution}
              onChange={(e) => setResolutionState(e.target.value as Resolution)}
              style={{ maxWidth: 300 }}
            >
              {RESOLUTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              className="text-muted"
              style={{
                display: 'block',
                fontSize: '0.85rem',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Débit vidéo (bitrate) :
            </label>
            <select
              className="input"
              value={bitrateLevel}
              onChange={(e) => setBitrateLevelState(e.target.value as BitrateLevel)}
              style={{ maxWidth: 300 }}
            >
              {BITRATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              className="text-muted"
              style={{
                display: 'block',
                fontSize: '0.85rem',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Format d'enregistrement :
            </label>
            <select
              className="input"
              value={recordingFormat}
              onChange={(e) => setRecordingFormatState(e.target.value as RecordingFormat)}
              style={{ maxWidth: 300 }}
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
              MP4 par défaut. Le navigateur choisira un format supporté si MP4 n'est pas disponible.
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label
              className="text-muted"
              style={{
                display: 'block',
                fontSize: '0.85rem',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Durée du buffer VAR :
            </label>
            <select
              className="input"
              value={bufferDuration}
              onChange={(e) => setBufferDurationState(parseInt(e.target.value, 10))}
              style={{ maxWidth: 300 }}
            >
              {BUFFER_DURATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
              Durée maximale du replay VAR. Plus la durée est longue, plus la mémoire utilisée est grande.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <button
              className="btn"
              onClick={() => {
                setResolution(resolution);
                setBitrateLevel(bitrateLevel);
                setRecordingFormat(recordingFormat);
                setBufferDurationSec(bufferDuration);
                setQualitySaved(true);
                setTimeout(() => setQualitySaved(false), 2000);
              }}
            >
              {qualitySaved ? 'Sauvegardé !' : 'Sauvegarder'}
            </button>
          </div>

          <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: 12 }}>
            Les changements nécessitent de recharger la page caméra sur les téléphones.
          </p>
        </div>
      </div>
    </div>
  );
}
