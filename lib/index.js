'use strict';

const { promisify } = require('util');
const blend = promisify(require('@carto/mapnik').blend);
const defaults = require('./defaults');
const getCenterInPixels = require('./center');
const getDimensions = require('./dimensions');

module.exports = abaculus;

async function abaculus (options) {
    const opts = defaults(options);
    const { getTile, bbox, center, dimensions, zoom, scale, format, quality, limit, tileSize } = opts;

    const centerInPixels = getCenterInPixels({ bbox, center, zoom, scale, tileSize });
    const dims = getDimensions({ dimensions, bbox, zoom, scale, tileSize, limit });

    const coordinates = abaculus.tileList(zoom, scale, centerInPixels, dims, tileSize);
    const offsets = abaculus.offsetList(zoom, scale, centerInPixels, dims, tileSize);

    // get tiles based on coordinate list and stitch them together
    const { image, stats } = await abaculus.stitchTiles(coordinates, offsets, dims, format, quality, getTile);

    return { image, stats };
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
