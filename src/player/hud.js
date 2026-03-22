const healthFill = document.getElementById('health-fill');
const waveDisplay = document.getElementById('wave-display');

let health = 100;
let maxHealth = 100;
let kills = 0;
let wave = 1;

export function setHealth(val) {
  health = Math.max(0, Math.min(maxHealth, val));
  healthFill.style.width = `${(health / maxHealth) * 100}%`;
  if (health > 60) healthFill.style.background = '#4f4';
  else if (health > 30) healthFill.style.background = '#ff4';
  else healthFill.style.background = '#f44';
}

export function getHealth() {
  return health;
}

export function damage(amount) {
  setHealth(health - amount);
  // Red flash
  document.getElementById('hud').style.boxShadow = 'inset 0 0 60px rgba(255,0,0,0.3)';
  setTimeout(() => {
    document.getElementById('hud').style.boxShadow = 'none';
  }, 150);
}

export function addKill() {
  kills++;
  updateWaveDisplay();
}

export function setWave(w) {
  wave = w;
  updateWaveDisplay();
}

export function getKills() {
  return kills;
}

function updateWaveDisplay() {
  waveDisplay.innerHTML = `<div>Wave: ${wave}</div><div>Kills: ${kills}</div>`;
}
