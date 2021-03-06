module.exports = {};

var central = require('../lib/central');
var redis = central.redis;

var debug = require('debug');
var verbose = debug('dbj:tasks:verbose');

var TaskQueue = require('./queue');

['interest', 'compute'].forEach(function(item) {
  var mod = module.exports[item] = require('./' + item);

  var queue = mod.queue = new TaskQueue('queue-' + item, mod, redis.client);

  // let the queue resume undone works.
  queue.on('ready', function(q) {
    verbose('Task queue for ' + item + ' loaded.');
    verbose('%s unfinished task', q.length);
    this.resume();
  });

  queue.on('dumped', function() {
    verbose('Task queue for ' + item + ' dumped...');
  });

  module.exports[item + '_queue'] = queue;
});
