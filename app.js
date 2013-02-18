//if (!module.parent) process.on('uncaughtException', function(err, next) {
  //var msg;
  //if (err instanceof Error) {
    //msg = '[err]: ' + err + '\n' + err.stack;
  //} else {
    //msg = (err.name || err.reason || err.message);
    //console.error(err);
  //}
  //console.error(msg);
  //next && next();
//});

var express = require('express');
var central = require('./lib/central');
var serve = require('./serve');
var jade = require('jade');
var istatic = require('express-istatic');
var public_root = __dirname + '/static';

var reg_log = /_log\(.*?\);/g;
istatic.default({
  root: public_root,
  debug: false,
  js: {
    filter: function(str) {
      return str.replace(reg_log, '');
    }
  }
});

// initial bootstraping, only serve the API
module.exports.boot = function() {
  var app = express();
  app.enable('trust proxy')

  app.engine('jade', jade.renderFile);

  app.set('view engine', 'jade');
  app.set('view cache', !central.conf.debug);
  app.set('views', __dirname + '/templates');

  app.use(express.static(public_root));

  app.locals({
    conf: central.conf,
    static: central.staticPath,
    istatic: istatic.serve(),
  });

  app.use(express.methodOverride());
  app.use(express.cookieParser());
  app.use(express.cookieSession({
    secret: central.conf.salt
  }));
  app.use(express.bodyParser());
  app.use(express.csrf());

  app.use(function(req, res, next) {
    res.locals._csrf = req.session._csrf;
    next();
  });

  serve(app, central);
  app.listen(central.conf.port);
};

if (!module.parent) {
//setTimeout(function() {
  module.exports.boot();
//}, 20000);
}