// Tracks keyboard state — import and check keys.forward, keys.left, etc.
export const keys = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  up: false,
  down: false,
  sprint: false,
  debugMode: true, // start in debug/fly mode by default
};

function onKeyDown(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = true; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = true; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = true; break;
    case 'KeyD': case 'ArrowRight': keys.right = true; break;
    case 'Space':                   keys.jump = true; break;
    case 'KeyE':                    keys.up = true; break;
    case 'KeyQ':                    keys.down = true; break;
    case 'ShiftLeft': case 'ShiftRight': keys.sprint = true; break;
    case 'Backquote':               keys.debugMode = !keys.debugMode; break;
  }
}

function onKeyUp(e) {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward = false; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = false; break;
    case 'KeyA': case 'ArrowLeft':  keys.left = false; break;
    case 'KeyD': case 'ArrowRight': keys.right = false; break;
    case 'Space':                   keys.jump = false; break;
    case 'KeyE':                    keys.up = false; break;
    case 'KeyQ':                    keys.down = false; break;
    case 'ShiftLeft': case 'ShiftRight': keys.sprint = false; break;
  }
}

export function initInput() {
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
}
