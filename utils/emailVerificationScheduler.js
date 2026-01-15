const prisma = require("../config/prisma");
const { sendOTPEmail, generateOTP } = require("./emailService");

/**
 * Email Verification Reminder Scheduler
 * Runs daily to check if any users have reached their 7-day verification deadline
 * and sends them a reminder email with a new OTP
 */

const scheduleEmailVerificationReminder = () => {
  // Run every 24 hours
  const interval = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  
  const checkAndSendReminders = async () => {
    try {
      console.log("🔔 [Email Verification Scheduler] Running verification reminder check...");
      
      // Find users who:
      // 1. Email is not verified
      // 2. Are past their 7-day deadline
      // 3. Haven't received reminder yet
      const now = new Date();
      
      try {
        const usersNeedingReminder = await prisma.user.findMany({
          where: {
            emailVerified: false,
            emailVerificationDeadline: {
              lte: now // Past the deadline
            },
            emailVerificationReminderSentAt: null // Reminder not sent yet
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            emailVerificationDeadline: true
          }
        });
        
        console.log(`📧 Found ${usersNeedingReminder.length} users needing email verification reminders`);
        
        if (usersNeedingReminder.length === 0) {
          console.log("✅ No users need verification reminders at this time");
          return;
        }
        
        // Send reminder email to each user
        for (const user of usersNeedingReminder) {
          try {
            // Generate a new OTP for email verification
            const otp = generateOTP();
            const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
            
            // Create a verification OTP record (you can use pending_registrations or create a new table)
            // For now, we'll store it in pendingRegistration if user re-registers
            // Or you can send it directly via email and track in user's emailVerificationOTP
            
            // Send verification email with OTP
            const emailResult = await sendOTPEmail(
              user.email,
              otp,
              user.name,
              `Email Verification Reminder - Your account requires verification`
            );
            
            if (emailResult.success) {
              // Mark reminder as sent
              await prisma.user.update({
                where: { id: user.id },
                data: {
                  emailVerificationReminderSentAt: new Date()
                }
              });
              
              console.log(`✅ Reminder email sent to ${user.email} (${user.role})`);
            } else {
              console.error(`❌ Failed to send reminder email to ${user.email}`);
            }
          } catch (error) {
            console.error(`❌ Error sending reminder to user ${user.id}:`, error.message);
          }
        }
        
        console.log("✅ Email verification reminder check completed");
      } catch (dbError) {
        // If the columns don't exist yet (migration not run), log a helpful message
        if (dbError.message && dbError.message.includes("emailVerificationDeadline")) {
          console.log("⏳ [Email Verification Scheduler] Database columns not yet migrated. Please run: npx prisma db push");
          return;
        }
        throw dbError;
      }
      
    } catch (error) {
      console.error("❌ [Email Verification Scheduler] Error:", error);
    }
  };
  
  // Run immediately on startup
  checkAndSendReminders();
  
  // Then run every 24 hours
  const scheduledInterval = setInterval(checkAndSendReminders, interval);
  
  console.log("🕐 Email verification reminder scheduler started (runs every 24 hours)");
  
  // Return the interval ID so it can be stopped if needed
  return scheduledInterval;
};

module.exports = { scheduleEmailVerificationReminder };
