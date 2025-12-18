// Fastify multipart handler for file uploads
// Files are handled by @fastify/multipart plugin registered in server.js

const handleFileUpload = async (request, reply) => {
  try {
    // Check if content-type is multipart
    if (!request.isMultipart()) {
      return ;
    }

    const parts = request.parts();
    const files = [];
    const fields = {};

    for await (const part of parts) {
      if (part.file) {
        // Handle file upload
        const buffer = await part.toBuffer();
        files.push({
          fieldname: part.fieldname,
          originalname: part.filename,
          mimetype: part.mimetype,
          buffer: buffer,
          size: buffer.length
        });
      } else {
        // Handle form fields
        fields[part.fieldname] = part.value;
      }
    }

    // Attach files and fields to request
    request.file = files[0]; // Single file
    request.files = files;   // Multiple files
    request.body = { ...request.body, ...fields };

  } catch (error) {
    done(error);
  }
};

module.exports = { handleFileUpload };





