if(safari) {
	// SITE-SPECIFIC HACK for ClickToPlugin
	// Prevents YouTube from removing the Flash player and disables SPF
	var script = "\
		var s = document.createElement('script');\
		s.textContent = 'window.ytplayer=window.ytplayer||{};ytplayer.config=ytplayer.config||{};Object.defineProperty(ytplayer.config,\"min_version\",{\"value\":\"0.0.0\"});window.ytspf=window.ytspf||{};Object.defineProperty(ytspf,\"enabled\",{\"value\":false});';\
		document.head.appendChild(s);";
	safari.extension.addContentScript(script, ["http://www.youtube.com/*", "https://www.youtube.com/*"], [], true);
}

addKiller("YouTube", {

"playlistFilter": /^UL|^PL|^SP|^AL/,

"canKill": function(data) {
	if(/^https?:\/\/s\.ytimg\.com\//.test(data.src)) return true;
	if(/^https?:\/\/(?:www\.)?youtube(?:-nocookie|\.googleapis)?\.com\/[vpe]\//.test(data.src)) {data.embed = true; return true;}
	return false;
},

"process": function(data, callback) {
	var videoID, playlistID, startTime;
	var onsite = /^https?:\/\/www\.youtube\.com\/watch\?/.test(data.location);
	
	if(data.embed) { // old-style YT embed
		var match = /\.com\/([vpe])\/+([^&?]+)/.exec(data.src);
		if(match) {
			if(match[1] === "p") playlistID = "PL" + match[2];
			else videoID = match[2];
		} else return;
		match = /[?&]start=([\d]+)/.exec(data.src);
		if(match) startTime = parseInt(match[1]);
	} else {
		var flashvars = parseFlashVariables(data.params.flashvars);
		videoID = flashvars.video_id;
		if(!videoID) return;
		
		if(this.playlistFilter.test(flashvars.list)) playlistID = flashvars.list;
		if(onsite) {
			var match = /[#&?]t=(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/.exec(data.location);
			if(match) {
				var hours = parseInt(match[1]) || 0;
				var minutes = parseInt(match[2]) || 0;
				var seconds = parseInt(match[3]) || 0;
				startTime = 3600 * hours + 60 * minutes + seconds;
			}
		} else startTime = parseInt(flashvars.start);
	}
	
	var _this = this;
	var mainCallback = function(mediaData) {
		mediaData.startTime = startTime;
		if(onsite) {
			mediaData.initScript = _this.initScript;
			mediaData.restoreScript = _this.restoreScript;
		}
		callback(mediaData);
	};
	
	if(playlistID) this.processPlaylist(playlistID, videoID, mainCallback, callback);
	else if(videoID) this.processVideoID(videoID, !onsite, mainCallback);
},

"processVideoID": function(videoID, isEmbed, callback) {
	var _this = this;
	var xhr = new XMLHttpRequest();
	xhr.open("GET", "https://www.youtube.com/get_video_info?&video_id=" + videoID + "&eurl=http%3A%2F%2Fwww%2Eyoutube%2Ecom%2F&sts=1588", true);
	xhr.addEventListener("load", function() {
		var flashvars = parseFlashVariables(xhr.responseText);
		if(flashvars.status === "ok") {
			_this.processFlashVars(flashvars, isEmbed ? function(mediaData) {
				mediaData.playlist[0].siteInfo = {"name": "YouTube", "url": "http://www.youtube.com/watch?v=" + videoID};
				callback(mediaData);
			} : callback);
		} else { // e.g. region-blocked video
			callback({"playlist": [null]});
		}
	}, false);
	xhr.send(null);
},

"processFlashVars": function(flashvars, callback) {
	if(flashvars.ps === "live" && !flashvars.hlsvp) return;
	
	var sources = [];
	var call = function() {
		var posterURL, title;
		if(flashvars.iurlmaxres) posterURL = decodeURIComponent(flashvars.iurlmaxres);
		else if(flashvars.iurlsd) posterURL = decodeURIComponent(flashvars.iurlsd);
		else posterURL = "https://i.ytimg.com/vi/" + flashvars.video_id + "/hqdefault.jpg";
		if(flashvars.title) title = decodeURIComponent(flashvars.title.replace(/\+/g, " "));
		
		sources.sort(function(a,b){return a.height < b.height ? 1 : -1;});
		
		callback({
			"playlist": [{
				"title": title,
				"poster": posterURL,
				"sources": sources
			}]
		});
	};
	
	// Get video URLs
	if(flashvars.url_encoded_fmt_stream_map) {
		var path, source;
		
		// Get 240p, 360p, and 720p
		var fmtList = decodeURIComponent(flashvars.url_encoded_fmt_stream_map).split(",");
		var x;
		for(var i = 0; i < fmtList.length; i++) {
			x = parseFlashVariables(fmtList[i]);
			if(!x.url) continue;
			
			if(x.itag === "22") {
				source = {"format": "720p MP4", "height": 720, "isNative": true};
			} else if(x.itag === "18") {
				path = decodeURIComponent(x.url.substring(0, x.url.indexOf("videoplayback%3F") + 16)).replace(/^https/, "http");
				source = {"format": "360p MP4", "height": 360, "isNative": true};
			} else if(canPlayFLV && x.itag === "5") {
				source = {"format": "240p FLV", "height": 240, "isNative": false};
			} else continue;
			
			source.url = decodeURIComponent(x.url).replace(/^https/, "http") + "&title=" + flashvars.title + "%20%5B" + source.height + "p%5D";
			if(x.sig) source.url += "&signature=" + x.sig;
			else if(x.s) source.url += "&signature=" + this.decodeSignature(x.s);
			sources.push(source);
		}
		
		// Get 480p, 1080p, and 1440p
		if((canPlayFLV ? /itag%3D135/ : /itag%3D137/).test(flashvars.adaptive_fmts)) {
			var query = "";
			var dashmpd = decodeURIComponent(flashvars.dashmpd);
			dashmpd = dashmpd.substring(dashmpd.indexOf("manifest/dash/") + 14).split("/");
			for(var i = 0; i < dashmpd.length; i += 2) {
				if(dashmpd[i] === "s") {
					dashmpd[i] = "signature";
					dashmpd[i+1] = this.decodeSignature(dashmpd[i+1]);
				}
				query += dashmpd[i] + "=" + dashmpd[i+1] + "&";
			}
			
			// Check that the non-DASH video exists
			var url480 = path + query + "ratebypass=yes&itag=35&title=" + flashvars.title + "%20%5B480p%5D";
			getMIMEType(url480, function(type) {
				if(type !== "text/plain") {
					if(canPlayFLV) sources.push({"url": url480, "format": "480p FLV", "height": 480, "isNative": false});
					if(!canPlayFLV || /itag%3D138/.test(flashvars.adaptive_fmts)) sources.push({
						"url": path + query + "ratebypass=yes&itag=37&title=" + flashvars.title + "%20%5B1080p%5D",
						"format": "1080p MP4",
						"height": 1080,
						"isNative": true
					});
					if(/itag%3D138/.test(flashvars.adaptive_fmts)) sources.push({
						"url": path + query + "ratebypass=yes&itag=38&title=" + flashvars.title + "%20%5B1440p%5D",
						"format": "1440p MP4",
						"height": 1440,
						"isNative": true
					});
				}
				call();
			});
		} else call();
		
	} else if(flashvars.hlsvp) {
		sources.push({"url": decodeURIComponent(flashvars.hlsvp), "format": "M3U8", "isNative": true});
		call();
	}
},

"decodeSignature": function(s) {
	s = s.split("");
	s = s.slice(2);
	s = s.reverse();
	s = s.slice(3);
	var t = s[0];
	s[0] = s[19%s.length];
	s[19] = t;
	s = s.reverse();
	return s.join("");
},

"processPlaylist": function(playlistID, videoID, mainCallback, callback) {
	var videoIDList = [];
	var _this = this;
	
	var loadAPIList = function(playlistURL, startIndex) {
		var xhr = new XMLHttpRequest();
		xhr.open("GET", playlistURL + "?start-index=" + startIndex + "&max-results=50", true);
		xhr.addEventListener("load", function() {
			if(xhr.status === 200) {
				var entries = xhr.responseXML.getElementsByTagName("entry");
				for(var i = 0; i < entries.length; i++) {
					try{ // being lazy
						videoIDList.unshift(/\?v=([^&?']+)/.exec(entries[i].getElementsByTagNameNS("http://search.yahoo.com/mrss/", "player")[0].getAttribute("url"))[1]);
					} catch(e) {}
				}
				if(xhr.responseXML.querySelector("link[rel='next']") === null) processList();
				else loadAPIList(playlistURL, startIndex + 50);
			} else if(videoID) _this.processVideoID(videoID, false, mainCallback);
		}, false);
		xhr.send(null);
	};
	
	var loadPlaylist = function(page) {
		var xhr = new XMLHttpRequest();
		xhr.open("GET", "https://www.youtube.com/playlist?list=" + playlistID + "&page=" + page, true);
		xhr.addEventListener("load", function() {
			if(xhr.status === 200) {
				var regex = /class=\"video-title-container\">\s*<a href=\"\/watch\?v=([^&]*)/g;
				var match;
				while(match = regex.exec(xhr.responseText)) {
					videoIDList.push(match[1]);
				}
				if(videoIDList.length < 100 * page) processList();
				else loadPlaylist(page + 1);
			} else if(videoID) _this.processVideoID(videoID, false, mainCallback);
		}, false);
		xhr.send(null);
	};
	
	var processList = function() {
		var track = 0;
		var length = videoIDList.length;
		if(videoID) { // shift list so that videoID is first
			while(videoIDList[0] !== videoID && track < length) {
				++track;
				videoIDList.push(videoIDList.shift());
			}
			if(track === length) {
				videoIDList.unshift(videoID);
				++length;
				track = 0;
			}
		}
		
		var callbackForPlaylist = function(mediaData) {
			mediaData.playlistLength = length;
			mediaData.startTrack = track;
			mainCallback(mediaData);
		};
		
		// load the first video at once
		_this.processVideoID(videoIDList[0], !videoID, callbackForPlaylist);
		videoIDList.shift();
		unloadList();
	};
	
	var unloadList = function() {
		if(videoIDList.length === 0) return;
		var i = 0;
		var imax = videoIDList.length;
		if(imax > 3) imax = 3; // load by groups of 3
		var mediaData = {"loadAfter": true, "playlist": []};
		var next = function(data) {
			mediaData.playlist.push(data.playlist[0]);
			++i;
			if(i === imax) {
				callback(mediaData);
				unloadList();
			} else _this.processVideoID(videoIDList.shift(), true, next);
		};
		_this.processVideoID(videoIDList.shift(), true, next);
	};
	
	if(/^UL/.test(playlistID)) {
		var xhr = new XMLHttpRequest();
		xhr.open("GET", "https://www.youtube.com/watch?&v=" + playlistID.substring(2), true);
		xhr.addEventListener("load", function() {
			var match = /https?:\/\/www\.youtube\.com\/user\/([^"]*)/.exec(xhr.responseText);
			if(match) loadAPIList("https://gdata.youtube.com/feeds/api/users/" + match[1] + "/uploads", 1, true);
			else if(videoID) _this.processVideoID(videoID, false, mainCallback);
		}, false);
		xhr.send(null);
	} else loadPlaylist(1);
},

"initScript": "\
	try{\
		var _this = this;\
		var seekTo = function(time) {\
			var seek = function() {\
				_this.removeEventListener(\"loadeddata\", seek, false);\
				_this.currentTime = time;\
				_this.play();\
			};\
			if(_this.readyState >= _this.HAVE_CURRENT_DATA) {\
				_this.pause();\
				seek();\
			} else {\
				_this.preload = \"auto\";\
				_this.addEventListener(\"loadeddata\", seek, false);\
			}\
			_this.parentNode.focus();\
		};\
		window.yt = window.yt || {}; yt.www = yt.www || {}; yt.www.watch = yt.www.watch || {}; yt.www.watch.player = yt.www.watch.player || {};\
		yt.www.watch.player.flashSeekTo = yt.www.watch.player.seekTo;\
		Object.defineProperty(yt.www.watch.player, \"seekTo\", {\"get\": function() {return seekTo;}, \"set\": function(x) {yt.www.watch.player.flashSeekTo = x;}, \"configurable\": false, \"enumerable\": false});\
	} catch(e) {}",

"restoreScript": "\
	try{\
		var player = {\"seekTo\": yt.www.watch.player.flashSeekTo};\
		for(var e in yt.www.watch.player) {\
			if(e !== \"flashSeekTo\") player[e] = yt.www.watch.player[e];\
		}\
		yt.www.watch.player = player;\
	} catch(e) {}"

});
