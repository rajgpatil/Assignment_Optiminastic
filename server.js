/**
 * Main Server Entry Point
 * 
 * Initializes:
 * - MongoDB connection
 * - Express server
 * - Graceful shutdown
 */

require('dotenv').config();

const app = require('./src/app');
const { connectDB, disconnectDB } = require('./src/config/database');

const PORT = process.env.PORT || 3000;

let server;

/**
 * Start server
 */
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start Express server
    server = app.listen(PORT, () => {
      console.log(`
    Server running on http://localhost:${PORT}
    Environment: ${process.env.NODE_ENV || 'development'}                             
    Database: ${process.env.MONGODB_URI}          
      `);
    });

    // Graceful shutdown handlers
    setupGracefulShutdown();
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
};

/**
 * Setup graceful shutdown
 * Close database connection and server on signals
 */
const setupGracefulShutdown = () => {
  const signals = ['SIGTERM', 'SIGINT'];

  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(`\n${signal} received. Shutting down gracefully...`);

      if (server) {
        server.close(async () => {
          console.log('Server closed');

          try {
            await disconnectDB();
            console.log('Database connection closed');
            process.exit(0);
          } catch (error) {
            console.error('Error closing database connection:', error);
            process.exit(1);
          }
        });

        // Force shutdown after 30 seconds
        setTimeout(() => {
          console.error('Forcing shutdown after 30 seconds');
          process.exit(1);
        }, 30000);
      }
    });
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
};

// Start the server
startServer();
