'use strict';

var assert = require('assert');
var printer = require('../');
var fs = require('fs');
var path = require('path');
var mapnik = require('@carto/mapnik');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

// defaults
var zoom = 5,
    scale = 4,
    x = 4096,
    y = 4096,
    quality = 256,
    format = 'png',
    limit = 19008,
    tileSize = 256;

// fixtures
var tiles = fs.readdirSync(path.resolve(__dirname + '/fixtures/')).reduce(function(memo, basename) {
    var key = basename.split('.').slice(0, 4).join('.');
    memo[key] = fs.readFileSync(path.resolve(__dirname + '/fixtures/' + basename));
    return memo;
}, {});

describe('Get center from bbox', function() {
    it('should fail if (x1, y1) and (x2,y2) are equal', function() {
        var bbox = [0, 0, 0, 0];

        assert.throws( function() {
            printer.getDimensionsFromBbox(bbox, zoom, scale, tileSize, limit);
        }, /Incorrect coordinates/);
    });
    it('should fail if the image is too large', function() {
        var bbox = [-60, -60, 60, 60];
        const zoom = 7;
        const scale = 2;

        assert.throws( function() {
            printer.getDimensionsFromBbox(bbox, zoom, scale, tileSize, limit);
        }, /Desired image is too large./);
    });

    it('should return the correct coordinates', function() {
        var bbox = [-60, -60, 60, 60];
        var scale = 1;

        const center = printer.getDimensionsFromBbox(bbox, zoom, scale, tileSize, limit);
        const dimensions = printer.getCenterInPixelsFromBbox(bbox, zoom, scale, tileSize);

        assert.deepEqual(center.width, 2730);
        assert.deepEqual(center.height, 3434);
        assert.deepEqual(dimensions.x, x);
        assert.deepEqual(dimensions.y, y);
    });
});

describe('get coordinates from center', function() {
    it('should should fail if the image is too large', function() {
        var center = {
            x: 0,
            y: 0
        };
        var dimensions = {
            width: 4752,
            height: 4752
        };
        assert.throws(function () {
            printer.scaleDimensions(dimensions, scale, limit);
        }, /Desired image is too large./);
    });
    it('should return correct origin coords', function() {
        var scale = 1;
        var center = {
            x: 0,
            y: 20
        };
        center = printer.getCenterInPixels(center, zoom, scale, tileSize);
        assert.equal(center.x, x);
        assert.equal(center.y, 3631);
    });
    it('should return correct origin coords for negative y', function() {
        var scale = 1;
        var zoom = 2;
        var center = {
            x: 39,
            y: -14
        };

        center = printer.getCenterInPixels(center, zoom, scale, tileSize);

        assert.equal(center.x, 623);
        assert.equal(center.y, 552);
    });
});

describe('create list of tile coordinates', function() {
    it('should return a valid coordinates object', function() {
        var zoom = 5,
            scale = 4,
            width = 1824,
            height = 1832,
            center = { x: 4096, y: 4096 },
            dimensions = { width, height };

        var expectedCoords = [
            { z: zoom, x: 15, y: 15 },
            { z: zoom, x: 15, y: 16 },
            { z: zoom, x: 16, y: 15 },
            { z: zoom, x: 16, y: 16 }
        ];
        var coords = printer.tileList(zoom, scale, center, dimensions, tileSize);
        assert.deepEqual(JSON.stringify(coords), JSON.stringify(expectedCoords));
    });

    it('should return a valid offsets object', function() {
        var zoom = 5,
            scale = 4,
            width = 1824,
            height = 1832,
            center = { x: 4096, y: 4096 },
            dimensions = { width, height };

        var expectedOffsets = [
            { x: -112, y: -108 },
            { x: -112, y: 916 },
            { x: 912, y: -108 },
            { x: 912, y: 916 }
        ];

        var offsets = printer.offsetList(zoom, scale, center, dimensions, tileSize);
        assert.deepEqual(JSON.stringify(offsets), JSON.stringify(expectedOffsets));
    });

    it('should return a valid coordinates object when image exceeds y coords', function() {
        var zoom = 2,
            scale = 1,
            width = 1000,
            height = 1000,
            center = {x: 623, y: 552 },
            dimensions = { width, height };

        var expectedCoords = [
            { z: zoom, x: 0, y: 0 },
            { z: zoom, x: 0, y: 1 },
            { z: zoom, x: 0, y: 2 },
            { z: zoom, x: 0, y: 3 },
            { z: zoom, x: 1, y: 0 },
            { z: zoom, x: 1, y: 1 },
            { z: zoom, x: 1, y: 2 },
            { z: zoom, x: 1, y: 3 },
            { z: zoom, x: 2, y: 0 },
            { z: zoom, x: 2, y: 1 },
            { z: zoom, x: 2, y: 2 },
            { z: zoom, x: 2, y: 3 },
            { z: zoom, x: 3, y: 0 },
            { z: zoom, x: 3, y: 1 },
            { z: zoom, x: 3, y: 2 },
            { z: zoom, x: 3, y: 3 },
            { z: zoom, x: 0, y: 0 },
            { z: zoom, x: 0, y: 1 },
            { z: zoom, x: 0, y: 2 },
            { z: zoom, x: 0, y: 3 }
        ];

        var coords = printer.tileList(zoom, scale, center, dimensions, tileSize);
        assert.deepEqual(JSON.stringify(coords), JSON.stringify(expectedCoords));
    });

    it('should return a valid offsets object when image exceeds y coords', function() {
        var zoom = 2,
            scale = 1,
            width = 1000,
            height = 1000,
            center = {x: 623, y: 552 },
            dimensions = { width, height };

        var expectedOffsets = [
            { x: -123, y: -52 },
            { x: -123, y: 204 },
            { x: -123, y: 460 },
            { x: -123, y: 716 },
            { x:  133, y: -52 },
            { x:  133, y: 204 },
            { x:  133, y: 460 },
            { x:  133, y: 716 },
            { x:  389, y: -52 },
            { x:  389, y: 204 },
            { x:  389, y: 460 },
            { x:  389, y: 716 },
            { x:  645, y: -52 },
            { x:  645, y: 204 },
            { x:  645, y: 460 },
            { x:  645, y: 716 },
            { x:  901, y: -52 },
            { x:  901, y: 204 },
            { x:  901, y: 460 },
            { x:  901, y: 716 }
        ];

        var offsets = printer.offsetList(zoom, scale, center, dimensions, tileSize);
        assert.deepEqual(JSON.stringify(offsets), JSON.stringify(expectedOffsets));
    });

    it('should return a valid coordinates object when image is much bigger than world', function() {
        var zoom = 1,
            scale = 1,
            width = 2000,
            height = 2100,
            center = { x: 100, y: 100 },
            dimensions = { width, height };

        var expectedCoords = [
            { z: zoom, x: 0, y: 0 },
            { z: zoom, x: 0, y: 1 },
            { z: zoom, x: 1, y: 0 },
            { z: zoom, x: 1, y: 1 },
            { z: zoom, x: 0, y: 0 },
            { z: zoom, x: 0, y: 1 },
            { z: zoom, x: 1, y: 0 },
            { z: zoom, x: 1, y: 1 },
            { z: zoom, x: 0, y: 0 },
            { z: zoom, x: 0, y: 1 },
            { z: zoom, x: 1, y: 0 },
            { z: zoom, x: 1, y: 1 },
            { z: zoom, x: 0, y: 0 },
            { z: zoom, x: 0, y: 1 },
            { z: zoom, x: 1, y: 0 },
            { z: zoom, x: 1, y: 1 },
            { z: zoom, x: 0, y: 0 },
            { z: zoom, x: 0, y: 1 }
        ];

        var coords = printer.tileList(zoom, scale, center, dimensions, tileSize);
        assert.deepEqual(JSON.stringify(coords), JSON.stringify(expectedCoords));
    });

    it('should return a valid offsets object when image is much bigger than world', function() {
        var zoom = 1,
            scale = 1,
            width = 2000,
            height = 2100,
            center = { x: 100, y: 100 },
            dimensions = { width, height };

        var expectedOffsets = [
            { x: -124, y: 950 },
            { x: -124, y: 1206 },
            { x: 132, y: 950 },
            { x: 132, y: 1206 },
            { x: 388, y: 950 },
            { x: 388, y: 1206 },
            { x: 644, y: 950 },
            { x: 644, y: 1206 },
            { x: 900, y: 950 },
            { x: 900, y: 1206 },
            { x: 1156, y: 950 },
            { x: 1156, y: 1206 },
            { x: 1412, y: 950 },
            { x: 1412, y: 1206 },
            { x: 1668, y: 950 },
            { x: 1668, y: 1206 },
            { x: 1924, y: 950 },
            { x: 1924, y: 1206 }
        ];

        var offsets = printer.offsetList(zoom, scale, center, dimensions, tileSize);
        assert.deepEqual(JSON.stringify(offsets), JSON.stringify(expectedOffsets));
    });

    it('should return a valid coordinates object when image is smaller than world', function () {
        var zoom = 1,
            scale = 1,
            width = 256,
            height = 256,
            center = { x: 256, y: 256 },
            dimensions = { width, height };

        var expectedCoords = [
            { z: 1, x: 0, y: 0 },
            { z: 1, x: 0, y: 1 },
            { z: 1, x: 1, y: 0 },
            { z: 1, x: 1, y: 1 }
        ];

        var coords = printer.tileList(zoom, scale, center, dimensions, tileSize);

        assert.deepEqual(JSON.stringify(coords), JSON.stringify(expectedCoords));
    });

    it('should return a valid offset object when image is smaller than world', function () {
        var zoom = 1,
            scale = 1,
            width = 256,
            height = 256,
            center = { x: 256, y: 256 },
            dimensions = { width, height };

        var expectedOffset = [
            { x: -128, y: -128 },
            { x: -128, y: 128 },
            { x: 128, y: -128 },
            { x: 128, y: 128 }
        ];

        var offsets = printer.offsetList(zoom, scale, center, dimensions, tileSize);

        assert.deepEqual(JSON.stringify(offsets), JSON.stringify(expectedOffset));
    });

});

[256, 512, 1024].forEach(function(size) {
    describe('stitch tiles into single png', function() {
        var coords = [
            { z: 1, x: 0, y: 0 },
            { z: 1, x: 0, y: 1 },
            { z: 1, x: 1, y: 0 },
            { z: 1, x: 1, y: 1 }
        ];

        var offsets = [
            { x: 0, y: 0 },
            { x: 0, y: size },
            { x: size, y: 0 },
            { x: size, y: size }
        ]

        var center = {
            width: size * 2,
            height: size * 2
        }

        it('should fail if no coordinates object', async function () {
            try {
                await printer.stitchTiles(null, null, center, format, quality, function() {});
                throw new Error('Should not throw');
            } catch (err) {
                assert.equal(err.message, 'No coords object.');
            };
        });

        it('should return tiles and stitch them together', async function () {
            var expectedImage = await readFile(path.resolve(__dirname + '/expected/expected.' + size + '.png'));

            const { image } = await printer.stitchTiles(coords, offsets, center, format, quality, getTileTest);

            await writeFile(__dirname + '/outputs/expected.' + size + '.png', image);

            checkImage(image, expectedImage);
        });
    });

    describe('run entire function', function() {
        it('stitches images with a center coordinate', async function () {
            var expectedImage = await readFile(path.resolve(__dirname + '/expected/center.' + size + '.png'));

            var params = {
                zoom: 1,
                scale: 1,
                center: {
                    x: 0,
                    y: 0
                },
                dimensions: {
                    width: 200,
                    height: 200
                },
                format: 'png',
                quality: 50,
                tileSize: size,
                getTile: getTileTest
            };

            const { image } = await printer(params);

            await writeFile(__dirname + '/outputs/center.' + size + '.png', image);

            console.log('\tVisually check image at '+ __dirname + '/outputs/center.' + size + '.png');

            // byte by byte check of image:
            checkImage(image, expectedImage);
        });

        it('stitches images with a wsen bbox', async function () {
            var expectedImage = await readFile(path.resolve(__dirname + '/expected/bbox.' + size + '.png'));

            var params = {
                zoom: 1,
                scale: 1,
                bbox: [-140, -80, 140, 80],
                format: 'png',
                quality: 50,
                tileSize: size,
                getTile: getTileTest
            };

            const { image } = await printer(params);

            writeFile(__dirname + '/outputs/bbox.' + size + '.png', image);

            console.log('\tVisually check image at '+ __dirname + '/outputs/bbox.'+ size +'.png');

            // byte by byte check of image:
            checkImage(image, expectedImage);
        })
    });

    // This approximates a tilelive's getTile function
    // (https://github.com/mapbox/tilelive-vector/blob/master/index.js#L119-L218)
    // by loading a series of local png tiles
    // and returning the tile requested with the x, y, & z,
    // parameters along with the appropriate headers
    function getTileTest(z, x, y, callback) {
        var key = [z, x, y, size].join('.');

        // Headers.
        var headers = {
            'Last-Modified': new Date().toUTCString(),
            'ETag':'73f12a518adef759138c142865287a18',
            'Content-Type':'application/x-protobuf'
        };

        if (!tiles[key]) {
            return callback(new Error('Tile does not exist'));
        } else {
            return callback(null, tiles[key], headers);
        }
    }

    function checkImage(actual, expected) {
        actual = new mapnik.Image.fromBytes(actual);
        expected = new mapnik.Image.fromBytes(expected);
        var max_diff_pixels = 0;
        var compare_alpha = true;
        var threshold = 16;
        var diff_pixels = actual.compare(expected, {
            threshold: threshold,
            alpha: compare_alpha
        });
        if (diff_pixels > max_diff_pixels) {
            expected.save('test/outputs/center.fail.png');
        }
        assert.equal(max_diff_pixels, diff_pixels);
    }

});
