/**
 * Error Handler Middleware
 * 
 * Centralized error handling for:
 * - Custom application errors
 * - MongoDB/Mongoose errors
 * - Unexpected errors
 * - Proper HTTP status codes
 * - Consistent error response format
 * 
 * Design pattern: Error classes extend base Error
 * Middleware catches all errors and formats response
 */

// ============================================
// CUSTOM ERROR CLASSES
// ============================================

class ApplicationError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || 'INTERNAL_ERROR';
    this.timestamp = new Date();
  }
}

class ValidationError extends ApplicationError {
  constructor(message) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

class AuthenticationError extends ApplicationError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends ApplicationError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends ApplicationError {
  constructor(message) {
    super(message, 404, 'NOT_FOUND');
  }
}

class ConflictError extends ApplicationError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

class InsufficientBalanceError extends ApplicationError {
  constructor(message) {
    super(message, 402, 'INSUFFICIENT_BALANCE');
  }
}

class ExternalAPIError extends ApplicationError {
  constructor(message, originalError) {
    super(message, 502, 'EXTERNAL_API_ERROR');
    this.originalError = originalError;
  }
}

class RateLimitError extends ApplicationError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// ============================================
// ERROR HANDLER MIDDLEWARE
// ============================================

const errorHandler = (err, req, res, next) => {
  // Default error properties
  let error = {
    statusCode: err.statusCode || 500,
    code: err.code || 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected error occurred',
    timestamp: err.timestamp || new Date(),
  };

  // Log error details (for debugging and monitoring)
  const logLevel = error.statusCode >= 500 ? 'error' : 'warn';
  console.log(`[${logLevel.toUpperCase()}] ${error.code} - ${error.message}`);
  
  if (error.statusCode >= 500) {
    console.error('Stack trace:', err.stack);
  }

  // Handle MongoDB/Mongoose specific errors
  if (err.name === 'ValidationError') {
    error.statusCode = 400;
    error.code = 'MONGOOSE_VALIDATION_ERROR';
    const messages = Object.values(err.errors).map(e => e.message);
    error.message = messages.join(', ');
  } else if (err.name === 'CastError') {
    error.statusCode = 400;
    error.code = 'INVALID_ID_FORMAT';
    error.message = `Invalid ID format: ${err.value}`;
  } else if (err.name === 'MongoServerError' && err.code === 11000) {
    // Duplicate key error
    const field = Object.keys(err.keyPattern)[0];
    error.statusCode = 409;
    error.code = 'DUPLICATE_ENTRY';
    error.message = `Duplicate value for field: ${field}`;
  } else if (err.name === 'MongoNetworkError') {
    error.statusCode = 503;
    error.code = 'DATABASE_CONNECTION_ERROR';
    error.message = 'Database temporarily unavailable';
  }

  // Ensure statusCode is valid
  if (error.statusCode < 100 || error.statusCode > 599) {
    error.statusCode = 500;
  }

  // Send error response
  res.status(error.statusCode).json({
    success: false,
    error: {
      code: error.code,
      message: error.message,
      timestamp: error.timestamp,
    },
  });
};

// ============================================
// ASYNC ERROR WRAPPER
// ============================================

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ============================================
// 404 HANDLER
// ============================================

const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.originalUrl} not found`,
    },
  });
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFoundHandler,
  ApplicationError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  InsufficientBalanceError,
  ExternalAPIError,
  RateLimitError,
};
