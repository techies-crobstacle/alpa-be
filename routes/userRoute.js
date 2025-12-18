const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

// POST: Add a new user
router.post("/add-user", async (req, res) => {
  const { uid, name, email } = req.body;

  try {
    await db.collection("users").doc(uid).set({
      uid,
      name,
      email,
      createdAt: new Date(),
    });
    res.json({ success: true, message: "User added" });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;
