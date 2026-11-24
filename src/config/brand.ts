export const BRAND_CONFIG = {
  name: 'StudyCheck AI',
  tagline: 'Kiểm chứng tri thức học tập bằng sách chuẩn & AI',
  authorName: 'Tuấn Khang',
  signatureImageUrl: '/assets/aistudio/taoanhdep_chu_ky_35965_c16c11c6.webp',
  accentColor: '#0284C7',
  secondaryAccent: '#4F46E5',
  supportEmail: 'tuankhang2011pm@gmail.com',
  defaultLimits: {
    maxFileSizeMb: 20,
    maxPagesPerAnalysis: 25,
    supportedExtensions: ['.pdf', '.docx', '.jpg', '.jpeg', '.png', '.webp', '.heic'],
  },
} as const;
