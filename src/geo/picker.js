import L from 'leaflet';

const DEFAULT_LAT = 40.6370;
const DEFAULT_LNG = -73.9474;
const DEFAULT_ZOOM = 16;

/**
 * Show the Leaflet map picker. Returns a Promise that resolves with { lat, lng }
 * when the user confirms a location.
 */
export function showPicker() {
  return new Promise((resolve) => {
    const container = document.getElementById('picker');
    container.style.display = 'flex';

    const map = L.map('picker-map').setView([DEFAULT_LAT, DEFAULT_LNG], DEFAULT_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    let marker = null;
    const startBtn = document.getElementById('picker-start');
    startBtn.disabled = true;

    // Place marker on click
    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      if (marker) {
        marker.setLatLng([lat, lng]);
      } else {
        marker = L.marker([lat, lng], { draggable: true }).addTo(map);
        marker.on('dragend', () => {
          // marker position updated automatically
        });
      }
      startBtn.disabled = false;
    });

    // Place default marker
    marker = L.marker([DEFAULT_LAT, DEFAULT_LNG], { draggable: true }).addTo(map);
    startBtn.disabled = false;

    startBtn.addEventListener('click', () => {
      const pos = marker.getLatLng();
      map.remove();
      container.style.display = 'none';
      resolve({ lat: pos.lat, lng: pos.lng });
    });
  });
}
