/* ============================================================
   Vending Machine Locator — app.js
   Stack: Leaflet.js + ESRI World Imagery (satellite, no API key)
   Storage: localStorage
   ============================================================ */

'use strict';

// ── Constants & State ─────────────────────────────────────────
const STORAGE_KEY = 'vml_machines_v1';

let map            = null;   // Leaflet map instance
let currentMarkers = [];     // Active Leaflet marker refs
let capturedLocation = null; // { lat, lng, accuracy }
let isLocating     = false;  // Guard against double-clicks

// ── localStorage Helpers ──────────────────────────────────────

function loadMachines() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveMachines(machines) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(machines));
}

/**
 * Persist a new vending machine entry.
 * @param {{ name: string, description: string, lat: number, lng: number, accuracy: number }} data
 * @returns {object} The saved machine record
 */
function addMachine(data) {
  const machines = loadMachines();
  const machine = {
    id:          Date.now().toString(),
    name:        data.name.trim(),
    description: data.description.trim(),
    lat:         data.lat,
    lng:         data.lng,
    accuracy:    data.accuracy,
    addedAt:     new Date().toISOString(),
  };
  machines.push(machine);
  saveMachines(machines);
  updateMachineCount();
  return machine;
}

function removeMachine(id) {
  // id is always a numeric timestamp string — no injection risk
  const machines = loadMachines().filter(m => m.id !== id);
  saveMachines(machines);
  updateMachineCount();
}

// ── XSS Guard ─────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Map ───────────────────────────────────────────────────────

function initMap() {
  map = L.map('map', {
    center: [20, 0],
    zoom:   2,
    // Improve tap behaviour on iOS
    tap:         true,
    tapTolerance: 15,
  });

  // ── Satellite base layer: ESRI World Imagery (free, no API key) ──
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution:
        'Imagery &copy; <a href="https://www.esri.com/">Esri</a> &mdash; ' +
        'Source: Esri, USGS, NOAA',
      maxZoom: 19,
    }
  ).addTo(map);

  // ── Hybrid labels overlay: ESRI World Boundaries & Places ──
  // Adds country/city names and major roads on top of satellite imagery
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: '',
      maxZoom:     19,
      opacity:     0.85,
    }
  ).addTo(map);

  refreshMapMarkers();
}

function createMachineIcon() {
  return L.divIcon({
    className:    'vm-marker-outer',
    html:         `<div class="vm-pin">
                     <div class="vm-pin-circle">🥤</div>
                     <div class="vm-pin-stem"></div>
                   </div>`,
    iconSize:     [38, 50],
    iconAnchor:   [19, 50],   // bottom-centre of stem
    popupAnchor:  [0,  -52],  // popup appears above the circle
  });
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function buildPopupHtml(machine) {
  // machine.id is Date.now().toString() — digits only, safe in onclick
  const name = escapeHtml(machine.name);
  const desc = machine.description ? escapeHtml(machine.description) : '';
  const lat  = machine.lat.toFixed(5);
  const lng  = machine.lng.toFixed(5);
  const acc  = machine.accuracy ? `±${Math.round(machine.accuracy)} m &nbsp;|&nbsp; ` : '';
  const date = escapeHtml(formatDate(machine.addedAt));

  return `
    <div class="popup-card">
      <div class="popup-title">${name}</div>
      ${desc ? `<div class="popup-desc">${desc}</div>` : ''}
      <div class="popup-meta">
        📍&nbsp;${lat},&nbsp;${lng}<br>
        ${acc}📅&nbsp;${date}
      </div>
      <button class="popup-delete-btn"
              onclick="confirmDeleteMachine('${machine.id}')">
        🗑&nbsp; Remove Machine
      </button>
    </div>`;
}

function refreshMapMarkers() {
  if (!map) return;

  // Remove all existing markers
  currentMarkers.forEach(m => m.remove());
  currentMarkers = [];

  const machines  = loadMachines();
  const emptyEl   = document.getElementById('map-empty');

  if (machines.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');

  const icon   = createMachineIcon();
  const bounds = [];

  machines.forEach(machine => {
    const marker = L.marker([machine.lat, machine.lng], { icon });
    marker.bindPopup(buildPopupHtml(machine), {
      maxWidth:     280,
      closeButton:  true,
    });
    marker.addTo(map);
    currentMarkers.push(marker);
    bounds.push([machine.lat, machine.lng]);
  });

  // Fit map to encompass all markers
  if (bounds.length === 1) {
    map.setView(bounds[0], 17);
  } else {
    map.fitBounds(bounds, { padding: [48, 48] });
  }
}

// Called from popup button — id is always a digit-only string
function confirmDeleteMachine(id) {
  if (confirm('Remove this vending machine from the list?')) {
    removeMachine(id);
    refreshMapMarkers();
    map.closePopup();
  }
}

// ── Geolocation ───────────────────────────────────────────────

function captureLocation() {
  if (isLocating) return;

  if (!navigator.geolocation) {
    setLocationError('Geolocation is not supported by your browser.');
    return;
  }

  isLocating = true;

  const btn = document.getElementById('get-location-btn');
  btn.innerHTML = '<span class="loading-spinner"></span>&nbsp; Getting location…';
  btn.disabled  = true;

  clearLocationError();

  navigator.geolocation.getCurrentPosition(
    // ── Success ──
    (position) => {
      isLocating = false;

      capturedLocation = {
        lat:      position.coords.latitude,
        lng:      position.coords.longitude,
        accuracy: position.coords.accuracy,
      };

      // Update UI
      document.getElementById('coord-lat').textContent =
        capturedLocation.lat.toFixed(6);
      document.getElementById('coord-lng').textContent =
        capturedLocation.lng.toFixed(6);
      document.getElementById('coord-accuracy').textContent =
        `±${Math.round(capturedLocation.accuracy)} m accuracy`;

      document.getElementById('location-placeholder').classList.add('hidden');
      document.getElementById('location-result').classList.remove('hidden');
      document.getElementById('location-box').classList.add('has-location');

      btn.innerHTML = '<span class="btn-icon">✅</span> Location Captured';
      btn.disabled  = false;

      // Enable save button
      document.getElementById('save-btn').disabled = false;
    },

    // ── Error ──
    (err) => {
      isLocating = false;
      btn.innerHTML = '<span class="btn-icon">📡</span> Use My Location';
      btn.disabled  = false;

      let msg = 'Could not get your location. Please try again.';
      if (err.code === err.PERMISSION_DENIED) {
        msg = 'Location permission denied. Please allow location access in your browser settings and try again.';
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        msg = 'Location information is unavailable. Please try again.';
      } else if (err.code === err.TIMEOUT) {
        msg = 'Location request timed out. Please try again.';
      }
      setLocationError(msg);
    },

    {
      enableHighAccuracy: true,
      timeout:            15000,
      maximumAge:         0,
    }
  );
}

function setLocationError(msg) {
  document.getElementById('location-error').textContent = msg;
}

function clearLocationError() {
  document.getElementById('location-error').textContent = '';
}

// ── Form Submission ───────────────────────────────────────────

document.getElementById('add-form').addEventListener('submit', (e) => {
  e.preventDefault();

  const nameInput = document.getElementById('machine-name');
  const name      = nameInput.value.trim();
  const desc      = document.getElementById('machine-desc').value.trim();

  let valid = true;

  if (!name) {
    document.getElementById('name-error').textContent = 'Machine name is required.';
    nameInput.focus();
    valid = false;
  } else {
    document.getElementById('name-error').textContent = '';
  }

  if (!capturedLocation) {
    setLocationError('Please capture your location before saving.');
    valid = false;
  } else {
    clearLocationError();
  }

  if (!valid) return;

  addMachine({
    name,
    description: desc,
    lat:         capturedLocation.lat,
    lng:         capturedLocation.lng,
    accuracy:    capturedLocation.accuracy,
  });

  // Show success state
  document.getElementById('add-form').classList.add('hidden');
  document.getElementById('success-message').classList.remove('hidden');
});

// ── View Navigation ───────────────────────────────────────────

function showView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(`${viewName}-view`).classList.add('active');
  document.getElementById(`nav-${viewName}`).classList.add('active');

  if (viewName === 'map') {
    // Leaflet must recalculate size after the view becomes visible
    setTimeout(() => {
      if (map) {
        map.invalidateSize();
        refreshMapMarkers();
      }
    }, 60);
  }

  if (viewName === 'add') {
    resetAddForm();
  }
}

function resetAddForm() {
  document.getElementById('add-form').reset();
  document.getElementById('add-form').classList.remove('hidden');
  document.getElementById('success-message').classList.add('hidden');

  capturedLocation = null;
  isLocating       = false;

  document.getElementById('location-placeholder').classList.remove('hidden');
  document.getElementById('location-result').classList.add('hidden');
  document.getElementById('location-box').classList.remove('has-location');
  document.getElementById('save-btn').disabled = true;

  document.getElementById('name-error').textContent     = '';
  document.getElementById('location-error').textContent = '';

  document.getElementById('get-location-btn').innerHTML =
    '<span class="btn-icon">📡</span> Use My Location';
  document.getElementById('get-location-btn').disabled = false;
}

function resetAndAddAnother() {
  resetAddForm();
}

// ── UI Helpers ────────────────────────────────────────────────

function updateMachineCount() {
  document.getElementById('machine-count').textContent =
    loadMachines().length;
}

// ── Bootstrap ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  updateMachineCount();
});
