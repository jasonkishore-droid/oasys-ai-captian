const { ZodError } = require('zod');
const logger = require('./logger');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

const notFound = (what) => new HttpError(404, `${what} not found`);

// Parse a route param as a positive integer id.
const idParam = (value, what = 'Record') => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw notFound(what);
  return id;
};

const UNIQUE = new Set(['SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY', '23505']);
const FOREIGN = new Set(['SQLITE_CONSTRAINT_FOREIGNKEY', '23503']);

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue.path.join('.');
    return res.status(400).json({ error: field ? `${field}: ${issue.message}` : issue.message, details: err.issues });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  if (UNIQUE.has(err.code)) return res.status(409).json({ error: 'A record with that name already exists' });
  if (FOREIGN.has(err.code)) return res.status(409).json({ error: 'This record is linked to other records and cannot be changed that way' });
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message, ...(err.details && { details: err.details }) });
  }
  (req.log || logger).error({ err }, 'Unhandled error');
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Internal server error' });
}

module.exports = { HttpError, notFound, idParam, errorHandler };
