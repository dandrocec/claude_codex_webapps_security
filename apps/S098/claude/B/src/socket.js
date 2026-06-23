'use strict';

const { effectivePermission, documents } = require('./repositories');

const MAX_CONTENT = 200_000;

/**
 * Wire up real-time collaboration.
 *
 * - The Express session middleware is shared with Socket.IO, so every socket
 *   is tied to an authenticated user (unauthenticated sockets are refused).
 * - Joining a document room and persisting edits are both re-authorised
 *   against the database on every request — the client is never trusted.
 */
function initSockets(io, sessionMiddleware) {
  // Run the session middleware during the Socket.IO handshake.
  io.engine.use(sessionMiddleware);

  io.use((socket, next) => {
    const session = socket.request.session;
    if (session && session.userId) {
      socket.userId = session.userId;
      return next();
    }
    return next(new Error('unauthorized'));
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;

    socket.on('join', (rawId) => {
      const docId = Number(rawId);
      if (!Number.isInteger(docId) || docId < 1) return;
      const { permission } = effectivePermission(docId, userId);
      if (!permission) return; // No access -> silently ignore.
      socket.join(room(docId));
      socket.emit('joined', { documentId: docId, permission });
    });

    socket.on('leave', (rawId) => {
      const docId = Number(rawId);
      if (Number.isInteger(docId)) socket.leave(room(docId));
    });

    socket.on('edit', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const docId = Number(payload.documentId);
      const content = payload.content;

      if (!Number.isInteger(docId) || docId < 1) return;
      if (typeof content !== 'string' || content.length > MAX_CONTENT) return;

      // Re-check authorisation on every edit (defends against stale rights).
      const { permission } = effectivePermission(docId, userId);
      if (permission !== 'owner' && permission !== 'edit') return;

      documents.updateContent(docId, content);

      // Broadcast to everyone else viewing the document. Content is delivered
      // as data (JSON) and rendered by the client into a textarea value, so it
      // is never interpreted as HTML.
      socket.to(room(docId)).emit('document-updated', {
        documentId: docId,
        content,
        updatedBy: userId,
      });
    });
  });
}

function room(docId) {
  return `doc:${docId}`;
}

module.exports = { initSockets };
