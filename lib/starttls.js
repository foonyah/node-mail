var Crypto = require('crypto'),
    TLS = require('tls');

exports.starttls = starttls;

// Adapted from Node's tls.connect() method.
function starttls(socket, opt, next) {
  if (typeof opt == 'function') {
    next = opt;
    opt = undefined;
  }

  var OLD_NODE = TLS.TLSSocket == null;
  var context, pair, cleartext;
  if(OLD_NODE) {
    // OLD Node < 0.11
    context = TLS.createSecureContext();
    pair = TLS.createSecurePair(context, false);
    cleartext = pipe(pair, socket);
    pair.on('secure', onSecure);
    pair.on('secureConnect', onSecure);
  } else {
    pair = { cleartext: TLS.connect({ socket: socket, rejectUnauthorized: false }, function() { }) };
    cleartext = pair.cleartext;
    cleartext.on('secure', onSecure);
    cleartext.on('secureConnect', onSecure);
  }
  function onSecure() {
    var error;
    if(OLD_NODE) {
      error = (pair.ssl) ? pair.ssl.verifyError() : pair._ssl.verifyError();
    } else {
      error;
    }

    if (error) {
      cleartext.authorized = false;
      cleartext.authorizationError = error;
    }
    else {
      cleartext.authorized = true;
    }

    next && next(error, cleartext);
  }
  cleartext._controlReleased = true;
  return cleartext;
}

// Lifted from NODE/lib/tls.js
function pipe(pair, socket) {
  pair.encrypted.pipe(socket);
  socket.pipe(pair.encrypted);

  pair.fd = socket.fd;
  var cleartext = pair.cleartext;
  cleartext.socket = socket;
  cleartext.encrypted = pair.encrypted;
  cleartext.authorized = false;

  function onerror(e) {
    if (cleartext._controlReleased) {
      cleartext.emit('error', e);
    }
  }

  function onclose() {
    socket.removeListener('error', onerror);
    socket.removeListener('close', onclose);
  }

  socket.on('error', onerror);
  socket.on('close', onclose);

  return cleartext;
}
