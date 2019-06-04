'use strict';

const SphericalMercator = require('sphericalmercator');
const queue = require('d3-queue').queue;
const blend = require('@carto/mapnik').blend;
const crypto = require('crypto');

module.exports = abaculus;

function abaculus (options, callback) {
    const zoom = options.zoom || 0;
    const scale = options.scale || 1;
    const getTile = options.getTile || null;
    const format = options.format || 'png';
    const quality = options.quality || null;
    const limit = options.limit || 19008;
    const tileSize = options.tileSize || 256;
    const bbox = options.bbox;
    let center = options.center;

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

abaculus.coordsFromBbox = function (zoom, scale, bbox, limit, tileSize) {
    const sphericalMercator = new SphericalMercator({ size: tileSize * scale });
    const bottomLeft = sphericalMercator.px([bbox[0], bbox[1]], zoom);
    const topRight = sphericalMercator.px([bbox[2], bbox[3]], zoom);
    const center = {};

    center.width = topRight[0] - bottomLeft[0];
    center.height = bottomLeft[1] - topRight[1];

    if (center.width <= 0 || center.height <= 0) {
        throw new Error('Incorrect coordinates');
    }

    const origin = [topRight[0] - center.width / 2, topRight[1] + center.height / 2];
    center.x = origin[0];
    center.y = origin[1];
    center.width = Math.round(center.width * scale);
    center.height = Math.round(center.height * scale);

    if (center.width >= limit || center.height >= limit) {
        throw new Error('Desired image is too large.');
    }

    return center;
};

abaculus.coordsFromCenter = function (zoom, scale, center, limit, tileSize) {
    const sphericalMercator = new SphericalMercator({ size: tileSize * scale });
    const origin = sphericalMercator.px([center.x, center.y], zoom);

    center.x = origin[0];
    center.y = origin[1];
    center.width = Math.round(center.width * scale);
    center.height = Math.round(center.height * scale);

    if (center.width >= limit || center.height >= limit) {
        throw new Error('Desired image is too large.');
    }

    return center;
};

// Generate the zxy and px/py offsets needed for each tile in a static image.
// x, y are center coordinates in pixels
abaculus.tileList = function (zoom, scale, center, tileSize = 256) {
    const { x, y, width, height } = center;
    const dimensions = { x: width, y: height };
    const size = Math.floor(tileSize * scale);

    const centerCoordinate = {
        column: x / tileSize,
        row: y / tileSize,
        zoom
    };

    const maxTilesInRow = Math.pow(2, zoom);
    const topLeft = floorObj(pointCoordinate(centerCoordinate, { x: 0, y:0 }, width, height, size));
    const bottomRight = floorObj(pointCoordinate(centerCoordinate, dimensions, width, height, size));
    const coords = {};

    coords.tiles = [];

    for (let column = topLeft.column; column <= bottomRight.column; column++) {
        for (let row = topLeft.row; row <= bottomRight.row; row++) {
            const coord = {
                column: column,
                row: row,
                zoom,
            };
            const point = coordinatePoint(zoom, centerCoordinate, coord, width, height, size);

            // Wrap tiles with negative coordinates.
            coord.column = coord.column % maxTilesInRow;

            if (coord.column < 0) {
                coord.column = maxTilesInRow + coord.column;
            }

            if (coord.row < 0 || coord.row >= maxTilesInRow) {
                continue;
            }

            coords.tiles.push({
                z: coord.zoom,
                x: coord.column,
                y: coord.row,
                px: Math.round(point.x),
                py: Math.round(point.y)
            });
        }
    }

    coords.dimensions = { x: width, y: height };
    coords.center = floorObj(centerCoordinate);
    coords.scale = scale;

    return coords;
};

function pointCoordinate(centerCoordinate, point, width, height, tileSize) {
    const coord = {
        column: centerCoordinate.column,
        row: centerCoordinate.row,
        zoom: centerCoordinate.zoom,
    };

    coord.column += (point.x - width / 2) / tileSize;
    coord.row += (point.y - height / 2) / tileSize;

    return coord;
}

function coordinatePoint(zoom, centerCoordinate, coord, width, height, tileSize) {
    // Return an x, y point on the map image for a given coordinate.
    if (coord.zoom != zoom) {
        coord = coord.zoomTo(zoom);
    }

    return {
        x: width / 2 + tileSize * (coord.column - centerCoordinate.column),
        y: height / 2 + tileSize * (coord.row - centerCoordinate.row)
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
    const width = coords.dimensions.x;
    const height = coords.dimensions.y;
    const scale = coords.scale;
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
            cb.scale = scale;
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
            width: width,
            height: height,
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
