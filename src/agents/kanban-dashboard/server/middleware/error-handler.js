function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[${new Date().toISOString()}] ${status} ${req.method} ${req.path}: ${message}`);

  res.status(status).json({
    error: true,
    message,
    status
  });
}

module.exports = { asyncHandler, errorHandler };
