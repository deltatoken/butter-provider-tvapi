'use strict';

var _ = require('lodash');
var Generic = require('butter-provider');
var inherits = require('util').inherits;
var Q = require('q');
var querystring = require('querystring');
var request = require('request');
var sanitize = require('butter-sanitize');

var TVApi = function(args) {
	if (!(this instanceof TVApi)) return new TVApi(args);

	Generic.call(this, args);

	this.apiURL = this.args.apiURL || ['https://tv-v2.api-fetch.website/'];
};

inherits(TVApi, Generic);

TVApi.prototype.config = {
	name: 'TVApi',
	uniqueId: 'imdb_id',
	tabName: 'TVApi',
	args: {
		apiURL: Generic.ArgType.ARRAY,
    translate: Generic.ArgType.STRING,
    language: Generic.ArgType.STRING
	},
	metadata: 'trakttv:show-metadata'
};

function formatFetch(shows) {
  var results = _.map(shows, function(show) {
    return {
      imdb_id: show.imdb_id,
      title: show.title,
      year: show.year,
      genres: show.genres,
      rating: parseInt(show.rating.percentage, 10) / 10,
      poster: show.images.poster,
      type: Generic.ItemType.TVSHOW,
      num_seasons: show.num_seasons
    }
  });

  return {
    results: sanitize(results),
    hasMore: true
  };
}

function formatDetail(show) {
  return {
    imdb_id: show.imdb_id,
    title: show.title,
    year: show.year,
    genres: show.genres,
    rating: parseInt(show.rating.percentage, 10) / 10,
    poster: show.images.poster,
    type: Generic.ItemType.TVSHOW,
    num_seasons: show.num_seasons,
    runtime: show.runtime,
    backdrop: show.images.fanart,
    subtitle: {},
    synopsis: show.synopsis,
    status: show.status,
    episodes: show.episodes
  };
}

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
}

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
	return _.map(items.results, this.config.uniqueId);
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
	return get(index, url, that).then(formatFetch);
};

TVApi.prototype.detail = function(torrent_id, old_data, debug) {
	var that = this;
	var index = 0;
	var url = that.apiURL[index] + 'show/' + torrent_id;
	return get(index, url, that).then(formatDetail);
};

TVApi.prototype.random = function () {
	var that = this;
	var index = 0;
	var url = that.apiURL[index] + 'random/show';
	return get(index, url, that).then(formatDetail);
};

module.exports = TVApi;
