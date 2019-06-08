'use strict';

const { promisify } = require('util');
const blend = promisify(require('@carto/mapnik').blend);
const defaults = require('./defaults');
const getCenterInPixels = require('./center');
const getDimensions = require('./dimensions');
const getTileList = require('./tiles');
const getOffsetList = require('./offsets');

module.exports = abaculus;

async function abaculus (options) {
    const opts = defaults(options);
    const { getTile, bbox, center, dimensions, zoom, scale, format, quality, limit, tileSize } = opts;

    const centerInPixels = getCenterInPixels({ bbox, center, zoom, scale, tileSize });
    const dims = getDimensions({ bbox, dimensions, zoom, scale, tileSize, limit });

    const coordinates = getTileList({ zoom, scale, center: centerInPixels, dimensions: dims, tileSize });
    const offsets = getOffsetList({ zoom, scale, center: centerInPixels, dimensions: dims, tileSize });

    // get tiles based on coordinate list and stitch them together
    const { image, stats } = await abaculus.stitchTiles(coordinates, offsets, dims, format, quality, getTile);

    return { image, stats };
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
