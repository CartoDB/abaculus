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

abaculus.stitchTiles = function (coords, format, quality, getTile, callback) {
    if (!coords) {
        return callback(new Error('No coords object.'));
    }

    const width = coords.dimensions.x;
    const height = coords.dimensions.y;
    const tileCoords = coords.tiles;

    Promise.all(getTiles(tileCoords, getTile))
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
                .then(preview => callback(null, preview, stats));
        })
        .catch(err => callback(err));
};

function getTiles (tileCoords, getTile) {
    const getTilePromisified = promisify(getTile);

    return tileCoords.map(({ z, x, y, px, py }) => getTilePromisified(z, x, y)
        .then((buffer, headers, stats = {}) => ({ buffer, headers, stats, x: px, y: py, reencode: true })));
}
