# Transport and C++ contract v2

## Ownership
Hermes builder owns implementation; a separately delegated reviewer may inspect, not silently ship. C++ `include/arena.hpp` is shared by the authoritative server Wasm and browser. Node only owns socket membership, names, serialization, timers and static delivery. No DB or credentials.

## HTTP / trust
- GET `/health`: public read, `{ok:true,engine:"C++/Wasm",rooms,clients,tickRate:60}`; no membership identity.
- GET `/` and allowlisted web assets: public read; path traversal, unknown files and methods rejected.
- WS `/ws`: same-origin Origin must equal request origin. No account authentication. A random six-hex room code is an invitation, not a password.
- The socket's room/id is server-owned. Clients can never specify authoritative player id, position, health, score, ammo, hit target or room internals.
- Default bind 127.0.0.1:8088. Non-loopback must be explicitly selected by the user after adapter discovery. No automatic firewall or global browser changes.

## Messages
All objects reject unknown fields; UTF-8 JSON <=1024 bytes. No arrays as top-level messages. Invalid messages return `{type:"error",code,message}` with fixed, non-reflected messages and close1008. Protocol text never logs raw messages or credentials.
- idle → `{type:"create",name}` or `{type:"join",name,code}`. Name: trimmed 1..16 Unicode code points; no C0/C1 controls/unpaired surrogates. Code: exact uppercase six hexadecimal digits after UI uppercasing; server does not repair malformed values.
- success → `{type:"welcome",room,id,names}` then full state. Active starts immediately, even with only one player. Four slots; fifth gets ROOM_FULL. Missing room gets ROOM_NOT_FOUND.
- active → `{type:"input",seq,forward,strafe,yaw,pitch,fire,reload,sprint,jump,crouch,weapon,grenade}`. seq integer0..2147483647, strictly increasing per membership; forward/strafe finite[-1,1], yaw finite[-pi,pi], pitch finite[-1.45,1.45], exact booleans for all flags, weapon integer0(rifle) or1(pistol). Old valid seq ignored. Server time, never client dt, advances simulation.
- active → `{type:"leave"}` → left/idle; clears identity, controls and pending snapshots. Valid late input in idle is shape-validated then ignored. No stale controls survive rejoin.
- idle or active → `{type:"ping",stamp}` with safe integer stamp, response pong echoes only this allowed number.
- socket close/timeout → remove slot, destroy empty room. Idle handshake max10s, transport heartbeat30s. Server max16 rooms,64 sockets. Input/message rate limited.
- state → `{type:"state",room,names,time,players:[...],grenades:[...]}`. time milliseconds monotonic per room; players omit inactive slots. Player fields described by arena.hpp / C++ serializer: id,x,y,z,yaw,pitch,hp,ammo,kills,deaths,reload,respawn,shield,shot,hit,damage,ack,trace[3],vy,grounded,crouch,weapon,rifleAmmo,pistolAmmo,grenadeCount,equip. ammo means active magazine; grounded/crouch are exact booleans. Root snapshots also carry grenades:[{id,owner,x,y,z,vx,vy,vz,fuse,explosion,exploding}], active flying/explosion entries only. Durations are remaining milliseconds. shot/hit/damage are monotonic per-slot counters during that membership.
- Version2 consumers: server/protocol.mjs, server/engine.mjs, core/bridge.cpp, client/main.cpp, web/app.mjs and retained socket fixtures/probe change together. Old network clients must refresh; omitted/new unknown fields are not silently normalized. The legacy native room_input remains only for C++ compatibility tests; Node requires room_input_v2 with old arguments through seq, then jump,crouch,weapon,grenade.
- Jump and grenade requests, like reload, latch through a later false snapshot until one tick and consume once. Pistol fires on a fresh press edge, not held fire; rejected equip/reload/cooldown presses do not buffer. Actual stance/vertical state, selected weapon, magazine, grenade trajectory/fuse/cover/damage are server-authoritative. See ACTIONS.md for exact physics/resource/lifecycle defaults.
- controls expire after250ms without fresh input; aim remains, held movement/fire stop. Reload is a one-shot request: a valid fresh true pulse remains pending until the next simulation tick even if a later input has reload false, then is consumed once. Duplicate/old inputs cannot enqueue it. Dead players accept validated sequence acknowledgements but cannot buffer movement, reload or fire through respawn.

## Simulation / rendering boundary
- Simulation60Hz, full snapshots20Hz, browser input30Hz plus immediate pistol press/release edges, all with increasing sequences and the existing rate guard. Full snapshots may be coalesced; welcome/error/left/pong may not.
- Each peer has a serialized reliable queue (bounded) and one latest-state mailbox. Shared tick never awaits a client's write. Excessive buffered bytes closes only that peer. Disconnect discards its mailbox.
- No rewind lag compensation; browser WebSocket uses reliable TCP. Client prediction/reconciliation is not authority.
- Browser receives snapshots through its platform adapter; C++ owns camera, local aim and collision prediction. GPU adapter only uploads C++ instance/matrix buffers and issues API draws.

## Error table
INVALID_MESSAGE/INVALID_NAME/INVALID_CODE/RATE_LIMIT: fixed error + close1008. ROOM_NOT_FOUND/ROOM_FULL/SERVER_FULL: fixed error and stay idle for retry. Wrong Origin/upgrade route: HTTP403/404. Unknown static path404, wrong method405. Oversize WS closes1009. Internal error500/1011 without raw exception. Connection loss must restore user controls and show retry guidance.

## Evidence
TDD and live tests must distinguish C++ rules, Node routing/sockets, local independent browsers and real separate devices. Input/camera tests cannot claim shot feedback until the real pixels are inspected.
