// src/lib/cloudinary.ts
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export interface UploadedImage {
  url: string;
  publicId: string;
}

export async function uploadImage(dataUrl: string, folder: string): Promise<UploadedImage> {
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder,
    resource_type: 'image',
  });
  return { url: result.secure_url, publicId: result.public_id };
}

export interface UploadedDocument extends UploadedImage {
  format: string;
  pageCount: number;
}

// PDFs go up as resource_type 'image' on purpose — that's what lets
// Cloudinary render any single page as a JPG (see documentPageUrl in
// src/lib/eventSpace.ts), so attendees never have to download the PDF.
export async function uploadDocument(dataUrl: string, folder: string): Promise<UploadedDocument> {
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder,
    resource_type: 'image',
  });
  return {
    url: result.secure_url,
    publicId: result.public_id,
    format: result.format,
    pageCount: result.pages || 1,
  };
}

// invalidate: also purge Cloudinary's CDN cache — without it a deleted file
// (e.g. a shared programme PDF) stays reachable at its old URL for a while.
export async function deleteImage(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId, { invalidate: true });
}

export default cloudinary;