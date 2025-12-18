module.exports = function checkRole(requiredRole) {
  return async (request, reply) => {
    const role = request.user?.role;
    if (role !== requiredRole) {
      return reply.status(403).send({ error: "Unauthorized access" });
    }
  };
};



