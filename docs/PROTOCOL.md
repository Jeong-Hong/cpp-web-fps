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
- idle → `{type:"create",name,map?,mode?}` or `{type:"join",name,code}`. Optional create map is one of crossyard, cachette, cafe, library, nyc, smuggler and defaults to crossyard. Mode is ffa (default), 2v2, or gunfight. The trimmed name contains 1–16 Unicode code points and excludes C0/C1 controls and unpaired surrogates. The room code contains exactly six uppercase hexadecimal digits.
- success → `{type:"welcome",room,id,map,mode,names}` then full state. All members inherit the room's map and mode. Four slots; fifth gets ROOM_FULL. Missing room gets ROOM_NOT_FOUND.
- Mode `2v2` is team deathmatch and `gunfight` is round-based. Free-for-all starts with one player. Both team modes require four players. Even slots are Blue and odd slots are Orange. Player snapshots add `team`. Team room snapshots add `teamScores`, `playing`, `phase` (waiting, countdown, live, finished), `remaining` (milliseconds), `target`, `winner` (-1 until finished), `round`, `roundResult` (-2 pending, -1 draw, or the winning team), and `deployment` (incremented when the roster redeploys). Friendly fire causes zero damage. Enemy kills score in team deathmatch, and round wins score in gunfight.
- A team room freezes when a member leaves. Gunfight restarts the interrupted round on refill and preserves completed round scores. An active member can send `{type:"rematch"}` once the match is finished and the room is full. The same membership and room code are retained.
- active → `{type:"input",seq,forward,strafe,yaw,pitch,fire,reload,sprint,jump,crouch,weapon,grenade,prone?}`. seq integer0..2147483647, strictly increasing per membership; forward/strafe finite[-1,1], yaw finite[-pi,pi], pitch finite[-1.45,1.45], exact booleans for all flags, weapon integer0(rifle) or1(pistol). Prone defaults to false and takes precedence over a simultaneous crouch request. Old valid seq ignored. Server time, never client dt, advances simulation.
- active → `{type:"leave"}` → left/idle; clears identity, controls and pending snapshots. Valid late input in idle is shape-validated then ignored. No stale controls survive rejoin.
- idle or active → `{type:"ping",stamp}` with safe integer stamp, response pong echoes only this allowed number.
- socket close/timeout → remove slot, destroy empty room. Idle handshake max10s, transport heartbeat30s. Server max16 rooms,64 sockets. Input/message rate limited.
- state → `{type:"state",room,names,time,players:[...],grenades:[...]}`. time milliseconds monotonic per room; players omit inactive slots. Player fields described by arena.hpp / C++ serializer: id,x,y,z,yaw,pitch,recoil,hp,ammo,kills,deaths,reload,respawn,shield,shot,shotWeapon,reloads,hit,damage,ack,trace[3],vy,grounded,crouch,prone,weapon,rifleAmmo,pistolAmmo,grenadeCount,equip. The server publishes `recoil` as an upward pitch offset in radians. `pitch` carries raw mouse aim, and the server and browser add recoil before clamping the effective aim. ammo means active magazine; grounded/crouch/prone are exact booleans for the actual player state. Root snapshots also carry grenades:[{id,owner,x,y,z,vx,vy,vz,fuse,explosion,exploding}], active flying/explosion entries only. Durations are remaining milliseconds. `shot`, `reloads`, `hit`, and `damage` are monotonic per-slot counters during that membership. `shotWeapon` gives the last fired weapon. `reloads` advances when the server refills a magazine.
- Node passes all flags to `room_input_v3`, which appends prone to the v2 ABI. The legacy native input functions default prone to false. Refresh the browser after updating the server and browser Wasm.
- Prone starts on the ground, limits movement to 1.25 m/s, and disables sprint and jumping. It uses a 0.58 m movement height, a 0.43 m eye height, and a 1.6 m yaw-aligned hitbox. Rising requires headroom for the requested stance.
- Jump and grenade requests, like reload, latch through a later false snapshot until one tick and consume once. Pistol fires on a fresh press edge, not held fire; rejected equip/reload/cooldown presses do not buffer. Actual stance/vertical state, selected weapon, magazine, grenade trajectory/fuse/cover/damage are server-authoritative. During a climb, the player snapshot adds `mantle` with elapsed seconds, flattened XYZ vectors for the start, landing, left grip, and right grip, then the approach distance in metres and a numeric sprint flag. The grip vectors are zero for climbs of 1.4 metres or less. See ACTIONS.md for exact physics/resource/lifecycle defaults.
- Player snapshots include `recoilHeld`, which is true while a rifle burst is eligible to continue. The browser retains the server's recoil offset between those shots and resumes decay when the flag clears.
- controls expire after250ms without fresh input; aim remains, held movement/fire stop. Reload is a one-shot request: a valid fresh true pulse remains pending until the next simulation tick even if a later input has reload false, then is consumed once. Duplicate/old inputs cannot enqueue it. Dead players accept validated sequence acknowledgements but cannot buffer movement, reload or fire through respawn.

## Simulation / rendering boundary
- Simulation60Hz, full snapshots20Hz, browser input30Hz plus immediate pistol press/release edges, all with increasing sequences and the existing rate guard. Full snapshots may be coalesced; welcome/error/left/pong may not.
- Each peer has a serialized reliable queue (bounded) and one latest-state mailbox. Shared tick never awaits a client's write. Excessive buffered bytes closes only that peer. Disconnect discards its mailbox.
- No rewind lag compensation; browser WebSocket uses reliable TCP. Client prediction/reconciliation is not authority.
- Browser receives snapshots through its platform adapter; C++ owns camera, local aim and collision prediction. GPU adapter only uploads C++ instance/matrix buffers and issues API draws.

## Error table
INVALID_MESSAGE/INVALID_NAME/INVALID_CODE/INVALID_MAP/INVALID_MODE/RATE_LIMIT: fixed error + close1008. ROOM_NOT_FOUND/ROOM_FULL/SERVER_FULL/MAP_UNAVAILABLE: fixed error and stay idle for retry. Wrong Origin/upgrade route: HTTP403/404. Unknown static path404, wrong method405. Oversize WS closes1009. Internal error500/1011 without raw exception. Connection loss must restore user controls and show retry guidance.

## Evidence
TDD and live tests must distinguish C++ rules, Node routing/sockets, local independent browsers and real separate devices. Input/camera tests cannot claim shot feedback until the real pixels are inspected.
