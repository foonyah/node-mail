var OS = require('os'),
    U = require('./util'),
    Address = require('./address'),
    Message = require('./message'),
    SMTP = require('./smtp');

exports.Mail = Mail;
exports.Message = Message.Message;
U.extend(exports, Address);
U.extend(exports, SMTP);


// ## Mail ##

// A Mail instance encapsulates some connection settings so new
// messages can be quickly sent by giving and envelope and body.

function Mail(opt) {
  if (!(this instanceof Mail))
    return new Mail(opt);

  this.options = opt = opt || {};
  opt.domain = opt.domain || OS.hostname();
};

Mail.prototype.message = function message(headers) {
  return new MailTransaction(this, headers);
};


// ## Mail Transaction ##

// A mail transaction is a quick way to send a single message. A
// transaction creates a client, connects to a mail server, sends a
// message, then disconnects. A transaction succeeds entirely or fails
// entirely.

function MailTransaction(mailer, headers) {
  this.options = mailer.options;
  this.headers = headers;
}

MailTransaction.prototype.destroy = function() {
  var client = this.client || {};
  delete this.client;
  delete this.options;
  delete this.headers;
  delete this._body;
  !client.sock || client.sock.destroy();
  
};

MailTransaction.prototype.body = function(text, attachments) {
  var tran = this;
  tran._body = text || '';
  // console.log('MailTransaction.prototype.body, begin. attachments?' + !!attachments, tran.headers);
  // (2020.07.30) attachments を渡して、添付ファイルを実現
  // 通常の Content-Type はヘッダーから取得する
  var content_type, content_encoding;
  var date = new Date(), EOL = "\r\n"; // require('os').EOL;
  var YMD, boundary, parts;
  // 有効添付ファイルの取得
  attachments = [ ].concat(attachments).filter(at=>{
    return at && at['name'] && at['type'] && at['contents'];
  });
  if(attachments.length) {

    // multipart 前準備
    MailTransaction.seq = MailTransaction.seq || 0;
    YMD = [ date.getFullYear(), ('00' + (date.getMonth() + 1)).substr(-2), ('00' + date.getDate()).substr(-2) ].join('');
    boundary = ['----=', 'MSGPART', YMD, parseInt(Date.now() / 1000) ].join('_') + '.F' + ('00000000' + (++MailTransaction.seq)).substr(-8);
    content_type = tran.headers['Content-Type'] || 'text/plain; charset="UTF-8"';
    content_encoding = tran.headers['Content-Transfer-Encoding'] || '8BITMIME';
    tran.headers['Content-Type'] = 'multipart/mixed; boundary="' + boundary + '"';

    // multipart 本文作成
    parts = [ 'This is a multipart message in MIME format.' + EOL ].concat( new Array(attachments.length + 1).fill('') );
    parts[1] += 'Content-Type: ' + content_type + EOL;
    parts[1] += 'Content-Transfer-Encoding: ' + content_encoding + EOL + EOL;
    parts[1] += text || '';
    attachments.forEach((attach, idx)=>{
      var filename = attach.name;
      parts[2 + idx] += 'Content-Type: ' + attach.type + '; name="' + filename + '"' + EOL;
      parts[2 + idx] += 'Content-Transfer-Encoding: ' + (attach.encode || 'base64') + EOL;
      parts[2 + idx] += 'Content-Disposition: attachment; filename="' + filename + '"' + EOL + EOL;
      parts[2 + idx] += attach.contents;
    });
    // delimiter := CRLF "--" boundary
    // https://www.w3.org/Protocols/rfc1341/7_2_Multipart.html
    tran._body = parts.map(part=>part + EOL + '--' + boundary);
    // console.log('MailTransaction.prototype.body(multipart), done.');

  }
  return tran;
};

MailTransaction.prototype.send = function(next) {
  var tran = this;
  var opt = this.options,
      message = (new Message.Message(this.headers, opt)).body(this._body),
      headers = message.headers,
      sender, recipients, client,
      error;

  next = next || function(err) { throw err; };

  try {
    if (opt.host === undefined)
      next(error = new Error('send: host is required.'));
    else if (!(sender = message.sender()))
      next(error = new Error('send: missing sender (add From or Sender headers).'));
    else if ((recipients = message.recipients()).length == 0)
      next(error = new Error('send: missing recipients (add To, Cc, or Bcc headers).'));
    else
      return this.transmit(sender, recipients, message, function(err) {
        if (error === undefined)
          next(error = err, message);
        tran.destroy();
      });
  } catch (err) {
    if (error === undefined)
      next(error = err);
  }

  // if reach here, destroy MailTransaction immediately.
  this.destroy();
  return null;
};

MailTransaction.prototype.transmit = function(sender, recip, message, next) {
  var client = this.client = SMTP.createClient(this.options),
      error;

  client.on('error', function(err) {
    client.end();
    if (error === undefined)
      next(error = err);
  });

  return client.mail(sender, recip)
    .on('ready', function() {
      this.on('end', function() {
        client.quit();
        if (error === undefined)
          next(error = null, message);
      })
      .end(message.toString());
    });
};
