# Shipping Management API Documentation

## Overview
Complete CRUD API for managing shipping methods. Admins can create, update, and manage shipping options. Customers can view active shipping methods during checkout.

## API Endpoints

### 🌍 PUBLIC ENDPOINTS (No Authentication Required)

#### Get Active Shipping Methods
Get all active shipping methods for customers to select during checkout.

```http
GET /api/shipping/active
```

**Response Example:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id": "clxxx123456",
      "name": "Standard Shipping",
      "description": "Regular delivery",
      "cost": "15.00",
      "estimatedDays": "5-7 business days",
      "isActive": true,
      "createdAt": "2026-02-11T10:00:00.000Z",
      "updatedAt": "2026-02-11T10:00:00.000Z"
    },
    {
      "id": "clxxx789012",
      "name": "Express Shipping",
      "description": "Fast delivery",
      "cost": "20.00",
      "estimatedDays": "2-3 business days",
      "isActive": true,
      "createdAt": "2026-02-11T10:00:00.000Z",
      "updatedAt": "2026-02-11T10:00:00.000Z"
    }
  ]
}
```

---

### 🔒 ADMIN ONLY ENDPOINTS (Requires Authentication & Admin Role)

#### Create Shipping Method
```http
POST /api/shipping
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Express Shipping",
  "description": "Fast delivery service",
  "cost": 20.00,
  "estimatedDays": "2-3 business days",
  "isActive": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Shipping method created successfully",
  "data": {
    "id": "clxxx789012",
    "name": "Express Shipping",
    "description": "Fast delivery service",
    "cost": "20.00",
    "estimatedDays": "2-3 business days",
    "isActive": true,
    "createdAt": "2026-02-11T10:00:00.000Z",
    "updatedAt": "2026-02-11T10:00:00.000Z"
  }
}
```

---

#### Get All Shipping Methods (Admin View)
Get all shipping methods including inactive ones.

```http
GET /api/shipping
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "id": "clxxx789012",
      "name": "Express Shipping",
      "cost": "20.00",
      "isActive": true,
      ...
    },
    {
      "id": "clxxx456789",
      "name": "Premium Shipping",
      "cost": "35.00",
      "isActive": false,
      ...
    }
  ]
}
```

---

#### Get Single Shipping Method
```http
GET /api/shipping/:id
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "clxxx789012",
    "name": "Express Shipping",
    "description": "Fast delivery service",
    "cost": "20.00",
    "estimatedDays": "2-3 business days",
    "isActive": true,
    "createdAt": "2026-02-11T10:00:00.000Z",
    "updatedAt": "2026-02-11T10:00:00.000Z"
  }
}
```

---

#### Update Shipping Method
```http
PUT /api/shipping/:id
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body (all fields optional):**
```json
{
  "name": "Express Shipping - Updated",
  "description": "Ultra fast delivery",
  "cost": 22.00,
  "estimatedDays": "1-2 business days",
  "isActive": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Shipping method updated successfully",
  "data": {
    "id": "clxxx789012",
    "name": "Express Shipping - Updated",
    "cost": "22.00",
    ...
  }
}
```

---

#### Toggle Shipping Method Status
Enable or disable a shipping method.

```http
PATCH /api/shipping/:id/toggle
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "message": "Shipping method activated successfully",
  "data": {
    "id": "clxxx789012",
    "name": "Express Shipping",
    "isActive": true,
    ...
  }
}
```

---

#### Delete Shipping Method
```http
DELETE /api/shipping/:id
Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "success": true,
  "message": "Shipping method deleted successfully"
}
```

---

## Usage Examples

### Example 1: Admin Creating Shipping Methods

```javascript
// Create Standard Shipping
const standardShipping = await fetch('http://localhost:5000/api/shipping', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer admin_token_here'
  },
  body: JSON.stringify({
    name: "Standard Shipping",
    description: "Regular delivery across Australia",
    cost: 15.00,
    estimatedDays: "5-7 business days",
    isActive: true
  })
});

// Create Express Shipping
const expressShipping = await fetch('http://localhost:5000/api/shipping', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer admin_token_here'
  },
  body: JSON.stringify({
    name: "Express Shipping",
    description: "Priority fast delivery",
    cost: 20.00,
    estimatedDays: "2-3 business days",
    isActive: true
  })
});
```

### Example 2: Customer Selecting Shipping During Checkout

```javascript
// Frontend - Fetch shipping options
const fetchShippingOptions = async () => {
  const response = await fetch('http://localhost:5000/api/shipping/active');
  const data = await response.json();
  
  if (data.success) {
    // Display shipping options to customer
    data.data.forEach(method => {
      console.log(`${method.name}: $${method.cost} AUD - ${method.estimatedDays}`);
    });
  }
};
```

### Example 3: Admin Managing Shipping Methods

```javascript
// Update shipping cost
const updateCost = await fetch('http://localhost:5000/api/shipping/clxxx789012', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer admin_token_here'
  },
  body: JSON.stringify({
    cost: 22.50
  })
});

// Disable a shipping method temporarily
const disableMethod = await fetch('http://localhost:5000/api/shipping/clxxx789012/toggle', {
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer admin_token_here'
  }
});
```

---

## Database Schema

```prisma
model ShippingMethod {
  id            String   @id @default(cuid())
  name          String   @unique
  description   String?
  cost          Decimal  @db.Decimal(10, 2)
  estimatedDays String?
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@map("shipping_methods")
}
```

---

## Frontend Integration Guide

### Customer Checkout Flow
1. Fetch active shipping methods: `GET /api/shipping/active`
2. Display options to customer with name, cost, and estimated delivery
3. Customer selects preferred shipping method
4. Include selected shipping method ID in order creation

### Admin Dashboard
1. List all methods: `GET /api/shipping` (with admin auth)
2. Create new method: `POST /api/shipping` (form with name, cost, description, etc.)
3. Edit existing: `PUT /api/shipping/:id`
4. Toggle active status: `PATCH /api/shipping/:id/toggle`
5. Delete method: `DELETE /api/shipping/:id`

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message"
}
```

Common HTTP Status Codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (not admin)
- `404` - Not Found
- `500` - Server Error
