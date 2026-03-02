/**
 * Executes an async function with exponential backoff retry logic.
 * @param {() => Promise<any>} fn - The async function to execute
 * @param {object} [options]
 * @param {number} [options.maxRetries=3] - Maximum number of attempts
 * @param {number} [options.baseDelayMs=1000] - Initial delay in milliseconds
 * @param {import('winston').Logger} [options.logger] - Optional logger instance
 * @param {string} [options.label] - Label for log messages
 * @returns {Promise<any>}
 */
export async function withRetry(fn, { maxRetries = 3, baseDelayMs = 1000, logger, label = 'operation' } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) {
        logger?.error(`${label} failed after ${maxRetries} attempts`, { error: err.message });
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger?.warn(`${label} attempt ${attempt} failed, retrying in ${delay}ms`, { error: err.message });
      await sleep(delay);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
