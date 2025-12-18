const axios = require("axios");

// Helper function to get Vigil auth headers
const getVigilHeaders = () => {
  const apiKey = process.env.VIGIL_API_KEY;
  const apiSecret = process.env.VIGIL_API_SECRET;
  
  if (!apiKey || !apiSecret) {
    return null;
  }
  
  // Vigil uses Basic Auth with API Key and Secret
  const credentials = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  
  return {
    'Authorization': `Basic ${credentials}`,
    'Content-Type': 'application/json'
  };
};

// ABN validation using Vigil API (SOW Requirement)
const validateABNWithVigil = async (abn) => {
  try {
    // Remove spaces and validate format
    const cleanABN = abn.replace(/\s/g, "");
    
    if (cleanABN.length !== 11) {
      return { isValid: false, message: "ABN must be 11 digits" };
    }

    const vigilHeaders = getVigilHeaders();
    
    // If Vigil credentials are available, use Vigil API
    if (vigilHeaders) {
      console.log("🔍 Validating ABN with Vigil API...");
      
      const baseUrl = process.env.VIGIL_BASE_URL || "https://api.vigil.com.au/api/v1";
      
      const response = await axios.post(
        `${baseUrl}/business/verify`,
        {
          abn: cleanABN,
          country: "AU",
          checks: {
            abnStatus: true,
            gstRegistration: true,
            businessDetails: true
          }
        },
        {
          headers: vigilHeaders
        }
      );

      console.log("✅ Vigil ABN validation successful");

      return {
        isValid: response.data.verified && response.data.abnStatus === "Active",
        data: {
          abn: cleanABN,
          entityName: response.data.entityName || "",
          entityType: response.data.entityType || "",
          status: response.data.abnStatus || "",
          gst: response.data.gstRegistered ? "Registered" : "Not Registered",
          businessName: response.data.businessName || response.data.entityName,
          verificationId: response.data.verificationId,
          verifiedAt: new Date().toISOString()
        }
      };
    } else {
      // Fallback to ABR (free API) if no Vigil credentials
      console.log("⚠️  No Vigil credentials. Using ABR fallback...");
      
      // In development mode, bypass validation for testing
      if (process.env.NODE_ENV === "development" && !process.env.ABN_GUID) {
        console.log("⚠️  Development mode: ABN validation bypassed (no ABN_GUID configured)");
        return {
          isValid: true,
          data: {
            abn: cleanABN,
            entityName: "Test Business (Dev Mode)",
            entityType: "Individual",
            status: "Active",
            gst: "Not Registered",
            businessName: "Test Business",
            note: "Development mode - not actually verified"
          }
        };
      }
      
      const response = await axios.get(
        `https://abr.business.gov.au/json/AbnDetails.aspx`,
        {
          params: { 
            abn: cleanABN,
            guid: process.env.ABN_GUID
          }
        }
      );

      const isValid = response.data.Abn && response.data.AbnStatus === "Active";

      if (!isValid && process.env.NODE_ENV === "development") {
        // In development, accept any 11-digit ABN if not found in ABR
        console.log("⚠️  ABN not found in ABR. Development mode: Accepting anyway");
        return {
          isValid: true,
          data: {
            abn: cleanABN,
            entityName: "Test Business (Not in ABR)",
            entityType: "Individual",
            status: "Active",
            gst: "Not Registered",
            businessName: "Test Business",
            note: "Development mode - ABN not found in ABR but accepted for testing"
          }
        };
      }

      return {
        isValid,
        data: {
          abn: cleanABN,
          entityName: response.data.EntityName || "",
          entityType: response.data.EntityTypeName || "",
          status: response.data.AbnStatus || "",
          gst: response.data.Gst || "",
          businessName: response.data.BusinessName?.[0]?.OrganisationName || response.data.EntityName
        }
      };
    }
  } catch (error) {
    console.error("ABN validation error:", error.response?.data || error.message);
    
    // Development fallback
    if (process.env.NODE_ENV === "development") {
      console.log("⚠️  Development mode: ABN validation bypassed");
      return {
        isValid: true,
        data: {
          abn: abn.replace(/\s/g, ""),
          entityName: "Test Business (Dev Mode)",
          entityType: "Individual",
          status: "Active",
          businessName: "Test Business",
          note: "Development mode - not verified"
        }
      };
    }
    
    throw new Error("ABN validation service unavailable");
  }
};

// Identity document verification using Vigil API (SOW Requirement)
const verifyIdentityDocument = async (documentData) => {
  try {
    const { documentType, firstName, lastName, dateOfBirth, documentFrontBuffer, mimeType, sellerId } = documentData;
    
    console.log(`🔍 Verifying ${documentType} for seller ${sellerId} with Vigil API...`);

    const vigilHeaders = getVigilHeaders();
    
    // If Vigil credentials are available, use Vigil API
    if (vigilHeaders) {
      const FormData = require('form-data');
      const formData = new FormData();
      
      formData.append('documentType', documentType.toUpperCase());
      formData.append('firstName', firstName);
      formData.append('lastName', lastName);
      formData.append('dateOfBirth', dateOfBirth);
      formData.append('referenceId', sellerId);
      
      if (documentFrontBuffer) {
        formData.append('documentFront', documentFrontBuffer, {
          filename: 'document_front.jpg',
          contentType: mimeType
        });
      }

      const baseUrl = process.env.VIGIL_BASE_URL || "https://api.vigil.com.au/api/v1";
      
      const response = await axios.post(
        `${baseUrl}/identity/verify`,
        formData,
        {
          headers: {
            ...vigilHeaders,
            ...formData.getHeaders()
          }
        }
      );

      console.log('✅ Vigil identity verification completed:', response.data.verificationId);

      return {
        success: true,
        verificationId: response.data.verificationId,
        verified: response.data.verified,
        confidence: response.data.confidence,
        documentData: response.data.extractedData,
        checks: response.data.checks,
        warnings: response.data.warnings || [],
        timestamp: new Date().toISOString()
      };

    } else {
      // Development fallback - simulate verification
      console.log('⚠️  No Vigil credentials. Using development mode simulation...');
      console.log('📝 To enable Vigil: Add VIGIL_API_KEY and VIGIL_API_SECRET to .env');
      
      const verificationResult = {
        verificationId: `VGL_DEV_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        verified: true,
        confidence: 0.95,
        documentData: {
          firstName,
          lastName,
          dateOfBirth,
          documentType,
          documentNumber: 'DEV123456789',
          expiryDate: '2030-12-31'
        },
        checks: {
          documentAuthentic: true,
          faceMatch: true,
          dataExtracted: true,
          documentExpiry: true
        },
        warnings: ['Development mode - not actually verified with Vigil. Manual admin review required.'],
        timestamp: new Date().toISOString()
      };

      console.log('✅ Development verification completed:', verificationResult.verificationId);

      return {
        success: true,
        ...verificationResult
      };
    }

  } catch (error) {
    console.error('Vigil identity verification error:', error.response?.data || error.message);
    
    // Development fallback on error
    if (process.env.NODE_ENV === "development") {
      console.log('⚠️  Vigil API error. Using development fallback...');
      return {
        success: true,
        verificationId: `VGL_DEV_ERROR_${Date.now()}`,
        verified: true,
        confidence: 0.85,
        documentData: {
          firstName: documentData.firstName,
          lastName: documentData.lastName,
          dateOfBirth: documentData.dateOfBirth,
          documentType: documentData.documentType
        },
        checks: {
          documentAuthentic: true,
          faceMatch: true,
          dataExtracted: true
        },
        warnings: ['Development mode - Vigil API unavailable. Manual admin review required.'],
        timestamp: new Date().toISOString()
      };
    }
    
    throw new Error('Identity verification failed. Please try again or contact support.');
  }
};

module.exports = { validateABNWithVigil, verifyIdentityDocument };
