// Analyse des sorties WiFi du système (electron/wifiParse.js) — formats réels de macOS et Windows
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseMacWifi, parseWindowsWifi } = require('../../../electron/wifiParse');

describe('parseMacWifi', () => {
  const sample = {
    SPAirPortDataType: [
      {
        spairport_airport_interfaces: [
          {
            _name: 'en0',
            spairport_current_network_information: {
              _name: 'SABER-VAR-5G',
              spairport_network_channel: '36 (5GHz, 80MHz)',
              spairport_network_phymode: '802.11ac',
              spairport_network_rate: 866,
              spairport_network_mcs: 9,
              spairport_signal_noise: '-58 dBm / -92 dBm',
            },
          },
          { _name: 'awdl0' },
        ],
      },
    ],
  };

  it('reads channel, band, width, signal, noise and radio rate', () => {
    const w = parseMacWifi(JSON.stringify(sample));
    expect(w).toMatchObject({
      interface: 'en0', connected: true, ssid: 'SABER-VAR-5G', channel: 36, band: '5 GHz', widthMHz: 80,
      phyMode: '802.11ac', rssiDbm: -58, noiseDbm: -92, snrDb: 34, txRateMbps: 866, mcs: 9,
    });
  });

  it('reports a 2.4 GHz network and a disconnected interface', () => {
    const s2 = JSON.parse(JSON.stringify(sample));
    s2.SPAirPortDataType[0].spairport_airport_interfaces[0].spairport_current_network_information.spairport_network_channel = '6 (2GHz, 20MHz)';
    expect(parseMacWifi(s2).band).toBe('2,4 GHz');
    const off = { SPAirPortDataType: [{ spairport_airport_interfaces: [{ _name: 'en0' }] }] };
    expect(parseMacWifi(off)).toMatchObject({ interface: 'en0', connected: false, rssiDbm: null });
  });

  it('returns null on garbage', () => {
    expect(parseMacWifi('not json')).toBeNull();
    expect(parseMacWifi({})).toBeNull();
  });
});

describe('parseWindowsWifi', () => {
  it('parses English netsh output', () => {
    const txt = `
    Name                   : Wi-Fi
    State                  : connected
    SSID                   : SABER-VAR
    Radio type             : 802.11ac
    Channel                : 44
    Receive rate (Mbps)    : 585
    Transmit rate (Mbps)   : 433.3
    Signal                 : 87%
`;
    expect(parseWindowsWifi(txt)).toMatchObject({
      interface: 'Wi-Fi', connected: true, ssid: 'SABER-VAR', channel: 44, band: '5 GHz',
      phyMode: '802.11ac', signalPct: 87, txRateMbps: 433.3, rxRateMbps: 585,
    });
  });

  it('parses French netsh output', () => {
    const txt = `
    Nom                    : Wi-Fi
    État                   : connecté
    SSID                   : Gymnase
    Type de radio          : 802.11n
    Canal                  : 6
    Vitesse de réception (Mbits/s)  : 144
    Vitesse de transmission (Mbits/s) : 72
    Signal                 : 41%
`;
    expect(parseWindowsWifi(txt)).toMatchObject({ connected: true, channel: 6, band: '2,4 GHz', signalPct: 41, txRateMbps: 72, rxRateMbps: 144 });
  });

  it('returns null without an interface section', () => {
    expect(parseWindowsWifi('')).toBeNull();
    expect(parseWindowsWifi('There is no wireless interface on the system.')).toBeNull();
  });
});
