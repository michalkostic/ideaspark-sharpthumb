const path = require('path');
const url = require('url');

const debug = require('debug')('ideaspark-sharpthumb');
const fs = require('fs-extra');
const sharp = require('sharp');

function trimPathPrefix(inPath) {
  const components = inPath.split('/');

  return components.slice(2).join('/');
}

// resize staticPath and save to cachePath
async function cache(staticPath, cachePath, params) {
  const cacheDir = path.dirname(cachePath);

  try {
    await fs.ensureDir(cacheDir);
    debug(`Created directory for cache file at ${cacheDir}`);
  } catch (err) {
    console.error(err.stack);

    return staticPath;
  }

  debug(`Loading original image from ${staticPath}`);

  const pipeline = await sharp(staticPath);

  const newWidth = params.width ? parseInt(params.width, 10) : null;
  const newHeight = params.height ? parseInt(params.height, 10) : null;

  debug(`Resizing ${cachePath} to ${typeof newWidth === 'number' ? newWidth : '[AUTO SCALE]'}` +
    `x${typeof newHeight === 'number' ? newHeight : '[AUTO SCALE]'}`);

  await pipeline.resize(newWidth, newHeight);

  if (params.flatten) {
    debug(`Flattening ${cachePath}`);
    await pipeline.flatten();
  }

  try {
    await pipeline.toFile(cachePath);

    debug(`Wrote cache file to ${cachePath}`);

    return cachePath;
  } catch (err) {
    console.error('Error caching', staticPath, err);

    return staticPath;
  }
}

// call cache() if staticPath has been modified after cachePath was modified
async function cacheIfStale(staticStat, staticPath, cachePath, params) {
  let cacheStat;

  try {
    cacheStat = await fs.stat(cachePath);
  } catch (err) {
    debug(`Couldn't stat ${cachePath}, will attempt to cache`, err.stack);

    return cache(staticPath, cachePath, params);
  }

  if (staticStat.mtime > cacheStat.mtime) {
    throw new Error('Live file has not been modified and will not be cached');
  }

  return cachePath;
}

// call cacheIfStale() if resize params are set
// otherwise send static static file if it exists and options.serveStatic is true
// otherwise call next()
async function handle(options, req, res, next) {
  const staticUrl = url.parse(req.url).pathname; //decodeURI(req.originalUrl.replace(/\?.*/u, ''));
  const childPath = path.normalize(staticUrl);
  const staticPath = path.join(options.staticDir, childPath);
  const cachePath = path.join(options.cacheDir, safeDirName(req.query), childPath);

  debug("staticUrl: ", staticUrl);
  debug("childPath: ", childPath);
  debug("staticPath: ", staticPath);
  debug("cachePath: ", cachePath);

  let stat;

  try {
    stat = await fs.stat(staticPath);
  } catch (err) {
    debug(childPath, 'next()', err);
    return next();
  }

  if (!stat.isFile()) {
    debug(childPath, 'next()', 'not a file');
    return next();
  }

  let foundPath;

  if (shouldResize(req)) {
    try {
      foundPath = await cacheIfStale(stat, staticPath, cachePath, req.query);
    } catch (err) {
      debug(err.stack);
    }
  }

  if (!foundPath) {
    if (options.serveStatic) {
      foundPath = staticPath;
    } else {
      debug(childPath, 'next()', 'done without needing to do anything');

      return next();
    }
  }

  debug('sending', childPath, foundPath);

  return res.sendFile(foundPath);
}

// wrapper to convert handle() to a middleware function
function middleware(options) {
  return async function (req, res, next) {
    debug(`ideaspark-sharpthumb is attempting to handle ${req.originalUrl}`);
    await handle(options, req, res, next);
  };
}

// convert query params into a directory name
function safeDirName(obj) {
  return JSON.stringify(obj).replace(/([^\w,=])/gu, '').replace(/[\/:*?"<>|]/gu, '');
}

function shouldResize(req) {
  if (req.path.match(/\.svg$/iu)) { // ignore .svg files
    return false;
  }
  if (req.query.width || req.query.height) {
    return true;
  }
}

// express/connect middleware
function staticMiddleware(staticDir, options) {
  const normalizedDir = path.normalize(staticDir);

  const defaults = {
    cacheDir: path.join(normalizedDir, '.cache'),
    serveStatic: false,
    staticDir: normalizedDir,
  };

  const effectiveOpts = Object.assign(defaults, options);

  return middleware(effectiveOpts);
}

module.exports = {
  static: staticMiddleware,
};
