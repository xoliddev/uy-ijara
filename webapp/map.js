// Leaflet wrapper: OpenStreetMap tiles and price pins coloured by the fair-price verdict
// (green = Arzon, blue = Adolatli, red = Qimmat, grey = not enough data). Leaflet 1.9.4 is vendored in ./vendor/leaflet.
// Pins sit at an approximate, district-level point: the exact building is never on the public map.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TASHKENT = [41.3111, 69.2797];

export function createMap(el, { attribution, onPick, zoom = 12, interactive = true }) {
  const L = window.L;
  const map = L.map(el, { zoomControl: false, attributionControl: true, tapTolerance: 20, dragging: interactive,
    scrollWheelZoom: interactive, doubleClickZoom: interactive, touchZoom: interactive }).setView(TASHKENT, zoom);
  L.tileLayer(TILES, { maxZoom: 18, minZoom: 10, attribution, crossOrigin: true }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  if (interactive) L.control.zoom({ position: 'bottomright' }).addTo(map);
  const pins = L.layerGroup().addTo(map);
  const byId = new Map();
  let area = null;

  /** items: [{id, lat, lon, label, verdict, title, active}] */
  function setPins(items) {
    pins.clearLayers();
    byId.clear();
    for (const it of items) {
      const cls = `ui-pin is-${it.verdict}${it.active ? ' is-active' : ''}`;
      const marker = L.marker([it.lat, it.lon], {
        icon: L.divIcon({ className: cls, html: `<span>${it.label}</span>`, iconSize: null, iconAnchor: [0, 0] }),
        zIndexOffset: it.active ? 900 : it.verdict === 'cheap' ? 300 : 0, riseOnHover: true, title: it.title, keyboard: false,
      });
      marker.on('click', () => onPick?.(it.id));
      marker.addTo(pins);
      marker.getElement()?.setAttribute('data-lid', String(it.id));
      byId.set(it.id, marker);
    }
    const pts = items.map((i) => [i.lat, i.lon]);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 14, animate: false });
    else if (pts.length === 1) map.setView(pts[0], 14, { animate: false });
  }

  /** The district-level circle on a listing's own map. */
  function setArea(lat, lon, verdict) {
    area?.remove();
    area = L.circle([lat, lon], { radius: 1300, className: `ui-area is-${verdict}`, interactive: false }).addTo(map);
    map.setView([lat, lon], 13, { animate: false });
  }

  return {
    setPins, setArea,
    focus: (id) => { const m = byId.get(id); if (m) map.panTo(m.getLatLng(), { animate: true }); },
    invalidate: () => map.invalidateSize({ animate: false }),
    destroy: () => map.remove(),
  };
}
