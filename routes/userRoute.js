const { db } = require("../config/firebase");

// POST: Add a new user (Fastify route)
async function userRoutes(fastify, options) {
  fastify.post("/add-user", async (request, reply) => {
    const { uid, name, email } = request.body;

    try {
      await db.collection("users").doc(uid).set({
        uid,
        name,
        email,
        createdAt: new Date(),
      });
      reply.send({ success: true, message: "User added" });
    } catch (error) {
      reply.send({ success: false, error: error.message });
    }
  });
}

module.exports = userRoutes;


