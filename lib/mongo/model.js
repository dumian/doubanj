var debug = require('debug');
var error = debug('dbj:model:error');
var verbose = debug('dbj:model:verbose');
var log = debug('dbj:model:log');

var cwd = process.cwd();
var util = require('util');
var utils = require(cwd + '/lib/utils');
var trunc = utils.trunc;
var extend = utils.extend;

var mongo = require('./pool').instant;

function Model(info) {
  extend(this, info);
  return this;
}
util.inherits(Model, require('events').EventEmitter);

Model.prototype.kind = null;
Model.prototype._collection = null;

Model.get = function(id, cb) {
  var cls = this;
  var kind = cls.kind;
  verbose('getting %s %s', kind, id)
  mongo(function(db) {
    var collection = db.collection(cls._collection);
    collection.findOne({
      '$or': [
        // douban id
        { 'id': id },
        // local id
        { '_id': id }
      ]
    }, function(err, r) {
      if (err !== null) {
        error('get %s failed: %s', kind, err);
        return cb(err);
      }

      if (r) return cb(null,  Interest(r));

      log('%s %s not found', kind, id);

      return cb(null, null);
    });
  });
};

Model._default_sort = { 'id': -1 };
Model._default_limit = 20;

Model.find = function(query, opts, cb) {
  var cls = this;

  opts = opts || {};
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }

  utils.defaults(opts, {
    sort: cls._default_sort,
    limit: cls._default_limit,
  });

  cls.stream(query, opts, function(stream) {
    if (opts.stream) return cb(stream);

    var last_err = null, ret = [];
    stream.on('data', function(item) {
      ret.push(new cls(item));
    });
    stream.once('error', function(err) {
      last_err = err;
      error('getting %s failed: %s', cls.prototype.kind, err);
    });
    stream.once('close', function() {
      //console.log(query, ret);
      cb(last_err, ret);
    });
  });
};
Model.gets = function(ids, opts, cb) {
  if (typeof ids[0] === 'object') {
    // exact the real id
    ids = ids.map(function(item) {
      return item.id;
    });
  }
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }

  opts = opts || {};
  opts.limit = ids.length;

  var query = {
    'id': {
      '$in': ids
    },
  };

  return this.find(query, opts, function(err, items) {
    if (err) return cb(err, items);

    if (opts.preserve_order !== false) {
      var order_map = {};
      items.forEach(function(item, i) {
        order_map[item.id] = item;
      });
      items = ids.map(function(id) {
        return order_map[id];
      });
    }

    cb(err, items);
  });
};

Model.fromJSON = function(json) {
  return this(JSON.parse(json));
}
Model.stream = function(query, opts, cb) {
  var self = this;

  if (typeof opts === 'function') {
    cb = opts;
    opts = undefined;
  }

  if (!cb) return mongo.db.collection(self._collection).find(query, opts).stream();

  mongo(function(db) {
    cb(db.collection(self._collection).find(query, opts).stream());
  });
};

/**
* currying wrappers
*/
Model.extended = function(fn, opts) {
  var cls = this;
  return function() {
    var args = arguments;
    var callback = args[args.length - 1];
    
    // rewrite callback
    args[args.length - 1] = function(err, ids) {
      if (err) return callback(err);

      cls.gets(ids, opts, callback);
    };
    fn.apply(this, args);
  }
};

/**
* generate a curring function
* to build funtions for
* attach given object based on prop_name
*
* Confusing, eih? :-(
*/
Model.attached = function(prop_name, extend_to, ObjClass) {
  return function(fn) {
    return function() {
      var args = arguments;
      var callback = args[args.length - 1];
      
      // rewrite callback
      args[args.length - 1] = function(err, docs) {
        if (err) return callback(err);

        var is_arr = Array.isArray(docs);

        docs = is_arr ? docs : [docs];

        var oids = {};
        docs.forEach(function(item, i) {
          var oid = item[prop_name];
          if (oid) oids[oid] = i;
        });

        ObjClass.gets(Object.keys(oids), function(err, items) {
          items && items.forEach(function(item, index) {
            var i = oids[item.id];
            // attach it... T.T
            docs[i][extend_to] = ObjClass(item);
          });
          callback(err, docs);
        });
      };

      fn.apply(this, args);
    }
  }
};

// the uid to user decorator
Model.ensured = function(fn) {
  var cls = this;
  var kind = cls.prototype.kind;
  return function() {
    var self = this;

    var args = arguments;
    var uid = args[0];

    if (uid instanceof cls || (uid && uid[kind] instanceof cls)) return fn.apply(self, args);

    if (!kind) throw new Error('Ensured class done have kind');

    if (typeof uid === 'string' || typeof uid === 'number') {
      // fn(12346);
      cls.get(uid, function(err, instan) {
        args[0] = instan;
        fn.apply(self, args);
      });
    } else {
      // some fn like:
      // fn({ user: xxx });
      cls.get(uid[kind], function(err, instan) {
        args[0][kind] = instan;
        fn.apply(self, args);
      });
    }
  };
};


Model.prototype.save = function(cb) {
  var self = this;
  mongo(function(db, next) {
    var collection = db.collection(self._collection); 
    if (self._id) {
      collection.save(self.toObject(), {
        upsert: true,
      }, function(err, res) {
        if (err) {
          self.emit('error', err);
          error('save %s %s faild: %s', self.kind, self._id, err);
        }
        self.emit('saved', res);
        cb && cb(err, res);
        next(); // to continue other pool jobs
      });
    } else {
      log('inserting new %s %s', self.kind, (self.uid || self.id));
      collection.insert(self.toObject(), function(err, res) {
        if (err) {
          self.emit('error', err);
          error('insert %s %s faild: %s', self.kind, self._id, err);
        } else {
          self._id = res._id;
        }
        self.emit('inserted', res);
        self.emit('saved', res);
        cb && cb(err, res);
        next(); // write job is serious, so we wait for it to complete
      });
    }
  });
};
Model.prototype.update = function(data, cb) {
  var self = this;
  var uid = self.uid || self._id;

  if (typeof data !== 'object') throw new Error('invalid data');

  function do_update(db) {
    var collection = db.collection(self._collection);

    // remove options
    delete data['$upsert'];

    data['mtime'] = new Date();

    verbose('try update exsiting %s %s...', self.kind, uid); 

    collection.update({
      _id: self._id
    }, {
      $set: data
    }, function(err, r) {
      if (err) error('updating %s %s failed: %s', self.kind, uid, err);

      extend(self, data);

      self.emit('updated', data);

      cb && cb(err, r);

      verbose('%s %s updated: %s', self.kind, uid, trunc(JSON.stringify(data), 60));
    });
  }

  // _id is ready, save it directly
  if (self._id) return mongo(do_update);

  // if not exist, create it
  // if exists, will update the whole doc
  if (data['$upsert']) {
    delete data['$upsert'];
    verbose('try upsert %s %s when updating...', self.kind, uid);
    extend(self, data);
    return self.save(cb);
  }

  cb && cb(new Error('missing _id'));
};

Model.prototype.toObject = function() {
  return { '_id': this['_id'], 'id': this['id'], 'kind': this.kind };
};
Model.prototype.toString = function() {
  var obj = this.toObject();
  return JSON.stringify(obj);
};

Model.prototype.getSelector = function() {
  var self = this;
  var selector = [];
  
  if (self.uid) {
    selector.push({ uid: self.uid });
  }
  if (self.id) {
    selector.push({ id: self.id });
  }

  if (selector.length === 2) {
    return {
      '$or': selector
    };
  }
  return selector[0];
};

module.exports = Model;
