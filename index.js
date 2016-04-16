var async = require("async");
var child = require("child_process");
var ff = require("ff");
var fs = require("fs");
var flickr = require("flickrapi");
var path = require("path");

var db = require(process.argv[2]);
var dbdir = path.dirname(process.argv[2]);

var f = ff(function () {
	flickr.tokenOnly({
		api_key: db.config.remote.api_key,
		secret: db.config.remote.secret,
		progress: false,
	}, f.slot());
}, function (api) {
	flickr = api;
	
	flickr.photosets.getList({
		user_id: db.config.remote.user_id
	}, f.slot());
}, function (res) {
	async.mapSeries(res.photosets.photoset, function (set, next) {
		flickr.photosets.getPhotos({
			photoset_id: set.id,
			user_id: db.config.remote.user_id,
			extras: "description,date_taken,tags",
		}, next);
	}, f.slot());
}, function (res) {
	// TODO sort
	db.remotes = {};
	
	res.forEach(function (val) {
		val.photoset.photo.forEach(function (pic) {
			if (!db.remotes[pic.id]) {
				pic.sets = [];
				pic.tags = pic.tags.split(" ");
				pic.description = pic.description._content;
				
				db.remotes[pic.id] = pic;
			} else {
				pic = db.remotes[pic.id];
			}
			
			pic.sets.push(val.photoset.title);
		});
	});
	
	console.info(Object.keys(db.remotes).length + " remotes");
}, function () {
	async.mapSeries(db.config.local, function (dir, next) {
		// TODO handle broken directories
		// TODO handle directory renaming
		
		child.exec([
			"exiftool",
			"-common",
			"-quiet",
			"-json",
			path.join(dbdir, dir).replace(/ /g, "\\ "),
		].join(" "), {
			maxBuffer: Math.pow(2, 20),
		}, next);
	}, f.slot());
}, function (res) {
	// TODO sort
	db.locals = {};
	
	res.forEach(function (val) {
		JSON.parse(val).forEach(function (pic) {
			db.locals[path.relative(dbdir, pic.SourceFile)] = pic;
		});
	});
	
	console.info(Object.keys(db.locals).length + " locals");
}, function () {
	// TODO sort
	var couples = {};
	var matches = {};
	
	db.pairs.forEach(function (pair) {
		matches[pair.key] = pair;
		
		if (pair.local) {
			couples[pair.local] = true;
			
			if (!db.locals[pair.local]) {
				console.error("Missing! " + pair.local + " / " + pair.remote);
			}
		}
		
		if (pair.remote) {
			couples[pair.remote] = true;
			
			if (!db.remotes[pair.remote]) {
				console.error("Missing! " + pair.remote + " / " + pair.local);
			}
		}
	});
	
	Object.keys(db.locals).forEach(function (ref) {
		if (couples[ref] || !db.locals[ref].DateTimeOriginal) {
			return;
		}
		
		var key = db.locals[ref].DateTimeOriginal.replace(/[^\d]/g, "");
		var obj = matches[key] = matches[key] || { key: key };
		
		if (obj.local) {
			console.error("Conflict! " + ref + " / " + obj.local);
		} else {
			obj.local = ref;
		}
	});
	
	Object.keys(db.remotes).forEach(function (ref) {
		if (couples[ref]) {
			return;
		}
		
		var key = db.remotes[ref].datetaken.replace(/[^\d]/g, "");
		var obj = matches[key] = matches[key] || { key: key };
		
		if (obj.remote) {
			console.error("Conflict! " + ref + " / " + obj.remote);
		} else {
			obj.remote = ref;
		}
	});
	
	db.pairs = Object.keys(matches).map(function (key) {
		return matches[key];
	});
	
	console.info(db.pairs.length + " pairs");
}, function () {
	fs.writeFile(process.argv[2], JSON.stringify(db, null, "\t"), f.wait());
}).onSuccess(function () {
	console.info("Done!");
}).onError(function (err) {
	console.error("Error!", err);
});
