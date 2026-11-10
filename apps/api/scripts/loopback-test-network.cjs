// Loaded only in the API and worker processes that serve browser fixtures.
const { Socket } = require('node:net');

const connect = Socket.prototype.connect;
const loopback = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']);
Socket.prototype.connect = function (...args) {
  const input = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = input && typeof input === 'object' ? input.host : args[1];
  if (typeof host === 'string' && host && !loopback.has(host)) {
    throw new Error('Browser fixture blocked a non-loopback socket.');
  }
  return Reflect.apply(connect, this, args);
};
