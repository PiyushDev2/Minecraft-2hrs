/**
 * @file server.ts
 * @description Full-stack Express + Vite (dev) / static (prod) HTTP server with
 * authoritative WebSocket multiplayer room synchronization on port 3000.
 */

import http from 'http';
import path from 'path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  MP_MESSAGES,
  PLAYER_AVATAR_COLORS,
  decodePacket,
  encodePacket,
  normalizePlayerName,
  normalizeRoomId,
} from './src/backend/network/MultiplayerProtocol.js';

interface RoomPlayer {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  sneaking?: boolean;
  swinging?: boolean;
  shielding?: boolean;
  heldItemId?: string | null;
  armorIds?: Record<string, string | null> | null;
  ridingBoat?: boolean;
}

interface BlockDelta {
  x: number;
  y: number;
  z: number;
  blockId: number;
  fluidData: number;
}

interface RoomState {
  roomId: string;
  seed: string | number;
  timeOfDay: number;
  players: Map<string, { socket: WebSocket; info: RoomPlayer }>;
  blocks: Map<string, BlockDelta>;
  colorSeq: number;
}

export interface VoxelServerHandle {
  server: http.Server;
  wss: WebSocketServer;
  port: number;
  rooms: Map<string, RoomState>;
  close: () => Promise<void>;
}

const MAX_ROOM_PLAYERS = 16;
const MAX_ROOM_BLOCKS = 20_000;
const WORLD_BORDER = 30_000_000;

function isWithinWorldBorder(value: unknown): value is number {
  return Number.isFinite(value) && Math.abs(value as number) <= WORLD_BORDER;
}

/**
 * Attaches the authoritative WebSocket multiplayer handler to an existing HTTP server.
 */
export function attachMultiplayerServer(server: http.Server): {
  wss: WebSocketServer;
  rooms: Map<string, RoomState>;
} {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  const rooms = new Map<string, RoomState>();
  let nextClientSeq = 1;

  const getOrCreateRoom = (roomId: string, seed: string | number = 'alpine-valley-2026'): RoomState => {
    let room = rooms.get(roomId);
    if (!room) {
      room = {
        roomId,
        seed,
        timeOfDay: 0.25,
        players: new Map(),
        blocks: new Map(),
        colorSeq: 0,
      };
      rooms.set(roomId, room);
    }
    return room;
  };

  const broadcastToRoom = (room: RoomState, payload: string, excludeId?: string) => {
    for (const [peerId, entry] of room.players.entries()) {
      if (peerId !== excludeId && entry.socket.readyState === WebSocket.OPEN) {
        entry.socket.send(payload);
      }
    }
  };

  wss.on('connection', (socket) => {
    const clientId = `p-${nextClientSeq++}`;
    let activeRoom: RoomState | null = null;
    const messageBuckets = new Map<string, { startedAt: number; count: number }>();
    const messageLimits: Record<string, [number, number]> = {
      [MP_MESSAGES.JOIN_ROOM]: [3, 10_000],
      [MP_MESSAGES.PLAYER_MOVE]: [30, 1_000],
      [MP_MESSAGES.BLOCK_SET]: [40, 1_000],
      [MP_MESSAGES.TIME_SET]: [2, 1_000],
      [MP_MESSAGES.CHAT]: [4, 5_000],
    };

    const allowRate = (key: string, limit: number, intervalMs: number) => {
      const now = Date.now();
      const bucket = messageBuckets.get(key);
      if (!bucket || now - bucket.startedAt >= intervalMs) {
        messageBuckets.set(key, { startedAt: now, count: 1 });
        return true;
      }
      if (bucket.count >= limit) return false;
      bucket.count += 1;
      return true;
    };

    const rejectJoin = (code: string, message: string) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(encodePacket(MP_MESSAGES.ERROR, { code, message }));
      socket.close(4003, code);
    };

    const leaveCurrentRoom = () => {
      if (!activeRoom) return;
      activeRoom.players.delete(clientId);
      broadcastToRoom(
        activeRoom,
        encodePacket(MP_MESSAGES.PLAYER_LEFT, { id: clientId }),
        clientId
      );
      if (activeRoom.players.size === 0 && activeRoom.blocks.size === 0) {
        rooms.delete(activeRoom.roomId);
      }
      activeRoom = null;
    };

    socket.on('message', (rawData) => {
      const msg = decodePacket(rawData.toString());
      if (!msg) return;

      const limit = messageLimits[msg.type];
      if (limit && !allowRate(msg.type, limit[0], limit[1])) return;

      switch (msg.type) {
        case MP_MESSAGES.PING: {
          socket.send(encodePacket(MP_MESSAGES.PONG, { ts: msg.ts ?? Date.now() }));
          break;
        }

        case MP_MESSAGES.JOIN_ROOM: {
          if (typeof msg.roomId !== 'string' || typeof msg.playerName !== 'string') {
            rejectJoin('INVALID_JOIN', 'Enter a room ID and player name to join.');
            return;
          }
          const rawRoomId = msg.roomId.trim();
          const rawPlayerName = msg.playerName.trim();
          if (!rawRoomId || rawRoomId.length > 32 || !/^[a-zA-Z0-9 _-]+$/.test(rawRoomId)) {
            rejectJoin('INVALID_ROOM', 'Room IDs must be 1–32 letters, numbers, spaces, dashes, or underscores.');
            return;
          }
          if (!rawPlayerName || rawPlayerName.length > 20 || !/^[a-zA-Z0-9 _-]+$/.test(rawPlayerName)) {
            rejectJoin('INVALID_NAME', 'Player names must be 1–20 letters, numbers, spaces, dashes, or underscores.');
            return;
          }
          if (
            msg.seed !== undefined &&
            !((typeof msg.seed === 'string' && msg.seed.length <= 64) ||
              (typeof msg.seed === 'number' && Number.isFinite(msg.seed)))
          ) {
            rejectJoin('INVALID_SEED', 'This world seed must be a short string or a finite number.');
            return;
          }

          const roomId = normalizeRoomId(rawRoomId);
          if (activeRoom?.roomId === roomId) return;
          const room = rooms.get(roomId);
          const playerName = normalizePlayerName(rawPlayerName);
          if (room && room.players.size >= MAX_ROOM_PLAYERS) {
            rejectJoin('ROOM_FULL', `This room is full (${MAX_ROOM_PLAYERS} players maximum).`);
            return;
          }
          if (room && Array.from(room.players.values()).some(
            (player) => player.info.name.toLowerCase() === playerName.toLowerCase()
          )) {
            rejectJoin('NAME_IN_USE', 'That player name is already being used in this room. Choose another name.');
            return;
          }

          leaveCurrentRoom();
          const seed = msg.seed ?? 'alpine-valley-2026';
          const joinedRoom = getOrCreateRoom(roomId, seed);
          activeRoom = joinedRoom;

          const color = PLAYER_AVATAR_COLORS[joinedRoom.colorSeq % PLAYER_AVATAR_COLORS.length];
          joinedRoom.colorSeq += 1;

          const info: RoomPlayer = {
            id: clientId,
            name: playerName,
            color,
            x: isWithinWorldBorder(msg.x) ? msg.x : 8.5,
            y: Number.isFinite(msg.y) && msg.y >= 0 && msg.y <= 256 ? msg.y : 42,
            z: isWithinWorldBorder(msg.z) ? msg.z : 8.5,
            yaw: Number.isFinite(msg.yaw) ? msg.yaw : 0,
            pitch: Number.isFinite(msg.pitch) && Math.abs(msg.pitch) <= Math.PI / 2 ? msg.pitch : 0,
          };

          const existingPlayers = Array.from(joinedRoom.players.values()).map((p) => p.info);
          joinedRoom.players.set(clientId, { socket, info });

          socket.send(
            encodePacket(MP_MESSAGES.ROOM_STATE, {
              clientId,
              roomId: joinedRoom.roomId,
              seed: joinedRoom.seed,
              timeOfDay: joinedRoom.timeOfDay,
              players: existingPlayers,
              blocks: Array.from(joinedRoom.blocks.values()),
            })
          );

          broadcastToRoom(
            joinedRoom,
            encodePacket(MP_MESSAGES.PLAYER_JOINED, { player: info }),
            clientId
          );
          break;
        }

        case MP_MESSAGES.PLAYER_MOVE: {
          if (!activeRoom) return;
          const entry = activeRoom.players.get(clientId);
          if (!entry) return;
          if (
            !isWithinWorldBorder(msg.x) ||
            !isWithinWorldBorder(msg.z) ||
            !Number.isFinite(msg.y) || msg.y < -64 || msg.y > 320 ||
            (msg.yaw !== undefined && !Number.isFinite(msg.yaw)) ||
            (msg.pitch !== undefined && (!Number.isFinite(msg.pitch) || Math.abs(msg.pitch) > Math.PI / 2))
          ) {
            return;
          }
          entry.info.x = msg.x;
          entry.info.y = msg.y;
          entry.info.z = msg.z;
          entry.info.yaw = Number.isFinite(msg.yaw) ? msg.yaw : entry.info.yaw;
          entry.info.pitch = Number.isFinite(msg.pitch) ? msg.pitch : entry.info.pitch;
          if (typeof msg.sneaking === 'boolean') entry.info.sneaking = msg.sneaking;
          if (typeof msg.swinging === 'boolean') entry.info.swinging = msg.swinging;
          if (typeof msg.shielding === 'boolean') entry.info.shielding = msg.shielding;
          if (msg.heldItemId === null || (typeof msg.heldItemId === 'string' && msg.heldItemId.length <= 64)) {
            entry.info.heldItemId = msg.heldItemId;
          }
          if (msg.armorIds === null) {
            entry.info.armorIds = null;
          } else if (msg.armorIds && typeof msg.armorIds === 'object' && !Array.isArray(msg.armorIds)) {
            const validSlots = ['helmet', 'chestplate', 'leggings', 'boots'];
            const armor: Record<string, string | null> = {};
            for (const slot of validSlots) {
              const itemId = msg.armorIds[slot];
              if (itemId === null || (typeof itemId === 'string' && itemId.length <= 64)) {
                armor[slot] = itemId;
              }
            }
            entry.info.armorIds = armor;
          }
          if (typeof msg.ridingBoat === 'boolean') entry.info.ridingBoat = msg.ridingBoat;

          broadcastToRoom(
            activeRoom,
            encodePacket(MP_MESSAGES.PLAYER_MOVED, {
              id: clientId,
              x: entry.info.x,
              y: entry.info.y,
              z: entry.info.z,
              yaw: entry.info.yaw,
              pitch: entry.info.pitch,
              sneaking: Boolean(entry.info.sneaking),
              swinging: Boolean(entry.info.swinging),
              shielding: Boolean(entry.info.shielding),
              heldItemId: entry.info.heldItemId ?? null,
              armorIds: entry.info.armorIds ?? null,
              ridingBoat: Boolean(entry.info.ridingBoat),
            }),
            clientId
          );
          break;
        }

        case MP_MESSAGES.BLOCK_SET: {
          if (!activeRoom) return;
          const { x, y, z, blockId } = msg;
          const fluidData = msg.fluidData === undefined ? 0 : msg.fluidData;
          if (
            !Number.isSafeInteger(x) || !isWithinWorldBorder(x) ||
            !Number.isSafeInteger(z) || !isWithinWorldBorder(z) ||
            !Number.isSafeInteger(y) || y < 0 || y >= 128 ||
            !Number.isSafeInteger(blockId) || blockId < 0 || blockId > 65_535 ||
            !Number.isSafeInteger(fluidData) || fluidData < 0 || fluidData > 8
          ) {
            return;
          }

          const blockKey = `${x},${y},${z}`;
          if (!activeRoom.blocks.has(blockKey) && activeRoom.blocks.size >= MAX_ROOM_BLOCKS) return;
          const delta: BlockDelta = { x, y, z, blockId, fluidData };
          activeRoom.blocks.set(blockKey, delta);

          broadcastToRoom(
            activeRoom,
            encodePacket(MP_MESSAGES.BLOCK_UPDATED, {
              ...delta,
              authorId: clientId,
            }),
            clientId
          );
          break;
        }

        case MP_MESSAGES.TIME_SET: {
          if (!activeRoom) return;
          const rawTod = msg.timeOfDay;
          if (typeof rawTod !== 'number' || !Number.isFinite(rawTod) || rawTod < 0 || rawTod > 1) return;
          activeRoom.timeOfDay = rawTod === 1 ? 0 : rawTod;
          broadcastToRoom(
            activeRoom,
            encodePacket(MP_MESSAGES.TIME_UPDATED, {
              timeOfDay: activeRoom.timeOfDay,
              authorId: clientId,
            }),
            clientId
          );
          break;
        }

        case MP_MESSAGES.CHAT: {
          if (!activeRoom) return;
          const entry = activeRoom.players.get(clientId);
          if (!entry) return;
          if (typeof msg.text !== 'string' || msg.text.length > 1_000) return;
          const text = msg.text.trim().slice(0, 180);
          if (!text || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return;

          const chatPayload = encodePacket(MP_MESSAGES.CHAT_MESSAGE, {
            id: `${clientId}-${Date.now()}`,
            senderId: clientId,
            senderName: entry.info.name,
            color: entry.info.color,
            text,
            timestamp: Date.now(),
          });

          for (const peer of activeRoom.players.values()) {
            if (peer.socket.readyState === WebSocket.OPEN) {
              peer.socket.send(chatPayload);
            }
          }
          break;
        }
      }
    });

    socket.on('close', leaveCurrentRoom);
    socket.on('error', leaveCurrentRoom);
  });

  return { wss, rooms };
}

/**
 * Starts the HTTP + WebSocket server (with Vite middleware in dev, static dist/ in prod).
 */
export async function createAppServer({
  port = Number(process.env.PORT) || 3000,
  enableVite = process.env.NODE_ENV !== 'production',
} = {}): Promise<VoxelServerHandle> {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const { wss, rooms } = attachMultiplayerServer(server);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      rooms: rooms.size,
      connections: wss.clients.size,
    });
  });

  let viteServer: { close: () => Promise<void> } | null = null;
  if (enableVite) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    viteServer = vite;
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  await new Promise<void>((resolve) => {
    server.listen(port, '0.0.0.0', () => resolve());
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;

  return {
    server,
    wss,
    port: actualPort,
    rooms,
    close: async () => {
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      if (viteServer) {
        await viteServer.close();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// Start immediately when executed directly as entrypoint
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith('server.ts');

if (isDirectRun) {
  createAppServer().then(({ port }) => {
    console.log(`VoxelCraft server listening on http://0.0.0.0:${port}`);
  });
}
