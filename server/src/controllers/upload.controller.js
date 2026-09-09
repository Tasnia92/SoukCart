import cloudinary from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary.v2,
  params: (_req, file) => ({
    folder: 'nekcart',
    allowed_formats: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
    public_id: `${Date.now()}-${String(file.originalname || 'file')
      .replace(/[^\w.\-]+/g, '-')
      .toLowerCase()}`,
  }),
});

export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) {
      return cb(new Error('PNG or JPG up to 5 MB'));
    }
    cb(null, true);
  },
});

export function handleUpload(req, res) {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  // req.file.path is the full Cloudinary HTTPS URL (permanent, works from anywhere).
  res.status(201).json({ url: req.file.path, filename: req.file.originalname });
}