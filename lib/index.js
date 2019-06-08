'use strict';

const defaults = require('./defaults');
const getCenterInPixels = require('./center');
const getDimensions = require('./dimensions');
const getTileList = require('./tiles');
const getOffsetList = require('./offsets');
const blend = require('../lib/blend');

module.exports = async function abaculus (options) {
    const opts = defaults(options);
    const { getTile, bbox, center, dimensions, zoom, scale, format, quality, limit, tileSize } = opts;

    const centerInPixels = getCenterInPixels({ bbox, center, zoom, scale, tileSize });
    const dims = getDimensions({ bbox, dimensions, zoom, scale, tileSize, limit });

    const coordinates = getTileList({ zoom, scale, center: centerInPixels, dimensions: dims, tileSize });
    const offsets = getOffsetList({ zoom, scale, center: centerInPixels, dimensions: dims, tileSize });

    // get tiles based on coordinate list and stitch them together
    const { image, stats } = await blend({ coordinates, offsets, dimensions: dims, format, quality, getTile });

    return { image, stats };
}
