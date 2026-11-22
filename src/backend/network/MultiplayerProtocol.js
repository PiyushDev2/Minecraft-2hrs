/**
 * @file MultiplayerProtocol.js
 * @description Shared WebSocket multiplayer message constants, payload builders,
 * and validation helpers used by both the authoritative server and browser client.
 */

export const MP_MESSAGES = Object.freeze({
  JOIN_ROOM: 'mp:join_room',
  ROOM_STATE: 'mp:room_state',
  PLAYER_JOINED: 'mp:player_joined',
  PLAYER_LEFT: 'mp:player_left',
  PLAYER_MOVE: 'mp:player_move',
  PLAYER_MOVED: 'mp:player_moved',
  BLOCK_SET: 'mp:block_set',
  BLOCK_UPDATED: 'mp:block_updated',
  TIME_SET: 'mp:time_set',
  TIME_UPDATED: 'mp:time_updated',
  CHAT: 'mp:chat',
  CHAT_MESSAGE: 'mp:chat_message',
  ERROR: 'mp:error',
  PING: 'mp:ping',
  PONG: 'mp:pong',
});

export const PLAYER_AVATAR_COLORS = Object.freeze([
  0x38bdf8,
  0x34d399,
  0xfbbf24,
  0xf472b6,
  0xa78bfa,
  0xfb7185,
]);

/**
 * Validates and normalizes a multiplayer server address for browser WebSockets.
 * Bare hostnames are accepted and use the current page's security scheme.
 * @param {string} raw
 * @param {string} [pageUrl='https://localhost']
 * @returns {string}
 */
export function normalizeWebSocketUrl(raw, pageUrl = 'https://localhost') {
  const value = String(raw || '').trim();
  if (!value) throw new Error('Enter a multiplayer server address.');

  let candidate = value;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    const pageProtocol = new URL(pageUrl).protocol;
    candidate = `${pageProtocol === 'https:' ? 'wss:' : 'ws:'}//${candidate}`;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Enter a valid server address, such as play.example.com.');
  }

  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Server addresses must use ws:// or wss://.');
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error('Use a hostname and optional path only; credentials, query strings, and fragments are not allowed.');
  }
  if (new URL(pageUrl).protocol === 'https:' && url.protocol !== 'wss:') {
    throw new Error('Secure game pages can only connect to wss:// servers.');
  }
  if (!url.pathname || url.pathname === '/') url.pathname = '/ws';
  return url.toString();
}

/**
 * Sanitizes a room ID string to safe alphanumeric/dash tokens.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeRoomId(raw) {
  const cleaned = String(raw || 'public-valley')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .slice(0, 32);
  return cleaned || 'public-valley';
}

/**
 * Sanitizes a player display name.
 * @param {string} raw
 * @returns {string}
 */
export function normalizePlayerName(raw) {
  const cleaned = String(raw || 'Explorer').trim().slice(0, 20);
  return cleaned || 'Explorer';
}

/**
 * Safely encodes a protocol packet as JSON.
 * @param {string} type
 * @param {Record<string, any>} [payload={}]
 * @returns {string}
 */
export function encodePacket(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

/**
 * Safely parses a JSON WebSocket packet.
 * @param {string} raw
 * @returns {any|null}
 */
export function decodePacket(raw) {
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
