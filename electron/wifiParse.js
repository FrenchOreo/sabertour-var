// Lecture des informations WiFi RÉELLES renvoyées par le système (pas d'estimation).
// macOS : `system_profiler SPAirPortDataType -json` (sans droits administrateur)
// Windows : `netsh wlan show interfaces` (anglais ou français)

function toNum(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** macOS → { interface, connected, ssid, channel, band, widthMHz, phyMode, rssiDbm, noiseDbm, snrDb, txRateMbps, mcs } | null */
function parseMacWifi(json) {
  let data = json;
  if (typeof json === 'string') {
    try { data = JSON.parse(json); } catch { return null; }
  }
  const root = data && Array.isArray(data.SPAirPortDataType) ? data.SPAirPortDataType[0] : null;
  const ifaces = root && Array.isArray(root.spairport_airport_interfaces) ? root.spairport_airport_interfaces : [];
  const iface = ifaces.find((i) => i && i.spairport_current_network_information) || ifaces[0];
  if (!iface) return null;
  const cur = iface.spairport_current_network_information;
  const out = {
    interface: iface._name || null,
    connected: !!cur,
    ssid: cur && cur._name ? String(cur._name) : null,
    channel: null,
    band: null,
    widthMHz: null,
    phyMode: cur && cur.spairport_network_phymode ? String(cur.spairport_network_phymode) : null,
    rssiDbm: null,
    noiseDbm: null,
    snrDb: null,
    txRateMbps: cur ? toNum(cur.spairport_network_rate) : null,
    mcs: cur ? toNum(cur.spairport_network_mcs) : null,
  };
  if (!cur) return out;
  // « 36 (5GHz, 80MHz) » ou « 6 (2GHz, 20MHz) »
  const ch = String(cur.spairport_network_channel || '');
  const m = ch.match(/^(\d+)(?:\s*\(([\d.]+)\s*GHz(?:,\s*(\d+)\s*MHz)?\))?/i);
  if (m) {
    out.channel = toNum(m[1]);
    if (m[2]) out.band = m[2].startsWith('2') ? '2,4 GHz' : m[2].startsWith('5') ? '5 GHz' : m[2].startsWith('6') ? '6 GHz' : `${m[2]} GHz`;
    if (m[3]) out.widthMHz = toNum(m[3]);
  }
  // « -55 dBm / -92 dBm »
  const sn = String(cur.spairport_signal_noise || '').match(/(-?\d+)\s*dBm\s*\/\s*(-?\d+)\s*dBm/i);
  if (sn) {
    out.rssiDbm = toNum(sn[1]);
    out.noiseDbm = toNum(sn[2]);
    out.snrDb = out.rssiDbm - out.noiseDbm;
  }
  return out;
}

/** Windows → même forme ; le signal est en % (pas de dBm chez netsh) */
function parseWindowsWifi(text) {
  if (!text || typeof text !== 'string') return null;
  const field = (...labels) => {
    for (const label of labels) {
      const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im');
      const m = text.match(re);
      if (m) return m[1].trim();
    }
    return null;
  };
  const state = field('State', 'État', 'Etat');
  if (!state) return null;
  const channel = toNum(field('Channel', 'Canal'));
  const signal = field('Signal');
  return {
    interface: field('Name', 'Nom'),
    connected: /connect/i.test(state) && !/disconnect|déconnect/i.test(state),
    ssid: field('SSID'),
    channel,
    band: field('Band', 'Bande') || (channel !== null ? (channel > 14 ? '5 GHz' : '2,4 GHz') : null),
    widthMHz: null,
    phyMode: field('Radio type', 'Type de radio'),
    rssiDbm: null,
    noiseDbm: null,
    snrDb: null,
    signalPct: signal ? toNum(signal.replace('%', '')) : null,
    txRateMbps: toNum(field('Transmit rate \\(Mbps\\)', 'Vitesse de transmission \\(Mbits/s\\)', 'Taux de transmission \\(Mbits/s\\)')),
    rxRateMbps: toNum(field('Receive rate \\(Mbps\\)', 'Vitesse de réception \\(Mbits/s\\)', 'Taux de réception \\(Mbits/s\\)')),
    mcs: null,
  };
}

module.exports = { parseMacWifi, parseWindowsWifi };
