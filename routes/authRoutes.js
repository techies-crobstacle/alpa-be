const express = require("express");
const router = express.Router();
const { register, login, verifyOTP, resendOTP } = require("../controllers/auth");

router.post("/signup", register);
router.post("/verify-otp", verifyOTP);
router.post("/resend-otp", resendOTP);
router.post("/login", login);

module.exports = router;
