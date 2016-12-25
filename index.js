'use strict';

var _ = require('lodash');
var Client = require('node-tvdb');
var Generic = require('butter-provider');
var inherits = require('util').inherits;
var Q = require('q');
var querystring = require('querystring');
var request = require('request');
var sanitize = require('butter-sanitize');

var tvdb = new Client('7B95D15E1BE1D75A');

var TVApi = function(args) {
	if (!(this instanceof TVApi)) return new TVApi(args);

	var that = this;
	try {
		tvdb.getLanguages().then(function(langlist) {
			that.TVDBLangs = langlist
		});
	} catch (e) {
		that.TVDBLangs = false
		console.warn('Something went wrong with TVDB, overviews can\'t be translated.');
	}

	Generic.call(this, args);

	this.apiURL = this.args.apiURL || ['https://tv-v2.api-fetch.website/'];
	this.translate = args.translate;
	this.language = args.language;
};

inherits(TVApi, Generic);

TVApi.prototype.config = {
	name: 'TVApi',
	uniqueId: 'tvdb_id',
	tabName: 'TVApi',
	type: Generic.TabType.TVSHOW,
	args: {
		apiURL: Generic.ArgType.ARRAY,
    translate: Generic.ArgType.STRING,
    language: Generic.ArgType.STRING
	},
	metadata: 'trakttv:show-metadata'
};

function processCloudFlareHack(options, url) {
	var req = options;
	var match = url.match(/^cloudflare\+(.*):\/\/(.*)/);
	if (match) {
		req = _.extend(req, {
			uri: match[1] + '://cloudflare.com/',
			headers: {
				'Host': match[2],
				'User-Agent': 'Mozilla/5.0 (Linux) AppleWebkit/534.30 (KHTML, like Gecko) PT/3.8.0'
			}
		});
	}
	return req;
};

function get(index, url, that) {
	var deferred = Q.defer();

	var options = {
		url: url,
		json: true
	};

	var req = processCloudFlareHack(options, that.apiURL[index]);
	console.info('Request to TVApi', req.url);
	request(req, function(err, res, data) {
		if (err || res.statusCode >= 400) {
			console.warn('TVApi endpoint \'%s\' failed.', that.apiURL[index]);
			if (index + 1 >= that.apiURL.length) {
				return deferred.reject(err || 'Status Code is above 400');
			} else {
				return get(index + 1, url, that);
			}
		} else if (!data || data.error) {
			err = data ? data.status_message : 'No data returned';
			console.error('TVApi error:', err);
			return deferred.reject(err);
		} else {
			return deferred.resolve(data);
		}
	});

	return deferred.promise;
};

TVApi.prototype.extractIds = function(items) {
	return _.map(items.results, 'imdb_id');
};

TVApi.prototype.fetch = function(filters) {
	var that = this;

	var params = {};
	params.sort = 'seeds';
	params.limit = '50';

	if (filters.keywords) {
		params.keywords = filters.keywords.replace(/\s/g, '% ');
	}

	if (filters.genre) {
		params.genre = filters.genre;
	}

	if (filters.order) {
		params.order = filters.order;
	}

	if (filters.sorter && filters.sorter !== 'popularity') {
		params.sort = filters.sorter;
	}

	filters.page = filters.page ? filters.page : 1;

	var index = 0;
	var url = that.apiURL[index] + 'shows/' + filters.page + '?' + querystring.stringify(params).replace(/%25%20/g, '%20');
	return get(index, url, that).then(function(data) {
		data = data.map(function(entry) {
			entry.type = Generic.ItemType.TVSHOW;
      data.subtitle = {};
			entry.backdrop = entry.images.fanart;
			entry.poster = entry.images.poster;

      return entry;
		});

		return {
			results: sanitize(data),
			hasMore: true
		};
	});
};

TVApi.prototype.detail = function(torrent_id, old_data, debug) {
	var that = this;

	var index = 0;
	var url = that.apiURL[index] + 'show/' + torrent_id;

	return get(index, url, that).then(function(data) {
    data.type = Generic.ItemType.TVSHOW;
    data.subtitle = {};
    data.backdrop = data.images.fanart;
    data.poster = data.images.poster;

		if (that.translate && that.language !== 'en') {
			var langAvailable;
			for (var x = 0; x < that.TVDBLangs.length; x++) {
				if (that.TVDBLangs[x].abbreviation.indexOf(that.language) > -1) {
					langAvailable = true;
					break;
				}
			}

			if (!langAvailable) {
				return sanitize(data);
			} else {
				var reqTimeout = setTimeout(function() {
					return sanitize(data);
				}, 2000);

				console.info('Request to TVDB API: \'%s\' - %s', old_data.title, that.language);
				tvdb.getSeriesAllById(old_data.tvdb_id).then(function(localization) {
					clearTimeout(reqTimeout);
					_.extend(data, {
						synopsis: localization.Overview
					});

					for (var i = 0; i < localization.Episodes.length; i++) {
						for (var j = 0; j < data.episodes.length; j++) {
							if (localization.Episodes[i].id.toString() === data.episodes[j].tvdb_id.toString()) {
								data.episodes[j].overview = localization.Episodes[i].Overview;
								break;
							}
						}
					}

					return sanitize(data);
				}).catch(function(error) {
					return sanitize(data);
				});
			}
		} else {
			return sanitize(data);
		}
	});
};

module.exports = TVApi;
