'use strict';

const { promisify } = require('util');
const SphericalMercator = require('sphericalmercator');
const blend = promisify(require('@carto/mapnik').blend);

module.exports = abaculus;

async function abaculus (options) {
    const opts = defaults(options);
    const { zoom, scale, format, quality, limit, tileSize } = opts;

    const center = options.bbox ?
        // get center coordinates in px from [w,s,e,n] bbox
        abaculus.getCenterInPixelsFromBbox(options.bbox, zoom, scale, tileSize) :
        // get center coordinates in px from lng,lat
        abaculus.getCenterInPixels(options.center, zoom, scale, tileSize);

    const dimensions = options.bbox ?
        abaculus.getDimensionsFromBbox(options.bbox, zoom, scale, tileSize, limit) :
        abaculus.scaleDimensions(options.dimensions, scale, limit);

    const coordinates = abaculus.tileList(zoom, scale, center, dimensions, tileSize);
    const offsets = abaculus.offsetList(zoom, scale, center, dimensions, tileSize);

    // get tiles based on coordinate list and stitch them together
    const { image, stats } = await abaculus.stitchTiles(coordinates, offsets, dimensions, format, quality, options.getTile);

    return { image, stats };
}

function defaults (options) {
    if (!options.getTile) {
        throw new Error('Invalid function for getting tiles');
    }

    if (!options.center && !options.bbox) {
        throw new Error('No coordinates provided.');
    }

    const getTile = options.getTile;
    const zoom = options.zoom || 0;
    const scale = options.scale || 1;
    const format = options.format || 'png';
    const quality = options.quality || null;
    const limit = options.limit || 19008;
    const tileSize = options.tileSize || 256;

    return { getTile, zoom, scale, format, quality, limit, tileSize };
}

abaculus.getCenterInPixelsFromBbox = function (bbox, zoom, scale, tileSize) {
    const sphericalMercator = new SphericalMercator({ size: tileSize * scale });
    const bottomLeft = sphericalMercator.px([bbox[0], bbox[1]], zoom);
    const topRight = sphericalMercator.px([bbox[2], bbox[3]], zoom);
    const width = topRight[0] - bottomLeft[0];
    const height = bottomLeft[1] - topRight[1];

    return {
        x: topRight[0] - width / 2,
        y: topRight[1] + height / 2
    };
};

abaculus.getCenterInPixels = function (center, zoom, scale, tileSize) {
    const sphericalMercator = new SphericalMercator({ size: tileSize * scale });
    const centerInPx = sphericalMercator.px([center.x, center.y], zoom);

    return {
        x: centerInPx[0],
        y: centerInPx[1],
    };
};

abaculus.getDimensionsFromBbox = function (bbox, zoom, scale, tileSize, limit) {
    const sphericalMercator = new SphericalMercator({ size: tileSize * scale });
    const bottomLeft = sphericalMercator.px([bbox[0], bbox[1]], zoom);
    const topRight = sphericalMercator.px([bbox[2], bbox[3]], zoom);

    let width = topRight[0] - bottomLeft[0];
    let height = bottomLeft[1] - topRight[1];

    if (width <= 0 || height <= 0) {
        throw new Error('Incorrect coordinates');
    }

    width = Math.round(width * scale),
    height = Math.round(height * scale)

    if (width >= limit || height >= limit) {
        throw new Error('Desired image is too large.');
    }

    return { width, height };
}

abaculus.scaleDimensions = function (dimensions, scale, limit) {
    const { width: _width, height: _height } = dimensions;

    const width = Math.round(_width * scale);
    const height = Math.round(_height * scale);

    if (width >= limit || height >= limit) {
        throw new Error('Desired image is too large.');
    }

    return { width, height };
}

abaculus.tileList = function (zoom, scale, center, dimensions, tileSize) {
    const maxTilesInRow = Math.pow(2, zoom);

    return coordinates(zoom, scale, center, dimensions, tileSize).map((coordinate) => {
        const tileCoordinates = {
            column: coordinate.x,
            row: coordinate.y
        };

        // Wrap tiles with negative coordinates
        tileCoordinates.column = tileCoordinates.column % maxTilesInRow;

        if (tileCoordinates.column < 0) {
            tileCoordinates.column = maxTilesInRow + tileCoordinates.column;
        }

        return {
            z: zoom,
            x: tileCoordinates.column,
            y: tileCoordinates.row
        };
    });
};

abaculus.offsetList = function (zoom, scale, center, dimensions, tileSize) {
    return coordinates(zoom, scale, center, dimensions, tileSize).map((coordinate) => {
        const tileCoordinates = {
            column: coordinate.x,
            row: coordinate.y
        };

        const pointOffsetInPixels = getOffsetFromCenterInPixels(center, tileCoordinates, dimensions, tileSize, scale);

        return {
            x: pointOffsetInPixels.x,
            y: pointOffsetInPixels.y
        };
    });
};

function coordinates (zoom, scale, center, dimensions, tileSize) {
    const { width, height } = dimensions;
    const topLeft = getTileCoordinateFromPointInPixels(center, { x: 0, y:0 }, dimensions, tileSize, scale, zoom);
    const bottomRight = getTileCoordinateFromPointInPixels(center, { x: width, y: height }, dimensions, tileSize, scale, zoom);
    const coords = [];

    for (let column = topLeft.column; column <= bottomRight.column; column++) {
        for (let row = topLeft.row; row <= bottomRight.row; row++) {
            coords.push({
                x: column,
                y: row
            });
        }
    }

    if (!coords.length) {
        throw new Error('No coords object');
    }

    return coords;
}

function getTileCoordinateFromPointInPixels (center, point, dimensions, tileSize, scale, zoom) {
    const size = Math.floor(tileSize * scale);
    const maxTilesInRow = Math.pow(2, zoom);
    const centerTileCoordinates = pointToTile(center, tileSize);

    const tileCordinateOffset = {
        column: (point.x - dimensions.width / 2) / size,
        row: (point.y - dimensions.height / 2) / size
    };

    const tileCoordinate = {
        column: Math.floor(centerTileCoordinates.column + tileCordinateOffset.column),
        row: Math.floor(centerTileCoordinates.row + tileCordinateOffset.row)
    };

    if (tileCoordinate.row < 0) {
        tileCoordinate.row = 0;
    }

    if (tileCoordinate.row >= maxTilesInRow) {
        tileCoordinate.row = maxTilesInRow - 1;
    }

    return tileCoordinate;
}

function getOffsetFromCenterInPixels (center, tileCoordinates, dimensions, tileSize, scale) {
    const size = Math.floor(tileSize * scale);
    const centerTileCoordinates = pointToTile(center, tileSize);

    const offsetInPixels = {
        x: Math.round(dimensions.width / 2 + size * (tileCoordinates.column - centerTileCoordinates.column)),
        y: Math.round(dimensions.height / 2 + size * (tileCoordinates.row - centerTileCoordinates.row))
    };

    return offsetInPixels;
}

function pointToTile (point, tileSize) {
    return {
        column: point.x / tileSize,
        row: point.y / tileSize
    };
}

abaculus.stitchTiles = async function (coords, offsets, dimensions, format, quality, getTile) {
    const tiles = await Promise.all(getTiles(coords, getTile));

    if (!tiles || !tiles.length) {
        throw new Error('No tiles to stitch');
    }

    const stats = calculateStats(tiles);
    const image = await blendTiles(tiles, offsets, dimensions, format, quality);

    return { image, stats };
};

function calculateStats (tiles) {
    const numTiles = tiles.length;
    const renderTotal = tiles.map(tile => tile.stats.render || 0)
        .reduce((acc, renderTime) => acc + renderTime, 0);

    const stats = {
        tiles: numTiles,
        renderAvg: Math.round(renderTotal / numTiles)
    };

    return stats;
}

async function blendTiles (tiles, offsets, dimensions, format, quality) {
    const buffers = tiles
        .map((tile) => tile.buffer)
        .map((buffer, index) => ({ buffer, ...offsets[index] }));

    const { width, height } = dimensions;
    const options = { format, quality, width, height, reencode: true };

    const image = await blend(buffers, options);

    return image;
}

function getTiles (tileCoords, getTile) {
    const getTilePromisified = promisify(getTile);

    return tileCoords.map(({ z, x, y }) => getTilePromisified(z, x, y)
        .then((tile, headers, stats = {}) => ({ buffer: tile, stats })));
}
