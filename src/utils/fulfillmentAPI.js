/**
 * External Fulfillment API Integration
 * 
 * Handles communication with fulfillment service:
 * - Timeout handling for reliability
 * - Retry logic for transient failures
 * - Error mapping and transformation
 * - Request/response validation
 * - Circuit breaker pattern (future enhancement)
 */

const axios = require('axios');
const { ExternalAPIError } = require('../middleware/errorHandler');

const API_TIMEOUT = process.env.FULFILLMENT_API_TIMEOUT || 5000;
const BASE_URL = process.env.FULFILLMENT_API_URL || 'https://jsonplaceholder.typicode.com';
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // ms

/**
 * Call fulfillment API with retry logic
 *
 * @param {Object} data - Request payload
 * @param {string} data.userId - Client ID
 * @param {string} data.title - Order ID
 * @returns {Promise<Object>} Fulfillment response
 * @throws {ExternalAPIError} If API fails after retries
 */
const callFulfillmentAPI = async (data, retryCount = 0) => {
  try {
    const response = await axios.post(
      `${BASE_URL}/posts`,
      {
        userId: data.userId,
        title: data.title,
        // In production, add additional fields
        // body: "Order created at " + new Date().toISOString(),
        // timestamp: Date.now(),
      },
      {
        timeout: API_TIMEOUT,
        // Retry on network failures and 5xx errors
        validateStatus: (status) => {
          return status >= 200 && status < 500;
        },
      }
    );

    // Validate response
    if (response.status >= 400) {
      throw new Error(
        `API returned status ${response.status}: ${JSON.stringify(response.data)}`
      );
    }

    if (!response.data || !response.data.id) {
      throw new Error('API response missing required fields');
    }

    // Transform response to our format
    return {
      id: response.data.id,
      userId: response.data.userId,
      title: response.data.title,
      status: 'fulfilled',
      timestamp: new Date(),
    };
  } catch (error) {
    // Determine if we should retry
    const isRetryable = isRetryableError(error);

    if (isRetryable && retryCount < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      console.log(
        `Retrying fulfillment API in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})...`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
      return callFulfillmentAPI(data, retryCount + 1);
    }

    // All retries exhausted or non-retryable error
    const errorDetails = {
      code: error.code || 'API_ERROR',
      message: error.message,
      retries: retryCount,
      timestamp: new Date(),
    };

    console.error('Fulfillment API error:', errorDetails);

    throw new ExternalAPIError(
      `Fulfillment API call failed: ${error.message}`,
      error
    );
  }
};

/**
 * Determine if error is retryable
 * 
 * Retryable errors:
 * - Network timeouts
 * - Connection refused
 * - 5xx server errors
 * - ECONNRESET, ENOTFOUND, etc.
 *
 * Non-retryable:
 * - 4xx client errors (bad request data)
 * - Invalid payload
 */
const isRetryableError = (error) => {
  // Timeout errors
  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return true;
  }

  // Network errors
  if (
    error.code === 'ECONNREFUSED' ||
    error.code === 'ENOTFOUND' ||
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT'
  ) {
    return true;
  }

  // Server errors (5xx)
  if (error.response?.status >= 500) {
    return true;
  }

  return false;
};

/**
 * Health check for fulfillment API
 * Useful for service mesh or monitoring
 */
const checkFulfillmentAPIHealth = async () => {
  try {
    const response = await axios.get(`${BASE_URL}/posts/1`, {
      timeout: 3000,
    });

    return {
      healthy: response.status === 200,
      statusCode: response.status,
      timestamp: new Date(),
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timestamp: new Date(),
    };
  }
};

module.exports = {
  callFulfillmentAPI,
  checkFulfillmentAPIHealth,
};
