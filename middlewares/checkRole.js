module.exports = function checkRole(requiredRole) {
  return (req, res, next) => {
    const role = req.user.role;
    if (role !== requiredRole) {
      return res.status(403).json({ error: "Unauthorized access" });
    }
    next();
  };
};
