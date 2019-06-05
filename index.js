'use strict';

const { promisify } = require('util');
const SphericalMercator = require('sphericalmercator');
const blend = promisify(require('@carto/mapnik').blend);

module.exports = abaculus;

function abaculus (options, callback) {
    if (!options.getTile) {
        return callback(new Error('Invalid function for getting tiles'));
    }

    if (!options.center && !options.bbox) {
        return callback(new Error('No coordinates provided.'));
    }

    const getTile = options.getTile;
    const zoom = options.zoom || 0;
    const scale = options.scale || 1;
    const format = options.format || 'png';
    const quality = options.quality || null;
    const limit = options.limit || 19008;
    const tileSize = options.tileSize || 256;
    const center = options.center ?
        // get center coordinates in px from lng,lat
        abaculus.coordsFromCenter(zoom, scale, options.center, limit, tileSize) :
        // get center coordinates in px from [w,s,e,n] bbox
        abaculus.coordsFromBbox(zoom, scale, options.bbox, limit, tileSize);

    // generate list of tile coordinates center
    const coords = abaculus.tileList(zoom, scale, center, tileSize);

    // get tiles based on coordinate list and stitch them together
    abaculus.stitchTiles(coords, center, format, quality, getTile, callback);
}

abaculus.coordsFromBbox = function (zoom, scale, bbox, limit, tileSize) {
    const sphericalMercator = new SphericalMercator({ size: tileSize * scale });
    const bottomLeft = sphericalMercator.px([bbox[0], bbox[1]], zoom);
    const topRight = sphericalMercator.px([bbox[2], bbox[3]], zoom);
    const width = topRight[0] - bottomLeft[0];
    const height = bottomLeft[1] - topRight[1];

    if (width <= 0 || height <= 0) {
        throw new Error('Incorrect coordinates');
    }

    const coords = {
        x: topRight[0] - width / 2,
        y: topRight[1] + height / 2,
        width: Math.round(width * scale),
        height: Math.round(height * scale)
    };

    if (coords.width >= limit || coords.height >= limit) {
        throw new Error('Desired image is too large.');
    }

    return coords;
};

abaculus.coordsFromCenter = function (zoom, scale, center, limit, tileSize) {
    const sphericalMercator = new SphericalMercator({ size: tileSize * scale });
    const origin = sphericalMercator.px([center.x, center.y], zoom);

    const coords = {
        x: origin[0],
        y: origin[1],
        width: Math.round(center.width * scale),
        height: Math.round(center.height * scale)
    };

    if (coords.width >= limit || coords.height >= limit) {
        throw new Error('Desired image is too large.');
    }

    return coords;
};

// Generate the zxy and px/py offsets needed for each tile in a static image.
// x, y are center coordinates in pixels
abaculus.tileList = function (zoom, scale, center, tileSize = 256) {
    const { x, y, width, height } = center;
    const size = Math.floor(tileSize * scale);

    const centerCoordinate = {
        column: x / tileSize,
        row: y / tileSize,
        zoom
    };

    const maxTilesInRow = Math.pow(2, zoom);
    const topLeft = pointToCoordinate(centerCoordinate, { x: 0, y:0 }, width, height, size);
    const bottomRight = pointToCoordinate(centerCoordinate, { x: width, y: height }, width, height, size);
    const coords = [];

    for (let column = topLeft.column; column <= bottomRight.column; column++) {
        for (let row = topLeft.row; row <= bottomRight.row; row++) {
            if (row < 0 || row >= maxTilesInRow) {
                continue;
            }

            const coord = {
                column: column,
                row: row,
                zoom,
            };
            const point = coordinateToPoint(centerCoordinate, coord, width, height, size);

            // Wrap tiles with negative coordinates.
            coord.column = coord.column % maxTilesInRow;

            if (coord.column < 0) {
                coord.column = maxTilesInRow + coord.column;
            }

            coords.push({
                z: coord.zoom,
                x: coord.column,
                y: coord.row,
                px: Math.round(point.x),
                py: Math.round(point.y)
            });
        }
    }

    return coords;
};

function pointToCoordinate(centerCoordinate, point, width, height, tileSize) {
    const coord = {
        column: Math.floor(centerCoordinate.column + ((point.x - width / 2) / tileSize)),
        row: Math.floor(centerCoordinate.row + ((point.y - height / 2) / tileSize)),
        zoom: centerCoordinate.zoom,
    };

    return coord;
}

function coordinateToPoint(centerCoordinate, coord, width, height, tileSize) {
    const point = {
        x: width / 2 + tileSize * (coord.column - centerCoordinate.column),
        y: height / 2 + tileSize * (coord.row - centerCoordinate.row)
    };

    return point;
}

abaculus.stitchTiles = function (coords, center, format, quality, getTile, callback) {
    if (!coords) {
        return callback(new Error('No coords object.'));
    }

    const { width, height } = center;

    Promise.all(getTiles(coords, getTile))
        .then(tiles => {
            if (!tiles || !tiles.length) {
                throw new Error('No tiles to stitch.');
            }

            const numTiles = tiles.length;
            const renderTotal = tiles.map(tile => tile.stats.render || 0)
                .reduce((acc, renderTime) => acc + renderTime, 0);

            const stats = {
                tiles: numTiles,
                renderAvg: Math.round(renderTotal / numTiles)
            };

            const options = { format, quality, width, height, reencode: true };

            return blend(tiles, options)
                .then(image => callback(null, image, stats));
        })
        .catch(err => callback(err));
};

function getTiles (tileCoords, getTile) {
    const getTilePromisified = promisify(getTile);

    return tileCoords.map(({ z, x, y, px, py }) => getTilePromisified(z, x, y)
        .then((buffer, headers, stats = {}) => ({ buffer, stats, x: px, y: py })));
}
