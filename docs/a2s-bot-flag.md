# How bots are marked in the A2S_PLAYER reply (ReHLDS + Steam)

Some server browsers tag bots in a server's player list even when the server
says it has no bots. They don't guess from names, times or scores: the reply
to the player-list query (A2S_PLAYER) carries a per-player flag. This note
explains where that flag comes from, what the bytes look like, and how YAQS
reads it (`src-tauri/src/a2s.rs`, `parse_players`).

## Who answers the query

On a Steam-enabled GoldSrc server (HLDS / ReHLDS), the engine does **not**
answer A2S_INFO, A2S_PLAYER or A2S_RULES itself. Every connectionless packet
is handed to Steam's game server library first, and the engine then ignores
the query types Steam owns:

- `engine/sv_main.cpp:3970`: each `0xFFFFFFFF` packet goes to
  `Steam_HandleIncomingPacket(...)`, which calls
  `SteamGameServer()->HandleIncomingPacket(...)` (`sv_steam3.cpp:926`).
- `engine/sv_main.cpp:3753`: in `SV_ConnectionlessPacket`, `A2S_INFO`,
  `A2S_PLAYER` and `A2S_RULES` just `return`.
- The engine's own `SVC_PlayerInfo` (`sv_main.cpp:3142`) is marked `NOXREF`:
  dead code, never called. It would write a 1-based counter as the index byte
  and no flag at all, which is **not** what servers actually send.

So the A2S_PLAYER reply is built by `steamclient` (closed source) from the
user list the engine feeds it.

## How the engine registers players with Steam

The engine tells Steam about each player in one of two ways:

| Who | How it is registered | Where |
|---|---|---|
| Real players | authenticated connection (`SendUserConnectAndAuthenticate`) | `sv_steam3.cpp` |
| **Bots** (`pfnCreateFakeClient`: YaPB, PODBot, etc.) | `CreateUnauthenticatedUserConnection()` | `pr_cmds.cpp:2028`, in `SV_CreateFakeClient` |
| **HLTV proxies** (`*hltv` in userinfo) | `CreateUnauthenticatedUserConnection()` via `Steam_NotifyBotConnect` | `sv_main.cpp:2512` → `sv_steam3.cpp:363` |

Then every frame the engine pushes each active client's name and frags with
`BUpdateUserData(steamid, name, frags)` (`sv_steam3.cpp:458`). That is the list
Steam answers A2S_PLAYER from.

Non-Steam players behind ReUnion are not flagged. On the Nostalgia servers,
where many players use non-Steam clients, ordinary players never carry the
flag. How ReUnion registers them with Steam wasn't checked.

## The packet

A2S_PLAYER request (after the usual challenge round trip):

```
FF FF FF FF 55 <challenge:4>        'U' + challenge
```

Reply:

```
FF FF FF FF 44                      'D' (S2A_PLAYER)
<count:u8>
repeated count times:
  <index:u8>                        <-- the interesting byte
  <name:cstring>
  <score:i32 LE>
  <duration:f32 LE>                 seconds connected
```

Valve's docs describe `index` as "index of player chunk starting from 0" and
most clients skip it. Steam's library actually writes it like this:

```
bit 7      (0x80)  set = unauthenticated user connection: bot or HLTV
bits 0..6  (0x7F)  position of the entry in the list, starting at 0
```

### Real capture

`45.235.98.52:27042` (NOSTALGIA CS MIRAGE), 2026-11-19. The server was filled
with YaPB bots and one human had just joined. A2S_INFO on the same server
reported `players=12, bots=0`.

```
ff ff ff ff 44 0c                                   'D', 12 players
80 4e 6f 73 74 61 6c 67 69 61 20 47 61 6d 65 72 73 00   idx 0x80 = pos 0 + BOT   "Nostalgia Gamers" (HLTV)
   00 00 00 00  67 a4 f0 47                              score 0, 123208.8 s (≈ server uptime)
81 6c 6f 62 6f 76 69 65 6a 6f 00                         idx 0x81 = pos 1 + BOT   "lobovieijo"
   00 00 00 00  d0 5a b5 45                              score 0, 5803.4 s
82 ... 8a                                                pos 2..10, all + BOT (YaPB bots)
0b 61 6e 64 72 65 63 6f 00                               idx 0x0b = pos 11, human  "andreco"
   00 00 00 00  3f 5b 88 42                              score 0, 68.2 s
```

| idx byte | position | flag | name |
|---|---|---|---|
| `80` | 0 | bot/HLTV | Nostalgia Gamers |
| `81` | 1 | bot | lobovieijo |
| `82`…`8a` | 2…10 | bot | (YaPB bots) |
| `0b` | 11 | – | andreco |

On a busy server most entries are plain `00, 01, 02…`, with only the HLTV and
any bots carrying `0x80`.

## Why not just trust A2S_INFO's `bots` count

ReHLDS does report a bot count to Steam: `SendUpdatedServerDetails` counts
`fakeclient` slots and calls `SetBotPlayerCount` (`sv_steam3.cpp:521-540`).
Even so, the Nostalgia servers answer A2S_INFO with `bots = 0` while the
player list flags 11 of 12 players. The cause isn't confirmed; it may be a
plugin or how Steam's GoldSrc reply fills that byte. Either way, the per-player
flag is the reliable source, so YAQS uses
`max(A2S_INFO bots, flagged players)`, capped at the player count.

## How YAQS reads it

`parse_players` in `src-tauri/src/a2s.rs`:

1. Read every entry, keeping its index byte.
2. Trust the flag only if **every** entry's low 7 bits equal its position
   (`(idx & 0x7F) == pos`) and there are at most 128 entries. This is the
   Steam library's layout. Other repliers are left alone:
   - Source engine (`srcds`) answers A2S_PLAYER itself and writes `0` for
     every index, so the check fails from the second entry on and nothing is
     flagged (with one player the byte is `0` anyway).
   - A custom server writing raw slot numbers (e.g. `5`, `130`) fails the
     check and isn't misread as bots.
3. If the layout matches, `bot = idx & 0x80 != 0`.

The poller (`src-tauri/src/poller.rs`) then raises `info.bots` to the flagged
count, so human counts in the table, window title, sidebar and history leave
bots out. The player list shows a **BOT** tag on flagged players.

## Limits

- **Bot vs HLTV:** both are unauthenticated connections, so the reply can't
  tell them apart. An HLTV proxy shows as BOT.
- **Undocumented:** the 0x80 flag and 0-based positions are observed behavior
  of Steam's library, not part of Valve's published A2S spec. If Steam
  changes it, the position check stops matching and YAQS falls back to no
  flags rather than wrong ones.
- **Source and other engines:** this only applies to servers whose queries
  Steam's library answers (GoldSrc, and some games that delegate queries to
  Steam). Source's own reply has no bot flag.
- **Truncated lists:** large replies can be cut off. The flag is still read
  for the entries that parsed, since the position check only looks at those.
