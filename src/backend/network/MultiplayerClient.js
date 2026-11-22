/**
 * @file MultiplayerClient.js
 * @description Real-time WebSocket multiplayer client synchronizing player avatars,
 * block edits, day/night time, and room chat with loop prevention and smooth interpolation.
 */

import * as THREE from 'three';
import { PlayerAvatar } from '../../game/PlayerAvatar.js';
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
    /** @type {number} */
    this._reconnectAttempts = 0;
    /** @type {number} */
    this._maxReconnectAttempts = 3;

    this._bindLocalWorldEdits();
  }

  /**
   * Convenience boolean getter indicating whether the room WebSocket is connected.
   * @returns {boolean}
   */
  get connected() {
    return this.status === 'connected';
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
        if (peer.avatar?.root) this.scene.remove(peer.avatar.root);
      }
    }
    this.scene = scene;
    if (this.scene) {
      for (const peer of this.remotePlayers.values()) {
        if (!peer.avatar) {
          peer.avatar = new PlayerAvatar({ shirtColor: peer.color, name: peer.name });
          peer.avatar.setArmor(peer.armorIds);
          peer.avatar.setHeldItem(peer.heldItemId, this.worldManager.itemRegistry);
          peer.mesh = peer.avatar.root;
        }
        this.scene.add(peer.avatar.root);
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
    isReconnect = false,
  } = {}) {
    this.disconnect();
    this._manualDisconnect = false;
    if (!isReconnect) {
      this._reconnectAttempts = 0;
    }
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
      this._reconnectAttempts = 0;
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

    const handleError = () => {
      // Handled gracefully alongside close event to prevent unhandled socket errors
      if (this.socket !== socket) return;
    };

    const handleClose = () => {
      if (this.socket !== socket) return;
      this.status = 'disconnected';
      this.clientId = null;
      this._clearRemotePlayers();
      this.worldManager.bus.emit(ENGINE_EVENTS.MP_DISCONNECTED, {
        roomId: this.roomId,
      });

      if (
        !this._manualDisconnect &&
        this._reconnectAttempts < this._maxReconnectAttempts &&
        typeof setTimeout !== 'undefined'
      ) {
        this._reconnectAttempts += 1;
        const delayMs = 2500 * this._reconnectAttempts;
        this._reconnectTimer = /** @type {any} */ (
          setTimeout(() => {
            if (!this._manualDisconnect && this.serverUrl) {
              this.connect({
                roomId: this.roomId,
                playerName: this.playerName,
                url: this.serverUrl,
                WebSocketImpl,
                isReconnect: true,
              });
            }
          }, delayMs)
        );
      }
    };

    if (typeof socket.addEventListener === 'function') {
      socket.addEventListener('open', handleOpen);
      socket.addEventListener('message', handleMessage);
      socket.addEventListener('error', handleError);
      socket.addEventListener('close', handleClose);
    } else {
      socket.onopen = handleOpen;
      socket.onmessage = handleMessage;
      socket.onerror = handleError;
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

    // 1. Broadcast local pose & avatar state at ~18Hz when changed
    if (this.status === 'connected' && this.socket?.readyState === 1) {
      this._moveSendTimer += dt;
      if (this._moveSendTimer >= 0.055) {
        this._moveSendTimer = 0;
        const pos = this.worldManager.player.getPosition();
        const rot = this.worldManager.player.getRotation();
        const sneaking = Boolean(this.worldManager.player.inputState?.sneak);
        const shielding = Boolean(this.worldManager.survival?.shieldBlocking);
        const heldItemId = this.worldManager.inventory?.getSelectedStack()?.itemId ?? null;
        const armorIds = this.worldManager.inventory?.getArmorIds?.() ?? null;
        const ridingBoat = Boolean(this.worldManager.entities?.getMountedBoat?.());
        const armorSig = armorIds
          ? `${armorIds.helmet || ''}|${armorIds.chestplate || ''}|${armorIds.leggings || ''}|${armorIds.boots || ''}`
          : '';
        const last = this._lastSentPose;
        const moved =
          !last ||
          Math.abs(pos.x - last.x) > 0.015 ||
          Math.abs(pos.y - last.y) > 0.015 ||
          Math.abs(pos.z - last.z) > 0.015 ||
          Math.abs(rot.yaw - last.yaw) > 0.015 ||
          Math.abs(rot.pitch - last.pitch) > 0.015 ||
          last.sneaking !== sneaking ||
          last.shielding !== shielding ||
          last.heldItemId !== heldItemId ||
          last.armorSig !== armorSig ||
          last.ridingBoat !== ridingBoat;
        if (moved) {
          this._lastSentPose = {
            ...pos,
            ...rot,
            sneaking,
            shielding,
            heldItemId,
            armorSig,
            ridingBoat,
          };
          this.socket.send(
            encodePacket(MP_MESSAGES.PLAYER_MOVE, {
              x: Number(pos.x.toFixed(3)),
              y: Number(pos.y.toFixed(3)),
              z: Number(pos.z.toFixed(3)),
              yaw: Number(rot.yaw.toFixed(3)),
              pitch: Number(rot.pitch.toFixed(3)),
              sneaking,
              shielding,
              heldItemId,
              armorIds,
              ridingBoat,
            })
          );
        }
      }
    }

    // 2. Smoothly interpolate remote articulated PlayerAvatars
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
      peer.pitch += ((peer.targetPitch ?? 0) - (peer.pitch ?? 0)) * blend;

      const approxSpeed = dt > 0 ? (stepDist * blend) / dt : 0;

      if (peer.avatar) {
        peer.avatar.setArmor(peer.armorIds);
        peer.avatar.setHeldItem(peer.heldItemId, this.worldManager.itemRegistry);
        peer.avatar.update(dt, {
          x: peer.x,
          y: peer.y,
          z: peer.z,
          yaw: peer.yaw,
          pitch: peer.pitch,
          speed: approxSpeed,
          sneaking: Boolean(peer.sneaking),
          swinging: Boolean(peer.swinging),
          shielding: Boolean(peer.shielding),
          hasShield: Boolean(peer.shielding || peer.heldItemId === 'shield'),
          ridingBoat: Boolean(peer.ridingBoat),
        });
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
            if (this.scene && peer.avatar?.root) this.scene.remove(peer.avatar.root);
            peer.avatar?.dispose();
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
          peer.targetPitch = Number.isFinite(msg.pitch) ? msg.pitch : 0;
          peer.sneaking = Boolean(msg.sneaking);
          peer.swinging = Boolean(msg.swinging);
          peer.shielding = Boolean(msg.shielding);
          if (msg.heldItemId !== undefined) peer.heldItemId = msg.heldItemId;
          if (msg.armorIds !== undefined) peer.armorIds = msg.armorIds;
          peer.ridingBoat = Boolean(msg.ridingBoat);
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
      existing.targetPitch = p.pitch ?? 0;
      return;
    }

    const avatar = this.scene
      ? new PlayerAvatar({ shirtColor: p.color ?? 0x38bdf8, name: p.name ?? 'Player' })
      : null;
    if (avatar && this.scene) {
      avatar.setArmor(p.armorIds ?? null);
      avatar.setHeldItem(p.heldItemId ?? null, this.worldManager.itemRegistry);
      avatar.root.position.set(p.x, p.y, p.z);
      avatar.root.rotation.y = p.yaw ?? 0;
      this.scene.add(avatar.root);
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
      targetPitch: p.pitch ?? 0,
      sneaking: Boolean(p.sneaking),
      swinging: Boolean(p.swinging),
      shielding: Boolean(p.shielding),
      heldItemId: p.heldItemId ?? null,
      armorIds: p.armorIds ?? null,
      ridingBoat: Boolean(p.ridingBoat),
      avatar,
      mesh: avatar?.root ?? null,
    });
  }

  /** @private */
  _clearRemotePlayers() {
    for (const peer of this.remotePlayers.values()) {
      if (this.scene && peer.avatar?.root) this.scene.remove(peer.avatar.root);
      peer.avatar?.dispose();
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
