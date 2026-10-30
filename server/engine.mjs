import { parseMessage } from './protocol.mjs';

// Node is a C-ABI adapter only; C++ owns all simulation and combat rules.
export async function loadEngine(moduleFactory) {
  const factory = moduleFactory ?? (await import('../build/sim.mjs')).default;
  const module = await factory();
  const required = ['_room_create', '_room_destroy', '_room_join', '_room_leave', '_room_input', '_room_tick', '_room_snapshot', 'UTF8ToString'];
  if (!module || required.some(name => typeof module[name] !== 'function')) throw new Error('Invalid engine ABI');
  return function createRoom() {
    const pointer = module._room_create();
    if (!Number.isInteger(pointer) || pointer <= 0) throw new Error('Room allocation failed');
    let destroyed = false;
    function alive() { if (destroyed) throw new Error('Room destroyed'); }
    return {
      join() { alive(); return module._room_join(pointer); },
      leave(id) { alive(); module._room_leave(pointer, id); },
      input(id, value) {
        alive();
        const input = parseMessage(JSON.stringify(value));
        if (input.type !== 'input') throw new Error('Invalid input');
        return module._room_input(pointer, id, input.forward, input.strafe, input.yaw, input.pitch,
          Number(input.fire), Number(input.reload), Number(input.sprint), input.seq) === 1;
      },
      tick(dt) { alive(); module._room_tick(pointer, dt); },
      snapshot() { alive(); return JSON.parse(module.UTF8ToString(module._room_snapshot(pointer))); },
      destroy() { if (!destroyed) { destroyed = true; module._room_destroy(pointer); } },
    };
  };
}

export default loadEngine;
