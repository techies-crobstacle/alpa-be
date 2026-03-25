/**
 * User Cleanup Scheduler
 * Auto-anonymizes user data after 10 hours in recycle bin (TESTING)
 * Runs hourly to check for expired users
 */

const cron = require('node-cron');

// Global flag to prevent multiple schedulers
let schedulerRunning = false;

// Import the cleanup function from admin controller
const { autoCleanupExpiredUsers } = require('../controllers/admin');

/**
 * Initialize the user cleanup scheduler
 * Runs hourly to check for users ready for anonymization (TESTING: 10 hours)
 */
const initializeUserCleanupScheduler = () => {
  // Prevent multiple schedulers (important for cloud deployments)
  if (schedulerRunning) {
    console.log('⚠️  User cleanup scheduler already running');
    return;
  }

  console.log('🔔 Initializing user cleanup scheduler (TESTING: every hour, 10h cleanup)...');

  // Run every hour for testing (instead of daily)
  const task = cron.schedule('0 * * * *', async () => {
    try {
      console.log('⏰ [User Cleanup] Running scheduled cleanup...');
      const result = await autoCleanupExpiredUsers();
      
      if (result.processed > 0) {
        console.log(`✅ [User Cleanup] Successfully anonymized ${result.processed} expired users`);
      } else {
        console.log('✅ [User Cleanup] No expired users found for cleanup');
      }

    } catch (error) {
      console.error('❌ [User Cleanup] Scheduled cleanup failed:', error.message);
    }
  }, {
    scheduled: false // Don't start immediately
  });

  // Start the scheduler
  task.start();
  schedulerRunning = true;
  
  console.log('✅ User cleanup scheduler initialized - will run every hour (TESTING)');

  // Return task for testing/manual control
  return task;
};

/**
 * Manual cleanup trigger (for testing or admin actions)
 */
const runManualCleanup = async () => {
  try {
    console.log('🔧 [User Cleanup] Running manual cleanup...');
    const result = await autoCleanupExpiredUsers();
    console.log(`✅ [User Cleanup] Manual cleanup completed - ${result.processed} users processed`);
    return result;
  } catch (error) {
    console.error('❌ [User Cleanup] Manual cleanup failed:', error.message);
    throw error;
  }
};

module.exports = {
  initializeUserCleanupScheduler,
  runManualCleanup
};