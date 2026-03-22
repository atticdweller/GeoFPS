import { renderer, scene, camera, clock } from './scene.js';

const updateCallbacks = [];

/** Register a function to be called every frame with (deltaTime) */
export function onUpdate(fn) {
  updateCallbacks.push(fn);
}

/** Start the game loop */
export function startLoop() {
  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05); // cap delta to avoid spiral of death

    for (const fn of updateCallbacks) {
      try {
        fn(dt);
      } catch (e) {
        console.error('Update error:', e);
      }
    }

    renderer.render(scene, camera);
  }

  tick();
}
