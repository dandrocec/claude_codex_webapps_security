'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const models = require('../models');
const { requireAuth } = require('../middleware/security');

const router = express.Router();

// Every route here requires authentication.
router.use(requireAuth);

// ----- List rooms / create room -----
router.get('/rooms', (req, res) => {
  res.render('rooms', {
    title: 'Chat Rooms',
    rooms: models.listRooms(),
    error: null,
  });
});

router.post(
  '/rooms',
  [
    body('name')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Room name must be 1-50 characters.')
      .matches(/^[\w \-]+$/)
      .withMessage('Room name may contain letters, numbers, spaces, _ and -.'),
  ],
  (req, res, next) => {
    try {
      const errors = validationResult(req);
      const name = (req.body.name || '').trim();

      if (!errors.isEmpty()) {
        return res.status(400).render('rooms', {
          title: 'Chat Rooms',
          rooms: models.listRooms(),
          error: errors.array()[0].msg,
        });
      }

      if (models.findRoomByName(name)) {
        return res.status(409).render('rooms', {
          title: 'Chat Rooms',
          rooms: models.listRooms(),
          error: 'A room with that name already exists.',
        });
      }

      const room = models.createRoom(name, req.session.userId);
      res.redirect(`/rooms/${room.id}`);
    } catch (err) {
      next(err);
    }
  }
);

// ----- View a single room and its messages -----
router.get(
  '/rooms/:id',
  [param('id').isInt({ min: 1 })],
  (req, res, next) => {
    try {
      if (!validationResult(req).isEmpty()) {
        return res.status(404).render('error', {
          title: 'Not found',
          message: 'Room not found.',
        });
      }

      const room = models.findRoomById(Number(req.params.id));
      if (!room) {
        return res.status(404).render('error', {
          title: 'Not found',
          message: 'Room not found.',
        });
      }

      res.render('room', {
        title: room.name,
        room,
        messages: models.listMessages(room.id),
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ----- Post a message to a room -----
router.post(
  '/rooms/:id/messages',
  [
    param('id').isInt({ min: 1 }),
    body('body')
      .trim()
      .isLength({ min: 1, max: 2000 })
      .withMessage('Message must be 1-2000 characters.'),
  ],
  (req, res, next) => {
    try {
      const room = models.findRoomById(Number(req.params.id));
      if (!room) {
        return res.status(404).render('error', {
          title: 'Not found',
          message: 'Room not found.',
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('room', {
          title: room.name,
          room,
          messages: models.listMessages(room.id),
          error: errors.array()[0].msg,
        });
      }

      // user_id comes from the session, never from the request.
      models.createMessage(room.id, req.session.userId, req.body.body.trim());
      res.redirect(`/rooms/${room.id}`);
    } catch (err) {
      next(err);
    }
  }
);

// ----- Delete one's own message (access control / IDOR prevention) -----
router.post(
  '/rooms/:roomId/messages/:msgId/delete',
  [param('roomId').isInt({ min: 1 }), param('msgId').isInt({ min: 1 })],
  (req, res, next) => {
    try {
      const roomId = Number(req.params.roomId);
      const msgId = Number(req.params.msgId);

      const message = models.findMessageById(msgId);

      // Object-level authorization: the message must exist, belong to the
      // referenced room, AND be owned by the requesting user.
      if (
        !message ||
        message.room_id !== roomId ||
        message.user_id !== req.session.userId
      ) {
        return res.status(403).render('error', {
          title: 'Forbidden',
          message: 'You can only delete your own messages.',
        });
      }

      models.deleteMessage(msgId);
      res.redirect(`/rooms/${roomId}`);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
