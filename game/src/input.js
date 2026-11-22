// Input: the held keys as a driving/walking axis, plus one-shot presses (interact,
// confirm, new game, pause) queued as flags and taken once by the loop, so a press
// between frames is never lost and never counted twice.

export const ACTION_ENTER = 1;
export const ACTION_CONFIRM = 2;
export const ACTION_NEW = 4;
export const ACTION_PAUSE = 8;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);

export function createInput(target) {
  const held = new Set();
  let actions = 0;

  window.addEventListener('keydown', (event) => {
    if (UP.has(event.code) || DOWN.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code)
      || event.code === 'ShiftLeft' || event.code === 'ShiftRight' || event.code === 'Space') {
      held.add(event.code);
      event.preventDefault();
    } else if (event.code === 'KeyF' || event.code === 'KeyE') {
      if (!event.repeat) actions |= ACTION_ENTER;
      event.preventDefault();
    } else if (event.code === 'Enter') {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (event.code === 'KeyN') {
      if (!event.repeat) actions |= ACTION_NEW;
    } else if (event.code === 'KeyP' || event.code === 'Escape') {
      if (!event.repeat) actions |= ACTION_PAUSE;
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => held.delete(event.code));
  window.addEventListener('blur', () => held.clear());
  target.addEventListener('pointerdown', () => { actions |= ACTION_CONFIRM; });

  const any = (set) => [...set].some((code) => held.has(code));

  return {
    /** The continuous control state the world consumes each step. */
    controls() {
      const left = any(LEFT) ? 1 : 0;
      const right = any(RIGHT) ? 1 : 0;
      const up = any(UP) ? 1 : 0;
      const down = any(DOWN) ? 1 : 0;
      return {
        moveX: right - left,
        moveY: down - up,
        steer: right - left,
        throttle: up - down,
        run: held.has('ShiftLeft') || held.has('ShiftRight'),
        brake: held.has('Space'),
        enter: false, // filled from takeActions by the loop
      };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
