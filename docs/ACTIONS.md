# Movement, sidearm and grenade expansion

## Approval and boundary

The person approved implementing the proposed four additions, in order: jump/crouch → pistol → normal explosive grenade. Keys: Space, C, 1/2, G. Baseline: `b7b0c69c9ae61ee3e4fcafe000314178d4a9db0b`. Hermes remains the implementation owner. Existing map, maximum four members, server authority, native C++/Wasm logic, WebGPU/WebGL2 and local-only exposure stay unchanged. No external executor, dependency, account, public deployment, push or firewall change is needed.

The following are implementation defaults, not claims the person individually chose balance numbers. They are centralized and adjustable. Feature status starts **planned**, not executed.

## Movement contract

- Feet position is x/y/z in metres, y-up; floor plane y=0. Standing body height1.8, eye1.6, radius0.35. C toggles desired crouch: height1.1, eye0.95, speed2.5. Crouch suppresses sprint. Actual stance, not just camera appearance, controls hit and movement geometry.
- Gravity18m/s², initial jump velocity8m/s. A fresh Space edge is one jump request; only grounded players jump. Holding the key or sending duplicate packets cannot cause an extra/mid-air jump. Unsupported airborne requests are consumed, not buffered until landing.
- Shared `step_motion` handles vertical and horizontal movement, landing on solid tops, underside collision and falling off edges. Grounding is a physical support state; non-solid skyline/decorations remain non-colliding. A standing expansion under a low ceiling is refused; moving into clear space permits the outstanding stand request.
- Authoritative motion advances on server dt. Browser uses the same function for prediction. Snapshots contain vertical velocity, actual grounded/crouch state; both local camera and remote model use the actual body/eye heights.
- Death/respawn resets feet to the existing spawn, vertical velocity0, grounded/standing, no pending action. No new fall damage, climbing, double jump or changed map.

## Weapon contract

- weapon0=existing automatic rifle; weapon1=semi-automatic pistol. Keys1/2 request selection. A selection change takes0.20s and cancels the old reload. Switching cannot reset the shared fire cooldown or refill either magazine. Repeated same selection does not restart equip.
- Rifle remains magazine24/damage25/interval0.12s/reload1.5s. Pistol defaults: magazine12/damage34/minimum interval0.28s/reload1.2s. Reserve ammunition remains unlimited as before.
- `Player.ammo` retains the rifle magazine for existing C++ callers; `pistol_ammo` is separate. `active_ammo()` selects the current magazine. Network `ammo` means active magazine, and explicit rifleAmmo/pistolAmmo accompany it.
- Pistol fires on a fresh press edge, not while held. Valid fresh input rising edges latch until one tick; a later false packet cannot erase the press. The request is consumed even if equip/reload/cooldown rejects the shot; it cannot fire later unexpectedly. Duplicate/old sequences never enqueue actions.
- Shared cooldown, selected-weapon reload, hitscan, solid cover, shield, score and death rules remain server authoritative. Switching while a held fire button is down does not synthesize a pistol press.

## Grenade contract

- G sends one throw request. Two grenades per spawn, cooldown0.5s, no replenishment except respawn/new membership. No cooking or alternate grenade type.
- Throw origin comes from the authoritative player's eye. Direction is authoritative yaw/pitch; default speed12m/s plus an upward4m/s component. Never accept a client position, velocity, fuse, damage, owner or target.
- Radius0.12, gravity18m/s², fuse2.5s. Swept collision against ground and solid map geometry prevents tunneling; restitution0.45 and surface damping settle bouncing grenades. The near spawn path must also respect solids.
- Explosion radius6m. Damage is `ceil(100 * (1 - distance/6))` strictly inside the radius, zero at/outside6m, using each target body's centre. Solid line-of-sight cover blocks blast damage. Existing spawn shield blocks damage; throwing breaks the thrower's shield. Self damage is possible, but suicide adds no kill. Other kills count once for the still-active owner, including a grenade thrown before that owner's death.
- At most16 live grenade/effect slots per room. Reject a full-slot request without consuming inventory. Each grenade ID remains stable while flying/exploding. A visible explosion persists0.35s and then frees the slot.
- Leaving removes that owner's projectiles/effects before the slot can be reused, preventing cross-membership damage/credit. Death preserves already-thrown grenades but clears pending requests; respawn restores resources. No projectile waits on any peer's send.

## Version2 transport/ABI

Public callers remain untrusted WebSocket clients. Origin/Host checks, server-owned socket membership, exact JSON shape/types, size and rate bounds, monotonic sequence, late-idle validation/ignore and per-peer backpressure stay in place. There is no new authentication or storage boundary.

- New exact input fields: `{type,seq,forward,strafe,yaw,pitch,fire,reload,sprint,jump,crouch,weapon,grenade}`. Existing ranges unchanged. New flags are exact booleans, weapon is integer0 or1. Unknown/omitted fields and client position/HP/projectile data are refused before i32/f32 conversion with existing fixed errors and close1008.
- Old network clients must reload when upgrading; no mixed gameplay with invisible grenades. There is no deployed external consumer. Update the server parser, Node engine bridge, C++ input ABI, browser producer, socket fixtures and retained live probe together; restart only the owned local server after checking active users.
- Keep legacy C ABI `room_input(handle,slot,f,s,yaw,pitch,fire,reload,sprint,seq)` as a native test compatibility wrapper with standing/rifle/no-new-action defaults. New engine requires `room_input_v2(handle,slot,f,s,yaw,pitch,fire,reload,sprint,seq,jump,crouch,weapon,grenade)`. Validate integer flags before converting, including the legacy path. Never remove old refusal tests merely to make the new shape pass.
- Snapshot top-level: `{time,players,grenades}`. Player retains all old fields; adds `vy`, `grounded` boolean, `crouch` boolean, `weapon`, `rifleAmmo`, `pistolAmmo`, `grenadeCount`, `equip` (remaining ms). Existing `ammo` is active magazine.
- Grenade snapshot fields: `id,owner,x,y,z,vx,vy,vz,fuse,explosion,exploding`. Durations are remaining ms; positions/velocities finite, flags booleans. Only active grenade/effect entries are sent. Empty/null native snapshots also include `grenades:[]`.
- Jump/reload/throw and pistol press are one-shot requests latched only by fresh valid inputs and consumed once. Movement/fire/crouch/weapon selection are snapshots. Stale/dead/leave/rejoin paths cannot revive pending actions. Grenade motion/fuse continues when a player's held inputs expire.

## UI and implementation boundaries

Preserve DESIGN.md's industrial direction, tokens and existing layout. Add an unobtrusive weapon/inventory strip, selected state, active magazine/name, grenade count and actual stance; native menu/help explains all new keys. Remote models and hitboxes agree. Pistol silhouette and grenade flight/explosion are visible. Reduced-motion retains essential action feedback but no new camera shake. No new art/font/audio dependencies.

Files consumed by the change: include/arena.hpp; core/game.cpp/bridge.cpp; server/protocol.mjs/engine.mjs; client/main.cpp; web/app.mjs/index.html/style.css; existing Node and E2E input fixtures; scripts/live-smoke.mjs. Shared declarations freeze before split implementation ownership. Core lane owns core/*.cpp and tests/core_tests.cpp only; server lane owns named Node adapter/validator/tests/probe only; parent owns header, browser, UI, documents, integration, commits and closure.

## Acceptance and evidence (planned)

1. Real Wasm RED→GREEN for each motion/stance/weapon/grenade behavior, inclusive timer/range boundaries, duplicate/coalesced/dead input, shield/cover, no resource refill/negative inventory and leave/respawn cleanup; preserve existing rules.
2. Exact v2 validation and ABI argument tests, then real compiled-module socket proof. Fakes are only adapter/isolation evidence.
3. Actual browser Space/C/1/2/G plus existing WASD/mouse/R/Esc; authoritative state, visible model/stance/HUD and projectile/explosion screenshots in both motion settings and forced WebGL2. Public-protocol multiplayer observer agreement, not private state changes.
4. Current lobby/menu/HUD at1440/768/375, including all new Korean hints, loading/retry, no essential overlap. Touch and physical LAN remain outside this local evidence.
5. Full build/C++/Node/browser regression, independent bounded review, clean source provenance, per-step local commits and execution guidance. Old baseline receipts remain immutable historical evidence; new changes require new results.
