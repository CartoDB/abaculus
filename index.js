'use strict';

const SphericalMercator = require('sphericalmercator');
const queue = require('d3-queue').queue;
const blend = require('@carto/mapnik').blend;
const crypto = require('crypto');

module.exports = abaculus;

function abaculus (arg, callback) {
    const zoom = arg.zoom || 0;
    const scale = arg.scale || 1;
    const getTile = arg.getTile || null;
    const format = arg.format || 'png';
    const quality = arg.quality || null;
    const limit = arg.limit || 19008;
    const tileSize = arg.tileSize || 256;
    const bbox = arg.bbox;
    let center = arg.center;

    if (!getTile) {
        return callback(new Error('Invalid function for getting tiles'));
    }

    if (!center && !bbox) {
        return callback(new Error('No coordinates provided.'));
    }

    if (center) {
        // get center coordinates in px from lng,lat
        center = abaculus.coordsFromCenter(zoom, scale, center, limit, tileSize);
    } else if (bbox) {
        // get center coordinates in px from [w,s,e,n] bbox
        center = abaculus.coordsFromBbox(zoom, scale, bbox, limit, tileSize);
    }

    // generate list of tile coordinates center
    const coords = abaculus.tileList(zoom, scale, center, tileSize);

    // get tiles based on coordinate list and stitch them together
    abaculus.stitchTiles(coords, format, quality, getTile, callback);
}

abaculus.coordsFromBbox = function (z, s, bbox, limit, tileSize) {
    const sphericalMercator = new SphericalMercator({ size: tileSize * s });
    const topRight = sphericalMercator.px([bbox[2], bbox[3]], z);
    const bottomLeft = sphericalMercator.px([bbox[0], bbox[1]], z);
    const center = {};

    center.w = topRight[0] - bottomLeft[0];
    center.h = bottomLeft[1] - topRight[1];

    if (center.w <= 0 || center.h <= 0) {
        throw new Error('Incorrect coordinates');
    }

    const origin = [topRight[0] - center.w / 2, topRight[1] + center.h / 2];
    center.x = origin[0];
    center.y = origin[1];
    center.w = Math.round(center.w * s);
    center.h = Math.round(center.h * s);

    if (center.w >= limit || center.h >= limit) {
        throw new Error('Desired image is too large.');
    }

    return center;
};

abaculus.coordsFromCenter = function (z, s, center, limit, tileSize) {
    const sphericalMercator = new SphericalMercator({ size: tileSize * s });
    const origin = sphericalMercator.px([center.x, center.y], z);

    center.x = origin[0];
    center.y = origin[1];
    center.w = Math.round(center.w * s);
    center.h = Math.round(center.h * s);

    if (center.w >= limit || center.h >= limit) {
        throw new Error('Desired image is too large.');
    }

    return center;
};

// Generate the zxy and px/py offsets needed for each tile in a static image.
// x, y are center coordinates in pixels
abaculus.tileList = function (zoom, scale, center, tileSize) {
    const { x, y, w, h } = center;
    const dimensions = { x: w, y: h };
    const size = tileSize || 256;
    const ts = Math.floor(size * scale);

    const centerCoordinate = {
        column: x / size,
        row: y / size,
        zoom
    };

    const maxTilesInRow = Math.pow(2, zoom);
    const tl = floorObj(pointCoordinate(centerCoordinate, {x: 0, y:0}, w, h, ts));
    const br = floorObj(pointCoordinate(centerCoordinate, dimensions, w, h, ts));
    const coords = {};

    coords.tiles = [];

    for (let column = tl.column; column <= br.column; column++) {
        for (let row = tl.row; row <= br.row; row++) {
            const c = {
                column: column,
                row: row,
                zoom,
            };
            const p = coordinatePoint(zoom, centerCoordinate, c, w, h, ts);

            // Wrap tiles with negative coordinates.
            c.column = c.column % maxTilesInRow;

            if (c.column < 0) {
                c.column = maxTilesInRow + c.column;
            }

            if (c.row < 0 || c.row >= maxTilesInRow) {
                continue;
            }

            coords.tiles.push({
                z: c.zoom,
                x: c.column,
                y: c.row,
                px: Math.round(p.x),
                py: Math.round(p.y)
            });
        }
    }

    coords.dimensions = { x: w, y: h };
    coords.center = floorObj(centerCoordinate);
    coords.scale = scale;

    return coords;
};

function pointCoordinate(centerCoordinate, point, w, h, tileSize) {
    const coord = {
        column: centerCoordinate.column,
        row: centerCoordinate.row,
        zoom: centerCoordinate.zoom,
    };

    coord.column += (point.x - w / 2) / tileSize;
    coord.row += (point.y - h / 2) / tileSize;

    return coord;
}

function coordinatePoint(zoom, centerCoordinate, coord, w, h, tileSize) {
    // Return an x, y point on the map image for a given coordinate.
    if (coord.zoom != zoom) {
        coord = coord.zoomTo(zoom);
    }

    return {
        x: w / 2 + tileSize * (coord.column - centerCoordinate.column),
        y: h / 2 + tileSize * (coord.row - centerCoordinate.row)
    };
}

function floorObj(obj) {
    return {
        row: Math.floor(obj.row),
        column: Math.floor(obj.column),
        zoom: obj.zoom
    };
}


abaculus.stitchTiles = function(coords, format, quality, getTile, callback) {
    if (!coords) {
        return callback(new Error('No coords object.'));
    }

    const tileQueue = queue(32);
    const w = coords.dimensions.x;
    const h = coords.dimensions.y;
    const s = coords.scale;
    const tiles = coords.tiles;

    tiles.forEach(function(t) {
        tileQueue.defer(function(z, x, y, px, py, done) {
            const cb = function(err, buffer, headers, stats) {
                if (err) {
                    return done(err);
                }

                done(err, {
                    buffer: buffer,
                    headers: headers,
                    stats: stats || {},
                    x: px,
                    y: py,
                    reencode: true
                })
            };
            cb.scale = s;
            cb.format = format;
            // getTile is a function that returns
            // a tile given z, x, y, & callback
            getTile(z, x, y, cb);
        }, t.z, t.x, t.y, t.px, t.py);
    });

    function tileQueueFinish(err, data) {
        if (err) {
            return callback(err);
        }

        if (!data) {
            return callback(new Error('No tiles to stitch.'));
        }

        const headers = [];
        data.forEach(function(d) {
            headers.push(d.headers);
        });

        const numTiles = data.length;
        const renderTotal = data
            .map(function(d) {
                return d.stats.render || 0;
            })
            .reduce(function(acc, renderTime) {
                return acc + renderTime;
            }, 0);

        const stats = {
            tiles: numTiles,
            renderAvg: Math.round(renderTotal / numTiles)
        };

        blend(data, {
            format: format,
            quality: quality,
            width: w,
            height: h,
            reencode: true
        }, function(err, buffer) {
            if (err) {
                return callback(err);
            }

            callback(null, buffer, headerReduce(headers, format), stats);
        });
    }

    tileQueue.awaitAll(tileQueueFinish);
};

// Calculate TTL from newest (max mtime) layer.
function headerReduce(headers, format) {
    const minmtime = new Date('Sun, 23 Feb 2014 18:00:00 UTC');
    const composed = {};

    composed['Cache-Control'] = 'max-age=3600';

    switch (format) {
    case 'vector.pbf':
        composed['Content-Type'] = 'application/x-protobuf';
        composed['Content-Encoding'] = 'deflate';
        break;
    case 'jpeg':
        composed['Content-Type'] = 'image/jpeg';
        break;
    case 'png':
        composed['Content-Type'] = 'image/png';
        break;
    }

    const times = headers.reduce(function(memo, h) {
        if (!h) {
            return memo;
        }

        for (const k in h) if (k.toLowerCase() === 'last-modified') {
            memo.push(new Date(h[k]));
            return memo;
        }

        return memo;
    }, []);

    if (!times.length) {
        times.push(new Date());
    } else {
        times.push(minmtime);
    }

    composed['Last-Modified'] = (new Date(Math.max.apply(Math, times))).toUTCString();

    const etag = headers.reduce(function(memo, h) {
        if (!h) {
            return memo;
        }

        for (const k in h) if (k.toLowerCase() === 'etag') {
            memo.push(h[k]);
            return memo;
        }

        return memo;
    }, []);

    if (!etag.length) {
        composed['ETag'] = '"' + crypto.createHash('md5').update(composed['Last-Modified']).digest('hex') + '"';
    } else {
        composed['ETag'] = etag.length === 1 ? etag[0] : '"' + crypto.createHash('md5').update(etag.join(',')).digest('hex') + '"';
    }

    return composed;
}
