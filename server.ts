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

/**
 * Attaches the authoritative WebSocket multiplayer handler to an existing HTTP server.
 */
export function attachMultiplayerServer(server: http.Server): {
  wss: WebSocketServer;
  rooms: Map<string, RoomState>;
} {
  const wss = new WebSocketServer({ server, path: '/ws' });
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

      switch (msg.type) {
        case MP_MESSAGES.PING: {
          socket.send(encodePacket(MP_MESSAGES.PONG, { ts: msg.ts ?? Date.now() }));
          break;
        }

        case MP_MESSAGES.JOIN_ROOM: {
          leaveCurrentRoom();
          const roomId = normalizeRoomId(msg.roomId);
          const seed = msg.seed ?? 'alpine-valley-2026';
          const room = getOrCreateRoom(roomId, seed);
          activeRoom = room;

          const color = PLAYER_AVATAR_COLORS[room.colorSeq % PLAYER_AVATAR_COLORS.length];
          room.colorSeq += 1;

          const info: RoomPlayer = {
            id: clientId,
            name: normalizePlayerName(msg.playerName),
            color,
            x: Number.isFinite(msg.x) ? msg.x : 8.5,
            y: Number.isFinite(msg.y) ? msg.y : 42,
            z: Number.isFinite(msg.z) ? msg.z : 8.5,
            yaw: Number.isFinite(msg.yaw) ? msg.yaw : 0,
            pitch: Number.isFinite(msg.pitch) ? msg.pitch : 0,
          };

          const existingPlayers = Array.from(room.players.values()).map((p) => p.info);
          room.players.set(clientId, { socket, info });

          socket.send(
            encodePacket(MP_MESSAGES.ROOM_STATE, {
              clientId,
              roomId: room.roomId,
              seed: room.seed,
              timeOfDay: room.timeOfDay,
              players: existingPlayers,
              blocks: Array.from(room.blocks.values()),
            })
          );

          broadcastToRoom(
            room,
            encodePacket(MP_MESSAGES.PLAYER_JOINED, { player: info }),
            clientId
          );
          break;
        }

        case MP_MESSAGES.PLAYER_MOVE: {
          if (!activeRoom) return;
          const entry = activeRoom.players.get(clientId);
          if (!entry) return;
          if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y) || !Number.isFinite(msg.z)) {
            return;
          }
          entry.info.x = msg.x;
          entry.info.y = msg.y;
          entry.info.z = msg.z;
          entry.info.yaw = Number.isFinite(msg.yaw) ? msg.yaw : entry.info.yaw;
          entry.info.pitch = Number.isFinite(msg.pitch) ? msg.pitch : entry.info.pitch;

          broadcastToRoom(
            activeRoom,
            encodePacket(MP_MESSAGES.PLAYER_MOVED, {
              id: clientId,
              x: entry.info.x,
              y: entry.info.y,
              z: entry.info.z,
              yaw: entry.info.yaw,
              pitch: entry.info.pitch,
            }),
            clientId
          );
          break;
        }

        case MP_MESSAGES.BLOCK_SET: {
          if (!activeRoom) return;
          const x = Math.floor(Number(msg.x));
          const y = Math.floor(Number(msg.y));
          const z = Math.floor(Number(msg.z));
          const blockId = Math.floor(Number(msg.blockId));
          const fluidData = Math.floor(Number(msg.fluidData) || 0);

          if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(z) ||
            y < 0 ||
            y >= 128 ||
            !Number.isFinite(blockId) ||
            blockId < 0
          ) {
            return;
          }

          const delta: BlockDelta = { x, y, z, blockId, fluidData };
          activeRoom.blocks.set(`${x},${y},${z}`, delta);

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
          const rawTod = Number(msg.timeOfDay);
          if (!Number.isFinite(rawTod)) return;
          activeRoom.timeOfDay = ((rawTod % 1) + 1) % 1;
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
          const text = String(msg.text || '').trim().slice(0, 180);
          if (!text) return;

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
