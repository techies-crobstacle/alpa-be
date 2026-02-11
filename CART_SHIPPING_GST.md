# Cart with Shipping & GST - Implementation Guide

## Overview
The cart system now includes automated shipping cost and GST calculations. Both authenticated users and guest users can view calculated totals before checkout.

---

## API Endpoints

### 1. View Cart (Authenticated Users)
Get user's cart with shipping options, GST, and calculated totals.

```http
GET /api/cart/my-cart?shippingMethodId=<optional>
Authorization: Bearer <token>
```

**Query Parameters:**
- `shippingMethodId` (optional) - ID of selected shipping method to calculate total

**Response:**
```json
{
  "success": true,
  "cart": [
    {
      "productId": "clxxx123",
      "quantity": 2,
      "product": {
        "id": "clxxx123",
        "title": "Aboriginal Art Painting",
        "price": "150.00",
        "images": ["url1", "url2"],
        "stock": 10,
        "category": "Art"
      }
    }
  ],
  "availableShipping": [
    {
      "id": "clxxx456",
      "name": "Standard Shipping",
      "description": "Regular delivery",
      "cost": "15.00",
      "estimatedDays": "5-7 business days"
    },
    {
      "id": "clxxx789",
      "name": "Express Shipping",
      "description": "Fast delivery",
      "cost": "20.00",
      "estimatedDays": "2-3 business days"
    }
  ],
  "gst": {
    "id": "clxxxabc",
    "name": "Standard GST",
    "percentage": "10.00",
    "description": "Standard 10% GST"
  },
  "calculations": {
    "subtotal": "300.00",
    "shippingCost": "15.00",
    "gstPercentage": "10.00",
    "gstAmount": "31.50",
    "grandTotal": "346.50",
    "selectedShipping": {
      "id": "clxxx456",
      "name": "Standard Shipping",
      "cost": "15.00"
    },
    "gstDetails": {
      "id": "clxxxabc",
      "name": "Standard GST",
      "percentage": "10.00"
    }
  }
}
```

---

### 2. Calculate Guest Cart (No Authentication)
Calculate cart totals for guest users before checkout.

```http
POST /api/cart/calculate-guest
Content-Type: application/json
```

**Request Body:**
```json
{
  "items": [
    {
      "productId": "clxxx123",
      "quantity": 2
    },
    {
      "productId": "clxxx456",
      "quantity": 1
    }
  ],
  "shippingMethodId": "clxxx789"
}
```

**Response:**
```json
{
  "success": true,
  "cart": [
    {
      "productId": "clxxx123",
      "quantity": 2,
      "product": {
        "id": "clxxx123",
        "title": "Aboriginal Art Painting",
        "price": "150.00",
        "images": ["url1"],
        "stock": 10,
        "category": "Art"
      }
    }
  ],
  "availableShipping": [...],
  "gst": {...},
  "calculations": {
    "subtotal": "300.00",
    "shippingCost": "20.00",
    "gstPercentage": "10.00",
    "gstAmount": "32.00",
    "grandTotal": "352.00"
  }
}
```

---

## Frontend Integration Examples

### Example 1: Display Cart for Logged-in User

```javascript
// Fetch cart with shipping calculation
const fetchCart = async (selectedShippingId = null) => {
  const url = selectedShippingId 
    ? `/api/cart/my-cart?shippingMethodId=${selectedShippingId}`
    : '/api/cart/my-cart';
    
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  });
  
  const data = await response.json();
  
  if (data.success) {
    // Display cart items
    data.cart.forEach(item => {
      console.log(`${item.product.title} - $${item.product.price} x ${item.quantity}`);
    });
    
    // Display shipping options
    data.availableShipping.forEach(shipping => {
      console.log(`${shipping.name}: $${shipping.cost} - ${shipping.estimatedDays}`);
    });
    
    // Display totals
    console.log(`Subtotal: $${data.calculations.subtotal}`);
    console.log(`Shipping: $${data.calculations.shippingCost}`);
    console.log(`GST (${data.calculations.gstPercentage}%): $${data.calculations.gstAmount}`);
    console.log(`Grand Total: $${data.calculations.grandTotal}`);
  }
};
```

### Example 2: Guest Cart Calculation

```javascript
// Calculate guest cart before checkout
const calculateGuestCart = async (cartItems, shippingId) => {
  const response = await fetch('/api/cart/calculate-guest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      items: cartItems, // [{ productId, quantity }]
      shippingMethodId: shippingId
    })
  });
  
  const data = await response.json();
  
  if (data.success) {
    return data.calculations;
  }
};

// Usage in checkout page
const cartItems = [
  { productId: 'product123', quantity: 2 },
  { productId: 'product456', quantity: 1 }
];

const totals = await calculateGuestCart(cartItems, 'shipping123');
console.log(`Total to pay: $${totals.grandTotal}`);
```

### Example 3: Dynamic Shipping Selection

```javascript
// Update cart total when user selects different shipping
const updateShippingSelection = async (shippingMethodId) => {
  const response = await fetch(
    `/api/cart/my-cart?shippingMethodId=${shippingMethodId}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );
  
  const data = await response.json();
  
  // Update UI with new totals
  document.getElementById('shipping-cost').textContent = data.calculations.shippingCost;
  document.getElementById('gst-amount').textContent = data.calculations.gstAmount;
  document.getElementById('grand-total').textContent = data.calculations.grandTotal;
};

// Listen to shipping method selection
document.getElementById('shipping-select').addEventListener('change', (e) => {
  updateShippingSelection(e.target.value);
});
```

---

## Calculation Logic

### Subtotal
Sum of (Product Price × Quantity) for all items

### Shipping Cost
Selected shipping method cost (if any)

### GST Calculation
```
GST Amount = (Subtotal + Shipping Cost) × (GST Percentage / 100)
```

### Grand Total
```
Grand Total = Subtotal + Shipping Cost + GST Amount
```

---

## Important Notes

1. **GST Application**: GST is applied to both product subtotal AND shipping cost
2. **Default GST**: The system uses the GST marked as "default" in the database
3. **Active Methods Only**: Only active shipping methods and GST settings are included
4. **Stock Validation**: Guest cart calculation validates product availability
5. **Decimal Precision**: All amounts are returned as strings with 2 decimal places

---

## Error Handling

### Empty Cart
```json
{
  "success": true,
  "cart": [],
  "message": "Cart is empty",
  "availableShipping": [],
  "calculations": {
    "subtotal": "0.00",
    "shippingCost": "0.00",
    "gstPercentage": "0.00",
    "gstAmount": "0.00",
    "grandTotal": "0.00"
  }
}
```

### Invalid Product in Guest Cart
```json
{
  "success": false,
  "message": "One or more products not found"
}
```

### Insufficient Stock
```json
{
  "success": false,
  "message": "Insufficient stock for Aboriginal Art Painting. Available: 5"
}
```

---

## Testing Checklist

- [ ] View cart without selecting shipping (should show all options)
- [ ] View cart with selected shipping (should calculate with that shipping cost)
- [ ] Calculate guest cart with valid products
- [ ] Calculate guest cart with invalid product IDs (should fail)
- [ ] Calculate guest cart with quantity exceeding stock (should fail)
- [ ] Verify GST is applied correctly
- [ ] Verify totals are calculated accurately
- [ ] Test with empty cart
- [ ] Test when no GST is configured (should use 0%)
- [ ] Test when no shipping methods available
