/**
 * @file MultiplayerClient.js
 * @description Real-time WebSocket multiplayer client synchronizing player avatars,
 * block edits, day/night time, and room chat with loop prevention and smooth interpolation.
 */

import * as THREE from 'three';
import { ENGINE_EVENTS } from '../core/EventBus.js';
import {
  MP_MESSAGES,
  decodePacket,
  encodePacket,
  normalizePlayerName,
  normalizeRoomId,
} from './MultiplayerProtocol.js';

/**
 * Manages client-side WebSocket connection, authoritative state sync, and 3D remote player avatars.
 */
export class MultiplayerClient {
  /**
   * @param {import('../world/WorldManager.js').WorldManager} worldManager
   */
  constructor(worldManager) {
    this.worldManager = worldManager;
    /** @type {WebSocket|null} */
    this.socket = null;
    /** @type {'disconnected'|'connecting'|'connected'} */
    this.status = 'disconnected';
    /** @type {string|null} */
    this.clientId = null;
    /** @type {string} */
    this.roomId = 'public-valley';
    /** @type {string} */
    this.playerName = 'Explorer';
    /** @type {string|null} */
    this.serverUrl = null;

    /** @type {Map<string, { id: string, name: string, color: number, x: number, y: number, z: number, yaw: number, pitch: number, targetX: number, targetY: number, targetZ: number, targetYaw: number, mesh: THREE.Group|null, walkPhase: number, limbs: THREE.Mesh[] }>} */
    this.remotePlayers = new Map();
    /** @type {Array<{ id: string, senderId: string, senderName: string, color: number, text: string, timestamp: number }>} */
    this.chatLog = [];

    /** @type {import('three').Scene|null} */
    this.scene = null;
    /** @type {boolean} Guards against re-broadcasting incoming remote block updates */
    this._applyingRemote = false;
    /** @type {number} */
    this._moveSendTimer = 0;
    /** @type {{ x: number, y: number, z: number, yaw: number, pitch: number }|null} */
    this._lastSentPose = null;
    /** @type {Array<{ x: number, y: number, z: number, blockId: number, fluidData: number }>} */
    this._pendingBlocks = [];
    /** @type {() => void|null} */
    this._unsubBlock = null;
    /** @type {number|null} */
    this._reconnectTimer = null;
    /** @type {boolean} */
    this._manualDisconnect = false;

    this._bindLocalWorldEdits();
  }

  /**
   * @private
   */
  _bindLocalWorldEdits() {
    this._unsubBlock = this.worldManager.world.onBlockChanged((ev) => {
      if (this._applyingRemote || this.status === 'disconnected') return;
      const fluidData = this.worldManager.world.getFluidLevel(ev.x, ev.y, ev.z);
      const packet = {
        x: ev.x,
        y: ev.y,
        z: ev.z,
        blockId: ev.blockId,
        fluidData,
      };
      if (this.status === 'connected' && this.socket?.readyState === 1) {
        this.socket.send(encodePacket(MP_MESSAGES.BLOCK_SET, packet));
      } else {
        this._pendingBlocks.push(packet);
      }
    });
  }

  /**
   * Attaches or detaches the Three.js Scene for remote player avatars.
   * @param {import('three').Scene|null} scene
   */
  attachScene(scene) {
    if (this.scene) {
      for (const peer of this.remotePlayers.values()) {
        if (peer.mesh) this.scene.remove(peer.mesh);
      }
    }
    this.scene = scene;
    if (this.scene) {
      for (const peer of this.remotePlayers.values()) {
        if (!peer.mesh) peer.mesh = this._buildAvatarMesh(peer.color);
        this.scene.add(peer.mesh);
      }
    }
  }

  /**
   * Resolves default browser WebSocket URL if none was supplied explicitly.
   * @returns {string}
   */
  static getDefaultWebSocketUrl() {
    if (typeof window === 'undefined') return 'ws://127.0.0.1:3000/ws';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  /**
   * Connects to the WebSocket room server.
   * @param {Object} [options]
   * @param {string} [options.roomId='public-valley']
   * @param {string} [options.playerName='Explorer']
   * @param {string} [options.url]
   * @param {any} [options.WebSocketImpl] - Optional WebSocket constructor override for Node tests.
   */
  connect({
    roomId = this.roomId,
    playerName = this.playerName,
    url = MultiplayerClient.getDefaultWebSocketUrl(),
    WebSocketImpl = undefined,
  } = {}) {
    this.disconnect();
    this._manualDisconnect = false;
    this.roomId = normalizeRoomId(roomId);
    this.playerName = normalizePlayerName(playerName);
    this.serverUrl = url;
    this.status = 'connecting';

    const WS = WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!WS) {
      this.status = 'disconnected';
      throw new Error('WebSocket implementation is unavailable in this runtime.');
    }

    const socket = new WS(url);
    this.socket = socket;

    const handleOpen = () => {
      if (this.socket !== socket) return;
      const pos = this.worldManager.player.getPosition();
      const rot = this.worldManager.player.getRotation();
      socket.send(
        encodePacket(MP_MESSAGES.JOIN_ROOM, {
          roomId: this.roomId,
          playerName: this.playerName,
          seed: this.worldManager.world.seed,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          yaw: rot.yaw,
          pitch: rot.pitch,
        })
      );
    };

    const handleMessage = (event) => {
      if (this.socket !== socket) return;
      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      const msg = decodePacket(raw);
      if (msg) this._handlePacket(msg);
    };

    const handleClose = () => {
      if (this.socket !== socket) return;
      this.status = 'disconnected';
      this.clientId = null;
      this._clearRemotePlayers();
      this.worldManager.bus.emit(ENGINE_EVENTS.MP_DISCONNECTED, {
        roomId: this.roomId,
      });

      if (!this._manualDisconnect && typeof setTimeout !== 'undefined') {
        this._reconnectTimer = /** @type {any} */ (
          setTimeout(() => {
            if (!this._manualDisconnect && this.serverUrl) {
              this.connect({
                roomId: this.roomId,
                playerName: this.playerName,
                url: this.serverUrl,
                WebSocketImpl,
              });
            }
          }, 2500)
        );
      }
    };

    if (typeof socket.addEventListener === 'function') {
      socket.addEventListener('open', handleOpen);
      socket.addEventListener('message', handleMessage);
      socket.addEventListener('close', handleClose);
    } else {
      socket.onopen = handleOpen;
      socket.onmessage = handleMessage;
      socket.onclose = handleClose;
    }
  }

  /**
   * Cleanly closes WebSocket connection and clears remote avatars.
   */
  disconnect() {
    this._manualDisconnect = true;
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.socket) {
      const sock = this.socket;
      this.socket = null;
      try {
        sock.close();
      } catch {
        // Ignore close errors on closed sockets
      }
    }
    this.status = 'disconnected';
    this.clientId = null;
    this._pendingBlocks = [];
    this._clearRemotePlayers();
    this.worldManager.bus.emit(ENGINE_EVENTS.MP_DISCONNECTED, { roomId: this.roomId });
  }

  /**
   * Sends a chat message to all peers in the active room.
   * @param {string} text
   * @returns {boolean}
   */
  sendChat(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || this.status !== 'connected' || !this.socket || this.socket.readyState !== 1) {
      return false;
    }
    this.socket.send(encodePacket(MP_MESSAGES.CHAT, { text: trimmed }));
    return true;
  }

  /**
   * Broadcasts local time-of-day updates to peers in the room.
   * @param {number} timeOfDay
   */
  broadcastTimeOfDay(timeOfDay) {
    if (this.status === 'connected' && this.socket?.readyState === 1) {
      this.socket.send(encodePacket(MP_MESSAGES.TIME_SET, { timeOfDay }));
    }
  }

  /**
   * Sends throttled player movement updates and smoothly interpolates remote avatars.
   * @param {number} deltaTime
   */
  update(deltaTime) {
    const dt = Math.min(Math.max(deltaTime, 0), 0.1);

    // 1. Broadcast local pose at ~18Hz when changed
    if (this.status === 'connected' && this.socket?.readyState === 1) {
      this._moveSendTimer += dt;
      if (this._moveSendTimer >= 0.055) {
        this._moveSendTimer = 0;
        const pos = this.worldManager.player.getPosition();
        const rot = this.worldManager.player.getRotation();
        const last = this._lastSentPose;
        const moved =
          !last ||
          Math.abs(pos.x - last.x) > 0.015 ||
          Math.abs(pos.y - last.y) > 0.015 ||
          Math.abs(pos.z - last.z) > 0.015 ||
          Math.abs(rot.yaw - last.yaw) > 0.015 ||
          Math.abs(rot.pitch - last.pitch) > 0.015;
        if (moved) {
          this._lastSentPose = { ...pos, ...rot };
          this.socket.send(
            encodePacket(MP_MESSAGES.PLAYER_MOVE, {
              x: Number(pos.x.toFixed(3)),
              y: Number(pos.y.toFixed(3)),
              z: Number(pos.z.toFixed(3)),
              yaw: Number(rot.yaw.toFixed(3)),
              pitch: Number(rot.pitch.toFixed(3)),
            })
          );
        }
      }
    }

    // 2. Smoothly interpolate remote avatars and animate walking gait
    const blend = Math.min(1, dt * 14);
    for (const peer of this.remotePlayers.values()) {
      const dx = peer.targetX - peer.x;
      const dy = peer.targetY - peer.y;
      const dz = peer.targetZ - peer.z;
      const stepDist = Math.hypot(dx, dz);

      peer.x += dx * blend;
      peer.y += dy * blend;
      peer.z += dz * blend;
      peer.yaw += (peer.targetYaw - peer.yaw) * blend;

      if (stepDist > 0.015) {
        peer.walkPhase += stepDist * 4.5 * blend;
      }

      if (peer.mesh) {
        peer.mesh.position.set(peer.x, peer.y, peer.z);
        peer.mesh.rotation.y = peer.yaw;
        const swing = Math.sin(peer.walkPhase) * 0.45;
        if (peer.limbs.length >= 4) {
          peer.limbs[0].rotation.x = swing;
          peer.limbs[1].rotation.x = -swing;
          peer.limbs[2].rotation.x = -swing;
          peer.limbs[3].rotation.x = swing;
        }
      }
    }
  }

  /** @private */
  _handlePacket(msg) {
    switch (msg.type) {
      case MP_MESSAGES.ROOM_STATE: {
        this.status = 'connected';
        this.clientId = msg.clientId;
        this.roomId = msg.roomId;

        // If joining an existing room with a different seed, sync local world to authoritative seed
        if (msg.seed !== undefined && String(msg.seed) !== String(this.worldManager.world.seed)) {
          const prevSeedNum = this.worldManager.world.seed;
          this.worldManager.initWorld(msg.seed, { x: 8, z: 8 });
          if (prevSeedNum !== this.worldManager.world.seed) {
            this.worldManager.bus.emit(ENGINE_EVENTS.WORLD_GENERATED, {
              seed: this.worldManager.world.seed,
              spawn: this.worldManager.player.getPosition(),
            });
          }
        }

        if (Number.isFinite(msg.timeOfDay)) {
          this.worldManager.setTimeOfDay(msg.timeOfDay);
        }

        // Apply all authoritative room block deltas cleanly without echoing back
        if (Array.isArray(msg.blocks) && msg.blocks.length > 0) {
          this._applyingRemote = true;
          try {
            for (const b of msg.blocks) {
              this.worldManager.world.setBlock(b.x, b.y, b.z, b.blockId, true, true);
            }
          } finally {
            this._applyingRemote = false;
          }
        }

        this._clearRemotePlayers();
        if (Array.isArray(msg.players)) {
          for (const p of msg.players) {
            this._upsertRemotePlayer(p);
          }
        }

        // Flush any queued offline edits
        while (this._pendingBlocks.length > 0 && this.socket?.readyState === 1) {
          const pkt = this._pendingBlocks.shift();
          this.socket.send(encodePacket(MP_MESSAGES.BLOCK_SET, pkt));
        }

        this.worldManager.bus.emit(ENGINE_EVENTS.MP_CONNECTED, {
          clientId: this.clientId,
          roomId: this.roomId,
          seed: msg.seed,
          peerCount: this.remotePlayers.size,
        });
        break;
      }

      case MP_MESSAGES.PLAYER_JOINED: {
        if (msg.player && msg.player.id !== this.clientId) {
          this._upsertRemotePlayer(msg.player);
          this.worldManager.bus.emit(ENGINE_EVENTS.MP_PLAYER_JOINED, msg.player);
        }
        break;
      }

      case MP_MESSAGES.PLAYER_LEFT: {
        if (msg.id) {
          const peer = this.remotePlayers.get(msg.id);
          if (peer) {
            if (this.scene && peer.mesh) this.scene.remove(peer.mesh);
            this._disposeAvatarMesh(peer.mesh);
            this.remotePlayers.delete(msg.id);
            this.worldManager.bus.emit(ENGINE_EVENTS.MP_PLAYER_LEFT, { id: msg.id, name: peer.name });
          }
        }
        break;
      }

      case MP_MESSAGES.PLAYER_MOVED: {
        const peer = this.remotePlayers.get(msg.id);
        if (peer) {
          peer.targetX = msg.x;
          peer.targetY = msg.y;
          peer.targetZ = msg.z;
          peer.targetYaw = msg.yaw;
        }
        break;
      }

      case MP_MESSAGES.BLOCK_UPDATED: {
        if (msg.authorId === this.clientId) return;
        this._applyingRemote = true;
        try {
          this.worldManager.world.setBlock(msg.x, msg.y, msg.z, msg.blockId, true, true);
        } finally {
          this._applyingRemote = false;
        }
        break;
      }

      case MP_MESSAGES.TIME_UPDATED: {
        if (msg.authorId === this.clientId) return;
        if (Number.isFinite(msg.timeOfDay)) {
          this.worldManager.setTimeOfDay(msg.timeOfDay);
        }
        break;
      }

      case MP_MESSAGES.CHAT_MESSAGE: {
        const entry = {
          id: msg.id || `${Date.now()}`,
          senderId: msg.senderId,
          senderName: msg.senderName,
          color: msg.color ?? 0x38bdf8,
          text: msg.text,
          timestamp: msg.timestamp ?? Date.now(),
        };
        this.chatLog = [...this.chatLog.slice(-49), entry];
        this.worldManager.bus.emit(ENGINE_EVENTS.MP_CHAT, entry);
        break;
      }
    }
  }

  /** @private */
  _upsertRemotePlayer(p) {
    if (!p || !p.id || p.id === this.clientId) return;
    const existing = this.remotePlayers.get(p.id);
    if (existing) {
      existing.targetX = p.x;
      existing.targetY = p.y;
      existing.targetZ = p.z;
      existing.targetYaw = p.yaw ?? 0;
      return;
    }

    const mesh = this.scene ? this._buildAvatarMesh(p.color ?? 0x38bdf8) : null;
    const limbs = mesh?.userData?.limbs ?? [];
    if (mesh) {
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = p.yaw ?? 0;
      this.scene.add(mesh);
    }

    this.remotePlayers.set(p.id, {
      id: p.id,
      name: p.name ?? 'Player',
      color: p.color ?? 0x38bdf8,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw ?? 0,
      pitch: p.pitch ?? 0,
      targetX: p.x,
      targetY: p.y,
      targetZ: p.z,
      targetYaw: p.yaw ?? 0,
      mesh,
      walkPhase: 0,
      limbs,
    });
  }

  /** @private */
  _buildAvatarMesh(shirtColorHex) {
    const group = new THREE.Group();
    const limbs = [];

    const addPart = (w, h, d, color, x, y, z) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      return m;
    };

    // Head + eyes facing -Z
    addPart(0.44, 0.44, 0.44, 0xe0b28c, 0, 1.56, 0);
    addPart(0.46, 0.14, 0.46, 0x3f2a1d, 0, 1.74, 0);
    addPart(0.08, 0.06, 0.04, 0x1e293b, -0.1, 1.58, -0.22);
    addPart(0.08, 0.06, 0.04, 0x1e293b, 0.1, 1.58, -0.22);

    // Torso
    addPart(0.48, 0.66, 0.24, shirtColorHex, 0, 1.0, 0);

    // Arms & Legs
    const leftArm = addPart(0.18, 0.64, 0.2, shirtColorHex, -0.34, 1.0, 0);
    const rightArm = addPart(0.18, 0.64, 0.2, shirtColorHex, 0.34, 1.0, 0);
    const leftLeg = addPart(0.2, 0.66, 0.22, 0x263259, -0.12, 0.33, 0);
    const rightLeg = addPart(0.2, 0.66, 0.22, 0x263259, 0.12, 0.33, 0);
    limbs.push(leftArm, rightArm, leftLeg, rightLeg);

    group.userData.limbs = limbs;
    return group;
  }

  /** @private */
  _disposeAvatarMesh(mesh) {
    if (!mesh) return;
    mesh.traverse((child) => {
      if (/** @type {any} */ (child).geometry) {
        /** @type {any} */ (child).geometry.dispose();
      }
      if (/** @type {any} */ (child).material) {
        /** @type {any} */ (child).material.dispose();
      }
    });
  }

  /** @private */
  _clearRemotePlayers() {
    for (const peer of this.remotePlayers.values()) {
      if (this.scene && peer.mesh) this.scene.remove(peer.mesh);
      this._disposeAvatarMesh(peer.mesh);
    }
    this.remotePlayers.clear();
  }

  /**
   * Returns snapshot of connected remote peers for HUD display.
   * @returns {Array<{ id: string, name: string, color: number, x: number, y: number, z: number }>}
   */
  getPeers() {
    return Array.from(this.remotePlayers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      x: Number(p.x.toFixed(1)),
      y: Number(p.y.toFixed(1)),
      z: Number(p.z.toFixed(1)),
    }));
  }

  dispose() {
    this.disconnect();
    if (this._unsubBlock) {
      this._unsubBlock();
      this._unsubBlock = null;
    }
    this.scene = null;
  }
}
