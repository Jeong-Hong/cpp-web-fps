import { parseMessage } from './protocol.mjs';
import { DEFAULT_MAP, mapId } from '../web/maps.mjs';
import { DEFAULT_MODE, GUNFIGHT_MODE, TEAM_MODE } from '../web/modes.mjs';

// Node is a C-ABI adapter only; C++ owns all simulation and combat rules.
export async function loadEngine(moduleFactory) {
  const factory = moduleFactory ?? (await import('../build/sim.mjs')).default;
  const module = await factory();
  const required = ['_room_create', '_room_destroy', '_room_join', '_room_leave', '_room_input_v2', '_room_tick', '_room_snapshot', 'UTF8ToString'];
  if (!module || required.some(name => typeof module[name] !== 'function')) throw new Error('Invalid engine ABI');
  function mapAvailable(key) {
    const id = mapId(key);
    return id === 0 || (id > 0 && typeof module._room_create_for_map === 'function' &&
      module._room_map_available?.(id) === 1);
  }
  function createRoom(key = DEFAULT_MAP, mode = DEFAULT_MODE) {
    if (!mapAvailable(key)) throw new Error('Map is unavailable');
    let pointer;
    if (mode === TEAM_MODE) pointer = module._room_create_team_match(mapId(key));
    else if (mode === GUNFIGHT_MODE) pointer = module._room_create_gunfight(mapId(key));
    else if (mode === DEFAULT_MODE) pointer = key === DEFAULT_MAP ? module._room_create() : module._room_create_for_map(mapId(key));
    else throw new Error('Invalid game mode');
    if (!Number.isInteger(pointer) || pointer <= 0) throw new Error('Room allocation failed');
    let destroyed = false;
    function alive() { if (destroyed) throw new Error('Room destroyed'); }
    return {
      join() { alive(); return module._room_join(pointer); },
      rematch() { alive(); return module._room_rematch(pointer) === 1; },
      leave(id) { alive(); module._room_leave(pointer, id); },
      input(id, value) {
        alive();
        const input = parseMessage(JSON.stringify(value));
        if (input.type !== 'input') throw new Error('Invalid input');
        const args = [pointer, id, input.forward, input.strafe, input.yaw, input.pitch,
          Number(input.fire), Number(input.reload), Number(input.sprint), input.seq,
          Number(input.jump), Number(input.crouch), input.weapon, Number(input.grenade)];
        if (typeof module._room_input_v3 === 'function') return module._room_input_v3(...args, Number(input.prone ?? false)) === 1;
        return !input.prone && module._room_input_v2(...args) === 1;
      },
      tick(dt) { alive(); module._room_tick(pointer, dt); },
      snapshot() { alive(); return JSON.parse(module.UTF8ToString(module._room_snapshot(pointer))); },
      destroy() { if (!destroyed) { destroyed = true; module._room_destroy(pointer); } },
    };
  }
  return Object.assign(createRoom, { mapAvailable });
}

export default loadEngine;
