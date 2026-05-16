/** isomorphic-ws/browser only exposes default; indexer imports `{ WebSocket }`. */

function requireWebSocket(): typeof globalThis.WebSocket {
  const ctor =
    typeof globalThis !== 'undefined' && typeof globalThis.WebSocket !== 'undefined'
      ? globalThis.WebSocket
      : undefined;
  if (!ctor) {
    throw new Error('[Obsidian] Native WebSocket is required for the Midnight indexer subscriptions.');
  }
  return ctor;
}

export const WebSocket = requireWebSocket();

export default WebSocket;
