'use strict';

const SphericalMercator = require('sphericalmercator');

module.exports = function getDimensions ({ dimensions, bbox, zoom, scale, tileSize, limit }) {
    return bbox ?
        getDimensionsFromBbox({ bbox, zoom, scale, tileSize, limit }) :
        scaleDimensions({ dimensions, scale, limit });
};

function getDimensionsFromBbox ({ bbox, zoom, scale, tileSize, limit }) {
    const sphericalMercator = new SphericalMercator({ size: tileSize * scale });
    const bottomLeft = sphericalMercator.px([bbox[0], bbox[1]], zoom);
    const topRight = sphericalMercator.px([bbox[2], bbox[3]], zoom);

    let width = topRight[0] - bottomLeft[0];
    let height = bottomLeft[1] - topRight[1];

    if (width <= 0 || height <= 0) {
        throw new Error('Incorrect coordinates');
    }

    width = Math.round(width * scale);
    height = Math.round(height * scale);

    if (width >= limit || height >= limit) {
        throw new Error('Desired image is too large.');
    }

    return { width, height };
}

function scaleDimensions ({ dimensions, scale, limit }) {
    const { width: _width, height: _height } = dimensions;

    const width = Math.round(_width * scale);
    const height = Math.round(_height * scale);

    if (width >= limit || height >= limit) {
        throw new Error('Desired image is too large.');
    }

    return { width, height };
}
