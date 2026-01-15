const prisma = require("./config/prisma");

async function testSchemaUpdate() {
  try {
    console.log("🔍 Testing database schema...");
    
    // Try to find a user (will test if the columns exist)
    const user = await prisma.user.findFirst({
      select: {
        id: true,
        email: true,
        emailVerificationDeadline: true,
        emailVerificationReminderSentAt: true
      }
    });
    
    console.log("✅ Schema test passed! New columns are accessible:");
    console.log("   - emailVerificationDeadline");
    console.log("   - emailVerificationReminderSentAt");
    
    if (user) {
      console.log("\n✅ Sample user found:");
      console.log(`   Email: ${user.email}`);
      console.log(`   Verification Deadline: ${user.emailVerificationDeadline}`);
      console.log(`   Reminder Sent At: ${user.emailVerificationReminderSentAt}`);
    } else {
      console.log("\n✅ No users in database yet (this is normal for new setup)");
    }
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Schema test failed:", error.message);
    process.exit(1);
  }
}

testSchemaUpdate();
