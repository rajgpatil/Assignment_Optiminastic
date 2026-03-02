/**
 * Database Configuration Module
 * 
 * Handles MongoDB connection with:
 * - Retry logic for resilience
 * - Connection pooling for scalability
 * - Event listeners for monitoring
 */

const mongoose = require('mongoose');

// Retry configuration for production resilience
const RETRY_ATTEMPTS = process.env.MONGODB_CONNECTION_RETRY || 5;
const RETRY_DELAY = process.env.MONGODB_RETRY_DELAY || 1000;

let retryCount = 0;

const connectDB = async () => {
  try {
    console.log('Attempting to connect to MongoDB...');
    
    await mongoose.connect(process.env.MONGODB_URI, {
      // Connection pool settings for handling concurrent requests
      // maxPoolSize: scales based on expected concurrent users
      maxPoolSize: 50,
      minPoolSize: 10,
      
      // Timeout settings
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      
      // Automatic reconnection
      retryWrites: true,
      w: 'majority',
      
      // Transaction support
      readPreference: 'primary',
    });

    console.log('✓ MongoDB connected successfully');
    retryCount = 0;

    // Monitor connection events
    mongoose.connection.on('connected', () => {
      console.log('Mongoose connected to MongoDB');
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('Mongoose disconnected from MongoDB');
    });

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
      // Implement reconnection logic
      attemptReconnect();
    });

    return mongoose.connection;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error.message);
    
    // Retry with exponential backoff
    if (retryCount < RETRY_ATTEMPTS) {
      retryCount++;
      const delay = RETRY_DELAY * Math.pow(2, retryCount - 1); // Exponential backoff
      console.log(`Retrying connection in ${delay}ms (attempt ${retryCount}/${RETRY_ATTEMPTS})...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return connectDB();
    }

    throw new Error(`Failed to connect to MongoDB after ${RETRY_ATTEMPTS} attempts`);
  }
};

const attemptReconnect = () => {
  if (mongoose.connection.readyState === 0) {
    console.log('Attempting to reconnect to MongoDB...');
    connectDB().catch(err => {
      console.error('Reconnection failed:', err.message);
    });
  }
};

const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log('MongoDB disconnected');
  } catch (error) {
    console.error('Error disconnecting from MongoDB:', error);
    throw error;
  }
};

module.exports = {
  connectDB,
  disconnectDB,
  mongoose,
};
