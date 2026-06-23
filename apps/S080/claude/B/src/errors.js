'use strict';

// Operational error whose message is safe to show to the client.
class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.expose = true;
  }
}

module.exports = { AppError };
