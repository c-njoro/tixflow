import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from "@/lib/prisma";
import bcrypt from 'bcryptjs';

// Helper function to turn a company name into a URL-safe slug
// e.g., "Tech Conf LLC" -> "tech-conf-llc"
const slugify = (text: string) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')        // Replace spaces with -
    .replace(/[^\w\-]+/g, '')   // Remove all non-word chars
    .replace(/\-\-+/g, '-');     // Replace multiple - with single -
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Enforce strict POST method for data mutations
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const { businessName, email, password, name } = req.body;

  // 1. Strict Input Validation
  if (!businessName || !email || !password || !name) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  try {
    // 2. Check for Global Email Uniqueness
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // 3. Generate a Unique Slug for the Tenant Link
    let tenantSlug = slugify(businessName);
    const existingSlug = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    
    // Collision guard: If slug exists, append a short unique timestamp hash
    if (existingSlug) {
      tenantSlug = `${tenantSlug}-${Math.random().toString(36).substring(2, 6)}`;
    }

    // 4. Securely Hash the Password
    const salt = await bcrypt.genSalt(12); // Production standard salt rounds
    const hashedPassword = await bcrypt.hash(password, salt);

    // 5. Atomic Database Execution
    // If either operation fails, the entire change is rolled back instantly.
    const result = await prisma.$transaction(async (tx) => {
      // Create Tenant Workspace
      const newTenant = await tx.tenant.create({
        data: {
          businessName: businessName.trim(),
          slug: tenantSlug,
        },
      });

      // Create Admin User bound to that Tenant
      const newAdminUser = await tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          password: hashedPassword,
          name: name.trim(),
          role: 'admin',
          tenantId: newTenant.id, // Explicit foreign key binding
        },
      });

      return { tenant: newTenant, user: newAdminUser };
    });

    // 6. Return Clean Production Response (Never return the hashed password!)
    return res.status(201).json({
      success: true,
      message: 'Workspace and administrator account created successfully.',
      data: {
        tenantId: result.tenant.id,
        slug: result.tenant.slug,
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          role: result.user.role,
        },
      },
    });

  } catch (error) {
    // Log error internally to server log console (do not expose stack trace to client)
    console.error('CRITICAL_REGISTRATION_ERROR:', error);
    return res.status(500).json({ error: 'An internal server error occurred. Please try again.' });
  }
}