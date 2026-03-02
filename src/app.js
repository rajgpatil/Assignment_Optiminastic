/**
 * Express Application Setup
 * 
 * Main application configuration including:
 * - Middleware setup
 * - Route registration
 * - Error handling
 * - Health checks
 */

const express = require('express');
const adminRoutes = require('./routes/admin');
const orderRoutes = require('./routes/orders');
const walletRoutes = require('./routes/wallet');
const {
  errorHandler,
  notFoundHandler,
} = require('./middleware/errorHandler');

const app = express();

// ============================================
// MIDDLEWARE SETUP
// ============================================

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request logging middleware (production: use Morgan)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date(),
    uptime: process.uptime(),
  });
});

// ============================================
// API ROUTES
// ============================================

// Admin routes
app.use('/admin', adminRoutes);

// Order routes
app.use('/orders', orderRoutes);

// Wallet routes
app.use('/wallet', walletRoutes);

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler for undefined routes
app.use(notFoundHandler);

// Centralized error handler (must be last)
app.use(errorHandler);

module.exports = app;
