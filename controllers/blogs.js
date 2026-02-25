const prisma = require("../config/prisma");
const { uploadToCloudinary } = require("../config/cloudinary");

// Helper: generate slug from title
const generateSlug = (title) =>
  title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

// ─────────────────────────────────────────────
// ADMIN: Create Blog
// ─────────────────────────────────────────────
exports.createBlog = async (request, reply) => {
  try {
    const body = request.body || {};
    const { title, slug, content } = body;

    if (!title || !content) {
      return reply.status(400).send({
        success: false,
        message: "title and content are required",
      });
    }

    // Handle cover image: uploaded file takes priority, fall back to URL string
    let coverImage = body.coverImage || null;
    if (request.files && request.files.length > 0) {
      const file = request.files.find(
        (f) => f.fieldname === "coverImage" || f.fieldname === "image"
      ) || request.files[0];
      if (file) {
        const result = await uploadToCloudinary(file.path, "blogs");
        coverImage = result.url;
      }
    }

    if (!coverImage) {
      return reply.status(400).send({
        success: false,
        message: "coverImage is required (upload a file or provide a URL)",
      });
    }

    const finalSlug = slug ? slug.toLowerCase().trim() : generateSlug(title);

    // Check slug uniqueness
    const existing = await prisma.blog.findUnique({ where: { slug: finalSlug } });
    if (existing) {
      return reply.status(409).send({
        success: false,
        message: `A blog with slug '${finalSlug}' already exists`,
      });
    }

    const blog = await prisma.blog.create({
      data: {
        title,
        slug: finalSlug,
        content,
        coverImage,
        status: "DRAFT",
      },
    });

    return reply.status(201).send({ success: true, message: "Blog created", blog });
  } catch (error) {
    console.error("Create blog error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// ADMIN: Update Blog
// ─────────────────────────────────────────────
exports.updateBlog = async (request, reply) => {
  try {
    const { id } = request.params;
    const body = request.body || {};
    const { title, slug, content } = body;

    const blog = await prisma.blog.findUnique({ where: { id } });
    if (!blog) {
      return reply.status(404).send({ success: false, message: "Blog not found" });
    }

    // If a new slug is supplied, verify it's not taken by another blog
    if (slug && slug !== blog.slug) {
      const taken = await prisma.blog.findUnique({ where: { slug: slug.toLowerCase().trim() } });
      if (taken) {
        return reply.status(409).send({
          success: false,
          message: `Slug '${slug}' is already in use`,
        });
      }
    }

    // Handle cover image: uploaded file takes priority, fall back to URL string in body
    let coverImage = body.coverImage || null;
    if (request.files && request.files.length > 0) {
      const file = request.files.find(
        (f) => f.fieldname === "coverImage" || f.fieldname === "image"
      ) || request.files[0];
      if (file) {
        const result = await uploadToCloudinary(file.path, "blogs");
        coverImage = result.url;
      }
    }

    const updated = await prisma.blog.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(slug && { slug: slug.toLowerCase().trim() }),
        ...(content && { content }),
        ...(coverImage && { coverImage }),
      },
    });

    return reply.status(200).send({ success: true, message: "Blog updated", blog: updated });
  } catch (error) {
    console.error("Update blog error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// ADMIN: Delete Blog
// ─────────────────────────────────────────────
exports.deleteBlog = async (request, reply) => {
  try {
    const { id } = request.params;

    const blog = await prisma.blog.findUnique({ where: { id } });
    if (!blog) {
      return reply.status(404).send({ success: false, message: "Blog not found" });
    }

    await prisma.blog.delete({ where: { id } });

    return reply.status(200).send({ success: true, message: "Blog deleted" });
  } catch (error) {
    console.error("Delete blog error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// ADMIN: Toggle Published / Draft
// ─────────────────────────────────────────────
exports.togglePublish = async (request, reply) => {
  try {
    const { id } = request.params;

    const blog = await prisma.blog.findUnique({ where: { id } });
    if (!blog) {
      return reply.status(404).send({ success: false, message: "Blog not found" });
    }

    const newStatus = blog.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";

    const updated = await prisma.blog.update({
      where: { id },
      data: { status: newStatus },
    });

    return reply.status(200).send({
      success: true,
      message: `Blog is now ${newStatus.toLowerCase()}`,
      blog: updated,
    });
  } catch (error) {
    console.error("Toggle publish error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// ADMIN: Get All Blogs (any status / active flag)
// ─────────────────────────────────────────────
exports.adminGetAllBlogs = async (request, reply) => {
  try {
    const { status, page = 1, limit = 10 } = request.query;

    const where = {};
    if (status) where.status = status.toUpperCase();

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const [blogs, total] = await Promise.all([
      prisma.blog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
      prisma.blog.count({ where }),
    ]);

    return reply.status(200).send({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / take),
      blogs,
    });
  } catch (error) {
    console.error("Admin get all blogs error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// PUBLIC: Get All Published & Active Blogs
// ─────────────────────────────────────────────
exports.getAllBlogs = async (request, reply) => {
  try {
    const { page = 1, limit = 10 } = request.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = { status: "PUBLISHED" };

    const [blogs, total] = await Promise.all([
      prisma.blog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          title: true,
          slug: true,
          content: true,
          coverImage: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.blog.count({ where }),
    ]);

    return reply.status(200).send({
      success: true,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / take),
      blogs,
    });
  } catch (error) {
    console.error("Get all blogs error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// PUBLIC: Get Blog by ID or Slug
// ─────────────────────────────────────────────
exports.getBlogById = async (request, reply) => {
  try {
    const { id } = request.params;

    // Try finding by ID first, then by slug
    const blog = await prisma.blog.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
        status: "PUBLISHED",
      },
    });

    if (!blog) {
      return reply.status(404).send({ success: false, message: "Blog not found" });
    }

    return reply.status(200).send({ success: true, blog });
  } catch (error) {
    console.error("Get blog by id error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// ADMIN: Get Blog by ID (any status)
// ─────────────────────────────────────────────
exports.adminGetBlogById = async (request, reply) => {
  try {
    const { id } = request.params;

    const blog = await prisma.blog.findFirst({
      where: { OR: [{ id }, { slug: id }] },
    });

    if (!blog) {
      return reply.status(404).send({ success: false, message: "Blog not found" });
    }

    return reply.status(200).send({ success: true, blog });
  } catch (error) {
    console.error("Admin get blog by id error:", error);
    return reply.status(500).send({ success: false, message: error.message });
  }
};
