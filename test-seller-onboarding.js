// Test script for Seller Onboarding API
// Run with: node test-seller-onboarding.js

const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api/sellers';
let sellerId = '';
let token = '';

// Test data
const testData = {
  email: 'testseller@example.com',
  phone: '+61412345678',
  contactPerson: 'Test Seller',
  businessName: 'Test Aboriginal Art Store',
  abn: '53004085616', // Valid test ABN
  storeName: 'Test Art Gallery',
  storeBio: 'Traditional Aboriginal artwork from the heart of Australia',
  artistName: 'Test Artist',
  clanAffiliation: 'Test Clan',
  culturalStory: 'This is a test cultural story about the artwork and its significance...'
};

// Helper function to log results
const log = (step, data) => {
  console.log('\n' + '='.repeat(60));
  console.log(`✅ ${step}`);
  console.log('='.repeat(60));
  console.log(JSON.stringify(data, null, 2));
};

const logError = (step, error) => {
  console.log('\n' + '='.repeat(60));
  console.log(`❌ ${step} FAILED`);
  console.log('='.repeat(60));
  console.log(error.response?.data || error.message);
};

// Test functions
async function testApply() {
  try {
    const response = await axios.post(`${BASE_URL}/apply`, {
      email: testData.email,
      phone: testData.phone,
      contactPerson: testData.contactPerson
    });
    
    sellerId = response.data.sellerId;
    log('Step 1: Apply as Seller', response.data);
    
    // In development, OTP is logged to server console
    console.log('\n⚠️  Check server console for OTP');
    console.log('Enter OTP when ready...');
    
    return true;
  } catch (error) {
    logError('Step 1: Apply', error);
    return false;
  }
}

async function testVerifyOTP(otp) {
  try {
    const response = await axios.post(`${BASE_URL}/verify-otp`, {
      sellerId,
      otp
    });
    
    token = response.data.token;
    log('Step 2: Verify OTP', response.data);
    return true;
  } catch (error) {
    logError('Step 2: Verify OTP', error);
    return false;
  }
}

async function testBusinessDetails() {
  try {
    const response = await axios.post(
      `${BASE_URL}/business-details`,
      {
        businessName: testData.businessName,
        abn: testData.abn,
        businessAddress: {
          street: '123 Test Street',
          city: 'Sydney',
          state: 'NSW',
          postcode: '2000',
          country: 'Australia'
        }
      },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    
    log('Step 3: Submit Business Details', response.data);
    return true;
  } catch (error) {
    logError('Step 3: Business Details', error);
    return false;
  }
}

async function testValidateABN() {
  try {
    const response = await axios.post(
      `${BASE_URL}/validate-abn`,
      { abn: testData.abn },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    
    log('Step 3.1: Validate ABN', response.data);
    return true;
  } catch (error) {
    logError('Step 3.1: Validate ABN', error);
    return false;
  }
}

async function testCulturalInfo() {
  try {
    const response = await axios.post(
      `${BASE_URL}/cultural-info`,
      {
        artistName: testData.artistName,
        clanAffiliation: testData.clanAffiliation,
        culturalStory: testData.culturalStory
      },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    
    log('Step 4: Submit Cultural Info', response.data);
    return true;
  } catch (error) {
    logError('Step 4: Cultural Info', error);
    return false;
  }
}

async function testStoreProfile() {
  try {
    const FormData = require('form-data');
    const fs = require('fs');
    const formData = new FormData();
    
    formData.append('storeName', testData.storeName);
    formData.append('storeBio', testData.storeBio);
    
    // Note: You need to have a test image file for this
    // For now, we'll skip the file upload in automated test
    
    const response = await axios.post(
      `${BASE_URL}/store-profile`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${token}`
        }
      }
    );
    
    log('Step 5: Submit Store Profile', response.data);
    return true;
  } catch (error) {
    logError('Step 5: Store Profile', error);
    return false;
  }
}

async function testGetProfile() {
  try {
    const response = await axios.get(`${BASE_URL}/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    log('Get Seller Profile', response.data);
    return true;
  } catch (error) {
    logError('Get Profile', error);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log('\n🚀 Starting Seller Onboarding API Tests...\n');
  
  // Step 1: Apply
  const applied = await testApply();
  if (!applied) return;
  
  // Wait for user to enter OTP from console
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  readline.question('\nEnter OTP from server console: ', async (otp) => {
    readline.close();
    
    // Step 2: Verify OTP
    const verified = await testVerifyOTP(otp);
    if (!verified) return;
    
    // Step 3: Business Details
    await testBusinessDetails();
    
    // Step 3.1: Validate ABN
    await testValidateABN();
    
    // Step 4: Cultural Info
    await testCulturalInfo();
    
    // Step 5: Store Profile (without file upload)
    await testStoreProfile();
    
    // Get Profile
    await testGetProfile();
    
    console.log('\n' + '='.repeat(60));
    console.log('✨ Test Suite Completed!');
    console.log('='.repeat(60));
    console.log(`\n📝 Seller ID: ${sellerId}`);
    console.log(`🔑 Token: ${token.substring(0, 50)}...`);
    console.log('\nNext steps:');
    console.log('- Upload KYC document (requires file upload)');
    console.log('- Add bank details (optional)');
    console.log('- Submit for admin review');
  });
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testApply, testVerifyOTP, testBusinessDetails };

